// src/app/api/finance/route.js — Finance Module API

import { NextResponse } from 'next/server';
import { v4 as uuid }   from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';
import { calculatePayslip, calculateVAT } from '../../../lib/tax';

// ── PAYMENT AUTHORITY MATRIX (FIN-007) ────────────────────────────────────────
// Approval rank by role. A voucher's amount sets the MINIMUM rank required to
// approve it (thresholds configurable via System Settings, finance.pay_limit_*).
// An approver whose rank is below the requirement is refused — "no overrides
// without escalation". md/admin sit at the top and can approve anything.
const AUTH_RANK = {
  staff:1, store_clerk:1, technician:1, driver:1, fleet_support:1,
  dept_head:2, hr_manager:2, project_manager:2, store_manager:2, procurement_officer:2, fleet_manager:2,
  finance_manager:3, fm:3, accountant:3,
  cfo:4,
  md:5, admin:5,
};
async function paymentLimits() {
  const s = require('../../../lib/settings');
  return {
    staff:     await s.getNum('finance.pay_limit_staff', 5000),
    dept_head: await s.getNum('finance.pay_limit_dept_head', 20000),
    fm:        await s.getNum('finance.pay_limit_finance_mgr', 100000),
    cfo:       await s.getNum('finance.pay_limit_cfo', 500000),
  };
}
// Returns { level, rank } — the authority tier required to approve `amount`.
async function requiredAuthority(amount) {
  const L = await paymentLimits();
  if (amount <= L.staff)     return { level:'staff',     rank:1, limit:L.staff };
  if (amount <= L.dept_head) return { level:'dept_head', rank:2, limit:L.dept_head };
  if (amount <= L.fm)        return { level:'finance_manager', rank:3, limit:L.fm };
  if (amount <= L.cfo)       return { level:'cfo',       rank:4, limit:L.cfo };
  return { level:'md', rank:5, limit:null };
}

// ── MONTH-END CLOSE (FIN-003) ─────────────────────────────────────────────────
const DEFAULT_CLOSE_CHECKLIST = [
  { key:'bank_recon',      label:'Bank reconciliations completed',        done:false },
  { key:'prepayments',     label:'Prepayments reviewed & amortised',      done:false },
  { key:'accruals',        label:'Accruals raised',                       done:false },
  { key:'depreciation',    label:'Monthly depreciation run posted',       done:false },
  { key:'ic_recon',        label:'Inter-company balances reconciled',     done:false },
  { key:'supplier_recon',  label:'Supplier statement reconciliations',    done:false },
];
// A period is locked once its month-end close is finalised — no journals may be
// dated into it (FIN-002 "no manual deletion/alteration of posted periods").
async function periodLocked(date) {
  if (!date) return false;
  const period = String(date).slice(0, 7); // YYYY-MM
  const row = await queryOne(`SELECT status FROM month_end_close WHERE period=?`, [period]);
  return row?.status === 'closed';
}

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

      // ── Accounts payable: 3-way-matched supplier invoices (FIN-006) ──────
      case 'payables': {
        const rows = await query(
          `SELECT si.*, s.name as supplier_name, l.grand_total as lpo_grand_total
           FROM supplier_invoices si
           LEFT JOIN suppliers s ON si.supplier_id=s.id
           LEFT JOIN lpos l ON si.lpo_id=l.id
           ORDER BY si.created_at DESC`
        );
        const [stats] = await query(
          `SELECT COUNT(*) as total,
                  SUM(CASE WHEN status='exception' THEN 1 ELSE 0 END) as exceptions,
                  SUM(CASE WHEN status='matched' THEN 1 ELSE 0 END) as matched,
                  SUM(CASE WHEN status='voucher_created' THEN 1 ELSE 0 END) as paid_path
           FROM supplier_invoices`
        );
        return ok({ stats, invoices: rows });
      }

      // ── Payment vouchers with their required authority level (FIN-007) ───
      case 'vouchers': {
        const rows = await query(
          `SELECT pv.*, e.first_name||' '||e.last_name as approved_by_name
           FROM payment_vouchers pv LEFT JOIN employees e ON pv.approved_by=e.id
           ORDER BY pv.created_at DESC LIMIT ? OFFSET ?`, [limit, (page-1)*limit]
        );
        return ok(rows);
      }

      // ── Payment batches FM→CFO→MD (FIN-008) ──────────────────────────────
      case 'batches': {
        const rows = await query(
          `SELECT b.*, e.first_name||' '||e.last_name as prepared_by_name
           FROM payment_batches b LEFT JOIN employees e ON b.prepared_by=e.id
           ORDER BY b.created_at DESC`
        );
        return ok(rows);
      }

      // ── Journal entries with workflow state (FIN-002) ────────────────────
      case 'journals': {
        const entries = await query(
          `SELECT je.*, p.first_name||' '||p.last_name as prepared_by_name,
                  r.first_name||' '||r.last_name as reviewed_by_name,
                  a.first_name||' '||a.last_name as approved_by_name,
                  (SELECT SUM(debit) FROM journal_lines WHERE entry_id=je.id) as total_debit
           FROM journal_entries je
           LEFT JOIN employees p ON je.prepared_by=p.id
           LEFT JOIN employees r ON je.reviewed_by=r.id
           LEFT JOIN employees a ON je.approved_by=a.id
           ORDER BY je.created_at DESC LIMIT ? OFFSET ?`, [limit, (page-1)*limit]
        );
        return ok(entries);
      }

      // ── Month-end close checklist for a period (FIN-003) ─────────────────
      case 'month_end': {
        const p = period || new Date().toISOString().slice(0,7);
        let row = await queryOne(`SELECT * FROM month_end_close WHERE period=?`, [p]);
        if (!row) return ok({ period:p, status:'not_started', checklist: DEFAULT_CLOSE_CHECKLIST });
        return ok({ ...row, checklist: JSON.parse(row.checklist || '[]') });
      }

      // ── P&L by department from POSTED journals (FIN-001) ─────────────────
      case 'pl_department': {
        const where = period ? `AND je.date LIKE ?` : '';
        const params = period ? [`${period}%`] : [];
        const rows = await query(
          `SELECT COALESCE(NULLIF(jl.dept,''),'(unassigned)') as dept,
                  SUM(CASE WHEN coa.category='Income'  THEN jl.credit - jl.debit ELSE 0 END) as income,
                  SUM(CASE WHEN coa.category='Expense' THEN jl.debit - jl.credit ELSE 0 END) as expense
           FROM journal_lines jl
           JOIN journal_entries je ON jl.entry_id=je.id AND je.status='posted'
           JOIN chart_of_accounts coa ON jl.account_id=coa.id
           WHERE 1=1 ${where}
           GROUP BY COALESCE(NULLIF(jl.dept,''),'(unassigned)')
           ORDER BY dept`, params
        );
        const data = rows.map(r => ({ ...r, net: (r.income||0) - (r.expense||0) }));
        return ok(data);
      }

      // ── The payment authority matrix (live from settings) — FIN-007 ──────
      case 'payment_authority': {
        const L = await paymentLimits();
        return ok([
          { level:'Staff',            limit:L.staff,     role:'staff' },
          { level:'Department Head',  limit:L.dept_head, role:'dept_head' },
          { level:'Finance Manager',  limit:L.fm,        role:'finance_manager' },
          { level:'CFO',              limit:L.cfo,       role:'cfo' },
          { level:'Managing Director',limit:null,        role:'md' },
        ]);
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

      // ── FIN-002: create journal (preparer) — starts as draft ─────────────
      case 'create_journal': {
        const { date, description, reference, lines, auto_reverse, reversal_date } = body;
        if (!date || !description || !lines?.length)
          return err('date, description and lines required', 400);
        if (await periodLocked(date)) return err(`FIN-003: ${String(date).slice(0,7)} is closed — no journals can be dated into a locked period`, 403);

        // Validate debit = credit
        const totalDebit  = lines.reduce((s, l) => s + (l.debit  || 0), 0);
        const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01)
          return err(`Journal not balanced: debits ${totalDebit} ≠ credits ${totalCredit}`, 400);

        const entryId  = uuid();
        const entry_no = `JV-${Date.now()}`;

        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO journal_entries (id,entry_no,date,description,reference,prepared_by,status,auto_reverse,reversal_date)
             VALUES (?,?,?,?,?,?,'draft',?,?)`,
            [entryId, entry_no, date, description, reference, auth.user.employee_id, auto_reverse?1:0, reversal_date||null]
          );
          for (const l of lines) {
            await dbRun(
              `INSERT INTO journal_lines (id,entry_id,account_id,description,debit,credit,dept,project_id)
               VALUES (?,?,?,?,?,?,?,?)`,
              [uuid(), entryId, l.account_id, l.description||'', l.debit||0, l.credit||0, l.dept||'', l.project_id||'']
            );
          }
        });
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_JOURNAL', module: 'Finance', recordId: entryId, newValue: { entry_no } });
        return ok({ entry_id: entryId, entry_no }, 201);
      }

      // ── FIN-002: reviewer (must differ from preparer) ────────────────────
      case 'review_journal': {
        const { entry_id } = body;
        const je = await queryOne(`SELECT * FROM journal_entries WHERE id=?`, [entry_id]);
        if (!je) return err('Journal not found', 404);
        if (je.status !== 'draft') return err(`Cannot review — status is ${je.status}`, 409);
        if (je.prepared_by === auth.user.employee_id) return err('FIN-002: the reviewer must be a different user from the preparer', 403);
        await run(`UPDATE journal_entries SET reviewed_by=?, status='reviewed' WHERE id=?`, [auth.user.employee_id, entry_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REVIEW_JOURNAL', module: 'Finance', recordId: entry_id });
        return ok({ reviewed: true });
      }

      // ── FIN-002: approver (distinct from preparer & reviewer) → posts ────
      case 'approve_journal': {
        const { entry_id, signature_key } = body;
        const je = await queryOne(`SELECT * FROM journal_entries WHERE id=?`, [entry_id]);
        if (!je) return err('Journal not found', 404);
        if (je.status !== 'reviewed') return err(`Cannot approve — must be reviewed first (status ${je.status})`, 409);
        if (auth.user.employee_id === je.prepared_by || auth.user.employee_id === je.reviewed_by)
          return err('FIN-002: the approver must be distinct from both the preparer and the reviewer', 403);
        if (await periodLocked(je.date)) return err(`FIN-003: ${String(je.date).slice(0,7)} is closed`, 403);

        await run(`UPDATE journal_entries SET approved_by=?, approved_sig=?, approved_at=datetime('now'), status='posted' WHERE id=?`,
          [auth.user.employee_id, signature_key||`QSL-DS-${auth.user.role}-${Date.now()}`, entry_id]);

        // Accrual auto-reversal: post a reversing entry dated reversal_date.
        let reversal_no = null;
        if (je.auto_reverse && je.reversal_date) {
          const lines = await query(`SELECT * FROM journal_lines WHERE entry_id=?`, [entry_id]);
          const revId = uuid(); reversal_no = `JV-${Date.now()}-R`;
          await transaction(async ({ run: dbRun }) => {
            await dbRun(`INSERT INTO journal_entries (id,entry_no,date,description,reference,prepared_by,reviewed_by,approved_by,approved_at,status,is_reversal,reversed_by)
                         VALUES (?,?,?,?,?,?,?,?,datetime('now'),'posted',1,?)`,
              [revId, reversal_no, je.reversal_date, `Auto-reversal of ${je.entry_no}`, je.reference, auth.user.employee_id, je.reviewed_by, auth.user.employee_id, je.entry_no]);
            for (const l of lines) {
              await dbRun(`INSERT INTO journal_lines (id,entry_id,account_id,description,debit,credit,dept,project_id) VALUES (?,?,?,?,?,?,?,?)`,
                [uuid(), revId, l.account_id, `Reversal: ${l.description||''}`, l.credit||0, l.debit||0, l.dept||'', l.project_id||'']);
            }
          });
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'POST_JOURNAL', module: 'Finance', recordId: entry_id, newValue: { reversal_no } });
        return ok({ posted: true, reversal_no });
      }

      // ── FIN-002: reverse a posted journal (swapped entry) ────────────────
      case 'reverse_journal': {
        const { entry_id } = body;
        const je = await queryOne(`SELECT * FROM journal_entries WHERE id=?`, [entry_id]);
        if (!je) return err('Journal not found', 404);
        if (je.status !== 'posted') return err('Only posted journals can be reversed', 409);
        const lines = await query(`SELECT * FROM journal_lines WHERE entry_id=?`, [entry_id]);
        const revId = uuid(); const reversal_no = `JV-${Date.now()}-R`;
        const today = new Date().toISOString().split('T')[0];
        if (await periodLocked(today)) return err('FIN-003: current period is closed', 403);
        await transaction(async ({ run: dbRun }) => {
          await dbRun(`INSERT INTO journal_entries (id,entry_no,date,description,reference,prepared_by,reviewed_by,approved_by,approved_at,status,is_reversal,reversed_by)
                       VALUES (?,?,?,?,?,?,?,?,datetime('now'),'posted',1,?)`,
            [revId, reversal_no, today, `Reversal of ${je.entry_no}`, je.reference, auth.user.employee_id, auth.user.employee_id, auth.user.employee_id, je.entry_no]);
          for (const l of lines) {
            await dbRun(`INSERT INTO journal_lines (id,entry_id,account_id,description,debit,credit,dept,project_id) VALUES (?,?,?,?,?,?,?,?)`,
              [uuid(), revId, l.account_id, `Reversal: ${l.description||''}`, l.credit||0, l.debit||0, l.dept||'', l.project_id||'']);
          }
          await dbRun(`UPDATE journal_entries SET reversed_by=? WHERE id=?`, [reversal_no, entry_id]);
        });
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REVERSE_JOURNAL', module: 'Finance', recordId: entry_id, newValue: { reversal_no } });
        return ok({ reversed: true, reversal_no });
      }

      // ── FIN-003: month-end close ─────────────────────────────────────────
      case 'open_close_period': {
        const { period } = body;
        if (!period) return err('period (YYYY-MM) required', 400);
        const existing = await queryOne(`SELECT id FROM month_end_close WHERE period=?`, [period]);
        if (existing) return err('Close already started for this period', 409);
        await run(`INSERT INTO month_end_close (id,period,status,checklist) VALUES (?,?,'open',?)`,
          [uuid(), period, JSON.stringify(DEFAULT_CLOSE_CHECKLIST)]);
        return ok({ period, status:'open' }, 201);
      }

      case 'update_close_item': {
        const { period, key, done } = body;
        const row = await queryOne(`SELECT * FROM month_end_close WHERE period=?`, [period]);
        if (!row) return err('Close not started for this period', 404);
        if (row.status === 'closed') return err('Period already closed', 409);
        const checklist = JSON.parse(row.checklist || '[]').map(i =>
          i.key === key ? { ...i, done: !!done, done_by: auth.user.name, done_at: new Date().toISOString() } : i);
        await run(`UPDATE month_end_close SET checklist=? WHERE period=?`, [JSON.stringify(checklist), period]);
        return ok({ updated: true, checklist });
      }

      case 'finalize_close': {
        if (!['cfo','md','admin'].includes(auth.user.role)) return err('FIN-003: month-end close requires CFO (or MD) digital sign-off', 403);
        const { period, signature_key } = body;
        const row = await queryOne(`SELECT * FROM month_end_close WHERE period=?`, [period]);
        if (!row) return err('Close not started for this period', 404);
        if (row.status === 'closed') return err('Period already closed', 409);
        const checklist = JSON.parse(row.checklist || '[]');
        if (!checklist.every(i => i.done)) return err('All checklist items must be complete before closing', 400);
        await run(`UPDATE month_end_close SET status='closed', cfo_sig=?, closed_by=?, closed_at=datetime('now') WHERE period=?`,
          [signature_key||`QSL-DS-${auth.user.role}-${Date.now()}`, auth.user.employee_id, period]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'FINALIZE_MONTH_END', module: 'Finance', recordId: period });
        return ok({ closed: true, period });
      }

      // ── FIN-006: 3-way match a supplier invoice (LPO ↔ GRN ↔ invoice) ────
      case 'match_invoice': {
        const { supplier_id, lpo_id, invoice_no, invoice_amount, invoice_date } = body;
        if (!lpo_id || !invoice_no || !invoice_amount) return err('lpo_id, invoice_no and invoice_amount required', 400);

        const lpo = await queryOne(`SELECT * FROM lpos WHERE id=?`, [lpo_id]);
        if (!lpo) return err('LPO not found', 404);
        // The GRN proves goods were received — required before payment.
        const grn = await queryOne(`SELECT * FROM grns WHERE lpo_id=? ORDER BY created_at DESC LIMIT 1`, [lpo_id]);

        const tol = await require('../../../lib/settings').getNum('finance.match_tolerance', 0); // absolute Kshs tolerance
        const variance = Math.round((invoice_amount - lpo.grand_total) * 100) / 100;

        let match_status, status, exception_reason = null;
        if (!grn || (grn.status !== 'completed' && grn.status !== 'received' && grn.status !== 'stage2')) {
          match_status = 'no_grn'; status = 'exception';
          exception_reason = 'No completed GRN — goods receipt not confirmed';
        } else if (Math.abs(variance) > tol) {
          match_status = 'variance'; status = 'exception';
          exception_reason = `Invoice ${invoice_amount} vs LPO ${lpo.grand_total} (variance ${variance})`;
        } else {
          match_status = 'matched'; status = 'matched';
        }

        const id = uuid();
        await run(
          `INSERT INTO supplier_invoices (id,invoice_no,supplier_id,lpo_id,grn_id,invoice_amount,lpo_amount,invoice_date,match_status,variance_amount,status,exception_reason)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, invoice_no, supplier_id||lpo.supplier_id, lpo_id, grn?.id||null, invoice_amount, lpo.grand_total, invoice_date||new Date().toISOString().split('T')[0], match_status, variance, status, exception_reason]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'MATCH_SUPPLIER_INVOICE', module: 'Finance', recordId: id, newValue: { match_status, variance } });
        return ok({ id, match_status, status, variance, exception_reason }, 201);
      }

      // ── FIN-006: CFO clears a match exception ────────────────────────────
      case 'approve_invoice_exception': {
        if (!['cfo','md','admin'].includes(auth.user.role)) return err('FIN-006: only the CFO or MD may approve a 3-way-match exception', 403);
        const { invoice_id } = body;
        const inv = await queryOne(`SELECT * FROM supplier_invoices WHERE id=?`, [invoice_id]);
        if (!inv) return err('Invoice not found', 404);
        if (inv.status !== 'exception') return err('Invoice is not in exception status', 409);
        await run(`UPDATE supplier_invoices SET status='matched', approved_by=?, approved_at=datetime('now') WHERE id=?`, [auth.user.employee_id, invoice_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'APPROVE_INVOICE_EXCEPTION', module: 'Finance', recordId: invoice_id });
        return ok({ approved: true });
      }

      // ── FIN-006/007: raise a payment voucher (only from a matched invoice;
      //     amount sets the required approval authority) ─────────────────────
      case 'create_voucher': {
        const { supplier_invoice_id, payee, amount, purpose, payment_method } = body;
        let voucherAmount = amount, voucherPayee = payee, voucherPurpose = purpose, invId = null;

        if (supplier_invoice_id) {
          const inv = await queryOne(`SELECT si.*, s.name as supplier_name FROM supplier_invoices si LEFT JOIN suppliers s ON si.supplier_id=s.id WHERE si.id=?`, [supplier_invoice_id]);
          if (!inv) return err('Supplier invoice not found', 404);
          // FIN-006 gate: no payment until the 3-way match clears.
          if (inv.status !== 'matched') return err('FIN-006: invoice must pass the 3-way match (or have its exception approved) before a payment voucher can be raised', 403);
          voucherAmount = inv.invoice_amount; voucherPayee = inv.supplier_name || 'Supplier'; voucherPurpose = `Payment for invoice ${inv.invoice_no}`; invId = inv.id;
        }
        if (!voucherAmount || voucherAmount <= 0) return err('A positive amount (or a matched supplier_invoice_id) is required', 400);
        if (!voucherPayee || !voucherPurpose) return err('payee and purpose required', 400);

        const authority = await requiredAuthority(voucherAmount);
        const id = uuid();
        const voucher_no = `PV-${Date.now()}`;
        await run(
          `INSERT INTO payment_vouchers (id,voucher_no,date,payee,amount,purpose,payment_method,status,auth_level,required_level,supplier_invoice_id)
           VALUES (?,?,?,?,?,?,?, 'pending_approval', ?, ?, ?)`,
          [id, voucher_no, new Date().toISOString().split('T')[0], voucherPayee, voucherAmount, voucherPurpose, payment_method||'bank_transfer', authority.level, authority.level, invId]
        );
        if (invId) await run(`UPDATE supplier_invoices SET status='voucher_created' WHERE id=?`, [invId]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_PAYMENT_VOUCHER', module: 'Finance', recordId: id, newValue: { amount: voucherAmount, required_level: authority.level } });
        return ok({ id, voucher_no, amount: voucherAmount, required_level: authority.level }, 201);
      }

      // ── FIN-007: approve a voucher — enforces the authority matrix ───────
      case 'approve_voucher': {
        const { voucher_id, signature_key } = body;
        const v = await queryOne(`SELECT * FROM payment_vouchers WHERE id=?`, [voucher_id]);
        if (!v) return err('Voucher not found', 404);
        if (v.status === 'approved' || v.status === 'paid') return err('Voucher already approved', 409);

        const required = await requiredAuthority(v.amount);
        const myRank = AUTH_RANK[auth.user.role] || 0;
        if (myRank < required.rank) {
          return err(`FIN-007: this payment of Kshs ${v.amount.toLocaleString('en-KE')} requires ${required.level.replace('_',' ').toUpperCase()} authority. Your role cannot approve it — escalate.`, 403);
        }
        await run(`UPDATE payment_vouchers SET status='approved', approved_by=?, approved_sig=?, approved_at=datetime('now') WHERE id=?`,
          [auth.user.employee_id, signature_key||`QSL-DS-${auth.user.role}-${Date.now()}`, voucher_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'APPROVE_PAYMENT_VOUCHER', module: 'Finance', recordId: voucher_id, newValue: { amount: v.amount, approver_rank: myRank } });
        return ok({ approved: true, amount: v.amount, required_level: required.level });
      }

      // ── FIN-008: Finance Manager prepares a payment batch ────────────────
      case 'create_batch': {
        if (!['finance_manager','fm','cfo','md','admin'].includes(auth.user.role)) return err('FIN-008: only the Finance Manager prepares payment batches', 403);
        const { voucher_ids } = body;
        if (!Array.isArray(voucher_ids) || !voucher_ids.length) return err('voucher_ids[] required', 400);
        const placeholders = voucher_ids.map(()=>'?').join(',');
        const vouchers = await query(`SELECT * FROM payment_vouchers WHERE id IN (${placeholders}) AND status='approved' AND batch_id IS NULL`, voucher_ids);
        if (!vouchers.length) return err('No eligible approved, unbatched vouchers found', 400);
        const total = vouchers.reduce((s,v)=>s+v.amount,0);
        const id = uuid();
        const batch_no = `BATCH-${Date.now()}`;
        await transaction(async ({ run: dbRun }) => {
          await dbRun(`INSERT INTO payment_batches (id,batch_no,prepared_by,total_amount,voucher_count,status) VALUES (?,?,?,?,?,'draft')`,
            [id, batch_no, auth.user.employee_id, total, vouchers.length]);
          for (const v of vouchers) await dbRun(`UPDATE payment_vouchers SET batch_id=? WHERE id=?`, [id, v.id]);
        });
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_PAYMENT_BATCH', module: 'Finance', recordId: id, newValue: { batch_no, total, count: vouchers.length } });
        return ok({ id, batch_no, total_amount: total, voucher_count: vouchers.length }, 201);
      }

      // ── FIN-008: sign a batch — FM prepares → CFO reviews → MD approves ──
      case 'sign_batch': {
        const { batch_id, signer_role, signature_key } = body;
        const b = await queryOne(`SELECT * FROM payment_batches WHERE id=?`, [batch_id]);
        if (!b) return err('Batch not found', 404);
        if (b.status === 'approved') return err('Batch already approved', 409);
        const now = new Date().toISOString();
        let update, newStatus;
        if (signer_role === 'fm' && !b.fm_sig) { update = `fm_sig=?, fm_signed_at=?, status='fm_signed'`; newStatus='fm_signed'; }
        else if (signer_role === 'cfo' && b.fm_sig && !b.cfo_sig) { update = `cfo_sig=?, cfo_signed_at=?, status='cfo_signed'`; newStatus='cfo_signed'; }
        else if (signer_role === 'md' && b.cfo_sig && !b.md_sig) { update = `md_sig=?, md_signed_at=?, status='approved'`; newStatus='approved'; }
        else return err('Invalid signing sequence: batches go Finance Manager → CFO → MD', 400);

        await run(`UPDATE payment_batches SET ${update} WHERE id=?`, [signature_key||`QSL-DS-${signer_role}-${Date.now()}`, now, batch_id]);
        if (newStatus === 'approved') {
          await run(`UPDATE payment_vouchers SET status='paid' WHERE batch_id=?`, [batch_id]);
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: `SIGN_BATCH_${signer_role.toUpperCase()}`, module: 'Finance', recordId: batch_id, newValue: { status: newStatus } });
        return ok({ signed: true, status: newStatus });
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
