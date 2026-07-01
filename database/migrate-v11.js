// database/migrate-v11.js — Online shop / e-commerce extension.
//
// Adds the schema and RBAC for a public storefront on top of the existing
// Store Management module: items can be flagged publicly sellable, orders
// placed on the website become sales_orders (+ lines), deduct real stock,
// and generate a draft tax_invoice for Finance/Debtors to collect payment
// against offline — see src/app/api/public/shop/route.js for checkout and
// src/lib/pricing.js for how the selling price on each listing is derived
// (items.msp if set, else unit_cost + category margin).
//
// Run: node database/migrate-v11.js — idempotent, safe to re-run.

const { v4: uuid } = require('uuid');

async function migrate() {
  const db = require('../src/lib/db.js');
  const { query, queryOne, run } = db;
  console.log(`Running migration v11 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  const exists = async (sql, params) => !!(await queryOne(sql, params));
  const insertIfMissing = async (checkSql, checkParams, insertSql, insertParams) => {
    if (!(await exists(checkSql, checkParams))) await run(insertSql, insertParams);
  };
  const addColumnIfMissing = async (table, columnDef) => {
    try {
      await run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
      console.log(`  ${table}.${columnDef.split(' ')[0]} added`);
    } catch (e) {
      console.log(`  ${table}.${columnDef.split(' ')[0]} already exists, skipping`);
    }
  };

  // ── 1. Item columns for the storefront ───────────────────────────────────
  console.log('Adding storefront columns to items...');
  await addColumnIfMissing('items', 'is_publicly_sellable INTEGER DEFAULT 0');
  await addColumnIfMissing('items', 'shop_description TEXT');
  await addColumnIfMissing('items', 'image_url TEXT');

  // ── 2. Order tables ───────────────────────────────────────────────────────
  console.log('Creating sales_orders / sales_order_lines...');
  await run(`
    CREATE TABLE IF NOT EXISTS sales_orders (
      id                TEXT PRIMARY KEY,
      order_no          TEXT UNIQUE NOT NULL,
      client_id         TEXT REFERENCES clients(id),
      invoice_id        TEXT REFERENCES tax_invoices(id),
      customer_name     TEXT NOT NULL,
      company_name      TEXT,
      email             TEXT NOT NULL,
      phone             TEXT,
      delivery_address  TEXT,
      notes             TEXT,
      status            TEXT DEFAULT 'pending_payment',
      subtotal          REAL NOT NULL DEFAULT 0,
      vat_amount        REAL NOT NULL DEFAULT 0,
      vat_rate          REAL DEFAULT 0.16,
      total             REAL NOT NULL DEFAULT 0,
      source            TEXT DEFAULT 'Website',
      created_at        TEXT DEFAULT (datetime('now'))
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS sales_order_lines (
      id          TEXT PRIMARY KEY,
      order_id    TEXT REFERENCES sales_orders(id),
      item_id     TEXT REFERENCES items(id),
      item_name   TEXT NOT NULL,
      item_code   TEXT,
      quantity    REAL NOT NULL,
      unit_price  REAL NOT NULL,
      line_total  REAL NOT NULL
    )
  `);
  console.log('Order tables ready');

  // ── 3. Margin settings for the two categories that had none ─────────────
  console.log('Seeding missing category margins...');
  const newSettings = [
    ['msp.margin_it_office',   '0.20', 'msp'],
    ['msp.margin_consumables', '0.20', 'msp'],
  ];
  for (const [key, value, category] of newSettings) {
    await insertIfMissing(
      'SELECT 1 FROM system_settings WHERE key=?', [key],
      'INSERT INTO system_settings (key, value, category) VALUES (?,?,?)',
      [key, value, category]
    );
  }

  // ── 4. Module flag + permissions ─────────────────────────────────────────
  console.log('Seeding shop module flag...');
  await insertIfMissing(
    'SELECT 1 FROM module_flags WHERE module_id=?', ['shop'],
    'INSERT INTO module_flags (module_id, enabled, display_name, is_core) VALUES (?,1,?,0)',
    ['shop', 'Online Shop']
  );

  const newPermissions = [
    ['shop.manage_listings', 'shop', 'Choose which store items are listed on the public shop, and edit their shop description/image'],
    ['shop.view_orders',     'shop', 'View online orders placed through the public shop'],
    ['shop.fulfill_orders',  'shop', 'Mark online orders paid and fulfilled'],
    ['shop.cancel_orders',   'shop', 'Cancel online orders and restock items'],
  ];
  console.log('Seeding shop permissions...');
  for (const [code, module, desc] of newPermissions) {
    await insertIfMissing(
      'SELECT 1 FROM permissions WHERE code=?', [code],
      'INSERT INTO permissions (id, code, module, description) VALUES (?,?,?,?)',
      [uuid(), code, module, desc]
    );
  }

  // ── 5. Wire shop permissions onto relevant existing roles ──────────────
  // Additive only (insertIfMissing per role+permission) — unlike migrate-v10
  // this does NOT clear and rebuild a role's whole permission set, so it
  // won't undo anything an admin has since customised in Roles & Permissions.
  const shopRoleMap = {
    md: ['shop.manage_listings', 'shop.view_orders', 'shop.fulfill_orders', 'shop.cancel_orders'],
    admin: ['shop.manage_listings', 'shop.view_orders', 'shop.fulfill_orders', 'shop.cancel_orders'],
    store_manager: ['shop.manage_listings', 'shop.view_orders', 'shop.fulfill_orders'],
    commercial_manager: ['shop.view_orders', 'shop.fulfill_orders', 'shop.cancel_orders'],
    sales_rep: ['shop.view_orders'],
    accountant: ['shop.view_orders'],
    cfo: ['shop.view_orders'],
  };
  console.log('Wiring shop permissions onto roles...');
  let wired = 0;
  for (const roleCode in shopRoleMap) {
    const roleRow = await queryOne('SELECT id FROM roles WHERE code=?', [roleCode]);
    if (!roleRow) continue;
    for (const permCode of shopRoleMap[roleCode]) {
      const permRow = await queryOne('SELECT id FROM permissions WHERE code=?', [permCode]);
      if (!permRow) continue;
      await insertIfMissing(
        'SELECT 1 FROM role_permissions WHERE role_id=? AND permission_id=?', [roleRow.id, permRow.id],
        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)',
        [roleRow.id, permRow.id]
      );
      wired++;
    }
  }
  console.log(wired + ' shop role-permission rows wired (or already present)');

  // ── 6. Seed a handful of demo storefront listings ──────────────────────
  // So the shop isn't empty on a fresh install — flips is_publicly_sellable
  // on a few active items per category that have stock, leaves everything
  // else untouched. Safe to re-run: only ever turns the flag on, never off,
  // so it won't undo an admin's own unlisting decisions.
  console.log('Flagging a few demo items as publicly sellable...');
  const candidates = await query(`
    SELECT i.id FROM items i
    JOIN stock_balances sb ON sb.item_id = i.id
    WHERE i.is_active = 1 AND COALESCE(i.is_publicly_sellable, 0) = 0
    GROUP BY i.id
    HAVING SUM(sb.quantity) > 0
    LIMIT 12
  `);
  for (const c of candidates) {
    await run(`UPDATE items SET is_publicly_sellable = 1 WHERE id = ?`, [c.id]);
  }
  console.log(candidates.length + ' item(s) flagged as publicly sellable');

  console.log('');
  console.log('=== MIGRATION v11 COMPLETE ===');
}

migrate().catch(function(e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
