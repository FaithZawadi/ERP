// database/migrate-v4.js — Adds Quotes, Debit Notes, Credit Notes and Travel
// Claims tables to an already-deployed database, as part of the QSL document
// template integration (see TEMPLATE_INTEGRATION.md). These four document
// types had no backing table before this migration — Statement of Account
// needed none (it's derived from existing tax_invoices), and every other
// document type from the template set already had a home table.
//
// Run: node database/migrate-v4.js
// Safe to re-run — every statement is idempotent (CREATE TABLE IF NOT EXISTS).
// Works against whichever backend is active (sql.js or PostgreSQL), same as
// migrate-v3.js, by going through src/lib/db.js's query()/run().

const NEW_SCHEMA = `
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

async function migrate() {
  const db = require('../src/lib/db.js');
  const { run } = db;
  console.log(`Running migration v4 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  const statements = NEW_SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await run(stmt);
  }
  console.log(`Schema applied (${statements.length} statements: quotes, quote_lines, debit_notes, credit_notes, travel_claims, travel_claim_lines + 4 indexes)`);
  console.log('=== MIGRATION V4 COMPLETE ===');
}

migrate().catch(function (e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
