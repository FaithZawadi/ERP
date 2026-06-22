// database/seed.js — QSL ERP Sample Data Seeder
//
// Works against whichever backend is active (sql.js or PostgreSQL,
// selected automatically by src/lib/db.js based on DATABASE_URL) since
// this goes through that module's query()/run() rather than talking to
// sql.js directly. The original version of this script connected to
// sql.js directly and would silently do nothing useful against Postgres
// even with DATABASE_URL set, since it bypassed db.js's backend selection
// entirely — that gap is what this rewrite closes.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');

async function main() {
  const db = require('../src/lib/db.js');
  const run = (sql, params = []) => db.run(sql, params);

  console.log(`Seeding QSL ERP database (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  // ── EMPLOYEES ────────────────────────────────────────────────────────────────
  const employees = [
    { id: uuid(), emp_no: 'QSL-001', first_name: 'Henry', last_name: 'Adar',    email: 'hadar@qalibrated.co.ke',     department: 'Executive',   role: 'Managing Director',        basic_salary: 450000, date_joined: '2018-01-15', l_and_d_hours: 38 },
    { id: uuid(), emp_no: 'QSL-002', first_name: 'Sarah', last_name: 'Kamau',   email: 'skamau@qalibrated.co.ke',    department: 'Finance',     role: 'Finance Manager',          basic_salary: 280000, date_joined: '2020-03-01', l_and_d_hours: 42 },
    { id: uuid(), emp_no: 'QSL-003', first_name: 'James', last_name: 'Otieno',  email: 'jotieno@qalibrated.co.ke',   department: 'Projects',    role: 'Project Manager',          basic_salary: 260000, date_joined: '2019-06-15', l_and_d_hours: 35 },
    { id: uuid(), emp_no: 'QSL-004', first_name: 'Grace', last_name: 'Wanjiku', email: 'gwanjiku@qalibrated.co.ke',  department: 'HR',          role: 'HR Manager',               basic_salary: 220000, date_joined: '2021-01-10', l_and_d_hours: 45 },
    { id: uuid(), emp_no: 'QSL-005', first_name: 'David', last_name: 'Mwangi',  email: 'dmwangi@qalibrated.co.ke',   department: 'Engineering', role: 'Senior Engineer',          basic_salary: 240000, date_joined: '2020-08-01', l_and_d_hours: 28 },
    { id: uuid(), emp_no: 'QSL-006', first_name: 'Faith', last_name: 'Njeri',   email: 'fnjeri@qalibrated.co.ke',    department: 'BD',          role: 'Sales Engineer',           basic_salary: 200000, date_joined: '2022-02-14', l_and_d_hours: 22 },
    { id: uuid(), emp_no: 'QSL-007', first_name: 'Paul',  last_name: 'Ochieng', email: 'pochieng@qalibrated.co.ke',  department: 'ICT',         role: 'ICT Head',                 basic_salary: 230000, date_joined: '2021-07-01', l_and_d_hours: 40 },
    { id: uuid(), emp_no: 'QSL-008', first_name: 'Mary',  last_name: 'Akinyi',  email: 'makinyi@qalibrated.co.ke',   department: 'Finance',     role: 'Accountant',               basic_salary: 160000, date_joined: '2023-01-05', l_and_d_hours: 15 },
  ];

  for (const e of employees) {
    try {
      // ON CONFLICT (email) — employees also has UNIQUE on emp_no/id_number,
      // but email is the column every later seed step looks records up by,
      // so it's the most meaningful conflict target here.
      await run(
        `INSERT INTO employees (id,emp_no,first_name,last_name,email,department,role,basic_salary,date_joined,status,l_and_d_hours,l_and_d_target,leave_balance)
         VALUES (?,?,?,?,?,?,?,?,?,'active',?,40,21) ON CONFLICT (email) DO NOTHING`,
        [e.id, e.emp_no, e.first_name, e.last_name, e.email, e.department, e.role, e.basic_salary, e.date_joined, e.l_and_d_hours]
      );
    } catch (err) { console.warn('  employee skip:', e.email, err.message); }
  }

  // ── USERS + DIGITAL SIGNATURES ────────────────────────────────────────────────
  const roleMap = { 'Managing Director': 'md', 'Finance Manager': 'cfo', 'HR Manager': 'hr_manager', 'ICT Head': 'admin' };
  const defaultRole = (role) => roleMap[role] || 'staff';
  const hashed = bcrypt.hashSync('QSL@2026!', 12);

  for (const e of employees) {
    const userId  = uuid();
    const initials = `${e.first_name[0]}${e.last_name[0]}`;
    const keyId   = `QSL-DS-${initials.toUpperCase()}-2024`;

    // Generate real RSA key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    try {
      await run(`INSERT INTO users (id,employee_id,email,password,role) VALUES (?,?,?,?,?) ON CONFLICT (email) DO NOTHING`,
        [userId, e.id, e.email, hashed, defaultRole(e.role)]);
      await run(`INSERT INTO digital_signatures (id,user_id,key_id,public_key,private_key,algorithm) VALUES (?,?,?,?,?,'RSA-2048') ON CONFLICT (key_id) DO NOTHING`,
        [uuid(), userId, keyId, publicKey, privateKey]);
    } catch (err) { console.warn('  user/signature skip:', e.email, err.message); }
  }

  // ── CHART OF ACCOUNTS ─────────────────────────────────────────────────────────
  const accounts = [
    { id: uuid(), code: '1100', name: 'Cash & Bank',                 category: 'Asset',     type: 'current_asset' },
    { id: uuid(), code: '1200', name: 'Trade Receivables',           category: 'Asset',     type: 'current_asset' },
    { id: uuid(), code: '1300', name: 'Inventory',                   category: 'Asset',     type: 'current_asset' },
    { id: uuid(), code: '1500', name: 'Fixed Assets',                category: 'Asset',     type: 'non_current_asset' },
    { id: uuid(), code: '2100', name: 'Trade Payables',              category: 'Liability', type: 'current_liability' },
    { id: uuid(), code: '2200', name: 'Tax Liabilities (VAT/PAYE)',  category: 'Liability', type: 'current_liability' },
    { id: uuid(), code: '3000', name: 'Retained Earnings',           category: 'Equity',    type: 'equity' },
    { id: uuid(), code: '4000', name: 'Revenue — Calibration',       category: 'Income',    type: 'revenue' },
    { id: uuid(), code: '4001', name: 'Revenue — Engineering',       category: 'Income',    type: 'revenue' },
    { id: uuid(), code: '4002', name: 'Revenue — Equipment Supply',  category: 'Income',    type: 'revenue' },
    { id: uuid(), code: '5000', name: 'Direct Labour',               category: 'Expense',   type: 'cogs' },
    { id: uuid(), code: '5001', name: 'Materials & Consumables',     category: 'Expense',   type: 'cogs' },
    { id: uuid(), code: '5002', name: 'Subcontractors',              category: 'Expense',   type: 'cogs' },
    { id: uuid(), code: '6000', name: 'Staff Salaries',              category: 'Expense',   type: 'opex' },
    { id: uuid(), code: '6001', name: 'Fuel & Transport',            category: 'Expense',   type: 'opex' },
    { id: uuid(), code: '6002', name: 'Office & Admin',              category: 'Expense',   type: 'opex' },
    { id: uuid(), code: '6003', name: 'Depreciation',                category: 'Expense',   type: 'opex' },
  ];

  for (const a of accounts) {
    try { await run(`INSERT INTO chart_of_accounts (id,code,name,category,type) VALUES (?,?,?,?,?) ON CONFLICT (code) DO NOTHING`, [a.id, a.code, a.name, a.category, a.type]); }
    catch (err) { console.warn('  account skip:', a.code, err.message); }
  }

  // ── CLIENTS ───────────────────────────────────────────────────────────────────
  const clientOwner = employees[2].id; // James Otieno
  const bdOwner     = employees[5].id; // Faith Njeri

  const clients = [
    { id: uuid(), code: 'CLT-001', name: 'Kenya Power & Lighting Co.',   contact_person: 'John Kariuki',  email: 'procurement@kplc.co.ke',   segment: 'Parastatal', account_owner: clientOwner, outstanding: 1240000 },
    { id: uuid(), code: 'CLT-002', name: 'Kenyatta National Hospital',   contact_person: 'Dr. M. Omondi', email: 'supplies@knh.or.ke',        segment: 'Government', account_owner: bdOwner,     outstanding: 0 },
    { id: uuid(), code: 'CLT-003', name: 'Kenya Railways Corporation',   contact_person: 'Eng. P. Bett',  email: 'engineering@railways.go.ke',segment: 'Parastatal', account_owner: clientOwner, outstanding: 0 },
    { id: uuid(), code: 'CLT-004', name: 'Coast Water Works Dev Agency', contact_person: 'M. Hassan',     email: 'tech@coastwater.co.ke',     segment: 'County Gov', account_owner: clientOwner, outstanding: 1650000 },
    { id: uuid(), code: 'CLT-005', name: 'Bamburi Cement Ltd',           contact_person: 'Eng. S. Patel', email: 'maintenance@bamburi.com',   segment: 'Private',    account_owner: bdOwner,     outstanding: 480000 },
    { id: uuid(), code: 'CLT-006', name: 'KTDA Holdings Ltd',            contact_person: 'J. Mutua',      email: 'equipment@ktda.co.ke',      segment: 'Private',    account_owner: bdOwner,     outstanding: 0 },
  ];

  for (const c of clients) {
    try { await run(`INSERT INTO clients (id,code,name,contact_person,email,segment,account_owner,outstanding) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (code) DO NOTHING`, [c.id, c.code, c.name, c.contact_person, c.email, c.segment, c.account_owner, c.outstanding]); }
    catch (err) { console.warn('  client skip:', c.code, err.message); }
  }

  // ── PROJECTS ──────────────────────────────────────────────────────────────────
  const projects = [
    { id: uuid(), ref_no: 'QSL-PROJ-001', name: 'Mombasa Water Treatment Plant Instrumentation', client_id: clients[3].id, pm_id: employees[2].id, contract_value: 8500000, budget_total: 6800000, expenses_total: 6240000, invoiced_total: 7650000, collected_total: 6000000, status: 'active', end_date: '2026-09-30' },
    { id: uuid(), ref_no: 'QSL-PROJ-002', name: 'Nairobi Hospital Medical Gas Calibration',       client_id: clients[1].id, pm_id: employees[4].id, contract_value: 3200000, budget_total: 2400000, expenses_total: 1980000, invoiced_total: 2880000, collected_total: 2880000, status: 'active', end_date: '2026-08-15' },
    { id: uuid(), ref_no: 'QSL-PROJ-003', name: 'KPLC Substation Control Systems',                client_id: clients[0].id, pm_id: employees[2].id, contract_value: 12400000,budget_total: 9920000, expenses_total: 4100000, invoiced_total: 4960000, collected_total: 3720000, status: 'active', end_date: '2026-12-31' },
    { id: uuid(), ref_no: 'QSL-PROJ-004', name: 'SGR Weighbridge Calibration Services',           client_id: clients[2].id, pm_id: employees[4].id, contract_value: 1800000, budget_total: 1350000, expenses_total: 1390000, invoiced_total: 1800000, collected_total: 1800000, status: 'overdue',end_date: '2026-05-31' },
    { id: uuid(), ref_no: 'QSL-PROJ-005', name: 'Kisumu Port Fuel Flow Meter Calibration',        client_id: clients[0].id, pm_id: employees[2].id, contract_value: 2600000, budget_total: 2080000, expenses_total: 520000,  invoiced_total: 0,       collected_total: 0,       status: 'active', end_date: '2026-11-30' },
  ];

  for (const p of projects) {
    try { await run(`INSERT INTO projects (id,ref_no,name,client_id,pm_id,contract_value,budget_total,expenses_total,invoiced_total,collected_total,status,end_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (ref_no) DO NOTHING`, [p.id,p.ref_no,p.name,p.client_id,p.pm_id,p.contract_value,p.budget_total,p.expenses_total,p.invoiced_total,p.collected_total,p.status,p.end_date]); }
    catch (err) { console.warn('  project skip:', p.ref_no, err.message); }
  }

  // ── STATUTORY CALENDAR ────────────────────────────────────────────────────────
  // No unique constraint exists on this table beyond id (confirmed by
  // inspecting the schema before this rewrite), so — same as the original
  // version of this script — re-running it will add duplicate rows here.
  // Preserving that existing behavior rather than inventing new dedup
  // semantics that weren't part of the original script's contract.
  const { STATUTORY_OBLIGATIONS, getNextDueDate } = require('../src/lib/tax');
  for (const o of STATUTORY_OBLIGATIONS) {
    try {
      await run(`INSERT INTO statutory_calendar (id,obligation,description,due_day,frequency,next_due) VALUES (?,?,?,?,?,?)`,
        [uuid(), o.name, o.agency, o.due_day, o.frequency, getNextDueDate(o) || '2026-12-31']);
    } catch (err) { console.warn('  statutory_calendar skip:', o.name, err.message); }
  }

  // ── COMPLIANCE DOCS ───────────────────────────────────────────────────────────
  // Same note as statutory_calendar above — no unique constraint beyond id.
  const docs = [
    { name: 'Tax Compliance Certificate (TCC)',     type: 'KRA',     expires_at: '2026-09-30', responsible: employees[1].id },
    { name: 'NCA Registration — NCA7',              type: 'NCA',     expires_at: '2026-12-31', responsible: employees[2].id },
    { name: 'ISO/IEC 17025:2017 Accreditation',    type: 'ISO',     expires_at: '2027-03-15', responsible: employees[4].id },
    { name: 'EBK Annual Practising Certificate',   type: 'EBK',     expires_at: '2026-08-31', responsible: employees[4].id },
    { name: 'Business Permit — Nairobi County',    type: 'County',  expires_at: '2026-12-31', responsible: employees[3].id },
    { name: 'OSHA Occupation Certificate',          type: 'DOSH',    expires_at: '2026-10-15', responsible: employees[3].id },
    { name: 'NITA Levy Compliance',                 type: 'NITA',    expires_at: '2026-06-30', responsible: employees[3].id },
  ];
  for (const d of docs) {
    try { await run(`INSERT INTO compliance_docs (id,name,type,expires_at,responsible,status) VALUES (?,?,?,?,?,'current')`, [uuid(),d.name,d.type,d.expires_at,d.responsible]); }
    catch (err) { console.warn('  compliance_doc skip:', d.name, err.message); }
  }

  // ── SUPPLIERS ─────────────────────────────────────────────────────────────────
  const suppliers = [
    { name: 'TechCal Kenya Ltd',      category: 'Calibration Equipment', email: 'orders@techcal.co.ke',   payment_terms: 30, is_approved: 1 },
    { name: 'BOC Kenya Limited',      category: 'Industrial Gases',      email: 'orders@boc.co.ke',       payment_terms: 30, is_approved: 1 },
    { name: 'Emerson East Africa',    category: 'Instrumentation',       email: 'ea@emerson.com',         payment_terms: 45, is_approved: 1 },
    { name: 'SafeWork Kenya',         category: 'PPE & Safety',          email: 'orders@safework.co.ke',  payment_terms: 14, is_approved: 1 },
    { name: 'Siemens Kenya',          category: 'Automation',            email: 'ke@siemens.com',         payment_terms: 60, is_approved: 1 },
  ];
  for (const s of suppliers) {
    try { await run(`INSERT INTO suppliers (id,code,name,category,email,payment_terms,is_approved) VALUES (?,?,?,?,?,?,?) ON CONFLICT (code) DO NOTHING`, [uuid(),`SUP-${Date.now().toString().slice(-5)}`,s.name,s.category,s.email,s.payment_terms,s.is_approved]); }
    catch (err) { console.warn('  supplier skip:', s.name, err.message); }
  }

  console.log('✅ Database seeded successfully');
  console.log('');
  console.log('Default login for all staff: password = QSL@2026!');
  console.log('Emails:');
  employees.forEach(e => console.log(`  ${e.role.padEnd(25)} ${e.email}`));
}

main().catch(console.error);
