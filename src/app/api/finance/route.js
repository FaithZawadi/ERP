// src/app/api/finance/route.js — Finance Module API

import { NextResponse } from 'next/server';
import { v4 as uuid }   from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';
import { calculatePayslip, calculateVAT } from '../../../lib/tax';

// ── GET /api/finance?section=imprest|payroll|gl|stats ────────────────────────

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'stats';
  const page    = parseInt(searchParams.get('page')  || '1');
  const limit   = parseInt(searchParams.get('limit') || '50');
  const status  = searchParams.get('status');
  const period  = searchParams.get('period');

  try {
    switch (section) {

      case 'stats': {
        const [imprestStats] = await query(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status='OVERDUE' THEN 1 ELSE 0 END) as overdue,
            SUM(CASE WHEN status='CONVERTED' THEN 1 ELSE 0 END) as converted,
            SUM(amount) as total_amount,
            SUM(CASE WHEN status IN ('OVERDUE','CONVERTED') THEN amount ELSE 0 END) as at_risk_amount
          FROM imprest`
        );
        const payrollRun = await queryOne(
          `SELECT * FROM payroll_runs ORDER BY created_at DESC LIMIT 1`
        );
        return ok({ imprest: imprestStats, payroll: payrollRun });
      }

      case 'imprest': {
        let sql    = `SELECT i.*, e.first_name||' '||e.last_name as employee_name, e.department
                      FROM imprest i JOIN employees e ON i.employee_id=e.id`;
        const params = [];
        if (status) { sql += ` WHERE i.status=?`; params.push(status); }
        sql += ` ORDER BY i.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, (page - 1) * limit);
        const rows = await query(sql, params);
        return ok(rows);
      }

      case 'payroll': {
        if (period) {
          const run     = await queryOne(`SELECT * FROM payroll_runs WHERE period=?`, [period]);
          if (!run) return err('Payroll run not found', 404);
          const entries = await query(
            `SELECT pe.*, e.first_name||' '||e.last_name as name, e.department, e.role
             FROM payroll_entries pe JOIN employees e ON pe.employee_id=e.id
             WHERE pe.run_id=?`, [run.id]
          );
          return ok({ run, entries });
        }
        const runs = await query(`SELECT * FROM payroll_runs ORDER BY period DESC LIMIT 24`);
        return ok(runs);
      }

      case 'gl': {
        const entries = await query(
          `SELECT je.*, e.first_name||' '||e.last_name as prepared_by_name
           FROM journal_entries je
           LEFT JOIN employees e ON je.prepared_by=e.id
           ORDER BY je.date DESC LIMIT ? OFFSET ?`,
          [limit, (page - 1) * limit]
        );
        return ok(entries);
      }

      case 'accounts': {
        const accounts = await query(
          `SELECT * FROM chart_of_accounts WHERE is_active=1 ORDER BY code`
        );
        return ok(accounts);
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Finance GET]', e);
    return err('Server error', 500);
  }
}

// ── POST /api/finance ─────────────────────────────────────────────────────────

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {

      // ── Create imprest request ───────────────────────────────────────────
      case 'create_imprest': {
        const { employee_id, amount, purpose } = body;
        if (!employee_id || !amount || !purpose)
          return err('employee_id, amount and purpose required', 400);
        if (amount <= 0) return err('Amount must be positive', 400);

        const retireDays = await require('../../../lib/settings').getInt('finance.imprest_retire_days', 14);
        const issued   = new Date().toISOString().split('T')[0];
        const due      = new Date(Date.now() + retireDays * 86400000).toISOString().split('T')[0];
        const ref_no   = `IMP-${Date.now()}`;
        const id       = uuid();

        await run(
          `INSERT INTO imprest (id,ref_no,employee_id,amount,purpose,date_issued,due_date,status)
           VALUES (?,?,?,?,?,?,?,?)`,
          [id, ref_no, employee_id, amount, purpose, issued, due, 'pending']
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'CREATE_IMPREST', module: 'Finance',
          recordId: id, newValue: { amount, purpose, due },
        });

        return ok({ id, ref_no, due_date: due }, 201);
      }

      // ── Check & convert overdue imprest ──────────────────────────────────
      case 'check_overdue_imprest': {
        const today = new Date().toISOString().split('T')[0];
        const overdue = await query(
          `SELECT * FROM imprest WHERE due_date < ? AND status='pending'`, [today]
        );

        const converted = [];
        for (const imp of overdue) {
          await run(
            `UPDATE imprest SET status='OVERDUE', converted_to_advance=1, converted_at=? WHERE id=?`,
            [new Date().toISOString(), imp.id]
          );
          converted.push(imp.id);
          await logAudit(query, {
            userId: 'SYSTEM', userName: 'System',
            action: 'CONVERT_IMPREST_OVERDUE', module: 'Finance',
            recordId: imp.id, oldValue: { status: 'pending' }, newValue: { status: 'OVERDUE' },
          });
        }
        return ok({ converted_count: converted.length, ids: converted });
      }

      // ── Create payroll run ────────────────────────────────────────────────
      case 'create_payroll': {
        const { period } = body;
        if (!period) return err('period required (YYYY-MM)', 400);

        const existing = await queryOne(`SELECT id FROM payroll_runs WHERE period=?`, [period]);
        if (existing) return err('Payroll run already exists for this period', 409);

        const employees = await query(
          `SELECT * FROM employees WHERE status='active'`
        );

        // Calculate payslips for all active employees
        const entries = employees.map(e => {
          const ps = calculatePayslip({
            basic_salary: e.basic_salary,
            allowances:   0,
          });
          return { ...ps, employee_id: e.id, id: uuid() };
        });

        const totals = entries.reduce((acc, e) => {
          acc.gross  += e.gross_pay;
          acc.paye   += e.paye;
          acc.nhif   += e.nhif;
          acc.nssf   += e.nssf;
          acc.housing += e.housing_levy;
          acc.net    += e.net_pay;
          return acc;
        }, { gross: 0, paye: 0, nhif: 0, nssf: 0, housing: 0, net: 0 });

        const runId = uuid();
        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO payroll_runs (id,period,status,total_gross,total_paye,total_nhif,total_nssf,total_housing,total_net)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [runId, period, 'draft', totals.gross, totals.paye, totals.nhif, totals.nssf, totals.housing, totals.net]
          );
          for (const e of entries) {
            await dbRun(
              `INSERT INTO payroll_entries (id,run_id,employee_id,basic_salary,gross_pay,paye,nhif,nssf,housing_levy,net_pay)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
              [e.id, runId, e.employee_id, e.basic_salary||0, e.gross_pay, e.paye, e.nhif, e.nssf, e.housing_levy, e.net_pay]
            );
          }
        });

        return ok({ run_id: runId, period, entries_count: entries.length, totals }, 201);
      }

      // ── Sign payroll ──────────────────────────────────────────────────────
      case 'sign_payroll': {
        const { run_id, signer_role, signature_key } = body;
        if (!run_id || !signer_role) return err('run_id and signer_role required', 400);

        const run_row = await queryOne(`SELECT * FROM payroll_runs WHERE id=?`, [run_id]);
        if (!run_row) return err('Payroll run not found', 404);
        if (run_row.status === 'locked') return err('Payroll is already locked', 409);

        const now = new Date().toISOString();
        let update = '';
        let newStatus = run_row.status;

        if (signer_role === 'fm' && !run_row.fm_sig) {
          update = `fm_sig=?, fm_signed_at=?, status='fm_signed'`;
          newStatus = 'fm_signed';
        } else if (signer_role === 'cfo' && run_row.fm_sig && !run_row.cfo_sig) {
          update = `cfo_sig=?, cfo_signed_at=?, status='cfo_signed'`;
          newStatus = 'cfo_signed';
        } else if (signer_role === 'md' && run_row.cfo_sig && !run_row.md_sig) {
          update = `md_sig=?, md_signed_at=?, status='locked', locked_at=?`;
          newStatus = 'locked';
        } else {
          return err('Invalid signing sequence or role', 400);
        }

        await run(
          `UPDATE payroll_runs SET ${update} WHERE id=?`,
          newStatus === 'locked'
            ? [signature_key, now, now, run_id]
            : [signature_key, now, run_id]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: `SIGN_PAYROLL_${signer_role.toUpperCase()}`, module: 'Finance',
          recordId: run_id, newValue: { signer_role, status: newStatus },
        });

        // After MD signs (payroll locked) → send payslips to all employees
        let payslips_sent = 0;
        if (newStatus === 'locked') {
          try {
            const { sendPayslip } = require('../../../lib/email');
            const entries = await query(
              `SELECT pe.*, e.first_name||' '||e.last_name as name, e.email
               FROM payroll_entries pe JOIN employees e ON pe.employee_id=e.id
               WHERE pe.run_id=?`, [run_id]
            );
            for (const entry of entries) {
              if (entry.email) {
                await sendPayslip(entry, entry, run_row.period);
                payslips_sent++;
              }
            }
          } catch (emailErr) {
            console.error('[Payroll email]', emailErr.message);
          }
        }

        return ok({ signed: true, status: newStatus, signed_at: now, payslips_sent });
      }

      // ── Journal entry ─────────────────────────────────────────────────────
      case 'create_journal': {
        const { date, description, reference, lines } = body;
        if (!date || !description || !lines?.length)
          return err('date, description and lines required', 400);

        // Validate debit = credit
        const totalDebit  = lines.reduce((s, l) => s + (l.debit  || 0), 0);
        const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01)
          return err(`Journal not balanced: debits ${totalDebit} ≠ credits ${totalCredit}`, 400);

        const entryId  = uuid();
        const entry_no = `JV-${Date.now()}`;

        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO journal_entries (id,entry_no,date,description,reference,prepared_by,status)
             VALUES (?,?,?,?,?,?,'draft')`,
            [entryId, entry_no, date, description, reference, auth.user.employee_id]
          );
          for (const l of lines) {
            await dbRun(
              `INSERT INTO journal_lines (id,entry_id,account_id,description,debit,credit,dept,project_id)
               VALUES (?,?,?,?,?,?,?,?)`,
              [uuid(), entryId, l.account_id, l.description||'', l.debit||0, l.credit||0, l.dept||'', l.project_id||'']
            );
          }
        });

        return ok({ entry_id: entryId, entry_no }, 201);
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Finance POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}

// ── PUT /api/finance — update records ─────────────────────────────────────────

export async function PUT(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action, id } = body;
  if (!id) return err('id required', 400);

  try {
    switch (action) {
      case 'account_imprest': {
        const { amount_accounted, receipt_path } = body;
        await run(
          `UPDATE imprest SET amount_accounted=?, receipt_path=?, status='accounted', updated=datetime('now') WHERE id=?`,
          [amount_accounted, receipt_path, id]
        );
        return ok({ updated: true });
      }

      case 'upload_receipt': {
        // Upload receipt for imprest or payment voucher
        try {
          const { parseFormData } = require('../../../lib/upload');
          const { fields, file } = await parseFormData(req, { category: 'receipts' });
          if (!file) return err('No file provided', 400);
          const docType = fields.doc_type || 'imprest';
          if (docType === 'imprest') {
            await run(`UPDATE imprest SET receipt_path=? WHERE id=?`, [file.url, id]);
          } else if (docType === 'voucher') {
            await run(`UPDATE payment_vouchers SET reference=? WHERE id=?`, [file.url, id]);
          }
          return ok({ uploaded: true, file_url: file.url, file_name: file.original_name });
        } catch (uploadErr) {
          return err('Upload failed: ' + uploadErr.message, 500);
        }
      }

      default:
        return err('Unknown action', 400);
    }
  } catch (e) {
    return err('Server error', 500);
  }
}
