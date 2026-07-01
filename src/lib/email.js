// src/lib/email.js — Email Service (Nodemailer)
// Handles: payslips, invoice delivery, approval alerts, imprest overdue warnings

const nodemailer = require('nodemailer');

// ── TRANSPORT ─────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

const FROM = process.env.SMTP_FROM || 'QSL ERP <info@qalibrated.co.ke>';

// ── SEND HELPER ───────────────────────────────────────────────────────────────
async function send({ to, subject, html, text, attachments = [] }) {
  if (!process.env.SMTP_USER) {
    // Log to console in dev — no real email
    console.log(`[Email Mock] To: ${to} | Subject: ${subject}`);
    return { success: true, mock: true };
  }
  try {
    const transport = createTransport();
    const result = await transport.sendMail({ from: FROM, to, subject, html, text, attachments });
    return { success: true, messageId: result.messageId };
  } catch (err) {
    console.error('[Email]', err.message);
    return { success: false, error: err.message };
  }
}

// ── TEMPLATES ─────────────────────────────────────────────────────────────────

const baseStyle = `font-family:'Inter',Arial,sans-serif;color:#334155;`;
const headerHtml = (title) => `
<div style="background:#0D2238;padding:20px 28px;border-radius:8px 8px 0 0;">
  <div style="color:#C8960C;font-size:20px;font-weight:800;letter-spacing:-0.5px;">QSL</div>
  <div style="color:rgba(255,255,255,.6);font-size:11px;margin-top:2px;">QALIBRATED SYSTEMS LIMITED</div>
</div>
<div style="background:#1B3A5C;padding:12px 28px;">
  <div style="color:#ffffff;font-size:15px;font-weight:700;">${title}</div>
</div>`;
const footerHtml = `<div style="background:#F0F4F8;padding:14px 28px;border-radius:0 0 8px 8px;font-size:11px;color:#94A3B8;border-top:1px solid #E8ECF0;">
  This is an automated notification from QSL ERP. Do not reply to this email.<br/>
  Qalibrated Systems Limited · Birdi Singh Complex, Off Mombasa Road, Nairobi · info@qalibrated.co.ke
</div>`;

// ── SPECIFIC EMAIL SENDERS ────────────────────────────────────────────────────

/**
 * Send payslip to employee after payroll is locked.
 */
async function sendPayslip(employee, payslipData, period) {
  const { name, email, gross_pay, paye, nhif, nssf, housing_levy, net_pay, department } = payslipData;
  const html = `<div style="${baseStyle}max-width:560px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;">
    ${headerHtml(`Payslip — ${period}`)}
    <div style="padding:24px 28px;">
      <p style="margin:0 0 16px;">Dear ${name},</p>
      <p style="margin:0 0 20px;">Please find your payslip for <strong>${period}</strong> below.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#F0F4F8;"><td style="padding:10px 14px;font-weight:700;color:#1B3A5C;" colspan="2">EARNINGS</td></tr>
        <tr><td style="padding:8px 14px;border-bottom:1px solid #E8ECF0;">Basic Salary</td><td style="padding:8px 14px;border-bottom:1px solid #E8ECF0;text-align:right;font-weight:600;">Kshs ${(gross_pay||0).toLocaleString()}</td></tr>
        <tr style="background:#F0F4F8;"><td style="padding:10px 14px;font-weight:700;color:#C00000;" colspan="2">DEDUCTIONS</td></tr>
        ${[['PAYE',paye],['NHIF/SHIF',nhif],['NSSF',nssf],['Housing Levy',housing_levy]].map(([l,v])=>`<tr><td style="padding:8px 14px;border-bottom:1px solid #E8ECF0;">${l}</td><td style="padding:8px 14px;border-bottom:1px solid #E8ECF0;text-align:right;color:#C00000;">- Kshs ${(v||0).toLocaleString()}</td></tr>`).join('')}
        <tr style="background:#0D2238;"><td style="padding:12px 14px;font-weight:800;color:#ffffff;font-size:15px;">NET PAY</td><td style="padding:12px 14px;text-align:right;font-weight:800;color:#C8960C;font-size:15px;">Kshs ${(net_pay||0).toLocaleString()}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#94A3B8;">This payslip is auto-generated and digitally signed by QSL ERP. For queries contact HR: gwanjiku@qalibrated.co.ke</p>
    </div>
    ${footerHtml}
  </div>`;
  return send({ to: email, subject: `Payslip — ${period} — Qalibrated Systems Limited`, html });
}

/**
 * Send tax invoice to client.
 */
/**
 * Emails a quotation to a client with the actual generated PDF attached
 * (not just an HTML summary — the real document, so the client has
 * something to forward/print/sign). pdfPath is the absolute path returned
 * by generateBusinessDoc('quote', ...) in pdf.js.
 */
async function sendQuotePdf(quote, client, lines, pdfPath, senderName) {
  const fs = require('fs');
  const html = `<div style="${baseStyle}max-width:600px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;">
    ${headerHtml(`Quotation ${quote.quote_no}`)}
    <div style="padding:24px 28px;">
      <p style="font-size:14px;">Dear ${client.contact_person || client.name},</p>
      <p style="font-size:14px;">Please find attached our quotation <strong>${quote.quote_no}</strong>${quote.valid_until ? ` (valid until ${quote.valid_until})` : ''} for your review.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:16px;">
        <tr style="background:#1B3A5C;color:#fff;"><td style="padding:10px 12px;font-weight:600;">Description</td><td style="padding:10px 12px;text-align:right;font-weight:600;">Amount (Kshs)</td></tr>
        ${(lines||[]).map(l=>`<tr><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;">${l.description}</td><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;text-align:right;">${((l.quantity||1)*(l.unit_price||0)).toLocaleString()}</td></tr>`).join('')}
        <tr style="background:#0D2238;"><td style="padding:12px;font-weight:800;color:#fff;">TOTAL</td><td style="padding:12px;text-align:right;font-weight:800;color:#C8960C;font-size:15px;">Kshs ${(quote.total||0).toLocaleString()}</td></tr>
      </table>
      <p style="font-size:13px;margin-top:18px;">Please don't hesitate to reach out with any questions.</p>
      <p style="font-size:13px;">Kind regards,<br/><strong>${senderName || 'Qalibrated Systems Limited'}</strong></p>
    </div>
    ${footerHtml}
  </div>`;
  const attachments = [];
  try {
    if (pdfPath && fs.existsSync(pdfPath)) {
      attachments.push({ filename: `Quotation_${quote.quote_no}.pdf`, content: fs.readFileSync(pdfPath), contentType: 'application/pdf' });
    }
  } catch { /* if the file can't be read, still send the HTML summary rather than failing outright */ }
  return send({ to: client.email, subject: `Quotation ${quote.quote_no} — Qalibrated Systems Limited`, html, attachments });
}

async function sendInvoice(invoice, client, lines) {
  const html = `<div style="${baseStyle}max-width:600px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;">
    ${headerHtml(`Invoice ${invoice.invoice_no}`)}
    <div style="padding:24px 28px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
        <div><strong>To:</strong><br/>${client.name}<br/>${client.address||''}</div>
        <div style="text-align:right;"><strong>Invoice No:</strong> ${invoice.invoice_no}<br/><strong>Date:</strong> ${invoice.date}<br/><strong>Due Date:</strong> ${invoice.due_date||'30 days'}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#1B3A5C;color:#fff;"><td style="padding:10px 12px;font-weight:600;">Description</td><td style="padding:10px 12px;text-align:right;font-weight:600;">Amount (Kshs)</td></tr>
        ${(lines||[]).map(l=>`<tr><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;">${l.description}</td><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;text-align:right;">${(l.amount||0).toLocaleString()}</td></tr>`).join('')}
        <tr><td style="padding:8px 12px;border-top:1px solid #E8ECF0;">VAT (16%)</td><td style="padding:8px 12px;border-top:1px solid #E8ECF0;text-align:right;color:#C00000;">${(invoice.vat_amount||0).toLocaleString()}</td></tr>
        <tr style="background:#0D2238;"><td style="padding:12px;font-weight:800;color:#fff;">TOTAL</td><td style="padding:12px;text-align:right;font-weight:800;color:#C8960C;font-size:15px;">Kshs ${(invoice.total||0).toLocaleString()}</td></tr>
      </table>
      <div style="margin-top:20px;padding:12px 16px;background:#F0F4F8;border-radius:6px;font-size:12px;">
        <strong>Payment:</strong> Bank transfer to QSL Bank Account · Or M-PESA Paybill: ${process.env.MPESA_SHORTCODE||'[Paybill]'} Account: ${invoice.invoice_no}<br/>
        <strong>KRA PIN:</strong> ${process.env.COMPANY_KRA_PIN||'[KRA PIN]'} · <strong>eTIMS Receipt:</strong> ${invoice.etims_cu_no||'Pending'}
      </div>
    </div>
    ${footerHtml}
  </div>`;
  return send({ to: client.email, subject: `Invoice ${invoice.invoice_no} — Qalibrated Systems Limited`, html });
}

/**
 * Imprest overdue alert to Finance Manager.
 */
async function sendImprestOverdueAlert(imprestList, fmEmail) {
  const rows = imprestList.map(i => `<tr><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;">${i.employee_name}</td><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;">Kshs ${i.amount.toLocaleString()}</td><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;">${i.purpose}</td><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;color:#C00000;font-weight:700;">OVERDUE</td></tr>`).join('');
  const html = `<div style="${baseStyle}max-width:600px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;">
    ${headerHtml('⏰ Imprest Overdue Alert — Action Required')}
    <div style="padding:24px 28px;">
      <div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:8px;padding:14px 16px;margin-bottom:20px;color:#C00000;font-weight:700;">
        🚨 ${imprestList.length} imprest advance(s) have passed the 14-day deadline and will be automatically converted to personal advances deductible from payroll (QSL-FIN-CHP-001).
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#1B3A5C;color:#fff;"><td style="padding:10px 12px;">Employee</td><td style="padding:10px 12px;">Amount</td><td style="padding:10px 12px;">Purpose</td><td style="padding:10px 12px;">Status</td></tr>
        ${rows}
      </table>
      <p style="margin-top:16px;font-size:12px;color:#94A3B8;">Login to QSL ERP to review and process these records.</p>
    </div>
    ${footerHtml}
  </div>`;
  return send({ to: fmEmail, subject: `🚨 ${imprestList.length} Overdue Imprest — QSL ERP Alert`, html });
}

/**
 * Approval required notification.
 */
async function sendApprovalRequest({ to, approver_name, action, document_ref, amount, requested_by, login_url }) {
  const html = `<div style="${baseStyle}max-width:520px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;">
    ${headerHtml(`Approval Required: ${action}`)}
    <div style="padding:24px 28px;">
      <p>Dear ${approver_name},</p>
      <p>Your digital signature approval is required for:</p>
      <div style="background:#F0F4F8;padding:16px;border-radius:8px;margin:16px 0;">
        <div style="font-size:13px;"><strong>Action:</strong> ${action}</div>
        <div style="font-size:13px;margin-top:8px;"><strong>Reference:</strong> ${document_ref}</div>
        ${amount ? `<div style="font-size:13px;margin-top:8px;"><strong>Amount:</strong> Kshs ${Number(amount).toLocaleString()}</div>` : ''}
        <div style="font-size:13px;margin-top:8px;"><strong>Requested by:</strong> ${requested_by}</div>
      </div>
      <a href="${login_url || process.env.APP_URL || 'http://localhost:3000'}/dashboard" style="display:inline-block;background:#1B3A5C;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-top:8px;">Login to Approve →</a>
      <p style="margin-top:16px;font-size:12px;color:#94A3B8;">This requires your RSA-2048 digital signature key. Log in to QSL ERP to apply it.</p>
    </div>
    ${footerHtml}
  </div>`;
  return send({ to, subject: `Approval Required: ${action} — QSL ERP`, html });
}

/**
 * Compliance document expiry alert.
 */
async function sendComplianceAlert(docs, recipientEmail) {
  const rows = docs.map(d => {
    const days = Math.round((new Date(d.expires_at) - new Date()) / 86400000);
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;">${d.name}</td><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;">${d.expires_at}</td><td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;color:${days<30?'#C00000':'#B8600B'};font-weight:700;">${days} days</td></tr>`;
  }).join('');
  const html = `<div style="${baseStyle}max-width:560px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;">
    ${headerHtml('⚠️ Compliance Certificates Expiring')}
    <div style="padding:24px 28px;">
      <p>The following compliance certificates are expiring and require renewal:</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#1B3A5C;color:#fff;"><td style="padding:10px 12px;">Certificate</td><td style="padding:10px 12px;">Expiry Date</td><td style="padding:10px 12px;">Days Left</td></tr>
        ${rows}
      </table>
    </div>
    ${footerHtml}
  </div>`;
  return send({ to: recipientEmail, subject: `⚠️ ${docs.length} Compliance Certificate(s) Expiring — QSL ERP`, html });
}


// ── CLIENT-FACING OVERDUE REMINDERS ──────────────────────────────────────────

/**
 * Invoice payment reminder to client.
 * Sent daily for any invoice past due_date with outstanding balance.
 * Tone escalates based on days overdue:
 *   1–14 days  → Friendly reminder
 *   15–30 days → Formal notice
 *   31–60 days → Final demand (CFO copy)
 *   60+ days   → Legal notice (MD + CFO copy)
 */
async function sendInvoiceReminder(client, invoices, daysOverdue, totalOutstanding, accountOwner) {
  const isGentle  = daysOverdue <= 14;
  const isFormal  = daysOverdue > 14 && daysOverdue <= 30;
  const isFinal   = daysOverdue > 30 && daysOverdue <= 60;
  const isLegal   = daysOverdue > 60;

  const subject = isGentle
    ? `Friendly Reminder: Outstanding Invoice(s) — Qalibrated Systems Limited`
    : isFormal
    ? `Payment Notice: Outstanding Balance — Qalibrated Systems Limited`
    : isFinal
    ? `FINAL DEMAND: Immediate Payment Required — Qalibrated Systems Limited`
    : `LEGAL NOTICE: Overdue Account — Qalibrated Systems Limited`;

  const headerColor = isGentle ? '#1B3A5C' : isFormal ? '#B8600B' : '#C00000';
  const urgencyBadge = isGentle
    ? `<span style="background:#FEF3C7;color:#B8600B;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700;">REMINDER</span>`
    : isFormal
    ? `<span style="background:#FEE2E2;color:#C00000;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700;">NOTICE</span>`
    : isFinal
    ? `<span style="background:#C00000;color:#ffffff;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700;">FINAL DEMAND</span>`
    : `<span style="background:#0D2238;color:#C8960C;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700;">LEGAL NOTICE</span>`;

  const greeting = isGentle
    ? `We hope this message finds you well. This is a friendly reminder that the following invoice(s) are now due for payment.`
    : isFormal
    ? `Please be advised that the following invoice(s) remain outstanding and require your immediate attention.`
    : isFinal
    ? `Despite our previous reminders, the following invoice(s) remain unpaid. This is our final demand before we proceed with formal recovery proceedings.`
    : `Your account has been referred to our Finance Director. This matter will be escalated to our legal counsel if payment is not received within 7 days.`;

  const invoiceRows = (invoices||[]).map(inv => `
    <tr>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;font-family:monospace;">${inv.invoice_no || inv.ref}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;">${inv.date ? new Date(inv.date).toLocaleDateString('en-KE') : '—'}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;">${inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : '—'}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;color:#C00000;font-weight:700;">Kshs ${Number(inv.outstanding || inv.total || 0).toLocaleString('en-KE')}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;font-weight:700;color:#C00000;">${inv.days_overdue || daysOverdue} days</td>
    </tr>`).join('');

  const html = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#334155;max-width:600px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;overflow:hidden;">

  <!-- Header -->
  <div style="background:${headerColor};padding:22px 28px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="color:#C8960C;font-size:22px;font-weight:800;letter-spacing:-0.5px;">QSL</div>
        <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:2px;letter-spacing:1px;">QALIBRATED SYSTEMS LIMITED</div>
      </div>
      <div style="text-align:right;">
        ${urgencyBadge}
        <div style="color:rgba(255,255,255,.5);font-size:10px;margin-top:6px;">${new Date().toLocaleDateString('en-KE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
      </div>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:26px 28px;">
    <p style="font-size:14px;font-weight:600;margin:0 0 6px;">Dear ${client.contact_person || client.name},</p>
    <p style="font-size:13px;color:#64748B;margin:0 0 20px;line-height:1.6;">${greeting}</p>

    <!-- Outstanding summary box -->
    <div style="background:#F0F4F8;border-radius:8px;padding:16px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:11px;color:#94A3B8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total Outstanding</div>
        <div style="font-size:24px;font-weight:800;color:#C00000;margin-top:4px;">Kshs ${Number(totalOutstanding).toLocaleString('en-KE')}</div>
        <div style="font-size:11px;color:#94A3B8;margin-top:2px;">Account: ${client.name}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;color:#94A3B8;font-weight:600;text-transform:uppercase;">Days Overdue</div>
        <div style="font-size:28px;font-weight:800;color:${isLegal?'#0D2238':isFinal?'#C00000':isFormal?'#B8600B':'#C8960C'};margin-top:4px;">${daysOverdue}</div>
      </div>
    </div>

    <!-- Invoice table -->
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px;">
      <thead>
        <tr style="background:#1B3A5C;">
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Invoice No.</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Invoice Date</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Due Date</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Amount (Kshs)</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Overdue</th>
        </tr>
      </thead>
      <tbody>${invoiceRows}</tbody>
    </table>

    <!-- Payment methods -->
    <div style="background:#F8FAFC;border:1px solid #E8ECF0;border-radius:8px;padding:16px 18px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:#1B3A5C;margin-bottom:10px;">Payment Methods</div>
      <div style="font-size:12px;color:#334155;line-height:1.8;">
        🏦 <strong>Bank Transfer:</strong> Equity Bank Kenya · A/C: [QSL Account Number] · Branch: [Branch Name]<br/>
        📱 <strong>M-PESA:</strong> Paybill No. [Paybill] · Account: [Invoice Number]<br/>
        📧 <strong>Remittance:</strong> Send proof of payment to <a href="mailto:finance@qalibrated.co.ke" style="color:#1B3A5C;">finance@qalibrated.co.ke</a>
      </div>
    </div>

    ${isLegal ? `
    <div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:8px;padding:14px 18px;margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;color:#C00000;margin-bottom:6px;">⚠️ Legal Action Notice</div>
      <div style="font-size:12px;color:#C00000;line-height:1.6;">
        This account has been flagged for legal recovery. If full payment is not received within <strong>7 calendar days</strong> from this notice, we will proceed without further notice to:<br/>
        (a) Engage our legal counsel for debt recovery proceedings;<br/>
        (b) Report the outstanding amount to credit bureaus;<br/>
        (c) Suspend all ongoing services and project activities.
      </div>
    </div>` : ''}

    <p style="font-size:12px;color:#64748B;margin:0 0 6px;">Please contact us immediately if you have any queries or if payment has already been made.</p>
    <p style="font-size:12px;color:#334155;margin:0;">
      <strong>${accountOwner?.name || 'Account Manager'}</strong><br/>
      ${accountOwner?.phone || '+254 714 999 996'}<br/>
      <a href="mailto:${accountOwner?.email || 'finance@qalibrated.co.ke'}" style="color:#1B3A5C;">${accountOwner?.email || 'finance@qalibrated.co.ke'}</a>
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#F0F4F8;padding:12px 28px;border-top:1px solid #E8ECF0;">
    <div style="font-size:10px;color:#94A3B8;text-align:center;line-height:1.7;">
      Qalibrated Systems Limited · Birdi Singh Complex, 1st Floor, Off Mombasa Road, Nairobi<br/>
      KRA PIN: ${process.env.COMPANY_KRA_PIN||'P000000001K'} · Tel: +254 714 999 996 · info@qalibrated.co.ke<br/>
      This is an automated payment reminder. To unsubscribe from reminders, contact finance@qalibrated.co.ke
    </div>
  </div>
</div>`;

  // CC escalation: FM always, CFO on day 31+, MD on day 61+
  const cc = [];
  if (isFinal || isLegal) cc.push('skamau@qalibrated.co.ke');
  if (isLegal)            cc.push('hadar@qalibrated.co.ke');

  return send({
    to:      client.email,
    subject,
    html,
    ...(cc.length ? { cc: cc.join(',') } : {}),
  });
}

/**
 * Calibration certificate expiry reminder to client.
 * Instrument is due for re-calibration — sent 60, 30, 14, and 7 days before expiry.
 */
async function sendCalibrationReminder(client, certs, daysUntilExpiry) {
  const urgency = daysUntilExpiry <= 7 ? 'URGENT' : daysUntilExpiry <= 14 ? 'IMPORTANT' : 'REMINDER';
  const badgeColor = daysUntilExpiry <= 7 ? '#C00000' : daysUntilExpiry <= 14 ? '#B8600B' : '#1B3A5C';

  const certRows = certs.map(c => `
    <tr>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;font-family:monospace;">${c.cert_no}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;">${c.instrument}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;">${c.serial_no||'—'}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #E8ECF0;font-size:12px;font-weight:700;color:${badgeColor};">
        ${c.next_cal_date ? new Date(c.next_cal_date).toLocaleDateString('en-KE') : '—'}
      </td>
    </tr>`).join('');

  const html = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#334155;max-width:600px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;overflow:hidden;">
  <div style="background:#1B3A5C;padding:22px 28px;">
    <div style="color:#C8960C;font-size:22px;font-weight:800;">QSL</div>
    <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:2px;letter-spacing:1px;">QALIBRATED SYSTEMS LIMITED · ISO/IEC 17025:2017</div>
  </div>
  <div style="background:#C8960C;padding:10px 28px;">
    <div style="color:#ffffff;font-size:14px;font-weight:700;">🔬 Calibration Certificate Renewal ${urgency}</div>
    <div style="color:rgba(255,255,255,.7);font-size:11px;margin-top:2px;">Your instrument calibration certificate${certs.length>1?'s are':' is'} due for renewal in <strong>${daysUntilExpiry} day${daysUntilExpiry!==1?'s':''}</strong></div>
  </div>
  <div style="padding:24px 28px;">
    <p style="font-size:13px;margin:0 0 6px;">Dear ${client.contact_person || client.name},</p>
    <p style="font-size:13px;color:#64748B;margin:0 0 20px;line-height:1.6;">
      This is a courtesy reminder that the calibration certificate${certs.length>1?'s':''} for the following instrument${certs.length>1?'s':''} ${certs.length>1?'are':'is'} due for renewal.
      Expired calibration certificates may result in non-compliance with regulatory requirements (KEBS, KRA, DOSH, sector-specific standards).
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#1B3A5C;">
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Certificate No.</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Instrument</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Serial No.</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-size:11px;font-weight:600;">Expiry Date</th>
        </tr>
      </thead>
      <tbody>${certRows}</tbody>
    </table>
    <div style="background:#F0F9F4;border:1px solid #86EFAC;border-radius:8px;padding:16px 18px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:#1E6B3C;margin-bottom:8px;">To Schedule Recalibration</div>
      <div style="font-size:12px;color:#334155;line-height:1.8;">
        📞 Call: <strong>+254 714 999 996</strong><br/>
        📧 Email: <a href="mailto:calibration@qalibrated.co.ke" style="color:#1B3A5C;">calibration@qalibrated.co.ke</a><br/>
        🌐 We offer on-site calibration across Kenya. Lab calibration available at our Nairobi facility.
      </div>
    </div>
    <p style="font-size:11px;color:#94A3B8;margin:0;">
      QSL is an ISO/IEC 17025:2017 accredited calibration laboratory. All certificates are traceable to KEBS → BIPM national standards.
    </p>
  </div>
  <div style="background:#F0F4F8;padding:12px 28px;border-top:1px solid #E8ECF0;font-size:10px;color:#94A3B8;text-align:center;">
    Qalibrated Systems Limited · Off Mombasa Road, Nairobi · calibration@qalibrated.co.ke · +254 714 999 996
  </div>
</div>`;

  return send({
    to:      client.email,
    subject: `[${urgency}] Calibration Certificate Renewal Due in ${daysUntilExpiry} Days — ${certs.map(c=>c.instrument).join(', ')}`,
    html,
  });
}

/**
 * Project payment / milestone reminder to client.
 * Sent when invoiced amount remains unpaid past payment terms, or milestone payment due.
 */
async function sendProjectPaymentReminder(client, project, invoicedAmount, collectedAmount, accountOwner, daysOverdue) {
  const outstanding = invoicedAmount - collectedAmount;
  const html = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#334155;max-width:600px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;overflow:hidden;">
  <div style="background:#1B3A5C;padding:22px 28px;">
    <div style="color:#C8960C;font-size:22px;font-weight:800;">QSL</div>
    <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:2px;letter-spacing:1px;">QALIBRATED SYSTEMS LIMITED</div>
  </div>
  <div style="background:${daysOverdue>30?'#C00000':daysOverdue>14?'#B8600B':'#C8960C'};padding:10px 28px;">
    <div style="color:#fff;font-size:14px;font-weight:700;">Project Payment Reminder — ${project.ref_no}</div>
  </div>
  <div style="padding:24px 28px;">
    <p style="font-size:13px;margin:0 0 6px;">Dear ${client.contact_person || client.name},</p>
    <p style="font-size:13px;color:#64748B;margin:0 0 20px;line-height:1.6;">
      This is a reminder regarding outstanding payment for the following project. As per our contract terms, payment is due within ${project.payment_terms||30} days of invoice date.
    </p>
    <div style="background:#F0F4F8;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:#1B3A5C;margin-bottom:10px;">Project Summary</div>
      ${[
        ['Project', project.name],
        ['Contract Ref', project.ref_no],
        ['Contract Value', `Kshs ${Number(project.contract_value).toLocaleString('en-KE')}`],
        ['Amount Invoiced', `Kshs ${Number(invoicedAmount).toLocaleString('en-KE')}`],
        ['Amount Collected', `Kshs ${Number(collectedAmount).toLocaleString('en-KE')}`],
        ['Outstanding Balance', `Kshs ${Number(outstanding).toLocaleString('en-KE')}`],
        ['Days Overdue', `${daysOverdue} days`],
      ].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8ECF0;font-size:12px;"><span style="color:#64748B;">${l}</span><strong style="color:${l==='Outstanding Balance'?'#C00000':'#1B3A5C'};">${v}</strong></div>`).join('')}
    </div>
    <p style="font-size:12px;color:#334155;margin:0;">
      Please arrange payment to: <strong>${accountOwner?.name || 'QSL Finance'}</strong><br/>
      <a href="mailto:${accountOwner?.email||'finance@qalibrated.co.ke'}" style="color:#1B3A5C;">${accountOwner?.email||'finance@qalibrated.co.ke'}</a> · ${accountOwner?.phone||'+254 714 999 996'}
    </p>
  </div>
  <div style="background:#F0F4F8;padding:12px 28px;border-top:1px solid #E8ECF0;font-size:10px;color:#94A3B8;text-align:center;">
    Qalibrated Systems Limited · Birdi Singh Complex, Off Mombasa Road, Nairobi · finance@qalibrated.co.ke
  </div>
</div>`;

  return send({
    to:      client.email,
    subject: `Payment Reminder: ${project.ref_no} — ${project.name} — Kshs ${outstanding.toLocaleString('en-KE')} Outstanding`,
    html,
    ...(daysOverdue > 30 ? { cc: 'skamau@qalibrated.co.ke' } : {}),
  });
}

/**
 * Internal payables & liabilities digest — sent to FM/CFO.
 * Two sections: already overdue, and due within the lookahead window.
 * Covers supplier LPOs and statutory obligations together so Finance
 * sees the full cash-outflow picture in one email.
 */
async function sendPayablesDigest({ to, overdueSuppliers, upcomingSuppliers, overdueStatutory, upcomingStatutory, lookaheadDays }) {
  const totalOverdue  = (overdueSuppliers||[]).reduce((s,p)=>s+(p.grand_total||0),0);
  const totalUpcoming = (upcomingSuppliers||[]).reduce((s,p)=>s+(p.grand_total||0),0);

  const supplierRow = (p, overdue) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;">${p.supplier_name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;font-family:monospace;">${p.lpo_no}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;font-weight:700;">Kshs ${Number(p.grand_total||0).toLocaleString('en-KE')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;">${p.delivery_date ? new Date(p.delivery_date).toLocaleDateString('en-KE') : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;font-weight:700;color:${overdue ? '#C00000' : '#B8600B'};">${overdue ? `${Math.round(p.days_outstanding)} days overdue` : `due in ${Math.abs(Math.round(p.days_until_due))} days`}</td>
    </tr>`;

  const statutoryRow = (o, overdue) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;" colspan="2">${o.name} <span style="color:#94A3B8;">(${o.agency})</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;color:#94A3B8;">—</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;">${o.next_due}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;font-weight:700;color:${overdue ? '#C00000' : '#B8600B'};">${overdue ? `${Math.abs(o.days)} days overdue` : `due in ${o.days} days`}</td>
    </tr>`;

  const hasOverdue  = (overdueSuppliers?.length || 0) + (overdueStatutory?.length || 0) > 0;
  const hasUpcoming = (upcomingSuppliers?.length || 0) + (upcomingStatutory?.length || 0) > 0;

  const html = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#334155;max-width:640px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;overflow:hidden;">
  <div style="background:#1B3A5C;padding:22px 28px;">
    <div style="color:#C8960C;font-size:22px;font-weight:800;">QSL</div>
    <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:2px;letter-spacing:1px;">QALIBRATED SYSTEMS LIMITED · FINANCE</div>
  </div>
  <div style="background:${hasOverdue ? '#C00000' : '#1B3A5C'};padding:10px 28px;">
    <div style="color:#fff;font-size:14px;font-weight:700;">💸 Payables & Liabilities Digest</div>
    <div style="color:rgba(255,255,255,.7);font-size:11px;margin-top:2px;">${new Date().toLocaleDateString('en-KE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
  </div>
  <div style="padding:24px 28px;">

    <div style="display:flex;gap:14px;margin-bottom:22px;">
      <div style="flex:1;background:#FEE2E2;border-radius:8px;padding:14px 16px;">
        <div style="font-size:10px;color:#C00000;font-weight:700;text-transform:uppercase;">Already Overdue</div>
        <div style="font-size:20px;font-weight:800;color:#C00000;margin-top:4px;">Kshs ${Number(totalOverdue).toLocaleString('en-KE')}</div>
        <div style="font-size:10px;color:#C00000;margin-top:2px;">${overdueSuppliers?.length||0} supplier item(s) · ${overdueStatutory?.length||0} statutory item(s)</div>
      </div>
      <div style="flex:1;background:#FEF3C7;border-radius:8px;padding:14px 16px;">
        <div style="font-size:10px;color:#B8600B;font-weight:700;text-transform:uppercase;">Due Within ${lookaheadDays} Days</div>
        <div style="font-size:20px;font-weight:800;color:#B8600B;margin-top:4px;">Kshs ${Number(totalUpcoming).toLocaleString('en-KE')}</div>
        <div style="font-size:10px;color:#B8600B;margin-top:2px;">${upcomingSuppliers?.length||0} supplier item(s) · ${upcomingStatutory?.length||0} statutory item(s)</div>
      </div>
    </div>

    ${hasOverdue ? `
    <div style="font-size:13px;font-weight:700;color:#C00000;margin-bottom:8px;">🔴 OVERDUE — Action Required</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
      <thead><tr style="background:#1B3A5C;">
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Supplier / Obligation</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">LPO No.</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Amount</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Delivered/Due</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Status</th>
      </tr></thead>
      <tbody>
        ${(overdueSuppliers||[]).map(p=>supplierRow(p,true)).join('')}
        ${(overdueStatutory||[]).map(o=>statutoryRow(o,true)).join('')}
      </tbody>
    </table>` : `<div style="background:#F0FFF4;border:1px solid #86EFAC;border-radius:8px;padding:12px 16px;margin-bottom:22px;font-size:12px;color:#1E6B3C;">✅ Nothing overdue right now.</div>`}

    ${hasUpcoming ? `
    <div style="font-size:13px;font-weight:700;color:#B8600B;margin-bottom:8px;">🟡 Due Within ${lookaheadDays} Days</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
      <thead><tr style="background:#1B3A5C;">
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Supplier / Obligation</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">LPO No.</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Amount</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Delivered/Due</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Status</th>
      </tr></thead>
      <tbody>
        ${(upcomingSuppliers||[]).map(p=>supplierRow(p,false)).join('')}
        ${(upcomingStatutory||[]).map(o=>statutoryRow(o,false)).join('')}
      </tbody>
    </table>` : ''}

    <p style="font-size:11px;color:#94A3B8;margin-top:18px;">This digest is generated automatically each morning. Log in to QSL ERP → Procurement / Tax modules to action payments.</p>
  </div>
  <div style="background:#F0F4F8;padding:12px 28px;border-top:1px solid #E8ECF0;font-size:10px;color:#94A3B8;text-align:center;">
    Qalibrated Systems Limited · Internal Finance Notification · Not for external distribution
  </div>
</div>`;

  return send({
    to,
    subject: hasOverdue
      ? `🔴 ${(overdueSuppliers?.length||0)+(overdueStatutory?.length||0)} Overdue Payable(s) — Kshs ${totalOverdue.toLocaleString('en-KE')} — QSL ERP`
      : `Payables Digest — ${(upcomingSuppliers?.length||0)+(upcomingStatutory?.length||0)} item(s) due within ${lookaheadDays} days`,
    html,
  });
}

/**
 * Daily debtors list — circulated to MD and Finance Manager every morning.
 * Plain factual aging list, no client-facing tone needed (internal only).
 */
async function sendDailyDebtorsList(debtors, recipients) {
  const total = debtors.reduce((s, d) => s + (d.outstanding || 0), 0);
  const rows = debtors.map(d => {
    const days = d.days_outstanding != null ? Math.round(d.days_outstanding) : null;
    const band = days == null ? '—' : days > 60 ? '60+' : days > 30 ? '31-60' : days > 14 ? '15-30' : '1-14';
    const color = days == null ? '#94A3B8' : days > 60 ? '#C00000' : days > 30 ? '#C00000' : days > 14 ? '#B8600B' : '#1B3A5C';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;">${d.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;">${d.account_owner_name||'—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;font-weight:700;">Kshs ${Number(d.outstanding||0).toLocaleString('en-KE')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;font-weight:700;color:${color};">${band} days</td>
    </tr>`;
  }).join('');

  const html = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#334155;max-width:640px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;overflow:hidden;">
  <div style="background:#1B3A5C;padding:22px 28px;">
    <div style="color:#C8960C;font-size:22px;font-weight:800;">QSL</div>
    <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:2px;letter-spacing:1px;">QALIBRATED SYSTEMS LIMITED · FINANCE</div>
  </div>
  <div style="background:#0D2238;padding:10px 28px;">
    <div style="color:#fff;font-size:14px;font-weight:700;">📋 Daily Debtors List</div>
    <div style="color:rgba(255,255,255,.7);font-size:11px;margin-top:2px;">${new Date().toLocaleDateString('en-KE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
  </div>
  <div style="padding:24px 28px;">
    <div style="background:#F0F4F8;border-radius:8px;padding:16px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:10px;color:#94A3B8;font-weight:600;text-transform:uppercase;">Total Outstanding</div>
        <div style="font-size:22px;font-weight:800;color:#C00000;margin-top:3px;">Kshs ${Number(total).toLocaleString('en-KE')}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:#94A3B8;font-weight:600;text-transform:uppercase;">Debtor Accounts</div>
        <div style="font-size:22px;font-weight:800;color:#1B3A5C;margin-top:3px;">${debtors.length}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#1B3A5C;">
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Client</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Account Owner</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Outstanding</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Aging Band</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:11px;color:#94A3B8;margin-top:18px;">Finance Manager: please submit your end-of-day status update on each overdue account by 5:00 PM today via QSL ERP → Debtors → Daily Follow-up.</p>
  </div>
  <div style="background:#F0F4F8;padding:12px 28px;border-top:1px solid #E8ECF0;font-size:10px;color:#94A3B8;text-align:center;">
    Qalibrated Systems Limited · Internal Finance Notification
  </div>
</div>`;

  return send({ to: recipients.join(','), subject: `Daily Debtors List — ${debtors.length} accounts — Kshs ${total.toLocaleString('en-KE')} outstanding`, html });
}

/**
 * Reminder to FM that the end-of-day debtor status report is not yet submitted.
 */
async function sendEODReportReminder(fmEmail, fmName, pendingCount, deadline) {
  const html = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#334155;max-width:560px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;overflow:hidden;">
  <div style="background:#B8600B;padding:18px 28px;">
    <div style="color:#fff;font-size:15px;font-weight:700;">⏰ End-of-Day Debtor Report Due</div>
  </div>
  <div style="padding:22px 28px;">
    <p style="font-size:13px;margin:0 0 14px;">Dear ${fmName},</p>
    <p style="font-size:13px;color:#64748B;margin:0 0 16px;line-height:1.6;">
      Your end-of-day status update on overdue debtor accounts has not yet been submitted. ${pendingCount} account(s) still need a status entry. The deadline is <strong>${deadline}</strong> today.
    </p>
    <a href="${process.env.APP_URL||'http://localhost:3000'}/dashboard" style="display:inline-block;background:#1B3A5C;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Go to Debtors → Daily Follow-up →</a>
  </div>
  <div style="background:#F0F4F8;padding:10px 28px;border-top:1px solid #E8ECF0;font-size:10px;color:#94A3B8;text-align:center;">Qalibrated Systems Limited · QSL ERP Automated Reminder</div>
</div>`;
  return send({ to: fmEmail, subject: `⏰ Action Required: ${pendingCount} debtor account(s) need today's status update`, html });
}

/**
 * Escalation to MD/CFO when the FM has not submitted the EOD report by the final cutoff.
 */
async function sendEODReportEscalation(escalationRecipients, fmName, pendingCount, reportDate) {
  const html = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#334155;max-width:560px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;overflow:hidden;">
  <div style="background:#C00000;padding:18px 28px;">
    <div style="color:#fff;font-size:15px;font-weight:700;">🔴 End-of-Day Debtor Report Not Submitted</div>
  </div>
  <div style="padding:22px 28px;">
    <p style="font-size:13px;color:#64748B;margin:0 0 16px;line-height:1.6;">
      The Finance Manager (<strong>${fmName}</strong>) has not submitted the end-of-day debtor status report for <strong>${reportDate}</strong>. ${pendingCount} account(s) remain without a recorded status as of the final cutoff.
    </p>
    <p style="font-size:12px;color:#334155;margin:0;">This has been logged in the QSL ERP audit trail.</p>
  </div>
  <div style="background:#F0F4F8;padding:10px 28px;border-top:1px solid #E8ECF0;font-size:10px;color:#94A3B8;text-align:center;">Qalibrated Systems Limited · QSL ERP Automated Escalation</div>
</div>`;
  return send({ to: escalationRecipients.join(','), subject: `🔴 EOD Debtor Report Missing — ${reportDate} — ${fmName}`, html });
}

/**
 * Compiled end-of-day debtor status report to MD — the FM's structured update
 * on every overdue account, sent once the FM has recorded a status for each one.
 */
async function sendEODDebtorReportToMD(mdEmail, reportDate, fmName, entries, totalOutstanding) {
  const statusColor = {
    'Promised Payment': '#1E6B3C', 'Settled': '#1E6B3C', 'Partially Paid': '#B8600B',
    'Disputed': '#C00000', 'Escalated': '#C00000', 'No Response': '#94A3B8',
  };
  const rows = entries.map(e => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;font-weight:600;">${e.name}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #E8ECF0;font-size:12px;">Kshs ${Number(e.outstanding||0).toLocaleString('en-KE')}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #E8ECF0;font-size:11px;"><span style="background:${statusColor[e.status]||'#94A3B8'}1A;color:${statusColor[e.status]||'#94A3B8'};padding:3px 8px;border-radius:4px;font-weight:700;">${e.status}</span></td>
      <td style="padding:9px 12px;border-bottom:1px solid #E8ECF0;font-size:11px;color:#64748B;">${e.note||'—'}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #E8ECF0;font-size:11px;">${e.next_followup_date ? new Date(e.next_followup_date).toLocaleDateString('en-KE') : '—'}</td>
    </tr>`).join('');

  const html = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#334155;max-width:680px;margin:0 auto;border:1px solid #E8ECF0;border-radius:8px;overflow:hidden;">
  <div style="background:#1B3A5C;padding:22px 28px;">
    <div style="color:#C8960C;font-size:22px;font-weight:800;">QSL</div>
    <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:2px;letter-spacing:1px;">QALIBRATED SYSTEMS LIMITED · FINANCE</div>
  </div>
  <div style="background:#0D2238;padding:10px 28px;">
    <div style="color:#fff;font-size:14px;font-weight:700;">✅ End-of-Day Debtor Status Report</div>
    <div style="color:rgba(255,255,255,.7);font-size:11px;margin-top:2px;">${new Date(reportDate).toLocaleDateString('en-KE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})} · Submitted by ${fmName}</div>
  </div>
  <div style="padding:24px 28px;">
    <div style="background:#F0F4F8;border-radius:8px;padding:14px 18px;margin-bottom:18px;">
      <span style="font-size:11px;color:#94A3B8;">Total Outstanding Across All Accounts: </span>
      <strong style="font-size:14px;color:#C00000;">Kshs ${Number(totalOutstanding).toLocaleString('en-KE')}</strong>
      <span style="font-size:11px;color:#94A3B8;"> · ${entries.length} accounts followed up today</span>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#1B3A5C;">
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Client</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Outstanding</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Status</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">FM Note</th>
        <th style="padding:8px 12px;color:#fff;text-align:left;font-size:11px;">Next Follow-up</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="background:#F0F4F8;padding:12px 28px;border-top:1px solid #E8ECF0;font-size:10px;color:#94A3B8;text-align:center;">
    Qalibrated Systems Limited · Internal Finance Notification
  </div>
</div>`;

  return send({ to: mdEmail, subject: `EOD Debtor Report — ${reportDate} — ${entries.length} accounts — Kshs ${totalOutstanding.toLocaleString('en-KE')} outstanding`, html });
}

module.exports = { send, sendPayslip, sendInvoice, sendQuotePdf, sendImprestOverdueAlert, sendApprovalRequest, sendComplianceAlert, sendInvoiceReminder, sendCalibrationReminder, sendProjectPaymentReminder, sendPayablesDigest, sendDailyDebtorsList, sendEODReportReminder, sendEODReportEscalation, sendEODDebtorReportToMD };
