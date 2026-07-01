// database/migrate-v4-through-v7-consolidated.js
//
// Runs migrations v4, v5, v6 and v7 in sequence against a single live
// database connection. Ported from qslerp (FaithZawadi/qslerp) as part of
// bringing repo A (FaithZawadi/ERP, the canonical build) up to feature
// parity with repo B. See QSL_ERP_Merge_Instructions for the full context.
//
// v4 — Quotes, Debit Notes, Credit Notes, Travel Claims (+ lines, + 4 indexes)
// v5 — SOP Library: sop_documents, sop_document_versions (+ 2 indexes)
// v6 — NAWI (EURAMET cg-18) test-data tables + calibration_certs columns
// v7 — CPD tracking, monthly appraisals, performance warnings, job photos,
//      ISO/IEC 17020 work inspections + employees/cpd_logs columns +
//      seeds the 12 default CPD platforms
//
// Run: node database/migrate-v4-through-v7-consolidated.js
// Safe to re-run and safe to run on a live database — every CREATE TABLE
// uses IF NOT EXISTS, every ALTER TABLE ADD COLUMN is wrapped so a
// pre-existing column is skipped rather than failing the run, and the CPD
// platform seed checks for an existing row (by name) before inserting.
// This does not replace running the individual migrate-v4.js..v7.js files —
// it is an alternative single entry point for deploys that want all four
// applied in one pass instead of four separate invocations.

const { v4: uuid } = require('uuid');

const V4_SCHEMA = `
CREATE TABLE IF NOT EXISTS quotes (
  id              TEXT PRIMARY KEY,
  quote_no        TEXT UNIQUE NOT NULL,
  client_id       TEXT REFERENCES clients(id),
  date            TEXT DEFAULT (date('now')),
  valid_until     TEXT,
  subtotal        REAL NOT NULL DEFAULT 0,
  vat_amount      REAL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  status          TEXT DEFAULT 'draft',
  created_by      TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quote_lines (
  id              TEXT PRIMARY KEY,
  quote_id        TEXT REFERENCES quotes(id),
  description     TEXT NOT NULL,
  quantity        REAL DEFAULT 1,
  unit_price      REAL NOT NULL,
  total           REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS debit_notes (
  id              TEXT PRIMARY KEY,
  note_no         TEXT UNIQUE NOT NULL,
  client_id       TEXT REFERENCES clients(id),
  invoice_id      TEXT REFERENCES tax_invoices(id),
  date            TEXT DEFAULT (date('now')),
  amount          REAL NOT NULL,
  reason          TEXT NOT NULL,
  created_by      TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id              TEXT PRIMARY KEY,
  note_no         TEXT UNIQUE NOT NULL,
  client_id       TEXT REFERENCES clients(id),
  invoice_id      TEXT REFERENCES tax_invoices(id),
  date            TEXT DEFAULT (date('now')),
  amount          REAL NOT NULL,
  reason          TEXT NOT NULL,
  created_by      TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS travel_claims (
  id              TEXT PRIMARY KEY,
  claim_no        TEXT UNIQUE NOT NULL,
  employee_id     TEXT REFERENCES employees(id),
  trip_purpose    TEXT NOT NULL,
  from_date       TEXT NOT NULL,
  to_date         TEXT NOT NULL,
  destination     TEXT,
  total_amount    REAL NOT NULL DEFAULT 0,
  status          TEXT DEFAULT 'pending',
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS travel_claim_lines (
  id              TEXT PRIMARY KEY,
  claim_id        TEXT REFERENCES travel_claims(id),
  date            TEXT,
  description     TEXT NOT NULL,
  amount          REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_client ON debit_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_client ON credit_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_travel_claims_employee ON travel_claims(employee_id);
`;

const V5_SCHEMA = `
CREATE TABLE IF NOT EXISTS sop_documents (
  id                TEXT PRIMARY KEY,
  code              TEXT UNIQUE NOT NULL,
  title             TEXT NOT NULL,
  department        TEXT NOT NULL,
  category          TEXT,
  current_version   INTEGER NOT NULL DEFAULT 1,
  file_url          TEXT,
  reviewed_by       TEXT REFERENCES employees(id),
  reviewed_at       TEXT,
  next_review_date  TEXT,
  status            TEXT DEFAULT 'active',
  created_by        TEXT REFERENCES employees(id),
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sop_document_versions (
  id                TEXT PRIMARY KEY,
  sop_id            TEXT REFERENCES sop_documents(id),
  version_no        INTEGER NOT NULL,
  file_url          TEXT,
  change_notes      TEXT,
  uploaded_by       TEXT REFERENCES employees(id),
  uploaded_at       TEXT DEFAULT (datetime('now')),
  is_current        INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sop_dept ON sop_documents(department);
CREATE INDEX IF NOT EXISTS idx_sop_versions_sop ON sop_document_versions(sop_id);
`;

const V6_SCHEMA = `
CREATE TABLE IF NOT EXISTS nawi_test_points (
  id              TEXT PRIMARY KEY,
  cert_id         TEXT REFERENCES calibration_certs(id),
  test_load       TEXT NOT NULL,
  indication      REAL,
  error           REAL,
  uncertainty     REAL,
  sort_order      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nawi_repeatability_readings (
  id              TEXT PRIMARY KEY,
  cert_id         TEXT REFERENCES calibration_certs(id),
  reading_no      INTEGER NOT NULL,
  indication      REAL
);

CREATE TABLE IF NOT EXISTS nawi_eccentricity_readings (
  id              TEXT PRIMARY KEY,
  cert_id         TEXT REFERENCES calibration_certs(id),
  position         TEXT NOT NULL,
  indication      REAL,
  deviation       REAL,
  sort_order      INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_nawi_points_cert ON nawi_test_points(cert_id);
CREATE INDEX IF NOT EXISTS idx_nawi_repeat_cert ON nawi_repeatability_readings(cert_id);
CREATE INDEX IF NOT EXISTS idx_nawi_eccen_cert ON nawi_eccentricity_readings(cert_id);
`;

const V6_COLUMNS = [
  `ALTER TABLE calibration_certs ADD COLUMN checked_by TEXT REFERENCES employees(id)`,
  `ALTER TABLE calibration_certs ADD COLUMN checked_sig TEXT`,
  `ALTER TABLE calibration_certs ADD COLUMN instrument_type TEXT DEFAULT 'general'`,
  `ALTER TABLE calibration_certs ADD COLUMN temp_c_end REAL`,
  `ALTER TABLE calibration_certs ADD COLUMN humidity_pct_end REAL`,
  `ALTER TABLE calibration_certs ADD COLUMN min_weight TEXT`,
  `ALTER TABLE calibration_certs ADD COLUMN repeatability_stdev REAL`,
  `ALTER TABLE calibration_certs ADD COLUMN checked_at TEXT`,
];

const V7_SCHEMA = `
CREATE TABLE IF NOT EXISTS cpd_platforms (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  description     TEXT,
  is_active       INTEGER DEFAULT 1,
  sort_order      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cpd_logs (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT REFERENCES employees(id),
  platform_id     TEXT REFERENCES cpd_platforms(id),
  activity        TEXT NOT NULL,
  provider        TEXT,
  points          REAL NOT NULL DEFAULT 0,
  date_completed  TEXT NOT NULL,
  certificate_url TEXT,
  approved_by     TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monthly_appraisals (
  id                  TEXT PRIMARY KEY,
  employee_id         TEXT REFERENCES employees(id),
  period              TEXT NOT NULL,
  achievements        TEXT,
  challenges          TEXT,
  next_month_plan     TEXT,
  self_score          REAL,
  manager_score       REAL,
  manager_comments    TEXT,
  manager_id          TEXT REFERENCES employees(id),
  manager_reviewed_at TEXT,
  hr_reviewed_by      TEXT REFERENCES employees(id),
  hr_reviewed_at      TEXT,
  hr_comments         TEXT,
  status              TEXT DEFAULT 'pending',
  created_at          TEXT DEFAULT (datetime('now')),
  UNIQUE(employee_id, period)
);

CREATE TABLE IF NOT EXISTS performance_warnings (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT REFERENCES employees(id),
  level           TEXT NOT NULL,
  reason          TEXT NOT NULL,
  trigger_period  TEXT,
  issued_by       TEXT REFERENCES employees(id),
  issued_at       TEXT DEFAULT (datetime('now')),
  status          TEXT DEFAULT 'active',
  resolved_at     TEXT,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS job_photos (
  id              TEXT PRIMARY KEY,
  job_id          TEXT REFERENCES calibration_jobs(id),
  url             TEXT NOT NULL,
  caption         TEXT,
  lat             REAL,
  lng             REAL,
  captured_at     TEXT NOT NULL,
  uploaded_by     TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_work_inspections (
  id              TEXT PRIMARY KEY,
  job_id          TEXT REFERENCES calibration_jobs(id),
  stage           TEXT NOT NULL,
  checklist       TEXT NOT NULL,
  result          TEXT DEFAULT 'pending',
  inspector_id    TEXT REFERENCES employees(id),
  sig             TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cpd_logs_employee ON cpd_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_appraisals_employee ON monthly_appraisals(employee_id);
CREATE INDEX IF NOT EXISTS idx_warnings_employee ON performance_warnings(employee_id);
CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id);
CREATE INDEX IF NOT EXISTS idx_job_inspections_job ON job_work_inspections(job_id);
`;

const V7_COLUMNS = [
  `ALTER TABLE employees ADD COLUMN cpd_points REAL DEFAULT 0`,
  `ALTER TABLE employees ADD COLUMN cpd_target REAL DEFAULT 20`,
  `ALTER TABLE cpd_logs ADD COLUMN verification_url TEXT`,
];

// Same catalogue as migrate-v7.js — kept in sync so this consolidated
// script produces an identical end state to running v4..v7 individually.
const CPD_PLATFORMS = [
  { name: 'Alison',             url: 'https://alison.com/',                 description: 'Free CPD UK-accredited courses & diplomas, 6,000+ courses. Certificates verified via Learner Achievement Verification link.' },
  { name: 'LinkedIn Learning',  url: 'https://www.linkedin.com/learning/',  description: 'Business, technical and creative courses with certificates.' },
  { name: 'Coursera',           url: 'https://www.coursera.org/',           description: 'University and industry courses, many free to audit.' },
  { name: 'edX',                url: 'https://www.edx.org/',                description: 'University-backed professional and technical courses.' },
  { name: 'Udemy',               url: 'https://www.udemy.com/',              description: 'Practical skills courses across IT, engineering and business.' },
  { name: 'Saylor Academy',      url: 'https://www.saylor.org/',             description: 'Free, fully accredited-pathway courses with free certificates.' },
  { name: 'Google Digital Garage', url: 'https://learndigital.withgoogle.com/digitalgarage', description: 'Free digital skills, marketing and career certificates from Google.' },
  { name: 'FutureLearn',         url: 'https://www.futurelearn.com/',        description: 'University and industry short courses, free to audit.' },
  { name: 'Khan Academy',        url: 'https://www.khanacademy.org/',        description: 'Free courses in maths, science and more, with progress certificates.' },
  { name: 'NEBOSH / IOSH (HSE)', url: 'https://www.nebosh.org.uk/',          description: 'Health & safety qualifications — relevant for HSE/field staff CPD.' },
  { name: 'Kenya Accountants & Secretaries National Examinations Board (KASNEB)', url: 'https://www.kasneb.or.ke/', description: 'CPD points for finance/accounting professionals in Kenya.' },
  { name: 'Engineers Board of Kenya (EBK) CPD Portal', url: 'https://ebkonline.engineersboard.go.ke/', description: 'Mandatory CPD tracking for registered engineers in Kenya.' },
];

async function applySchema(run, label, schema) {
  const statements = schema.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) await run(stmt);
  console.log(`  [${label}] schema applied (${statements.length} statements)`);
}

async function applyColumns(run, label, columns) {
  for (const stmt of columns) {
    const col = stmt.match(/ADD COLUMN (\w+)/)[1];
    try { await run(stmt); console.log(`  [${label}] + column ${col}`); }
    catch (e) { console.log(`  [${label}] · column already exists, skipping (${col})`); }
  }
}

async function migrate() {
  const db = require('../src/lib/db.js');
  const { run, queryOne } = db;
  console.log(`Running consolidated migration v4-v7 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  await applySchema(run, 'v4', V4_SCHEMA);
  console.log('=== v4 (quotes, debit_notes, credit_notes, travel_claims) COMPLETE ===');

  await applySchema(run, 'v5', V5_SCHEMA);
  console.log('=== v5 (sop_documents, sop_document_versions) COMPLETE ===');

  await applySchema(run, 'v6', V6_SCHEMA);
  await applyColumns(run, 'v6', V6_COLUMNS);
  console.log('=== v6 (NAWI cg-18 tables + calibration_certs columns) COMPLETE ===');

  await applySchema(run, 'v7', V7_SCHEMA);
  await applyColumns(run, 'v7', V7_COLUMNS);

  let seeded = 0;
  for (let i = 0; i < CPD_PLATFORMS.length; i++) {
    const p = CPD_PLATFORMS[i];
    const exists = await queryOne('SELECT 1 as found FROM cpd_platforms WHERE name=?', [p.name]);
    if (exists) continue;
    await run(
      `INSERT INTO cpd_platforms (id,name,url,description,is_active,sort_order) VALUES (?,?,?,?,1,?)`,
      [uuid(), p.name, p.url, p.description, i]
    );
    seeded++;
  }
  console.log(`  [v7] seeded ${seeded} CPD platform link(s) (${CPD_PLATFORMS.length - seeded} already present)`);
  console.log('=== v7 (CPD, monthly appraisals, performance warnings, job photos, work inspections) COMPLETE ===');

  console.log('=== CONSOLIDATED MIGRATION v4-v7 COMPLETE ===');
}

migrate().catch(function (e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
