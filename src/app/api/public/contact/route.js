// src/app/api/public/contact/route.js — Company website contact form.
// Unauthenticated by design (it's the public site, not the ERP), but
// writes straight into the same `leads` table Commercial already uses —
// so a website enquiry shows up in the Commercial → Leads & Pipeline tab
// immediately, unassigned, ready for a Commercial Manager to claim and
// follow up. This is the one integration point between the public site
// and the ERP database; everything else on the public site is static
// marketing content with no data access.

import { v4 as uuid } from 'uuid';
import { ok, err, logAudit } from '../../../../lib/auth';
import { query, run } from '../../../../lib/db';

// Basic shape/format checks — not full validation, just enough to stop
// empty or obviously-junk submissions from reaching the pipeline. No auth
// token exists for a public visitor, so there is intentionally no
// requireAuth() call here.
function isValidEmail(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

export async function POST(req) {
  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { company, contact_name, email, phone, service, message } = body;

  if (!contact_name || !String(contact_name).trim()) return err('Please enter your name', 400);
  if (!email || !isValidEmail(email)) return err('Please enter a valid email address', 400);
  if (!message || String(message).trim().length < 5) return err('Please enter a short message describing what you need', 400);

  try {
    const id = uuid();
    const ref = `LEAD-WEB-${Date.now()}`;
    await run(
      `INSERT INTO leads (id,ref_no,company,contact_name,email,phone,service,source) VALUES (?,?,?,?,?,?,?,?)`,
      [id, ref, company || contact_name, contact_name, email, phone || null, service || 'General Enquiry', 'Website']
    );

    // Notify the commercial team a new website lead has landed, same
    // pattern as other system notification emails — fails silently to
    // console-mock in dev/no-SMTP environments, never blocks the visitor's
    // submission from succeeding.
    try {
      const { send } = require('../../../../lib/email');
      const notifyTo = process.env.SALES_NOTIFY_EMAIL || 'info@qalibrated.co.ke';
      await send({
        to: notifyTo,
        subject: `New website enquiry — ${contact_name}${company ? ` (${company})` : ''}`,
        html: `<div style="font-family:Inter,Arial,sans-serif;color:#334155;max-width:560px;">
          <h2 style="color:#1B3A5C;">New Website Enquiry</h2>
          <p><strong>Name:</strong> ${contact_name}<br/>
          <strong>Company:</strong> ${company || '—'}<br/>
          <strong>Email:</strong> ${email}<br/>
          <strong>Phone:</strong> ${phone || '—'}<br/>
          <strong>Service interest:</strong> ${service || 'General Enquiry'}</p>
          <p><strong>Message:</strong><br/>${String(message).replace(/</g, '&lt;')}</p>
          <p style="font-size:12px;color:#94A3B8;">Logged as ${ref} in Commercial → Leads & Pipeline, unassigned.</p>
        </div>`,
      });
    } catch { /* notification email is best-effort; the lead is already saved either way */ }

    await logAudit(query, { userId: null, userName: 'Website visitor', action: 'WEBSITE_CONTACT_FORM', module: 'PublicSite', recordId: id, newValue: { company, contact_name, email, service } });

    return ok({ submitted: true, ref_no: ref });
  } catch (e) {
    console.error('[Public Contact]', e);
    return err('Something went wrong submitting your enquiry — please try again or email us directly.', 500);
  }
}
