// src/app/api/tasks/route.js — Tasks Module API

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const filter = searchParams.get('filter');
  const assignee = searchParams.get('assignee');

  try {
    let sql = `SELECT t.*, e.first_name||' '||e.last_name as assignee_name, e.department FROM tasks t LEFT JOIN employees e ON t.assignee_id=e.id WHERE 1=1`;
    const params = [];
    if (filter === 'overdue') { sql += ` AND t.due_date < date('now') AND t.status != 'completed'`; }
    else if (filter === 'critical') { sql += ` AND t.priority = 'critical'`; }
    else if (filter && filter !== 'all') { sql += ` AND t.status = ?`; params.push(filter); }
    if (assignee) { sql += ` AND t.assignee_id = ?`; params.push(assignee); }
    sql += ` ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.due_date`;
    return ok(await query(sql, params));
  } catch (e) {
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
    if (action === 'create') {
      const { title, assignee_id, due_date, priority, module, description } = body;
      if (!title || !assignee_id || !due_date) return err('title, assignee_id, due_date required', 400);
      const id = uuid();
      await run(`INSERT INTO tasks (id,title,description,assignee_id,due_date,priority,module,status,created_by) VALUES (?,?,?,?,?,?,?,'pending',?)`,
        [id, title, description, assignee_id, due_date, priority||'medium', module||'General', auth.user.employee_id]);
      return ok({ id }, 201);
    }

    if (action === 'complete') {
      const { task_id } = body;
      await run(`UPDATE tasks SET status='completed', completed_at=datetime('now') WHERE id=?`, [task_id]);
      return ok({ completed: true });
    }

    if (action === 'update') {
      const { task_id, status, notes } = body;
      await run(`UPDATE tasks SET status=? WHERE id=?`, [status, task_id]);
      return ok({ updated: true });
    }

    return err('Unknown action', 400);
  } catch (e) {
    return err('Server error', 500);
  }
}
