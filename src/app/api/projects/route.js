// src/app/api/projects/route.js — Projects & Operations API

import { NextResponse } from 'next/server';
import { v4 as uuid }   from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'list';
  const id      = searchParams.get('id');

  try {
    switch (section) {

      case 'list': {
        const rows = await query(
          `SELECT p.*,
            c.name as client_name,
            e.first_name||' '||e.last_name as pm_name
           FROM projects p
           LEFT JOIN clients c ON p.client_id=c.id
           LEFT JOIN employees e ON p.pm_id=e.id
           WHERE p.status != 'archived'
           ORDER BY p.created_at DESC`
        );
        return ok(rows);
      }

      case 'detail': {
        if (!id) return err('id required', 400);
        const project = await queryOne(
          `SELECT p.*, c.name as client_name, e.first_name||' '||e.last_name as pm_name
           FROM projects p LEFT JOIN clients c ON p.client_id=c.id LEFT JOIN employees e ON p.pm_id=e.id
           WHERE p.id=?`, [id]
        );
        if (!project) return err('Project not found', 404);

        const [milestones, expenses, budgets, subcontractors, updates] = await Promise.all([
          query(`SELECT pm.*, e.first_name||' '||e.last_name as updated_by_name FROM project_milestones pm LEFT JOIN employees e ON pm.updated_by=e.id WHERE pm.project_id=? ORDER BY pm.seq`, [id]),
          query(`SELECT pe.*, e.first_name||' '||e.last_name as posted_by_name FROM project_expenses pe LEFT JOIN employees e ON pe.posted_by=e.id WHERE pe.project_id=? ORDER BY pe.date DESC`, [id]),
          query(`SELECT * FROM project_budgets WHERE project_id=?`, [id]),
          query(`SELECT ps.*, s.name as supplier_name FROM project_subcontractors ps LEFT JOIN suppliers s ON ps.supplier_id=s.id WHERE ps.project_id=?`, [id]),
          query(`SELECT du.*, e.first_name||' '||e.last_name as updated_by_name FROM daily_project_updates du LEFT JOIN employees e ON du.updated_by=e.id WHERE du.project_id=? ORDER BY du.date DESC LIMIT 14`, [id]),
        ]);

        return ok({ project, milestones, expenses, budgets, subcontractors, updates });
      }

      case 'portfolio_stats': {
        const [stats] = await query(
          `SELECT
            COUNT(*) as total_projects,
            SUM(contract_value) as total_value,
            SUM(budget_total) as total_budget,
            SUM(expenses_total) as total_expenses,
            SUM(invoiced_total) as total_invoiced,
            SUM(collected_total) as total_collected,
            SUM(contract_value - expenses_total) as gross_profit,
            COUNT(CASE WHEN budget_blocked=1 THEN 1 END) as budget_blocked_count,
            COUNT(CASE WHEN status='active' THEN 1 END) as active_count
           FROM projects WHERE status != 'archived'`
        );
        return ok(stats);
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Projects GET]', e);
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

      case 'create': {
        const { name, client_id, contract_value, pm_id, end_date, scope, department, company_id } = body;
        if (!name || !client_id || !contract_value) return err('name, client_id, contract_value required', 400);

        // Default the project's company: explicit company_id wins; otherwise
        // inherit the client's company (a sister-company client's projects
        // should default into that same entity); otherwise QSL's primary.
        let projectCompanyId = company_id || null;
        if (!projectCompanyId) {
          const client = await queryOne(`SELECT company_id FROM clients WHERE id=?`, [client_id]);
          projectCompanyId = client?.company_id || null;
        }
        if (!projectCompanyId) {
          const primary = await queryOne(`SELECT id FROM companies WHERE is_primary=1`);
          projectCompanyId = primary?.id || null;
        }

        const id     = uuid();
        const ref_no = `QSL-PROJ-${String(Date.now()).slice(-6)}`;

        await run(
          `INSERT INTO projects (id,ref_no,name,client_id,company_id,contract_value,pm_id,end_date,scope,department,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,'active')`,
          [id, ref_no, name, client_id, projectCompanyId, contract_value, pm_id, end_date, scope, department]
        );

        // If this project runs under a sister company, make sure a
        // commission record exists in Inter-Company — same logic as
        // /api/companies' set_project_company action, applied at creation
        // time so it's never possible to forget.
        let commission_drafted = false;
        if (projectCompanyId) {
          const company = await queryOne(`SELECT * FROM companies WHERE id=?`, [projectCompanyId]);
          if (company && !company.is_primary && company.related_party_id) {
            const icId = uuid();
            await run(
              `INSERT INTO ic_transactions (id, entity_id, project_id, type, contract_value, fee_pct, min_fee_pct, status, icsa_verified, created_by)
               VALUES (?,?,?,?,?,?,?,?,0,?)`,
              [icId, company.related_party_id, id, 'management_fee', contract_value, 0.05, 0.05, 'pending', auth.user.employee_id]
            );
            commission_drafted = true;
          }
        }

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'CREATE_PROJECT', module: 'Projects',
          recordId: id, newValue: { ref_no, name, contract_value, company_id: projectCompanyId, commission_drafted },
        });

        return ok({
          id, ref_no, company_id: projectCompanyId, commission_drafted,
          note: commission_drafted ? 'This project runs under a sister company — a draft commission record was created in Inter-Company and must be ICSA-verified before any invoice can be issued (ICM-002).' : undefined,
        }, 201);
      }

      case 'post_expense': {
        const { project_id, date, description, category, amount, receipt_path } = body;
        if (!project_id || !amount || !description) return err('project_id, amount, description required', 400);

        const project = await queryOne(`SELECT * FROM projects WHERE id=?`, [project_id]);
        if (!project) return err('Project not found', 404);

        // PROJ-016: Budget block check
        const newTotal = (project.expenses_total || 0) + amount;
        if (project.budget_total > 0 && newTotal > project.budget_total && !project.budget_override_sig) {
          return err('PROJ-016: Budget block active — MD written approval required before posting expenses. Use budget_override action first.', 403);
        }

        const id = uuid();
        await run(
          `INSERT INTO project_expenses (id,project_id,date,description,category,amount,receipt_path,posted_by)
           VALUES (?,?,?,?,?,?,?,?)`,
          [id, project_id, date || new Date().toISOString().split('T')[0], description, category, amount, receipt_path, auth.user.employee_id]
        );

        // Update project totals
        await run(`UPDATE projects SET expenses_total=expenses_total+?, updated_at=datetime('now') WHERE id=?`, [amount, project_id]);

        // Check if budget now blocked
        if (project.budget_total > 0 && newTotal >= project.budget_total) {
          await run(`UPDATE projects SET budget_blocked=1 WHERE id=?`, [project_id]);
        }

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'POST_EXPENSE', module: 'Projects',
          recordId: project_id, newValue: { amount, category, description },
        });

        return ok({ expense_id: id, new_total: newTotal }, 201);
      }

      case 'daily_update': {
        const { project_id, exp_update, milestone_update } = body;
        if (!project_id) return err('project_id required', 400);

        const id   = uuid();
        const date = new Date().toISOString().split('T')[0];
        await run(
          `INSERT INTO daily_project_updates (id,project_id,date,exp_update,milestone_update,updated_by) VALUES (?,?,?,?,?,?)`,
          [id, project_id, date, exp_update, milestone_update, auth.user.employee_id]
        );
        await run(`UPDATE projects SET updated_at=datetime('now') WHERE id=?`, [project_id]);

        return ok({ id, date }, 201);
      }

      case 'md_budget_override': {
        const { project_id, additional_amount, justification, md_signature_key } = body;
        if (!project_id || !md_signature_key) return err('project_id and md_signature_key required', 400);
        if (auth.user.role !== 'md' && auth.user.role !== 'admin') return err('Only MD can approve budget override', 403);

        await run(
          `UPDATE projects SET budget_blocked=0, budget_override_sig=?, budget_override_by=?, budget_override_at=datetime('now'), budget_total=budget_total+? WHERE id=?`,
          [md_signature_key, auth.user.employee_id, additional_amount || 0, project_id]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'MD_BUDGET_OVERRIDE', module: 'Projects',
          recordId: project_id, newValue: { additional_amount, justification, sig: md_signature_key },
        });

        return ok({ approved: true, additional_amount });
      }

      case 'update_milestone': {
        const { milestone_id, pct_complete, actual_date, status, notes } = body;
        if (!milestone_id) return err('milestone_id required', 400);

        await run(
          `UPDATE project_milestones SET pct_complete=?,actual_date=?,status=?,notes=?,updated_by=?,updated_at=datetime('now') WHERE id=?`,
          [pct_complete, actual_date, status, notes, auth.user.employee_id, milestone_id]
        );

        return ok({ updated: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Projects POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
