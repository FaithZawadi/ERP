// src/app/api/calibration/route.js — Calibration & ISO 17025 API

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';
import { createApprovalRecord } from '../../../lib/auth';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'dashboard';

  try {
    switch (section) {
      case 'dashboard': {
        const [stats] = await query(
          `SELECT COUNT(*) as total, SUM(CASE WHEN result='pass' THEN 1 ELSE 0 END) as passed,
                  SUM(CASE WHEN next_cal_date <= date('now','+60 days') THEN 1 ELSE 0 END) as expiring
           FROM calibration_certs`
        );
        const [refStats] = await query(
          `SELECT COUNT(*) as total, SUM(CASE WHEN status='current' THEN 1 ELSE 0 END) as current,
                  SUM(CASE WHEN next_cal_date <= date('now','+30 days') THEN 1 ELSE 0 END) as expiring
           FROM reference_standards`
        );
        return ok({ cert_stats: stats, ref_stats: refStats });
      }

      case 'certificates': {
        const rows = await query(
          `SELECT cc.*, c.name as client_name, e.first_name||' '||e.last_name as technician_name
           FROM calibration_certs cc
           LEFT JOIN clients c ON cc.client_id=c.id
           LEFT JOIN employees e ON cc.technician_id=e.id
           ORDER BY cc.calibrated_at DESC`
        );
        return ok(rows);
      }

      case 'reference_standards':
        return ok(await query(`SELECT * FROM reference_standards ORDER BY name`));

      case 'schedule':
        return ok(await query(
          `SELECT cj.*, c.name as client_name, e.first_name||' '||e.last_name as technician_name
           FROM calibration_jobs cj LEFT JOIN clients c ON cj.client_id=c.id LEFT JOIN employees e ON cj.technician_id=e.id
           ORDER BY cj.scheduled_date`
        ));

      case 'cert_detail': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const cert = await queryOne(
          `SELECT cc.*, c.name as client_name, e.first_name||' '||e.last_name as technician_name, rs.name as std_name, rs.uncertainty as std_uncertainty, rs.traceable_to
           FROM calibration_certs cc LEFT JOIN clients c ON cc.client_id=c.id LEFT JOIN employees e ON cc.technician_id=e.id LEFT JOIN reference_standards rs ON cc.ref_standard_id=rs.id
           WHERE cc.id=?`, [id]
        );
        if (!cert) return err('Certificate not found', 404);
        return ok(cert);
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Calibration GET]', e);
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
      case 'issue_cert': {
        const { client_id, instrument, make, model, serial_no, range, uncertainty, ref_standard_id, calibrated_at, next_cal_date, result, temp_c, humidity_pct, job_id } = body;
        if (!client_id || !instrument || !uncertainty) return err('client_id, instrument, uncertainty required', 400);

        // INS-023 — an inspection FAIL quarantines the equipment and BLOCKS
        // certificate issuance until the WE-04 NCR is resolved. Cross-checks the
        // Inspection Body module by serial number (safe if that module is absent —
        // the query simply returns nothing).
        if (serial_no) {
          const blocked = await queryOne(
            `SELECT i.ins_no FROM inspections i
             WHERE i.equipment_serial=? AND (i.status='quarantined'
               OR EXISTS (SELECT 1 FROM inspection_ncrs n WHERE n.inspection_id=i.id AND n.status='open'))
             LIMIT 1`,
            [serial_no]
          ).catch(() => null);
          if (blocked) return err(`INS-023: equipment ${serial_no} is quarantined by inspection ${blocked.ins_no} (open NCR) — certificate blocked until resolved`, 403);
        }

        const id       = uuid();
        const cert_no  = `QSL-CAL-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;

        // Get technician's digital signature
        const sigRecord = await queryOne(
          `SELECT ds.key_id, ds.private_key FROM digital_signatures ds JOIN users u ON ds.user_id=u.id WHERE u.employee_id=? AND ds.is_active=1`,
          [auth.user.employee_id]
        );

        let tech_sig = null;
        if (sigRecord) {
          const approval = createApprovalRecord(
            auth.user.employee_id, auth.user.name, sigRecord.key_id, sigRecord.private_key,
            cert_no, 'ISSUE_CALIBRATION_CERTIFICATE'
          );
          tech_sig = JSON.stringify({ key_id: approval.keyId, signature: approval.signature, timestamp: approval.timestamp });
          // Increment usage count
          await run(`UPDATE digital_signatures SET uses=uses+1 WHERE key_id=?`, [sigRecord.key_id]);
        }

        await run(
          `INSERT INTO calibration_certs (id,cert_no,job_id,client_id,instrument,make,model,serial_no,range,uncertainty,ref_standard_id,calibrated_at,next_cal_date,result,temp_c,humidity_pct,technician_id,tech_sig)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, cert_no, job_id, client_id, instrument, make, model, serial_no, range, uncertainty, ref_standard_id, calibrated_at||new Date().toISOString().split('T')[0], next_cal_date, result||'pass', temp_c, humidity_pct, auth.user.employee_id, tech_sig]
        );

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'ISSUE_CAL_CERT', module: 'Calibration', recordId: id, newValue: { cert_no, instrument, client_id } });

        return ok({ id, cert_no, signed: !!tech_sig, sig_key: sigRecord?.key_id }, 201);
      }

      case 'add_reference_standard': {
        const { name, make, model, serial_no, traceable_to, last_cal_date, next_cal_date, uncertainty } = body;
        if (!name) return err('name required', 400);
        const id = uuid();
        await run(`INSERT INTO reference_standards (id,name,make,model,serial_no,traceable_to,last_cal_date,next_cal_date,uncertainty,status) VALUES (?,?,?,?,?,?,?,?,?,'current')`,
          [id, name, make, model, serial_no, traceable_to||'KEBS', last_cal_date, next_cal_date, uncertainty]);
        return ok({ id }, 201);
      }

      case 'schedule_job': {
        const { client_id, site, instruments, scheduled_date, technician_id, project_id } = body;
        if (!client_id || !scheduled_date) return err('client_id and scheduled_date required', 400);
        const id     = uuid();
        const job_no = `CAL-JOB-${Date.now().toString().slice(-5)}`;
        await run(`INSERT INTO calibration_jobs (id,job_no,client_id,site,instruments,scheduled_date,technician_id,project_id,status) VALUES (?,?,?,?,?,?,?,?,'scheduled')`,
          [id, job_no, client_id, site, instruments, scheduled_date, technician_id, project_id]);
        return ok({ id, job_no }, 201);
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Calibration POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
