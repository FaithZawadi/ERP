// database/migrate-v7.js — CPD tracking, monthly self-appraisal with
// manager/HR review and performance-warning escalation, technician job
// photo evidence (GPS + timestamp), and ISO/IEC 17020 mandatory pre-work /
// post-work inspection checklists for field jobs.
//
// Run: node database/migrate-v7.js
// Safe to re-run — CREATE TABLE IF NOT EXISTS / ALTER TABLE column adds are
// idempotent (existing-column errors are caught and skipped).

const { v4: uuid } = require('uuid');

const NEW_SCHEMA = `
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

const NEW_COLUMNS = [
  `ALTER TABLE employees ADD COLUMN cpd_points REAL DEFAULT 0`,
  `ALTER TABLE employees ADD COLUMN cpd_target REAL DEFAULT 20`,
  `ALTER TABLE cpd_logs ADD COLUMN verification_url TEXT`,
];

// Real, well-known CPD/online-learning platforms — generic catalogue an
// admin can edit/add to later (Settings already supports custom links per
// company need; this is just a sensible default so the list isn't empty).
// NOTE on APIs: none of these expose a free public API for pulling
// individual completion data into a third-party system. Alison's "API"
// (https://alison.com/corporate-services/alison-api) is part of their paid
// Alison for Business tier (from $99/month) and requires a contract + API
// credentials with them directly — there's no free integration path. The
// practical mechanism here is the verification_url field on cpd_logs:
// every platform below issues a public verification link/code on
// completion (Alison's "Learner Achievement Verification", Coursera's
// "Verify Certificate" link, etc.) which HR/manager can click to confirm
// authenticity without needing API access.
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

async function migrate() {
  const db = require('../src/lib/db.js');
  const { run, query, queryOne } = db;
  console.log(`Running migration v7 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  const statements = NEW_SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) await run(stmt);
  console.log(`New tables created (${statements.length} statements).`);

  for (const stmt of NEW_COLUMNS) {
    try { await run(stmt); console.log('  + ' + stmt.match(/ADD COLUMN (\w+)/)[1]); }
    catch (e) { console.log('  · column already exists, skipping (' + stmt.match(/ADD COLUMN (\w+)/)[1] + ')'); }
  }

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
  console.log(`Seeded ${seeded} CPD platform link(s) (${CPD_PLATFORMS.length - seeded} already present).`);

  console.log('=== MIGRATION V7 COMPLETE ===');
}

migrate().catch(function (e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
