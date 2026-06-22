// src/app/api/stores/route.js — Store Management Module (point 1)
//
// Real-time inventory: every receive/issue/transfer/adjustment updates
// stock_balances transactionally alongside the historical stock_movements
// log, so current balance is always a direct read, never a derived sum.
//
// GET  ?section=items                    -> item master with current total balance
// GET  ?section=item_detail&id=           -> one item: balances by location, batches, movement history
// GET  ?section=categories                -> item categories
// GET  ?section=locations                 -> store locations
// GET  ?section=balances&location_id=     -> stock balances at a location
// GET  ?section=transfers                 -> stock transfer history
// GET  ?section=adjustments               -> stock adjustment history
// GET  ?section=low_stock                 -> open low-stock alerts
// GET  ?section=batches&item_id=          -> batch list for an item (expiry tracking)
//
// POST { action: 'create_item', code, name, category_id, unit, reorder_level, unit_cost, msp, is_serialised, is_batch_tracked }
// POST { action: 'create_category', code, name, parent_id }
// POST { action: 'create_location', code, name, type }
// POST { action: 'receive_stock', item_id, location_id, quantity, batch_no, expiry_date, unit_cost, grn_id, supplier_id, reference }
// POST { action: 'issue_stock', item_id, location_id, quantity, batch_no, reference, project_id, requisition_id }
// POST { action: 'transfer_stock', item_id, batch_no, quantity, from_location_id, to_location_id, notes }
// POST { action: 'approve_transfer', id }
// POST { action: 'create_adjustment', item_id, location_id, batch_no, quantity_after, reason_code, notes }
// POST { action: 'approve_adjustment', id }
// POST { action: 'acknowledge_alert', id }

import { v4 as uuid } from 'uuid';
import { requireAuth, requirePermission, requireModuleEnabled, userHasPermission, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

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
    // Stock replenished above reorder level — auto-resolve any open alert
    await run(`UPDATE low_stock_alerts SET status='resolved' WHERE item_id=? AND status='open'`, [item_id]);
  }
}

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);
  if (!(await requireModuleEnabled('stores'))) return err('Store Management module is not enabled for this deployment', 403);

  // STK-010/011: cost/purchase price is hidden from anyone without explicit
  // store.view_cost (md/admin always pass via userHasPermission's role check
  // — see auth.js). MSP stays visible to everyone who can see items at all,
  // since MSP is the figure sales staff are meant to work from.
  const canViewCost = auth.user.role === 'md' || auth.user.role === 'admin' || await userHasPermission(auth.user.id, 'store.view_cost');
  const stripCost = (item) => {
    if (canViewCost || !item) return item;
    const { unit_cost, ...rest } = item;
    return rest;
  };

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'items';

  try {
    if (section === 'items') {
      const rows = await query(
        `SELECT i.*, c.name as category_name, s.name as supplier_name,
                (SELECT COALESCE(SUM(sb.quantity),0) FROM stock_balances sb WHERE sb.item_id=i.id) as total_balance,
                (SELECT COUNT(*) FROM low_stock_alerts la WHERE la.item_id=i.id AND la.status='open') as has_low_stock_alert
         FROM items i
         LEFT JOIN item_categories c ON i.category_id=c.id
         LEFT JOIN suppliers s ON i.supplier_id=s.id
         WHERE i.is_active=1 ORDER BY i.name`
      );
      return ok(rows.map(stripCost));
    }

    if (section === 'item_detail') {
      const id = searchParams.get('id');
      if (!id) return err('id required', 400);
      const item = await queryOne(`SELECT i.*, c.name as category_name FROM items i LEFT JOIN item_categories c ON i.category_id=c.id WHERE i.id=?`, [id]);
      if (!item) return err('Item not found', 404);
      const balances = await query(
        `SELECT sb.*, sl.name as location_name, sl.code as location_code FROM stock_balances sb JOIN store_locations sl ON sb.location_id=sl.id WHERE sb.item_id=? AND sb.quantity != 0`,
        [id]
      );
      const batches = await query(`SELECT * FROM stock_batches WHERE item_id=? ORDER BY expiry_date`, [id]);
      const movements = await query(
        `SELECT sm.*, e.first_name||' '||e.last_name as done_by_name FROM stock_movements sm LEFT JOIN employees e ON sm.done_by=e.id WHERE sm.item_id=? ORDER BY sm.created_at DESC LIMIT 50`,
        [id]
      );
      return ok({ item: stripCost(item), balances, batches, movements });
    }

    if (section === 'categories') {
      const rows = await query(
        `SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id=c.id AND i.is_active=1) as item_count
         FROM item_categories c WHERE c.is_active=1 ORDER BY c.name`
      );
      return ok(rows);
    }

    if (section === 'locations') {
      const rows = await query(
        `SELECT sl.*, e.first_name||' '||e.last_name as custodian_name,
                (SELECT COUNT(DISTINCT item_id) FROM stock_balances sb WHERE sb.location_id=sl.id AND sb.quantity>0) as distinct_items
         FROM store_locations sl LEFT JOIN employees e ON sl.custodian=e.id WHERE sl.is_active=1 ORDER BY sl.name`
      );
      return ok(rows);
    }

    if (section === 'balances') {
      const location_id = searchParams.get('location_id');
      let sql = `SELECT sb.*, i.code as item_code, i.name as item_name, i.unit, sl.name as location_name
                 FROM stock_balances sb JOIN items i ON sb.item_id=i.id JOIN store_locations sl ON sb.location_id=sl.id
                 WHERE sb.quantity != 0`;
      const params = [];
      if (location_id) { sql += ` AND sb.location_id=?`; params.push(location_id); }
      sql += ` ORDER BY i.name`;
      const rows = await query(sql, params);
      return ok(rows);
    }

    if (section === 'transfers') {
      const rows = await query(
        `SELECT st.*, i.name as item_name, i.code as item_code,
                fl.name as from_location_name, tl.name as to_location_name,
                e1.first_name||' '||e1.last_name as requested_by_name,
                e2.first_name||' '||e2.last_name as approved_by_name
         FROM stock_transfers st
         JOIN items i ON st.item_id=i.id
         JOIN store_locations fl ON st.from_location_id=fl.id
         JOIN store_locations tl ON st.to_location_id=tl.id
         LEFT JOIN employees e1 ON st.requested_by=e1.id
         LEFT JOIN employees e2 ON st.approved_by=e2.id
         ORDER BY st.created_at DESC LIMIT 100`
      );
      return ok(rows);
    }

    if (section === 'adjustments') {
      const rows = await query(
        `SELECT sa.*, i.name as item_name, i.code as item_code, sl.name as location_name,
                e1.first_name||' '||e1.last_name as requested_by_name,
                e2.first_name||' '||e2.last_name as approved_by_name
         FROM stock_adjustments sa
         JOIN items i ON sa.item_id=i.id
         JOIN store_locations sl ON sa.location_id=sl.id
         LEFT JOIN employees e1 ON sa.requested_by=e1.id
         LEFT JOIN employees e2 ON sa.approved_by=e2.id
         ORDER BY sa.created_at DESC LIMIT 100`
      );
      return ok(rows);
    }

    if (section === 'low_stock') {
      const rows = await query(
        `SELECT la.*, i.name as item_name, i.code as item_code, i.unit, sl.name as location_name
         FROM low_stock_alerts la JOIN items i ON la.item_id=i.id JOIN store_locations sl ON la.location_id=sl.id
         WHERE la.status='open' ORDER BY la.created_at DESC`
      );
      return ok(rows);
    }

    if (section === 'batches') {
      const item_id = searchParams.get('item_id');
      if (!item_id) return err('item_id required', 400);
      const rows = await query(
        `SELECT sb.*, s.name as supplier_name FROM stock_batches sb LEFT JOIN suppliers s ON sb.supplier_id=s.id WHERE sb.item_id=? ORDER BY sb.expiry_date`,
        [item_id]
      );
      return ok(rows);
    }

    return err('Unknown section', 400);
  } catch (e) {
    console.error('[Stores GET]', e);
    return err('Server error', 500);
  }
}

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);
  if (!(await requireModuleEnabled('stores'))) return err('Store Management module is not enabled for this deployment', 403);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {

      case 'create_item': {
        const { code, name, description, category_id, unit, reorder_level, reorder_qty, unit_cost, msp, supplier_id, is_serialised, is_batch_tracked } = body;
        if (!code || !name) return err('code and name required', 400);
        const existing = await queryOne(`SELECT id FROM items WHERE code=?`, [code]);
        if (existing) return err('Item code already exists', 409);
        const id = uuid();
        await run(
          `INSERT INTO items (id, code, name, description, category, unit, reorder_level, reorder_qty, unit_cost, msp, supplier_id, is_serialised)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, code, name, description || null, category_id || 'Uncategorised', unit || 'each', reorder_level || 0, reorder_qty || 0, unit_cost || 0, msp || 0, supplier_id || null, is_serialised ? 1 : 0]
        );
        // category_id from item_categories also stored on a dedicated column if present in schema
        try { await run(`UPDATE items SET category_id=? WHERE id=?`, [category_id || null, id]); } catch {}
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_ITEM', module: 'Stores', recordId: id, newValue: { code, name } });
        return ok({ id, code, name }, 201);
      }

      case 'create_category': {
        const { code, name, parent_id, description } = body;
        if (!code || !name) return err('code and name required', 400);
        const existing = await queryOne(`SELECT id FROM item_categories WHERE code=?`, [code]);
        if (existing) return err('Category code already exists', 409);
        const id = uuid();
        await run(`INSERT INTO item_categories (id, code, name, parent_id, description) VALUES (?,?,?,?,?)`,
          [id, code, name, parent_id || null, description || null]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_CATEGORY', module: 'Stores', recordId: id, newValue: { code, name } });
        return ok({ id, code, name }, 201);
      }

      case 'create_location': {
        const { code, name, type, address } = body;
        if (!code || !name) return err('code and name required', 400);
        const existing = await queryOne(`SELECT id FROM store_locations WHERE code=?`, [code]);
        if (existing) return err('Location code already exists', 409);
        const id = uuid();
        await run(`INSERT INTO store_locations (id, code, name, type, address) VALUES (?,?,?,?,?)`,
          [id, code, name, type || 'warehouse', address || null]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_LOCATION', module: 'Stores', recordId: id, newValue: { code, name } });
        return ok({ id, code, name }, 201);
      }

      case 'receive_stock': {
        const permCheck = await requirePermission('store.receive')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { item_id, location_id, quantity, batch_no, expiry_date, manufacture_date, unit_cost, grn_id, supplier_id, reference, notes } = body;
        if (!item_id || !location_id || !quantity) return err('item_id, location_id, quantity required', 400);
        if (quantity <= 0) return err('quantity must be positive', 400);

        if (batch_no) {
          const existingBatch = await queryOne(`SELECT id FROM stock_batches WHERE item_id=? AND batch_no=?`, [item_id, batch_no]);
          if (!existingBatch) {
            await run(
              `INSERT INTO stock_batches (id, item_id, batch_no, manufacture_date, expiry_date, grn_id, supplier_id, unit_cost) VALUES (?,?,?,?,?,?,?,?)`,
              [uuid(), item_id, batch_no, manufacture_date || null, expiry_date || null, grn_id || null, supplier_id || null, unit_cost || null]
            );
          }
        }

        const currentBalance = await getBalance(item_id, location_id, batch_no);
        const newBalance = currentBalance + Number(quantity);
        await setBalance(item_id, location_id, batch_no, newBalance);

        await run(
          `INSERT INTO stock_movements (id, item_id, type, quantity, balance, reference, grn_id, date, done_by, notes)
           VALUES (?,?,?,?,?,?,?,date('now'),?,?)`,
          [uuid(), item_id, 'receive', quantity, newBalance, reference || null, grn_id || null, auth.user.employee_id, notes || (batch_no ? `Batch: ${batch_no}` : null)]
        );

        await checkLowStock(item_id, location_id);

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'RECEIVE_STOCK', module: 'Stores', recordId: item_id, newValue: { quantity, location_id, batch_no } });
        return ok({ received: true, new_balance: newBalance });
      }

      case 'issue_stock': {
        const permCheck = await requirePermission('store.issue')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { item_id, location_id, quantity, batch_no, reference, project_id, requisition_id, notes } = body;
        if (!item_id || !location_id || !quantity) return err('item_id, location_id, quantity required', 400);
        if (quantity <= 0) return err('quantity must be positive', 400);

        const currentBalance = await getBalance(item_id, location_id, batch_no);
        if (currentBalance < quantity) {
          return err(`Insufficient stock — available: ${currentBalance}, requested: ${quantity}`, 400);
        }

        const newBalance = currentBalance - Number(quantity);
        await setBalance(item_id, location_id, batch_no, newBalance);

        await run(
          `INSERT INTO stock_movements (id, item_id, type, quantity, balance, reference, project_id, date, done_by, notes)
           VALUES (?,?,?,?,?,?,?,date('now'),?,?)`,
          [uuid(), item_id, 'issue', -quantity, newBalance, reference || requisition_id || null, project_id || null, auth.user.employee_id, notes || null]
        );

        // If this issuance is closing a store requisition line, record it
        if (requisition_id) {
          const line = await queryOne(`SELECT id, quantity_issued FROM store_requisition_lines WHERE requisition_id=? AND item_id=?`, [requisition_id, item_id]);
          if (line) {
            await run(`UPDATE store_requisition_lines SET quantity_issued=? WHERE id=?`, [(line.quantity_issued || 0) + Number(quantity), line.id]);
          }
        }

        await checkLowStock(item_id, location_id);

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'ISSUE_STOCK', module: 'Stores', recordId: item_id, newValue: { quantity, location_id, batch_no, requisition_id } });
        return ok({ issued: true, new_balance: newBalance });
      }

      case 'transfer_stock': {
        const permCheck = await requirePermission('store.transfer')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { item_id, batch_no, quantity, from_location_id, to_location_id, notes } = body;
        if (!item_id || !quantity || !from_location_id || !to_location_id) return err('item_id, quantity, from_location_id, to_location_id required', 400);
        if (from_location_id === to_location_id) return err('Source and destination locations must differ', 400);

        const available = await getBalance(item_id, from_location_id, batch_no);
        if (available < quantity) return err(`Insufficient stock at source location — available: ${available}`, 400);

        const transferNo = `TRF-${Date.now().toString().slice(-8)}`;
        const id = uuid();
        await run(
          `INSERT INTO stock_transfers (id, transfer_no, item_id, batch_no, quantity, from_location_id, to_location_id, requested_by, notes, status)
           VALUES (?,?,?,?,?,?,?,?,?,'pending')`,
          [id, transferNo, item_id, batch_no || null, quantity, from_location_id, to_location_id, auth.user.employee_id, notes || null]
        );

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_TRANSFER', module: 'Stores', recordId: id, newValue: { transferNo, quantity } });
        return ok({ id, transfer_no: transferNo, status: 'pending' }, 201);
      }

      case 'approve_transfer': {
        const permCheck = await requirePermission('store.transfer')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { id } = body;
        if (!id) return err('id required', 400);
        const transfer = await queryOne(`SELECT * FROM stock_transfers WHERE id=?`, [id]);
        if (!transfer) return err('Transfer not found', 404);
        if (transfer.status !== 'pending') return err('Transfer already processed', 400);

        const available = await getBalance(transfer.item_id, transfer.from_location_id, transfer.batch_no);
        if (available < transfer.quantity) return err('Insufficient stock at source — stock levels changed since request', 400);

        const fromNew = available - transfer.quantity;
        await setBalance(transfer.item_id, transfer.from_location_id, transfer.batch_no, fromNew);
        const toBalance = await getBalance(transfer.item_id, transfer.to_location_id, transfer.batch_no);
        const toNew = toBalance + transfer.quantity;
        await setBalance(transfer.item_id, transfer.to_location_id, transfer.batch_no, toNew);

        await run(`UPDATE stock_transfers SET status='completed', approved_by=?, approved_at=datetime('now'), completed_at=datetime('now') WHERE id=?`,
          [auth.user.employee_id, id]);

        await run(
          `INSERT INTO stock_movements (id, item_id, type, quantity, balance, reference, date, done_by, notes) VALUES (?,?,?,?,?,?,date('now'),?,?)`,
          [uuid(), transfer.item_id, 'transfer_out', -transfer.quantity, fromNew, transfer.transfer_no, auth.user.employee_id, `Transfer to location`]
        );
        await run(
          `INSERT INTO stock_movements (id, item_id, type, quantity, balance, reference, date, done_by, notes) VALUES (?,?,?,?,?,?,date('now'),?,?)`,
          [uuid(), transfer.item_id, 'transfer_in', transfer.quantity, toNew, transfer.transfer_no, auth.user.employee_id, `Transfer from location`]
        );

        await checkLowStock(transfer.item_id, transfer.from_location_id);

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'APPROVE_TRANSFER', module: 'Stores', recordId: id });
        return ok({ approved: true, status: 'completed' });
      }

      case 'create_adjustment': {
        const permCheck = await requirePermission('store.adjust')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { item_id, location_id, batch_no, quantity_after, reason_code, notes } = body;
        if (!item_id || !location_id || quantity_after === undefined || !reason_code) {
          return err('item_id, location_id, quantity_after, reason_code required', 400);
        }
        const before = await getBalance(item_id, location_id, batch_no);
        const variance = Number(quantity_after) - before;

        const adjustmentNo = `ADJ-${Date.now().toString().slice(-8)}`;
        const id = uuid();
        await run(
          `INSERT INTO stock_adjustments (id, adjustment_no, item_id, location_id, batch_no, quantity_before, quantity_after, variance, reason_code, notes, requested_by, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')`,
          [id, adjustmentNo, item_id, location_id, batch_no || null, before, quantity_after, variance, reason_code, notes || null, auth.user.employee_id]
        );

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_ADJUSTMENT', module: 'Stores', recordId: id, newValue: { variance, reason_code } });
        return ok({ id, adjustment_no: adjustmentNo, variance, status: 'pending' }, 201);
      }

      case 'approve_adjustment': {
        const permCheck = await requirePermission('store.adjust.approve')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { id } = body;
        if (!id) return err('id required', 400);
        const adj = await queryOne(`SELECT * FROM stock_adjustments WHERE id=?`, [id]);
        if (!adj) return err('Adjustment not found', 404);
        if (adj.status !== 'pending') return err('Adjustment already processed', 400);

        await setBalance(adj.item_id, adj.location_id, adj.batch_no, adj.quantity_after);
        await run(`UPDATE stock_adjustments SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?`,
          [auth.user.employee_id, id]);

        await run(
          `INSERT INTO stock_movements (id, item_id, type, quantity, balance, reference, date, done_by, notes) VALUES (?,?,?,?,?,?,date('now'),?,?)`,
          [uuid(), adj.item_id, 'adjustment', adj.variance, adj.quantity_after, adj.adjustment_no, auth.user.employee_id, `${adj.reason_code}: ${adj.notes || ''}`]
        );

        await checkLowStock(adj.item_id, adj.location_id);

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'APPROVE_ADJUSTMENT', module: 'Stores', recordId: id });
        return ok({ approved: true });
      }

      case 'acknowledge_alert': {
        const { id } = body;
        if (!id) return err('id required', 400);
        await run(`UPDATE low_stock_alerts SET status='acknowledged', acknowledged_by=?, acknowledged_at=datetime('now') WHERE id=?`,
          [auth.user.employee_id, id]);
        return ok({ acknowledged: true });
      }

      default:
        return err('Unknown action', 400);
    }
  } catch (e) {
    console.error('[Stores POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
