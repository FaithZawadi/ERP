// database/migrate-v6.js — EURAMET Calibration Guide No. 18 compliance for
// NAWI (Non-Automatic Weighing Instrument) certificates.
//
// Adds: nawi_test_points, nawi_repeatability_readings, nawi_eccentricity_readings
// (raw test data per certificate — error-of-indication test loads, the
// eccentricity test, and the repeatability readings cg-18 §8.3 requires),
// plus new columns on calibration_certs (instrument_type, temp_c_end,
// humidity_pct_end, min_weight, repeatability_stdev, checked_at).
//
// Run: node database/migrate-v6.js
// Safe to re-run — CREATE TABLE IF NOT EXISTS is idempotent, and the ALTER
// TABLE column additions are wrapped so re-running just skips columns that
// already exist.

const NEW_SCHEMA = `
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

const NEW_COLUMNS = [
  `ALTER TABLE calibration_certs ADD COLUMN checked_by TEXT REFERENCES employees(id)`,
  `ALTER TABLE calibration_certs ADD COLUMN checked_sig TEXT`,
  `ALTER TABLE calibration_certs ADD COLUMN instrument_type TEXT DEFAULT 'general'`,
  `ALTER TABLE calibration_certs ADD COLUMN temp_c_end REAL`,
  `ALTER TABLE calibration_certs ADD COLUMN humidity_pct_end REAL`,
  `ALTER TABLE calibration_certs ADD COLUMN min_weight TEXT`,
  `ALTER TABLE calibration_certs ADD COLUMN repeatability_stdev REAL`,
  `ALTER TABLE calibration_certs ADD COLUMN checked_at TEXT`,
];

async function migrate() {
  const db = require('../src/lib/db.js');
  const { run } = db;
  console.log(`Running migration v6 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  const statements = NEW_SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) await run(stmt);
  console.log(`New tables created (${statements.length} statements).`);

  for (const stmt of NEW_COLUMNS) {
    try { await run(stmt); console.log('  + ' + stmt.match(/ADD COLUMN (\w+)/)[1]); }
    catch (e) { console.log('  · column already exists, skipping (' + stmt.match(/ADD COLUMN (\w+)/)[1] + ')'); }
  }

  console.log('=== MIGRATION V6 COMPLETE ===');
}

migrate().catch(function (e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
