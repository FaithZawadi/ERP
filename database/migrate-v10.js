// database/migrate-v10.js — Completes RBAC coverage.
//
// migrate-v3.js seeded module_flags for 22 modules but only ever defined
// permissions for 6 of them (calibration, store, requisitions, fleet,
// admin, reports). finance, tax, hr, procurement, assets, projects, crm,
// debtors, hse, bids, inspection, ic, compliance and tasks had module
// toggles in Admin > Modules with NO permissions behind them at all — so
// even though most roles are non-system and editable from Admin > Roles &
// Permissions, there was nothing in the list to grant. On top of that,
// three of the 14 seeded roles (qm, commercial_manager, sales_rep) were
// never given any role_permissions row in migrate-v3's rolePermMap, so
// those roles have carried zero permissions since the role was created.
//
// This migration:
//   1. Adds permissions for every remaining module.
//   2. Adds 6 new roles (accountant, it_admin, hse_officer,
//      bids_coordinator, assets_manager, receptionist) to own modules
//      that had no natural owner among the original 14 roles.
//   3. Rebuilds role_permissions for ALL roles (existing + new) from a
//      single rolePermMap so every role carries every module relevant to
//      its job function, including filling the qm/commercial_manager/
//      sales_rep gap.
//   4. Re-syncs user_roles for any user whose users.role already matches
//      one of the new role codes (mirrors the backfill migrate-v3 does).
//
// Idempotent — safe to re-run. Uses insertIfMissing throughout, and the
// role_permissions rebuild step is a delete-then-reinsert per role rather
// than a blind INSERT, so re-running just reconverges to the same map.
//
// Run: node database/migrate-v10.js

const { v4: uuid } = require('uuid');

async function migrate() {
  const db = require('../src/lib/db.js');
  const { query, queryOne, run } = db;
  console.log(`Running migration v10 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  const exists = async (sql, params) => !!(await queryOne(sql, params));
  const insertIfMissing = async (checkSql, checkParams, insertSql, insertParams) => {
    if (!(await exists(checkSql, checkParams))) await run(insertSql, insertParams);
  };

  // ── 1. New roles to own the modules nothing else naturally owns ─────────
  const newRoles = [
    ['accountant',       'Accountant',           0],
    ['it_admin',         'IT Administrator',     0],
    ['hse_officer',      'HSE Officer',          0],
    ['bids_coordinator', 'Bids Coordinator',     0],
    ['assets_manager',   'Fixed Assets Manager', 0],
    ['receptionist',     'Receptionist / Admin Assistant', 0],
  ];
  console.log('Seeding new roles...');
  for (const [code, name, isSystem] of newRoles) {
    await insertIfMissing(
      'SELECT 1 FROM roles WHERE code=?', [code],
      'INSERT INTO roles (id, code, name, is_system) VALUES (?,?,?,?)',
      [uuid(), code, name, isSystem]
    );
  }
  console.log(newRoles.length + ' new roles seeded (or already present)');

  // ── 2. Permissions for every module that previously had none ────────────
  const newPermissions = [
    // finance
    ['finance.view',            'finance', 'View finance dashboards, journals, and ledgers'],
    ['finance.post_journal',    'finance', 'Post journal entries'],
    ['finance.approve_payment', 'finance', 'Approve payment batches'],
    ['finance.bank_reconcile',  'finance', 'Reconcile bank accounts'],
    // tax
    ['tax.view',           'tax', 'View tax records and KRA filings'],
    ['tax.file_returns',   'tax', 'Prepare and file tax returns (VAT, PAYE, etc.)'],
    // hr
    ['hr.view_employees',  'hr', 'View employee records'],
    ['hr.manage_employees','hr', 'Create and edit employee records'],
    ['hr.payroll_run',     'hr', 'Run payroll'],
    ['hr.payroll_approve', 'hr', 'Approve payroll before disbursement'],
    ['hr.leave_approve',   'hr', 'Approve leave requests'],
    ['hr.appraisals',      'hr', 'Manage performance appraisals and CPD records'],
    // procurement (external purchasing — distinct from internal requisitions)
    ['procurement.view',            'procurement', 'View purchase orders and supplier records'],
    ['procurement.create_po',       'procurement', 'Create purchase orders / LPOs'],
    ['procurement.approve_po',      'procurement', 'Approve purchase orders / LPOs'],
    ['procurement.manage_suppliers','procurement', 'Manage supplier records'],
    // assets
    ['assets.view',       'assets', 'View fixed asset register'],
    ['assets.register',   'assets', 'Register new fixed assets'],
    ['assets.dispose',    'assets', 'Dispose or write off fixed assets'],
    ['assets.depreciate', 'assets', 'Run/approve depreciation'],
    // projects
    ['projects.view',           'projects', 'View projects'],
    ['projects.manage',         'projects', 'Create and manage projects'],
    ['projects.approve_budget', 'projects', 'Approve project budgets'],
    // crm
    ['crm.view',          'crm', 'View clients and pipeline'],
    ['crm.manage_clients','crm', 'Create and manage client records'],
    ['crm.create_quote',  'crm', 'Create sales quotes'],
    // debtors
    ['debtors.view',       'debtors', 'View debtor balances and aging'],
    ['debtors.manage',     'debtors', 'Manage debtor accounts'],
    ['debtors.collections','debtors', 'Record collections and follow-ups'],
    // hse
    ['hse.view',           'hse', 'View HSE records'],
    ['hse.report_incident','hse', 'Report HSE incidents'],
    ['hse.manage',         'hse', 'Manage HSE program, audits, and corrective actions'],
    // bids
    ['bids.view',    'bids', 'View bids / pre-sales pipeline'],
    ['bids.create',  'bids', 'Create bid submissions'],
    ['bids.approve', 'bids', 'Approve bid submissions before lodging'],
    // inspection (ISO 17020 inspection body)
    ['inspection.view',    'inspection', 'View inspection records'],
    ['inspection.conduct', 'inspection', 'Conduct inspections / complete checklists'],
    ['inspection.approve', 'inspection', 'Approve/sign off inspection reports'],
    // inter-company
    ['ic.view',   'ic', 'View inter-company transactions'],
    ['ic.manage', 'ic', 'Create and manage inter-company transactions'],
    // compliance
    ['compliance.view',   'compliance', 'View compliance register'],
    ['compliance.manage', 'compliance', 'Manage compliance items and audits'],
    // tasks
    ['tasks.view',   'tasks', 'View tasks'],
    ['tasks.create', 'tasks', 'Create and assign tasks'],
  ];
  console.log('Seeding new permissions...');
  for (const [code, module, desc] of newPermissions) {
    await insertIfMissing(
      'SELECT 1 FROM permissions WHERE code=?', [code],
      'INSERT INTO permissions (id, code, module, description) VALUES (?,?,?,?)',
      [uuid(), code, module, desc]
    );
  }
  console.log(newPermissions.length + ' new permissions seeded (or already present)');

  // ── 3. Full role -> permission map, rebuilt for every role ──────────────
  // Pull every permission code that now exists (old + new) so md/admin
  // continue to get the full set automatically.
  const allPermCodes = (await query('SELECT code FROM permissions')).map(r => r.code);

  const rolePermMap = {
    md:    allPermCodes,
    admin: allPermCodes,

    cfo: [
      'store.view', 'store.view_cost', 'requisitions.approve', 'requisitions.view_all',
      'reports.view', 'reports.export',
      'finance.view', 'finance.post_journal', 'finance.approve_payment', 'finance.bank_reconcile',
      'tax.view', 'tax.file_returns',
      'debtors.view', 'debtors.manage',
      'assets.depreciate',
      'projects.approve_budget',
      'ic.view', 'ic.manage',
      'compliance.view',
      'procurement.approve_po',
    ],

    store_manager: [
      'store.view', 'store.view_cost', 'store.receive', 'store.issue', 'store.transfer',
      'store.adjust', 'store.adjust.approve', 'requisitions.approve', 'requisitions.view_all',
      'reports.view', 'assets.view', 'procurement.view',
    ],

    store_clerk: ['store.view', 'store.receive', 'store.issue', 'requisitions.create'],

    procurement_officer: [
      'store.view', 'store.view_cost', 'requisitions.view_all', 'reports.view',
      'procurement.view', 'procurement.create_po', 'procurement.manage_suppliers',
    ],

    fleet_manager: [
      'fleet.view', 'fleet.manage', 'store.view', 'requisitions.create', 'reports.view',
      'assets.view', 'hse.report_incident',
    ],

    hr_manager: [
      'admin.users', 'reports.view',
      'hr.view_employees', 'hr.manage_employees', 'hr.payroll_run', 'hr.payroll_approve',
      'hr.leave_approve', 'hr.appraisals',
    ],

    project_manager: [
      'requisitions.create', 'requisitions.view_all', 'reports.view',
      'projects.view', 'projects.manage', 'crm.view', 'ic.view',
    ],

    commercial_manager: [
      'reports.view', 'reports.export',
      'crm.view', 'crm.manage_clients', 'crm.create_quote',
      'bids.view', 'bids.create', 'bids.approve',
      'debtors.view',
    ],

    sales_rep: [
      'crm.view', 'crm.create_quote', 'bids.view', 'reports.view',
    ],

    technician: [
      'calibration.view_own', 'calibration.log', 'requisitions.create', 'store.view', 'fleet.view',
      'inspection.view', 'inspection.conduct', 'hse.report_incident',
    ],

    qm: [
      'calibration.view_own', 'calibration.log', 'reports.view', 'reports.export',
      'inspection.view', 'inspection.conduct', 'inspection.approve',
      'compliance.view', 'compliance.manage', 'hse.view',
    ],

    staff: ['requisitions.create', 'store.view', 'tasks.view', 'tasks.create'],

    // New roles
    accountant: [
      'finance.view', 'finance.post_journal', 'finance.bank_reconcile',
      'tax.view', 'tax.file_returns',
      'debtors.view', 'debtors.manage', 'debtors.collections',
      'reports.view', 'reports.export', 'store.view_cost',
    ],

    it_admin: [
      'admin.settings', 'admin.modules', 'admin.users',
      'assets.view', 'assets.register',
      'reports.view',
    ],

    hse_officer: [
      'hse.view', 'hse.report_incident', 'hse.manage',
      'compliance.view', 'reports.view',
    ],

    bids_coordinator: [
      'bids.view', 'bids.create', 'bids.approve',
      'crm.view', 'projects.view', 'reports.view',
    ],

    assets_manager: [
      'assets.view', 'assets.register', 'assets.dispose', 'assets.depreciate',
      'store.view', 'reports.view',
    ],

    receptionist: ['tasks.view', 'tasks.create', 'requisitions.create', 'store.view'],
  };

  console.log('Rebuilding role -> permission mappings for all roles...');
  let mappingCount = 0;
  for (const roleCode in rolePermMap) {
    const roleRow = await queryOne('SELECT id, is_system FROM roles WHERE code=?', [roleCode]);
    if (!roleRow) { console.log(`  role '${roleCode}' not found, skipping`); continue; }
    const roleId = roleRow.id;
    const permCodes = rolePermMap[roleCode];

    // Rebuild cleanly: clear existing rows for this role, then reinsert the
    // full intended set. Safe to re-run — converges to the same map every
    // time rather than only ever adding rows.
    await run('DELETE FROM role_permissions WHERE role_id=?', [roleId]);

    for (const permCode of permCodes) {
      const permRow = await queryOne('SELECT id FROM permissions WHERE code=?', [permCode]);
      if (!permRow) { console.log(`  permission '${permCode}' not found (role ${roleCode}), skipping`); continue; }
      await run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)', [roleId, permRow.id]);
      mappingCount++;
    }
    console.log(`  ${roleCode}: ${permCodes.length} permissions wired`);
  }
  console.log(mappingCount + ' total role-permission mappings wired across ' + Object.keys(rolePermMap).length + ' roles');

  // ── 4. Sync user_roles for any user already on one of the new role codes ─
  console.log('Assigning existing users to newly-created roles (if their users.role already matches)...');
  const newRoleCodes = newRoles.map(r => r[0]);
  let userRoleCount = 0;
  for (const code of newRoleCodes) {
    const roleRow = await queryOne('SELECT id FROM roles WHERE code=?', [code]);
    if (!roleRow) continue;
    const users = await query('SELECT id FROM users WHERE role=?', [code]);
    for (const u of users) {
      await insertIfMissing(
        'SELECT 1 FROM user_roles WHERE user_id=? AND role_id=?', [u.id, roleRow.id],
        'INSERT INTO user_roles (user_id, role_id) VALUES (?,?)',
        [u.id, roleRow.id]
      );
      userRoleCount++;
    }
  }
  console.log(userRoleCount + ' users synced to new roles');

  console.log('');
  console.log('=== MIGRATION v10 COMPLETE ===');
  console.log(`Roles: ${Object.keys(rolePermMap).length} total (6 new). Permissions: ${allPermCodes.length} total (${newPermissions.length} new).`);
}

migrate().catch(function(e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
