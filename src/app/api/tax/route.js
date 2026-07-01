// src/app/api/tax/route.js — Tax & KRA Compliance API

import { NextResponse } from 'next/server';
import { v4 as uuid }   from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';
import { calculateVAT, computeVATReturn, computePAYEReturn, STATUTORY_OBLIGATIONS, getNextDueDate } from '../../../lib/tax';
import { submitInvoice, logIntegration } from '../../../lib/integrations/kra-etims';

// ── GET /api/tax?section=... ──────────────────────────────────────────────────

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'dashboard';
  const period  = searchParams.get('period');

  try {
    switch (section) {

      case 'dashboard': {
        const [vatStats]    = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN status='filed' THEN 1 ELSE 0 END) as filed FROM vat_returns`);
        const [payeStats]   = await query(`SELECT COUNT(*) as total, SUM(CASE WHEN status='filed' THEN 1 ELSE 0 END) as filed FROM paye_returns`);
        const [invoiceStats]= await query(`SELECT COUNT(*) as total, SUM(CASE WHEN etims_status='submitted' THEN 1 ELSE 0 END) as submitted, SUM(total) as total_value FROM tax_invoices`);
        const obligations   = STATUTORY_OBLIGATIONS.map(o => ({
          ...o,
          next_due: getNextDueDate(o) || 'See schedule',
        }));
        return ok({ vatStats, payeStats, invoiceStats, obligations });
      }

      case 'invoices': {
        const rows = await query(
          `SELECT ti.*, c.name as client_name, c.kra_pin as client_pin
           FROM tax_invoices ti
           LEFT JOIN clients c ON ti.client_id=c.id
           ORDER BY ti.date DESC LIMIT 100`
        );
        return ok(rows);
      }

      case 'invoice_payments': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const rows = await query(
          `SELECT p.*, e.first_name||' '||e.last_name as recorded_by_name
           FROM invoice_payments p LEFT JOIN employees e ON p.recorded_by=e.id
           WHERE p.invoice_id=? ORDER BY p.date DESC, p.created_at DESC`,
          [id]
        );
        return ok(rows);
      }

      // TAX-PDF-001: the actual Tax Invoice (eTIMS) PDF. Same gap pattern as
      // calibration certificates — the invoice record and its eTIMS
      // submission were both fully wired, but generateInvoice() in pdf.js
      // was never actually called from any route. Generated on demand here.
      case 'invoice_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const invoice = await queryOne(
          `SELECT ti.*, c.name as client_name, c.address as client_address, c.kra_pin as client_pin
           FROM tax_invoices ti LEFT JOIN clients c ON ti.client_id=c.id WHERE ti.id=?`, [id]
        );
        if (!invoice) return err('Invoice not found', 404);
        const lines = await query(`SELECT * FROM tax_invoice_lines WHERE invoice_id=?`, [id]);
        const { generateInvoice, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateInvoice(
          invoice,
          { name: invoice.client_name, address: invoice.client_address, kra_pin: invoice.client_pin },
          lines
        );
        return ok(result);
      }

      case 'vat_return': {
        if (period) {
          const ret = await queryOne(`SELECT * FROM vat_returns WHERE period=?`, [period]);
          return ok(ret || null);
        }
        return ok(await query(`SELECT * FROM vat_returns ORDER BY period DESC LIMIT 24`));
      }

      case 'paye_return': {
        if (period) {
          const ret = await queryOne(`SELECT * FROM paye_returns WHERE period=?`, [period]);
          return ok(ret || null);
        }
        return ok(await query(`SELECT * FROM paye_returns ORDER BY period DESC LIMIT 24`));
      }

      case 'etims_log': {
        return ok(await query(
          `SELECT * FROM integration_logs WHERE service='etims' ORDER BY created_at DESC LIMIT 50`
        ));
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Tax GET]', e);
    return err('Server error', 500);
  }
}

// ── POST /api/tax ─────────────────────────────────────────────────────────────

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {

      // ── Create & optionally submit tax invoice ───────────────────────────
      // Delegates to src/lib/invoicing.js — the same path Calibration's
      // generate_job_invoice uses, so a Tax-created invoice and a
      // Job-created invoice go through identical MSP/VAT/eTIMS handling.
      case 'create_invoice': {
        const { client_id, date, due_date, lines, project_id, submit_to_etims, source_quote_id } = body;
        const { createInvoiceRecord } = require('../../../lib/invoicing');
        const result = await createInvoiceRecord({ client_id, date, due_date, lines, project_id, submit_to_etims, source_quote_id, auth });
        if (!result.ok) return err(result.error, result.status);
        return ok(result.data, result.status);
      }

      // ── Record a payment against an invoice — bank transfer, cheque,
      // cash, or any method other than the automated M-Pesa STK callback
      // (which records itself via the /api/integrations PUT webhook).
      // Supports partial payments: an invoice can receive several
      // payments over time, and payment_status/amount_paid always
      // reflect the running total rather than a single paid/unpaid flag.
      case 'record_payment': {
        const { invoice_id, amount, method, reference, date, notes } = body;
        if (!invoice_id || !amount || Number(amount) <= 0) return err('invoice_id and a positive amount are required', 400);
        if (!method) return err('Payment method is required', 400);

        const invoice = await queryOne(`SELECT id, total, amount_paid FROM tax_invoices WHERE id=?`, [invoice_id]);
        if (!invoice) return err('Invoice not found', 404);

        const paymentId = uuid();
        await run(
          `INSERT INTO invoice_payments (id,invoice_id,amount,method,reference,date,recorded_by,notes) VALUES (?,?,?,?,?,?,?,?)`,
          [paymentId, invoice_id, Number(amount), method, reference || null, date || new Date().toISOString().slice(0, 10), auth.user.employee_id, notes || null]
        );

        // Recompute from the ledger rather than incrementing in place —
        // the source of truth is the sum of invoice_payments rows, so this
        // stays correct even if a payment is later corrected/reversed.
        const [{ total_paid }] = await query(`SELECT COALESCE(SUM(amount),0) as total_paid FROM invoice_payments WHERE invoice_id=?`, [invoice_id]);
        const paymentStatus = total_paid >= invoice.total ? 'paid' : total_paid > 0 ? 'partially_paid' : 'unpaid';
        await run(
          `UPDATE tax_invoices SET amount_paid=?, payment_status=?, status=CASE WHEN ? >= total THEN 'paid' ELSE status END WHERE id=?`,
          [total_paid, paymentStatus, total_paid, invoice_id]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name, action: 'RECORD_INVOICE_PAYMENT', module: 'Tax',
          recordId: invoice_id, newValue: { amount, method, reference, payment_status: paymentStatus, total_paid },
        });

        return ok({ payment_id: paymentId, amount_paid: total_paid, balance_due: Math.max(0, invoice.total - total_paid), payment_status: paymentStatus }, 201);
      }


      // ── Compute VAT return for a period ─────────────────────────────────
      case 'compute_vat_return': {
        const { period } = body;
        if (!period) return err('period required (YYYY-MM)', 400);

        const periodStart = `${period}-01`;
        const periodEnd   = `${period}-31`;

        const sales = await query(
          `SELECT SUM(subtotal) as amount, SUM(vat_amount) as vat_amount FROM tax_invoices WHERE date BETWEEN ? AND ? AND status != 'cancelled'`,
          [periodStart, periodEnd]
        );
        const purchases = await query(
          `SELECT SUM(l.total) as amount, SUM(l.total*0.16) as vat_amount FROM lpo_lines l JOIN lpos p ON l.lpo_id=p.id WHERE p.date BETWEEN ? AND ?`,
          [periodStart, periodEnd]
        );

        const result = computeVATReturn(sales, purchases);

        const existing = await queryOne(`SELECT id FROM vat_returns WHERE period=?`, [period]);
        if (existing) {
          await run(`UPDATE vat_returns SET output_vat=?,input_vat=?,net_vat=? WHERE period=?`,
            [result.output_vat, result.input_vat, result.net_vat, period]);
        } else {
          await run(`INSERT INTO vat_returns (id,period,output_vat,input_vat,net_vat) VALUES (?,?,?,?,?)`,
            [uuid(), period, result.output_vat, result.input_vat, result.net_vat]);
        }

        return ok({ period, ...result });
      }

      // ── Compute PAYE return ───────────────────────────────────────────────
      case 'compute_paye_return': {
        const { period } = body;
        if (!period) return err('period required', 400);

        const entries = await query(
          `SELECT pe.* FROM payroll_entries pe JOIN payroll_runs pr ON pe.run_id=pr.id WHERE pr.period=?`,
          [period]
        );
        if (!entries.length) return err('No payroll entries for this period', 404);

        const result = computePAYEReturn(entries);

        const existing = await queryOne(`SELECT id FROM paye_returns WHERE period=?`, [period]);
        if (!existing) {
          await run(`INSERT INTO paye_returns (id,period,total_gross,total_paye) VALUES (?,?,?,?)`,
            [uuid(), period, result.total_gross, result.total_paye]);
        }

        return ok({ period, ...result });
      }

      // ── File return ────────────────────────────────────────────────────────
      case 'file_return': {
        const { return_type, period, payment_ref } = body;
        if (!return_type || !period) return err('return_type and period required', 400);

        const table = return_type === 'vat' ? 'vat_returns' : 'paye_returns';
        await run(
          `UPDATE ${table} SET status='filed', filed_at=?, payment_ref=? WHERE period=?`,
          [new Date().toISOString(), payment_ref, period]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: `FILE_${return_type.toUpperCase()}_RETURN`, module: 'Tax',
          newValue: { period, payment_ref },
        });

        return ok({ filed: true, return_type, period });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Tax POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
