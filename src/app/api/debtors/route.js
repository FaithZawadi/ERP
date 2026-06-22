// src/app/api/debtors/route.js — Daily Debtors List + FM End-of-Day Followup API
//
// GET  ?section=list              → aged debtors list (used for daily MD/FM circulation)
// GET  ?section=today_status      → today's followup status per debtor + EOD report state
// POST { action: 'record_followup', client_id, status, note, next_followup_date }
// POST { action: 'submit_eod_report' }  → FM closes out the day, triggers MD email

import { v4 as uuid } from 'uuid';
import { requireAuth, requireRole, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

const FOLLOWUP_STATUSES = ['Promised Payment', 'Disputed', 'Escalated', 'No Response', 'Partially Paid', 'Settled'];

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'list';
  const today = new Date().toISOString().split('T')[0];

  try {
    if (section === 'list') {
      const debtors = await query(
        `SELECT c.*, e.first_name||' '||e.last_name as account_owner_name, e.email as account_owner_email
         FROM clients c LEFT JOIN employees e ON c.account_owner=e.id
         WHERE c.outstanding > 0 ORDER BY c.outstanding DESC`
      );
      // relationship_days computed in JS rather than SQL (julianday() is
      // SQLite-only; this keeps the query portable across both backends
      // without needing per-dialect date arithmetic).
      const now = Date.now();
      const withDays = debtors.map(d => ({
        ...d,
        relationship_days: d.created_at ? Math.floor((now - new Date(d.created_at).getTime()) / 86400000) : null,
      }));
      return ok(withDays);
    }

    if (section === 'today_status') {
      const debtors = await query(
        `SELECT c.id, c.name, c.outstanding, c.contact_person, c.email,
                df.status, df.note, df.next_followup_date, df.created_at as recorded_at
         FROM clients c
         LEFT JOIN debtor_followups df ON df.client_id=c.id AND df.followup_date=?
         WHERE c.outstanding > 0
         ORDER BY c.outstanding DESC`,
        [today]
      );
      const eodReport = await queryOne(`SELECT * FROM eod_debtor_reports WHERE report_date=?`, [today]);
      const totalDebtors  = debtors.length;
      const recordedCount = debtors.filter(d => d.status).length;
      return ok({
        debtors,
        eod_report: eodReport || { report_date: today, status: 'pending' },
        total_debtors: totalDebtors,
        recorded_count: recordedCount,
        all_recorded: totalDebtors > 0 && recordedCount === totalDebtors,
      });
    }

    if (section === 'history') {
      const client_id = searchParams.get('client_id');
      if (!client_id) return err('client_id required', 400);
      const history = await query(
        `SELECT df.*, e.first_name||' '||e.last_name as recorded_by_name
         FROM debtor_followups df LEFT JOIN employees e ON df.recorded_by=e.id
         WHERE df.client_id=? ORDER BY df.followup_date DESC LIMIT 30`,
        [client_id]
      );
      return ok(history);
    }

    if (section === 'statuses') {
      return ok(FOLLOWUP_STATUSES);
    }

    return err('Unknown section', 400);
  } catch (e) {
    console.error('[Debtors GET]', e);
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
  const today = new Date().toISOString().split('T')[0];

  try {
    switch (action) {

      case 'record_followup': {
        const { client_id, status, note, next_followup_date } = body;
        if (!client_id || !status) return err('client_id and status required', 400);
        if (!FOLLOWUP_STATUSES.includes(status)) return err(`status must be one of: ${FOLLOWUP_STATUSES.join(', ')}`, 400);

        const client = await queryOne(`SELECT * FROM clients WHERE id=?`, [client_id]);
        if (!client) return err('Client not found', 404);

        const existing = await queryOne(
          `SELECT id FROM debtor_followups WHERE client_id=? AND followup_date=?`, [client_id, today]
        );

        if (existing) {
          await run(
            `UPDATE debtor_followups SET status=?, note=?, next_followup_date=?, recorded_by=? WHERE id=?`,
            [status, note || null, next_followup_date || null, auth.user.employee_id, existing.id]
          );
        } else {
          await run(
            `INSERT INTO debtor_followups (id, client_id, followup_date, status, note, next_followup_date, recorded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuid(), client_id, today, status, note || null, next_followup_date || null, auth.user.employee_id]
          );
        }

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'RECORD_DEBTOR_FOLLOWUP', module: 'Debtors',
          recordId: client_id, newValue: { status, note, client_name: client.name },
        });

        return ok({ recorded: true, client_id, status });
      }

      case 'submit_eod_report': {
        // Only FM (or admin/md as fallback) can submit
        const roleCheck = await requireRole('cfo', 'admin', 'md')(req);
        if (roleCheck.error) return err('Only the Finance Manager can submit the end-of-day report', 403);

        const debtors = await query(`SELECT id FROM clients WHERE outstanding > 0`);
        const recorded = await query(
          `SELECT client_id FROM debtor_followups WHERE followup_date=?`, [today]
        );
        const recordedIds = new Set(recorded.map(r => r.client_id));
        const missing = debtors.filter(d => !recordedIds.has(d.id));

        if (missing.length > 0) {
          return err(`${missing.length} debtor(s) still need a status entry before the report can be submitted`, 400);
        }

        const existing = await queryOne(`SELECT id FROM eod_debtor_reports WHERE report_date=?`, [today]);
        if (existing) {
          await run(
            `UPDATE eod_debtor_reports SET submitted_by=?, submitted_at=datetime('now'), status='submitted' WHERE id=?`,
            [auth.user.employee_id, existing.id]
          );
        } else {
          await run(
            `INSERT INTO eod_debtor_reports (id, report_date, submitted_by, submitted_at, status)
             VALUES (?, ?, ?, datetime('now'), 'submitted')`,
            [uuid(), today, auth.user.employee_id]
          );
        }

        // Compile and send the report to MD immediately
        let email_sent = false;
        try {
          const { compileAndSendEODReport } = require('../../../lib/scheduler');
          await compileAndSendEODReport(today);
          email_sent = true;
        } catch (emailErr) {
          console.error('[EOD report email]', emailErr.message);
        }

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'SUBMIT_EOD_DEBTOR_REPORT', module: 'Debtors',
          newValue: { report_date: today, debtor_count: debtors.length },
        });

        return ok({ submitted: true, report_date: today, debtor_count: debtors.length, email_sent });
      }

      default:
        return err('Unknown action', 400);
    }
  } catch (e) {
    console.error('[Debtors POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
