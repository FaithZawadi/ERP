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
      case 'create_invoice': {
        const { client_id, date, due_date, lines, project_id, submit_to_etims } = body;
        if (!client_id || !lines?.length) return err('client_id and lines required', 400);

        const client = await queryOne(`SELECT * FROM clients WHERE id=?`, [client_id]);
        if (!client) return err('Client not found', 404);

        // Which legal entity is this invoice issued under? Prefer the
        // project's company (most specific — a project is the actual
        // contracting vehicle), then the client's company, then fall back
        // to QSL's own primary company record so invoices are never left
        // unattributed.
        let invoiceCompanyId = null;
        if (project_id) {
          const proj = await queryOne(`SELECT company_id FROM projects WHERE id=?`, [project_id]);
          invoiceCompanyId = proj?.company_id || null;
        }
        if (!invoiceCompanyId) invoiceCompanyId = client.company_id || null;
        if (!invoiceCompanyId) {
          const primary = await queryOne(`SELECT id FROM companies WHERE is_primary=1`);
          invoiceCompanyId = primary?.id || null;
        }

        // STK-010/011: Minimum Selling Price enforcement — block any line
        // priced below the catalog item's MSP floor. Only applies to lines
        // that reference a real catalog item (item_id); free-text/service
        // lines with no item_id are unaffected, matching how MSP is scoped
        // in the Stores module (it's a per-item floor, not a blanket rule).
        // Exceptions require CFO/MD approval per blueprint §7.2 — modelled
        // here as an explicit override flag the approver must set, logged
        // to the audit trail so it's always traceable to who authorised it.
        for (const l of lines) {
          if (!l.item_id) continue;
          const item = await queryOne(`SELECT code, name, msp FROM items WHERE id=?`, [l.item_id]);
          if (!item) continue;
          const lineUnitPrice = l.unit_price ?? (l.amount && l.quantity ? l.amount / l.quantity : null);
          if (item.msp > 0 && lineUnitPrice != null && lineUnitPrice < item.msp && !l.msp_override_approved_by) {
            return err(
              `STK-010: Unit price Kshs ${lineUnitPrice.toLocaleString('en-KE')} for "${item.name}" (${item.code}) is below the Minimum Selling Price of Kshs ${item.msp.toLocaleString('en-KE')}. CFO or MD approval is required to sell below MSP — resubmit with msp_override_approved_by set on this line.`,
              400
            );
          }
        }

        // Calculate VAT per line — standard rate is configurable (finance.vat_rate)
        const vatRate = await require('../../../lib/settings').getNum('finance.vat_rate', 0.16);
        const processedLines = lines.map(l => {
          const vat = calculateVAT(l.amount || (l.quantity * l.unit_price), l.vat_category || 'A', vatRate);
          return { ...l, ...vat, id: uuid() };
        });

        const subtotal   = processedLines.reduce((s, l) => s + l.exclusive, 0);
        const vatAmount  = processedLines.reduce((s, l) => s + l.vat_amount, 0);
        const total      = subtotal + vatAmount;

        const invoiceId  = uuid();
        const invoiceNo  = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO tax_invoices (id,invoice_no,client_id,client_pin,company_id,date,due_date,subtotal,vat_amount,total,status,project_id,created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
            [invoiceId, invoiceNo, client_id, client.kra_pin, invoiceCompanyId, date, due_date, subtotal, vatAmount, total, project_id, auth.user.employee_id]
          );
          for (const l of processedLines) {
            await dbRun(
              `INSERT INTO tax_invoice_lines (id,invoice_id,item_id,description,quantity,unit_price,vat_category,vat_rate,amount,vat_amount)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
              [l.id, invoiceId, l.item_id || null, l.description, l.quantity||1, l.unit_price||l.exclusive, l.vat_category||'A', l.rate||0.16, l.exclusive, l.vat_amount]
            );
          }
        });

        // Log any MSP override on the audit trail so exceptions are always traceable
        const overrides = lines.filter(l => l.item_id && l.msp_override_approved_by);
        for (const l of overrides) {
          await logAudit(query, {
            userId: auth.user.id, userName: auth.user.name,
            action: 'MSP_OVERRIDE_APPROVED', module: 'Tax',
            recordId: invoiceId, newValue: { item_id: l.item_id, unit_price: l.unit_price, approved_by: l.msp_override_approved_by },
          });
        }

        let etimsResult = null;
        if (submit_to_etims) {
          const invoice = { id: invoiceId, invoice_no: invoiceNo, date, total };
          etimsResult = await submitInvoice(invoice, processedLines, client);

          if (etimsResult.success) {
            const cu_no       = etimsResult.data?.data?.rcptNo || etimsResult.data?.rcptNo;
            const receipt_no  = etimsResult.data?.data?.intrlData || '';
            await run(
              `UPDATE tax_invoices SET etims_status='submitted', etims_cu_no=?, etims_receipt_no=?, etims_submitted_at=?, status='issued' WHERE id=?`,
              [cu_no, receipt_no, new Date().toISOString(), invoiceId]
            );
          }

          await logIntegration(query, {
            service: 'etims', direction: 'outbound', endpoint: '/trnsSales/saveSales',
            request: { invoice_no: invoiceNo, total }, response: etimsResult,
            success: etimsResult.success, refId: invoiceId,
          });
        }

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'CREATE_TAX_INVOICE', module: 'Tax',
          recordId: invoiceId, newValue: { invoice_no: invoiceNo, total, client_id },
        });

        // Send invoice email to client
        let email_sent = false;
        if (client?.email) {
          try {
            const { sendInvoice } = require('../../../lib/email');
            const invoiceData = { id: invoiceId, invoice_no: invoiceNo, date, due_date, vat_amount: vatAmount, total, etims_cu_no: etimsResult?.data?.data?.rcptNo };
            await sendInvoice(invoiceData, client, processedLines);
            email_sent = true;
          } catch (emailErr) {
            console.error('[Invoice email]', emailErr.message);
          }
        }

        return ok({ invoice_id: invoiceId, invoice_no: invoiceNo, subtotal, vat_amount: vatAmount, total, etims: etimsResult, email_sent }, 201);
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
