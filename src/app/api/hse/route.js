// src/app/api/hse/route.js — Health, Safety & Environment.
//
// This module previously had NO backend at all — the frontend HSE
// component held incidents in a hardcoded useState array (three fake
// records, reset on every page load), and RAMS/PPE were literal arrays
// baked into the JSX with no data source and no-op buttons. The
// hse.report_incident / hse.view / hse.manage permissions (migrate-v10)
// pointed at nothing real. This is the actual implementation:
//
// GET  ?section=incidents               -> incident register
// GET  ?section=rams                    -> one row per active project,
//                                          joined against real projects —
//                                          not a fixed fake project list
// GET  ?section=ppe                     -> PPE stock, pulled from the real
//                                          Stores inventory (category
//                                          CAT-005) rather than a second,
//                                          parallel PPE tracking table
//
// POST { action: 'report_incident', ... }
// POST { action: 'update_incident_status', incident_id, status, capa }
// POST { action: 'file_rams', project_id, file_name, file_data }
// POST { action: 'approve_rams', rams_id }

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'incidents';

  try {
    if (section === 'incidents') {
      const rows = await query(
        `SELECT hi.*, e.first_name||' '||e.last_name as reported_by_name, p.name as project_name
         FROM hse_incidents hi
         LEFT JOIN employees e ON hi.reported_by=e.id
         LEFT JOIN projects p ON hi.project_id=p.id
         ORDER BY hi.created_at DESC LIMIT 200`
      );
      return ok(rows);
    }

    // HSE-002: RAMS upload mandatory before site mobilisation. One row per
    // active project — LEFT JOINed against rams_records so a project with
    // no filing at all still shows up as "Not Filed" rather than being
    // silently absent, which is the whole point of this screen.
    if (section === 'rams') {
      const rows = await query(
        `SELECT p.id as project_id, p.ref_no, p.name as project_name, p.status as project_status,
                r.id as rams_id, r.status as rams_status, r.filed_date, r.file_url, r.approved_by,
                e.first_name||' '||e.last_name as approved_by_name
         FROM projects p
         LEFT JOIN rams_records r ON r.project_id = p.id
           AND r.id = (SELECT id FROM rams_records WHERE project_id=p.id ORDER BY created_at DESC LIMIT 1)
         LEFT JOIN employees e ON r.approved_by=e.id
         WHERE p.status='active'
         ORDER BY p.name`
      );
      return ok(rows.map(r => ({ ...r, rams_status: r.rams_status || 'not_filed' })));
    }

    // PPE is real store inventory (category CAT-005), not a second
    // tracking system — "Low — Reorder" is driven off the item's actual
    // reorder_level, the same threshold Stores itself uses.
    if (section === 'ppe') {
      const rows = await query(
        `SELECT i.id, i.code, i.name, i.reorder_level,
                COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE item_id=i.id), 0) as quantity
         FROM items i JOIN item_categories c ON i.category_id=c.id
         WHERE c.code='CAT-005' AND i.is_active=1
         ORDER BY i.name`
      );
      return ok(rows);
    }

    return err('Unknown section', 400);
  } catch (e) {
    console.error('HSE GET error:', e);
    return err('Something went wrong', 500);
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
      case 'report_incident': {
        const { type, site, description, severity, project_id } = body;
        if (!type || !site || !description) return err('type, site and description are required', 400);

        const id = uuid();
        const year = new Date().getFullYear();
        const refNo = `HSE-${year}-${String(Date.now()).slice(-5)}`;
        await run(
          `INSERT INTO hse_incidents (id,ref_no,type,site,description,severity,status,project_id,reported_by)
           VALUES (?,?,?,?,?,?,'open',?,?)`,
          [id, refNo, type, site, description, severity || 'Low', project_id || null, auth.user.employee_id]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REPORT_HSE_INCIDENT', module: 'HSE', recordId: id, newValue: { ref_no: refNo, type, severity } });
        return ok({ id, ref_no: refNo }, 201);
      }

      case 'update_incident_status': {
        const { incident_id, status, capa } = body;
        if (!incident_id || !status) return err('incident_id and status required', 400);
        if (!['open', 'capa_pending', 'closed'].includes(status)) return err('Invalid status', 400);

        await run(
          `UPDATE hse_incidents SET status=?, capa=?, closed_at=CASE WHEN ?='closed' THEN datetime('now') ELSE closed_at END WHERE id=?`,
          [status, capa || null, status, incident_id]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'UPDATE_HSE_INCIDENT', module: 'HSE', recordId: incident_id, newValue: { status, capa } });
        return ok({ updated: true });
      }

      case 'file_rams': {
        const { project_id, file_name, file_data, notes } = body;
        if (!project_id || !file_data) return err('project_id and file_data are required', 400);

        const project = await queryOne(`SELECT id FROM projects WHERE id=?`, [project_id]);
        if (!project) return err('Project not found', 404);

        const match = /^data:([^;]+);base64,(.+)$/.exec(file_data);
        if (!match) return err('file_data must be a base64 data URL', 400);
        const path = require('path');
        const fs = require('fs');
        const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
        const dir = path.join(UPLOAD_DIR, 'rams');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const buffer = Buffer.from(match[2], 'base64');
        const fname = `${Date.now()}-${(file_name || 'rams').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        fs.writeFileSync(path.join(dir, fname), buffer);

        const id = uuid();
        await run(
          `INSERT INTO rams_records (id,project_id,status,filed_date,file_url,filed_by,notes) VALUES (?,?,'filed',date('now'),?,?,?)`,
          [id, project_id, `/uploads/rams/${fname}`, auth.user.employee_id, notes || null]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'FILE_RAMS', module: 'HSE', recordId: id, newValue: { project_id } });
        return ok({ id, file_url: `/uploads/rams/${fname}` }, 201);
      }

      case 'approve_rams': {
        const { rams_id } = body;
        if (!rams_id) return err('rams_id required', 400);
        await run(`UPDATE rams_records SET status='approved', approved_by=? WHERE id=?`, [auth.user.employee_id, rams_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'APPROVE_RAMS', module: 'HSE', recordId: rams_id });
        return ok({ approved: true });
      }

      default:
        return err('Unknown action', 400);
    }
  } catch (e) {
    console.error('HSE POST error:', e);
    return err('Something went wrong', 500);
  }
}
