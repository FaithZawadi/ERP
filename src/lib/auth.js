// src/lib/auth.js — JWT Authentication & Digital Signature utilities

const jwt  = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'qsl-erp-secret-2026-change-in-production';
const EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

// ── JWT ──────────────────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function getTokenFromHeader(req) {
  const auth = req.headers?.authorization || req.headers?.get?.('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// Next.js App Router — middleware helper
async function requireAuth(req) {
  const token = getTokenFromHeader(req);
  if (!token) {
    return { error: 'Unauthorised — no token', status: 401 };
  }
  const payload = verifyToken(token);
  if (!payload) {
    return { error: 'Unauthorised — invalid or expired token', status: 401 };
  }
  return { user: payload };
}

// Role-based access helper
function requireRole(...roles) {
  return async (req) => {
    const auth = await requireAuth(req);
    if (auth.error) return auth;
    if (!roles.includes(auth.user.role)) {
      return { error: `Forbidden — requires role: ${roles.join(' or ')}`, status: 403 };
    }
    return auth;
  };
}

// ── RBAC: PERMISSION CHECKS ───────────────────────────────────────────────────
// Layered on top of requireRole — checks the new roles/permissions/
// role_permissions/user_roles tables (point 3, Administration Panel).
// requireRole stays untouched and keeps working for every existing route;
// this is additive for routes that want finer-grained permission checks.

async function userHasPermission(userId, permissionCode) {
  const { query } = require('./db');
  const rows = await query(
    `SELECT 1 FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ? AND p.code = ? LIMIT 1`,
    [userId, permissionCode]
  );
  return rows.length > 0;
}

function requirePermission(permissionCode) {
  return async (req) => {
    const auth = await requireAuth(req);
    if (auth.error) return auth;
    // md and admin always pass — they hold every permission by seed data,
    // but this also covers the case where RBAC tables haven't been migrated
    // yet on an older deployment.
    if (auth.user.role === 'md' || auth.user.role === 'admin') return auth;
    const has = await userHasPermission(auth.user.id, permissionCode);
    if (!has) {
      return { error: `Forbidden — requires permission: ${permissionCode}`, status: 403 };
    }
    return auth;
  };
}

// ── MODULAR ARCHITECTURE: MODULE ENABLEMENT CHECK ─────────────────────────────
// Point 5 — one codebase, modules toggled per deployment. Any API route for
// a non-core module should call this before doing real work, so a client
// who hasn't purchased e.g. Fleet gets a clean 403 rather than the feature
// silently working anyway.

async function requireModuleEnabled(moduleId) {
  const { queryOne } = require('./db');
  const row = await queryOne(`SELECT enabled, is_core FROM module_flags WHERE module_id=?`, [moduleId]);
  if (!row) return true; // unknown module id (e.g. not yet migrated) — fail open, don't break existing deployments
  if (row.is_core) return true;
  return !!row.enabled;
}

// ── PASSWORDS ────────────────────────────────────────────────────────────────

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function comparePassword(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}

// ── DIGITAL SIGNATURES (ARCH-007B) ───────────────────────────────────────────

/**
 * Generate an RSA-2048 key pair for a new staff member.
 * Private key is stored encrypted server-side.
 * Key ID format: QSL-DS-{INITIALS}-{YEAR}
 */
function generateKeyPair(employeeId, initials, year = new Date().getFullYear()) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keyId = `QSL-DS-${initials.toUpperCase()}-${year}`;
  return { privateKey, publicKey, keyId };
}

/**
 * Sign a payload (document hash + timestamp + userId) with private key.
 * Returns base64 signature string.
 */
function signDocument(privateKeyPem, payload) {
  const sign = crypto.createSign('SHA256');
  sign.update(JSON.stringify(payload));
  return sign.sign(privateKeyPem, 'base64');
}

/**
 * Verify a signature against its public key and payload.
 */
function verifySignature(publicKeyPem, payload, signature) {
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(JSON.stringify(payload));
    return verify.verify(publicKeyPem, signature, 'base64');
  } catch {
    return false;
  }
}

/**
 * Hash a document (string or object) for signing.
 */
function hashDocument(doc) {
  const str = typeof doc === 'string' ? doc : JSON.stringify(doc);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Create a signed approval record — used on payroll, budget overrides, transfers etc.
 */
function createApprovalRecord(userId, userName, keyId, privateKeyPem, documentRef, action) {
  const payload = {
    documentRef,
    action,
    userId,
    userName,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const signature = signDocument(privateKeyPem, payload);
  return {
    keyId,
    userId,
    userName,
    action,
    documentRef,
    timestamp: payload.timestamp,
    signature,
    payload,
  };
}

// ── AUDIT LOG HELPER ─────────────────────────────────────────────────────────
//
// Every API route in this app calls this as logAudit(query, {...}) — passing
// the `query` (SELECT-only) function from db.js rather than the full db
// module. That db argument is actually unused here: we always pull `run`
// directly from db.js, so the call works correctly regardless of what gets
// passed as the first argument. This keeps every existing call site working
// without having to touch 31 call sites across 15 route files.

async function logAudit(_db, { userId, userName, action, module, recordId, recordType, oldValue, newValue, ipAddress, sigUsed }) {
  const { v4: uuidv4 } = require('uuid');
  const { run } = require('./db');
  // sql.js's parameter binder throws on `undefined` (it only accepts null,
  // numbers, strings, or buffers) — callers across the app don't always
  // supply every optional field, so normalise undefined -> null here once,
  // rather than requiring every one of the 31 call sites to do it themselves.
  const nn = (v) => (v === undefined ? null : v);
  await run(
    `INSERT INTO audit_log (id,user_id,user_name,action,module,record_id,record_type,old_value,new_value,ip_address,sig_used)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [uuidv4(), nn(userId), nn(userName), nn(action), nn(module), nn(recordId), nn(recordType),
     oldValue ? JSON.stringify(oldValue) : null,
     newValue ? JSON.stringify(newValue) : null,
     nn(ipAddress), nn(sigUsed)]
  );
}

// ── RESPONSE HELPERS ──────────────────────────────────────────────────────────

function ok(data, status = 200) {
  const { NextResponse } = require('next/server');
  return NextResponse.json({ success: true, data }, { status });
}

function err(message, status = 400, details = null) {
  const { NextResponse } = require('next/server');
  return NextResponse.json({ success: false, error: message, details }, { status });
}

module.exports = {
  signToken, verifyToken, requireAuth, requireRole,
  requirePermission, userHasPermission, requireModuleEnabled,
  hashPassword, comparePassword,
  generateKeyPair, signDocument, verifySignature, hashDocument, createApprovalRecord,
  logAudit, ok, err,
};
