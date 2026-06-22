// src/app/api/companies/route.js — Legal Entity Registry (multi-company architecture, ARCH-002B-F)
//
// This is NOT multi-tenancy. There is one QSL workforce, one set of
// equipment, one HR/payroll system — employees, items, vehicles, suppliers
// are never scoped by company and never will be. What this module manages
// is purely the paper trail: which legal entity a project, client
// relationship, or invoice is filed under. QSL staff always do the actual
// work; a sister company is sometimes used as the contracting vehicle when
// a client won't contract QSL directly, in which case QSL earns a
// commission via the existing Inter-Company module (ICSA-gated, 5%/3%
// minimum fee — see ICM-002/003 in src/app/api/ic/route.js).
//
// GET  ?section=list             -> all companies
// GET  ?section=detail&id=       -> one company with its projects/clients/invoices summary
//
// POST { action: 'create_company', code, legal_name, kra_pin, registered_address, related_party_id }
// POST { action: 'update_company', id, kra_pin, registered_address, bank_account_id, status }
// POST { action: 'set_project_company', project_id, company_id }   -- also nudges IC commission if not QSL
// POST { action: 'set_client_company', client_id, company_id }

import { v4 as uuid } from 'uuid';
import { requireAuth, requireRole, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'list';

  try {
    if (section === 'list') {
      const rows = await query(
        `SELECT c.*, rp.name as related_party_name,
                (SELECT COUNT(*) FROM projects p WHERE p.company_id=c.id) as project_count,
                (SELECT COUNT(*) FROM clients cl WHERE cl.company_id=c.id) as client_count,
                (SELECT COUNT(*) FROM tax_invoices ti WHERE ti.company_id=c.id) as invoice_count
         FROM companies c LEFT JOIN related_parties rp ON c.related_party_id=rp.id
         ORDER BY c.is_primary DESC, c.legal_name`
      );
      return ok(rows);
    }

    if (section === 'detail') {
      const id = searchParams.get('id');
      if (!id) return err('id required', 400);
      const company = await queryOne(`SELECT * FROM companies WHERE id=?`, [id]);
      if (!company) return err('Company not found', 404);

      const projects = await query(
        `SELECT id, ref_no, name, contract_value, status FROM projects WHERE company_id=? ORDER BY created_at DESC LIMIT 20`,
        [id]
      );
      const clients = await query(
        `SELECT id, code, name, outstanding FROM clients WHERE company_id=? ORDER BY name`,
        [id]
      );
      const invoices = await query(
        `SELECT id, invoice_no, total, status, date FROM tax_invoices WHERE company_id=? ORDER BY date DESC LIMIT 20`,
        [id]
      );
      const commissions = company.related_party_id
        ? await query(
            `SELECT ic.*, p.ref_no as project_ref, p.name as project_name
             FROM ic_transactions ic LEFT JOIN projects p ON ic.project_id=p.id
             WHERE ic.entity_id=? ORDER BY ic.created_at DESC LIMIT 20`,
            [company.related_party_id]
          )
        : [];

      return ok({ company, projects, clients, invoices, commissions });
    }

    return err(`Unknown section: ${section}`, 400);
  } catch (e) {
    console.error('[Companies GET]', e);
    return err('Server error: ' + e.message, 500);
  }
}

export async function POST(req) {
  // Companies is an MD/Admin-level concern — changing which legal entity a
  // project or invoice is filed under has real legal and tax consequences.
  const auth = await requireRole('md', 'admin')(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {

      case 'create_company': {
        const { code, legal_name, kra_pin, registered_address, related_party_id } = body;
        if (!code || !legal_name) return err('code and legal_name required', 400);

        const existing = await queryOne(`SELECT id FROM companies WHERE code=?`, [code]);
        if (existing) return err(`Company code "${code}" already in use`, 400);

        const id = uuid();
        await run(
          `INSERT INTO companies (id, code, legal_name, kra_pin, registered_address, related_party_id, is_primary, status)
           VALUES (?,?,?,?,?,?,0,'active')`,
          [id, code, legal_name, kra_pin || null, registered_address || null, related_party_id || null]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'CREATE_COMPANY', module: 'Companies',
          recordId: id, newValue: { code, legal_name, related_party_id },
        });

        return ok({ id, code, legal_name }, 201);
      }

      case 'update_company': {
        const { id, kra_pin, registered_address, bank_account_id, status } = body;
        if (!id) return err('id required', 400);
        const company = await queryOne(`SELECT * FROM companies WHERE id=?`, [id]);
        if (!company) return err('Company not found', 404);

        await run(
          `UPDATE companies SET kra_pin=?, registered_address=?, bank_account_id=?, status=? WHERE id=?`,
          [
            kra_pin ?? company.kra_pin,
            registered_address ?? company.registered_address,
            bank_account_id ?? company.bank_account_id,
            status ?? company.status,
            id,
          ]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'UPDATE_COMPANY', module: 'Companies',
          recordId: id, newValue: { kra_pin, registered_address, bank_account_id, status },
        });

        return ok({ updated: true });
      }

      // Attribute a project to a legal entity. If the company is a sister
      // company (not QSL's own is_primary record) and no IC commission
      // record exists yet for this project, create a draft one so it's
      // impossible to forget the commission — it still goes through the
      // existing ICSA-gated approval in /api/ic before any fee can be
      // collected (ICM-002/003 unchanged).
      case 'set_project_company': {
        const { project_id, company_id } = body;
        if (!project_id || !company_id) return err('project_id and company_id required', 400);

        const project = await queryOne(`SELECT * FROM projects WHERE id=?`, [project_id]);
        if (!project) return err('Project not found', 404);
        const company = await queryOne(`SELECT * FROM companies WHERE id=?`, [company_id]);
        if (!company) return err('Company not found', 404);

        await run(`UPDATE projects SET company_id=? WHERE id=?`, [company_id, project_id]);

        let commission_drafted = false;
        if (!company.is_primary) {
          if (!company.related_party_id) {
            return err(
              `Company "${company.legal_name}" has no linked related_party record, so a commission cannot be tracked. Link it to a related party first (Admin > Companies), or this project cannot bill until that's done.`,
              400
            );
          }
          const existingIc = await queryOne(
            `SELECT id FROM ic_transactions WHERE project_id=? AND entity_id=?`,
            [project_id, company.related_party_id]
          );
          if (!existingIc) {
            const icId = uuid();
            await run(
              `INSERT INTO ic_transactions (id, entity_id, project_id, type, contract_value, fee_pct, min_fee_pct, status, icsa_verified, created_by)
               VALUES (?,?,?,?,?,?,?,?,0,?)`,
              [icId, company.related_party_id, project_id, 'management_fee', project.contract_value || 0, 0.05, 0.05, 'pending', auth.user.employee_id]
            );
            commission_drafted = true;
          }
        }

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'SET_PROJECT_COMPANY', module: 'Companies',
          recordId: project_id, newValue: { company_id, commission_drafted },
        });

        return ok({
          updated: true,
          commission_drafted,
          note: commission_drafted
            ? 'This project now runs under a sister company. A draft commission record was created in Inter-Company — it must be ICSA-verified before any invoice can be issued, per ICM-002.'
            : undefined,
        });
      }

      case 'set_client_company': {
        const { client_id, company_id } = body;
        if (!client_id || !company_id) return err('client_id and company_id required', 400);

        const client = await queryOne(`SELECT id FROM clients WHERE id=?`, [client_id]);
        if (!client) return err('Client not found', 404);
        const company = await queryOne(`SELECT id FROM companies WHERE id=?`, [company_id]);
        if (!company) return err('Company not found', 404);

        await run(`UPDATE clients SET company_id=? WHERE id=?`, [company_id, client_id]);

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'SET_CLIENT_COMPANY', module: 'Companies',
          recordId: client_id, newValue: { company_id },
        });

        return ok({ updated: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Companies POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
