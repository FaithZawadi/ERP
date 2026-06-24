// src/app/api/hr/route.js — HR, Payroll & Attendance API

import { NextResponse } from 'next/server';
import { v4 as uuid }   from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';
import { calculatePayslip, calculateOvertime } from '../../../lib/tax';

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

        const now = new Date().toISOString();
        const startHour = 8; // QSL start time 08:00
        const clockHour = new Date().getHours();
        const isLate    = clockHour >= startHour + 1; // 15min grace → 1hr for simplicity

        await run(
          `INSERT INTO attendance (id,employee_id,date,clock_in,location_lat,location_lng,location_name,is_late)
           VALUES (?,?,?,?,?,?,?,?)`,
          [uuid(), employee_id, today, now, location_lat, location_lng, location_name, isLate ? 1 : 0]
        );

        return ok({ clocked_in: true, time: now, is_late: isLate });
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
        const { employee_id, course_name, provider, hours, date } = body;
        if (!employee_id || !course_name || !hours) return err('employee_id, course_name, hours required', 400);

        const id = uuid();
        await run(
          `INSERT INTO l_and_d (id,employee_id,course_name,provider,hours,date,approved_by) VALUES (?,?,?,?,?,?,?)`,
          [id, employee_id, course_name, provider, hours, date || new Date().toISOString().split('T')[0], auth.user.employee_id]
        );

        // Update running total
        await run(`UPDATE employees SET l_and_d_hours=l_and_d_hours+? WHERE id=?`, [hours, employee_id]);

        return ok({ id, hours_added: hours }, 201);
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
