// src/app/api/compliance/route.js — Compliance, HSE & Governance API

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';
import { STATUTORY_OBLIGATIONS, getNextDueDate } from '../../../lib/tax';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'dashboard';

  try {
    switch (section) {
      case 'dashboard': {
        const docs     = await query(`SELECT * FROM compliance_docs ORDER BY expires_at`);
        const tasks    = await query(`SELECT * FROM tasks WHERE status IN ('pending','in_progress') ORDER BY due_date`);
        const policies = await query(`SELECT pd.*, COUNT(ps.id) as sign_count FROM policy_docs pd LEFT JOIN policy_signoffs ps ON ps.policy_id=pd.id GROUP BY pd.id ORDER BY pd.category`);
        const calendar = STATUTORY_OBLIGATIONS.map(o=>({...o, next_due: getNextDueDate(o)||'Annual'}));
        const [expiring] = await query(`SELECT COUNT(*) as count FROM compliance_docs WHERE expires_at <= date('now','+60 days') AND status='current'`);
        return ok({ docs, tasks, policies, calendar, expiring_count: expiring?.count||0 });
      }

      case 'docs': {
        return ok(await query(`SELECT cd.*, e.first_name||' '||e.last_name as responsible_name FROM compliance_docs cd LEFT JOIN employees e ON cd.responsible=e.id ORDER BY cd.expires_at`));
      }

      case 'policies': {
        const rows = await query(
          `SELECT pd.*, e.first_name||' '||e.last_name as owner_name,
                  COUNT(ps.id) as signed_count,
                  (SELECT COUNT(*) FROM employees WHERE status='active') as total_staff
           FROM policy_docs pd
           LEFT JOIN employees e ON pd.owner=e.id
           LEFT JOIN policy_signoffs ps ON ps.policy_id=pd.id
           GROUP BY pd.id ORDER BY pd.category, pd.code`
        );
        return ok(rows);
      }

      case 'policy_signoffs': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const rows = await query(
          `SELECT ps.*, e.first_name||' '||e.last_name as employee_name, e.department
           FROM policy_signoffs ps JOIN employees e ON ps.employee_id=e.id
           WHERE ps.policy_id=? ORDER BY ps.signed_at`,
          [id]
        );
        const allEmployees = await query(`SELECT id, first_name||' '||last_name as name, department FROM employees WHERE status='active'`);
        const signedIds    = new Set(rows.map(r=>r.employee_id));
        return ok({
          signed:  rows,
          pending: allEmployees.filter(e=>!signedIds.has(e.id)),
        });
      }

      case 'calendar':
        return ok(STATUTORY_OBLIGATIONS.map(o=>({...o, next_due: getNextDueDate(o)||'Annual'})));

      case 'tasks':
        return ok(await query(`SELECT t.*, e.first_name||' '||e.last_name as assignee_name FROM tasks t LEFT JOIN employees e ON t.assignee_id=e.id ORDER BY t.due_date`));

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Compliance GET]', e);
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
      case 'renew_cert': {
        const { doc_id, new_expiry, ref_no } = body;
        if (!doc_id || !new_expiry) return err('doc_id and new_expiry required', 400);
        await run(`UPDATE compliance_docs SET expires_at=?, ref_no=?, status='current' WHERE id=?`, [new_expiry, ref_no, doc_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'RENEW_CERT', module: 'Compliance', recordId: doc_id, newValue: { new_expiry } });
        return ok({ renewed: true });
      }

      case 'send_expiry_alerts': {
        // Send email alerts for docs expiring within 60 days
        const expiring = await query(
          `SELECT cd.*, e.first_name||' '||e.last_name as responsible_name, e.email as responsible_email
           FROM compliance_docs cd LEFT JOIN employees e ON cd.responsible=e.id
           WHERE cd.expires_at <= date('now','+60 days') AND cd.status='current'`
        );
        if (expiring.length === 0) return ok({ sent: false, message: 'No documents expiring within 60 days' });

        // Group by responsible person
        const byPerson = expiring.reduce((acc, doc) => {
          const key = doc.responsible_email || 'admin';
          if (!acc[key]) acc[key] = [];
          acc[key].push(doc);
          return acc;
        }, {});

        let sent = 0;
        try {
          const { sendComplianceAlert } = require('../../../lib/email');
          for (const [email, docs] of Object.entries(byPerson)) {
            if (email !== 'admin') { await sendComplianceAlert(docs, email); sent++; }
          }
          // Also send summary to ICT/Admin
          const adminEmail = process.env.SMTP_USER || '';
          if (adminEmail) { await sendComplianceAlert(expiring, adminEmail); }
        } catch (emailErr) {
          console.error('[Compliance email]', emailErr.message);
        }

        return ok({ sent: true, expiring_count: expiring.length, emails_sent: sent });
      }

      case 'upload_document': {
        // Handle file upload for compliance documents
        try {
          const { parseFormData } = require('../../../lib/upload');
          const { fields, file } = await parseFormData(req, { category: 'policies' });
          if (!file) return err('No file provided', 400);
          if (fields.doc_id) {
            await run(`UPDATE compliance_docs SET doc_path=? WHERE id=?`, [file.url, fields.doc_id]);
          }
          return ok({ uploaded: true, file_url: file.url, file_name: file.original_name });
        } catch (uploadErr) {
          return err('Upload failed: ' + uploadErr.message, 500);
        }
      }

      case 'add_cert': {
        const { name, type, issuer, expires_at, responsible } = body;
        if (!name || !type) return err('name and type required', 400);
        const id = uuid();
        await run(`INSERT INTO compliance_docs (id,name,type,issuer,expires_at,responsible,status) VALUES (?,?,?,?,?,?,'current')`,
          [id, name, type, issuer, expires_at, responsible]);
        return ok({ id }, 201);
      }

      case 'sign_policy': {
        const { policy_id, employee_id, sig_key } = body;
        if (!policy_id || !employee_id) return err('policy_id and employee_id required', 400);
        const existing = await queryOne(`SELECT id FROM policy_signoffs WHERE policy_id=? AND employee_id=?`, [policy_id, employee_id]);
        if (existing) return err('Already signed', 409);
        await run(`INSERT INTO policy_signoffs (id,policy_id,employee_id,signed_at,sig_key) VALUES (?,?,?,datetime('now'),?)`,
          [uuid(), policy_id, employee_id, sig_key]);
        return ok({ signed: true });
      }

      case 'create_task': {
        const { title, assignee_id, due_date, priority, module } = body;
        if (!title || !assignee_id || !due_date) return err('title, assignee_id, due_date required', 400);
        const id = uuid();
        await run(`INSERT INTO tasks (id,title,assignee_id,due_date,priority,module,status,created_by) VALUES (?,?,?,?,?,?,'pending',?)`,
          [id, title, assignee_id, due_date, priority||'medium', module||'General', auth.user.employee_id]);
        return ok({ id }, 201);
      }

      case 'complete_task': {
        const { task_id } = body;
        if (!task_id) return err('task_id required', 400);
        await run(`UPDATE tasks SET status='completed', completed_at=datetime('now') WHERE id=?`, [task_id]);
        return ok({ completed: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Compliance POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
