// src/app/api/assets/route.js — Fixed Assets API

import { NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'register';

  try {
    switch (section) {
      case 'register': {
        const rows = await query(
          `SELECT a.*, e.first_name||' '||e.last_name as custodian_name
           FROM assets a LEFT JOIN employees e ON a.custodian=e.id
           WHERE a.status != 'disposed' ORDER BY a.category, a.name`
        );
        const [totals] = await query(
          `SELECT SUM(cost) as total_cost, SUM(nbv) as total_nbv, SUM(cost-nbv) as total_depreciation, COUNT(*) as count
           FROM assets WHERE status='in_use'`
        );
        return ok({ totals, assets: rows });
      }

      case 'depreciation_schedule': {
        const rows = await query(
          `SELECT a.id, a.tag_no, a.name, a.category, a.cost, a.nbv, a.dep_method, a.dep_rate,
                  CASE WHEN a.dep_method='straight_line' THEN ROUND(a.cost*a.dep_rate)
                       ELSE ROUND(a.nbv*a.dep_rate) END as annual_charge,
                  CASE WHEN a.dep_method='straight_line' THEN ROUND(a.cost*a.dep_rate/12)
                       ELSE ROUND(a.nbv*a.dep_rate/12) END as monthly_charge
           FROM assets a WHERE a.status='in_use' ORDER BY annual_charge DESC`
        );
        const [summary] = await query(
          `SELECT SUM(CASE WHEN dep_method='straight_line' THEN ROUND(cost*dep_rate) ELSE ROUND(nbv*dep_rate) END) as total_annual
           FROM assets WHERE status='in_use'`
        );
        return ok({ summary, schedule: rows });
      }

      case 'by_category': {
        const rows = await query(
          `SELECT category, COUNT(*) as count, SUM(cost) as total_cost, SUM(nbv) as total_nbv,
                  ROUND(SUM(nbv)*100.0/SUM(cost),1) as nbv_pct
           FROM assets WHERE status='in_use' GROUP BY category ORDER BY total_cost DESC`
        );
        return ok(rows);
      }

      case 'depreciation_history': {
        const rows = await query(
          `SELECT dr.*, a.name as asset_name, a.tag_no, e.first_name||' '||e.last_name as run_by_name
           FROM depreciation_runs dr JOIN assets a ON dr.asset_id=a.id LEFT JOIN employees e ON dr.run_by=e.id
           ORDER BY dr.created_at DESC LIMIT 100`
        );
        return ok(rows);
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Assets GET]', e);
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
        const { name, category, cost, purchase_date, dep_method, dep_rate, location, custodian, serial_no, warranty_to } = body;
        if (!name || !category || !cost || !purchase_date) return err('name, category, cost, purchase_date required', 400);
        if (cost < 10000) return err('ASSET-001: Capitalisation threshold is Kshs 10,000. Items below this must be expensed directly.', 400);

        const id     = uuid();
        const tag_no = `QSL-AST-${Date.now().toString().slice(-6)}`;
        const nbv    = parseFloat(cost);

        await run(
          `INSERT INTO assets (id,tag_no,name,category,cost,nbv,purchase_date,dep_method,dep_rate,location,custodian,serial_no,warranty_to,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'in_use')`,
          [id, tag_no, name, category, nbv, nbv, purchase_date, dep_method||'straight_line', dep_rate||0.20, location, custodian, serial_no, warranty_to]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'CREATE_ASSET', module: 'Assets',
          recordId: id, newValue: { tag_no, name, cost, category },
        });

        return ok({ id, tag_no }, 201);
      }

      case 'run_depreciation': {
        const { period } = body;
        if (!period) return err('period required (YYYY-MM)', 400);

        const assets = await query(`SELECT * FROM assets WHERE status='in_use'`);
        const results = [];

        await transaction(async ({ run: dbRun }) => {
          for (const a of assets) {
            const charge = a.dep_method === 'straight_line'
              ? Math.round(a.cost * a.dep_rate / 12)
              : Math.round(a.nbv  * a.dep_rate / 12);
            const newNbv  = Math.max(0, a.nbv - charge);

            await dbRun(
              `INSERT INTO depreciation_runs (id,period,asset_id,nbv_before,charge,nbv_after,method,run_by) VALUES (?,?,?,?,?,?,?,?)`,
              [uuid(), period, a.id, a.nbv, charge, newNbv, a.dep_method, auth.user.employee_id]
            );
            await dbRun(`UPDATE assets SET nbv=? WHERE id=?`, [newNbv, a.id]);
            results.push({ asset_id: a.id, name: a.name, charge, nbv_before: a.nbv, nbv_after: newNbv });
          }
        });

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'RUN_DEPRECIATION', module: 'Assets',
          newValue: { period, assets_processed: results.length },
        });

        return ok({ period, processed: results.length, total_charge: results.reduce((s,r)=>s+r.charge,0), results });
      }

      case 'dispose': {
        const { asset_id, disposal_date, disposal_amount, disposal_reason, sig } = body;
        if (!asset_id || !disposal_date || !disposal_reason) return err('asset_id, disposal_date, disposal_reason required', 400);
        if (!sig) return err('Digital signature required for asset disposal', 400);

        await run(
          `UPDATE assets SET status='disposed', disposal_date=?, disposal_amount=?, disposal_reason=?, disposal_sig=? WHERE id=?`,
          [disposal_date, disposal_amount||0, disposal_reason, sig, asset_id]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'DISPOSE_ASSET', module: 'Assets',
          recordId: asset_id, newValue: { disposal_date, disposal_reason, sig },
        });

        return ok({ disposed: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Assets POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
