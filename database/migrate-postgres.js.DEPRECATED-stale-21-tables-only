// database/migrate-postgres.js
// Migrates QSL ERP from SQLite (sql.js) to PostgreSQL
// Run: node database/migrate-postgres.js
// Requires: DATABASE_URL env var pointing to PostgreSQL

require('dotenv').config({ path: '.env.local' });
const fs   = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set in .env.local');
  process.exit(1);
}

// ── PostgreSQL-compatible schema ──────────────────────────────────────────────
// Converts SQLite syntax to PostgreSQL:
//   TEXT PRIMARY KEY         → UUID PRIMARY KEY DEFAULT gen_random_uuid()
//   INTEGER DEFAULT 0        → INTEGER DEFAULT 0
//   datetime('now')          → CURRENT_TIMESTAMP
//   date('now')              → CURRENT_DATE
//   REAL                     → NUMERIC(15,2)

const PG_SCHEMA = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── EMPLOYEES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  emp_no            TEXT UNIQUE NOT NULL,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  email             TEXT UNIQUE NOT NULL,
  phone             TEXT,
  id_number         TEXT UNIQUE,
  kra_pin           TEXT,
  nhif_no           TEXT,
  nssf_no           TEXT,
  department        TEXT NOT NULL,
  role              TEXT NOT NULL,
  grade             TEXT,
  reporting_to      TEXT REFERENCES employees(id),
  employment_type   TEXT DEFAULT 'permanent',
  date_joined       TEXT NOT NULL,
  date_left         TEXT,
  status            TEXT DEFAULT 'active',
  basic_salary      NUMERIC(15,2) NOT NULL DEFAULT 0,
  bank_name         TEXT,
  bank_account      TEXT,
  bank_branch       TEXT,
  address           TEXT,
  emergency_contact TEXT,
  emergency_phone   TEXT,
  leave_balance     INTEGER DEFAULT 21,
  l_and_d_hours     NUMERIC(10,2) DEFAULT 0,
  l_and_d_target    NUMERIC(10,2) DEFAULT 40,
  created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  employee_id TEXT REFERENCES employees(id),
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff',
  mfa_enabled BOOLEAN DEFAULT false,
  mfa_secret  TEXT,
  is_active   BOOLEAN DEFAULT true,
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS digital_signatures (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT REFERENCES users(id),
  key_id      TEXT UNIQUE NOT NULL,
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  algorithm   TEXT DEFAULT 'RSA-2048',
  is_active   BOOLEAN DEFAULT true,
  issued_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  revoked_at  TIMESTAMPTZ,
  revoked_by  TEXT,
  uses        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT,
  user_name   TEXT,
  action      TEXT NOT NULL,
  module      TEXT NOT NULL,
  record_id   TEXT,
  record_type TEXT,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  sig_used    TEXT,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_module    ON audit_log(module);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at);

-- ── CLIENTS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  contact_person  TEXT,
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  kra_pin         TEXT,
  segment         TEXT,
  account_owner   TEXT REFERENCES employees(id),
  introduced_by   TEXT REFERENCES employees(id),
  outstanding     NUMERIC(15,2) DEFAULT 0,
  credit_limit    NUMERIC(15,2) DEFAULT 0,
  payment_terms   INTEGER DEFAULT 30,
  status          TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── PROJECTS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ref_no          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  client_id       TEXT REFERENCES clients(id),
  contract_value  NUMERIC(15,2) NOT NULL,
  retention_pct   NUMERIC(5,2) DEFAULT 0,
  vat_rate        NUMERIC(5,4) DEFAULT 0.16,
  start_date      TEXT,
  end_date        TEXT,
  status          TEXT DEFAULT 'active',
  pm_id           TEXT REFERENCES employees(id),
  process_owner   TEXT REFERENCES employees(id),
  department      TEXT,
  site            TEXT,
  scope           TEXT,
  budget_total    NUMERIC(15,2) DEFAULT 0,
  expenses_total  NUMERIC(15,2) DEFAULT 0,
  invoiced_total  NUMERIC(15,2) DEFAULT 0,
  collected_total NUMERIC(15,2) DEFAULT 0,
  budget_blocked  BOOLEAN DEFAULT false,
  budget_override_sig  TEXT,
  budget_override_by   TEXT REFERENCES employees(id),
  budget_override_at   TIMESTAMPTZ,
  handover_done   BOOLEAN DEFAULT false,
  rams_uploaded   BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── TAX INVOICES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_invoices (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_no      TEXT UNIQUE NOT NULL,
  etims_cu_no     TEXT,
  etims_receipt_no TEXT,
  client_id       TEXT REFERENCES clients(id),
  client_pin      TEXT,
  date            TEXT NOT NULL,
  due_date        TEXT,
  subtotal        NUMERIC(15,2) NOT NULL,
  vat_amount      NUMERIC(15,2) DEFAULT 0,
  vat_rate        NUMERIC(5,4) DEFAULT 0.16,
  total           NUMERIC(15,2) NOT NULL,
  status          TEXT DEFAULT 'draft',
  etims_status    TEXT DEFAULT 'pending',
  etims_submitted_at TIMESTAMPTZ,
  etims_response  JSONB,
  project_id      TEXT,
  created_by      TEXT REFERENCES employees(id),
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── PAYROLL ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_runs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  period          TEXT UNIQUE NOT NULL,
  status          TEXT DEFAULT 'draft',
  total_gross     NUMERIC(15,2) DEFAULT 0,
  total_paye      NUMERIC(15,2) DEFAULT 0,
  total_nhif      NUMERIC(15,2) DEFAULT 0,
  total_nssf      NUMERIC(15,2) DEFAULT 0,
  total_housing   NUMERIC(15,2) DEFAULT 0,
  total_net       NUMERIC(15,2) DEFAULT 0,
  fm_sig          TEXT,
  fm_signed_at    TIMESTAMPTZ,
  cfo_sig         TEXT,
  cfo_signed_at   TIMESTAMPTZ,
  md_sig          TEXT,
  md_signed_at    TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id          TEXT REFERENCES payroll_runs(id),
  employee_id     TEXT REFERENCES employees(id),
  basic_salary    NUMERIC(15,2) NOT NULL,
  allowances      NUMERIC(15,2) DEFAULT 0,
  gross_pay       NUMERIC(15,2) NOT NULL,
  paye            NUMERIC(15,2) DEFAULT 0,
  nhif            NUMERIC(15,2) DEFAULT 0,
  nssf            NUMERIC(15,2) DEFAULT 0,
  housing_levy    NUMERIC(15,2) DEFAULT 0,
  imprest_deduct  NUMERIC(15,2) DEFAULT 0,
  other_deductions NUMERIC(15,2) DEFAULT 0,
  net_pay         NUMERIC(15,2) NOT NULL,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── IMPREST ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS imprest (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ref_no          TEXT UNIQUE NOT NULL,
  employee_id     TEXT REFERENCES employees(id),
  amount          NUMERIC(15,2) NOT NULL,
  purpose         TEXT NOT NULL,
  date_issued     TEXT NOT NULL,
  due_date        TEXT NOT NULL,
  status          TEXT DEFAULT 'pending',
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TIMESTAMPTZ,
  receipt_path    TEXT,
  receipt_verified BOOLEAN DEFAULT false,
  amount_accounted NUMERIC(15,2) DEFAULT 0,
  converted_at    TIMESTAMPTZ,
  converted_to_advance BOOLEAN DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── SUPPLIERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT,
  contact_person  TEXT,
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  kra_pin         TEXT,
  payment_terms   INTEGER DEFAULT 30,
  currency        TEXT DEFAULT 'KES',
  rating          NUMERIC(3,2) DEFAULT 0,
  is_approved     BOOLEAN DEFAULT false,
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TIMESTAMPTZ,
  bank_name       TEXT,
  bank_account    TEXT,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── PURCHASE REQUISITIONS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pr_no           TEXT UNIQUE NOT NULL,
  description     TEXT NOT NULL,
  department      TEXT NOT NULL,
  requested_by    TEXT REFERENCES employees(id),
  amount          NUMERIC(15,2) NOT NULL,
  purpose         TEXT NOT NULL,
  supplier_id     TEXT REFERENCES suppliers(id),
  status          TEXT DEFAULT 'draft',
  dept_approved_by TEXT REFERENCES employees(id),
  dept_approved_at TIMESTAMPTZ,
  fm_approved_by  TEXT REFERENCES employees(id),
  fm_approved_at  TIMESTAMPTZ,
  md_approved_by  TEXT REFERENCES employees(id),
  md_approved_at  TIMESTAMPTZ,
  lpo_id          TEXT,
  date            DATE DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── ASSETS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tag_no          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL,
  serial_no       TEXT,
  purchase_date   TEXT NOT NULL,
  cost            NUMERIC(15,2) NOT NULL,
  dep_method      TEXT DEFAULT 'straight_line',
  dep_rate        NUMERIC(5,4) DEFAULT 0.20,
  useful_life     INTEGER DEFAULT 5,
  residual_value  NUMERIC(15,2) DEFAULT 0,
  nbv             NUMERIC(15,2) NOT NULL,
  location        TEXT,
  custodian       TEXT REFERENCES employees(id),
  supplier_id     TEXT REFERENCES suppliers(id),
  warranty_to     TEXT,
  insurance_to    TEXT,
  status          TEXT DEFAULT 'in_use',
  disposal_date   TEXT,
  disposal_amount NUMERIC(15,2),
  disposal_reason TEXT,
  disposal_sig    TEXT,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── VEHICLES ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reg_no          TEXT UNIQUE NOT NULL,
  make            TEXT,
  model           TEXT,
  year            INTEGER,
  class           TEXT DEFAULT 'C',
  color           TEXT,
  chassis_no      TEXT,
  engine_no       TEXT,
  fuel_type       TEXT DEFAULT 'diesel',
  assigned_driver TEXT REFERENCES employees(id),
  insurance_co    TEXT,
  insurance_policy TEXT,
  insurance_from  TEXT,
  insurance_to    TEXT,
  inspection_to   TEXT,
  service_due     TEXT,
  mileage         INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active',
  gps_unit_id     TEXT,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── COMPLIANCE ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_docs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  issuer      TEXT,
  ref_no      TEXT,
  issued_at   TEXT,
  expires_at  TEXT,
  responsible TEXT REFERENCES employees(id),
  doc_path    TEXT,
  status      TEXT DEFAULT 'current',
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title       TEXT NOT NULL,
  description TEXT,
  assignee_id TEXT REFERENCES employees(id),
  due_date    TEXT NOT NULL,
  priority    TEXT DEFAULT 'medium',
  module      TEXT,
  status      TEXT DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  created_by  TEXT REFERENCES employees(id),
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bids (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ref_no            TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  client            TEXT,
  client_id         TEXT REFERENCES clients(id),
  value             NUMERIC(15,2) DEFAULT 0,
  stage             TEXT DEFAULT 'stage_1',
  deadline          TEXT,
  owner             TEXT REFERENCES employees(id),
  stage2b_status    TEXT DEFAULT 'pending',
  suitability_score NUMERIC(5,2),
  compliance_clear  BOOLEAN DEFAULT false,
  stopped           BOOLEAN DEFAULT false,
  stopped_reason    TEXT,
  won_lost          TEXT,
  submitted_at      TIMESTAMPTZ,
  outcome_date      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bid_compliance (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  bid_id          TEXT REFERENCES bids(id),
  requirement     TEXT NOT NULL,
  type            TEXT NOT NULL,
  position        TEXT DEFAULT 'PENDING',
  evidence_doc    TEXT,
  notes           TEXT,
  checked_by      TEXT REFERENCES employees(id),
  checked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calibration_certs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cert_no         TEXT UNIQUE NOT NULL,
  job_id          TEXT,
  client_id       TEXT REFERENCES clients(id),
  instrument      TEXT NOT NULL,
  make            TEXT,
  model           TEXT,
  serial_no       TEXT,
  range           TEXT,
  uncertainty     TEXT,
  ref_standard_id TEXT,
  calibrated_at   TEXT NOT NULL,
  next_cal_date   TEXT,
  result          TEXT DEFAULT 'pass',
  temp_c          NUMERIC(5,1),
  humidity_pct    NUMERIC(5,1),
  technician_id   TEXT REFERENCES employees(id),
  tech_sig        JSONB,
  cert_path       TEXT,
  etims_ref       TEXT,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reference_standards (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT NOT NULL,
  make            TEXT,
  model           TEXT,
  serial_no       TEXT,
  traceable_to    TEXT DEFAULT 'KEBS',
  last_cal_date   TEXT,
  next_cal_date   TEXT,
  uncertainty     TEXT,
  status          TEXT DEFAULT 'current',
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS integration_logs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  service     TEXT NOT NULL,
  direction   TEXT NOT NULL,
  endpoint    TEXT,
  request     JSONB,
  response    JSONB,
  status_code INTEGER,
  success     BOOLEAN DEFAULT false,
  error       TEXT,
  ref_id      TEXT,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employees_dept    ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_status  ON employees(status);
CREATE INDEX IF NOT EXISTS idx_projects_status   ON projects(status);
CREATE INDEX IF NOT EXISTS idx_clients_owner     ON clients(account_owner);
CREATE INDEX IF NOT EXISTS idx_imprest_employee  ON imprest(employee_id);
CREATE INDEX IF NOT EXISTS idx_imprest_status    ON imprest(status);
CREATE INDEX IF NOT EXISTS idx_invoices_client   ON tax_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_etims    ON tax_invoices(etims_status);
CREATE INDEX IF NOT EXISTS idx_bids_stage        ON bids(stage);
`;

async function migrate() {
  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected');

    console.log('Creating schema...');
    await client.query(PG_SCHEMA);
    console.log('✅ PostgreSQL schema created');

    // Optional: migrate data from SQLite
    const sqliteExists = require('fs').existsSync('./database/qsl_erp.db');
    if (sqliteExists) {
      console.log('SQLite database found. To migrate data, use pg_loader or export/import CSVs.');
      console.log('Or re-run: node database/seed.js (after updating db.js to use PostgreSQL)');
    }

    console.log('\n✅ PostgreSQL migration complete!');
    console.log('\nNext step: Update src/lib/db.js to use PostgreSQL:');
    console.log('  Replace sql.js code with the pg client (see README.md)');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
