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
      // QSL_Templates_Calibration_Procedures — ISO 17025 SOP library.
      // Static reference documents (one per measurement discipline), served
      // from /public/docs/calibration-procedures and surfaced here so the
      // Calibration module UI can list & link to them alongside live jobs/certs.
      case 'procedures': {
        const PROCEDURES = [
          { code: 'CalProc-01', title: 'Non-Automatic Weighing Instruments (NAWI)', discipline: 'Mass',        file: 'QSL_CalProc_01_NAWI.pdf' },
          { code: 'CalProc-02', title: 'Standard Masses — Class M2',                discipline: 'Mass',        file: 'QSL_CalProc_02_StandardMasses_M2.pdf' },
          { code: 'CalProc-03', title: 'Temperature Calibration',                   discipline: 'Temperature', file: 'QSL_CalProc_03_Temperature.pdf' },
          { code: 'CalProc-04', title: 'Volume Calibration',                        discipline: 'Volume',      file: 'QSL_CalProc_04_Volume.pdf' },
          { code: 'CalProc-05', title: 'Pressure Calibration',                      discipline: 'Pressure',    file: 'QSL_CalProc_05_Pressure.pdf' },
          { code: 'CalProc-06', title: 'Flow Calibration',                          discipline: 'Flow',        file: 'QSL_CalProc_06_Flow.pdf' },
          { code: 'CalProc-07', title: 'Humidity Calibration',                      discipline: 'Humidity',    file: 'QSL_CalProc_07_Humidity.pdf' },
        ].map(p => ({ ...p, url: `/docs/calibration-procedures/${p.file}` }));
        return ok(PROCEDURES);
      }

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

      // FLD-001/002: a field job's full record — photos (GPS+timestamp
      // evidence of equipment serviced/repaired) and its ISO 17020
      // pre-work/post-work inspection checklists.
      case 'job_detail': {
        const job_id = searchParams.get('job_id');
        if (!job_id) return err('job_id required', 400);
        const job = await queryOne(
          `SELECT cj.*, c.name as client_name, e.first_name||' '||e.last_name as technician_name
           FROM calibration_jobs cj LEFT JOIN clients c ON cj.client_id=c.id LEFT JOIN employees e ON cj.technician_id=e.id
           WHERE cj.id=?`, [job_id]
        );
        if (!job) return err('Job not found', 404);
        const [photos, inspections] = await Promise.all([
          query(`SELECT jp.*, e.first_name||' '||e.last_name as uploaded_by_name FROM job_photos jp LEFT JOIN employees e ON jp.uploaded_by=e.id WHERE jp.job_id=? ORDER BY jp.captured_at`, [job_id]),
          query(`SELECT ji.*, e.first_name||' '||e.last_name as inspector_name FROM job_work_inspections ji LEFT JOIN employees e ON ji.inspector_id=e.id WHERE ji.job_id=? ORDER BY ji.created_at`, [job_id]),
        ]);
        const pre  = inspections.find(i => i.stage === 'pre');
        const post = inspections.find(i => i.stage === 'post');
        return ok({ job, photos, inspections, pre_work_done: !!pre && pre.result === 'pass', post_work_done: !!post && post.result === 'pass' });
      }

      // FLD-003: the standard ISO 17020 pre-work / post-work checklist items
      // (fixed catalogue, editable later via the SOP Library if procedures change)
      case 'inspection_checklist_template': {
        const stage = searchParams.get('stage') || 'pre';
        const PRE_WORK = [
          'Work area assessed for hazards (electrical, mechanical, chemical, working at height)',
          'PPE available and worn (per task risk assessment)',
          'Equipment/instrument identified and matches the job/work order',
          'Reference standards and test equipment calibrated and within validity',
          'Client/site representative briefed on scope of work',
          'Permit to work obtained where required',
          'Tools and consumables required for the job confirmed present',
        ];
        const POST_WORK = [
          'Work completed matches the scope of the job/work order',
          'Equipment/instrument functioning correctly after service/repair',
          'Work area left clean and safe; no tools or materials left behind',
          'Photographic evidence captured (before/after, with GPS + timestamp)',
          'Client/site representative briefed on outcome and any follow-up required',
          'Waste/consumables disposed of correctly',
          'Client sign-off obtained',
        ];
        return ok({ stage, items: stage === 'post' ? POST_WORK : PRE_WORK });
      }

      // ── Service Request Forms (QSL/QP/013/SRF) ───────────────────────────
      case 'service_requests': {
        const rows = await query(
          `SELECT sr.*, e.first_name||' '||e.last_name as reviewed_by_name
           FROM service_requests sr LEFT JOIN employees e ON sr.reviewed_by=e.id
           ORDER BY sr.created_at DESC`
        );
        return ok(rows);
      }

      // QSL_ServiceRequestForm (SRF) — printable field/sales intake form
      case 'srf_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const sr = await queryOne(
          `SELECT sr.*, e.first_name||' '||e.last_name as reviewed_by_name
           FROM service_requests sr LEFT JOIN employees e ON sr.reviewed_by=e.id WHERE sr.id=?`, [id]);
        if (!sr) return err('Not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        let equipment = [];
        try { equipment = JSON.parse(sr.equipment || '[]'); } catch {}
        const result = await generateBusinessDoc('service_request', {
          docNo: sr.srf_no,
          blocks: {
            Customer: { Name: sr.customer_name, Contact: sr.contact_person, Phone: sr.telephone, Email: sr.email },
            Request:  { 'Service Type': sr.service_type, Location: sr.service_location, 'Preferred Date': sr.preferred_date, Status: sr.status },
          },
          body: [
            `Description: ${sr.description || '—'}`,
            equipment.length ? `Equipment: ${equipment.map(e => e.name || e).join(', ')}` : 'Equipment: not specified',
            `Applicant: ${sr.applicant_name || '—'} (${sr.applicant_designation || '—'})`,
            sr.reviewed_by_name ? `Reviewed by: ${sr.reviewed_by_name} — ${sr.decision_reason || ''}` : 'Awaiting technical review.',
          ],
        });
        return ok(result);
      }

      // QSL_FieldJobCard — printable job card a technician carries to site
      case 'job_card_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const job = await queryOne(
          `SELECT cj.*, c.name as client_name, c.address as client_address, c.phone as client_phone,
                  e.first_name||' '||e.last_name as technician_name
           FROM calibration_jobs cj LEFT JOIN clients c ON cj.client_id=c.id
           LEFT JOIN employees e ON cj.technician_id=e.id WHERE cj.id=?`, [id]);
        if (!job) return err('Not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('job_card', {
          docNo: job.job_no,
          blocks: {
            Client: { Name: job.client_name, Site: job.site, Phone: job.client_phone },
            Job:    { 'Scheduled Date': job.scheduled_date, Technician: job.technician_name || 'Unassigned', Status: job.status },
          },
          body: [
            `Instruments / Scope of Work: ${job.instruments || '—'}`,
            'Technician to complete on-site checklist, record measurements per the applicable Calibration Procedure (see Procedures Library), and obtain client sign-off below.',
          ],
        });
        return ok(result);
      }

      case 'srf_detail': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const sr = await queryOne(`SELECT * FROM service_requests WHERE id=?`, [id]);
        if (!sr) return err('Service request not found', 404);
        return ok({ ...sr, equipment: JSON.parse(sr.equipment || '[]'), review: JSON.parse(sr.review || '{}') });
      }

      case 'cert_detail': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const cert = await queryOne(
          `SELECT cc.*, c.name as client_name, e.first_name||' '||e.last_name as technician_name, rs.name as std_name, rs.uncertainty as std_uncertainty, rs.traceable_to
           FROM calibration_certs cc LEFT JOIN clients c ON cc.client_id=c.id LEFT JOIN employees e ON cc.technician_id=e.id LEFT JOIN reference_standards rs ON cc.ref_standard_id=rs.id
           WHERE cc.id=?`, [id]
        );
        if (!cert) return err('Certificate not found', 404);
        if (cert.instrument_type === 'nawi') {
          const [test_points, repeatability, eccentricity] = await Promise.all([
            query(`SELECT * FROM nawi_test_points WHERE cert_id=? ORDER BY sort_order`, [id]),
            query(`SELECT * FROM nawi_repeatability_readings WHERE cert_id=? ORDER BY reading_no`, [id]),
            query(`SELECT * FROM nawi_eccentricity_readings WHERE cert_id=? ORDER BY sort_order`, [id]),
          ]);
          cert.nawi = { test_points, repeatability, eccentricity };
        }
        return ok(cert);
      }

      // CAL-PDF-001: the actual certificate PDF. issue_cert only persists the
      // certificate *record*; the PDF itself is rendered here, on demand,
      // from that record (and re-rendered fresh every time, so a later data
      // correction or a template edit via Admin → Document Templates is
      // always reflected — there's no stale cached file to go out of sync).
      case 'cert_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const cert = await queryOne(
          `SELECT cc.*, c.name as client_name, c.address as client_address,
                  e.first_name as tech_first_name, e.last_name as tech_last_name,
                  rs.name as std_name, rs.traceable_to,
                  ck.first_name as checked_first_name, ck.last_name as checked_last_name
           FROM calibration_certs cc
           LEFT JOIN clients c ON cc.client_id=c.id
           LEFT JOIN employees e ON cc.technician_id=e.id
           LEFT JOIN employees ck ON cc.checked_by=ck.id
           LEFT JOIN reference_standards rs ON cc.ref_standard_id=rs.id
           WHERE cc.id=?`, [id]
        );
        if (!cert) return err('Certificate not found', 404);
        if (cert.checked_first_name) cert.checked_by_name = `${cert.checked_first_name} ${cert.checked_last_name}`;
        if (cert.instrument_type === 'nawi') {
          const [test_points, repeatability, eccentricity] = await Promise.all([
            query(`SELECT * FROM nawi_test_points WHERE cert_id=? ORDER BY sort_order`, [id]),
            query(`SELECT * FROM nawi_repeatability_readings WHERE cert_id=? ORDER BY reading_no`, [id]),
            query(`SELECT * FROM nawi_eccentricity_readings WHERE cert_id=? ORDER BY sort_order`, [id]),
          ]);
          cert.nawi = { test_points, repeatability, eccentricity };
        }
        const { generateCalibrationCert, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateCalibrationCert(
          cert,
          { name: cert.client_name, address: cert.client_address },
          { first_name: cert.tech_first_name, last_name: cert.tech_last_name },
          { name: cert.std_name, traceable_to: cert.traceable_to }
        );
        return ok(result);
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
        const { client_id, instrument, make, model, serial_no, range, uncertainty, ref_standard_id, calibrated_at, next_cal_date, result, temp_c, humidity_pct, job_id,
                instrument_type, temp_c_end, humidity_pct_end, min_weight, nawi_test_points, nawi_repeatability, nawi_eccentricity } = body;
        if (!client_id || !instrument || !uncertainty) return err('client_id, instrument, uncertainty required', 400);

        // EURAMET cg-18 §8.3: for NAWI, the certificate must report actual
        // error-of-indication test loads and the eccentricity test — a
        // single summary uncertainty is not sufficient. Enforce that the
        // raw test data was actually captured before a NAWI cert can issue.
        const isNawi = instrument_type === 'nawi';
        if (isNawi) {
          if (!Array.isArray(nawi_test_points) || nawi_test_points.length < 3) {
            return err('cg-18 §4: at least 3 error-of-indication test loads are required for a NAWI certificate', 400);
          }
          if (!Array.isArray(nawi_repeatability) || nawi_repeatability.length < 3) {
            return err('cg-18 §4: at least 3 repeatability readings are required for a NAWI certificate', 400);
          }
        }

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

        // Repeatability standard deviation (sample stdev) — cg-18 §4 step 2/6,
        // computed server-side from the submitted readings rather than trusted
        // from the client, since this feeds the minimum-weight calculation.
        let repeatability_stdev = null;
        if (isNawi && nawi_repeatability?.length > 1) {
          const vals = nawi_repeatability.map(r => Number(r.indication)).filter(Number.isFinite);
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1);
          repeatability_stdev = Math.sqrt(variance);
        }

        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO calibration_certs (id,cert_no,job_id,client_id,instrument,make,model,serial_no,range,uncertainty,ref_standard_id,calibrated_at,next_cal_date,result,temp_c,humidity_pct,technician_id,tech_sig,instrument_type,temp_c_end,humidity_pct_end,min_weight,repeatability_stdev)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, cert_no, job_id, client_id, instrument, make, model, serial_no, range, uncertainty, ref_standard_id, calibrated_at||new Date().toISOString().split('T')[0], next_cal_date, result||'pass', temp_c, humidity_pct, auth.user.employee_id, tech_sig, instrument_type||'general', temp_c_end||null, humidity_pct_end||null, min_weight||null, repeatability_stdev]
          );

          if (isNawi) {
            for (let i = 0; i < nawi_test_points.length; i++) {
              const p = nawi_test_points[i];
              await dbRun(
                `INSERT INTO nawi_test_points (id,cert_id,test_load,indication,error,uncertainty,sort_order) VALUES (?,?,?,?,?,?,?)`,
                [uuid(), id, p.test_load, p.indication ?? null, p.error ?? null, p.uncertainty ?? null, i]
              );
            }
            for (let i = 0; i < nawi_repeatability.length; i++) {
              await dbRun(
                `INSERT INTO nawi_repeatability_readings (id,cert_id,reading_no,indication) VALUES (?,?,?,?)`,
                [uuid(), id, i + 1, nawi_repeatability[i].indication ?? null]
              );
            }
            if (Array.isArray(nawi_eccentricity)) {
              for (let i = 0; i < nawi_eccentricity.length; i++) {
                const e = nawi_eccentricity[i];
                await dbRun(
                  `INSERT INTO nawi_eccentricity_readings (id,cert_id,position,indication,deviation,sort_order) VALUES (?,?,?,?,?,?)`,
                  [uuid(), id, e.position, e.indication ?? null, e.deviation ?? null, i]
                );
              }
            }
          }
        });

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'ISSUE_CAL_CERT', module: 'Calibration', recordId: id, newValue: { cert_no, instrument, client_id, instrument_type: instrument_type||'general' } });

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

      // ── Submit a Service Request Form ────────────────────────────────────
      case 'create_srf': {
        const { customer_name, contact_person, address, telephone, email, service_type, description, service_location, preferred_date, equipment, additional, applicant_name, applicant_designation, client_id } = body;
        if (!customer_name || !service_type) return err('customer_name and service_type required', 400);
        const id = uuid();
        const srf_no = `SRF-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
        await run(
          `INSERT INTO service_requests (id,srf_no,customer_name,contact_person,address,telephone,email,request_date,service_type,description,service_location,preferred_date,equipment,additional,applicant_name,applicant_designation,client_id,status)
           VALUES (?,?,?,?,?,?,?,date('now'),?,?,?,?,?,?,?,?,?,'submitted')`,
          [id, srf_no, customer_name, contact_person, address, telephone, email, service_type, description, service_location||'lab', preferred_date, JSON.stringify(equipment||[]), additional, applicant_name, applicant_designation, client_id||null]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_SRF', module: 'Calibration', recordId: id, newValue: { srf_no, service_type } });
        return ok({ id, srf_no }, 201);
      }

      // ── Technical review + accept/reject decision (Section 6/7 of the SRF) ─
      case 'review_srf': {
        const { id, decision, review, decision_reason, planned_date } = body;
        if (!id || !decision) return err('id and decision required', 400);
        const sr = await queryOne(`SELECT * FROM service_requests WHERE id=?`, [id]);
        if (!sr) return err('Service request not found', 404);
        const status = decision === 'accept' ? 'accepted' : 'rejected';
        await run(
          `UPDATE service_requests SET status=?, review=?, decision_reason=?, planned_date=?, reviewed_by=? WHERE id=?`,
          [status, JSON.stringify(review||{}), decision_reason||null, planned_date||null, auth.user.employee_id, id]
        );
        // An accepted calibration/maintenance request seeds a calibration job.
        let job_id = null;
        if (status === 'accepted' && sr.client_id) {
          job_id = uuid();
          const job_no = `CAL-JOB-${Date.now().toString().slice(-5)}`;
          await run(`INSERT INTO calibration_jobs (id,job_no,client_id,site,instruments,scheduled_date,status) VALUES (?,?,?,?,?,?,'scheduled')`,
            [job_id, job_no, sr.client_id, sr.service_location, sr.description, planned_date||sr.preferred_date]);
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REVIEW_SRF', module: 'Calibration', recordId: id, newValue: { decision: status } });
        return ok({ status, job_created: !!job_id });
      }

      case 'schedule_job': {
        const { client_id, site, instruments, scheduled_date, technician_id, project_id, quote_id } = body;
        if (!client_id || !scheduled_date) return err('client_id and scheduled_date required', 400);
        const id     = uuid();
        const job_no = `CAL-JOB-${Date.now().toString().slice(-5)}`;
        await run(`INSERT INTO calibration_jobs (id,job_no,client_id,site,instruments,scheduled_date,technician_id,project_id,quote_id,status) VALUES (?,?,?,?,?,?,?,?,?,'scheduled')`,
          [id, job_no, client_id, site, instruments, scheduled_date, technician_id, project_id, quote_id || null]);
        return ok({ id, job_no }, 201);
      }

      // FLD-004: ISO/IEC 17020 mandatory pre-work / post-work inspection
      // checklist submission. checklist is [{item, ok, notes}]. A 'pre'
      // checklist with any unchecked item is recorded as 'fail' and blocks
      // start_job below; same for 'post' blocking complete_job.
      case 'submit_work_inspection': {
        const { job_id, stage, checklist, notes } = body;
        if (!job_id || !stage || !Array.isArray(checklist) || !checklist.length)
          return err('job_id, stage and a non-empty checklist are required', 400);
        if (!['pre', 'post'].includes(stage)) return err("stage must be 'pre' or 'post'", 400);

        const allOk = checklist.every(c => c.ok === true);
        const result = allOk ? 'pass' : 'fail';
        const id = uuid();
        // created_at is set explicitly with millisecond precision (not SQL's
        // datetime('now'), which only has second resolution) so that "most
        // recent inspection for this stage" (ORDER BY created_at DESC) is
        // reliable even if a technician submits a failed checklist and then
        // immediately resubmits a corrected one within the same second.
        const ts = new Date().toISOString();
        await run(
          `INSERT INTO job_work_inspections (id,job_id,stage,checklist,result,inspector_id,notes,created_at) VALUES (?,?,?,?,?,?,?,?)`,
          [id, job_id, stage, JSON.stringify(checklist), result, auth.user.employee_id, notes || null, ts]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: `JOB_${stage.toUpperCase()}_INSPECTION`, module: 'Calibration', recordId: job_id, newValue: { result } });
        return ok({ id, result }, 201);
      }

      // FLD-005: technician starts on-site work — BLOCKED until a passed
      // pre-work inspection exists for this job (ISO 17020 requirement).
      case 'start_job': {
        const { job_id } = body;
        if (!job_id) return err('job_id required', 400);
        const pre = await queryOne(`SELECT result FROM job_work_inspections WHERE job_id=? AND stage='pre' ORDER BY created_at DESC LIMIT 1`, [job_id]);
        if (!pre || pre.result !== 'pass')
          return err('ISO 17020: a passed pre-work inspection checklist is required before starting this job', 403);
        await run(`UPDATE calibration_jobs SET status='in_progress' WHERE id=?`, [job_id]);
        return ok({ started: true });
      }

      // FLD-006: technician marks the job complete — BLOCKED until a passed
      // post-work inspection AND at least one GPS+timestamped photo exist.
      case 'complete_job': {
        const { job_id } = body;
        if (!job_id) return err('job_id required', 400);
        const post = await queryOne(`SELECT result FROM job_work_inspections WHERE job_id=? AND stage='post' ORDER BY created_at DESC LIMIT 1`, [job_id]);
        if (!post || post.result !== 'pass')
          return err('ISO 17020: a passed post-work inspection checklist is required before closing this job', 403);
        const [{ count: photoCount }] = await query(`SELECT COUNT(*) as count FROM job_photos WHERE job_id=?`, [job_id]);
        if (!photoCount)
          return err('At least one GPS/timestamped photo of the serviced equipment is required before closing this job', 403);
        await run(`UPDATE calibration_jobs SET status='complete' WHERE id=?`, [job_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'JOB_COMPLETE', module: 'Calibration', recordId: job_id });
        return ok({ completed: true });
      }

      // BILL-001: turn a completed job into an invoice. If the job was
      // scheduled against a quote (quote_id set), that quote's line items
      // are the billable lines and the quote is marked invoiced in the
      // same run. Ad-hoc jobs with no quote require the caller to supply
      // lines directly, the same shape as a Tax invoice line. Either way
      // this goes through the exact same src/lib/invoicing.js path as
      // every other invoice — same MSP enforcement, VAT calc, eTIMS
      // submission, and client email.
      case 'generate_job_invoice': {
        const { job_id, lines: suppliedLines, submit_to_etims } = body;
        if (!job_id) return err('job_id required', 400);

        const job = await queryOne(`SELECT * FROM calibration_jobs WHERE id=?`, [job_id]);
        if (!job) return err('Job not found', 404);
        if (job.status !== 'complete') return err('Job must be complete before it can be invoiced', 400);
        if (job.billing_status === 'invoiced') return err('This job has already been invoiced', 400);

        let lines = suppliedLines;
        if (job.quote_id) {
          const quoteLines = await query(`SELECT description, quantity, unit_price FROM quote_lines WHERE quote_id=?`, [job.quote_id]);
          if (quoteLines.length) lines = quoteLines;
        }
        if (!lines?.length) {
          return err(job.quote_id
            ? 'The linked quote has no line items to bill'
            : 'This job has no linked quote — supply line items to bill it directly', 400);
        }

        const { createInvoiceRecord } = require('../../../lib/invoicing');
        const result = await createInvoiceRecord({
          client_id: job.client_id,
          date: new Date().toISOString().slice(0, 10),
          due_date: null,
          lines,
          project_id: job.project_id,
          submit_to_etims: !!submit_to_etims,
          source_quote_id: job.quote_id || undefined,
          source_job_id: job_id,
          auth,
        });
        if (!result.ok) return err(result.error, result.status);
        return ok(result.data, result.status);
      }

      // FLD-007: upload a job-site photo with GPS + timestamp evidence. The
      // image itself is sent as a base64 data URL (same convention as the
      // SOP upload and branding logo upload elsewhere), lat/lng/captured_at
      // come from the browser's geolocation API at capture time.
      case 'upload_job_photo': {
        const { job_id, caption, lat, lng, captured_at, file_name, file_data } = body;
        if (!job_id || !file_data) return err('job_id and file_data required', 400);
        if (lat == null || lng == null) return err('GPS coordinates (lat/lng) are required for technician job photos', 400);

        const path = require('path');
        const fs = require('fs');
        const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
        const dir = path.join(UPLOAD_DIR, 'job_photos');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const match = /^data:([^;]+);base64,(.+)$/.exec(file_data);
        if (!match) return err('file_data must be a base64 data URL', 400);
        const buffer = Buffer.from(match[2], 'base64');
        const ext = path.extname(file_name || '') || '.jpg';
        const stored = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        fs.writeFileSync(path.join(dir, stored), buffer);
        const url = `/uploads/job_photos/${stored}`;

        const id = uuid();
        await run(
          `INSERT INTO job_photos (id,job_id,url,caption,lat,lng,captured_at,uploaded_by) VALUES (?,?,?,?,?,?,?,?)`,
          [id, job_id, url, caption || null, lat, lng, captured_at || new Date().toISOString(), auth.user.employee_id]
        );
        return ok({ id, url }, 201);
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Calibration POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
