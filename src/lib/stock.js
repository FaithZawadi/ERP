// src/lib/stock.js — shared stock_balances read/write helpers.
//
// Originally defined only inside src/app/api/stores/route.js. Pulled out
// here so src/app/api/public/shop/route.js (online order checkout) can
// adjust stock through the exact same path as internal store issues —
// one definition of "how a balance changes," not two that could drift.

const { v4: uuid } = require('uuid');
const { queryOne, run, query } = require('./db');

async function getBalance(item_id, location_id, batch_no) {
  const row = await queryOne(
    `SELECT quantity FROM stock_balances WHERE item_id=? AND location_id=? AND ${batch_no ? 'batch_no=?' : 'batch_no IS NULL'}`,
    batch_no ? [item_id, location_id, batch_no] : [item_id, location_id]
  );
  return row ? row.quantity : 0;
}

async function setBalance(item_id, location_id, batch_no, newQty) {
  const existing = await queryOne(
    `SELECT id FROM stock_balances WHERE item_id=? AND location_id=? AND ${batch_no ? 'batch_no=?' : 'batch_no IS NULL'}`,
    batch_no ? [item_id, location_id, batch_no] : [item_id, location_id]
  );
  if (existing) {
    await run(`UPDATE stock_balances SET quantity=?, updated_at=datetime('now') WHERE id=?`, [newQty, existing.id]);
  } else {
    await run(`INSERT INTO stock_balances (id, item_id, location_id, batch_no, quantity) VALUES (?,?,?,?,?)`,
      [uuid(), item_id, location_id, batch_no || null, newQty]);
  }
}

async function checkLowStock(item_id, location_id) {
  const item = await queryOne(`SELECT reorder_level FROM items WHERE id=?`, [item_id]);
  if (!item) return;
  const totalRow = await queryOne(`SELECT SUM(quantity) as total FROM stock_balances WHERE item_id=?`, [item_id]);
  const total = totalRow?.total || 0;
  if (total <= (item.reorder_level || 0)) {
    const existingAlert = await queryOne(`SELECT id FROM low_stock_alerts WHERE item_id=? AND location_id=? AND status='open'`, [item_id, location_id]);
    if (!existingAlert) {
      await run(
        `INSERT INTO low_stock_alerts (id, item_id, location_id, current_qty, reorder_level) VALUES (?,?,?,?,?)`,
        [uuid(), item_id, location_id, total, item.reorder_level || 0]
      );
    }
  } else {
    await run(`UPDATE low_stock_alerts SET status='resolved' WHERE item_id=? AND status='open'`, [item_id]);
  }
}

// Total stock for an item, summed across every location.
async function getTotalStock(item_id) {
  const row = await queryOne(`SELECT SUM(quantity) as total FROM stock_balances WHERE item_id=?`, [item_id]);
  return row?.total || 0;
}

// Deduct `quantity` of an item across one or more locations (largest
// balance first), recording a stock_movements row per location touched.
// Throws if total stock across all locations is insufficient — callers
// should check getTotalStock() first to fail fast with a clean error
// before calling this, but this is the authoritative guard either way.
async function deductStockAcrossLocations(item_id, quantity, { reference, doneBy, notes, type = 'sale' } = {}) {
  let remaining = Number(quantity);
  const balances = await query(
    `SELECT location_id, batch_no, quantity FROM stock_balances WHERE item_id=? AND quantity > 0 ORDER BY quantity DESC`,
    [item_id]
  );
  const totalAvailable = balances.reduce((s, b) => s + b.quantity, 0);
  if (totalAvailable < remaining) {
    throw new Error(`Insufficient stock — available: ${totalAvailable}, requested: ${remaining}`);
  }

  for (const b of balances) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    const newBalance = b.quantity - take;
    await setBalance(item_id, b.location_id, b.batch_no, newBalance);
    await run(
      `INSERT INTO stock_movements (id, item_id, type, quantity, balance, reference, date, done_by, notes)
       VALUES (?,?,?,?,?,?,date('now'),?,?)`,
      [uuid(), item_id, type, -take, newBalance, reference || null, doneBy || null, notes || null]
    );
    await checkLowStock(item_id, b.location_id);
    remaining -= take;
  }
}

// Reverse of the above — used when an online order is cancelled. Restocks
// to the first location with a balance row for this item (falling back to
// the main Nairobi HQ store), since we no longer know which specific
// location(s) a cancelled order's deduction came from without a deeper
// per-line audit trail than sales_order_lines currently keeps.
async function restock(item_id, quantity, { reference, doneBy, notes } = {}) {
  let loc = await queryOne(`SELECT location_id FROM stock_balances WHERE item_id=? ORDER BY quantity DESC LIMIT 1`, [item_id]);
  if (!loc) {
    const mainLoc = await queryOne(`SELECT id as location_id FROM store_locations WHERE code='LOC-001'`);
    loc = mainLoc;
  }
  if (!loc) return; // no locations exist at all — nothing sensible to do
  const current = await getBalance(item_id, loc.location_id, null);
  const newBalance = current + Number(quantity);
  await setBalance(item_id, loc.location_id, null, newBalance);
  await run(
    `INSERT INTO stock_movements (id, item_id, type, quantity, balance, reference, date, done_by, notes)
     VALUES (?,?,?,?,?,?,date('now'),?,?)`,
    [uuid(), item_id, 'return', quantity, newBalance, reference || null, doneBy || null, notes || null]
  );
}

module.exports = { getBalance, setBalance, checkLowStock, getTotalStock, deductStockAcrossLocations, restock };
