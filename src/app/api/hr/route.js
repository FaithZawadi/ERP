// src/app/api/hr/route.js — HR, Payroll & Attendance API

import { NextResponse } from 'next/server';
import { v4 as uuid }   from 'uuid';
import { requireAuth, ok, err, logAudit, createApprovalRecord } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';
import { calculatePayslip, calculateOvertime } from '../../../lib/tax';

// Apply the caller's RSA-2048 signature to a document ref (disciplinary steps).
async function signAs(auth, documentRef, action) {
  const sig = await queryOne(
    `SELECT ds.key_id, ds.private_key FROM digital_signatures ds
     JOIN users u ON ds.user_id=u.id WHERE u.employee_id=? AND ds.is_active=1`, [auth.user.employee_id]
  );
  if (!sig) return null;
  const approval = createApprovalRecord(auth.user.employee_id, auth.user.name, sig.key_id, sig.private_key, documentRef, action);
  await run(`UPDATE digital_signatures SET uses=uses+1 WHERE key_id=?`, [sig.key_id]);
  return JSON.stringify({ key_id: approval.keyId, signature: approval.signature, timestamp: approval.timestamp });
}

const LD_TARGET = 40; // annual L&D hours (HR-025)
const DISC_STAGES = ['incident', 'investigation', 'show_cause', 'hearing', 'outcome']; // HR-020 order
const HR_HEAD_ROLES = ['hr_manager', 'md', 'admin'];

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'employees';
  const id      = searchParams.get('id');

  try {
    switch (section) {
      case 'employees': {
        const rows = await query(
          `SELECT e.*, u.role as system_role, ds.key_id as signature_key
           FROM employees e
           LEFT JOIN users u ON u.employee_id=e.id
           LEFT JOIN digital_signatures ds ON ds.user_id=u.id AND ds.is_active=1
           WHERE e.status='active' ORDER BY e.department, e.first_name`
        );
        return ok(rows);
      }

      case 'employee': {
        if (!id) return err('id required', 400);
        const emp = await queryOne(`SELECT * FROM employees WHERE id=?`, [id]);
        if (!emp) return err('Employee not found', 404);
        const [leave, kpi, ld] = await Promise.all([
          query(`SELECT * FROM leave_requests WHERE employee_id=? ORDER BY created_at DESC LIMIT 10`, [id]),
          query(`SELECT * FROM kpi_scorecards WHERE employee_id=? ORDER BY period DESC`, [id]),
          query(`SELECT * FROM l_and_d WHERE employee_id=? ORDER BY date DESC`, [id]),
        ]);
        return ok({ employee: emp, leave, kpi, l_and_d: ld });
      }

      case 'attendance': {
        const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
        const rows = await query(
          `SELECT a.*, e.first_name||' '||e.last_name as name, e.department
           FROM attendance a JOIN employees e ON a.employee_id=e.id
           WHERE a.date=? ORDER BY a.clock_in`, [date]
        );
        return ok(rows);
      }

      case 'leave_requests': {
        const status = searchParams.get('status');
        let sql = `SELECT lr.*, e.first_name||' '||e.last_name as employee_name, e.department
                   FROM leave_requests lr JOIN employees e ON lr.employee_id=e.id`;
        const params = [];
        if (status) { sql += ` WHERE lr.status=?`; params.push(status); }
        sql += ` ORDER BY lr.created_at DESC`;
        return ok(await query(sql, params));
      }

      case 'kpi_summary': {
        const period = searchParams.get('period') || new Date().getFullYear().toString();
        const rows = await query(
          `SELECT e.id, e.first_name||' '||e.last_name as name, e.department, e.l_and_d_hours,
                  AVG(k.score) as avg_score,
                  SUM(k.weight*k.score)/100 as weighted_score,
                  MAX(CASE WHEN k.increment_blocked=1 THEN 1 ELSE 0 END) as increment_blocked
           FROM employees e
           LEFT JOIN kpi_scorecards k ON k.employee_id=e.id AND k.period LIKE ?
           WHERE e.status='active' GROUP BY e.id`, [`${period}%`]
        );
        return ok(rows);
      }

      // ── HR-013: salary increment proposals ──────────────────────────────
      case 'increments': {
        const rows = await query(
          `SELECT si.*, e.first_name||' '||e.last_name as employee_name, e.l_and_d_hours,
                  p.first_name||' '||p.last_name as proposed_by_name
           FROM salary_increments si
           LEFT JOIN employees e ON si.employee_id=e.id
           LEFT JOIN employees p ON si.proposed_by=p.id
           ORDER BY si.created_at DESC`
        );
        return ok(rows);
      }

      // ── HR-020: disciplinary cases (+ steps on detail) ───────────────────
      case 'disciplinary': {
        const rows = await query(
          `SELECT d.*, e.first_name||' '||e.last_name as employee_name
           FROM disciplinary_cases d LEFT JOIN employees e ON d.employee_id=e.id
           ORDER BY d.created_at DESC`
        );
        return ok(rows);
      }
      case 'disciplinary_detail': {
        if (!id) return err('id required', 400);
        const c = await queryOne(`SELECT d.*, e.first_name||' '||e.last_name as employee_name FROM disciplinary_cases d LEFT JOIN employees e ON d.employee_id=e.id WHERE d.id=?`, [id]);
        if (!c) return err('Case not found', 404);
        const steps = await query(`SELECT s.*, e.first_name||' '||e.last_name as signed_by_name FROM disciplinary_steps s LEFT JOIN employees e ON s.signed_by=e.id WHERE s.case_id=? ORDER BY s.created_at`, [id]);
        return ok({ case: c, steps, stage_order: DISC_STAGES });
      }

      // ── ATT-003: monthly attendance report per department + absenteeism ──
      case 'attendance_report': {
        const p = searchParams.get('period') || new Date().toISOString().slice(0,7);
        // Approx working days in the month (Mon–Fri).
        const [yy, mm] = p.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
        let workingDays = 0;
        for (let d = 1; d <= daysInMonth; d++) { const wd = new Date(Date.UTC(yy, mm-1, d)).getUTCDay(); if (wd !== 0 && wd !== 6) workingDays++; }
        const rows = await query(
          `SELECT e.department,
                  COUNT(DISTINCT e.id) as headcount,
                  (SELECT COUNT(*) FROM attendance a JOIN employees e2 ON a.employee_id=e2.id WHERE e2.department=e.department AND a.date LIKE ?) as present_days,
                  (SELECT COUNT(*) FROM attendance a JOIN employees e2 ON a.employee_id=e2.id WHERE e2.department=e.department AND a.date LIKE ? AND a.is_late=1) as late_days
           FROM employees e WHERE e.status='active' GROUP BY e.department`,
          [`${p}%`, `${p}%`]
        );
        const data = rows.map(r => {
          const expected = (r.headcount||0) * workingDays;
          const absent = Math.max(0, expected - (r.present_days||0));
          return { ...r, working_days: workingDays, expected_days: expected, absent_days: absent, absenteeism_rate: expected ? Math.round(absent/expected*1000)/10 : 0 };
        });
        return ok({ period: p, working_days: workingDays, departments: data });
      }

      // ── ATT-004: field staff GPS trail (for the Department Head) ─────────
      case 'gps_trail': {
        const empId = searchParams.get('employee_id');
        if (!empId) return err('employee_id required', 400);
        const days = parseInt(searchParams.get('days') || '30', 10);
        const rows = await query(
          `SELECT date, clock_in, clock_out, location_lat, location_lng, location_name, is_late
           FROM attendance WHERE employee_id=? AND date >= date('now', ?) ORDER BY date DESC`,
          [empId, `-${days} days`]
        );
        return ok(rows);
      }

      // ── HR-025: L&D compliance vs the 40-hour target (Q3 alert) ──────────
      case 'ld_compliance': {
        const month = new Date().getMonth() + 1; // 1-12
        const isQ3 = month >= 7;
        const rows = await query(
          `SELECT id, first_name||' '||last_name as name, department, l_and_d_hours FROM employees WHERE status='active' ORDER BY l_and_d_hours`
        );
        const data = rows.map(r => ({ ...r, target: LD_TARGET, below_target: (r.l_and_d_hours||0) < LD_TARGET, q3_alert: isQ3 && (r.l_and_d_hours||0) < LD_TARGET }));
        return ok({ is_q3: isQ3, target: LD_TARGET, employees: data });
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[HR GET]', e);
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

      case 'create_employee': {
        const { first_name, last_name, email, department, role, basic_salary, date_joined } = body;
        if (!first_name || !last_name || !email || !department) return err('first_name, last_name, email, department required', 400);

        const id     = uuid();
        const emp_no = `QSL-${Date.now()}`.slice(-10);

        await run(
          `INSERT INTO employees (id,emp_no,first_name,last_name,email,department,role,basic_salary,date_joined,status)
           VALUES (?,?,?,?,?,?,?,?,?,'active')`,
          [id, emp_no, first_name, last_name, email, department, role, basic_salary || 0, date_joined || new Date().toISOString().split('T')[0]]
        );

        await logAudit(query, {
          userId: auth.user.id, userName: auth.user.name,
          action: 'CREATE_EMPLOYEE', module: 'HR',
          recordId: id, newValue: { emp_no, first_name, last_name, department },
        });

        return ok({ id, emp_no }, 201);
      }

      case 'clock_in': {
        const { employee_id, location_lat, location_lng, location_name } = body;
        if (!employee_id) return err('employee_id required', 400);

        const today = new Date().toISOString().split('T')[0];
        const exists = await queryOne(`SELECT id FROM attendance WHERE employee_id=? AND date=?`, [employee_id, today]);
        if (exists) return err('Already clocked in today', 409);

        const now = new Date();
        // ATT-002: late if clock-in is more than the grace window after the
        // scheduled start (both configurable in System Settings).
        const s = require('../../../lib/settings');
        const [wsH, wsM] = (await s.getSetting('hr.work_start', '08:00')).split(':').map(Number);
        const grace = await s.getInt('hr.late_grace_minutes', 15);
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const isLate = nowMin > (wsH * 60 + (wsM||0) + grace);

        await run(
          `INSERT INTO attendance (id,employee_id,date,clock_in,location_lat,location_lng,location_name,is_late)
           VALUES (?,?,?,?,?,?,?,?)`,
          [uuid(), employee_id, today, now.toISOString(), location_lat, location_lng, location_name, isLate ? 1 : 0]
        );

        let escalated = false;
        if (isLate) {
          const emp = await queryOne(`SELECT first_name||' '||last_name as name, department FROM employees WHERE id=?`, [employee_id]);
          // Alert the Line Manager (HR task).
          await run(`INSERT INTO tasks (id,title,due_date,priority,status,module,description) VALUES (?,?,date('now','+1 day'),'medium','pending','HR',?)`,
            [uuid(), `Late arrival — ${emp?.name}`, `ATT-002: ${emp?.name} (${emp?.department}) clocked in late on ${today}. Line Manager to note.`]);
          // 3 late instances in the month → escalate to HR.
          const month = today.slice(0, 7);
          const [c] = await query(`SELECT COUNT(*) as n FROM attendance WHERE employee_id=? AND is_late=1 AND date LIKE ?`, [employee_id, `${month}%`]);
          if ((c?.n || 0) >= 3) {
            escalated = true;
            await run(`INSERT INTO tasks (id,title,due_date,priority,status,module,description) VALUES (?,?,date('now','+2 days'),'high','pending','HR',?)`,
              [uuid(), `Lateness escalation — ${emp?.name}`, `ATT-002: ${emp?.name} has ${c.n} late arrivals in ${month} — escalated to HR.`]);
          }
        }

        return ok({ clocked_in: true, time: now.toISOString(), is_late: isLate, escalated_to_hr: escalated });
      }

      case 'clock_out': {
        const { employee_id } = body;
        if (!employee_id) return err('employee_id required', 400);

        const today = new Date().toISOString().split('T')[0];
        const att   = await queryOne(`SELECT * FROM attendance WHERE employee_id=? AND date=?`, [employee_id, today]);
        if (!att) return err('Not clocked in', 404);

        const clockIn  = new Date(att.clock_in);
        const clockOut = new Date();
        const hours    = (clockOut - clockIn) / 3600000;

        await run(
          `UPDATE attendance SET clock_out=?, hours_worked=? WHERE id=?`,
          [clockOut.toISOString(), Math.round(hours * 100) / 100, att.id]
        );

        return ok({ clocked_out: true, hours_worked: Math.round(hours * 100) / 100 });
      }

      case 'request_leave': {
        const { employee_id, leave_type, start_date, end_date, reason } = body;
        if (!employee_id || !leave_type || !start_date || !end_date) return err('employee_id, leave_type, start_date, end_date required', 400);

        const start = new Date(start_date);
        const end   = new Date(end_date);
        const days  = Math.max(1, Math.round((end - start) / 86400000) + 1);

        const emp = await queryOne(`SELECT leave_balance FROM employees WHERE id=?`, [employee_id]);
        if (!emp) return err('Employee not found', 404);
        if (leave_type === 'annual' && emp.leave_balance < days) return err(`Insufficient leave balance: ${emp.leave_balance} days available`, 400);

        const id = uuid();
        await run(
          `INSERT INTO leave_requests (id,employee_id,leave_type,start_date,end_date,days,reason,status) VALUES (?,?,?,?,?,?,?,'pending')`,
          [id, employee_id, leave_type, start_date, end_date, days, reason]
        );

        return ok({ id, days }, 201);
      }

      case 'approve_leave': {
        const { request_id, approved } = body;
        if (!request_id) return err('request_id required', 400);

        const req_row = await queryOne(`SELECT * FROM leave_requests WHERE id=?`, [request_id]);
        if (!req_row) return err('Request not found', 404);

        if (approved) {
          await run(
            `UPDATE leave_requests SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?`,
            [auth.user.employee_id, request_id]
          );
          // Deduct from balance
          await run(`UPDATE employees SET leave_balance=leave_balance-? WHERE id=?`, [req_row.days, req_row.employee_id]);
        } else {
          await run(`UPDATE leave_requests SET status='rejected' WHERE id=?`, [request_id]);
        }

        return ok({ updated: true, approved: !!approved });
      }

      case 'update_kpi': {
        const { employee_id, period, dimension, weight, score, target, notes } = body;
        if (!employee_id || !dimension) return err('employee_id and dimension required', 400);

        const existing = await queryOne(`SELECT id FROM kpi_scorecards WHERE employee_id=? AND period=? AND dimension=?`, [employee_id, period, dimension]);
        const ld_target = 40;
        const emp = await queryOne(`SELECT l_and_d_hours FROM employees WHERE id=?`, [employee_id]);
        const incrementBlocked = emp?.l_and_d_hours < ld_target ? 1 : 0;

        if (existing) {
          await run(`UPDATE kpi_scorecards SET score=?,notes=?,increment_blocked=? WHERE id=?`, [score, notes, incrementBlocked, existing.id]);
        } else {
          await run(
            `INSERT INTO kpi_scorecards (id,employee_id,period,dimension,weight,score,target,notes,increment_blocked) VALUES (?,?,?,?,?,?,?,?,?)`,
            [uuid(), employee_id, period, dimension, weight||20, score, target, notes, incrementBlocked]
          );
        }

        return ok({ updated: true, increment_blocked: !!incrementBlocked });
      }

      case 'log_l_and_d': {
        const { employee_id, course_name, provider, hours, date, certificate } = body;
        if (!employee_id || !course_name || !hours) return err('employee_id, course_name, hours required', 400);

        const id = uuid();
        // HR-027: training record with date, provider, hours and certificate.
        await run(
          `INSERT INTO l_and_d (id,employee_id,course_name,provider,hours,date,certificate,approved_by) VALUES (?,?,?,?,?,?,?,?)`,
          [id, employee_id, course_name, provider, hours, date || new Date().toISOString().split('T')[0], certificate || null, auth.user.employee_id]
        );
        await run(`UPDATE employees SET l_and_d_hours=l_and_d_hours+? WHERE id=?`, [hours, employee_id]);
        return ok({ id, hours_added: hours }, 201);
      }

      // ── HR-013/026: HR proposes a salary increment (blocked if L&D < target)
      case 'propose_increment': {
        const { employee_id, proposed_salary, effective_month, reason } = body;
        if (!employee_id || !proposed_salary) return err('employee_id and proposed_salary required', 400);
        const emp = await queryOne(`SELECT basic_salary, l_and_d_hours FROM employees WHERE id=?`, [employee_id]);
        if (!emp) return err('Employee not found', 404);
        const pct = emp.basic_salary ? Math.round((proposed_salary - emp.basic_salary) / emp.basic_salary * 1000) / 10 : 0;
        const blocked = (emp.l_and_d_hours || 0) < LD_TARGET;
        const id = uuid();
        await run(
          `INSERT INTO salary_increments (id,employee_id,current_salary,proposed_salary,increment_pct,effective_month,reason,status,blocked_reason,proposed_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, employee_id, emp.basic_salary, proposed_salary, pct, effective_month, reason,
           blocked ? 'blocked' : 'proposed',
           blocked ? `HR-026: L&D ${emp.l_and_d_hours||0}h < ${LD_TARGET}h target — training block` : null,
           auth.user.employee_id]
        );
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'PROPOSE_INCREMENT', module: 'HR', recordId: id, newValue: { proposed_salary, pct, blocked } });
        return ok({ id, status: blocked ? 'blocked' : 'proposed', increment_pct: pct, blocked }, 201);
      }

      // ── HR-026: HR Head clears a training block (only once L&D ≥ target) ─
      case 'clear_increment_block': {
        if (!HR_HEAD_ROLES.includes(auth.user.role)) return err('HR-026: only the HR Head (or MD) may clear a training block', 403);
        const { id } = body;
        const inc = await queryOne(`SELECT si.*, e.l_and_d_hours FROM salary_increments si JOIN employees e ON si.employee_id=e.id WHERE si.id=?`, [id]);
        if (!inc) return err('Increment not found', 404);
        if (inc.status !== 'blocked') return err('Increment is not blocked', 409);
        if ((inc.l_and_d_hours || 0) < LD_TARGET) return err(`HR-026: L&D shortfall not resolved — ${inc.l_and_d_hours||0}h of ${LD_TARGET}h. Log the missing training first.`, 400);
        await run(`UPDATE salary_increments SET status='proposed', block_cleared_by=? WHERE id=?`, [auth.user.employee_id, id]);
        return ok({ cleared: true, status: 'proposed' });
      }

      // ── HR-013: MD approves a proposed increment → effective ─────────────
      case 'approve_increment': {
        if (!['md','admin'].includes(auth.user.role)) return err('HR-013: salary increments require MD approval', 403);
        const { id, signature_key } = body;
        const inc = await queryOne(`SELECT * FROM salary_increments WHERE id=?`, [id]);
        if (!inc) return err('Increment not found', 404);
        if (inc.status !== 'proposed') return err(`Cannot approve — status is ${inc.status}`, 409);
        await run(`UPDATE salary_increments SET status='md_approved', approved_by=?, approved_sig=?, approved_at=datetime('now') WHERE id=?`,
          [auth.user.employee_id, signature_key||`QSL-DS-md-${Date.now()}`, id]);
        await run(`UPDATE employees SET basic_salary=? WHERE id=?`, [inc.proposed_salary, inc.employee_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'APPROVE_INCREMENT', module: 'HR', recordId: id, newValue: { proposed_salary: inc.proposed_salary, effective_month: inc.effective_month } });
        return ok({ approved: true, effective_month: inc.effective_month });
      }

      case 'reject_increment': {
        const { id } = body;
        await run(`UPDATE salary_increments SET status='rejected' WHERE id=?`, [id]);
        return ok({ rejected: true });
      }

      // ── HR-020: open a disciplinary case (incident report) ───────────────
      case 'create_disciplinary': {
        const { employee_id, incident_desc } = body;
        if (!employee_id || !incident_desc) return err('employee_id and incident_desc required', 400);
        const id = uuid(); const case_no = `DISC-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
        await run(`INSERT INTO disciplinary_cases (id,case_no,employee_id,incident_desc,stage,reported_by) VALUES (?,?,?,?,'incident',?)`,
          [id, case_no, employee_id, incident_desc, auth.user.employee_id]);
        const sig = await signAs(auth, case_no, 'DISCIPLINARY_INCIDENT');
        await run(`INSERT INTO disciplinary_steps (id,case_id,step,notes,signed_by,sig) VALUES (?,?, 'incident', ?, ?, ?)`,
          [uuid(), id, incident_desc, auth.user.employee_id, sig]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_DISCIPLINARY', module: 'HR', recordId: id, newValue: { case_no } });
        return ok({ id, case_no }, 201);
      }

      // ── HR-020: advance the case to the next stage (timestamped + signed) ─
      case 'advance_disciplinary': {
        const { id, step, notes } = body;
        const c = await queryOne(`SELECT * FROM disciplinary_cases WHERE id=?`, [id]);
        if (!c) return err('Case not found', 404);
        const currentIdx = DISC_STAGES.indexOf(c.stage);
        const targetIdx = DISC_STAGES.indexOf(step);
        if (targetIdx !== currentIdx + 1) return err(`HR-020: steps must follow the sequence ${DISC_STAGES.join(' → ')}. Next allowed: ${DISC_STAGES[currentIdx+1]||'closed'}`, 400);
        const sig = await signAs(auth, c.case_no, `DISCIPLINARY_${step.toUpperCase()}`);
        await run(`INSERT INTO disciplinary_steps (id,case_id,step,notes,signed_by,sig) VALUES (?,?,?,?,?,?)`,
          [uuid(), id, step, notes||'', auth.user.employee_id, sig]);
        const isOutcome = step === 'outcome';
        await run(`UPDATE disciplinary_cases SET stage=?, status=?, outcome=? WHERE id=?`,
          [step, isOutcome ? 'closed' : 'open', isOutcome ? (notes||'') : c.outcome, id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: `DISCIPLINARY_${step.toUpperCase()}`, module: 'HR', recordId: id });
        return ok({ advanced: true, stage: step, signed: !!sig, closed: isOutcome });
      }

      // ── HR-025: raise Q3 alerts (HR tasks) for staff below the L&D target ─
      case 'send_ld_alerts': {
        const below = await query(`SELECT id, first_name||' '||last_name as name, l_and_d_hours FROM employees WHERE status='active' AND l_and_d_hours < ?`, [LD_TARGET]);
        for (const e of below) {
          await run(`INSERT INTO tasks (id,title,assignee_id,due_date,priority,status,module,description) VALUES (?,?,?,date('now','+14 days'),'high','pending','HR',?)`,
            [uuid(), `L&D below target — ${e.name}`, e.id, `HR-025: ${e.name} has ${e.l_and_d_hours||0}h of the ${LD_TARGET}h annual training target. Action needed before year-end.`]);
        }
        return ok({ alerts_raised: below.length });
      }

      // ── HR-012: log overtime (1.5× weekday, 2× Sunday/holiday) ───────────
      case 'log_overtime': {
        const { employee_id, period, weekday_hours, holiday_hours } = body;
        if (!employee_id || !period) return err('employee_id and period required', 400);
        const emp = await queryOne(`SELECT basic_salary FROM employees WHERE id=?`, [employee_id]);
        if (!emp) return err('Employee not found', 404);
        const ot = calculateOvertime(emp.basic_salary || 0, parseFloat(weekday_hours)||0, parseFloat(holiday_hours)||0);
        const id = uuid();
        await run(`INSERT INTO overtime (id,employee_id,period,weekday_hours,holiday_hours,amount,status,created_by) VALUES (?,?,?,?,?,?,'approved',?)`,
          [id, employee_id, period, parseFloat(weekday_hours)||0, parseFloat(holiday_hours)||0, ot.total, auth.user.employee_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'LOG_OVERTIME', module: 'HR', recordId: id, newValue: { period, amount: ot.total } });
        return ok({ id, ...ot }, 201);
      }

      // ── HR-007: set an employee's monthly HELB deduction ─────────────────
      case 'set_helb': {
        const { employee_id, helb_monthly } = body;
        if (!employee_id) return err('employee_id required', 400);
        await run(`UPDATE employees SET helb_monthly=? WHERE id=?`, [parseFloat(helb_monthly)||0, employee_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SET_HELB', module: 'HR', recordId: employee_id, newValue: { helb_monthly } });
        return ok({ updated: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[HR POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
