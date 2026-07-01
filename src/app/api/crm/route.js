// src/app/api/crm/route.js — CRM, Clients & Leads API

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'clients';
  const id      = searchParams.get('id');

  try {
    switch (section) {
      case 'clients': {
        const rows = await query(
          `SELECT c.*, e.first_name||' '||e.last_name as owner_name
           FROM clients c LEFT JOIN employees e ON c.account_owner=e.id
           WHERE c.status='active' ORDER BY c.name`
        );
        return ok(rows);
      }
      case 'client': {
        if (!id) return err('id required', 400);
        const client = await queryOne(`SELECT c.*, e.first_name||' '||e.last_name as owner_name FROM clients c LEFT JOIN employees e ON c.account_owner=e.id WHERE c.id=?`, [id]);
        if (!client) return err('Client not found', 404);
        const interactions = await query(`SELECT i.*, e.first_name||' '||e.last_name as done_by_name FROM interactions i LEFT JOIN employees e ON i.done_by=e.id WHERE i.client_id=? ORDER BY i.date DESC LIMIT 20`, [id]);
        const invoices     = await query(`SELECT * FROM tax_invoices WHERE client_id=? ORDER BY date DESC LIMIT 10`, [id]);
        return ok({ client, interactions, invoices });
      }
      case 'leads': {
        return ok(await query(`SELECT l.*, e.first_name||' '||e.last_name as owner_name FROM leads l LEFT JOIN employees e ON l.owner=e.id WHERE l.won_lost IS NULL ORDER BY l.estimated_value DESC`));
      }
      case 'transfers': {
        return ok(await query(`SELECT ct.*, c.name as client_name, f.first_name||' '||f.last_name as from_name, t.first_name||' '||t.last_name as to_name FROM client_transfers ct JOIN clients c ON ct.client_id=c.id JOIN employees f ON ct.from_owner=f.id JOIN employees t ON ct.to_owner=t.id ORDER BY ct.created_at DESC`));
      }

      // QSL_ClientTransfer_Template — branded Client Transfer PDF
      case 'transfer_pdf': {
        if (!id) return err('id required', 400);
        const t = await queryOne(
          `SELECT ct.*, c.name as client_name, f.first_name||' '||f.last_name as from_name, tt.first_name||' '||tt.last_name as to_name
           FROM client_transfers ct JOIN clients c ON ct.client_id=c.id
           JOIN employees f ON ct.from_owner=f.id JOIN employees tt ON ct.to_owner=tt.id WHERE ct.id=?`, [id]);
        if (!t) return err('Not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('client_transfer', {
          docNo: `CT-${t.id.slice(0, 8).toUpperCase()}`,
          blocks: {
            Client:   { Name: t.client_name, Status: t.status },
            Transfer: { From: t.from_name, To: t.to_name },
          },
          body: [
            `Reason for transfer: ${t.reason || '—'}`,
            `CFO sign-off: ${t.cfo_signed_at ? 'Signed ' + new Date(t.cfo_signed_at).toLocaleDateString('en-KE') : 'Pending'}`,
            `MD sign-off: ${t.md_signed_at ? 'Signed ' + new Date(t.md_signed_at).toLocaleDateString('en-KE') : 'Pending'}`,
          ],
        });
        return ok(result);
      }

      // QSL_NDA_Template — branded NDA PDF for a client/counterparty
      case 'nda_pdf': {
        if (!id) return err('id required', 400);
        const client = await queryOne(`SELECT * FROM clients WHERE id=?`, [id]);
        if (!client) return err('Client not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('nda', {
          docNo: `NDA-${client.code}`,
          blocks: { Party: { 'Counterparty': client.name, 'Contact': client.contact_person, Email: client.email } },
          body: [
            `This Non-Disclosure Agreement is entered into between Qalibrated Systems Limited ("QSL") and ${client.name} ("the Counterparty") for the purpose of protecting confidential information exchanged in the course of their business relationship.`,
            'Both parties agree to hold all shared technical, commercial, and operational information in strict confidence, and not to disclose it to any third party without prior written consent, for a period of two (2) years from the date of signature.',
          ],
        });
        return ok(result);
      }
      // QSL_LeadCaptureForm_Template — branded Lead Capture Form PDF
      case 'lead_pdf': {
        if (!id) return err('id required', 400);
        const lead = await queryOne(`SELECT l.*, e.first_name||' '||e.last_name as owner_name FROM leads l LEFT JOIN employees e ON l.owner=e.id WHERE l.id=?`, [id]);
        if (!lead) return err('Lead not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('lead_capture', {
          docNo: lead.ref_no,
          blocks: {
            Lead:   { Company: lead.company, Contact: lead.contact_name, Email: lead.email, Phone: lead.phone },
            Source: { Source: lead.source || '—', Service: lead.service, 'Est. Value': `Kshs ${Number(lead.estimated_value||0).toLocaleString('en-KE')}` },
          },
          body: [`Captured by: ${lead.owner_name || '—'}`, `Stage: ${lead.stage}`],
        });
        return ok(result);
      }

      // QSL_ClientVisitReport_Template — branded Client Visit Report PDF (from an interaction)
      case 'visit_pdf': {
        if (!id) return err('id required', 400);
        const visit = await queryOne(
          `SELECT i.*, c.name as client_name, e.first_name||' '||e.last_name as done_by_name
           FROM interactions i LEFT JOIN clients c ON i.client_id=c.id LEFT JOIN employees e ON i.done_by=e.id WHERE i.id=?`, [id]);
        if (!visit) return err('Not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('client_visit', {
          docNo: `CVR-${visit.id.slice(0, 8).toUpperCase()}`,
          blocks: {
            Client: { Name: visit.client_name || '—', Type: visit.type },
            Visit:  { Date: visit.date, 'Reported by': visit.done_by_name },
          },
          body: [`Summary: ${visit.summary}`, `Next action: ${visit.next_action || 'None recorded'}`],
        });
        return ok(result);
      }

      // QSL_ContractCoverSheet_Template — branded Contract Cover Sheet PDF
      case 'contract_pdf': {
        if (!id) return err('id required', 400);
        const client = await queryOne(`SELECT c.*, e.first_name||' '||e.last_name as owner_name FROM clients c LEFT JOIN employees e ON c.account_owner=e.id WHERE c.id=?`, [id]);
        if (!client) return err('Client not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('contract_cover', {
          docNo: `CONTRACT-${client.code}`,
          blocks: {
            Client:   { Name: client.name, PIN: client.kra_pin, 'Account Owner': client.owner_name },
            Contract: { 'Payment Terms': `${client.payment_terms} days`, 'Credit Limit': `Kshs ${Number(client.credit_limit||0).toLocaleString('en-KE')}` },
          },
          body: [
            `This cover sheet accompanies the services agreement between Qalibrated Systems Limited and ${client.name}.`,
            'Attach the full signed contract / agreement document behind this cover sheet for filing.',
          ],
        });
        return ok(result);
      }

      // QSL_ClientOnboarding_Template — branded Client Onboarding PDF
      case 'onboarding_pdf': {
        if (!id) return err('id required', 400);
        const client = await queryOne(`SELECT c.*, e.first_name||' '||e.last_name as owner_name FROM clients c LEFT JOIN employees e ON c.account_owner=e.id WHERE c.id=?`, [id]);
        if (!client) return err('Client not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('client_onboarding', {
          docNo: `ONB-${client.code}`,
          blocks: {
            Client:  { Name: client.name, Contact: client.contact_person, Email: client.email, Phone: client.phone },
            Account: { Segment: client.segment, 'Account Owner': client.owner_name, 'Payment Terms': `${client.payment_terms} days` },
          },
          body: [
            `Client onboarded on ${new Date(client.created_at).toLocaleDateString('en-KE')}.`,
            `KRA PIN: ${client.kra_pin || 'Not yet captured'}. Address: ${client.address || 'Not yet captured'}.`,
          ],
        });
        return ok(result);
      }
      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    return err('Server error', 500);
  }
}

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {

      case 'create_client': {
        const { name, contact_person, email, phone, segment, company_id } = body;
        if (!name) return err('name required', 400);

        // Default to QSL's primary company unless the caller explicitly
        // attributes this client relationship to a sister company.
        let clientCompanyId = company_id || null;
        if (!clientCompanyId) {
          const primary = await queryOne(`SELECT id FROM companies WHERE is_primary=1`);
          clientCompanyId = primary?.id || null;
        }

        const id = uuid();
        const code = `CLT-${Date.now()}`;
        await run(
          `INSERT INTO clients (id,code,name,contact_person,email,phone,segment,account_owner,company_id) VALUES (?,?,?,?,?,?,?,?,?)`,
          [id, code, name, contact_person, email, phone, segment, auth.user.employee_id, clientCompanyId]
        );
        return ok({ id, code, company_id: clientCompanyId }, 201);
      }

      case 'log_interaction': {
        const { client_id, lead_id, type, date, summary, next_action } = body;
        if (!type || !summary) return err('type and summary required', 400);
        const id = uuid();
        await run(
          `INSERT INTO interactions (id,client_id,lead_id,type,date,summary,next_action,done_by) VALUES (?,?,?,?,?,?,?,?)`,
          [id, client_id, lead_id, type, date||new Date().toISOString().split('T')[0], summary, next_action, auth.user.employee_id]
        );
        return ok({ id }, 201);
      }

      case 'create_lead': {
        const { company, contact_name, email, service, estimated_value, source } = body;
        if (!company || !contact_name) return err('company and contact_name required', 400);
        const id  = uuid();
        const ref = `LEAD-${Date.now()}`;
        await run(
          `INSERT INTO leads (id,ref_no,company,contact_name,email,service,estimated_value,source,owner) VALUES (?,?,?,?,?,?,?,?,?)`,
          [id, ref, company, contact_name, email, service, estimated_value||0, source, auth.user.employee_id]
        );
        return ok({ id, ref_no: ref }, 201);
      }

      // CRM-055: Client ownership transfer — CFO + MD required
      case 'initiate_transfer': {
        const { client_id, to_owner_id, reason } = body;
        if (!client_id || !to_owner_id || !reason) return err('client_id, to_owner_id, reason required', 400);

        const client = await queryOne(`SELECT * FROM clients WHERE id=?`, [client_id]);
        if (!client) return err('Client not found', 404);

        const pending = await queryOne(`SELECT id FROM client_transfers WHERE client_id=? AND status IN ('pending_cfo','pending_md')`, [client_id]);
        if (pending) return err('Transfer already in progress for this client', 409);

        const id = uuid();
        await run(
          `INSERT INTO client_transfers (id,client_id,from_owner,to_owner,reason,status) VALUES (?,?,?,?,?,'pending_cfo')`,
          [id, client_id, client.account_owner, to_owner_id, reason]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'INITIATE_CLIENT_TRANSFER', module: 'CRM',
          recordId: client_id, newValue: { to_owner_id, reason },
        });

        return ok({ transfer_id: id, status: 'pending_cfo', message: 'CFO signature required' }, 201);
      }

      case 'sign_transfer': {
        const { transfer_id, signer_role, signature_key } = body;
        if (!transfer_id || !signer_role) return err('transfer_id and signer_role required', 400);

        const t = await queryOne(`SELECT * FROM client_transfers WHERE id=?`, [transfer_id]);
        if (!t) return err('Transfer not found', 404);

        const now = new Date().toISOString();

        if (signer_role === 'cfo' && t.status === 'pending_cfo') {
          await run(`UPDATE client_transfers SET cfo_sig=?, cfo_signed_at=?, status='pending_md' WHERE id=?`, [signature_key, now, transfer_id]);
          return ok({ signed: true, next: 'md', status: 'pending_md' });
        }

        if (signer_role === 'md' && t.status === 'pending_md') {
          await run(`UPDATE client_transfers SET md_sig=?, md_signed_at=?, status='complete' WHERE id=?`, [signature_key, now, transfer_id]);
          // Actual owner change
          await run(`UPDATE clients SET account_owner=? WHERE id=?`, [t.to_owner, t.client_id]);

          await logAudit(query, {
            userId: auth.user.id, userName: auth.user.name,
            action: 'COMPLETE_CLIENT_TRANSFER', module: 'CRM',
            recordId: t.client_id, newValue: { new_owner: t.to_owner, cfo_sig: t.cfo_sig, md_sig: signature_key },
          });

          return ok({ signed: true, complete: true, status: 'complete' });
        }

        return err('Invalid signing sequence or role', 400);
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[CRM POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
