// src/app/api/inspection/route.js — Inspection Body API (ISO/IEC 17020:2012, Module 18)
//
// QSL is a Type C inspection body — it both services/calibrates AND inspects the
// same equipment. This module exists to enforce the things that competence and
// accreditation depend on:
//   • INS-001  impartiality — the WE-02 repair signer cannot sign the WE-01 ruling
//   • INS-002  signing rights blocked if the annual COI is >7 days overdue
//   • INS-011  only QM/MD may authorise/revoke inspectors (REG-01)
//   • INS-013  signing rights lapse automatically when authorisation expires
//   • INS-023  a FAIL ruling auto-raises a WE-04 NCR and quarantines the equipment
//   • INS-036/039/044  WE-07 civil works → 5 hold-points; HP-5 dual sign-off → WE-08
//   • INS-050  WE-09 commissioning PASS (QM-signed) gates the calibration job
//   • INS-062  appeals go to a DIFFERENT inspector, decided within 10 business days
//
// Conventions (auth/db/signature/audit) mirror calibration/route.js and bids/route.js.

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit, createApprovalRecord } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

// QM duties. No dedicated 'qm' login role is seeded yet, so md/admin perform them
// (consistent with userHasPermission's md/admin bypass); a future 'qm' role works too.
const QM_ROLES = ['md', 'admin', 'qm'];

// ── helpers ───────────────────────────────────────────────────────────────────

// Apply the caller's RSA-2048 digital signature to a document ref (copied pattern
// from calibration/issue_cert). Returns the signature JSON string, or null if the
// caller has no active signature on file.
async function signAs(auth, documentRef, action) {
  const sig = await queryOne(
    `SELECT ds.key_id, ds.private_key FROM digital_signatures ds
     JOIN users u ON ds.user_id=u.id WHERE u.employee_id=? AND ds.is_active=1`,
    [auth.user.employee_id]
  );
  if (!sig) return null;
  const approval = createApprovalRecord(
    auth.user.employee_id, auth.user.name, sig.key_id, sig.private_key, documentRef, action
  );
  await run(`UPDATE digital_signatures SET uses=uses+1 WHERE key_id=?`, [sig.key_id]);
  return JSON.stringify({ key_id: approval.keyId, signature: approval.signature, timestamp: approval.timestamp });
}

// INS-002 + INS-013: an inspector may sign only while authorisation is current AND
// the annual COI is not more than 7 days overdue. Returns an error string or null.
async function assertSigningRights(inspectorId) {
  if (!inspectorId) return 'No inspector assigned to this inspection';
  const insp = await queryOne(
    `SELECT * FROM inspectors WHERE id=? AND status='active'
       AND (renewal_date IS NULL OR renewal_date >= date('now'))`,
    [inspectorId]
  );
  if (!insp) return 'INS-013: inspector authorisation is inactive or expired — signing rights removed';
  const coi = await queryOne(
    `SELECT * FROM inspector_coi WHERE inspector_id=? AND expires_at >= date('now','-7 days')
     ORDER BY expires_at DESC LIMIT 1`,
    [inspectorId]
  );
  if (!coi) return 'INS-002: annual COI declaration is missing or more than 7 days overdue — signing rights blocked';
  return null;
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'dashboard';
  const id = searchParams.get('id');

  try {
    switch (section) {
      case 'dashboard': {
        const [stats] = await query(
          `SELECT COUNT(*) as total,
                  SUM(CASE WHEN ruling='FAIL' THEN 1 ELSE 0 END) as failed,
                  SUM(CASE WHEN status='quarantined' THEN 1 ELSE 0 END) as quarantined,
                  SUM(CASE WHEN ruling='pending' THEN 1 ELSE 0 END) as open
           FROM inspections`
        );
        const [ncr] = await query(`SELECT COUNT(*) as open_ncrs FROM inspection_ncrs WHERE status='open'`);
        const [appeals] = await query(`SELECT COUNT(*) as open_appeals FROM inspection_appeals WHERE status='open'`);
        const [auth_exp] = await query(
          `SELECT COUNT(*) as expiring FROM inspectors
           WHERE status='active' AND renewal_date IS NOT NULL AND renewal_date <= date('now','+30 days')`
        );
        return ok({ stats, ...ncr, ...appeals, ...auth_exp });
      }

      case 'register': {
        const rows = await query(
          `SELECT i.*, c.name as client_name,
                  e.first_name||' '||e.last_name as inspector_name,
                  re.first_name||' '||re.last_name as repair_by_name
           FROM inspections i
           LEFT JOIN clients c ON i.client_id=c.id
           LEFT JOIN inspectors ins ON i.inspector_id=ins.id
           LEFT JOIN employees e ON ins.employee_id=e.id
           LEFT JOIN employees re ON i.repair_by=re.id
           ORDER BY i.created_at DESC`
        );
        return ok(rows);
      }

      case 'detail': {
        if (!id) return err('id required', 400);
        const ins = await queryOne(
          `SELECT i.*, c.name as client_name, e.first_name||' '||e.last_name as inspector_name
           FROM inspections i LEFT JOIN clients c ON i.client_id=c.id
           LEFT JOIN inspectors ins ON i.inspector_id=ins.id LEFT JOIN employees e ON ins.employee_id=e.id
           WHERE i.id=?`, [id]
        );
        if (!ins) return err('Inspection not found', 404);
        const forms = await query(`SELECT * FROM inspection_forms WHERE inspection_id=? ORDER BY created_at`, [id]);
        const holdpoints = await query(`SELECT * FROM civil_works_holdpoints WHERE inspection_id=? ORDER BY hp_no`, [id]);
        const ncrs = await query(`SELECT * FROM inspection_ncrs WHERE inspection_id=? ORDER BY created_at`, [id]);
        return ok({ inspection: ins, forms, holdpoints, ncrs });
      }

      case 'inspectors':
        return ok(await query(
          `SELECT ins.*, e.first_name||' '||e.last_name as employee_name,
                  ab.first_name||' '||ab.last_name as authorised_by_name,
                  (SELECT MAX(expires_at) FROM inspector_coi WHERE inspector_id=ins.id) as coi_expires
           FROM inspectors ins
           LEFT JOIN employees e ON ins.employee_id=e.id
           LEFT JOIN employees ab ON ins.authorised_by=ab.id
           ORDER BY e.first_name`
        ));

      case 'appeals':
        return ok(await query(
          `SELECT a.*, i.ins_no FROM inspection_appeals a
           LEFT JOIN inspections i ON a.inspection_id=i.id ORDER BY a.created_at DESC`
        ));

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Inspection GET]', e);
    return err('Server error', 500);
  }
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;
  const isQM = QM_ROLES.includes(auth.user.role);

  try {
    switch (action) {

      // INS-011: REG-01 — only QM/MD may authorise inspectors.
      case 'authorise_inspector': {
        if (!isQM) return err('INS-011: only the Quality Manager (or MD) may authorise inspectors', 403);
        const { employee_id, scope, renewal_date } = body;
        if (!employee_id) return err('employee_id required', 400);
        const id = uuid();
        await run(
          `INSERT INTO inspectors (id,employee_id,scope,authorised_by,auth_date,renewal_date,status)
           VALUES (?,?,?,?,date('now'),?,'active')`,
          [id, employee_id, scope, auth.user.employee_id, renewal_date]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'AUTHORISE_INSPECTOR', module: 'Inspection', recordId: id, newValue: { employee_id, scope } });
        return ok({ id }, 201);
      }

      // INS-011: revoke / suspend — QM/MD only, audit-logged.
      case 'revoke_inspector': {
        if (!isQM) return err('INS-011: only the Quality Manager (or MD) may revoke inspectors', 403);
        const { inspector_id, status } = body;
        if (!inspector_id) return err('inspector_id required', 400);
        await run(`UPDATE inspectors SET status=? WHERE id=?`, [status || 'revoked', inspector_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REVOKE_INSPECTOR', module: 'Inspection', recordId: inspector_id, newValue: { status: status || 'revoked' } });
        return ok({ updated: true });
      }

      // INS-002: record the annual COI declaration (expires in 1 year).
      case 'declare_coi': {
        const { inspector_id, conflicts_text } = body;
        if (!inspector_id) return err('inspector_id required', 400);
        await run(
          `INSERT INTO inspector_coi (id,inspector_id,declared_at,expires_at,conflicts_text)
           VALUES (?,?,date('now'),date('now','+365 days'),?)`,
          [uuid(), inspector_id, conflicts_text || 'No conflicts declared']
        );
        return ok({ declared: true }, 201);
      }

      // Open an inspection job. repair_by names the WE-02 repair signer so the
      // INS-001 impartiality check can fire at ruling time.
      case 'create_inspection': {
        const { type, equipment_serial, serialised_item_id, job_id, client_id, project_id, inspector_id, repair_by, scheduled_date } = body;
        if (!type) return err('type required', 400);
        const id = uuid();
        const ins_no = `QSL-INS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
        await run(
          `INSERT INTO inspections (id,ins_no,type,equipment_serial,serialised_item_id,job_id,client_id,project_id,inspector_id,repair_by,scheduled_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [id, ins_no, type, equipment_serial, serialised_item_id, job_id, client_id, project_id, inspector_id, repair_by, scheduled_date]
        );
        // For a civil-works inspection, auto-create the 5 WE-07 hold-points (INS-036).
        if (type === 'civil_works') {
          const HP = [
            'HP-1 Foundation / sub-base',
            'HP-2 Pit & drainage',
            'HP-3 Load cell mounts & deck',
            'HP-4 Approaches & alignment',
            'HP-5 Pre-installation clearance (dual sign-off)',
          ];
          for (let n = 0; n < HP.length; n++) {
            await run(`INSERT INTO civil_works_holdpoints (id,inspection_id,hp_no,description) VALUES (?,?,?,?)`,
              [uuid(), id, n + 1, HP[n]]);
          }
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_INSPECTION', module: 'Inspection', recordId: id, newValue: { ins_no, type } });
        return ok({ id, ins_no }, 201);
      }

      // WE-01 ruling — the heart of the module. Enforces INS-001 impartiality and
      // INS-002/013 signing rights, then on FAIL auto-raises a WE-04 NCR and
      // quarantines the equipment (INS-023).
      case 'submit_we01': {
        const { inspection_id, ruling, data } = body;
        if (!inspection_id || !ruling) return err('inspection_id and ruling required', 400);
        if (!['PASS', 'FAIL'].includes(ruling)) return err('ruling must be PASS or FAIL', 400);

        const ins = await queryOne(`SELECT * FROM inspections WHERE id=?`, [inspection_id]);
        if (!ins) return err('Inspection not found', 404);
        if (ins.ruling !== 'pending') return err('Inspection already ruled', 409);

        // INS-001 — hard rule: the repair signer cannot rule on the same equipment.
        if (ins.repair_by && ins.repair_by === auth.user.employee_id) {
          return err('INS-001: you signed the repair (WE-02) on this equipment and cannot sign the inspection ruling (WE-01) in the same job cycle', 403);
        }

        // INS-002 / INS-013 — signing rights must be current.
        const rights = await assertSigningRights(ins.inspector_id);
        if (rights) return err(rights, 403);

        const sig = await signAs(auth, ins.ins_no, 'INSPECTION_RULING_WE01');

        await run(
          `INSERT INTO inspection_forms (id,inspection_id,form_code,data,result,signed_by,sig)
           VALUES (?,?, 'WE-01', ?, ?, ?, ?)`,
          [uuid(), inspection_id, data ? JSON.stringify(data) : null, ruling, auth.user.employee_id, sig]
        );

        if (ruling === 'FAIL') {
          // INS-023 — auto NCR + quarantine, blocking certificate issuance.
          await run(`UPDATE inspections SET ruling='FAIL', status='quarantined', ruled_at=datetime('now'), signed_sig=? WHERE id=?`, [sig, inspection_id]);
          await run(`INSERT INTO inspection_ncrs (id,inspection_id,equipment_serial,raised_by) VALUES (?,?,?,?)`,
            [uuid(), inspection_id, ins.equipment_serial, auth.user.employee_id]);
          if (ins.serialised_item_id) {
            await run(`UPDATE serialised_items SET status='quarantined' WHERE id=?`, [ins.serialised_item_id]);
          }
          await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'INSPECTION_FAIL_NCR', module: 'Inspection', recordId: inspection_id, newValue: { ruling, ncr: true } });
          return ok({ ruled: true, ruling, ncr_raised: true, quarantined: true, signed: !!sig });
        }

        await run(`UPDATE inspections SET ruling='PASS', status='ruled', ruled_at=datetime('now'), signed_sig=? WHERE id=?`, [sig, inspection_id]);
        return ok({ ruled: true, ruling, signed: !!sig });
      }

      // WE-07 hold-point clearance. HP-1..HP-4: inspector sign-off. HP-5: dual
      // sign-off (inspector + QM) — the QM signature is what later unlocks WE-08.
      case 'clear_holdpoint': {
        const { holdpoint_id } = body;
        if (!holdpoint_id) return err('holdpoint_id required', 400);
        const hp = await queryOne(`SELECT * FROM civil_works_holdpoints WHERE id=?`, [holdpoint_id]);
        if (!hp) return err('Hold-point not found', 404);
        if (hp.status === 'cleared') return err('Hold-point already cleared', 409);

        if (hp.hp_no === 5) {
          // INS-039 — dual sign-off. Two calls: the inspector signs first, then QM.
          if (!hp.inspector_sig) {
            const sig = await signAs(auth, `HP-5/${hp.inspection_id}`, 'HOLDPOINT_INSPECTOR');
            await run(`UPDATE civil_works_holdpoints SET inspector_sig=? WHERE id=?`, [sig, holdpoint_id]);
            return ok({ stage: 'inspector_signed', needs_qm: true });
          }
          if (!isQM) return err('INS-039: HP-5 requires a Quality Manager counter-signature', 403);
          const qmSig = await signAs(auth, `HP-5/${hp.inspection_id}`, 'HOLDPOINT_QM');
          await run(`UPDATE civil_works_holdpoints SET qm_sig=?, status='cleared', cleared_at=datetime('now') WHERE id=?`, [qmSig, holdpoint_id]);
          await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'HP5_CLEARED', module: 'Inspection', recordId: hp.inspection_id });
          return ok({ stage: 'cleared', we08_unlocked: true });
        }

        const sig = await signAs(auth, `HP-${hp.hp_no}/${hp.inspection_id}`, 'HOLDPOINT_INSPECTOR');
        await run(`UPDATE civil_works_holdpoints SET inspector_sig=?, status='cleared', cleared_at=datetime('now') WHERE id=?`, [sig, holdpoint_id]);
        return ok({ stage: 'cleared' });
      }

      // INS-044 — WE-08 (pre-installation) cannot be initiated before HP-5 clearance.
      case 'submit_we08': {
        const { inspection_id, data } = body;
        if (!inspection_id) return err('inspection_id required', 400);
        const hp5 = await queryOne(`SELECT * FROM civil_works_holdpoints WHERE inspection_id=? AND hp_no=5`, [inspection_id]);
        if (!hp5 || hp5.status !== 'cleared') {
          return err('INS-044: WE-08 cannot be initiated before HP-5 is cleared (dual sign-off)', 403);
        }
        const sig = await signAs(auth, `WE-08/${inspection_id}`, 'PRE_INSTALL_WE08');
        await run(`INSERT INTO inspection_forms (id,inspection_id,form_code,data,result,signed_by,sig) VALUES (?,?, 'WE-08', ?, 'n/a', ?, ?)`,
          [uuid(), inspection_id, data ? JSON.stringify(data) : null, auth.user.employee_id, sig]);
        return ok({ submitted: true });
      }

      // INS-050 — WE-09 commissioning. A PASS requires the QM signature; recording
      // it is what unlocks the linked calibration job (the calibration route checks
      // for this form before issuing a certificate).
      case 'submit_we09': {
        const { inspection_id, result, data } = body;
        if (!inspection_id || !result) return err('inspection_id and result required', 400);
        if (result === 'PASS' && !isQM) return err('INS-050: WE-09 commissioning PASS requires Quality Manager sign-off', 403);
        const sig = await signAs(auth, `WE-09/${inspection_id}`, 'COMMISSIONING_WE09');
        await run(`INSERT INTO inspection_forms (id,inspection_id,form_code,data,result,signed_by,sig,qm_sig) VALUES (?,?, 'WE-09', ?, ?, ?, ?, ?)`,
          [uuid(), inspection_id, data ? JSON.stringify(data) : null, result, auth.user.employee_id, sig, isQM ? sig : null]);
        if (result === 'PASS') {
          await run(`UPDATE inspections SET status='closed' WHERE id=?`, [inspection_id]);
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'COMMISSIONING_WE09', module: 'Inspection', recordId: inspection_id, newValue: { result } });
        return ok({ submitted: true, result, calibration_unlocked: result === 'PASS' });
      }

      // INS-062 — appeal must be assigned to a DIFFERENT inspector; due in 10 business days.
      case 'raise_appeal': {
        const { inspection_id, assigned_inspector, grounds } = body;
        if (!inspection_id || !assigned_inspector) return err('inspection_id and assigned_inspector required', 400);
        const ins = await queryOne(`SELECT * FROM inspections WHERE id=?`, [inspection_id]);
        if (!ins) return err('Inspection not found', 404);
        if (ins.inspector_id && assigned_inspector === ins.inspector_id) {
          return err('INS-062: an appeal must be assigned to a different inspector than the original ruling', 400);
        }
        // 10 business days ≈ 14 calendar days (2 weekends).
        await run(
          `INSERT INTO inspection_appeals (id,inspection_id,original_inspector,assigned_inspector,grounds,due_date,status)
           VALUES (?,?,?,?,?, date('now','+14 days'), 'open')`,
          [uuid(), inspection_id, ins.inspector_id, assigned_inspector, grounds]
        );
        return ok({ raised: true }, 201);
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Inspection POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
