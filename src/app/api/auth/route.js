// src/app/api/auth/route.js — Authentication API

import { NextResponse } from 'next/server';
import { v4 as uuid }   from 'uuid';
import {
  signToken, hashPassword, comparePassword,
  generateKeyPair, logAudit, ok, err
} from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';

// POST /api/auth  — action: login | logout | change_password | refresh
export async function POST(req) {
  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;
  const ip = req.headers.get('x-forwarded-for') || 'unknown';

  switch (action) {

    // ── LOGIN ──────────────────────────────────────────────────────────────
    case 'login': {
      const { email, password } = body;
      if (!email || !password) return err('email and password required', 400);

      const user = await queryOne(
        `SELECT u.*, e.first_name||' '||e.last_name as full_name, e.department, e.id as employee_id
         FROM users u JOIN employees e ON u.employee_id=e.id
         WHERE u.email=? AND u.is_active=1`, [email.toLowerCase()]
      );

      if (!user) return err('Invalid credentials', 401);

      const valid = await comparePassword(password, user.password);
      if (!valid) {
        await logAudit(query, {
          userId: user.id, userName: user.full_name,
          action: 'LOGIN_FAILED', module: 'Auth', ipAddress: ip,
        });
        return err('Invalid credentials', 401);
      }

      // Update last login
      await run(`UPDATE users SET last_login=datetime('now') WHERE id=?`, [user.id]);

      const token = signToken({
        id:          user.id,
        employee_id: user.employee_id,
        name:        user.full_name,
        email:       user.email,
        role:        user.role,
        department:  user.department,
      });

      await logAudit(query, {
        userId: user.id, userName: user.full_name,
        action: 'LOGIN_SUCCESS', module: 'Auth', ipAddress: ip,
      });

      // Get digital signature key for this user
      const sig = await queryOne(`SELECT key_id FROM digital_signatures WHERE user_id=? AND is_active=1`, [user.id]);

      return ok({
        token,
        user: {
          id:          user.id,
          employee_id: user.employee_id,
          name:        user.full_name,
          email:       user.email,
          role:        user.role,
          department:  user.department,
          signature_key: sig?.key_id || null,
        },
      });
    }

    // ── REGISTER (admin only — or first-run) ─────────────────────────────
    case 'register': {
      const { employee_id, email, password, role } = body;
      if (!employee_id || !email || !password) return err('employee_id, email, password required', 400);

      const emp = await queryOne(`SELECT * FROM employees WHERE id=?`, [employee_id]);
      if (!emp) return err('Employee not found', 404);

      const exists = await queryOne(`SELECT id FROM users WHERE email=?`, [email.toLowerCase()]);
      if (exists) return err('Email already registered', 409);

      const hashed   = await hashPassword(password);
      const userId   = uuid();
      const initials = `${emp.first_name[0]}${emp.last_name[0]}`;

      // Generate digital signature key pair
      const { privateKey, publicKey, keyId } = generateKeyPair(employee_id, initials);

      await run(
        `INSERT INTO users (id,employee_id,email,password,role) VALUES (?,?,?,?,?)`,
        [userId, employee_id, email.toLowerCase(), hashed, role || 'staff']
      );

      await run(
        `INSERT INTO digital_signatures (id,user_id,key_id,public_key,private_key) VALUES (?,?,?,?,?)`,
        [uuid(), userId, keyId, publicKey, privateKey]
      );

      await logAudit(query, {
        userId, userName: `${emp.first_name} ${emp.last_name}`,
        action: 'USER_REGISTERED', module: 'Auth', ipAddress: ip,
        newValue: { email, role: role || 'staff', keyId },
      });

      return ok({ user_id: userId, key_id: keyId }, 201);
    }

    // ── CHANGE PASSWORD ────────────────────────────────────────────────────
    case 'change_password': {
      const { user_id, current_password, new_password } = body;
      if (!user_id || !current_password || !new_password) return err('user_id, current_password, new_password required', 400);
      if (new_password.length < 10) return err('Password must be at least 10 characters', 400);

      const user = await queryOne(`SELECT * FROM users WHERE id=?`, [user_id]);
      if (!user) return err('User not found', 404);

      const valid = await comparePassword(current_password, user.password);
      if (!valid) return err('Current password incorrect', 401);

      const hashed = await hashPassword(new_password);
      await run(`UPDATE users SET password=?, updated_at=datetime('now') WHERE id=?`, [hashed, user_id]);

      return ok({ changed: true });
    }

    // ── VERIFY DIGITAL SIGNATURE ───────────────────────────────────────────
    case 'verify_signature': {
      const { key_id } = body;
      if (!key_id) return err('key_id required', 400);

      const sig = await queryOne(
        `SELECT ds.*, u.email, e.first_name||' '||e.last_name as staff_name
         FROM digital_signatures ds JOIN users u ON ds.user_id=u.id JOIN employees e ON u.employee_id=e.id
         WHERE ds.key_id=?`, [key_id]
      );

      if (!sig) return err('Signature key not found', 404);

      return ok({
        key_id:     sig.key_id,
        staff_name: sig.staff_name,
        email:      sig.email,
        is_active:  sig.is_active === 1,
        issued_at:  sig.issued_at,
        revoked_at: sig.revoked_at || null,
        algorithm:  sig.algorithm,
        uses:       sig.uses,
        valid:      sig.is_active === 1 && !sig.revoked_at,
      });
    }

    // ── MFA SETUP ─────────────────────────────────────────────────────────────
    case 'setup_mfa': {
      const { user_id } = body;
      if (!user_id) return err('user_id required', 400);
      const u = await queryOne(`SELECT u.*, e.email, e.first_name||' '||e.last_name as full_name FROM users u JOIN employees e ON u.employee_id=e.id WHERE u.id=?`, [user_id]);
      if (!u) return err('User not found', 404);
      const { handleSetupMFA } = require('../../../lib/mfa');
      const result = await handleSetupMFA(user_id, u.email, u.full_name, { run, queryOne });
      if (result.error) return err(result.error, 400);
      return ok(result);
    }

    // ── MFA CONFIRM ────────────────────────────────────────────────────────────
    case 'confirm_mfa': {
      const { user_id, token: mfa_token } = body;
      if (!user_id || !mfa_token) return err('user_id and token required', 400);
      const { handleConfirmMFA } = require('../../../lib/mfa');
      const result = await handleConfirmMFA(user_id, mfa_token, { queryOne, run });
      if (result.error) return err(result.error, 400);
      await logAudit(query, { userId: user_id, userName: 'User', action: 'MFA_ENABLED', module: 'Auth', ipAddress: ip });
      return ok(result);
    }

    // ── MFA VERIFY (during login) ──────────────────────────────────────────────
    case 'verify_mfa': {
      const { user_id, token: mfa_token } = body;
      if (!user_id || !mfa_token) return err('user_id and token required', 400);
      const { handleVerifyMFA } = require('../../../lib/mfa');
      const result = await handleVerifyMFA(user_id, mfa_token, { queryOne });
      if (result.error) return err(result.error, 401);
      return ok(result);
    }

    // ── MFA DISABLE ────────────────────────────────────────────────────────────
    case 'disable_mfa': {
      const { user_id, token: mfa_token } = body;
      if (!user_id || !mfa_token) return err('user_id and token required', 400);
      const { handleDisableMFA } = require('../../../lib/mfa');
      const result = await handleDisableMFA(user_id, mfa_token, { queryOne, run });
      if (result.error) return err(result.error, 400);
      await logAudit(query, { userId: user_id, userName: 'User', action: 'MFA_DISABLED', module: 'Auth', ipAddress: ip });
      return ok(result);
    }

    // ── REVOKE SIGNATURE (on separation) ──────────────────────────────────
    case 'revoke_signature': {
      const { user_id, revoked_by } = body;
      if (!user_id) return err('user_id required', 400);

      await run(
        `UPDATE digital_signatures SET is_active=0, revoked_at=datetime('now'), revoked_by=? WHERE user_id=?`,
        [revoked_by, user_id]
      );
      await run(`UPDATE users SET is_active=0, updated_at=datetime('now') WHERE id=?`, [user_id]);

      await logAudit(query, {
        userId: revoked_by, userName: 'System/HR',
        action: 'SIGNATURE_REVOKED', module: 'Auth',
        recordId: user_id, newValue: { revoked: true },
      });

      return ok({ revoked: true });
    }

    default:
      return err(`Unknown action: ${action}`, 400);
  }
}

// GET /api/auth — get current user profile
export async function GET(req) {
  const { requireAuth } = require('../../../lib/auth');
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const user = await queryOne(
    `SELECT u.id, u.email, u.role, u.last_login,
            e.first_name, e.last_name, e.department, e.role as job_title, e.phone,
            ds.key_id as signature_key, ds.is_active as sig_active
     FROM users u
     JOIN employees e ON u.employee_id=e.id
     LEFT JOIN digital_signatures ds ON ds.user_id=u.id AND ds.is_active=1
     WHERE u.id=?`, [auth.user.id]
  );

  if (!user) return err('User not found', 404);
  return ok(user);
}
