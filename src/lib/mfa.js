// src/lib/mfa.js — Multi-Factor Authentication (TOTP)
// Uses speakeasy (RFC 6238 TOTP) + QR code generation
// Compatible with Google Authenticator, Authy, Microsoft Authenticator

const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');

const APP_NAME = 'QSL ERP';
const ISSUER   = 'Qalibrated Systems Limited';
const WINDOW   = 1; // Allow 1 step (30s) tolerance either side

// ── GENERATE SECRET (on MFA setup) ───────────────────────────────────────────

/**
 * Generate a new TOTP secret for a user.
 * Returns the secret and a QR code data URL for the authenticator app.
 */
async function generateMFASecret(userEmail, userName) {
  const secret = speakeasy.generateSecret({
    name:   `${APP_NAME} (${userEmail})`,
    issuer: ISSUER,
    length: 32,
  });

  // Generate QR code as data URL (base64 PNG)
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

  return {
    secret:      secret.base32,           // Store this encrypted in DB (mfa_secret column)
    otpauth_url: secret.otpauth_url,      // For manual entry
    qr_code:     qrDataUrl,               // Show this to user to scan
    backup_codes: generateBackupCodes(),  // Emergency one-time codes
  };
}

/**
 * Generate 8 one-time backup codes (store hashed in DB).
 */
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 8; i++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase() + '-' +
                 Math.random().toString(36).slice(2, 8).toUpperCase();
    codes.push(code);
  }
  return codes;
}

// ── VERIFY TOTP ───────────────────────────────────────────────────────────────

/**
 * Verify a 6-digit TOTP code against the stored secret.
 * @param {string} secret  - Base32 secret from DB (mfa_secret)
 * @param {string} token   - 6-digit code entered by user
 * @returns {boolean}
 */
function verifyTOTP(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token:    String(token).replace(/\s/g, ''),
    window:   WINDOW,
  });
}

/**
 * Generate current TOTP (for testing purposes only — never expose in UI).
 */
function generateCurrentTOTP(secret) {
  return speakeasy.totp({ secret, encoding: 'base32' });
}

// ── MFA API ROUTE HANDLER ─────────────────────────────────────────────────────
// Wire this into src/app/api/auth/route.js

/**
 * POST /api/auth { action: 'setup_mfa', user_id }
 * Returns QR code for user to scan.
 */
async function handleSetupMFA(userId, userEmail, userName, db, bcrypt) {
  const { secret, qr_code, otpauth_url, backup_codes } = await generateMFASecret(userEmail, userName);

  // Store unconfirmed secret — only activate after user confirms first code
  await db.run(
    `UPDATE users SET mfa_secret=?, mfa_enabled=0 WHERE id=?`,
    [secret, userId]
  );

  return { qr_code, otpauth_url, backup_codes, message: 'Scan QR code in your authenticator app, then confirm with your first 6-digit code.' };
}

/**
 * POST /api/auth { action: 'confirm_mfa', user_id, token }
 * Confirms MFA setup by verifying first code.
 */
async function handleConfirmMFA(userId, token, db) {
  const user = await db.queryOne(`SELECT mfa_secret FROM users WHERE id=?`, [userId]);
  if (!user?.mfa_secret) return { error: 'MFA secret not found. Run setup first.' };

  const valid = verifyTOTP(user.mfa_secret, token);
  if (!valid) return { error: 'Invalid code. Check your authenticator app and try again.' };

  await db.run(`UPDATE users SET mfa_enabled=1 WHERE id=?`, [userId]);
  return { confirmed: true, message: 'MFA enabled successfully. You will need your authenticator app on every login.' };
}

/**
 * POST /api/auth { action: 'verify_mfa', user_id, token }
 * Called during login after password is verified.
 */
async function handleVerifyMFA(userId, token, db) {
  const user = await db.queryOne(`SELECT mfa_secret, mfa_enabled FROM users WHERE id=?`, [userId]);

  if (!user?.mfa_enabled) return { valid: true, mfa_required: false }; // MFA not enabled — skip
  if (!user?.mfa_secret)  return { error: 'MFA configuration error.' };

  const valid = verifyTOTP(user.mfa_secret, token);
  return { valid, mfa_required: true, error: valid ? null : 'Invalid MFA code. Try again.' };
}

/**
 * POST /api/auth { action: 'disable_mfa', user_id, token }
 * Disable MFA (requires valid code confirmation).
 */
async function handleDisableMFA(userId, token, db) {
  const user = await db.queryOne(`SELECT mfa_secret FROM users WHERE id=?`, [userId]);
  if (!user?.mfa_secret) return { error: 'MFA not enabled.' };

  const valid = verifyTOTP(user.mfa_secret, token);
  if (!valid) return { error: 'Invalid code. MFA was not disabled.' };

  await db.run(`UPDATE users SET mfa_enabled=0, mfa_secret=NULL WHERE id=?`, [userId]);
  return { disabled: true };
}

module.exports = {
  generateMFASecret,
  verifyTOTP,
  generateCurrentTOTP,
  generateBackupCodes,
  handleSetupMFA,
  handleConfirmMFA,
  handleVerifyMFA,
  handleDisableMFA,
};
