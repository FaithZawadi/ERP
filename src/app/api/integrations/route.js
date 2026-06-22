// src/app/api/integrations/route.js — External Integration Gateway API

import { NextResponse } from 'next/server';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

// ── GET /api/integrations?service=etims|ppip|mpesa|sms ───────────────────────

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const service = searchParams.get('service') || 'status';

  try {
    switch (service) {

      // Health / status of all integrations
      case 'status': {
        const logs = await query(
          `SELECT service, MAX(created_at) as last_call, SUM(success) as successes,
                  COUNT(*) as total FROM integration_logs GROUP BY service`
        );
        return ok({
          integrations: [
            { name: 'KRA eTIMS',      code: 'etims',  status: process.env.KRA_ETIMS_KEY     ? 'configured' : 'not_configured', docs: 'https://developer.kra.go.ke' },
            { name: 'PPIP Tenders',   code: 'ppip',   status: process.env.PPIP_API_KEY       ? 'configured' : 'not_configured', docs: 'https://tenders.go.ke/api' },
            { name: 'M-PESA Daraja',  code: 'mpesa',  status: process.env.MPESA_CONSUMER_KEY ? 'configured' : 'not_configured', docs: 'https://developer.safaricom.co.ke' },
            { name: 'Email (SMTP)',   code: 'smtp',   status: process.env.SMTP_USER           ? 'configured' : 'not_configured', docs: null },
            { name: "Africa's Talking SMS", code: 'sms', status: process.env.AT_API_KEY      ? 'configured' : 'not_configured', docs: 'https://africastalking.com/docs' },
          ],
          recent_logs: logs,
        });
      }

      // PPIP tender search
      case 'ppip_tenders': {
        const { searchTenders } = require('../../../lib/integrations/ppip');
        const keywords = searchParams.get('keywords') || 'calibration instrumentation engineering';
        const result   = await searchTenders({ keywords });
        return ok(result.data);
      }

      // Integration logs
      case 'logs': {
        const rows = await query(
          `SELECT * FROM integration_logs ORDER BY created_at DESC LIMIT 100`
        );
        return ok(rows);
      }

      default:
        return err('Unknown service', 400);
    }
  } catch (e) {
    console.error('[Integrations GET]', e);
    return err('Server error', 500);
  }
}

// ── POST /api/integrations — trigger integrations ─────────────────────────────

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {

      // ── Test eTIMS connection ────────────────────────────────────────────
      case 'test_etims': {
        const { initialize, logIntegration } = require('../../../lib/integrations/kra-etims');
        const result = await initialize();
        await logIntegration(query, {
          service: 'etims', direction: 'outbound', endpoint: '/osdc/selectInitInfo',
          request: {}, response: result, success: result.success,
        });
        return ok({ success: result.success, message: result.success ? 'eTIMS connected' : 'Connection failed', data: result });
      }

      // ── Submit invoice to eTIMS ──────────────────────────────────────────
      case 'etims_submit_invoice': {
        const { invoice_id } = body;
        if (!invoice_id) return err('invoice_id required', 400);

        const invoice = await queryOne(`SELECT * FROM tax_invoices WHERE id=?`, [invoice_id]);
        if (!invoice) return err('Invoice not found', 404);
        if (invoice.etims_status === 'submitted') return err('Invoice already submitted to eTIMS', 409);

        const client = await queryOne(`SELECT * FROM clients WHERE id=?`, [invoice.client_id]);
        const lines  = await query(`SELECT * FROM tax_invoice_lines WHERE invoice_id=?`, [invoice_id]);

        const { submitInvoice, logIntegration } = require('../../../lib/integrations/kra-etims');
        const result = await submitInvoice(invoice, lines, client);

        if (result.success) {
          await run(
            `UPDATE tax_invoices SET etims_status='submitted', etims_submitted_at=datetime('now'), etims_response=? WHERE id=?`,
            [JSON.stringify(result.data), invoice_id]
          );
        }

        await logIntegration(query, {
          service: 'etims', direction: 'outbound', endpoint: '/trnsSales/saveSales',
          request: { invoice_id }, response: result, success: result.success, refId: invoice_id,
        });

        return ok({ success: result.success, result });
      }

      // ── M-PESA STK Push (request client payment) ─────────────────────────
      case 'mpesa_collect': {
        const { phone, amount, invoice_no, client_name } = body;
        if (!phone || !amount) return err('phone and amount required', 400);
        if (amount <= 0) return err('Amount must be positive', 400);

        const cleanPhone = phone.replace(/^0/, '254').replace(/[^0-9]/g, '');
        if (!/^254[0-9]{9}$/.test(cleanPhone)) return err('Invalid phone number format. Use 254XXXXXXXXX', 400);

        const { stkPush } = require('../../../lib/integrations/mpesa');
        const result = await stkPush(cleanPhone, amount, invoice_no || 'QSL-PAYMENT', `QSL Invoice ${invoice_no || ''}`);

        const { v4: uuid } = require('uuid');
        await run(
          `INSERT INTO integration_logs (id,service,direction,endpoint,request,response,success) VALUES (?,?,?,?,?,?,?)`,
          [uuid(), 'mpesa', 'outbound', '/stkpush', JSON.stringify({ phone: cleanPhone, amount }), JSON.stringify(result), result.success ? 1 : 0]
        );

        return ok({
          success: result.success,
          isMock:  result.isMock || false,
          message: result.success
            ? `Payment request sent to ${cleanPhone}. Client will receive M-PESA prompt.`
            : 'Payment request failed',
          checkout_id: result.data?.CheckoutRequestID,
        });
      }

      // ── Fetch PPIP tenders and auto-create bid records ────────────────────
      case 'ppip_sync': {
        const { searchTenders } = require('../../../lib/integrations/ppip');
        const result = await searchTenders({ keywords: 'calibration instrumentation engineering control systems' });

        if (!result.success) return err('PPIP sync failed', 500);

        const tenders = result.data?.tenders || [];
        let created = 0;

        const { v4: uuidv4 } = require('uuid');
        for (const t of tenders) {
          const exists = await queryOne(`SELECT id FROM bids WHERE ref_no=?`, [t.id]);
          if (!exists) {
            await run(
              `INSERT INTO bids (id,ref_no,name,client,value,deadline,stage,owner) VALUES (?,?,?,?,?,?,'stage_1',?)`,
              [uuidv4(), t.id, t.title, t.procuring_entity, t.estimated_value, t.deadline, auth.user.employee_id]
            );
            created++;
          }
        }

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'PPIP_SYNC', module: 'Integrations',
          newValue: { tenders_found: tenders.length, created },
        });

        return ok({ synced: tenders.length, new_bids_created: created, tenders });
      }

      // ── Send invoice email to client ──────────────────────────────────────
      case 'send_invoice_email': {
        const { invoice_id, recipient_email, message } = body;
        if (!invoice_id || !recipient_email) return err('invoice_id and recipient_email required', 400);

        const invoice = await queryOne(
          `SELECT ti.*, c.name as client_name FROM tax_invoices ti LEFT JOIN clients c ON ti.client_id=c.id WHERE ti.id=?`,
          [invoice_id]
        );
        if (!invoice) return err('Invoice not found', 404);

        // Mock email send (replace with nodemailer in production)
        const emailMock = {
          to:      recipient_email,
          subject: `Invoice ${invoice.invoice_no} — Qalibrated Systems Limited`,
          body:    message || `Dear ${invoice.client_name}, please find attached Invoice ${invoice.invoice_no} for Kshs ${invoice.total?.toLocaleString()}.`,
          sent_at: new Date().toISOString(),
        };

        const { v4: uuidv4 } = require('uuid');
        await run(
          `INSERT INTO integration_logs (id,service,direction,endpoint,request,success) VALUES (?,?,?,?,?,?)`,
          [uuidv4(), 'email', 'outbound', '/send', JSON.stringify(emailMock), 1]
        );

        return ok({ sent: true, to: recipient_email, invoice_no: invoice.invoice_no });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Integrations POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}

// ── M-PESA Callback (public — no auth) ───────────────────────────────────────
export async function PUT(req) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ResultCode: 1, ResultDesc: 'Invalid JSON' }); }

  const { parseCallback } = require('../../../lib/integrations/mpesa');
  const parsed = parseCallback(body);

  if (parsed?.success) {
    // Update payment record in DB
    await run(
      `UPDATE tax_invoices SET status='paid' WHERE invoice_no=? OR id=?`,
      [parsed.mpesaReceiptNumber, parsed.checkoutRequestId]
    );
  }

  const { v4: uuidv4 } = require('uuid');
  await run(
    `INSERT INTO integration_logs (id,service,direction,endpoint,request,success) VALUES (?,?,?,?,?,?)`,
    [uuidv4(), 'mpesa', 'inbound', '/callback', JSON.stringify(body), parsed?.success ? 1 : 0]
  );

  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
