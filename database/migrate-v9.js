// database/migrate-v9.js — Mass Standards calibration results table
// (matching the official QSL_CERT-MASS certificate format) and the
// Weighbridge Preventive Maintenance & Inspection Checklist.
//
// Run: node database/migrate-v9.js — idempotent, safe to re-run.

const NEW_SCHEMA = `
CREATE TABLE IF NOT EXISTS mass_test_items (
  id                TEXT PRIMARY KEY,
  cert_id           TEXT REFERENCES calibration_certs(id),
  item_no           TEXT NOT NULL,
  nominal_mass      TEXT,
  error             TEXT,
  error_limit       TEXT,
  uncertainty       TEXT,
  sort_order        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mass_items_cert ON mass_test_items(cert_id);

CREATE TABLE IF NOT EXISTS weighbridge_inspections (
  id                  TEXT PRIMARY KEY,
  ref_no              TEXT UNIQUE NOT NULL,
  job_id              TEXT REFERENCES calibration_jobs(id),
  client_id           TEXT REFERENCES clients(id),
  site_location       TEXT,
  equipment_model     TEXT,
  serial_no           TEXT,
  capacity            TEXT,
  unit_no             TEXT,
  inspection_date     TEXT NOT NULL,
  next_inspection_due TEXT,
  items               TEXT NOT NULL,
  observations        TEXT,
  corrective_actions  TEXT,
  technician_id       TEXT REFERENCES employees(id),
  technician_sig      TEXT,
  tcml_rep_name       TEXT,
  status              TEXT DEFAULT 'operational',
  created_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_weighbridge_client ON weighbridge_inspections(client_id);
`;

async function migrate() {
  const db = require('../src/lib/db.js');
  const { run } = db;
  console.log(`Running migration v9 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);
  const statements = NEW_SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) await run(stmt);
  console.log(`Schema applied (${statements.length} statements): mass_test_items, weighbridge_inspections + indexes.`);
  console.log('=== MIGRATION V9 COMPLETE ===');
}

migrate().catch(function (e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
