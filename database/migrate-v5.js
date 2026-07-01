// database/migrate-v5.js — Adds the SOP Library tables (sop_documents,
// sop_document_versions) to an already-deployed database. Departmental
// SOPs with full revision history — see TEMPLATE_INTEGRATION.md.
//
// Run: node database/migrate-v5.js
// Safe to re-run — every statement is idempotent (CREATE TABLE IF NOT EXISTS).

const NEW_SCHEMA = `
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

async function migrate() {
  const db = require('../src/lib/db.js');
  const { run } = db;
  console.log(`Running migration v5 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  const statements = NEW_SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await run(stmt);
  }
  console.log(`Schema applied (${statements.length} statements: sop_documents, sop_document_versions + 2 indexes)`);
  console.log('=== MIGRATION V5 COMPLETE ===');
}

migrate().catch(function (e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
