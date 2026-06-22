// database/init.js — QSL ERP Database Initialisation
// Creates all tables for 17 ERP modules + audit trail + integrations

const fs = require('fs');
const path = require('path');

// Use sql.js for in-memory/file SQLite (no native build needed)
const initSQLite = async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  
  let db;
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, 'qsl_erp.db');
  
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    console.log('Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

  const save = () => {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  };

  return { db, save };
};

const SCHEMA = `

-- ═══════════════════════════════════════════════════════════════
-- CORE: USERS, ROLES, AUDIT
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id),
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff',
  mfa_enabled INTEGER DEFAULT 0,
  mfa_secret  TEXT,
  is_active   INTEGER DEFAULT 1,
  last_login  TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS digital_signatures (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  key_id      TEXT UNIQUE NOT NULL,
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  algorithm   TEXT DEFAULT 'RSA-2048',
  is_active   INTEGER DEFAULT 1,
  issued_at   TEXT DEFAULT (datetime('now')),
  revoked_at  TEXT,
  revoked_by  TEXT,
  uses        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  user_name   TEXT,
  action      TEXT NOT NULL,
  module      TEXT NOT NULL,
  record_id   TEXT,
  record_type TEXT,
  old_value   TEXT,
  new_value   TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  sig_used    TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 6: HR & EMPLOYEES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employees (
  id                TEXT PRIMARY KEY,
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
  basic_salary      REAL NOT NULL DEFAULT 0,
  bank_name         TEXT,
  bank_account      TEXT,
  bank_branch       TEXT,
  address           TEXT,
  emergency_contact TEXT,
  emergency_phone   TEXT,
  leave_balance     INTEGER DEFAULT 21,
  l_and_d_hours     REAL DEFAULT 0,
  l_and_d_target    REAL DEFAULT 40,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT REFERENCES employees(id),
  leave_type    TEXT NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  days          INTEGER NOT NULL,
  reason        TEXT,
  status        TEXT DEFAULT 'pending',
  approved_by   TEXT REFERENCES employees(id),
  approved_at   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_scorecards (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT REFERENCES employees(id),
  period          TEXT NOT NULL,
  dimension       TEXT NOT NULL,
  weight          REAL NOT NULL,
  score           REAL,
  target          TEXT,
  notes           TEXT,
  reviewed_by     TEXT REFERENCES employees(id),
  reviewed_at     TEXT,
  increment_blocked INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT REFERENCES employees(id),
  date          TEXT NOT NULL,
  clock_in      TEXT,
  clock_out     TEXT,
  location_lat  REAL,
  location_lng  REAL,
  location_name TEXT,
  hours_worked  REAL,
  is_late       INTEGER DEFAULT 0,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS l_and_d (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT REFERENCES employees(id),
  course_name   TEXT NOT NULL,
  provider      TEXT,
  hours         REAL NOT NULL,
  date          TEXT NOT NULL,
  certificate   TEXT,
  cost          REAL DEFAULT 0,
  approved_by   TEXT REFERENCES employees(id),
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 6: PAYROLL
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payroll_runs (
  id              TEXT PRIMARY KEY,
  period          TEXT UNIQUE NOT NULL,
  status          TEXT DEFAULT 'draft',
  total_gross     REAL DEFAULT 0,
  total_paye      REAL DEFAULT 0,
  total_nhif      REAL DEFAULT 0,
  total_nssf      REAL DEFAULT 0,
  total_housing   REAL DEFAULT 0,
  total_net       REAL DEFAULT 0,
  fm_sig          TEXT,
  fm_signed_at    TEXT,
  cfo_sig         TEXT,
  cfo_signed_at   TEXT,
  md_sig          TEXT,
  md_signed_at    TEXT,
  locked_at       TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id              TEXT PRIMARY KEY,
  run_id          TEXT REFERENCES payroll_runs(id),
  employee_id     TEXT REFERENCES employees(id),
  basic_salary    REAL NOT NULL,
  allowances      REAL DEFAULT 0,
  gross_pay       REAL NOT NULL,
  paye            REAL DEFAULT 0,
  nhif            REAL DEFAULT 0,
  nssf            REAL DEFAULT 0,
  housing_levy    REAL DEFAULT 0,
  imprest_deduct  REAL DEFAULT 0,
  other_deductions REAL DEFAULT 0,
  net_pay         REAL NOT NULL,
  status          TEXT DEFAULT 'pending',
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 3: FINANCE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  type        TEXT NOT NULL,
  parent_id   TEXT REFERENCES chart_of_accounts(id),
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id              TEXT PRIMARY KEY,
  entry_no        TEXT UNIQUE NOT NULL,
  date            TEXT NOT NULL,
  description     TEXT NOT NULL,
  reference       TEXT,
  module          TEXT,
  module_ref      TEXT,
  status          TEXT DEFAULT 'draft',
  prepared_by     TEXT REFERENCES employees(id),
  reviewed_by     TEXT REFERENCES employees(id),
  approved_by     TEXT REFERENCES employees(id),
  approved_sig    TEXT,
  approved_at     TEXT,
  is_reversal     INTEGER DEFAULT 0,
  reversed_by     TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT REFERENCES journal_entries(id),
  account_id  TEXT REFERENCES chart_of_accounts(id),
  description TEXT,
  debit       REAL DEFAULT 0,
  credit      REAL DEFAULT 0,
  dept        TEXT,
  project_id  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imprest (
  id              TEXT PRIMARY KEY,
  ref_no          TEXT UNIQUE NOT NULL,
  employee_id     TEXT REFERENCES employees(id),
  amount          REAL NOT NULL,
  purpose         TEXT NOT NULL,
  date_issued     TEXT NOT NULL,
  due_date        TEXT NOT NULL,
  status          TEXT DEFAULT 'pending',
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TEXT,
  receipt_path    TEXT,
  receipt_verified INTEGER DEFAULT 0,
  amount_accounted REAL DEFAULT 0,
  converted_at    TEXT,
  converted_to_advance INTEGER DEFAULT 0,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  bank        TEXT NOT NULL,
  account_no  TEXT UNIQUE NOT NULL,
  branch      TEXT,
  currency    TEXT DEFAULT 'KES',
  balance     REAL DEFAULT 0,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_vouchers (
  id              TEXT PRIMARY KEY,
  voucher_no      TEXT UNIQUE NOT NULL,
  date            TEXT NOT NULL,
  payee           TEXT NOT NULL,
  payee_type      TEXT,
  amount          REAL NOT NULL,
  currency        TEXT DEFAULT 'KES',
  purpose         TEXT NOT NULL,
  payment_method  TEXT,
  bank_account_id TEXT REFERENCES bank_accounts(id),
  reference       TEXT,
  status          TEXT DEFAULT 'draft',
  auth_level      TEXT DEFAULT 'staff',
  approved_by     TEXT REFERENCES employees(id),
  approved_sig    TEXT,
  approved_at     TEXT,
  module_ref      TEXT,
  withholding_tax REAL DEFAULT 0,
  vat_amount      REAL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 3: TAX MANAGEMENT (KRA)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tax_invoices (
  id              TEXT PRIMARY KEY,
  invoice_no      TEXT UNIQUE NOT NULL,
  etims_cu_no     TEXT,
  etims_receipt_no TEXT,
  client_id       TEXT REFERENCES clients(id),
  client_pin      TEXT,
  company_id      TEXT REFERENCES companies(id), -- whose letterhead/PIN/bank account this invoice is issued under
  date            TEXT NOT NULL,
  due_date        TEXT,
  subtotal        REAL NOT NULL,
  vat_amount      REAL DEFAULT 0,
  vat_rate        REAL DEFAULT 0.16,
  total           REAL NOT NULL,
  status          TEXT DEFAULT 'draft',
  etims_status    TEXT DEFAULT 'pending',
  etims_submitted_at TEXT,
  etims_response  TEXT,
  project_id      TEXT,
  created_by      TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_invoice_lines (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT REFERENCES tax_invoices(id),
  item_id         TEXT REFERENCES items(id),
  description     TEXT NOT NULL,
  quantity        REAL DEFAULT 1,
  unit_price      REAL NOT NULL,
  vat_category    TEXT DEFAULT 'A',
  vat_rate        REAL DEFAULT 0.16,
  amount          REAL NOT NULL,
  vat_amount      REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS paye_returns (
  id              TEXT PRIMARY KEY,
  period          TEXT UNIQUE NOT NULL,
  payroll_run_id  TEXT REFERENCES payroll_runs(id),
  total_gross     REAL DEFAULT 0,
  total_paye      REAL DEFAULT 0,
  status          TEXT DEFAULT 'draft',
  filed_at        TEXT,
  payment_ref     TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vat_returns (
  id              TEXT PRIMARY KEY,
  period          TEXT UNIQUE NOT NULL,
  output_vat      REAL DEFAULT 0,
  input_vat       REAL DEFAULT 0,
  net_vat         REAL DEFAULT 0,
  status          TEXT DEFAULT 'draft',
  filed_at        TEXT,
  payment_ref     TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS statutory_calendar (
  id              TEXT PRIMARY KEY,
  obligation      TEXT NOT NULL,
  description     TEXT,
  due_day         INTEGER,
  frequency       TEXT,
  next_due        TEXT,
  responsible     TEXT REFERENCES employees(id),
  status          TEXT DEFAULT 'pending',
  last_filed      TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 4: PROCUREMENT
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS suppliers (
  id              TEXT PRIMARY KEY,
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
  rating          REAL DEFAULT 0,
  is_approved     INTEGER DEFAULT 0,
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TEXT,
  bank_name       TEXT,
  bank_account    TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id              TEXT PRIMARY KEY,
  pr_no           TEXT UNIQUE NOT NULL,
  description     TEXT NOT NULL,
  department      TEXT NOT NULL,
  requested_by    TEXT REFERENCES employees(id),
  amount          REAL NOT NULL,
  purpose         TEXT NOT NULL,
  supplier_id     TEXT REFERENCES suppliers(id),
  status          TEXT DEFAULT 'draft',
  dept_approved_by TEXT REFERENCES employees(id),
  dept_approved_at TEXT,
  fm_approved_by  TEXT REFERENCES employees(id),
  fm_approved_at  TEXT,
  md_approved_by  TEXT REFERENCES employees(id),
  md_approved_at  TEXT,
  lpo_id          TEXT,
  date            TEXT DEFAULT (date('now')),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lpos (
  id              TEXT PRIMARY KEY,
  lpo_no          TEXT UNIQUE NOT NULL,
  pr_id           TEXT REFERENCES purchase_requisitions(id),
  supplier_id     TEXT REFERENCES suppliers(id),
  date            TEXT NOT NULL,
  delivery_date   TEXT,
  total           REAL NOT NULL,
  vat             REAL DEFAULT 0,
  grand_total     REAL NOT NULL,
  status          TEXT DEFAULT 'issued',
  fm_sig          TEXT,
  md_sig          TEXT,
  delivery_terms  TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lpo_lines (
  id          TEXT PRIMARY KEY,
  lpo_id      TEXT REFERENCES lpos(id),
  item_code   TEXT,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL,
  unit        TEXT,
  unit_price  REAL NOT NULL,
  total       REAL NOT NULL,
  vat_rate    REAL DEFAULT 0.16
);

CREATE TABLE IF NOT EXISTS grns (
  id                TEXT PRIMARY KEY,
  grn_no            TEXT UNIQUE NOT NULL,
  lpo_id            TEXT REFERENCES lpos(id),
  date              TEXT NOT NULL,
  received_by       TEXT REFERENCES employees(id),
  stage1_done       INTEGER DEFAULT 0,
  stage1_signed_at  TEXT,
  stage1_notes      TEXT,
  photo_paths       TEXT,
  stage2_done       INTEGER DEFAULT 0,
  stage2_raised_at  TEXT,
  discrepancies     TEXT,
  status            TEXT DEFAULT 'pending',
  created_at        TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 4A: STORES & INVENTORY
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL,
  category_id     TEXT,
  unit            TEXT DEFAULT 'each',
  reorder_level   INTEGER DEFAULT 0,
  reorder_qty     INTEGER DEFAULT 0,
  unit_cost       REAL DEFAULT 0,
  msp             REAL DEFAULT 0,
  location        TEXT,
  supplier_id     TEXT REFERENCES suppliers(id),
  warranty_months INTEGER DEFAULT 0,
  is_serialised   INTEGER DEFAULT 0,
  is_active       INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id          TEXT PRIMARY KEY,
  item_id     TEXT REFERENCES items(id),
  type        TEXT NOT NULL,
  quantity    REAL NOT NULL,
  balance     REAL NOT NULL,
  reference   TEXT,
  grn_id      TEXT,
  project_id  TEXT,
  date        TEXT DEFAULT (date('now')),
  done_by     TEXT REFERENCES employees(id),
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS serialised_items (
  id            TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES items(id),
  serial_no     TEXT UNIQUE NOT NULL,
  status        TEXT DEFAULT 'in_stock',
  grn_id        TEXT REFERENCES grns(id),
  client_id     TEXT,
  sale_date     TEXT,
  invoice_no    TEXT,
  warranty_from TEXT,
  warranty_to   TEXT,
  assigned_tech TEXT REFERENCES employees(id),
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 5: FIXED ASSETS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assets (
  id              TEXT PRIMARY KEY,
  tag_no          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL,
  serial_no       TEXT,
  purchase_date   TEXT NOT NULL,
  cost            REAL NOT NULL,
  dep_method      TEXT DEFAULT 'straight_line',
  dep_rate        REAL DEFAULT 0.20,
  useful_life     INTEGER DEFAULT 5,
  residual_value  REAL DEFAULT 0,
  nbv             REAL NOT NULL,
  location        TEXT,
  custodian       TEXT REFERENCES employees(id),
  supplier_id     TEXT REFERENCES suppliers(id),
  warranty_to     TEXT,
  insurance_to    TEXT,
  status          TEXT DEFAULT 'in_use',
  disposal_date   TEXT,
  disposal_amount REAL,
  disposal_reason TEXT,
  disposal_sig    TEXT,
  grn_id          TEXT REFERENCES grns(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS depreciation_runs (
  id          TEXT PRIMARY KEY,
  period      TEXT NOT NULL,
  asset_id    TEXT REFERENCES assets(id),
  nbv_before  REAL NOT NULL,
  charge      REAL NOT NULL,
  nbv_after   REAL NOT NULL,
  method      TEXT,
  run_by      TEXT REFERENCES employees(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 7: PROJECTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  ref_no          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  client_id       TEXT REFERENCES clients(id),
  company_id      TEXT REFERENCES companies(id), -- which legal entity this project is contracted under
  contract_value  REAL NOT NULL,
  retention_pct   REAL DEFAULT 0,
  vat_rate        REAL DEFAULT 0.16,
  start_date      TEXT,
  end_date        TEXT,
  status          TEXT DEFAULT 'active',
  pm_id           TEXT REFERENCES employees(id),
  process_owner   TEXT REFERENCES employees(id),
  department      TEXT,
  site            TEXT,
  scope           TEXT,
  budget_total    REAL DEFAULT 0,
  expenses_total  REAL DEFAULT 0,
  invoiced_total  REAL DEFAULT 0,
  collected_total REAL DEFAULT 0,
  budget_blocked  INTEGER DEFAULT 0,
  budget_override_sig TEXT,
  budget_override_by  TEXT REFERENCES employees(id),
  budget_override_at  TEXT,
  handover_done   INTEGER DEFAULT 0,
  rams_uploaded   INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_budgets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES projects(id),
  category    TEXT NOT NULL,
  amount      REAL NOT NULL,
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_expenses (
  id              TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES projects(id),
  date            TEXT NOT NULL,
  description     TEXT NOT NULL,
  category        TEXT NOT NULL,
  amount          REAL NOT NULL,
  supplier        TEXT,
  receipt_path    TEXT,
  receipt_verified INTEGER DEFAULT 0,
  posted_by       TEXT REFERENCES employees(id),
  approved_by     TEXT REFERENCES employees(id),
  approved_sig    TEXT,
  approved_at     TEXT,
  lpo_id          TEXT REFERENCES lpos(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id              TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES projects(id),
  seq             INTEGER,
  description     TEXT NOT NULL,
  planned_date    TEXT,
  actual_date     TEXT,
  value           REAL DEFAULT 0,
  pct_complete    INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'planned',
  updated_by      TEXT REFERENCES employees(id),
  updated_at      TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_project_updates (
  id              TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES projects(id),
  date            TEXT NOT NULL,
  exp_update      TEXT,
  milestone_update TEXT,
  updated_by      TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_subcontractors (
  id              TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES projects(id),
  supplier_id     TEXT REFERENCES suppliers(id),
  scope           TEXT,
  contract_value  REAL DEFAULT 0,
  paid_to_date    REAL DEFAULT 0,
  retention_pct   REAL DEFAULT 0.10,
  rams_uploaded   INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_handover (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES projects(id),
  outgoing_staff      TEXT REFERENCES employees(id),
  outgoing_sig        TEXT,
  outgoing_signed_at  TEXT,
  incoming_person     TEXT,
  incoming_sig        TEXT,
  incoming_signed_at  TEXT,
  dept_head           TEXT REFERENCES employees(id),
  dept_head_sig       TEXT,
  dept_head_signed_at TEXT,
  md_sig              TEXT,
  md_signed_at        TEXT,
  checklist           TEXT,
  completed           INTEGER DEFAULT 0,
  created_at          TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 8: CRM
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS clients (
  id              TEXT PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  company_id      TEXT REFERENCES companies(id), -- which legal entity holds this client relationship
  contact_person  TEXT,
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  kra_pin         TEXT,
  segment         TEXT,
  account_owner   TEXT REFERENCES employees(id),
  introduced_by   TEXT REFERENCES employees(id),
  outstanding     REAL DEFAULT 0,
  credit_limit    REAL DEFAULT 0,
  payment_terms   INTEGER DEFAULT 30,
  status          TEXT DEFAULT 'active',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_transfers (
  id              TEXT PRIMARY KEY,
  client_id       TEXT REFERENCES clients(id),
  from_owner      TEXT REFERENCES employees(id),
  to_owner        TEXT REFERENCES employees(id),
  reason          TEXT NOT NULL,
  doc_path        TEXT,
  cfo_sig         TEXT,
  cfo_signed_at   TEXT,
  md_sig          TEXT,
  md_signed_at    TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Finance Manager's daily end-of-day status entries against each overdue debtor
CREATE TABLE IF NOT EXISTS debtor_followups (
  id              TEXT PRIMARY KEY,
  client_id       TEXT REFERENCES clients(id),
  followup_date   TEXT NOT NULL,
  status          TEXT NOT NULL,
  note            TEXT,
  next_followup_date TEXT,
  recorded_by     TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, followup_date)
);

-- Tracks whether the FM submitted the full EOD report for a given date
CREATE TABLE IF NOT EXISTS eod_debtor_reports (
  id              TEXT PRIMARY KEY,
  report_date     TEXT UNIQUE NOT NULL,
  submitted_by    TEXT REFERENCES employees(id),
  submitted_at    TEXT,
  status          TEXT DEFAULT 'pending',
  reminder_sent_at TEXT,
  escalated_at    TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  ref_no          TEXT UNIQUE NOT NULL,
  company         TEXT NOT NULL,
  contact_name    TEXT,
  email           TEXT,
  phone           TEXT,
  service         TEXT,
  estimated_value REAL DEFAULT 0,
  stage           TEXT DEFAULT 'lead',
  source          TEXT,
  owner           TEXT REFERENCES employees(id),
  won_lost        TEXT,
  won_lost_reason TEXT,
  won_at          TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interactions (
  id          TEXT PRIMARY KEY,
  client_id   TEXT REFERENCES clients(id),
  lead_id     TEXT REFERENCES leads(id),
  type        TEXT NOT NULL,
  date        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  next_action TEXT,
  done_by     TEXT REFERENCES employees(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 11.4: BIDS & PRE-SALES (Stage 2B)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bids (
  id                TEXT PRIMARY KEY,
  ref_no            TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  client            TEXT,
  client_id         TEXT REFERENCES clients(id),
  value             REAL DEFAULT 0,
  stage             TEXT DEFAULT 'stage_1',
  deadline          TEXT,
  owner             TEXT REFERENCES employees(id),
  stage2b_status    TEXT DEFAULT 'pending',
  suitability_score REAL,
  compliance_clear  INTEGER DEFAULT 0,
  stopped           INTEGER DEFAULT 0,
  stopped_reason    TEXT,
  won_lost          TEXT,
  bid_bond_ref      TEXT,
  bid_bond_expiry   TEXT,
  submitted_at      TEXT,
  outcome_date      TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bid_compliance (
  id              TEXT PRIMARY KEY,
  bid_id          TEXT REFERENCES bids(id),
  requirement     TEXT NOT NULL,
  type            TEXT NOT NULL,
  position        TEXT DEFAULT 'PENDING',
  evidence_doc    TEXT,
  notes           TEXT,
  checked_by      TEXT REFERENCES employees(id),
  checked_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 9: FLEET
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vehicles (
  id              TEXT PRIMARY KEY,
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
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trips (
  id              TEXT PRIMARY KEY,
  vehicle_id      TEXT REFERENCES vehicles(id),
  driver_id       TEXT REFERENCES employees(id),
  date            TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  from_location   TEXT,
  to_location     TEXT,
  start_mileage   INTEGER,
  end_mileage     INTEGER,
  distance        INTEGER,
  fuel_litres     REAL DEFAULT 0,
  fuel_cost       REAL DEFAULT 0,
  project_id      TEXT REFERENCES projects(id),
  client_id       TEXT REFERENCES clients(id),
  is_authorised   INTEGER DEFAULT 0,
  authorised_by   TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 10: CALIBRATION
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS calibration_jobs (
  id              TEXT PRIMARY KEY,
  job_no          TEXT UNIQUE NOT NULL,
  client_id       TEXT REFERENCES clients(id),
  site            TEXT,
  instruments     TEXT,
  scheduled_date  TEXT,
  technician_id   TEXT REFERENCES employees(id),
  status          TEXT DEFAULT 'scheduled',
  project_id      TEXT REFERENCES projects(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calibration_certs (
  id              TEXT PRIMARY KEY,
  cert_no         TEXT UNIQUE NOT NULL,
  job_id          TEXT REFERENCES calibration_jobs(id),
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
  temp_c          REAL,
  humidity_pct    REAL,
  technician_id   TEXT REFERENCES employees(id),
  tech_sig        TEXT,
  cert_path       TEXT,
  etims_ref       TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reference_standards (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  make            TEXT,
  model           TEXT,
  serial_no       TEXT,
  traceable_to    TEXT DEFAULT 'KEBS',
  last_cal_date   TEXT,
  next_cal_date   TEXT,
  uncertainty     TEXT,
  status          TEXT DEFAULT 'current',
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 11: COMPLIANCE & GOVERNANCE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_docs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  issuer      TEXT,
  ref_no      TEXT,
  issued_at   TEXT,
  expires_at  TEXT,
  responsible TEXT REFERENCES employees(id),
  doc_path    TEXT,
  status      TEXT DEFAULT 'current',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS policy_docs (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  level       TEXT NOT NULL,
  category    TEXT NOT NULL,
  version     TEXT DEFAULT '1.0',
  owner       TEXT REFERENCES employees(id),
  reviewed_at TEXT,
  next_review TEXT,
  doc_path    TEXT,
  status      TEXT DEFAULT 'current',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS policy_signoffs (
  id          TEXT PRIMARY KEY,
  policy_id   TEXT REFERENCES policy_docs(id),
  employee_id TEXT REFERENCES employees(id),
  signed_at   TEXT,
  sig_key     TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  assignee_id TEXT REFERENCES employees(id),
  due_date    TEXT NOT NULL,
  priority    TEXT DEFAULT 'medium',
  module      TEXT,
  status      TEXT DEFAULT 'pending',
  completed_at TEXT,
  created_by  TEXT REFERENCES employees(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 11.8: INTER-COMPANY
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- COMPANIES — legal entities a project/client/invoice can be filed under
-- ═══════════════════════════════════════════════════════════════
-- This is NOT full multi-tenancy. There is one QSL workforce, one set of
-- equipment, one HR/payroll system — employees, items, vehicles, suppliers
-- are never scoped by company. What changes per company is purely the
-- paper trail: which legal entity's name, KRA PIN, and bank account a
-- given project/client relationship/invoice is filed under. QSL staff
-- always do the actual work; a sister company is sometimes used as the
-- contracting vehicle (e.g. when a client won't contract QSL directly),
-- in which case QSL earns a commission via the existing ic_transactions
-- mechanism (ICSA-gated, 5%/3% minimum fee — see ICM-002/003).
CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,       -- e.g. 'QSL', 'SISTER-A'
  legal_name      TEXT NOT NULL,
  kra_pin         TEXT,
  registered_address TEXT,
  bank_account_id TEXT REFERENCES bank_accounts(id),
  is_primary      INTEGER DEFAULT 0,          -- exactly one company has is_primary=1 (QSL itself)
  related_party_id TEXT REFERENCES related_parties(id), -- links a sister company record here back to its IC commission profile
  status          TEXT DEFAULT 'active',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS related_parties (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  icsa_ref    TEXT,
  icsa_path   TEXT,
  contact     TEXT,
  status      TEXT DEFAULT 'active',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ic_transactions (
  id              TEXT PRIMARY KEY,
  entity_id       TEXT REFERENCES related_parties(id),
  project_id      TEXT REFERENCES projects(id), -- the sister-company project this commission was generated by
  type            TEXT NOT NULL,
  contract_value  REAL DEFAULT 0,
  fee_amount      REAL DEFAULT 0,
  fee_pct         REAL DEFAULT 0,
  min_fee_pct     REAL DEFAULT 0.05,
  collected       REAL DEFAULT 0,
  status          TEXT DEFAULT 'pending',
  icsa_verified   INTEGER DEFAULT 0,
  invoice_ref     TEXT,
  notes           TEXT,
  created_by      TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- INTEGRATION LOGS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS integration_logs (
  id          TEXT PRIMARY KEY,
  service     TEXT NOT NULL,
  direction   TEXT NOT NULL,
  endpoint    TEXT,
  request     TEXT,
  response    TEXT,
  status_code INTEGER,
  success     INTEGER DEFAULT 0,
  error       TEXT,
  ref_id      TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE: FEATURE FLAGS (Modular Architecture — point 5)
-- ═══════════════════════════════════════════════════════════════
-- One codebase; each module can be toggled on/off per deployment.
-- A client buying only "Fleet" + "Finance" simply has the other
-- modules disabled here — no separate builds, no separate schemas.

CREATE TABLE IF NOT EXISTS module_flags (
  module_id     TEXT PRIMARY KEY,
  enabled       INTEGER DEFAULT 1,
  display_name  TEXT NOT NULL,
  description   TEXT,
  is_core       INTEGER DEFAULT 0,   -- core modules (auth, settings) cannot be disabled
  updated_by    TEXT REFERENCES employees(id),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Per-module integration toggles (point 6 — controlled, non-mandatory integration)
-- e.g. source_module='requisitions', target_module='procurement',
-- trigger='requisition_approved', enabled=1 means approved store requisitions
-- with no stock on hand auto-create a PR in Procurement.
CREATE TABLE IF NOT EXISTS module_integrations (
  id              TEXT PRIMARY KEY,
  source_module   TEXT NOT NULL,
  target_module   TEXT NOT NULL,
  trigger_event   TEXT NOT NULL,
  enabled         INTEGER DEFAULT 0,
  config          TEXT,                -- JSON config blob, e.g. {"threshold":0}
  updated_by      TEXT REFERENCES employees(id),
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(source_module, target_module, trigger_event)
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE: STORE MANAGEMENT — Real Inventory Engine (point 1)
-- ═══════════════════════════════════════════════════════════════
-- Extends existing items/stock_movements/serialised_items with:
-- categories, real-time balance snapshots, locations, batch tracking,
-- transfers, and adjustments with reason codes.

CREATE TABLE IF NOT EXISTS item_categories (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES item_categories(id),
  description   TEXT,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_locations (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT DEFAULT 'warehouse',   -- warehouse, site, vehicle, vendor
  address       TEXT,
  custodian     TEXT REFERENCES employees(id),
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Real-time balance per item per location — this is what point 1 means by
-- "maintain real-time inventory balances": a queryable current-state table
-- that is updated transactionally alongside every movement, rather than
-- only being derivable by summing the entire stock_movements history.
CREATE TABLE IF NOT EXISTS stock_balances (
  id            TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES items(id),
  location_id   TEXT REFERENCES store_locations(id),
  batch_no      TEXT,                        -- NULL for non-batch-tracked items
  quantity      REAL NOT NULL DEFAULT 0,
  updated_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id, location_id, batch_no)
);

CREATE TABLE IF NOT EXISTS stock_batches (
  id              TEXT PRIMARY KEY,
  item_id         TEXT REFERENCES items(id),
  batch_no        TEXT NOT NULL,
  manufacture_date TEXT,
  expiry_date     TEXT,
  grn_id          TEXT REFERENCES grns(id),
  supplier_id     TEXT REFERENCES suppliers(id),
  unit_cost       REAL,
  status          TEXT DEFAULT 'active',     -- active, expired, quarantined
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id, batch_no)
);

-- Stock transfers between locations (distinct from receive/issue — point 1
-- explicitly lists "transfers" as a first-class operation)
CREATE TABLE IF NOT EXISTS stock_transfers (
  id              TEXT PRIMARY KEY,
  transfer_no     TEXT UNIQUE NOT NULL,
  item_id         TEXT REFERENCES items(id),
  batch_no        TEXT,
  quantity        REAL NOT NULL,
  from_location_id TEXT REFERENCES store_locations(id),
  to_location_id  TEXT REFERENCES store_locations(id),
  status          TEXT DEFAULT 'pending',     -- pending, in_transit, completed, cancelled
  requested_by    TEXT REFERENCES employees(id),
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TEXT,
  completed_at    TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Stock adjustments (write-offs, damages, stock-count corrections) — kept
-- separate from ordinary issue/receive movements because every adjustment
-- requires a reason code and an approver for audit purposes.
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id              TEXT PRIMARY KEY,
  adjustment_no   TEXT UNIQUE NOT NULL,
  item_id         TEXT REFERENCES items(id),
  location_id     TEXT REFERENCES store_locations(id),
  batch_no        TEXT,
  quantity_before REAL NOT NULL,
  quantity_after  REAL NOT NULL,
  variance        REAL NOT NULL,
  reason_code     TEXT NOT NULL,    -- damage, expiry, theft, count_correction, write_off, other
  notes           TEXT,
  requested_by    TEXT REFERENCES employees(id),
  approved_by     TEXT REFERENCES employees(id),
  approved_at     TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS low_stock_alerts (
  id            TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES items(id),
  location_id   TEXT REFERENCES store_locations(id),
  current_qty   REAL NOT NULL,
  reorder_level REAL NOT NULL,
  status        TEXT DEFAULT 'open',   -- open, acknowledged, resolved
  acknowledged_by TEXT REFERENCES employees(id),
  acknowledged_at TEXT,
  notified_at   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE: STORE REQUISITIONS — internal issuance workflow (point 2)
-- ═══════════════════════════════════════════════════════════════
-- Distinct from purchase_requisitions (which is for buying from suppliers).
-- This is "I need 5 of item X from the store" — has its own approval
-- hierarchy and closes by the store issuing stock against it.

CREATE TABLE IF NOT EXISTS store_requisitions (
  id              TEXT PRIMARY KEY,
  req_no          TEXT UNIQUE NOT NULL,
  requested_by    TEXT REFERENCES employees(id),
  department      TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  project_id      TEXT REFERENCES projects(id),
  priority        TEXT DEFAULT 'normal',   -- normal, urgent
  status          TEXT DEFAULT 'pending_approval',
  -- pending_approval -> approved -> issuing -> closed
  -- pending_approval -> rejected
  current_approver_role TEXT,
  rejected_by     TEXT REFERENCES employees(id),
  rejected_at     TEXT,
  rejection_reason TEXT,
  closed_at       TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_requisition_lines (
  id              TEXT PRIMARY KEY,
  requisition_id  TEXT REFERENCES store_requisitions(id),
  item_id         TEXT REFERENCES items(id),
  quantity_requested REAL NOT NULL,
  quantity_issued REAL DEFAULT 0,
  batch_no        TEXT,
  notes           TEXT
);

-- Every approval step in the requisition's hierarchy — gives the complete
-- audit trail point 2 asks for, beyond what the generic audit_log captures
-- (this is requisition-specific: who approved at which level, when, why).
CREATE TABLE IF NOT EXISTS requisition_approvals (
  id              TEXT PRIMARY KEY,
  requisition_id  TEXT REFERENCES store_requisitions(id),
  level           TEXT NOT NULL,         -- e.g. 'supervisor', 'store_manager', 'fm'
  approver_id     TEXT REFERENCES employees(id),
  decision        TEXT NOT NULL,         -- approved, rejected
  comments        TEXT,
  decided_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE: ADMINISTRATION — RBAC, departments, branches (point 3)
-- ═══════════════════════════════════════════════════════════════
-- Replaces the hard-coded users.role string with a real permission
-- model: roles have named permissions, users hold one or more roles.

CREATE TABLE IF NOT EXISTS roles (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,    -- e.g. 'store_manager'
  name          TEXT NOT NULL,           -- e.g. 'Store Manager'
  description   TEXT,
  is_system     INTEGER DEFAULT 0,       -- system roles (md, admin) cannot be deleted
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,    -- e.g. 'store.issue', 'requisitions.approve'
  module        TEXT NOT NULL,           -- e.g. 'store', 'requisitions', 'fleet'
  description   TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT REFERENCES roles(id),
  permission_id TEXT REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id       TEXT REFERENCES users(id),
  role_id       TEXT REFERENCES roles(id),
  assigned_by   TEXT REFERENCES employees(id),
  assigned_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS departments (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  branch_id     TEXT REFERENCES branches(id),
  head_id       TEXT REFERENCES employees(id),
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id            TEXT PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT,
  city          TEXT,
  country       TEXT DEFAULT 'Kenya',
  manager_id    TEXT REFERENCES employees(id),
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_settings (
  key           TEXT PRIMARY KEY,
  value         TEXT,
  category      TEXT DEFAULT 'general',
  description   TEXT,
  updated_by    TEXT REFERENCES employees(id),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Vehicle maintenance + insurance history (vehicles table already holds
-- the current insurance/service-due snapshot; this is the full log)
CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id              TEXT PRIMARY KEY,
  vehicle_id      TEXT REFERENCES vehicles(id),
  type            TEXT NOT NULL,    -- service, repair, inspection, tyre_change, other
  description     TEXT NOT NULL,
  date            TEXT NOT NULL,
  mileage_at_service INTEGER,
  cost            REAL DEFAULT 0,
  vendor          TEXT,
  next_due_date   TEXT,
  next_due_mileage INTEGER,
  items_consumed  TEXT,              -- JSON array of {item_id, quantity} consumed from store (point 6 integration)
  performed_by    TEXT REFERENCES employees(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_insurance_history (
  id              TEXT PRIMARY KEY,
  vehicle_id      TEXT REFERENCES vehicles(id),
  insurance_co    TEXT NOT NULL,
  policy_no       TEXT,
  cover_type      TEXT,             -- comprehensive, third_party
  premium         REAL,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  doc_path        TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- MODULE 18 — INSPECTION BODY (ISO/IEC 17020:2012)
-- QSL is a Type C inspection body: it both services/calibrates and
-- inspects the same equipment. The whole module exists to enforce
-- impartiality (INS-001), authorisation (REG-01/COI), the WE-form
-- workflow, and the civil-works hold-point gates (WE-07).
-- ═══════════════════════════════════════════════════════════════

-- REG-01: Inspector Authorisation Register. Authorisation is a record
-- against any existing employee (no separate login role) — only QM/MD
-- may add, modify, or revoke (INS-011). Signing rights lapse when
-- renewal_date passes (INS-013).
CREATE TABLE IF NOT EXISTS inspectors (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  scope           TEXT,                      -- e.g. 'weighbridge, pressure, dimensional'
  authorised_by   TEXT REFERENCES employees(id),
  auth_date       TEXT,
  renewal_date    TEXT,                       -- signing rights auto-removed once passed
  status          TEXT DEFAULT 'active',      -- active | suspended | revoked
  created_at      TEXT DEFAULT (datetime('now'))
);

-- REG-02: annual Conflict-of-Interest declaration per inspector.
-- Signing rights are blocked if the current declaration is overdue
-- by more than 7 days (INS-002).
CREATE TABLE IF NOT EXISTS inspector_coi (
  id              TEXT PRIMARY KEY,
  inspector_id    TEXT NOT NULL REFERENCES inspectors(id),
  declared_at     TEXT NOT NULL,
  expires_at      TEXT NOT NULL,              -- declared_at + 1 year
  conflicts_text  TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Master inspection record (the job/cycle). repair_by holds the staff
-- member who performed/signed the WE-02 repair on the same equipment —
-- INS-001 blocks that same person from signing the WE-01 ruling.
CREATE TABLE IF NOT EXISTS inspections (
  id              TEXT PRIMARY KEY,
  ins_no          TEXT UNIQUE NOT NULL,
  type            TEXT NOT NULL,              -- pre | post_service | surveillance | commissioning | civil_works
  equipment_serial TEXT,
  serialised_item_id TEXT REFERENCES serialised_items(id),
  job_id          TEXT REFERENCES calibration_jobs(id),
  client_id       TEXT REFERENCES clients(id),
  project_id      TEXT REFERENCES projects(id),
  inspector_id    TEXT REFERENCES inspectors(id),
  repair_by       TEXT REFERENCES employees(id),   -- WE-02 repair signer (impartiality check)
  ruling          TEXT DEFAULT 'pending',     -- pending | PASS | FAIL
  status          TEXT DEFAULT 'open',        -- open | ruled | quarantined | closed
  scheduled_date  TEXT,
  ruled_at        TEXT,
  signed_sig      TEXT,                        -- RSA approval JSON of the ruling
  created_at      TEXT DEFAULT (datetime('now'))
);

-- WE-01/05/07/08/09 form instances tied to an inspection. data holds
-- the form-specific payload as JSON so one table serves every WE form.
CREATE TABLE IF NOT EXISTS inspection_forms (
  id              TEXT PRIMARY KEY,
  inspection_id   TEXT NOT NULL REFERENCES inspections(id),
  form_code       TEXT NOT NULL,              -- WE-01 | WE-05 | WE-07 | WE-08 | WE-09
  data            TEXT,                        -- JSON payload
  result          TEXT,                        -- PASS | FAIL | n/a
  signed_by       TEXT REFERENCES employees(id),
  sig             TEXT,                        -- inspector RSA approval JSON
  qm_sig          TEXT,                        -- QM RSA approval JSON where dual sign-off required
  created_at      TEXT DEFAULT (datetime('now'))
);

-- WE-07 civil-works progressive inspection: 5 mandatory hold-points
-- (HP-1..HP-5). HP-5 needs dual sign-off (inspector + QM); clearing
-- HP-5 is what unlocks WE-08 (INS-036/039/044).
CREATE TABLE IF NOT EXISTS civil_works_holdpoints (
  id              TEXT PRIMARY KEY,
  inspection_id   TEXT NOT NULL REFERENCES inspections(id),
  hp_no           INTEGER NOT NULL,           -- 1..5
  description     TEXT,
  status          TEXT DEFAULT 'pending',     -- pending | cleared
  inspector_sig   TEXT,
  qm_sig          TEXT,                        -- required on HP-5 only
  cleared_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- WE-04 NCR auto-raised on a FAIL ruling; quarantines the equipment
-- and blocks calibration-certificate issuance (INS-023).
CREATE TABLE IF NOT EXISTS inspection_ncrs (
  id              TEXT PRIMARY KEY,
  inspection_id   TEXT NOT NULL REFERENCES inspections(id),
  equipment_serial TEXT,
  raised_by       TEXT REFERENCES employees(id),
  status          TEXT DEFAULT 'open',        -- open | resolved
  resolution      TEXT,
  resolved_at     TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Inspection appeals — must be assigned to a different inspector than
-- the original ruling, decided within 10 business days (INS-062).
CREATE TABLE IF NOT EXISTS inspection_appeals (
  id                 TEXT PRIMARY KEY,
  inspection_id      TEXT NOT NULL REFERENCES inspections(id),
  original_inspector TEXT REFERENCES inspectors(id),
  assigned_inspector TEXT REFERENCES inspectors(id),
  grounds            TEXT,
  decision           TEXT,
  due_date           TEXT,                     -- raised + 10 business days
  status             TEXT DEFAULT 'open',      -- open | decided
  decided_at         TEXT,
  created_at         TEXT DEFAULT (datetime('now'))
);


-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(account_owner);
CREATE INDEX IF NOT EXISTS idx_imprest_employee ON imprest(employee_id);
CREATE INDEX IF NOT EXISTS idx_imprest_status ON imprest(status);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON tax_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_etims ON tax_invoices(etims_status);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_bids_stage ON bids(stage);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_serial ON inspections(equipment_serial);
CREATE INDEX IF NOT EXISTS idx_inspectors_employee ON inspectors(employee_id);
CREATE INDEX IF NOT EXISTS idx_holdpoints_inspection ON civil_works_holdpoints(inspection_id);
`;

async function main() {
  try {
    const { db, save } = await initSQLite();
    
    // Run schema
    db.run(SCHEMA);
    save();
    
    console.log('✅ Database initialised successfully');
    console.log('   Tables created for all 17 ERP modules');
    console.log('   Run: node database/seed.js to add sample data');
    
    db.close();
  } catch (err) {
    console.error('❌ Database init failed:', err.message);
    process.exit(1);
  }
}

main();

module.exports = { SCHEMA };
