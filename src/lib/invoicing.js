// src/lib/invoicing.js — the one place an invoice actually gets created.
//
// Extracted out of /api/tax's create_invoice handler so a second caller
// (calibration jobs — see generate_job_invoice in /api/calibration) can
// produce a real, fully-compliant invoice (MSP floor enforced, VAT
// calculated, optionally submitted to eTIMS, client emailed) without
// duplicating ~130 lines of that logic and risking the two copies
// drifting apart. Both /api/tax and /api/calibration call this.
//
// Callers pass an optional source_quote_id and/or source_job_id — if
// given, the originating quote/job is marked as invoiced/billed in the
// same run, so "was this already billed?" is always answerable from the
// quote or job record itself, not just from the invoice side.

const { v4: uuid } = require('uuid');
const { queryOne, run, transaction } = require('./db');
const { calculateVAT } = require('./tax');
const { getNum } = require('./settings');

async function createInvoiceRecord({ client_id, date, due_date, lines, project_id, submit_to_etims, source_quote_id, source_job_id, auth }) {
  if (!client_id || !lines?.length) return { ok: false, error: 'client_id and lines required', status: 400 };

  if (source_quote_id) {
    const sourceQuote = await queryOne(`SELECT status FROM quotes WHERE id=?`, [source_quote_id]);
    if (!sourceQuote) return { ok: false, error: 'Source quote not found', status: 404 };
    if (sourceQuote.status === 'invoiced') return { ok: false, error: 'This quote has already been converted to an invoice', status: 400 };
  }
  if (source_job_id) {
    const sourceJob = await queryOne(`SELECT status, billing_status FROM calibration_jobs WHERE id=?`, [source_job_id]);
    if (!sourceJob) return { ok: false, error: 'Source job not found', status: 404 };
    if (sourceJob.status !== 'complete') return { ok: false, error: 'Job must be complete before it can be invoiced', status: 400 };
    if (sourceJob.billing_status === 'invoiced') return { ok: false, error: 'This job has already been invoiced', status: 400 };
  }

  const client = await queryOne(`SELECT * FROM clients WHERE id=?`, [client_id]);
  if (!client) return { ok: false, error: 'Client not found', status: 404 };

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

  // STK-010/011: Minimum Selling Price enforcement — unchanged from the
  // original Tax-only implementation. Applies to catalog-item lines only.
  for (const l of lines) {
    if (!l.item_id) continue;
    const item = await queryOne(`SELECT code, name, msp FROM items WHERE id=?`, [l.item_id]);
    if (!item) continue;
    const lineUnitPrice = l.unit_price ?? (l.amount && l.quantity ? l.amount / l.quantity : null);
    if (item.msp > 0 && lineUnitPrice != null && lineUnitPrice < item.msp && !l.msp_override_approved_by) {
      return {
        ok: false, status: 400,
        error: `STK-010: Unit price Kshs ${lineUnitPrice.toLocaleString('en-KE')} for "${item.name}" (${item.code}) is below the Minimum Selling Price of Kshs ${item.msp.toLocaleString('en-KE')}. CFO or MD approval is required to sell below MSP — resubmit with msp_override_approved_by set on this line.`,
      };
    }
  }

  const vatRate = await getNum('finance.vat_rate', 0.16);
  const processedLines = lines.map(l => {
    const vat = calculateVAT(l.amount || (l.quantity * l.unit_price), l.vat_category || 'A', vatRate);
    return { ...l, ...vat, id: uuid() };
  });

  const subtotal  = processedLines.reduce((s, l) => s + l.exclusive, 0);
  const vatAmount = processedLines.reduce((s, l) => s + l.vat_amount, 0);
  const total     = subtotal + vatAmount;

  const invoiceId = uuid();
  const invoiceNo = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

  await transaction(async ({ run: dbRun }) => {
    await dbRun(
      `INSERT INTO tax_invoices (id,invoice_no,client_id,client_pin,company_id,date,due_date,subtotal,vat_amount,total,status,project_id,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
      [invoiceId, invoiceNo, client_id, client.kra_pin, invoiceCompanyId, date, due_date, subtotal, vatAmount, total, project_id, auth?.user?.employee_id]
    );
    for (const l of processedLines) {
      await dbRun(
        `INSERT INTO tax_invoice_lines (id,invoice_id,item_id,description,quantity,unit_price,vat_category,vat_rate,amount,vat_amount)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [l.id, invoiceId, l.item_id || null, l.description, l.quantity || 1, l.unit_price || l.exclusive, l.vat_category || 'A', l.rate || 0.16, l.exclusive, l.vat_amount]
      );
    }
    if (source_quote_id) await dbRun(`UPDATE quotes SET status='invoiced' WHERE id=?`, [source_quote_id]);
    if (source_job_id) await dbRun(`UPDATE calibration_jobs SET invoice_id=?, billing_status='invoiced' WHERE id=?`, [invoiceId, source_job_id]);
  });

  const overrides = lines.filter(l => l.item_id && l.msp_override_approved_by);
  for (const l of overrides) {
    const { logAudit } = require('./auth');
    const { query } = require('./db');
    await logAudit(query, {
      userId: auth?.user?.id, userName: auth?.user?.name,
      action: 'MSP_OVERRIDE_APPROVED', module: 'Tax',
      recordId: invoiceId, newValue: { item_id: l.item_id, unit_price: l.unit_price, approved_by: l.msp_override_approved_by },
    });
  }

  let etimsResult = null;
  if (submit_to_etims) {
    const { submitInvoice, logIntegration } = require('./integrations/kra-etims');
    const { query } = require('./db');
    const invoice = { id: invoiceId, invoice_no: invoiceNo, date, total };
    etimsResult = await submitInvoice(invoice, processedLines, client);

    if (etimsResult.success) {
      const cu_no      = etimsResult.data?.data?.rcptNo || etimsResult.data?.rcptNo;
      const receipt_no = etimsResult.data?.data?.intrlData || '';
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

  {
    const { logAudit } = require('./auth');
    const { query } = require('./db');
    await logAudit(query, {
      userId: auth?.user?.id, userName: auth?.user?.name,
      action: 'CREATE_TAX_INVOICE', module: 'Tax',
      recordId: invoiceId, newValue: { invoice_no: invoiceNo, total, client_id, source_quote_id, source_job_id },
    });
  }

  let email_sent = false;
  if (client?.email) {
    try {
      const { sendInvoice } = require('./email');
      const invoiceData = { id: invoiceId, invoice_no: invoiceNo, date, due_date, vat_amount: vatAmount, total, etims_cu_no: etimsResult?.data?.data?.rcptNo };
      await sendInvoice(invoiceData, client, processedLines);
      email_sent = true;
    } catch (emailErr) {
      console.error('[Invoice email]', emailErr.message);
    }
  }

  return { ok: true, status: 201, data: { invoice_id: invoiceId, invoice_no: invoiceNo, subtotal, vat_amount: vatAmount, total, etims: etimsResult, email_sent } };
}

module.exports = { createInvoiceRecord };
