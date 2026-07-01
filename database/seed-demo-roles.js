// database/seed-demo-roles.js — Demo accounts for roles not yet represented
//
// Run once: node database/seed-demo-roles.js
// Idempotent — safe to re-run, skips any email that already exists.
// Works against whichever backend is active (sql.js or PostgreSQL,
// selected automatically by src/lib/db.js based on DATABASE_URL) since
// this goes through that module's query()/run() rather than talking to
// sql.js directly — that direct-sql.js approach was the original version
// of this script and would silently do nothing useful if DATABASE_URL
// were set, since it bypassed db.js's backend selection entirely.
//
// The original seed.js only created 8 employees, leaving several real
// roles (store_manager, store_clerk, procurement_officer, fleet_manager,
// project_manager) and the new technician role with no actual login to
// demo them. This fills that gap with one demo account per missing role,
// same QSL@2026! password convention as every other seeded account.

const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const crypto = require('crypto');

// Initials alone collide easily (e.g. "Samuel Kamau" and "Samuel Kiprop" are
// both "SK") which previously caused a UNIQUE constraint failure on
// digital_signatures.key_id. Walk a numeric suffix until a free key_id is
// found instead of assuming initials are unique across the company.
async function uniqueKeyId(firstName, lastName, queryOne) {
  const initials = `${firstName[0]}${lastName[0]}`.toUpperCase();
  let candidate = `QSL-DS-${initials}-2024`;
  let n = 2;
  while (await queryOne('SELECT 1 as found FROM digital_signatures WHERE key_id=?', [candidate])) {
    candidate = `QSL-DS-${initials}${n}-2024`;
    n++;
  }
  return candidate;
}

async function main() {
  const db = require('../src/lib/db.js');
  const { query, queryOne, run } = db;

  const hashed = bcrypt.hashSync('QSL@2026!', 12);

  const demoAccounts = [
    { emp_no: 'QSL-009', first_name: 'Brian',   last_name: 'Kiptoo',  email: 'bkiptoo@qalibrated.co.ke',  department: 'Stores',       jobTitle: 'Store Manager',        role: 'store_manager',       salary: 180000, joined: '2022-02-01' },
    { emp_no: 'QSL-010', first_name: 'Lucy',    last_name: 'Wairimu', email: 'lwairimu@qalibrated.co.ke', department: 'Stores',       jobTitle: 'Store Clerk',          role: 'store_clerk',         salary: 95000,  joined: '2022-09-01' },
    { emp_no: 'QSL-011', first_name: 'Peter',   last_name: 'Mutua',   email: 'pmutua@qalibrated.co.ke',   department: 'Procurement',  jobTitle: 'Procurement Officer',  role: 'procurement_officer', salary: 160000, joined: '2021-11-15' },
    { emp_no: 'QSL-012', first_name: 'Samuel',  last_name: 'Kiprop',  email: 'skiprop@qalibrated.co.ke',  department: 'Logistics',    jobTitle: 'Fleet Manager',        role: 'fleet_manager',       salary: 150000, joined: '2021-04-01' },
    { emp_no: 'QSL-013', first_name: 'Esther',  last_name: 'Chebet',  email: 'echebet@qalibrated.co.ke',  department: 'Projects',     jobTitle: 'Project Manager',      role: 'project_manager',     salary: 230000, joined: '2020-10-01' },
    { emp_no: 'QSL-014', first_name: 'Tom',     last_name: 'Omondi',  email: 'tomondi@qalibrated.co.ke',  department: 'Engineering',  jobTitle: 'Calibration Technician', role: 'technician',        salary: 130000, joined: '2022-05-15' },
    { emp_no: 'QSL-015', first_name: 'Diana',   last_name: 'Achieng', email: 'dachieng@qalibrated.co.ke', department: 'Commercial',  jobTitle: 'Commercial Manager',   role: 'commercial_manager',  salary: 210000, joined: '2021-06-01' },
    { emp_no: 'QSL-016', first_name: 'Kevin',   last_name: 'Njoroge', email: 'knjoroge@qalibrated.co.ke', department: 'Commercial',  jobTitle: 'Sales Representative', role: 'sales_rep',           salary: 110000, joined: '2023-01-10' },
    { emp_no: 'QSL-017', first_name: 'Caroline',last_name: 'Mwende',  email: 'cmwende@qalibrated.co.ke',  department: 'Finance',     jobTitle: 'Accountant',           role: 'accountant',          salary: 145000, joined: '2022-03-01' },
    { emp_no: 'QSL-018', first_name: 'Dennis',  last_name: 'Karanja', email: 'dkaranja@qalibrated.co.ke', department: 'ICT',         jobTitle: 'IT Administrator',     role: 'it_admin',            salary: 155000, joined: '2021-09-15' },
    { emp_no: 'QSL-019', first_name: 'Anne',    last_name: 'Wangari', email: 'awangari@qalibrated.co.ke', department: 'HSE',         jobTitle: 'HSE Officer',          role: 'hse_officer',         salary: 130000, joined: '2022-06-01' },
    { emp_no: 'QSL-020', first_name: 'Felix',   last_name: 'Mbugua',  email: 'fmbugua@qalibrated.co.ke',  department: 'Commercial',  jobTitle: 'Bids Coordinator',     role: 'bids_coordinator',    salary: 140000, joined: '2022-11-01' },
    { emp_no: 'QSL-021', first_name: 'Joyce',   last_name: 'Atieno',  email: 'jatieno@qalibrated.co.ke',  department: 'Finance',     jobTitle: 'Fixed Assets Manager', role: 'assets_manager',      salary: 150000, joined: '2021-08-15' },
    { emp_no: 'QSL-022', first_name: 'Brenda',  last_name: 'Cherono', email: 'bcherono@qalibrated.co.ke', department: 'Admin',       jobTitle: 'Receptionist',         role: 'receptionist',        salary: 70000,  joined: '2023-04-01' },
  ];

  console.log(`Seeding demo accounts for previously-unrepresented roles (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...\n`);

  for (const acc of demoAccounts) {
    const existingUser = await queryOne('SELECT id FROM users WHERE email=?', [acc.email]);
    if (existingUser) {
      const hasSig = await queryOne('SELECT 1 as found FROM digital_signatures WHERE user_id=? AND is_active=1', [existingUser.id]);
      if (hasSig) {
        console.log(`  ${acc.email} already exists with an active signature, skipping`);
        continue;
      }
      // Account exists but has no signature (e.g. created before this script
      // generated one) — backfill it without touching anything else.
      const keyId = await uniqueKeyId(acc.first_name, acc.last_name, queryOne);
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      await run(
        `INSERT INTO digital_signatures (id,user_id,key_id,public_key,private_key,algorithm,is_active) VALUES (?,?,?,?,?,'RSA-2048',1)`,
        [uuid(), existingUser.id, keyId, publicKey, privateKey]
      );
      console.log(`  🔑 Backfilled missing signature for ${acc.email} (${keyId})`);
      continue;
    }

    const empId = uuid();
    await run(
      `INSERT INTO employees (id, emp_no, first_name, last_name, email, department, role, basic_salary, date_joined, status, leave_balance, l_and_d_hours, l_and_d_target)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [empId, acc.emp_no, acc.first_name, acc.last_name, acc.email, acc.department, acc.jobTitle, acc.salary, acc.joined, 'active', 21, 20, 40]
    );

    const userId = uuid();
    await run(
      `INSERT INTO users (id, employee_id, email, password, role, is_active) VALUES (?,?,?,?,?,1)`,
      [userId, empId, acc.email, hashed, acc.role]
    );

    // Every user that can approve, sign off, or issue a document (certificates,
    // payment batches, LPOs, etc.) needs an active RSA-2048 digital signature —
    // without one, those actions silently issue unsigned, which the original
    // 8 seed.js accounts had but this script never generated. Mirrors seed.js.
    const keyId = await uniqueKeyId(acc.first_name, acc.last_name, queryOne);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await run(
      `INSERT INTO digital_signatures (id,user_id,key_id,public_key,private_key,algorithm,is_active) VALUES (?,?,?,?,?,'RSA-2048',1)`,
      [uuid(), userId, keyId, publicKey, privateKey]
    );

    // Also wire into the RBAC user_roles join table, mirroring what
    // migrate-v3.js does for the original 8 accounts.
    const roleRow = await queryOne('SELECT id FROM roles WHERE code=?', [acc.role]);
    if (roleRow?.id) {
      await run(`INSERT INTO user_roles (user_id, role_id) VALUES (?,?)`, [userId, roleRow.id]);
    }

    console.log(`  ✅ ${acc.jobTitle} — ${acc.email} (role: ${acc.role}, signature: ${keyId})`);
  }

  console.log('\nAll demo accounts use password: QSL@2026!');
}

main().catch(e => { console.error(e); process.exit(1); });
