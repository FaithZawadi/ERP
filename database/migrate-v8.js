// database/migrate-v8.js — adds document_templates, the editable-override
// table for the 19 auto-generated business document PDFs (quotes, debit/
// credit notes, LPOs, GRNs, etc). See src/lib/pdf.js generateBusinessDoc()
// and src/app/api/document-templates/route.js.
//
// Run: node database/migrate-v8.js — idempotent, safe to re-run.

const NEW_SCHEMA = `
CREATE TABLE IF NOT EXISTS document_templates (
  doc_type        TEXT PRIMARY KEY,
  title           TEXT,
  footer_note     TEXT,
  terms_text      TEXT,
  sign_labels     TEXT,
  is_active       INTEGER DEFAULT 1,
  updated_by      TEXT REFERENCES employees(id),
  updated_at      TEXT DEFAULT (datetime('now'))
);
`;

async function migrate() {
  const db = require('../src/lib/db.js');
  const { run } = db;
  console.log(`Running migration v8 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);
  const statements = NEW_SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) await run(stmt);
  console.log(`document_templates table created (${statements.length} statement(s)).`);
  console.log('=== MIGRATION V8 COMPLETE ===');
}

migrate().catch(function (e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
