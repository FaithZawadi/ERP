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

      // QSL_ImprestForm_Template — branded Imprest Request PDF
      case 'imprest_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const im = await queryOne(
          `SELECT i.*, e.first_name||' '||e.last_name as employee_name, e.department
           FROM imprest i JOIN employees e ON i.employee_id=e.id WHERE i.id=?`, [id]);
        if (!im) return err('Not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('imprest_form', {
          docNo: `IMP-${im.id.slice(0, 8).toUpperCase()}`,
          blocks: {
            Requester: { Name: im.employee_name, Department: im.department, Date: new Date(im.created_at).toLocaleDateString('en-KE') },
            Purpose:   { Purpose: im.purpose, Status: im.status },
          },
          columns: [{ label: 'Description', key: 'purpose', weight: 3 }, { label: 'Amount (Kshs)', key: 'amount', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') }],
          rows: [im],
          totals: [{ label: 'TOTAL REQUESTED', value: `Kshs ${Number(im.amount||0).toLocaleString('en-KE')}` }],
        });
        return ok(result);
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

      // FIN-PDF-001: download any individual employee's payslip — the
      // Finance/HR/CFO-side equivalent of the self-service payslip_pdf on
      // /api/me (that one only lets an employee download their own).
      case 'payslip_pdf': {
        const entry_id = searchParams.get('entry_id');
        if (!entry_id) return err('entry_id required', 400);
        const entry = await queryOne(
          `SELECT pe.*, pr.period FROM payroll_entries pe JOIN payroll_runs pr ON pe.run_id=pr.id WHERE pe.id=?`, [entry_id]
        );
        if (!entry) return err('Payslip entry not found', 404);
        const emp = await queryOne(`SELECT emp_no, first_name||' '||last_name as name, department, kra_pin FROM employees WHERE id=?`, [entry.employee_id]);
        const { generatePayslip, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generatePayslip({ ...emp, ...entry }, entry, entry.period);
        return ok(result);
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

      // FIN-PDF-002: the full branded Profit & Loss Statement PDF —
      // generateProfitAndLoss() in pdf.js was fully built (and, until a
      // companion fix this round, would crash on any period with no GL
      // postings due to a typo'd colour constant) but never actually wired
      // to a route — the Month-End & P&L screen had no way to produce one.
      // Groups posted journal lines by account `type` (cogs_*, opex_*,
      // depreciation, finance_cost, revenue, other-income types) into the
      // exact section shape the PDF generator expects.
      case 'pl_statement_pdf': {
        const p = period || new Date().toISOString().slice(0, 7);
        const rows = await query(
          `SELECT coa.name, coa.type, SUM(jl.credit - jl.debit) as net_credit, SUM(jl.debit - jl.credit) as net_debit
           FROM journal_lines jl
           JOIN journal_entries je ON jl.entry_id=je.id AND je.status='posted'
           JOIN chart_of_accounts coa ON jl.account_id=coa.id
           WHERE je.date LIKE ? AND coa.type NOT IN ('header')
           GROUP BY coa.id, coa.name, coa.type
           HAVING net_credit != 0 OR net_debit != 0
           ORDER BY coa.name`,
          [`${p}%`]
        );
        const has_gl_data = rows.length > 0;
        const pick = (pred, useCreditSide) => rows.filter(r => pred(r.type)).map(r => ({ name: r.name, amount: useCreditSide ? (r.net_credit || 0) : (r.net_debit || 0) }));
        const sum = (arr) => arr.reduce((s, r) => s + r.amount, 0);

        const revenue   = pick(t => t === 'revenue', true);
        const cogs      = pick(t => t.startsWith('cogs_'), false);
        const opex      = pick(t => t.startsWith('opex_'), false);
        const depreciation = pick(t => t === 'depreciation', false);
        const otherIncome  = pick(t => ['forex', 'ic_income', 'interest', 'other_income'].includes(t), true);
        const financeCosts = pick(t => t === 'finance_cost', false);

        const totalRevenue = sum(revenue), totalCOGS = sum(cogs), grossProfit = totalRevenue - totalCOGS;
        const totalOpex = sum(opex), totalDepreciation = sum(depreciation);
        const operatingProfit = grossProfit - totalOpex - totalDepreciation;
        const totalOtherIncome = sum(otherIncome), totalFinanceCosts = sum(financeCosts);
        const netProfit = operatingProfit + totalOtherIncome - totalFinanceCosts;

        const { generateProfitAndLoss, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateProfitAndLoss(
          { revenue, totalRevenue, cogs, totalCOGS, grossProfit, opex, totalOpex, depreciation, totalDepreciation,
            operatingProfit, otherIncome, totalOtherIncome, financeCosts, totalFinanceCosts, netProfit, has_gl_data },
          p, auth.user.name
        );
        return ok(result);
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

      // ── Budget dashboard: dept budgets vs actuals + revenue vs targets,
      //    with 80%/100% variance alerts (FIN-019/020/021) ──────────────────
      case 'budget_dashboard': {
        const year = searchParams.get('year') || String(new Date().getFullYear());
        const statusOf = (pct) => pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'ok';

        // Actual expense by department from posted journals, this fiscal year.
        const expRows = await query(
          `SELECT COALESCE(NULLIF(jl.dept,''),'(unassigned)') as dept,
                  SUM(jl.debit - jl.credit) as actual
           FROM journal_lines jl
           JOIN journal_entries je ON jl.entry_id=je.id AND je.status='posted' AND je.date LIKE ?
           JOIN chart_of_accounts coa ON jl.account_id=coa.id AND coa.category='Expense'
           GROUP BY COALESCE(NULLIF(jl.dept,''),'(unassigned)')`, [`${year}%`]
        );
        const expByDept = Object.fromEntries(expRows.map(r => [r.dept, r.actual || 0]));

        // Actual income by department (and company-wide) from posted journals.
        const incRows = await query(
          `SELECT COALESCE(NULLIF(jl.dept,''),'(unassigned)') as dept,
                  SUM(jl.credit - jl.debit) as actual
           FROM journal_lines jl
           JOIN journal_entries je ON jl.entry_id=je.id AND je.status='posted' AND je.date LIKE ?
           JOIN chart_of_accounts coa ON jl.account_id=coa.id AND coa.category='Income'
           GROUP BY COALESCE(NULLIF(jl.dept,''),'(unassigned)')`, [`${year}%`]
        );
        const incByDept = Object.fromEntries(incRows.map(r => [r.dept, r.actual || 0]));
        const companyIncome = incRows.reduce((s,r)=>s+(r.actual||0),0);

        const budgetRows = await query(`SELECT * FROM budgets WHERE fiscal_year=? ORDER BY department, cost_centre`, [year]);
        const budgets = budgetRows.map(b => {
          const actual = expByDept[b.department] || 0;
          const pct = b.annual_amount ? Math.round(actual / b.annual_amount * 1000) / 10 : 0;
          return { ...b, actual, consumed_pct: pct, variance: b.annual_amount - actual, status: statusOf(pct) };
        });

        const targetRows = await query(`SELECT * FROM revenue_targets WHERE fiscal_year=? ORDER BY scope`, [year]);
        const targets = targetRows.map(t => {
          const actual = t.scope === 'Company' ? companyIncome : (incByDept[t.scope] || 0);
          const pct = t.annual_target ? Math.round(actual / t.annual_target * 1000) / 10 : 0;
          return { ...t, actual, achieved_pct: pct, variance: actual - t.annual_target, status: pct >= 100 ? 'met' : pct >= 80 ? 'on_track' : 'behind' };
        });

        return ok({ year, budgets, targets });
      }

      // ── FIN-004: exchange rates (latest per currency) ────────────────────
      case 'fx_rates': {
        const rows = await query(
          `SELECT er.* FROM exchange_rates er
           WHERE er.rate_date = (SELECT MAX(rate_date) FROM exchange_rates WHERE currency=er.currency)
           GROUP BY er.currency ORDER BY er.currency`
        );
        return ok(rows);
      }

      // ── FIN-004: month-end forex revaluation of open import LPOs ─────────
      case 'forex_revaluation': {
        const latest = await query(
          `SELECT currency, rate_to_kes FROM exchange_rates er
           WHERE rate_date=(SELECT MAX(rate_date) FROM exchange_rates WHERE currency=er.currency) GROUP BY currency`
        );
        const rateMap = Object.fromEntries(latest.map(r => [r.currency, r.rate_to_kes]));
        const open = await query(
          `SELECT id, lpo_no, currency, grand_total, fx_rate FROM lpos WHERE currency<>'KES' AND status<>'paid'`
        );
        const lines = open.map(l => {
          const cur_rate = rateMap[l.currency] || l.fx_rate;
          const original = Math.round(l.grand_total * l.fx_rate);
          const revalued = Math.round(l.grand_total * cur_rate);
          return { lpo_no: l.lpo_no, currency: l.currency, foreign_amount: l.grand_total, booked_rate: l.fx_rate, current_rate: cur_rate, original_kes: original, revalued_kes: revalued, fx_gain_loss: revalued - original };
        });
        const total_impact = lines.reduce((s, l) => s + l.fx_gain_loss, 0);
        return ok({ lines, total_impact });
      }

      // ── FIN-009: supplier statement reconciliations ──────────────────────
      case 'supplier_recon': {
        const rows = await query(
          `SELECT ss.*, s.name as supplier_name FROM supplier_statements ss
           LEFT JOIN suppliers s ON ss.supplier_id=s.id ORDER BY ss.created_at DESC`
        );
        return ok(rows);
      }

      // ── FIN-010: creditors due — DPO per supplier + 3-day alert ──────────
      case 'creditors_due': {
        const rows = await query(
          `SELECT si.id, si.invoice_no, si.invoice_amount, si.invoice_date, si.status,
                  s.name as supplier_name, COALESCE(s.payment_terms,30) as payment_terms
           FROM supplier_invoices si LEFT JOIN suppliers s ON si.supplier_id=s.id
           WHERE si.status NOT IN ('paid') ORDER BY si.invoice_date`
        );
        const now = new Date();
        const data = rows.map(r => {
          const due = new Date(new Date(r.invoice_date).getTime() + (r.payment_terms||30)*86400000);
          const days_to_due = Math.round((due - now) / 86400000);
          return { ...r, due_date: due.toISOString().split('T')[0], days_to_due, due_soon: days_to_due <= 3 };
        });
        return ok(data);
      }

      // ── FIN-025: NSSF & SHA (NHIF) remittance schedule for a period ──────
      case 'remittance': {
        const p = period || new Date().toISOString().slice(0,7);
        const run = await queryOne(`SELECT * FROM payroll_runs WHERE period=?`, [p]);
        if (!run) return ok({ period: p, entries: [], totals: {} });
        const entries = await query(
          `SELECT pe.nssf, pe.nhif, pe.paye, pe.housing_levy, e.first_name||' '||e.last_name as name, e.emp_no
           FROM payroll_entries pe JOIN employees e ON pe.employee_id=e.id WHERE pe.run_id=?`, [run.id]
        );
        const totals = entries.reduce((a,e)=>({ nssf:a.nssf+(e.nssf||0), sha:a.sha+(e.nhif||0), paye:a.paye+(e.paye||0), housing:a.housing+(e.housing_levy||0) }), {nssf:0,sha:0,paye:0,housing:0});
        return ok({ period: p, entries, totals });
      }

      // ── FIN-024: P9 — annual tax deduction card per employee ─────────────
      case 'p9': {
        const employee_id = searchParams.get('employee_id');
        const year = searchParams.get('year') || String(new Date().getFullYear());
        if (!employee_id) return err('employee_id required', 400);
        const emp = await queryOne(`SELECT emp_no, first_name||' '||last_name as name, kra_pin FROM employees WHERE id=?`, [employee_id]);
        const months = await query(
          `SELECT pr.period, pe.gross_pay, pe.paye, pe.nssf, pe.nhif, pe.housing_levy, pe.net_pay
           FROM payroll_entries pe JOIN payroll_runs pr ON pe.run_id=pr.id
           WHERE pe.employee_id=? AND pr.period LIKE ? ORDER BY pr.period`, [employee_id, `${year}%`]
        );
        const totals = months.reduce((a,m)=>({ gross:a.gross+(m.gross_pay||0), paye:a.paye+(m.paye||0), nssf:a.nssf+(m.nssf||0), nhif:a.nhif+(m.nhif||0), housing:a.housing+(m.housing_levy||0) }), {gross:0,paye:0,nssf:0,nhif:0,housing:0});
        return ok({ employee: emp, year, months, totals });
      }

      // ── HR-011: bank payment file (CSV) for a payroll run, per bank ──────
      case 'bank_file': {
        const p = period || new Date().toISOString().slice(0,7);
        const bank = (searchParams.get('bank') || 'ALL').toUpperCase();
        const run = await queryOne(`SELECT * FROM payroll_runs WHERE period=?`, [p]);
        if (!run) return err('No payroll run for this period', 404);
        let rows = await query(
          `SELECT e.first_name||' '||e.last_name as name, e.bank_name, e.bank_account, e.bank_branch, pe.net_pay
           FROM payroll_entries pe JOIN employees e ON pe.employee_id=e.id WHERE pe.run_id=?`, [run.id]
        );
        if (bank !== 'ALL') rows = rows.filter(r => (r.bank_name||'').toUpperCase().includes(bank));
        // Per-bank header layout; columns are otherwise common.
        const headers = {
          KCB:    'AccountNumber,AccountName,Branch,Amount,Narration',
          EQUITY: 'Account,Name,Branch,Amount,Reference',
          NCBA:   'BeneficiaryAccount,BeneficiaryName,Branch,Amount,Details',
          'CO-OP':'AccountNo,AccountName,Branch,Amount,Narrative',
          COOP:   'AccountNo,AccountName,Branch,Amount,Narrative',
          ALL:    'AccountNumber,AccountName,Bank,Branch,Amount,Reference',
        };
        const head = headers[bank] || headers.ALL;
        const ref = `Salary ${p}`;
        const body = rows.map(r => bank === 'ALL'
          ? `${r.bank_account||''},${r.name},${r.bank_name||''},${r.bank_branch||''},${Math.round(r.net_pay)},${ref}`
          : `${r.bank_account||''},${r.name},${r.bank_branch||''},${Math.round(r.net_pay)},${ref}`).join('\n');
        const csv = `${head}\n${body}\n`;
        return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="payroll_${p}_${bank}.csv"` } });
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

      // QSL_Quote_Template — list + PDF
      case 'quotes': {
        const rows = await query(
          `SELECT q.*, c.name as client_name FROM quotes q LEFT JOIN clients c ON q.client_id=c.id ORDER BY q.created_at DESC LIMIT 100`
        );
        return ok(rows);
      }
      case 'quote_detail': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const q = await queryOne(`SELECT q.*, c.name as client_name FROM quotes q LEFT JOIN clients c ON q.client_id=c.id WHERE q.id=?`, [id]);
        if (!q) return err('Not found', 404);
        const lines = await query(`SELECT * FROM quote_lines WHERE quote_id=?`, [id]);
        return ok({ ...q, lines });
      }
      case 'quote_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const q = await queryOne(`SELECT q.*, c.name as client_name, c.address as client_address, c.kra_pin as client_pin,
                                          c.contact_person, c.phone as client_phone, c.email as client_email
                                   FROM quotes q LEFT JOIN clients c ON q.client_id=c.id WHERE q.id=?`, [id]);
        if (!q) return err('Not found', 404);
        const lines = await query(`SELECT * FROM quote_lines WHERE quote_id=?`, [id]);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('quote', {
          docNo: q.quote_no,
          headerDate: q.date ? `Friday, ${new Date(q.date).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}` : undefined,
          headerBadge: q.valid_until ? `Valid until ${new Date(q.valid_until).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}` : undefined,
          blocks: {
            'Bill To':   { 'Client Name': q.client_name, Address: q.client_address || '—', 'KRA PIN': q.client_pin || '—', 'Contact Phone': q.client_phone || '—', 'Contact Email': q.client_email || '—' },
          },
          columns: [
            { label: 'Description', key: 'description', weight: 3 },
            { label: 'Qty', key: 'quantity', weight: 1, align: 'right' },
            { label: 'Rate (KES)', key: 'unit_price', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE', { minimumFractionDigits: 2 }) },
            { label: 'Amount (KES)', key: 'total', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE', { minimumFractionDigits: 2 }) },
          ],
          rows: lines,
          totals: [
            { label: 'Sub Total', value: `KES ${Number(q.subtotal||0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` },
            { label: 'VAT @ 16%', value: `KES ${Number(q.vat_amount||0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` },
            { label: 'TOTAL DUE', value: `KES ${Number(q.total||0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` },
          ],
          paymentDetails: {
            'Bank Name': 'Kenya Commercial Bank (KCB)', 'Branch': 'Industrial Area',
            'Account Name': 'Qalibrated Systems Limited', 'Account No.': '1319820654', 'Currency': 'KES',
            'M-PESA Paybill': '522533', 'Account No': '8877900',
          },
        });
        return ok(result);
      }

      // QSL_DebitNote_Template / QSL_CreditNote_Template — list + PDF
      case 'debit_notes':
      case 'credit_notes': {
        const table = section === 'debit_notes' ? 'debit_notes' : 'credit_notes';
        const rows = await query(
          `SELECT n.*, c.name as client_name FROM ${table} n LEFT JOIN clients c ON n.client_id=c.id ORDER BY n.created_at DESC LIMIT 100`
        );
        return ok(rows);
      }
      case 'debit_note_pdf':
      case 'credit_note_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const isDebit = section === 'debit_note_pdf';
        const table   = isDebit ? 'debit_notes' : 'credit_notes';
        const n = await queryOne(`SELECT n.*, c.name as client_name, c.kra_pin as client_pin, i.invoice_no
                                   FROM ${table} n LEFT JOIN clients c ON n.client_id=c.id
                                   LEFT JOIN tax_invoices i ON n.invoice_id=i.id WHERE n.id=?`, [id]);
        if (!n) return err('Not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc(isDebit ? 'debit_note' : 'credit_note', {
          docNo: n.note_no,
          blocks: {
            Client: { Name: n.client_name, PIN: n.client_pin },
            Ref:    { 'Invoice No': n.invoice_no || '—', Date: n.date },
          },
          columns: [{ label: 'Reason', key: 'reason', weight: 3 }, { label: 'Amount (Kshs)', key: 'amount', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') }],
          rows: [n],
          totals: [{ label: 'TOTAL', value: `Kshs ${Number(n.amount||0).toLocaleString('en-KE')}` }],
        });
        return ok(result);
      }

      // QSL_Statement_Template — derived live from tax_invoices, no new table needed
      case 'statement_pdf': {
        const client_id = searchParams.get('client_id');
        if (!client_id) return err('client_id required', 400);
        const client = await queryOne(`SELECT * FROM clients WHERE id=?`, [client_id]);
        if (!client) return err('Client not found', 404);
        const invoices = await query(
          `SELECT invoice_no, date, due_date, total, status FROM tax_invoices WHERE client_id=? ORDER BY date DESC LIMIT 50`, [client_id]
        );
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('statement', {
          docNo: `STMT-${client.code}`,
          blocks: {
            Client: { Name: client.name, PIN: client.kra_pin },
            Period: { 'As at': new Date().toLocaleDateString('en-KE'), 'Outstanding': `Kshs ${Number(client.outstanding||0).toLocaleString('en-KE')}` },
          },
          columns: [
            { label: 'Invoice No', key: 'invoice_no', weight: 1.5 },
            { label: 'Date', key: 'date', weight: 1 },
            { label: 'Due', key: 'due_date', weight: 1 },
            { label: 'Total (Kshs)', key: 'total', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') },
            { label: 'Status', key: 'status', weight: 1 },
          ],
          rows: invoices,
          totals: [{ label: 'TOTAL OUTSTANDING', value: `Kshs ${Number(client.outstanding||0).toLocaleString('en-KE')}` }],
        });
        return ok(result);
      }

      // QSL_TravelClaim_Template — list + PDF
      case 'travel_claims': {
        const rows = await query(
          `SELECT t.*, e.first_name||' '||e.last_name as employee_name FROM travel_claims t
           LEFT JOIN employees e ON t.employee_id=e.id ORDER BY t.created_at DESC LIMIT 100`
        );
        return ok(rows);
      }
      case 'travel_claim_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const t = await queryOne(`SELECT t.*, e.first_name||' '||e.last_name as employee_name, e.department
                                   FROM travel_claims t LEFT JOIN employees e ON t.employee_id=e.id WHERE t.id=?`, [id]);
        if (!t) return err('Not found', 404);
        const lines = await query(`SELECT * FROM travel_claim_lines WHERE claim_id=?`, [id]);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('travel_claim', {
          docNo: t.claim_no,
          blocks: {
            Claimant: { Name: t.employee_name, Department: t.department },
            Trip:     { Purpose: t.trip_purpose, Destination: t.destination, From: t.from_date, To: t.to_date },
          },
          columns: [
            { label: 'Date', key: 'date', weight: 1 },
            { label: 'Description', key: 'description', weight: 2 },
            { label: 'Amount (Kshs)', key: 'amount', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') },
          ],
          rows: lines,
          totals: [{ label: 'TOTAL CLAIMED', value: `Kshs ${Number(t.total_amount||0).toLocaleString('en-KE')}` }],
        });
        return ok(result);
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

      // ── FIN-011: imprest request → Line Manager approves → FM releases ───
      case 'create_imprest': {
        const { employee_id, amount, purpose, expected_return_date, line_manager_id } = body;
        if (!employee_id || !amount || !purpose)
          return err('employee_id, amount and purpose required', 400);
        if (amount <= 0) return err('Amount must be positive', 400);

        const retireDays = await require('../../../lib/settings').getInt('finance.imprest_retire_days', 14);
        const issued   = new Date().toISOString().split('T')[0];
        const due      = expected_return_date || new Date(Date.now() + retireDays * 86400000).toISOString().split('T')[0];
        const ref_no   = `IMP-${Date.now()}`;
        const id       = uuid();

        await run(
          `INSERT INTO imprest (id,ref_no,employee_id,amount,purpose,date_issued,due_date,status,expected_return_date,line_manager_id)
           VALUES (?,?,?,?,?,?,?, 'requested', ?, ?)`,
          [id, ref_no, employee_id, amount, purpose, issued, due, expected_return_date||due, line_manager_id||null]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_IMPREST', module: 'Finance', recordId: id, newValue: { amount, purpose } });
        return ok({ id, ref_no, status: 'requested' }, 201);
      }

      // ── FIN-011: Line Manager approves the request ───────────────────────
      case 'approve_imprest_request': {
        const { id } = body;
        const imp = await queryOne(`SELECT * FROM imprest WHERE id=?`, [id]);
        if (!imp) return err('Imprest not found', 404);
        if (imp.status !== 'requested') return err(`Cannot approve — status is ${imp.status}`, 409);
        await run(`UPDATE imprest SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?`, [auth.user.employee_id, id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'APPROVE_IMPREST', module: 'Finance', recordId: id });
        return ok({ approved: true });
      }

      // ── FIN-011: Finance Manager releases the cash (starts the 14-day clock)
      case 'release_imprest': {
        if (!['finance_manager','fm','cfo','md','admin'].includes(auth.user.role)) return err('FIN-011: only the Finance Manager releases imprest', 403);
        const { id } = body;
        const imp = await queryOne(`SELECT * FROM imprest WHERE id=?`, [id]);
        if (!imp) return err('Imprest not found', 404);
        if (imp.status !== 'approved') return err('Imprest must be approved by the Line Manager before release', 409);
        const retireDays = await require('../../../lib/settings').getInt('finance.imprest_retire_days', 14);
        const due = new Date(Date.now() + retireDays * 86400000).toISOString().split('T')[0];
        await run(`UPDATE imprest SET status='released', released_by=?, released_at=datetime('now'), date_issued=date('now'), due_date=? WHERE id=?`, [auth.user.employee_id, due, id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'RELEASE_IMPREST', module: 'Finance', recordId: id, newValue: { due_date: due } });
        return ok({ released: true, due_date: due });
      }

      // ── FIN-012A: Finance Manager clears a spot-checked receipt ──────────
      case 'verify_receipt': {
        const { id } = body;
        await run(`UPDATE imprest SET receipt_verified=1, spot_check=0 WHERE id=?`, [id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'VERIFY_IMPREST_RECEIPT', module: 'Finance', recordId: id });
        return ok({ verified: true });
      }

      // ── FIN-012A: a false receipt triggers the disciplinary workflow ─────
      case 'flag_false_receipt': {
        const { id, reason } = body;
        const imp = await queryOne(`SELECT i.*, e.first_name||' '||e.last_name as name FROM imprest i JOIN employees e ON i.employee_id=e.id WHERE i.id=?`, [id]);
        if (!imp) return err('Imprest not found', 404);
        await run(`UPDATE imprest SET status='FALSE_RECEIPT', receipt_verified=0, notes=? WHERE id=?`, [reason||'False receipt detected on spot-check', id]);
        // Raise a disciplinary task to HR (the disciplinary workflow entry point).
        await run(`INSERT INTO tasks (id,title,assignee_id,due_date,priority,status,module,description) VALUES (?,?,?,date('now','+3 days'),'critical','pending','HR',?)`,
          [uuid(), `Disciplinary: false receipt — ${imp.name} (${imp.ref_no})`, imp.line_manager_id||imp.employee_id, `Spot-check flagged a false receipt on imprest ${imp.ref_no}. ${reason||''}`]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'FLAG_FALSE_RECEIPT', module: 'Finance', recordId: id, newValue: { reason } });
        return ok({ flagged: true, disciplinary_task_created: true });
      }

      // ── FIN-012B/C: 14-day rule — unretired imprest converts irreversibly
      //    to a Personal Advance, recovered from the next payroll run ────────
      case 'check_overdue_imprest': {
        const today = new Date().toISOString().split('T')[0];
        // Active (released, or legacy 'pending') imprest past its due date and
        // not yet (fully) accounted.
        const overdue = await query(
          `SELECT i.*, e.email, e.first_name||' '||e.last_name as name
           FROM imprest i JOIN employees e ON i.employee_id=e.id
           WHERE i.due_date < ? AND i.status IN ('released','pending','approved')`, [today]
        );

        const converted = [];
        for (const imp of overdue) {
          const balance = Math.max(0, (imp.amount || 0) - (imp.amount_accounted || 0));
          await run(
            `UPDATE imprest SET status='CONVERTED', converted_to_advance=1, converted_at=datetime('now'),
                    advance_balance=?, notified_at=datetime('now') WHERE id=?`,
            [balance, imp.id]
          );
          converted.push({ id: imp.id, ref_no: imp.ref_no, name: imp.name, balance });
          // FIN-012C: notify the staff member that it has become a salary-recoverable advance.
          try {
            const { send } = require('../../../lib/email');
            if (imp.email) await send({ to: imp.email, subject: `Imprest ${imp.ref_no} converted to a Personal Advance`,
              html: `<p>Dear ${imp.name},</p><p>Imprest <b>${imp.ref_no}</b> (Kshs ${balance.toLocaleString('en-KE')}) was not retired within the allowed period and has, per QSL-FIN-CHP-001, irreversibly converted to a <b>Personal Advance</b>. It will be deducted from your next salary.</p>` });
          } catch (e) { /* email is best-effort */ }
          await logAudit(query, { userId: 'SYSTEM', userName: 'System', action: 'CONVERT_IMPREST_TO_ADVANCE', module: 'Finance', recordId: imp.id, newValue: { advance_balance: balance } });
        }
        return ok({ converted_count: converted.length, pending_conversions: converted });
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

        // Calculate payslips: HELB + approved overtime (HR-007/012) and recover
        // converted imprest advances (FIN-012C).
        const entries = [];
        for (const e of employees) {
          const ot = await query(`SELECT id, amount FROM overtime WHERE employee_id=? AND period=? AND status='approved'`, [e.id, period]);
          const overtime = ot.reduce((s, o) => s + (o.amount || 0), 0);
          // ATT-003: unpaid leave taken in the period is deducted at the daily rate (basic/26).
          const [ul] = await query(`SELECT COALESCE(SUM(days),0) as days FROM leave_requests WHERE employee_id=? AND status='approved' AND lower(leave_type) LIKE '%unpaid%' AND start_date LIKE ?`, [e.id, `${period}%`]);
          const unpaid_deduction = Math.round((ul?.days || 0) * (e.basic_salary || 0) / 26);
          const ps = calculatePayslip({ basic_salary: e.basic_salary, allowances: 0, overtime, helb: e.helb_monthly || 0, other_deductions: unpaid_deduction });
          const advances = await query(
            `SELECT id, advance_balance FROM imprest WHERE employee_id=? AND status='CONVERTED' AND deducted_in_run IS NULL`, [e.id]
          );
          const imprest_deduct = advances.reduce((s, a) => s + (a.advance_balance || 0), 0);
          entries.push({ ...ps, employee_id: e.id, id: uuid(), imprest_deduct, net_pay: Math.max(0, ps.net_pay - imprest_deduct), advance_ids: advances.map(a => a.id), overtime_ids: ot.map(o => o.id) });
        }

        const totals = entries.reduce((acc, e) => {
          acc.gross  += e.gross_pay; acc.paye += e.paye; acc.nhif += e.nhif;
          acc.nssf += e.nssf; acc.housing += e.housing_levy; acc.net += e.net_pay;
          acc.imprest += e.imprest_deduct; acc.helb += e.helb; acc.overtime += e.overtime;
          return acc;
        }, { gross: 0, paye: 0, nhif: 0, nssf: 0, housing: 0, net: 0, imprest: 0, helb: 0, overtime: 0 });

        // HR-008: cut-off on the 20th; pay on the last day of the period.
        const cutoff_date = `${period}-20`;
        const [yy, mm] = period.split('-').map(Number);
        const pay_date = new Date(Date.UTC(yy, mm, 0)).toISOString().split('T')[0]; // last day of month (UTC-safe)

        const runId = uuid();
        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO payroll_runs (id,period,status,total_gross,total_paye,total_nhif,total_nssf,total_housing,total_net,cutoff_date,pay_date)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [runId, period, 'draft', totals.gross, totals.paye, totals.nhif, totals.nssf, totals.housing, totals.net, cutoff_date, pay_date]
          );
          for (const e of entries) {
            await dbRun(
              `INSERT INTO payroll_entries (id,run_id,employee_id,basic_salary,gross_pay,paye,nhif,nssf,housing_levy,helb,overtime,imprest_deduct,other_deductions,net_pay)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [e.id, runId, e.employee_id, e.basic_salary||0, e.gross_pay, e.paye, e.nhif, e.nssf, e.housing_levy, e.helb||0, e.overtime||0, e.imprest_deduct||0, e.other_deductions||0, e.net_pay]
            );
            for (const advId of e.advance_ids) {
              await dbRun(`UPDATE imprest SET status='deducted', deducted_in_run=?, deducted_at=datetime('now') WHERE id=?`, [runId, advId]);
            }
            for (const otId of e.overtime_ids) {
              await dbRun(`UPDATE overtime SET status='paid', paid_in_run=? WHERE id=?`, [runId, otId]);
            }
          }
        });

        return ok({ run_id: runId, period, entries_count: entries.length, totals, cutoff_date, pay_date }, 201);
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

      // ── FIN-020: annual department/cost-centre budget with monthly phasing ─
      case 'create_budget': {
        const { fiscal_year, department, cost_centre, category, annual_amount, phasing } = body;
        if (!fiscal_year || !department || !annual_amount) return err('fiscal_year, department and annual_amount required', 400);
        // Even phasing across 12 months if none supplied.
        const phase = Array.isArray(phasing) && phasing.length === 12
          ? phasing : Array(12).fill(Math.round(annual_amount / 12));
        const existing = await queryOne(`SELECT id FROM budgets WHERE fiscal_year=? AND department=? AND COALESCE(cost_centre,'')=COALESCE(?,'')`, [fiscal_year, department, cost_centre||'']);
        if (existing) {
          await run(`UPDATE budgets SET category=?, annual_amount=?, phasing=? WHERE id=?`, [category||null, annual_amount, JSON.stringify(phase), existing.id]);
          return ok({ id: existing.id, updated: true });
        }
        const id = uuid();
        await run(`INSERT INTO budgets (id,fiscal_year,department,cost_centre,category,annual_amount,phasing,created_by) VALUES (?,?,?,?,?,?,?,?)`,
          [id, fiscal_year, department, cost_centre||null, category||null, annual_amount, JSON.stringify(phase), auth.user.employee_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_BUDGET', module: 'Finance', recordId: id, newValue: { department, annual_amount } });
        return ok({ id }, 201);
      }

      // ── FIN-019: revenue / KPI target by department or company-wide ──────
      case 'create_revenue_target': {
        const { fiscal_year, scope, annual_target, phasing } = body;
        if (!fiscal_year || !scope || !annual_target) return err('fiscal_year, scope and annual_target required', 400);
        const phase = Array.isArray(phasing) && phasing.length === 12
          ? phasing : Array(12).fill(Math.round(annual_target / 12));
        const existing = await queryOne(`SELECT id FROM revenue_targets WHERE fiscal_year=? AND scope=?`, [fiscal_year, scope]);
        if (existing) {
          await run(`UPDATE revenue_targets SET annual_target=?, phasing=? WHERE id=?`, [annual_target, JSON.stringify(phase), existing.id]);
          return ok({ id: existing.id, updated: true });
        }
        const id = uuid();
        await run(`INSERT INTO revenue_targets (id,fiscal_year,scope,annual_target,phasing,created_by) VALUES (?,?,?,?,?,?)`,
          [id, fiscal_year, scope, annual_target, JSON.stringify(phase), auth.user.employee_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_REVENUE_TARGET', module: 'Finance', recordId: id, newValue: { scope, annual_target } });
        return ok({ id }, 201);
      }

      // ── FIN-004: set/update an exchange rate to KES ──────────────────────
      case 'set_fx_rate': {
        const { currency, rate_to_kes, rate_date } = body;
        if (!currency || !rate_to_kes) return err('currency and rate_to_kes required', 400);
        const d = rate_date || new Date().toISOString().split('T')[0];
        const existing = await queryOne(`SELECT id FROM exchange_rates WHERE currency=? AND rate_date=?`, [currency.toUpperCase(), d]);
        if (existing) await run(`UPDATE exchange_rates SET rate_to_kes=? WHERE id=?`, [rate_to_kes, existing.id]);
        else await run(`INSERT INTO exchange_rates (id,currency,rate_to_kes,rate_date,created_by) VALUES (?,?,?,?,?)`,
          [uuid(), currency.toUpperCase(), rate_to_kes, d, auth.user.employee_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SET_FX_RATE', module: 'Finance', recordId: currency, newValue: { rate_to_kes, rate_date: d } });
        return ok({ currency: currency.toUpperCase(), rate_to_kes, rate_date: d }, 201);
      }

      // ── FIN-009: reconcile a supplier statement; variance escalates to FM ─
      case 'reconcile_supplier': {
        const { supplier_id, period, statement_balance } = body;
        if (!supplier_id || !period || statement_balance == null) return err('supplier_id, period and statement_balance required', 400);
        // Ledger balance = unpaid supplier invoices for this supplier.
        const [bal] = await query(`SELECT COALESCE(SUM(invoice_amount),0) as ledger FROM supplier_invoices WHERE supplier_id=? AND status NOT IN ('paid')`, [supplier_id]);
        const ledger = bal.ledger || 0;
        const variance = Math.round((statement_balance - ledger) * 100) / 100;
        const status = Math.abs(variance) > 0.5 ? 'variance' : 'reconciled';
        const existing = await queryOne(`SELECT id FROM supplier_statements WHERE supplier_id=? AND period=?`, [supplier_id, period]);
        if (existing) await run(`UPDATE supplier_statements SET statement_balance=?, ledger_balance=?, variance=?, status=?, reconciled_by=? WHERE id=?`,
          [statement_balance, ledger, variance, status, auth.user.employee_id, existing.id]);
        else await run(`INSERT INTO supplier_statements (id,supplier_id,period,statement_balance,ledger_balance,variance,status,reconciled_by) VALUES (?,?,?,?,?,?,?,?)`,
          [uuid(), supplier_id, period, statement_balance, ledger, variance, status, auth.user.employee_id]);
        // FIN-009: escalate a variance to the Finance Manager via a task.
        if (status === 'variance') {
          const sup = await queryOne(`SELECT name FROM suppliers WHERE id=?`, [supplier_id]);
          await run(`INSERT INTO tasks (id,title,due_date,priority,status,module,description) VALUES (?,?,date('now','+3 days'),'high','pending','Finance',?)`,
            [uuid(), `Supplier reconciliation variance — ${sup?.name||supplier_id} (${period})`, `Statement ${statement_balance} vs ledger ${ledger}, variance ${variance}. Escalated to Finance Manager.`]);
        }
        return ok({ ledger_balance: ledger, variance, status });
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

      // QSL_Quote_Template — create a quotation with line items
      case 'create_quote': {
        const { client_id, valid_until, lines } = body;
        if (!client_id || !lines?.length) return err('client_id and lines required', 400);
        const s = require('../../../lib/settings');
        const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
        const vatRate  = await s.getNum('finance.vat_rate', 0.16);
        const vat_amount = Math.round(subtotal * vatRate);
        const total    = subtotal + vat_amount;
        const id       = uuid();
        const quote_no = `QT-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO quotes (id,quote_no,client_id,valid_until,subtotal,vat_amount,total,created_by) VALUES (?,?,?,?,?,?,?,?)`,
            [id, quote_no, client_id, valid_until, subtotal, vat_amount, total, auth.user.employee_id]
          );
          for (const l of lines) {
            await dbRun(`INSERT INTO quote_lines (id,quote_id,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?)`,
              [uuid(), id, l.description, l.quantity, l.unit_price, l.quantity * l.unit_price]);
          }
        });
        return ok({ id, quote_no, subtotal, vat_amount, total }, 201);
      }

      // COM-QUOTE-001: any authenticated user who can see a quote (sales
      // reps and technicians included — quote creation lives in Commercial
      // for them, not Finance) can email it straight to the client with the
      // real PDF attached, generated fresh at send time.
      case 'send_quote': {
        const { quote_id } = body;
        if (!quote_id) return err('quote_id required', 400);
        const q = await queryOne(
          `SELECT q.*, c.name as client_name, c.address as client_address, c.kra_pin as client_pin, c.email as client_email, c.contact_person
           FROM quotes q LEFT JOIN clients c ON q.client_id=c.id WHERE q.id=?`, [quote_id]
        );
        if (!q) return err('Quote not found', 404);
        if (!q.client_email) return err('This client has no email address on file — add one in Commercial before sending', 400);
        const lines = await query(`SELECT * FROM quote_lines WHERE quote_id=?`, [quote_id]);

        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const pdfResult = await generateBusinessDoc('quote', {
          docNo: q.quote_no,
          blocks: {
            Client:   { Name: q.client_name, PIN: q.client_pin, Address: q.client_address },
            Validity: { Date: q.date, 'Valid Until': q.valid_until, Status: q.status },
          },
          columns: [
            { label: 'Description', key: 'description', weight: 3 },
            { label: 'Qty', key: 'quantity', weight: 1, align: 'right' },
            { label: 'Unit Price', key: 'unit_price', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') },
            { label: 'Total', key: 'total', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') },
          ],
          rows: lines,
          totals: [
            { label: 'Subtotal', value: Number(q.subtotal||0).toLocaleString('en-KE') },
            { label: 'VAT', value: Number(q.vat_amount||0).toLocaleString('en-KE') },
            { label: 'GRAND TOTAL', value: `Kshs ${Number(q.total||0).toLocaleString('en-KE')}` },
          ],
        });

        const { sendQuotePdf } = require('../../../lib/email');
        const emailResult = await sendQuotePdf(q, { name: q.client_name, email: q.client_email, contact_person: q.contact_person }, lines, pdfResult.path, auth.user.name);

        if (q.status === 'draft') await run(`UPDATE quotes SET status='sent' WHERE id=?`, [quote_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SEND_QUOTE', module: 'Commercial', recordId: quote_id, newValue: { sent_to: q.client_email, mock: !!emailResult.mock } });

        return ok({ sent: emailResult.success, mock: !!emailResult.mock, to: q.client_email, pdf_url: pdfResult.url });
      }

      // QSL_DebitNote_Template / QSL_CreditNote_Template
      case 'create_debit_note':
      case 'create_credit_note': {
        const isDebit = action === 'create_debit_note';
        const { client_id, invoice_id, amount, reason } = body;
        if (!client_id || !amount || !reason) return err('client_id, amount and reason required', 400);
        const id = uuid();
        const prefix  = isDebit ? 'DN' : 'CN';
        const note_no = `${prefix}-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
        const table   = isDebit ? 'debit_notes' : 'credit_notes';
        await run(
          `INSERT INTO ${table} (id,note_no,client_id,invoice_id,amount,reason,created_by) VALUES (?,?,?,?,?,?,?)`,
          [id, note_no, client_id, invoice_id || null, amount, reason, auth.user.employee_id]
        );
        // Credit notes reduce, debit notes increase the client's outstanding balance
        await run(`UPDATE clients SET outstanding = outstanding ${isDebit ? '+' : '-'} ? WHERE id=?`, [amount, client_id]);
        return ok({ id, note_no, amount }, 201);
      }

      // QSL_TravelClaim_Template — create a travel claim with expense lines
      case 'create_travel_claim': {
        const { employee_id, trip_purpose, destination, from_date, to_date, lines } = body;
        if (!employee_id || !trip_purpose || !from_date || !to_date || !lines?.length)
          return err('employee_id, trip_purpose, from_date, to_date and lines required', 400);
        const total_amount = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
        const id = uuid();
        const claim_no = `TC-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO travel_claims (id,claim_no,employee_id,trip_purpose,destination,from_date,to_date,total_amount) VALUES (?,?,?,?,?,?,?,?)`,
            [id, claim_no, employee_id, trip_purpose, destination, from_date, to_date, total_amount]
          );
          for (const l of lines) {
            await dbRun(`INSERT INTO travel_claim_lines (id,claim_id,date,description,amount) VALUES (?,?,?,?,?)`,
              [uuid(), id, l.date || null, l.description, l.amount]);
          }
        });
        return ok({ id, claim_no, total_amount }, 201);
      }

      // QSL_TravelClaim_Template — Line Manager / Finance approval
      case 'approve_travel_claim': {
        const { claim_id } = body;
        if (!claim_id) return err('claim_id required', 400);
        await run(`UPDATE travel_claims SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?`,
          [auth.user.employee_id, claim_id]);
        return ok({ approved: true });
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
      // ── FIN-012A: retire imprest — a receipt is mandatory before claiming;
      //    ~20% are auto-flagged for Finance Manager spot-check ──────────────
      case 'account_imprest': {
        const { amount_accounted, receipt_path, file_name, file_data } = body;
        const imp = await queryOne(`SELECT * FROM imprest WHERE id=?`, [id]);
        if (!imp) return err('Imprest not found', 404);

        // FIN-012A: accept the receipt as a real camera/gallery photo (or a
        // scanned PDF) sent as a base64 data URL — same convention as SOPs
        // and GRN photos elsewhere — rather than asking a non-technical
        // user to type/paste a file path or URL by hand. receipt_path is
        // still accepted as a plain string for backward compatibility, but
        // the upload path takes priority when a new file is provided.
        let receipt = receipt_path || imp.receipt_path;
        if (file_data) {
          const match = /^data:([^;]+);base64,(.+)$/.exec(file_data);
          if (!match) return err('file_data must be a base64 data URL', 400);
          const path = require('path');
          const fs = require('fs');
          const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
          const dir = path.join(UPLOAD_DIR, 'receipts');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const buffer = Buffer.from(match[2], 'base64');
          const ext = path.extname(file_name || '') || '.jpg';
          const stored = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          fs.writeFileSync(path.join(dir, stored), buffer);
          receipt = `/uploads/receipts/${stored}`;
        }

        if (!receipt) return err('FIN-012A: a receipt photo/PDF is mandatory before an imprest can be claimed/retired. Upload the receipt first.', 400);
        const spot = Math.random() < 0.2 ? 1 : 0; // 20% spot-check
        await run(
          `UPDATE imprest SET amount_accounted=?, receipt_path=?, status='accounted', spot_check=?, receipt_verified=? WHERE id=?`,
          [amount_accounted, receipt, spot, spot ? 0 : 1, id]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'RETIRE_IMPREST', module: 'Finance', recordId: id, newValue: { amount_accounted, spot_check: spot } });
        return ok({ updated: true, spot_check: !!spot, receipt_url: receipt });
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
