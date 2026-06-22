// src/app/api/admin/route.js — Administration Panel (point 3)
//
// GET  ?section=modules          -> list module flags
// GET  ?section=integrations     -> list module integration toggles
// GET  ?section=roles            -> list roles with permission counts
// GET  ?section=permissions      -> list all permissions
// GET  ?section=role_detail&id=  -> one role with its assigned permissions
// GET  ?section=users            -> all users with their roles
// GET  ?section=departments      -> departments + branches
// GET  ?section=settings         -> system settings
//
// POST { action: 'toggle_module', module_id, enabled }
// POST { action: 'toggle_integration', id, enabled }
// POST { action: 'create_role', code, name, description }
// POST { action: 'set_role_permissions', role_id, permission_codes: [] }
// POST { action: 'assign_user_role', user_id, role_id }
// POST { action: 'remove_user_role', user_id, role_id }
// POST { action: 'create_department', code, name, branch_id }
// POST { action: 'create_branch', code, name, city }
// POST { action: 'update_setting', key, value }
// POST { action: 'create_user', email, password, employee_id, role }
// POST { action: 'deactivate_user', user_id }

import { v4 as uuid } from 'uuid';
import { requireAuth, requireRole, ok, err, logAudit, hashPassword } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'modules';

  try {
    if (section === 'modules') {
      const rows = await query(`SELECT * FROM module_flags ORDER BY is_core DESC, display_name`);
      return ok(rows);
    }

    if (section === 'integrations') {
      const rows = await query(`SELECT * FROM module_integrations ORDER BY source_module, target_module`);
      return ok(rows.map(r => ({ ...r, config: r.config ? JSON.parse(r.config) : null })));
    }

    if (section === 'roles') {
      const rows = await query(
        `SELECT r.*,
                (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id=r.id) as permission_count,
                (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id=r.id) as user_count
         FROM roles r ORDER BY r.is_system DESC, r.name`
      );
      return ok(rows);
    }

    if (section === 'permissions') {
      const rows = await query(`SELECT * FROM permissions ORDER BY module, code`);
      return ok(rows);
    }

    if (section === 'role_detail') {
      const id = searchParams.get('id');
      if (!id) return err('id required', 400);
      const role = await queryOne(`SELECT * FROM roles WHERE id=?`, [id]);
      if (!role) return err('Role not found', 404);
      const perms = await query(
        `SELECT p.* FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?`,
        [id]
      );
      return ok({ role, permissions: perms });
    }

    if (section === 'users') {
      const rows = await query(
        `SELECT u.id, u.email, u.role as legacy_role, u.is_active, u.last_login,
                e.first_name||' '||e.last_name as name, e.department, e.id as employee_id,
                GROUP_CONCAT(r.name) as roles
         FROM users u
         LEFT JOIN employees e ON u.employee_id=e.id
         LEFT JOIN user_roles ur ON ur.user_id=u.id
         LEFT JOIN roles r ON r.id=ur.role_id
         GROUP BY u.id ORDER BY e.first_name`
      );
      return ok(rows);
    }

    if (section === 'departments') {
      const departments = await query(
        `SELECT d.*, b.name as branch_name, e.first_name||' '||e.last_name as head_name
         FROM departments d LEFT JOIN branches b ON d.branch_id=b.id LEFT JOIN employees e ON d.head_id=e.id
         ORDER BY b.name, d.name`
      );
      const branches = await query(
        `SELECT b.*, e.first_name||' '||e.last_name as manager_name FROM branches b LEFT JOIN employees e ON b.manager_id=e.id ORDER BY b.name`
      );
      return ok({ departments, branches });
    }

    if (section === 'settings') {
      const rows = await query(`SELECT * FROM system_settings ORDER BY category, key`);
      return ok(rows);
    }

    // Audit log: md/admin see everything; every other role sees only
    // their own activity. This is a real permission boundary (not just a
    // UI choice) — the query itself is scoped by user_id below, so a
    // non-admin role can't widen it by tampering with query params.
    if (section === 'audit_log') {
      const isPrivileged = auth.user.role === 'md' || auth.user.role === 'admin';
      const module = searchParams.get('module');
      const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

      let sql = `SELECT id, user_name, action, module, record_id, record_type, created_at FROM audit_log WHERE 1=1`;
      const params = [];
      if (!isPrivileged) { sql += ` AND user_id=?`; params.push(auth.user.id); }
      if (module) { sql += ` AND module=?`; params.push(module); }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      const rows = await query(sql, params);
      return ok({ rows, scope: isPrivileged ? 'all_users' : 'own_activity_only' });
    }

    return err('Unknown section', 400);
  } catch (e) {
    console.error('[Admin GET]', e);
    return err('Server error', 500);
  }
}

export async function POST(req) {
  const roleCheck = await requireRole('md', 'admin')(req);
  if (roleCheck.error) return err(roleCheck.error, roleCheck.status);
  const auth = roleCheck;

  // Logo upload is multipart/form-data, not JSON — branch before req.json()
  // ever runs, since calling .json() on a multipart body throws and also
  // consumes the stream, leaving formData() with nothing left to read.
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    try {
      const { parseFormData } = require('../../../lib/upload');
      const { files } = await parseFormData(req, { category: 'branding', multiple: false });
      if (!files?.length) return err('No logo file provided', 400);
      const logoUrl = files[0].url;

      const existing = await queryOne(`SELECT key FROM system_settings WHERE key=?`, ['branding.logo_url']);
      if (existing) {
        await run(`UPDATE system_settings SET value=?, updated_by=?, updated_at=datetime('now') WHERE key=?`, [logoUrl, auth.user.employee_id, 'branding.logo_url']);
      } else {
        await run(`INSERT INTO system_settings (key, value, category, updated_by) VALUES (?,?,?,?)`, ['branding.logo_url', logoUrl, 'branding', auth.user.employee_id]);
      }
      require('../../../lib/settings').clearCache();
      await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'UPLOAD_LOGO', module: 'Admin', recordId: 'branding.logo_url', newValue: { logoUrl } });
      return ok({ uploaded: true, logo_url: logoUrl });
    } catch (uploadErr) {
      return err('Logo upload failed: ' + uploadErr.message, 500);
    }
  }

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;

  try {
    switch (action) {

      case 'toggle_module': {
        const { module_id, enabled } = body;
        if (!module_id) return err('module_id required', 400);
        const mod = await queryOne(`SELECT * FROM module_flags WHERE module_id=?`, [module_id]);
        if (!mod) return err('Module not found', 404);
        if (mod.is_core) return err('Core modules cannot be disabled', 400);
        await run(`UPDATE module_flags SET enabled=?, updated_by=?, updated_at=datetime('now') WHERE module_id=?`,
          [enabled ? 1 : 0, auth.user.employee_id, module_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: enabled ? 'MODULE_ENABLED' : 'MODULE_DISABLED', module: 'Admin', recordId: module_id });
        return ok({ updated: true, module_id, enabled: !!enabled });
      }

      case 'toggle_integration': {
        const { id, enabled } = body;
        if (!id) return err('id required', 400);
        await run(`UPDATE module_integrations SET enabled=?, updated_by=?, updated_at=datetime('now') WHERE id=?`,
          [enabled ? 1 : 0, auth.user.employee_id, id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: enabled ? 'INTEGRATION_ENABLED' : 'INTEGRATION_DISABLED', module: 'Admin', recordId: id });
        return ok({ updated: true, id, enabled: !!enabled });
      }

      case 'create_role': {
        const { code, name, description } = body;
        if (!code || !name) return err('code and name required', 400);
        const existing = await queryOne(`SELECT id FROM roles WHERE code=?`, [code]);
        if (existing) return err('Role code already exists', 409);
        const id = uuid();
        await run(`INSERT INTO roles (id, code, name, description) VALUES (?,?,?,?)`, [id, code, name, description || null]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_ROLE', module: 'Admin', recordId: id, newValue: { code, name } });
        return ok({ id, code, name }, 201);
      }

      case 'set_role_permissions': {
        const { role_id, permission_codes } = body;
        if (!role_id || !Array.isArray(permission_codes)) return err('role_id and permission_codes[] required', 400);
        const role = await queryOne(`SELECT * FROM roles WHERE id=?`, [role_id]);
        if (!role) return err('Role not found', 404);
        if (role.is_system) return err('System role permissions cannot be modified — create a custom role instead', 400);

        await run(`DELETE FROM role_permissions WHERE role_id=?`, [role_id]);
        for (const code of permission_codes) {
          const perm = await queryOne(`SELECT id FROM permissions WHERE code=?`, [code]);
          if (perm) await run(`INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)`, [role_id, perm.id]);
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SET_ROLE_PERMISSIONS', module: 'Admin', recordId: role_id, newValue: { permission_codes } });
        return ok({ updated: true, role_id, permission_count: permission_codes.length });
      }

      case 'assign_user_role': {
        const { user_id, role_id } = body;
        if (!user_id || !role_id) return err('user_id and role_id required', 400);
        const existing = await queryOne(`SELECT 1 FROM user_roles WHERE user_id=? AND role_id=?`, [user_id, role_id]);
        if (existing) return err('User already has this role', 409);
        await run(`INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)`, [user_id, role_id, auth.user.employee_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'ASSIGN_USER_ROLE', module: 'Admin', recordId: user_id, newValue: { role_id } });
        return ok({ assigned: true });
      }

      case 'remove_user_role': {
        const { user_id, role_id } = body;
        if (!user_id || !role_id) return err('user_id and role_id required', 400);
        await run(`DELETE FROM user_roles WHERE user_id=? AND role_id=?`, [user_id, role_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'REMOVE_USER_ROLE', module: 'Admin', recordId: user_id, newValue: { role_id } });
        return ok({ removed: true });
      }

      case 'create_branch': {
        const { code, name, city, address } = body;
        if (!code || !name) return err('code and name required', 400);
        const id = uuid();
        await run(`INSERT INTO branches (id, code, name, city, address) VALUES (?,?,?,?,?)`, [id, code, name, city || null, address || null]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_BRANCH', module: 'Admin', recordId: id, newValue: { code, name } });
        return ok({ id, code, name }, 201);
      }

      case 'create_department': {
        const { code, name, branch_id, head_id } = body;
        if (!code || !name) return err('code and name required', 400);
        const id = uuid();
        await run(`INSERT INTO departments (id, code, name, branch_id, head_id) VALUES (?,?,?,?,?)`, [id, code, name, branch_id || null, head_id || null]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_DEPARTMENT', module: 'Admin', recordId: id, newValue: { code, name } });
        return ok({ id, code, name }, 201);
      }

      case 'update_setting': {
        const { key, value } = body;
        if (!key) return err('key required', 400);
        const category = key.includes('.') ? key.split('.')[0] : 'general';
        const existing = await queryOne(`SELECT key FROM system_settings WHERE key=?`, [key]);
        if (existing) {
          await run(`UPDATE system_settings SET value=?, updated_by=?, updated_at=datetime('now') WHERE key=?`, [value, auth.user.employee_id, key]);
        } else {
          await run(`INSERT INTO system_settings (key, value, category, updated_by) VALUES (?,?,?,?)`, [key, value, category, auth.user.employee_id]);
        }
        require('../../../lib/settings').clearCache(); // so the new value is read immediately, not after the 30s TTL
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'UPDATE_SETTING', module: 'Admin', recordId: key, newValue: { value } });
        return ok({ updated: true, key, value });
      }

      case 'create_user': {
        const { email, password, employee_id, role, role_codes } = body;
        if (!email || !password || !employee_id) return err('email, password, employee_id required', 400);
        const existing = await queryOne(`SELECT id FROM users WHERE email=?`, [email.toLowerCase()]);
        if (existing) return err('A user with this email already exists', 409);

        const id = uuid();
        const hashed = await hashPassword(password);
        await run(`INSERT INTO users (id, employee_id, email, password, role) VALUES (?,?,?,?,?)`,
          [id, employee_id, email.toLowerCase(), hashed, role || 'staff']);

        if (Array.isArray(role_codes)) {
          for (const code of role_codes) {
            const r = await queryOne(`SELECT id FROM roles WHERE code=?`, [code]);
            if (r) await run(`INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)`, [id, r.id, auth.user.employee_id]);
          }
        }

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_USER', module: 'Admin', recordId: id, newValue: { email } });
        return ok({ id, email }, 201);
      }

      case 'deactivate_user': {
        const { user_id } = body;
        if (!user_id) return err('user_id required', 400);
        await run(`UPDATE users SET is_active=0 WHERE id=?`, [user_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'DEACTIVATE_USER', module: 'Admin', recordId: user_id });
        return ok({ deactivated: true });
      }

      default:
        return err('Unknown action', 400);
    }
  } catch (e) {
    console.error('[Admin POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
