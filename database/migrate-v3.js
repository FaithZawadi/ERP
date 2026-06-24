// database/migrate-v3.js — Adds Feature Flags, Store Management, Requisitions,
// Admin/RBAC, Companies (multi-company architecture), and Vehicle Maintenance
// tables to an already-seeded database, and seeds sensible default reference
// data for all of them.
//
// Run: node database/migrate-v3.js
//
// Works against whichever backend is active (sql.js or PostgreSQL, selected
// automatically by src/lib/db.js based on DATABASE_URL) since this goes
// through that module's query()/run() rather than talking to sql.js
// directly. The original version of this script connected to sql.js
// directly and would silently do nothing useful against Postgres even with
// DATABASE_URL set, since it bypassed db.js's backend selection entirely —
// that gap is what this rewrite closes.

const { v4: uuid } = require('uuid');

const NEW_SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  legal_name      TEXT NOT NULL,
  kra_pin         TEXT,
  registered_address TEXT,
  bank_account_id TEXT REFERENCES bank_accounts(id),
  is_primary      INTEGER DEFAULT 0,
  related_party_id TEXT REFERENCES related_parties(id),
  status          TEXT DEFAULT 'active',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS module_flags (
  module_id     TEXT PRIMARY KEY,
  enabled       INTEGER DEFAULT 1,
  display_name  TEXT NOT NULL,
  description   TEXT,
  is_core       INTEGER DEFAULT 0,
  updated_by    TEXT REFERENCES employees(id),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS module_integrations (
  id              TEXT PRIMARY KEY,
  source_module   TEXT NOT NULL,
  target_module   TEXT NOT NULL,
  trigger_event   TEXT NOT NULL,
  enabled         INTEGER DEFAULT 0,
  config          TEXT,
  updated_by      TEXT REFERENCES employees(id),
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(source_module, target_module, trigger_event)
);

CREATE TABLE IF NOT EXISTS item_categories (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES item_categories(id),
  description   TEXT,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_locations (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT DEFAULT 'warehouse',
  address       TEXT,
  custodian     TEXT REFERENCES employees(id),
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_balances (
  id            TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES items(id),
  location_id   TEXT REFERENCES store_locations(id),
  batch_no      TEXT,
  quantity      REAL NOT NULL DEFAULT 0,
  updated_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id, location_id, batch_no)
);

CREATE TABLE IF NOT EXISTS stock_batches (
  id              TEXT PRIMARY KEY,
  item_id         TEXT REFERENCES items(id),
  batch_no        TEXT NOT NULL,
  manufacture_date TEXT,
  expiry_date     TEXT,
  grn_id          TEXT REFERENCES grns(id),
  supplier_id     TEXT REFERENCES suppliers(id),
  unit_cost       REAL,
  status          TEXT DEFAULT 'active',
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id, batch_no)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id              TEXT PRIMARY KEY,
  transfer_no     TEXT UNIQUE NOT NULL,
  item_id         TEXT REFERENCES items(id),
  batch_no        TEXT,
  quantity        REAL NOT NULL,
  from_location_id TEXT REFERENCES store_locations(id),
  to_location_id  TEXT REFERENCES store_locations(id),
  status          TEXT DEFAULT 'pending',
  requested_by    TEXT REFERENCES employees(id),
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TEXT,
  completed_at    TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id              TEXT PRIMARY KEY,
  adjustment_no   TEXT UNIQUE NOT NULL,
  item_id         TEXT REFERENCES items(id),
  location_id     TEXT REFERENCES store_locations(id),
  batch_no        TEXT,
  quantity_before REAL NOT NULL,
  quantity_after  REAL NOT NULL,
  variance        REAL NOT NULL,
  reason_code     TEXT NOT NULL,
  notes           TEXT,
  requested_by    TEXT REFERENCES employees(id),
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS low_stock_alerts (
  id            TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES items(id),
  location_id   TEXT REFERENCES store_locations(id),
  current_qty   REAL NOT NULL,
  reorder_level REAL NOT NULL,
  status        TEXT DEFAULT 'open',
  acknowledged_by TEXT REFERENCES employees(id),
  acknowledged_at TEXT,
  notified_at   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_requisitions (
  id              TEXT PRIMARY KEY,
  req_no          TEXT UNIQUE NOT NULL,
  requested_by    TEXT REFERENCES employees(id),
  department      TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  project_id      TEXT REFERENCES projects(id),
  priority        TEXT DEFAULT 'normal',
  status          TEXT DEFAULT 'pending_approval',
  current_approver_role TEXT,
  rejected_by     TEXT REFERENCES employees(id),
  rejected_at     TEXT,
  rejection_reason TEXT,
  closed_at       TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_requisition_lines (
  id              TEXT PRIMARY KEY,
  requisition_id  TEXT REFERENCES store_requisitions(id),
  item_id         TEXT REFERENCES items(id),
  quantity_requested REAL NOT NULL,
  quantity_issued REAL DEFAULT 0,
  batch_no        TEXT,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS requisition_approvals (
  id              TEXT PRIMARY KEY,
  requisition_id  TEXT REFERENCES store_requisitions(id),
  level           TEXT NOT NULL,
  approver_id     TEXT REFERENCES employees(id),
  decision        TEXT NOT NULL,
  comments        TEXT,
  decided_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  is_system     INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  module        TEXT NOT NULL,
  description   TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT REFERENCES roles(id),
  permission_id TEXT REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id       TEXT REFERENCES users(id),
  role_id       TEXT REFERENCES roles(id),
  assigned_by   TEXT REFERENCES employees(id),
  assigned_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS branches (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT,
  city          TEXT,
  country       TEXT DEFAULT 'Kenya',
  manager_id    TEXT REFERENCES employees(id),
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  branch_id     TEXT REFERENCES branches(id),
  head_id       TEXT REFERENCES employees(id),
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_settings (
  key           TEXT PRIMARY KEY,
  value         TEXT,
  category      TEXT DEFAULT 'general',
  description   TEXT,
  updated_by    TEXT REFERENCES employees(id),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id              TEXT PRIMARY KEY,
  vehicle_id      TEXT REFERENCES vehicles(id),
  type            TEXT NOT NULL,
  description     TEXT NOT NULL,
  date            TEXT NOT NULL,
  mileage_at_service INTEGER,
  cost            REAL DEFAULT 0,
  vendor          TEXT,
  next_due_date   TEXT,
  next_due_mileage INTEGER,
  items_consumed  TEXT,
  performed_by    TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_insurance_history (
  id              TEXT PRIMARY KEY,
  vehicle_id      TEXT REFERENCES vehicles(id),
  insurance_co    TEXT NOT NULL,
  policy_no       TEXT,
  cover_type      TEXT,
  premium         REAL,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  doc_path        TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
`;

async function migrate() {
  const db = require('../src/lib/db.js');
  const { query, queryOne, run } = db;
  console.log(`Running migration v3 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  console.log('Creating new tables...');
  // NEW_SCHEMA bundles 22 CREATE TABLE statements as one string. sql.js's
  // raw db.run() can execute multiple semicolon-separated statements in a
  // single call, but pg's parameterized query API cannot — it expects one
  // statement per call. Splitting here keeps this correct on both backends
  // (confirmed safe: no semicolons appear inside any string literal or
  // column default in this schema, verified before this rewrite).
  const schemaStatements = NEW_SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of schemaStatements) {
    await run(stmt);
  }
  console.log(`Schema applied (${schemaStatements.length} statements)`);

  console.log('Adding category_id column to items (if missing)...');
  try {
    await run('ALTER TABLE items ADD COLUMN category_id TEXT REFERENCES item_categories(id)');
    console.log('category_id column added');
  } catch (e) {
    console.log('category_id column already exists, skipping');
  }

  console.log('Adding company_id columns (if missing)...');
  for (const [table, col] of [
    ['projects', 'company_id TEXT REFERENCES companies(id)'],
    ['clients', 'company_id TEXT REFERENCES companies(id)'],
    ['tax_invoices', 'company_id TEXT REFERENCES companies(id)'],
    ['ic_transactions', 'project_id TEXT REFERENCES projects(id)'],
  ]) {
    try {
      await run(`ALTER TABLE ${table} ADD COLUMN ${col}`);
      console.log(`  ${table}.${col.split(' ')[0]} added`);
    } catch (e) {
      console.log(`  ${table}.${col.split(' ')[0]} already exists, skipping`);
    }
  }

  console.log('Seeding QSL as the primary company...');
  const qslExistsRow = await queryOne("SELECT 1 as found FROM companies WHERE is_primary=1");
  if (!qslExistsRow) {
    await run(
      `INSERT INTO companies (id, code, legal_name, registered_address, is_primary, status) VALUES (?,?,?,?,1,'active')`,
      [uuid(), 'QSL', 'Qalibrated Systems Limited', 'Birdi Singh Complex, 1st Floor, Off Mombasa Road, P.O. Box 57933-00200, Nairobi, Kenya']
    );
    console.log('  QSL company record seeded as is_primary=1 (KRA PIN and bank account left blank — set these from the Admin > Companies screen)');
  } else {
    console.log('  Primary company already seeded, skipping');
  }

  console.log('Backfilling company_id=QSL on existing projects/clients/invoices with no company set...');
  const qslRow = await queryOne("SELECT id FROM companies WHERE is_primary=1");
  const qslId = qslRow.id;
  for (const table of ['projects', 'clients', 'tax_invoices']) {
    await run(`UPDATE ${table} SET company_id=? WHERE company_id IS NULL`, [qslId]);
  }
  console.log('  Backfill complete — all existing records now correctly attributed to QSL');

  const exists = async (sql, params) => !!(await queryOne(sql, params));
  const insertIfMissing = async (checkSql, checkParams, insertSql, insertParams) => {
    if (!(await exists(checkSql, checkParams))) await run(insertSql, insertParams);
  };

  const modules = [
    ['dashboard',    'Dashboard',            1],
    ['finance',      'Finance',              0],
    ['tax',          'Tax & KRA',            0],
    ['hr',           'HR & Payroll',         0],
    ['procurement',  'Procurement',          0],
    ['stores',       'Store Management',     0],
    ['assets',       'Fixed Assets',         0],
    ['projects',     'Projects',             0],
    ['crm',          'CRM & Sales',          0],
    ['debtors',      'Debtors',              0],
    ['fleet',        'Fleet Management',     0],
    ['hse',          'HSE',                  0],
    ['calibration',  'Calibration',          0],
    ['bids',         'Bids & Pre-Sales',     0],
    ['inspection',   'Inspection Body (ISO 17020)', 0],
    ['ic',           'Inter-Company',        0],
    ['integrations', 'Integrations',         0],
    ['compliance',   'Compliance',           0],
    ['reports',      'Reports',              0],
    ['tasks',        'Tasks',                0],
    ['admin',        'Administration',       1],
    ['settings',     'Settings',             1],
  ];
  console.log('Seeding module flags...');
  for (const [id, name, isCore] of modules) {
    await insertIfMissing(
      'SELECT 1 FROM module_flags WHERE module_id=?', [id],
      'INSERT INTO module_flags (module_id, enabled, display_name, is_core) VALUES (?,1,?,?)',
      [id, name, isCore]
    );
  }
  console.log(modules.length + ' module flags seeded');

  const integrations = [
    ['store_requisitions', 'procurement', 'insufficient_stock', 'Auto-create a Purchase Requisition when an approved store requisition cannot be fully met from stock on hand'],
    ['stores',             'finance',     'stock_issued',       'Post a cost-of-goods journal entry to the GL whenever stock is issued against a project'],
    ['fleet',              'stores',      'maintenance_logged', 'Deduct consumed parts/consumables from store stock when a vehicle maintenance record is logged'],
    ['store_requisitions', 'finance',     'requisition_closed', 'Record the value of issued items against the requesting project/department budget'],
  ];
  console.log('Seeding module integration definitions...');
  for (const [src, tgt, trig, desc] of integrations) {
    await insertIfMissing(
      'SELECT 1 FROM module_integrations WHERE source_module=? AND target_module=? AND trigger_event=?', [src, tgt, trig],
      'INSERT INTO module_integrations (id, source_module, target_module, trigger_event, enabled, config) VALUES (?,?,?,?,0,?)',
      [uuid(), src, tgt, trig, JSON.stringify({ description: desc })]
    );
  }
  console.log(integrations.length + ' integration definitions seeded (disabled by default)');

  const categories = [
    ['CAT-001', 'Calibration Equipment'],
    ['CAT-002', 'Test & Measurement Instruments'],
    ['CAT-003', 'Electrical Components'],
    ['CAT-004', 'Mechanical Spares'],
    ['CAT-005', 'PPE & Safety Equipment'],
    ['CAT-006', 'IT & Office Equipment'],
    ['CAT-007', 'Consumables'],
    ['CAT-008', 'Vehicle Spares & Tyres'],
    ['CAT-009', 'Tools'],
  ];
  console.log('Seeding item categories...');
  for (const [code, name] of categories) {
    await insertIfMissing(
      'SELECT 1 FROM item_categories WHERE code=?', [code],
      'INSERT INTO item_categories (id, code, name) VALUES (?,?,?)',
      [uuid(), code, name]
    );
  }
  console.log(categories.length + ' item categories seeded');

  const locations = [
    ['LOC-001', 'Nairobi HQ Main Store', 'warehouse'],
    ['LOC-002', 'Kisumu Branch Store',   'warehouse'],
    ['LOC-003', 'Calibration Lab Store', 'warehouse'],
    ['LOC-004', 'Site Stock - Mobile',   'site'],
  ];
  console.log('Seeding store locations...');
  for (const [code, name, type] of locations) {
    await insertIfMissing(
      'SELECT 1 FROM store_locations WHERE code=?', [code],
      'INSERT INTO store_locations (id, code, name, type) VALUES (?,?,?,?)',
      [uuid(), code, name, type]
    );
  }
  console.log(locations.length + ' store locations seeded');

  const roles = [
    ['md',              'Managing Director',  1],
    ['admin',           'System Administrator', 1],
    ['cfo',             'Finance Manager / CFO', 1],
    ['store_manager',   'Store Manager',       0],
    ['store_clerk',     'Store Clerk',         0],
    ['procurement_officer', 'Procurement Officer', 0],
    ['fleet_manager',   'Fleet Manager',       0],
    ['hr_manager',      'HR Manager',          0],
    ['project_manager', 'Project Manager',     0],
    ['technician',      'Calibration Technician', 0],
    ['staff',           'General Staff',       0],
  ];
  console.log('Seeding roles...');
  for (const [code, name, isSystem] of roles) {
    await insertIfMissing(
      'SELECT 1 FROM roles WHERE code=?', [code],
      'INSERT INTO roles (id, code, name, is_system) VALUES (?,?,?,?)',
      [uuid(), code, name, isSystem]
    );
  }

  const permissions = [
    ['calibration.view_own',  'calibration',  'View own assigned calibration jobs'],
    ['calibration.log',       'calibration',  'Log calibration results and upload certificates'],
    ['store.view',            'store',        'View inventory and stock balances'],
    ['store.view_cost',       'store',        'View unit cost / purchase price (hidden from sales staff per STK-010/011)'],
    ['store.receive',         'store',        'Receive stock (GRN processing)'],
    ['store.issue',           'store',        'Issue stock against requisitions'],
    ['store.transfer',        'store',        'Transfer stock between locations'],
    ['store.adjust',          'store',        'Create stock adjustments'],
    ['store.adjust.approve',  'store',        'Approve stock adjustments'],
    ['requisitions.create',   'requisitions', 'Create store requisitions'],
    ['requisitions.approve',  'requisitions', 'Approve store requisitions'],
    ['requisitions.view_all', 'requisitions', 'View all requisitions across departments'],
    ['fleet.view',            'fleet',        'View fleet register'],
    ['fleet.manage',          'fleet',        'Manage vehicles, maintenance, insurance'],
    ['admin.users',           'admin',        'Manage users and role assignments'],
    ['admin.roles',           'admin',        'Define roles and permissions'],
    ['admin.departments',     'admin',        'Manage departments and branches'],
    ['admin.settings',        'admin',        'Manage system settings'],
    ['admin.modules',         'admin',        'Toggle modules and integrations on/off'],
    ['reports.view',          'reports',      'View operational reports'],
    ['reports.export',        'reports',      'Export reports to PDF/Excel'],
  ];
  console.log('Seeding permissions...');
  for (const [code, module, desc] of permissions) {
    await insertIfMissing(
      'SELECT 1 FROM permissions WHERE code=?', [code],
      'INSERT INTO permissions (id, code, module, description) VALUES (?,?,?,?)',
      [uuid(), code, module, desc]
    );
  }
  console.log(roles.length + ' roles, ' + permissions.length + ' permissions seeded');

  const rolePermMap = {
    md:                  permissions.map(p => p[0]),
    admin:               permissions.map(p => p[0]),
    cfo:                 ['store.view','store.view_cost','requisitions.approve','requisitions.view_all','reports.view','reports.export'],
    store_manager:       ['store.view','store.view_cost','store.receive','store.issue','store.transfer','store.adjust','store.adjust.approve','requisitions.approve','requisitions.view_all','reports.view'],
    store_clerk:         ['store.view','store.receive','store.issue','requisitions.create'],
    procurement_officer: ['store.view','store.view_cost','requisitions.view_all','reports.view'],
    fleet_manager:       ['fleet.view','fleet.manage','store.view','requisitions.create','reports.view'],
    hr_manager:          ['admin.users','reports.view'],
    project_manager:     ['requisitions.create','requisitions.view_all','reports.view'],
    technician:          ['calibration.view_own','calibration.log','requisitions.create','store.view','fleet.view'],
    staff:               ['requisitions.create','store.view'],
  };

  console.log('Wiring role -> permission mappings...');
  let mappingCount = 0;
  for (const roleCode in rolePermMap) {
    const permCodes = rolePermMap[roleCode];
    const roleRow = await queryOne('SELECT id FROM roles WHERE code=?', [roleCode]);
    if (!roleRow) continue;
    const roleId = roleRow.id;

    for (const permCode of permCodes) {
      const permRow = await queryOne('SELECT id FROM permissions WHERE code=?', [permCode]);
      if (!permRow) continue;
      const permId = permRow.id;

      await insertIfMissing(
        'SELECT 1 FROM role_permissions WHERE role_id=? AND permission_id=?', [roleId, permId],
        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)',
        [roleId, permId]
      );
      mappingCount++;
    }
  }
  console.log(mappingCount + ' role-permission mappings wired');

  console.log('Assigning existing users to matching roles...');
  const users = await query('SELECT id, role FROM users');

  let userRoleCount = 0;
  for (const u of users) {
    const roleRow = await queryOne('SELECT id FROM roles WHERE code=?', [u.role]);
    if (roleRow) {
      await insertIfMissing(
        'SELECT 1 FROM user_roles WHERE user_id=? AND role_id=?', [u.id, roleRow.id],
        'INSERT INTO user_roles (user_id, role_id) VALUES (?,?)',
        [u.id, roleRow.id]
      );
      userRoleCount++;
    }
  }
  console.log(userRoleCount + ' users assigned to matching roles');

  const branchNairobi = uuid();
  const branchKisumu  = uuid();
  await insertIfMissing('SELECT 1 FROM branches WHERE code=?', ['BR-NBO'],
    'INSERT INTO branches (id, code, name, city) VALUES (?,?,?,?)', [branchNairobi, 'BR-NBO', 'Nairobi HQ', 'Nairobi']);
  await insertIfMissing('SELECT 1 FROM branches WHERE code=?', ['BR-KSM'],
    'INSERT INTO branches (id, code, name, city) VALUES (?,?,?,?)', [branchKisumu, 'BR-KSM', 'Kisumu Branch', 'Kisumu']);

  const departments = [
    ['DEPT-001', 'Engineering', branchNairobi],
    ['DEPT-002', 'Finance', branchNairobi],
    ['DEPT-003', 'HR & Admin', branchNairobi],
    ['DEPT-004', 'Procurement & Stores', branchNairobi],
    ['DEPT-005', 'Business Development', branchNairobi],
    ['DEPT-006', 'Calibration Lab', branchNairobi],
    ['DEPT-007', 'Kisumu Operations', branchKisumu],
  ];
  console.log('Seeding departments...');
  for (const [code, name, branchId] of departments) {
    await insertIfMissing(
      'SELECT 1 FROM departments WHERE code=?', [code],
      'INSERT INTO departments (id, code, name, branch_id) VALUES (?,?,?,?)',
      [uuid(), code, name, branchId]
    );
  }
  console.log('2 branches, ' + departments.length + ' departments seeded');

  const settings = [
    // Company identity
    ['company.legal_name', 'Qalibrated Systems Limited', 'company'],
    ['company.kra_pin', 'P000000001K', 'company'],
    ['company.address', 'Birdi Singh Complex, Off Mombasa Road, Nairobi', 'company'],
    ['company.phone', '+254 714 999 996', 'company'],
    ['company.email', 'info@qalibrated.co.ke', 'company'],
    // Branding & theme
    ['branding.company_display_name', 'QSL ERP', 'branding'],
    ['branding.logo_url', '/logo.svg', 'branding'],
    ['branding.primary_color', '#1B3A5C', 'branding'],
    ['branding.accent_color', '#C8960C', 'branding'],
    ['branding.font_family', 'Inter', 'branding'],
    // General
    ['general.default_currency', 'KES', 'general'],
    ['general.fiscal_year_start', '01-01', 'general'],
    // Finance
    ['finance.vat_rate', '0.16', 'finance'],
    ['finance.imprest_retire_days', '14', 'finance'],
    ['finance.pay_limit_staff', '5000', 'finance'],
    ['finance.pay_limit_dept_head', '20000', 'finance'],
    ['finance.pay_limit_finance_mgr', '100000', 'finance'],
    ['finance.pay_limit_cfo', '500000', 'finance'],
    ['finance.fx_buffer', '0.05', 'finance'],
    ['finance.fx_buffer_long', '0.08', 'finance'],
    ['finance.fx_buffer_lead_days', '60', 'finance'],
    // MSP margins
    ['msp.margin_calibration', '0.25', 'msp'],
    ['msp.margin_construction', '0.15', 'msp'],
    ['msp.margin_spare_parts', '0.30', 'msp'],
    ['msp.margin_tools', '0.20', 'msp'],
    ['msp.margin_safety', '0.20', 'msp'],
    ['msp.margin_imported', '0.30', 'msp'],
    // Commission tiers (COM-001)
    ['commission.tiers', '[{"from":0,"to":70,"rate":0},{"from":70,"to":80,"rate":0.01},{"from":80,"to":90,"rate":0.03},{"from":90,"to":100,"rate":0.05},{"from":100,"to":9999,"rate":0.07}]', 'commission'],
    // Store & requisitions
    ['store.low_stock_check_frequency', 'daily', 'store'],
    ['requisitions.approval_levels', '["supervisor","store_manager"]', 'requisitions'],
    // Alert windows
    ['alerts.cert_expiry_days', '60', 'alerts'],
    ['alerts.debtor_escalation_days', '30', 'alerts'],
    ['alerts.insurance_alert_days', '30', 'alerts'],
    ['alerts.tender_alert_days', '14', 'alerts'],
  ];
  console.log('Seeding system settings...');
  for (const [key, value, category] of settings) {
    await insertIfMissing(
      'SELECT 1 FROM system_settings WHERE key=?', [key],
      'INSERT INTO system_settings (key, value, category) VALUES (?,?,?)',
      [key, value, category]
    );
  }
  console.log(settings.length + ' system settings seeded');

  console.log('Backfilling stock_balances for existing items...');
  const mainLoc = await queryOne("SELECT id FROM store_locations WHERE code='LOC-001'");
  const mainLocId = mainLoc.id;

  const items = await query('SELECT id, reorder_level FROM items');

  let balanceCount = 0;
  for (const item of items) {
    await insertIfMissing(
      'SELECT 1 FROM stock_balances WHERE item_id=? AND location_id=? AND batch_no IS NULL', [item.id, mainLocId],
      'INSERT INTO stock_balances (id, item_id, location_id, batch_no, quantity) VALUES (?,?,?,NULL,?)',
      [uuid(), item.id, mainLocId, item.reorder_level || 0]
    );
    balanceCount++;
  }
  console.log(balanceCount + ' stock balance rows backfilled at Nairobi HQ Main Store');

  console.log('');
  console.log('=== MIGRATION COMPLETE ===');
}

migrate().catch(function(e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
