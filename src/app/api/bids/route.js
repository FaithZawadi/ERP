// src/app/api/bids/route.js — Bids & Pre-Sales API (Stage 2B Enforcement)

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';

// Stage 2B mandatory requirement codes (CSE-001 to CSE-012)
const MANDATORY_REQUIREMENTS = [
  { code:'CSE-001', name:'NCA Registration (applicable category)',     type:'mandatory' },
  { code:'CSE-002', name:'Tax Compliance Certificate — current',       type:'mandatory' },
  { code:'CSE-003', name:'ISO Accreditation (where required)',          type:'mandatory' },
  { code:'CSE-004', name:'Minimum Turnover threshold met',             type:'mandatory' },
  { code:'CSE-005', name:'Bid Bond / Tender Security capable',         type:'mandatory' },
  { code:'CSE-006', name:'EBK Practising Certificate',                 type:'scored'    },
  { code:'CSE-007', name:'Proof of Similar Works (3 references)',      type:'scored'    },
  { code:'CSE-008', name:'Key Personnel CVs submitted',               type:'scored'    },
  { code:'CSE-009', name:'Financial Statements (3 years)',             type:'conditional'},
  { code:'CSE-010', name:'Insurance — Professional Indemnity',        type:'scored'    },
  { code:'CSE-011', name:'Sub-contracting plan (if applicable)',       type:'conditional'},
  { code:'CSE-012', name:'HSE Policy and Method Statement',            type:'mandatory' },
];

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
          `SELECT b.*, e.first_name||' '||e.last_name as owner_name
           FROM bids b LEFT JOIN employees e ON b.owner=e.id
           ORDER BY b.deadline`
        );
        const [stats] = await query(
          `SELECT COUNT(*) as total, SUM(value) as total_value,
                  SUM(CASE WHEN stopped=1 THEN 1 ELSE 0 END) as stopped,
                  SUM(CASE WHEN stage2b_status='clear' THEN 1 ELSE 0 END) as clear,
                  SUM(CASE WHEN won_lost='won' THEN 1 ELSE 0 END) as won
           FROM bids`
        );
        return ok({ stats, bids: rows });
      }

      case 'detail': {
        if (!id) return err('id required', 400);
        const bid = await queryOne(`SELECT b.*, e.first_name||' '||e.last_name as owner_name FROM bids b LEFT JOIN employees e ON b.owner=e.id WHERE b.id=?`, [id]);
        if (!bid) return err('Bid not found', 404);
        const compliance = await query(`SELECT * FROM bid_compliance WHERE bid_id=? ORDER BY rowid`, [id]);
        return ok({ bid, compliance, requirements: MANDATORY_REQUIREMENTS });
      }

      case 'requirements':
        return ok(MANDATORY_REQUIREMENTS);

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Bids GET]', e);
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
        const { name, client, value, deadline } = body;
        if (!name) return err('name required', 400);
        const id     = uuid();
        const ref_no = `QSL-BID-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
        await run(
          `INSERT INTO bids (id,ref_no,name,client,value,deadline,stage,owner,stage2b_status) VALUES (?,?,?,?,?,?,'stage_1','pending',?)`,
          [id, ref_no, name, client, value||0, deadline, auth.user.employee_id]
        );
        // Auto-create compliance checklist
        for (const req of MANDATORY_REQUIREMENTS) {
          await run(`INSERT INTO bid_compliance (id,bid_id,requirement,type,position) VALUES (?,?,?,?,'PENDING')`,
            [uuid(), id, req.name, req.type]);
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_BID', module: 'Bids', recordId: id, newValue: { ref_no, name, value } });
        return ok({ id, ref_no }, 201);
      }

      case 'update_compliance': {
        const { bid_id, compliance_id, position, evidence_doc, notes } = body;
        if (!bid_id || !compliance_id) return err('bid_id and compliance_id required', 400);

        await run(`UPDATE bid_compliance SET position=?, evidence_doc=?, notes=?, checked_by=?, checked_at=datetime('now') WHERE id=?`,
          [position, evidence_doc, notes, auth.user.employee_id, compliance_id]);

        // PSB-004: Check if any mandatory requirement is DOES NOT MEET → auto-STOP
        const mandatory = await query(`SELECT * FROM bid_compliance WHERE bid_id=? AND type='mandatory' AND position='DOES NOT MEET'`, [bid_id]);
        if (mandatory.length > 0) {
          await run(`UPDATE bids SET stopped=1, stage='STOPPED', stopped_reason=? WHERE id=?`,
            [`Mandatory requirement failed: ${mandatory[0].requirement}`, bid_id]);
          await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'BID_STOPPED_AUTO', module: 'Bids', recordId: bid_id, newValue: { reason: mandatory[0].requirement } });
          return ok({ updated: true, bid_stopped: true, stopped_reason: mandatory[0].requirement });
        }

        // Check if all requirements met → mark Stage 2B clear
        const allChecked = await query(`SELECT * FROM bid_compliance WHERE bid_id=? AND position='PENDING'`, [bid_id]);
        if (allChecked.length === 0) {
          await run(`UPDATE bids SET stage2b_status='clear', compliance_clear=1, stage='stage_2b' WHERE id=? AND stopped=0`, [bid_id]);
        }

        return ok({ updated: true, bid_stopped: false });
      }

      case 'advance_stage': {
        const { bid_id, new_stage } = body;
        if (!bid_id || !new_stage) return err('bid_id and new_stage required', 400);

        const bid = await queryOne(`SELECT * FROM bids WHERE id=?`, [bid_id]);
        if (!bid) return err('Bid not found', 404);
        if (bid.stopped) return err('PSB-004: Bid is STOPPED due to mandatory requirement failure. Cannot advance.', 403);

        // Enforce Stage 2B gate — cannot move to Stage 3 without 2B clear
        if (new_stage === 'stage_3' && !bid.compliance_clear) {
          return err('PSB-004: Stage 2B compliance gate not cleared. Complete all compliance checks before advancing to Stage 3.', 403);
        }

        await run(`UPDATE bids SET stage=? WHERE id=?`, [new_stage, bid_id]);
        return ok({ updated: true, stage: new_stage });
      }

      case 'outcome': {
        const { bid_id, result, reason } = body;
        if (!bid_id || !result) return err('bid_id and result required', 400);
        await run(`UPDATE bids SET won_lost=?, won_lost_reason=?, outcome_date=date('now') WHERE id=?`, [result, reason, bid_id]);
        if (result === 'won') {
          await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'BID_WON', module: 'Bids', recordId: bid_id, newValue: { result, reason } });
        }
        return ok({ updated: true, result });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Bids POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
