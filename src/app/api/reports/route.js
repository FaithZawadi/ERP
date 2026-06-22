// src/app/api/reports/route.js — All 15 Standard Reports + MD Dashboard

import { ok, err, requireAuth } from '../../../lib/auth';
import { query, queryOne, run, monthExpr, monthsAgoExpr } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const report = searchParams.get('report') || 'md_dashboard';
  const period = searchParams.get('period') || new Date().toISOString().slice(0, 7);
  const from   = searchParams.get('from')   || `${new Date().getFullYear()}-01-01`;
  const to     = searchParams.get('to')     || new Date().toISOString().split('T')[0];

  try {
    switch (report) {

      // RPT-NEW-5: Analytics Dashboard (point 7) — KPIs + trend data for charts
      // Inventory levels, pending approvals, vehicle utilization, procurement
      // trends — plus time series for visual trend analysis.
      case 'analytics_dashboard': {
        // ── Inventory levels ──────────────────────────────────────────────
        const [invTotals] = await query(
          `SELECT COUNT(DISTINCT i.id) as item_count,
                  COALESCE(SUM(sb.quantity),0) as total_units,
                  COALESCE(SUM(sb.quantity * i.unit_cost),0) as total_value
           FROM items i LEFT JOIN stock_balances sb ON sb.item_id=i.id WHERE i.is_active=1`
        );
        const [lowStockCount] = await query(`SELECT COUNT(*) as count FROM low_stock_alerts WHERE status='open'`);
        const inventoryByCategory = await query(
          `SELECT c.name as category, COALESCE(SUM(sb.quantity),0) as units, COALESCE(SUM(sb.quantity*i.unit_cost),0) as value
           FROM items i LEFT JOIN item_categories c ON i.category_id=c.id LEFT JOIN stock_balances sb ON sb.item_id=i.id
           WHERE i.is_active=1 GROUP BY c.id ORDER BY value DESC LIMIT 8`
        );

        // ── Pending approvals (across the modules that have approval steps) ─
        const [pendingRequisitions] = await query(`SELECT COUNT(*) as count FROM store_requisitions WHERE status='pending_approval'`);
        const [pendingPRs] = await query(`SELECT COUNT(*) as count FROM purchase_requisitions WHERE status='draft'`);
        const [pendingAdjustments] = await query(`SELECT COUNT(*) as count FROM stock_adjustments WHERE status='pending'`);
        const [pendingTransfers] = await query(`SELECT COUNT(*) as count FROM stock_transfers WHERE status='pending'`);
        const pendingApprovalsBreakdown = [
          { name: 'Store Requisitions', value: pendingRequisitions?.count || 0 },
          { name: 'Purchase Requisitions', value: pendingPRs?.count || 0 },
          { name: 'Stock Adjustments', value: pendingAdjustments?.count || 0 },
          { name: 'Stock Transfers', value: pendingTransfers?.count || 0 },
        ];

        // ── Vehicle utilization ──────────────────────────────────────────
        const [vehicleTotals] = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM vehicles`);
        const tripsLast30 = await query(
          `SELECT v.reg_no, COUNT(t.id) as trip_count, COALESCE(SUM(t.distance),0) as total_distance
           FROM vehicles v LEFT JOIN trips t ON t.vehicle_id=v.id AND t.date >= date('now','-30 days')
           GROUP BY v.id ORDER BY trip_count DESC LIMIT 10`
        );
        const utilizationRate = (vehicleTotals?.total || 0) > 0
          ? Math.round((tripsLast30.filter(t => t.trip_count > 0).length / vehicleTotals.total) * 100)
          : 0;

        // ── Procurement trends — LPO value by month, last 6 months ────────
        const procurementTrend = await query(
          `SELECT ${monthExpr('date')} as month, COUNT(*) as lpo_count, COALESCE(SUM(grand_total),0) as total_value
           FROM lpos WHERE date >= ${monthsAgoExpr(6)} GROUP BY month ORDER BY month`
        );

        // ── Requisition trend — last 6 months, by status outcome ──────────
        const requisitionTrend = await query(
          `SELECT ${monthExpr('created_at')} as month,
                  SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) as closed,
                  SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
                  COUNT(*) as total
           FROM store_requisitions WHERE created_at >= ${monthsAgoExpr(6)} GROUP BY month ORDER BY month`
        );

        // ── Stock movement trend — last 6 months, receive vs issue volume ──
        const stockMovementTrend = await query(
          `SELECT ${monthExpr('date')} as month,
                  SUM(CASE WHEN type='receive' THEN quantity ELSE 0 END) as received,
                  SUM(CASE WHEN type='issue' THEN -quantity ELSE 0 END) as issued
           FROM stock_movements WHERE date >= ${monthsAgoExpr(6)} GROUP BY month ORDER BY month`
        );

        return ok({
          inventory: {
            item_count: invTotals?.item_count || 0,
            total_units: invTotals?.total_units || 0,
            total_value: invTotals?.total_value || 0,
            low_stock_count: lowStockCount?.count || 0,
            by_category: inventoryByCategory,
          },
          pending_approvals: {
            total: pendingApprovalsBreakdown.reduce((s, p) => s + p.value, 0),
            breakdown: pendingApprovalsBreakdown,
          },
          fleet: {
            total_vehicles: vehicleTotals?.total || 0,
            active_vehicles: vehicleTotals?.active || 0,
            utilization_rate: utilizationRate,
            top_utilized: tripsLast30,
          },
          procurement_trend: procurementTrend,
          requisition_trend: requisitionTrend,
          stock_movement_trend: stockMovementTrend,
        });
      }

      // RPT-001: MD Executive Dashboard
      case 'md_dashboard': {
        const [revenue]    = await query(`SELECT SUM(contract_value) as total, COUNT(*) as count FROM projects WHERE status='active'`);
        const [collected]  = await query(`SELECT SUM(collected_total) as total FROM projects`);
        const [expenses]   = await query(`SELECT SUM(expenses_total) as total FROM projects`);
        const [invoiced]   = await query(`SELECT SUM(invoiced_total) as total FROM projects`);
        const [overdueimp] = await query(`SELECT COUNT(*) as count, SUM(amount) as amount FROM imprest WHERE status IN ('OVERDUE','CONVERTED')`);
        const [openBids]   = await query(`SELECT COUNT(*) as count, SUM(value) as pipeline FROM bids WHERE stopped=0`);
        const [expDocs]    = await query(`SELECT COUNT(*) as count FROM compliance_docs WHERE expires_at < date('now','+60 days') AND status='current'`);
        const [tasks]      = await query(`SELECT COUNT(*) as overdue FROM tasks WHERE status='pending' AND due_date < date('now')`);
        const topDebts     = await query(`SELECT c.name, c.outstanding FROM clients c WHERE c.outstanding > 0 ORDER BY c.outstanding DESC LIMIT 10`);
        const paymentsDue  = await query(
          `SELECT s.name, l.grand_total, l.delivery_date FROM lpos l JOIN suppliers s ON l.supplier_id=s.id
           WHERE l.status='delivered' AND l.delivery_date <= date('now','+7 days') ORDER BY l.grand_total DESC LIMIT 10`
        );

        return ok({
          revenue_active:   revenue?.total || 0,
          active_projects:  revenue?.count || 0,
          total_collected:  collected?.total || 0,
          total_expenses:   expenses?.total || 0,
          total_invoiced:   invoiced?.total || 0,
          gross_profit:     (revenue?.total || 0) - (expenses?.total || 0),
          margin:           revenue?.total ? ((revenue.total - expenses.total) / revenue.total) : 0,
          overdue_imprest:  overdueimp,
          open_bids:        openBids,
          expiring_docs:    expDocs?.count || 0,
          overdue_tasks:    tasks?.overdue || 0,
          top_debtors:      topDebts,
          payments_due:     paymentsDue,
        });
      }

      // RPT-002: P&L by Department
      case 'pl_department': {
        const rows = await query(
          `SELECT e.department,
                  SUM(pe.amount) as total_expenses,
                  COUNT(DISTINCT p.id) as project_count
           FROM project_expenses pe
           JOIN employees e ON pe.posted_by=e.id
           JOIN projects p ON pe.project_id=p.id
           WHERE pe.date BETWEEN ? AND ?
           GROUP BY e.department ORDER BY total_expenses DESC`, [from, to]
        );
        return ok(rows);
      }

      // RPT-003: Aged Debtors
      case 'aged_debtors': {
        const rows = await query(
          `SELECT c.name, c.outstanding, c.contact_person, c.email, c.phone,
                  e.first_name||' '||e.last_name as account_owner
           FROM clients c LEFT JOIN employees e ON c.account_owner=e.id
           WHERE c.outstanding > 0 ORDER BY c.outstanding DESC`
        );
        return ok(rows);
      }

      // RPT-004: Aged Creditors
      case 'aged_creditors': {
        const rows = await query(
          `SELECT s.name, s.payment_terms, l.lpo_no, l.grand_total, l.delivery_date
           FROM lpos l JOIN suppliers s ON l.supplier_id=s.id
           WHERE l.status='delivered'
           ORDER BY l.grand_total DESC`
        );
        const now = Date.now();
        const withDays = rows.map(r => ({
          ...r,
          days_outstanding: r.delivery_date ? Math.floor((now - new Date(r.delivery_date).getTime()) / 86400000) : null,
        }));
        return ok(withDays);
      }

      // RPT-005: Project Profitability
      case 'project_profitability': {
        const rows = await query(
          `SELECT p.ref_no, p.name, c.name as client, p.contract_value,
                  p.expenses_total, p.invoiced_total, p.collected_total,
                  p.contract_value - p.expenses_total as gross_profit,
                  CASE WHEN p.contract_value > 0 THEN (p.contract_value - p.expenses_total)/p.contract_value ELSE 0 END as margin,
                  e.first_name||' '||e.last_name as pm
           FROM projects p
           LEFT JOIN clients c ON p.client_id=c.id
           LEFT JOIN employees e ON p.pm_id=e.id
           WHERE p.status != 'archived'
           ORDER BY gross_profit DESC`
        );
        return ok(rows);
      }

      // RPT-007: Stock Valuation
      case 'stock_valuation': {
        const [summary] = await query(`SELECT SUM(unit_cost*reorder_level) as total FROM items WHERE is_active=1`);
        const rows = await query(
          `SELECT i.*, s.name as supplier_name FROM items i LEFT JOIN suppliers s ON i.supplier_id=s.id WHERE i.is_active=1 ORDER BY i.category`
        );
        return ok({ summary, items: rows });
      }

      // RPT-008: Sales Performance
      case 'sales_performance': {
        const rows = await query(
          `SELECT e.first_name||' '||e.last_name as name, e.department,
                  COUNT(l.id) as total_leads,
                  SUM(l.estimated_value) as pipeline_value,
                  SUM(CASE WHEN l.won_lost='won' THEN l.estimated_value ELSE 0 END) as won_value,
                  COUNT(CASE WHEN l.won_lost='won' THEN 1 END) as wins
           FROM employees e LEFT JOIN leads l ON l.owner=e.id
           WHERE e.department='BD' OR e.role LIKE '%Sales%'
           GROUP BY e.id ORDER BY pipeline_value DESC`
        );
        return ok(rows);
      }

      // RPT-009: Payroll Summary
      case 'payroll_summary': {
        const run_row = await queryOne(`SELECT * FROM payroll_runs WHERE period=?`, [period]);
        if (!run_row) return err('No payroll run for this period', 404);
        const entries = await query(
          `SELECT pe.*, e.first_name||' '||e.last_name as name, e.department, e.role
           FROM payroll_entries pe JOIN employees e ON pe.employee_id=e.id
           WHERE pe.run_id=?`, [run_row.id]
        );
        return ok({ run: run_row, entries });
      }

      // RPT-010: Asset Register
      case 'asset_register': {
        const rows = await query(
          `SELECT a.*, e.first_name||' '||e.last_name as custodian_name
           FROM assets a LEFT JOIN employees e ON a.custodian=e.id
           WHERE a.status != 'disposed' ORDER BY a.category, a.name`
        );
        const [totals] = await query(`SELECT SUM(cost) as total_cost, SUM(nbv) as total_nbv FROM assets WHERE status='in_use'`);
        return ok({ totals, assets: rows });
      }

      // RPT-011: Fleet Utilisation
      case 'fleet_utilisation': {
        const rows = await query(
          `SELECT v.*, e.first_name||' '||e.last_name as driver_name,
                  COUNT(t.id) as trips, SUM(t.distance) as total_km, SUM(t.fuel_cost) as fuel_cost
           FROM vehicles v
           LEFT JOIN employees e ON v.assigned_driver=e.id
           LEFT JOIN trips t ON t.vehicle_id=v.id AND t.date BETWEEN ? AND ?
           GROUP BY v.id ORDER BY v.reg_no`, [from, to]
        );
        return ok(rows);
      }

      // RPT-012: Compliance Calendar
      case 'compliance_calendar': {
        const { STATUTORY_OBLIGATIONS, getNextDueDate } = require('../../../lib/tax');
        const docs = await query(`SELECT * FROM compliance_docs ORDER BY expires_at`);
        const obligations = STATUTORY_OBLIGATIONS.map(o => ({
          ...o, next_due: getNextDueDate(o),
        }));
        return ok({ statutory: obligations, certificates: docs });
      }

      // RPT-013: Inter-Company Balances
      case 'ic_balances': {
        const rows = await query(
          `SELECT ic.*, rp.name as entity_name, rp.type as entity_type
           FROM ic_transactions ic LEFT JOIN related_parties rp ON ic.entity_id=rp.id
           ORDER BY rp.name`
        );
        const [totals] = await query(`SELECT SUM(fee_amount) as total_fees, SUM(collected) as total_collected, SUM(fee_amount-collected) as outstanding FROM ic_transactions`);
        return ok({ totals, transactions: rows });
      }

      // RPT-014: Lead & Pipeline
      case 'lead_pipeline': {
        const rows = await query(
          `SELECT l.*, e.first_name||' '||e.last_name as owner_name
           FROM leads l LEFT JOIN employees e ON l.owner=e.id
           ORDER BY l.estimated_value DESC`
        );
        const [summary] = await query(`SELECT COUNT(*) as total, SUM(estimated_value) as total_value FROM leads WHERE won_lost IS NULL`);
        return ok({ summary, leads: rows });
      }

      // RPT-015: Bid Register
      case 'bid_register': {
        const rows = await query(
          `SELECT b.*, e.first_name||' '||e.last_name as owner_name
           FROM bids b LEFT JOIN employees e ON b.owner=e.id
           ORDER BY b.deadline`
        );
        return ok(rows);
      }

      // RPT-016: MD Employee KPI Dashboard
      case 'kpi_dashboard': {
        const rows = await query(
          `SELECT e.id, e.first_name||' '||e.last_name as name, e.department,
                  e.l_and_d_hours, e.l_and_d_target,
                  AVG(k.score) as avg_score,
                  MAX(k.increment_blocked) as increment_blocked
           FROM employees e
           LEFT JOIN kpi_scorecards k ON k.employee_id=e.id
           WHERE e.status='active' GROUP BY e.id ORDER BY e.department`
        );
        return ok(rows);
      }

      default:
        return err(`Unknown report: ${report}`, 400);
    }
  } catch (e) {
    console.error('[Reports GET]', e);
    return err('Server error: ' + e.message, 500);
  }
}

// ── POST /api/reports — export reports as PDF or Excel ───────────────────────

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action, format, report, period, from, to } = body;

  try {
    if (action !== 'export') return err('Unknown action', 400);

    // Refresh company identity (name/PIN/address/phone/email) from System
    // Settings so every generated PDF reflects the configured company details.
    if (format === 'pdf') await require('../../../lib/pdf').loadCompany();

    const today = new Date().toISOString().split('T')[0];
    const rangeFrom = from || `${new Date().getFullYear()}-01-01`;
    const rangeTo   = to   || today;

    switch (report) {

      case 'payroll_summary': {
        const { generatePayrollExcel } = require('../../../lib/excel');
        const { generatePayslip }      = require('../../../lib/pdf');
        if (!period) return err('period required for payroll export', 400);
        const run     = await queryOne(`SELECT * FROM payroll_runs WHERE period=?`, [period]);
        if (!run) return err('No payroll run found for this period', 404);
        const entries = await query(
          `SELECT pe.*, e.first_name||' '||e.last_name as name, e.department, e.emp_no
           FROM payroll_entries pe JOIN employees e ON pe.employee_id=e.id WHERE pe.run_id=?`, [run.id]
        );
        if (format === 'excel') {
          const result = await generatePayrollExcel(run, entries, period);
          return ok({ exported: true, url: result.url, filename: `payroll_${period}.xlsx` });
        }
        // PDF payslips — generate for all, return zip path
        const pdfs = [];
        for (const entry of entries) {
          const emp = await queryOne(`SELECT * FROM employees WHERE id=?`, [entry.employee_id]);
          if (emp) {
            const result = await generatePayslip(emp, entry, period);
            pdfs.push(result.url);
          }
        }
        return ok({ exported: true, count: pdfs.length, files: pdfs, message: `${pdfs.length} payslip PDFs generated` });
      }

      case 'aged_debtors': {
        const clients = await query(
          `SELECT c.*, e.first_name||' '||e.last_name as account_owner
           FROM clients c LEFT JOIN employees e ON c.account_owner=e.id
           WHERE c.outstanding > 0 ORDER BY c.outstanding DESC`
        );
        if (format === 'pdf') {
          const { generateAgedDebtorsReport } = require('../../../lib/pdf');
          const result = await generateAgedDebtorsReport(clients, auth.user.name);
          return ok({ exported: true, url: result.url, filename: `aged_debtors_${today}.pdf` });
        }
        const { generateAgedDebtorsExcel } = require('../../../lib/excel');
        const result = await generateAgedDebtorsExcel(clients);
        return ok({ exported: true, url: result.url, filename: `aged_debtors_${today}.xlsx` });
      }

      case 'project_profitability': {
        const projects = await query(
          `SELECT p.*, c.name as client_name, e.first_name||' '||e.last_name as pm
           FROM projects p LEFT JOIN clients c ON p.client_id=c.id LEFT JOIN employees e ON p.pm_id=e.id
           WHERE p.status != 'archived'`
        );
        const { generateProjectPLExcel } = require('../../../lib/excel');
        const result = await generateProjectPLExcel(projects);
        return ok({ exported: true, url: result.url, filename: `project_pl_${today}.xlsx` });
      }

      case 'asset_register': {
        const assets = await query(
          `SELECT a.*, e.first_name||' '||e.last_name as custodian_name
           FROM assets a LEFT JOIN employees e ON a.custodian=e.id WHERE a.status != 'disposed'`
        );
        const [totals] = await query(`SELECT SUM(cost) as total_cost, SUM(nbv) as total_nbv FROM assets WHERE status='in_use'`);
        const { generateAssetRegisterExcel } = require('../../../lib/excel');
        const result = await generateAssetRegisterExcel(assets, totals);
        return ok({ exported: true, url: result.url, filename: `asset_register_${today}.xlsx` });
      }

      case 'audit_trail': {
        let auditSql = `SELECT al.*, u.role as user_role FROM audit_log al LEFT JOIN users u ON al.user_id=u.id WHERE 1=1`;
        const params = [];
        if (body.module) { auditSql += ` AND al.module=?`; params.push(body.module); }
        if (body.user_id){ auditSql += ` AND al.user_id=?`; params.push(body.user_id); }
        if (rangeFrom)   { auditSql += ` AND al.created_at >= ?`; params.push(rangeFrom); }
        if (rangeTo)     { auditSql += ` AND al.created_at <= ?`; params.push(rangeTo + 'T23:59:59'); }
        auditSql += ` ORDER BY al.created_at DESC LIMIT 5000`;
        const entries = await query(auditSql, params);

        if (format === 'pdf') {
          const { generateAuditTrail } = require('../../../lib/pdf');
          const result = await generateAuditTrail(entries, body, auth.user.name);
          return ok({ exported: true, url: result.url, filename: `audit_trail_${today}.pdf` });
        }
        const { generateAuditTrailExcel } = require('../../../lib/excel');
        const result = await generateAuditTrailExcel(entries, body);
        return ok({ exported: true, url: result.url, filename: `audit_trail_${today}.xlsx` });
      }

      case 'calibration_cert': {
        const { cert_id } = body;
        if (!cert_id) return err('cert_id required', 400);
        const cert  = await queryOne(`SELECT * FROM calibration_certs WHERE id=?`, [cert_id]);
        if (!cert) return err('Certificate not found', 404);
        const client= await queryOne(`SELECT * FROM clients WHERE id=?`, [cert.client_id]);
        const tech  = await queryOne(`SELECT * FROM employees WHERE id=?`, [cert.technician_id]);
        const ref   = cert.ref_standard_id ? await queryOne(`SELECT * FROM reference_standards WHERE id=?`, [cert.ref_standard_id]) : null;
        const { generateCalibrationCert } = require('../../../lib/pdf');
        const result = await generateCalibrationCert(cert, client, tech, ref);
        // Store path on cert record
        await run(`UPDATE calibration_certs SET cert_path=? WHERE id=?`, [result.url, cert_id]);
        return ok({ exported: true, url: result.url, filename: `cert_${cert.cert_no}.pdf` });
      }

      // RPT-NEW-1: Inventory Report (point 4) — filterable by category/location/low-stock status
      case 'inventory': {
        const { category_id, location_id, status } = body;
        let sql = `SELECT i.code, i.name, c.name as category, i.unit, i.reorder_level,
                          (SELECT COALESCE(SUM(sb.quantity),0) FROM stock_balances sb WHERE sb.item_id=i.id ${location_id ? 'AND sb.location_id=?' : ''}) as balance,
                          i.unit_cost
                   FROM items i LEFT JOIN item_categories c ON i.category_id=c.id
                   WHERE i.is_active=1`;
        const params = location_id ? [location_id] : [];
        if (category_id) { sql += ` AND i.category_id=?`; params.push(category_id); }
        sql += ` ORDER BY i.name`;
        let rows = await query(sql, params);
        if (status === 'low_stock') rows = rows.filter(r => r.balance <= r.reorder_level);

        const columns = [
          { key: 'code', label: 'Item Code', weight: 1.2, width: 14 },
          { key: 'name', label: 'Item Name', weight: 2.5, width: 30 },
          { key: 'category', label: 'Category', weight: 1.5, width: 20 },
          { key: 'unit', label: 'Unit', weight: 0.8, width: 10 },
          { key: 'balance', label: 'Balance', weight: 1, width: 12, numFmt: '#,##0', color: (v, r) => (v <= r.reorder_level ? 'C00000' : undefined) },
          { key: 'reorder_level', label: 'Reorder Level', weight: 1, width: 14, numFmt: '#,##0' },
          { key: 'unit_cost', label: 'Unit Cost (Kshs)', weight: 1, width: 16, numFmt: '#,##0', format: v => Math.round(v || 0) },
        ];
        const filtersSummary = [category_id && 'Category filter', location_id && 'Location filter', status && `Status: ${status}`].filter(Boolean).join(', ') || 'None';

        if (format === 'excel') {
          const { generateTabularReportExcel } = require('../../../lib/excel');
          const result = await generateTabularReportExcel({ title: 'Inventory Report', subtitle: `As at ${today} — Filters: ${filtersSummary}`, columns, rows, sheetName: 'Inventory', filenamePrefix: 'inventory_report' });
          return ok({ exported: true, url: result.url, filename: `inventory_report_${today}.xlsx` });
        }
        const { generateTabularReport } = require('../../../lib/pdf');
        const result = await generateTabularReport({ title: 'Inventory Report', filtersSummary, columns, rows, generatedBy: auth.user.name, filenamePrefix: 'inventory_report' });
        return ok({ exported: true, url: result.url, filename: `inventory_report_${today}.pdf` });
      }

      // RPT-NEW-2: Requisitions Report (point 4) — filterable by department/status/date
      case 'requisitions': {
        const { department, status: reqStatus } = body;
        let sql = `SELECT sr.req_no, sr.department, sr.purpose, sr.status, sr.priority, sr.created_at,
                          e.first_name||' '||e.last_name as requested_by_name
                   FROM store_requisitions sr LEFT JOIN employees e ON sr.requested_by=e.id
                   WHERE date(sr.created_at) BETWEEN ? AND ?`;
        const params = [rangeFrom, rangeTo];
        if (department) { sql += ` AND sr.department=?`; params.push(department); }
        if (reqStatus) { sql += ` AND sr.status=?`; params.push(reqStatus); }
        sql += ` ORDER BY sr.created_at DESC`;
        const rows = await query(sql, params);

        const columns = [
          { key: 'req_no', label: 'Req No.', weight: 1, width: 14 },
          { key: 'department', label: 'Department', weight: 1.3, width: 18 },
          { key: 'requested_by_name', label: 'Requested By', weight: 1.3, width: 18 },
          { key: 'purpose', label: 'Purpose', weight: 2.2, width: 28 },
          { key: 'priority', label: 'Priority', weight: 0.8, width: 10 },
          { key: 'status', label: 'Status', weight: 1, width: 14, color: v => (v === 'rejected' ? 'C00000' : v === 'closed' ? '1E6B3C' : 'B8600B') },
          { key: 'created_at', label: 'Created', weight: 1.2, width: 16, format: v => v ? new Date(v).toLocaleDateString('en-KE') : '—' },
        ];
        const filtersSummary = [`Date: ${rangeFrom} to ${rangeTo}`, department && `Department: ${department}`, reqStatus && `Status: ${reqStatus}`].filter(Boolean).join(', ');

        if (format === 'excel') {
          const { generateTabularReportExcel } = require('../../../lib/excel');
          const result = await generateTabularReportExcel({ title: 'Store Requisitions Report', subtitle: filtersSummary, columns, rows, sheetName: 'Requisitions', filenamePrefix: 'requisitions_report' });
          return ok({ exported: true, url: result.url, filename: `requisitions_report_${today}.xlsx` });
        }
        const { generateTabularReport } = require('../../../lib/pdf');
        const result = await generateTabularReport({ title: 'Store Requisitions Report', filtersSummary, columns, rows, generatedBy: auth.user.name, filenamePrefix: 'requisitions_report' });
        return ok({ exported: true, url: result.url, filename: `requisitions_report_${today}.pdf` });
      }

      // RPT-NEW-3: Vehicles Report (point 4) — filterable by status
      case 'vehicles': {
        const { status: vehStatus } = body;
        let sql = `SELECT v.reg_no, v.make, v.model, v.status, v.mileage, v.insurance_to, v.inspection_to, v.service_due,
                          e.first_name||' '||e.last_name as assigned_driver_name
                   FROM vehicles v LEFT JOIN employees e ON v.assigned_driver=e.id WHERE 1=1`;
        const params = [];
        if (vehStatus) { sql += ` AND v.status=?`; params.push(vehStatus); }
        sql += ` ORDER BY v.reg_no`;
        const rows = await query(sql, params);

        const columns = [
          { key: 'reg_no', label: 'Reg No.', weight: 1, width: 12 },
          { key: 'make', label: 'Make', weight: 1, width: 14 },
          { key: 'model', label: 'Model', weight: 1, width: 14 },
          { key: 'assigned_driver_name', label: 'Driver', weight: 1.3, width: 18 },
          { key: 'mileage', label: 'Mileage (km)', weight: 1, width: 14, numFmt: '#,##0' },
          { key: 'insurance_to', label: 'Insurance Expiry', weight: 1.2, width: 16, format: v => v ? new Date(v).toLocaleDateString('en-KE') : '—', color: v => (v && new Date(v) < new Date() ? 'C00000' : undefined) },
          { key: 'inspection_to', label: 'Inspection Due', weight: 1.2, width: 16, format: v => v ? new Date(v).toLocaleDateString('en-KE') : '—' },
          { key: 'status', label: 'Status', weight: 0.8, width: 10 },
        ];
        const filtersSummary = vehStatus ? `Status: ${vehStatus}` : 'None';

        if (format === 'excel') {
          const { generateTabularReportExcel } = require('../../../lib/excel');
          const result = await generateTabularReportExcel({ title: 'Fleet / Vehicles Report', subtitle: `As at ${today} — Filters: ${filtersSummary}`, columns, rows, sheetName: 'Vehicles', filenamePrefix: 'vehicles_report' });
          return ok({ exported: true, url: result.url, filename: `vehicles_report_${today}.xlsx` });
        }
        const { generateTabularReport } = require('../../../lib/pdf');
        const result = await generateTabularReport({ title: 'Fleet / Vehicles Report', filtersSummary, columns, rows, generatedBy: auth.user.name, filenamePrefix: 'vehicles_report' });
        return ok({ exported: true, url: result.url, filename: `vehicles_report_${today}.pdf` });
      }

      // RPT-NEW-4: User Activity Report (point 4) — filterable by date range, sourced from audit_log
      case 'user_activity': {
        const { user_name } = body;
        let sql = `SELECT user_name, action, module, created_at FROM audit_log WHERE date(created_at) BETWEEN ? AND ?`;
        const params = [rangeFrom, rangeTo];
        if (user_name) { sql += ` AND user_name=?`; params.push(user_name); }
        sql += ` ORDER BY created_at DESC LIMIT 2000`;
        const rows = await query(sql, params);

        const columns = [
          { key: 'created_at', label: 'Timestamp', weight: 1.3, width: 18, format: v => v ? new Date(v).toLocaleString('en-KE') : '—' },
          { key: 'user_name', label: 'User', weight: 1.2, width: 18 },
          { key: 'module', label: 'Module', weight: 1, width: 14 },
          { key: 'action', label: 'Action', weight: 1.8, width: 24 },
        ];
        const filtersSummary = [`Date: ${rangeFrom} to ${rangeTo}`, user_name && `User: ${user_name}`].filter(Boolean).join(', ');

        if (format === 'excel') {
          const { generateTabularReportExcel } = require('../../../lib/excel');
          const result = await generateTabularReportExcel({ title: 'User Activity Report', subtitle: filtersSummary, columns, rows, sheetName: 'User Activity', filenamePrefix: 'user_activity_report' });
          return ok({ exported: true, url: result.url, filename: `user_activity_report_${today}.xlsx` });
        }
        const { generateTabularReport } = require('../../../lib/pdf');
        const result = await generateTabularReport({ title: 'User Activity Report', filtersSummary, columns, rows, generatedBy: auth.user.name, filenamePrefix: 'user_activity_report' });
        return ok({ exported: true, url: result.url, filename: `user_activity_report_${today}.pdf` });
      }

      default:
        return err(`Unknown report: ${report}`, 400);
    }
  } catch (e) {
    console.error('[Reports POST]', e);
    return err('Export failed: ' + e.message, 500);
  }
}
