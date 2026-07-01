// database/migrate-v14.js — Real HSE backend.
//
// The HSE module (Incident Register, RAMS Status, PPE Tracker) had no
// backend at all — see src/app/api/hse/route.js for the full story. This
// adds the two tables it needed (hse_incidents, rams_records); PPE
// deliberately reuses the existing items/stock_balances tables (category
// CAT-005) rather than a third, parallel inventory system.
//
// Run: node database/migrate-v14.js — idempotent, safe to re-run.

async function migrate() {
  const db = require('../src/lib/db.js');
  const { run } = db;
  console.log(`Running migration v14 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  console.log('Creating hse_incidents...');
  await run(`
    CREATE TABLE IF NOT EXISTS hse_incidents (
      id           TEXT PRIMARY KEY,
      ref_no       TEXT UNIQUE NOT NULL,
      type         TEXT NOT NULL,
      site         TEXT NOT NULL,
      description  TEXT NOT NULL,
      severity     TEXT DEFAULT 'Low',
      status       TEXT DEFAULT 'open',
      capa         TEXT,
      project_id   TEXT REFERENCES projects(id),
      reported_by  TEXT REFERENCES employees(id),
      closed_at    TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);

  console.log('Creating rams_records...');
  await run(`
    CREATE TABLE IF NOT EXISTS rams_records (
      id           TEXT PRIMARY KEY,
      project_id   TEXT REFERENCES projects(id),
      status       TEXT DEFAULT 'not_filed',
      filed_date   TEXT,
      file_url     TEXT,
      filed_by     TEXT REFERENCES employees(id),
      approved_by  TEXT REFERENCES employees(id),
      notes        TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);

  console.log('');
  console.log('=== MIGRATION v14 COMPLETE ===');
}

migrate().catch(function(e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
