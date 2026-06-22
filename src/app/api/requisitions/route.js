// src/app/api/requisitions/route.js — Store Requisition Workflow (point 2)
//
// Lifecycle: pending_approval -> approved -> issuing -> closed
//                            \-> rejected
//
// Distinct from purchase_requisitions (buying from suppliers) — this is
// "give me N of item X that's already in the store", with its own
// approval hierarchy and a complete step-by-step audit trail via
// requisition_approvals, beyond what the generic audit_log captures.
//
// GET  ?section=list&status=&department=    -> requisitions list, filterable
// GET  ?section=detail&id=                   -> one requisition with lines + approval history
// GET  ?section=pending_my_approval          -> requisitions awaiting the caller's approval
//
// POST { action: 'create', department, purpose, project_id, priority, lines: [{item_id, quantity}] }
// POST { action: 'approve', id, comments }
// POST { action: 'reject', id, reason }
// POST { action: 'issue_line', requisition_id, item_id, location_id, quantity, batch_no }
// POST { action: 'close', id }

import { v4 as uuid } from 'uuid';
import { requireAuth, requirePermission, requireModuleEnabled, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

// Two-level approval hierarchy by default (configurable via system_settings
// 'requisition_approval_levels'); level 1 = department head / supervisor
// role check is skipped here for simplicity — any user with
// requisitions.approve can act at whichever level is currently open.
const DEFAULT_APPROVAL_LEVELS = ['supervisor', 'store_manager'];
// The approval chain is configurable via System Settings (requisitions.approval_levels).
async function approvalLevels() {
  const lv = await require('../../../lib/settings').getJSON('requisitions.approval_levels', DEFAULT_APPROVAL_LEVELS);
  return Array.isArray(lv) && lv.length ? lv : DEFAULT_APPROVAL_LEVELS;
}

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'list';

  try {
    if (section === 'list') {
      const status = searchParams.get('status');
      const department = searchParams.get('department');
      let sql = `SELECT sr.*, e.first_name||' '||e.last_name as requested_by_name, p.name as project_name,
                        (SELECT COUNT(*) FROM store_requisition_lines l WHERE l.requisition_id=sr.id) as line_count
                 FROM store_requisitions sr
                 LEFT JOIN employees e ON sr.requested_by=e.id
                 LEFT JOIN projects p ON sr.project_id=p.id
                 WHERE 1=1`;
      const params = [];
      if (status) { sql += ` AND sr.status=?`; params.push(status); }
      if (department) { sql += ` AND sr.department=?`; params.push(department); }
      sql += ` ORDER BY sr.created_at DESC`;
      const rows = await query(sql, params);
      return ok(rows);
    }

    if (section === 'detail') {
      const id = searchParams.get('id');
      if (!id) return err('id required', 400);
      const requisition = await queryOne(
        `SELECT sr.*, e.first_name||' '||e.last_name as requested_by_name, p.name as project_name
         FROM store_requisitions sr LEFT JOIN employees e ON sr.requested_by=e.id LEFT JOIN projects p ON sr.project_id=p.id
         WHERE sr.id=?`, [id]
      );
      if (!requisition) return err('Requisition not found', 404);
      const lines = await query(
        `SELECT l.*, i.code as item_code, i.name as item_name, i.unit,
                (SELECT COALESCE(SUM(quantity),0) FROM stock_balances WHERE item_id=i.id) as available_stock
         FROM store_requisition_lines l JOIN items i ON l.item_id=i.id WHERE l.requisition_id=?`, [id]
      );
      const approvals = await query(
        `SELECT ra.*, e.first_name||' '||e.last_name as approver_name
         FROM requisition_approvals ra LEFT JOIN employees e ON ra.approver_id=e.id
         WHERE ra.requisition_id=? ORDER BY ra.decided_at`, [id]
      );
      return ok({ requisition, lines, approvals });
    }

    if (section === 'pending_my_approval') {
      // Any user holding requisitions.approve sees everything pending — kept
      // simple rather than modelling a strict per-level routing table, since
      // QSL's actual hierarchy is small (store manager / FM / MD).
      const rows = await query(
        `SELECT sr.*, e.first_name||' '||e.last_name as requested_by_name,
                (SELECT COUNT(*) FROM store_requisition_lines l WHERE l.requisition_id=sr.id) as line_count
         FROM store_requisitions sr LEFT JOIN employees e ON sr.requested_by=e.id
         WHERE sr.status='pending_approval' ORDER BY sr.priority DESC, sr.created_at`
      );
      return ok(rows);
    }

    return err('Unknown section', 400);
  } catch (e) {
    console.error('[Requisitions GET]', e);
    return err('Server error', 500);
  }
}

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {

      case 'create': {
        const permCheck = await requirePermission('requisitions.create')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { department, purpose, project_id, priority, lines } = body;
        if (!department || !purpose) return err('department and purpose required', 400);
        if (!Array.isArray(lines) || lines.length === 0) return err('lines[] required — at least one item', 400);

        const reqNo = `SREQ-${Date.now().toString().slice(-8)}`;
        const id = uuid();
        const levels = await approvalLevels();
        await run(
          `INSERT INTO store_requisitions (id, req_no, requested_by, department, purpose, project_id, priority, status, current_approver_role)
           VALUES (?,?,?,?,?,?,?,'pending_approval',?)`,
          [id, reqNo, auth.user.employee_id, department, purpose, project_id || null, priority || 'normal', levels[0]]
        );

        for (const line of lines) {
          if (!line.item_id || !line.quantity) continue;
          await run(
            `INSERT INTO store_requisition_lines (id, requisition_id, item_id, quantity_requested, batch_no) VALUES (?,?,?,?,?)`,
            [uuid(), id, line.item_id, line.quantity, line.batch_no || null]
          );
        }

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_REQUISITION', module: 'Requisitions', recordId: id, newValue: { reqNo, line_count: lines.length } });
        return ok({ id, req_no: reqNo, status: 'pending_approval' }, 201);
      }

      case 'approve': {
        const permCheck = await requirePermission('requisitions.approve')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { id, comments } = body;
        if (!id) return err('id required', 400);
        const reqRow = await queryOne(`SELECT * FROM store_requisitions WHERE id=?`, [id]);
        if (!reqRow) return err('Requisition not found', 404);
        if (reqRow.status !== 'pending_approval') return err(`Cannot approve — current status is ${reqRow.status}`, 400);

        const levels = await approvalLevels();
        await run(
          `INSERT INTO requisition_approvals (id, requisition_id, level, approver_id, decision, comments) VALUES (?,?,?,?,'approved',?)`,
          [uuid(), id, reqRow.current_approver_role || levels[0], auth.user.employee_id, comments || null]
        );

        const currentLevelIdx = levels.indexOf(reqRow.current_approver_role);
        const nextLevel = levels[currentLevelIdx + 1];

        if (nextLevel) {
          await run(`UPDATE store_requisitions SET current_approver_role=? WHERE id=?`, [nextLevel, id]);
          await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REQUISITION_APPROVED_LEVEL', module: 'Requisitions', recordId: id, newValue: { next_level: nextLevel } });
          return ok({ approved: true, status: 'pending_approval', next_approver_role: nextLevel });
        } else {
          await run(`UPDATE store_requisitions SET status='approved' WHERE id=?`, [id]);
          await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REQUISITION_FULLY_APPROVED', module: 'Requisitions', recordId: id });

          // Point 6: controlled inter-module integration — if enabled, check
          // whether stock on hand can fully cover the requisition; if not,
          // auto-create a Purchase Requisition for the shortfall.
          const integration = await queryOne(
            `SELECT * FROM module_integrations WHERE source_module='store_requisitions' AND target_module='procurement' AND trigger_event='insufficient_stock' AND enabled=1`
          );
          let pr_created = false;
          if (integration) {
            const lines = await query(`SELECT * FROM store_requisition_lines WHERE requisition_id=?`, [id]);
            for (const line of lines) {
              const stockRow = await queryOne(`SELECT COALESCE(SUM(quantity),0) as total FROM stock_balances WHERE item_id=?`, [line.item_id]);
              if ((stockRow?.total || 0) < line.quantity_requested) {
                const item = await queryOne(`SELECT * FROM items WHERE id=?`, [line.item_id]);
                const prNo = `PR-${Date.now().toString().slice(-8)}`;
                await run(
                  `INSERT INTO purchase_requisitions (id, pr_no, description, department, requested_by, amount, purpose, status)
                   VALUES (?,?,?,?,?,?,?, 'draft')`,
                  [uuid(), prNo, `Shortfall for ${item?.name || line.item_id} — Store Requisition ${reqRow.req_no}`, reqRow.department, auth.user.employee_id, (item?.unit_cost || 0) * line.quantity_requested, `Auto-generated: insufficient stock for ${reqRow.req_no}`]
                );
                pr_created = true;
              }
            }
          }

          return ok({ approved: true, status: 'approved', pr_created });
        }
      }

      case 'reject': {
        const permCheck = await requirePermission('requisitions.approve')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { id, reason } = body;
        if (!id || !reason) return err('id and reason required', 400);
        const reqRow = await queryOne(`SELECT * FROM store_requisitions WHERE id=?`, [id]);
        if (!reqRow) return err('Requisition not found', 404);
        if (!['pending_approval'].includes(reqRow.status)) return err(`Cannot reject — current status is ${reqRow.status}`, 400);

        await run(`UPDATE store_requisitions SET status='rejected', rejected_by=?, rejected_at=datetime('now'), rejection_reason=? WHERE id=?`,
          [auth.user.employee_id, reason, id]);
        await run(
          `INSERT INTO requisition_approvals (id, requisition_id, level, approver_id, decision, comments) VALUES (?,?,?,?,'rejected',?)`,
          [uuid(), id, reqRow.current_approver_role || 'unknown', auth.user.employee_id, reason]
        );

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REQUISITION_REJECTED', module: 'Requisitions', recordId: id, newValue: { reason } });
        return ok({ rejected: true });
      }

      case 'issue_line': {
        const permCheck = await requirePermission('store.issue')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { requisition_id, item_id, location_id, quantity, batch_no } = body;
        if (!requisition_id || !item_id || !location_id || !quantity) return err('requisition_id, item_id, location_id, quantity required', 400);

        const reqRow = await queryOne(`SELECT * FROM store_requisitions WHERE id=?`, [requisition_id]);
        if (!reqRow) return err('Requisition not found', 404);
        if (!['approved', 'issuing'].includes(reqRow.status)) return err(`Cannot issue — requisition status is ${reqRow.status}`, 400);

        const balanceRow = await queryOne(
          `SELECT quantity FROM stock_balances WHERE item_id=? AND location_id=? AND ${batch_no ? 'batch_no=?' : 'batch_no IS NULL'}`,
          batch_no ? [item_id, location_id, batch_no] : [item_id, location_id]
        );
        const available = balanceRow?.quantity || 0;
        if (available < quantity) return err(`Insufficient stock — available: ${available}`, 400);

        const newBalance = available - Number(quantity);
        if (balanceRow) {
          await run(`UPDATE stock_balances SET quantity=?, updated_at=datetime('now') WHERE item_id=? AND location_id=? AND ${batch_no ? 'batch_no=?' : 'batch_no IS NULL'}`,
            batch_no ? [newBalance, item_id, location_id, batch_no] : [newBalance, item_id, location_id]);
        }

        await run(
          `INSERT INTO stock_movements (id, item_id, type, quantity, balance, reference, project_id, date, done_by, notes)
           VALUES (?,?,?,?,?,?,?,date('now'),?,?)`,
          [uuid(), item_id, 'issue', -quantity, newBalance, reqRow.req_no, reqRow.project_id, auth.user.employee_id, `Issued against requisition ${reqRow.req_no}`]
        );

        const line = await queryOne(`SELECT * FROM store_requisition_lines WHERE requisition_id=? AND item_id=?`, [requisition_id, item_id]);
        if (line) {
          await run(`UPDATE store_requisition_lines SET quantity_issued=? WHERE id=?`, [(line.quantity_issued || 0) + Number(quantity), line.id]);
        }

        if (reqRow.status === 'approved') {
          await run(`UPDATE store_requisitions SET status='issuing' WHERE id=?`, [requisition_id]);
        }

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'ISSUE_REQUISITION_LINE', module: 'Requisitions', recordId: requisition_id, newValue: { item_id, quantity } });
        return ok({ issued: true, new_balance: newBalance });
      }

      case 'close': {
        const permCheck = await requirePermission('requisitions.approve')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { id } = body;
        if (!id) return err('id required', 400);
        const reqRow = await queryOne(`SELECT * FROM store_requisitions WHERE id=?`, [id]);
        if (!reqRow) return err('Requisition not found', 404);

        const lines = await query(`SELECT * FROM store_requisition_lines WHERE requisition_id=?`, [id]);
        const fullyIssued = lines.every(l => (l.quantity_issued || 0) >= l.quantity_requested);
        if (!fullyIssued) {
          return err('Cannot close — not all lines have been fully issued. Issue remaining quantities first, or close anyway is not permitted for audit integrity.', 400);
        }

        await run(`UPDATE store_requisitions SET status='closed', closed_at=datetime('now') WHERE id=?`, [id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REQUISITION_CLOSED', module: 'Requisitions', recordId: id });
        return ok({ closed: true });
      }

      default:
        return err('Unknown action', 400);
    }
  } catch (e) {
    console.error('[Requisitions POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
