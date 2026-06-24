// src/app/api/me/route.js — Employee Self-Service portal API
//
// Every endpoint is scoped to the LOGGED-IN user (auth.user.employee_id), so a
// staff member can only ever see and act on their own records — leave, payslips,
// tasks, attendance, profile — regardless of their role. This is the data layer
// behind the "My Workspace" dashboard (RPT-018 staff personal dashboard).

import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit, hashPassword, comparePassword } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);
  const me = auth.user.employee_id;
  if (!me) return err('No employee record linked to this login', 400);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'overview';

  try {
    switch (section) {
      case 'overview': {
        const emp = await queryOne(`SELECT emp_no, first_name||' '||last_name as name, department, role, basic_salary, leave_balance, l_and_d_hours FROM employees WHERE id=?`, [me]);
        const [kpi] = await query(`SELECT AVG(score) as avg_score FROM kpi_scorecards WHERE employee_id=? AND period LIKE ?`, [me, `${new Date().getFullYear()}%`]);
        const [tasks] = await query(`SELECT COUNT(*) as open FROM tasks WHERE assignee_id=? AND status!='completed'`, [me]);
        const [leaveCnt] = await query(`SELECT COUNT(*) as pending FROM leave_requests WHERE employee_id=? AND status='pending'`, [me]);
        return ok({ employee: emp, kpi_avg: kpi?.avg_score || null, open_tasks: tasks?.open || 0, pending_leave: leaveCnt?.pending || 0, ld_target: 40 });
      }

      case 'leave': {
        const emp = await queryOne(`SELECT leave_balance FROM employees WHERE id=?`, [me]);
        const rows = await query(`SELECT * FROM leave_requests WHERE employee_id=? ORDER BY created_at DESC`, [me]);
        return ok({ leave_balance: emp?.leave_balance ?? 0, requests: rows });
      }

      case 'payslips': {
        // Only finalised (locked) runs are visible to staff (HR-009/010).
        const rows = await query(
          `SELECT pe.*, pr.period, pr.status as run_status, pr.pay_date
           FROM payroll_entries pe JOIN payroll_runs pr ON pe.run_id=pr.id
           WHERE pe.employee_id=? AND pr.status='locked' ORDER BY pr.period DESC`, [me]
        );
        return ok(rows);
      }

      case 'tasks': {
        const rows = await query(`SELECT * FROM tasks WHERE assignee_id=? ORDER BY due_date`, [me]);
        return ok(rows);
      }

      case 'attendance': {
        const rows = await query(`SELECT * FROM attendance WHERE employee_id=? ORDER BY date DESC LIMIT 30`, [me]);
        const today = new Date().toISOString().split('T')[0];
        const todayRec = rows.find(r => r.date === today) || null;
        return ok({ today: todayRec, recent: rows });
      }

      case 'payslip_pdf': {
        // Stream the payslip PDF for one of MY locked runs.
        const period = searchParams.get('period');
        if (!period) return err('period required', 400);
        const entry = await queryOne(
          `SELECT pe.*, pr.period, pr.status FROM payroll_entries pe JOIN payroll_runs pr ON pe.run_id=pr.id
           WHERE pe.employee_id=? AND pr.period=?`, [me, period]
        );
        if (!entry) return err('Payslip not found', 404);
        if (entry.status !== 'locked') return err('Payslip not yet finalised', 403);
        const emp = await queryOne(`SELECT emp_no, first_name||' '||last_name as name, department, kra_pin FROM employees WHERE id=?`, [me]);
        const { generatePayslip, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const out = await generatePayslip({ ...emp, ...entry }, entry, period);
        const pdf = fs.readFileSync(out.path);
        return new Response(pdf, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="payslip_${emp.emp_no}_${period}.pdf"` } });
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[Me GET]', e);
    return err('Server error', 500);
  }
}

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);
  const me = auth.user.employee_id;

  let body;
  try { body = await req.json(); } catch { return err('Invalid JSON', 400); }
  const { action } = body;

  try {
    switch (action) {
      // Apply for leave (self) — annual leave checks the balance (HR-005).
      case 'apply_leave': {
        const { leave_type, start_date, end_date, reason } = body;
        if (!leave_type || !start_date || !end_date) return err('leave_type, start_date, end_date required', 400);
        const days = Math.max(1, Math.round((new Date(end_date) - new Date(start_date)) / 86400000) + 1);
        const emp = await queryOne(`SELECT leave_balance FROM employees WHERE id=?`, [me]);
        if (leave_type === 'annual' && (emp?.leave_balance ?? 0) < days) return err(`Insufficient leave balance: ${emp.leave_balance} days available`, 400);
        const id = uuid();
        await run(`INSERT INTO leave_requests (id,employee_id,leave_type,start_date,end_date,days,reason,status) VALUES (?,?,?,?,?,?,?,'pending')`,
          [id, me, leave_type, start_date, end_date, days, reason]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SELF_APPLY_LEAVE', module: 'Self-Service', recordId: id, newValue: { leave_type, days } });
        return ok({ id, days, status: 'pending' }, 201);
      }

      case 'clock_in': {
        const today = new Date().toISOString().split('T')[0];
        if (await queryOne(`SELECT id FROM attendance WHERE employee_id=? AND date=?`, [me, today])) return err('Already clocked in today', 409);
        const s = require('../../../lib/settings');
        const [wsH, wsM] = (await s.getSetting('hr.work_start', '08:00')).split(':').map(Number);
        const grace = await s.getInt('hr.late_grace_minutes', 15);
        const now = new Date();
        const isLate = (now.getHours()*60 + now.getMinutes()) > (wsH*60 + (wsM||0) + grace);
        await run(`INSERT INTO attendance (id,employee_id,date,clock_in,location_lat,location_lng,location_name,is_late) VALUES (?,?,?,?,?,?,?,?)`,
          [uuid(), me, today, now.toISOString(), body.location_lat||null, body.location_lng||null, body.location_name||null, isLate?1:0]);
        return ok({ clocked_in: true, is_late: isLate });
      }

      case 'clock_out': {
        const today = new Date().toISOString().split('T')[0];
        const att = await queryOne(`SELECT * FROM attendance WHERE employee_id=? AND date=?`, [me, today]);
        if (!att) return err('Not clocked in today', 404);
        const hours = Math.round((new Date() - new Date(att.clock_in)) / 3600000 * 100) / 100;
        await run(`UPDATE attendance SET clock_out=?, hours_worked=? WHERE id=?`, [new Date().toISOString(), hours, att.id]);
        return ok({ clocked_out: true, hours_worked: hours });
      }

      // Mark one of MY tasks complete.
      case 'complete_task': {
        const { task_id } = body;
        const t = await queryOne(`SELECT assignee_id FROM tasks WHERE id=?`, [task_id]);
        if (!t || t.assignee_id !== me) return err('Not your task', 403);
        await run(`UPDATE tasks SET status='completed', completed_at=datetime('now') WHERE id=?`, [task_id]);
        return ok({ completed: true });
      }

      // Change my own password.
      case 'change_password': {
        const { current_password, new_password } = body;
        if (!new_password || new_password.length < 8) return err('New password must be at least 8 characters', 400);
        const user = await queryOne(`SELECT id, password FROM users WHERE id=?`, [auth.user.id]);
        if (!user) return err('User not found', 404);
        if (!(await comparePassword(current_password || '', user.password))) return err('Current password is incorrect', 403);
        await run(`UPDATE users SET password=? WHERE id=?`, [await hashPassword(new_password), user.id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SELF_CHANGE_PASSWORD', module: 'Self-Service', recordId: user.id });
        return ok({ changed: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Me POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}