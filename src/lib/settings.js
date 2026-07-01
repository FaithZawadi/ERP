// src/lib/settings.js — runtime configuration backbone
//
// Lets the business adjust functionality (tax rate, approval chain, alert
// windows, company details, branding, financial thresholds) from the
// Administration → System Settings UI instead of editing code. Every value
// lives in the system_settings table as a key/value string; this module is
// the single read path, with a short in-memory cache so hot routes don't hit
// the DB on every request, and a typed fallback so code never breaks if a key
// hasn't been set yet.
//
// db is required lazily inside the functions (not at module top) so this file
// stays import-safe from anywhere, including places that only want DEFAULTS.

// Canonical defaults. These are also the values the UI seeds/shows, so a fresh
// install behaves exactly as the old hardcoded constants did.
const DEFAULTS = {
  // Company identity (used on invoices, certificates, payslips, PDF exports)
  'company.legal_name':   'Qalibrated Systems Limited',
  'company.kra_pin':      'P000000001K',
  'company.address':      'Birdi Singh Complex, Off Mombasa Road, Nairobi',
  'company.phone':        '+254 714 999 996',
  'company.email':        'info@qalibrated.co.ke',
  // General
  'general.default_currency': 'KES',
  'general.fiscal_year_start': '01-01',
  // Branding (also exposed publicly via /api/branding)
  'branding.company_display_name': 'QSL ERP',
  'branding.primary_color': '#1B3A5C',
  'branding.accent_color':  '#C8960C',
  'branding.font_family':   'Inter',
  'branding.logo_url':      '/logo.svg',
  // Public site URL — used to build certificate verify links and the
  // sitemap/canonical URLs on the public website.
  'branding.site_url':      'https://qalibrated.co.ke',
  // Finance
  'finance.vat_rate':            '0.16',
  'finance.imprest_retire_days': '14',
  'finance.pay_limit_staff':        '5000',
  'finance.pay_limit_dept_head':    '20000',
  'finance.pay_limit_finance_mgr':  '100000',
  'finance.pay_limit_cfo':          '500000',
  // FX risk buffer on import LPOs (FIN-015)
  'finance.fx_buffer':       '0.05',   // standard buffer on USD/CNY imports
  'finance.fx_buffer_long':  '0.08',   // buffer when lead time exceeds the threshold
  'finance.fx_buffer_lead_days': '60',
  // Minimum Selling Price margins by category (STK-010 / Part 4.3)
  'msp.margin_calibration':  '0.25',
  'msp.margin_construction': '0.15',
  'msp.margin_spare_parts':  '0.30',
  'msp.margin_tools':        '0.20',
  'msp.margin_safety':       '0.20',
  'msp.margin_imported':     '0.30',
  // Sales commission tiers (COM-001) — collected-revenue % by YTD-target band
  'commission.tiers': JSON.stringify([
    { from: 0,   to: 70,  rate: 0 },
    { from: 70,  to: 80,  rate: 0.01 },
    { from: 80,  to: 90,  rate: 0.03 },
    { from: 90,  to: 100, rate: 0.05 },
    { from: 100, to: 9999, rate: 0.07 },
  ]),
  // Attendance (HR / ATT-002)
  'hr.work_start': '08:00',
  'hr.late_grace_minutes': '15',
  'hr.appraisal_warning_score':      '50',   // manager/HR score below this triggers a warning
  'hr.appraisal_final_warning_count': '2',    // consecutive low-score months -> final warning
  'hr.appraisal_termination_count':   '3',    // consecutive low-score months -> termination review
  // Store & requisitions
  'store.low_stock_check_frequency': 'daily',
  'requisitions.approval_levels': JSON.stringify(['supervisor', 'store_manager']),
  // Alert windows (days before)
  'alerts.cert_expiry_days':     '60',
  'alerts.debtor_escalation_days': '30',
  'alerts.insurance_alert_days': '30',
  'alerts.tender_alert_days':    '14',
};

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 30_000;

async function loadAll() {
  const now = Date.now ? Date.now() : new Date().getTime();
  if (_cache && (now - _cacheAt) < TTL_MS) return _cache;
  const { query } = require('./db');
  let rows = [];
  try { rows = await query(`SELECT key, value FROM system_settings`); } catch { rows = []; }
  const map = { ...DEFAULTS };
  for (const r of rows) if (r.value !== null && r.value !== undefined) map[r.key] = r.value;
  _cache = map; _cacheAt = now;
  return map;
}

// Invalidate the cache after a write (called by the admin update_setting handler).
function clearCache() { _cache = null; _cacheAt = 0; }

async function getSetting(key, fallback = null) {
  const all = await loadAll();
  return all[key] ?? (fallback !== null ? fallback : DEFAULTS[key] ?? null);
}

async function getNum(key, fallback = 0) {
  const v = await getSetting(key, null);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

async function getInt(key, fallback = 0) {
  const v = await getSetting(key, null);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function getBool(key, fallback = false) {
  const v = await getSetting(key, null);
  if (v === null) return fallback;
  return v === '1' || v === 'true' || v === true;
}

async function getJSON(key, fallback = null) {
  const v = await getSetting(key, null);
  if (v === null) return fallback;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fallback; }
}

// Convenience: the full company identity block for PDFs/invoices.
async function getCompany() {
  const all = await loadAll();
  return {
    legal_name: all['company.legal_name'],
    kra_pin:    all['company.kra_pin'],
    address:    all['company.address'],
    phone:      all['company.phone'],
    email:      all['company.email'],
    site_url:   all['branding.site_url'],
  };
}

module.exports = { DEFAULTS, getSetting, getNum, getInt, getBool, getJSON, getCompany, clearCache };
