// database/seed-coa.js — Full QSL Chart of Accounts (ICPAK-compliant)
// Run: node database/seed-coa.js

const { v4: uuid } = require('uuid');
const fs   = require('fs');
const path = require('path');

const QSL_COA = [
  // ── ASSETS ─────────────────────────────────────────────────────────────────
  // Current Assets
  { code:'1000', name:'CURRENT ASSETS',                      cat:'Asset',     type:'header' },
  { code:'1100', name:'Cash & Bank — Equity Bank (Kshs)',    cat:'Asset',     type:'bank' },
  { code:'1101', name:'Cash & Bank — KCB (Kshs)',            cat:'Asset',     type:'bank' },
  { code:'1102', name:'Cash & Bank — Stanbic (Kshs)',        cat:'Asset',     type:'bank' },
  { code:'1105', name:'Cash & Bank — USD Account',           cat:'Asset',     type:'bank' },
  { code:'1110', name:'Petty Cash',                          cat:'Asset',     type:'cash' },
  { code:'1200', name:'Trade Receivables — Local Clients',   cat:'Asset',     type:'receivable' },
  { code:'1201', name:'Trade Receivables — Government',      cat:'Asset',     type:'receivable' },
  { code:'1210', name:'Other Receivables',                   cat:'Asset',     type:'receivable' },
  { code:'1220', name:'Staff Imprest & Advances',            cat:'Asset',     type:'receivable' },
  { code:'1230', name:'VAT Recoverable (Input VAT)',         cat:'Asset',     type:'tax_asset' },
  { code:'1240', name:'Prepayments & Deposits',              cat:'Asset',     type:'prepayment' },
  { code:'1300', name:'Inventory — Instruments & Equipment', cat:'Asset',     type:'inventory' },
  { code:'1301', name:'Inventory — Consumables & Spares',    cat:'Asset',     type:'inventory' },
  { code:'1302', name:'Inventory — PPE & Safety Stock',      cat:'Asset',     type:'inventory' },
  { code:'1310', name:'Work In Progress — Projects',         cat:'Asset',     type:'wip' },

  // Non-Current Assets
  { code:'1500', name:'NON-CURRENT ASSETS',                  cat:'Asset',     type:'header' },
  { code:'1510', name:'Motor Vehicles — Cost',               cat:'Asset',     type:'fixed_asset' },
  { code:'1511', name:'Motor Vehicles — Acc. Depreciation',  cat:'Asset',     type:'acc_dep' },
  { code:'1520', name:'IT Equipment & Software — Cost',      cat:'Asset',     type:'fixed_asset' },
  { code:'1521', name:'IT Equipment — Acc. Depreciation',    cat:'Asset',     type:'acc_dep' },
  { code:'1530', name:'Calibration Equipment — Cost',        cat:'Asset',     type:'fixed_asset' },
  { code:'1531', name:'Calibration Equipment — Acc. Dep.',   cat:'Asset',     type:'acc_dep' },
  { code:'1540', name:'Test & Measurement Equipment — Cost', cat:'Asset',     type:'fixed_asset' },
  { code:'1541', name:'Test & Measurement — Acc. Dep.',      cat:'Asset',     type:'acc_dep' },
  { code:'1550', name:'Furniture & Fittings — Cost',         cat:'Asset',     type:'fixed_asset' },
  { code:'1551', name:'Furniture & Fittings — Acc. Dep.',    cat:'Asset',     type:'acc_dep' },
  { code:'1560', name:'Leasehold Improvements — Cost',       cat:'Asset',     type:'fixed_asset' },
  { code:'1561', name:'Leasehold Improvements — Acc. Dep.',  cat:'Asset',     type:'acc_dep' },
  { code:'1600', name:'Investment in Subsidiaries',          cat:'Asset',     type:'investment' },
  { code:'1610', name:'Inter-Company Receivable — China',    cat:'Asset',     type:'ic_receivable' },

  // ── LIABILITIES ────────────────────────────────────────────────────────────
  { code:'2000', name:'CURRENT LIABILITIES',                 cat:'Liability', type:'header' },
  { code:'2100', name:'Trade Payables — Suppliers',          cat:'Liability', type:'payable' },
  { code:'2101', name:'Trade Payables — Subcontractors',     cat:'Liability', type:'payable' },
  { code:'2110', name:'Accruals & Provisions',               cat:'Liability', type:'accrual' },
  { code:'2120', name:'VAT Payable (Output VAT)',            cat:'Liability', type:'tax_liability' },
  { code:'2121', name:'PAYE Payable',                        cat:'Liability', type:'tax_liability' },
  { code:'2122', name:'NHIF/SHIF Payable',                   cat:'Liability', type:'tax_liability' },
  { code:'2123', name:'NSSF Payable',                        cat:'Liability', type:'tax_liability' },
  { code:'2124', name:'Affordable Housing Levy Payable',     cat:'Liability', type:'tax_liability' },
  { code:'2125', name:'Withholding Tax Payable',             cat:'Liability', type:'tax_liability' },
  { code:'2130', name:'Salaries Payable',                    cat:'Liability', type:'payroll' },
  { code:'2140', name:'Customer Deposits & Advance Billing', cat:'Liability', type:'deferred' },
  { code:'2150', name:'Loan — Current Portion',              cat:'Liability', type:'loan' },
  { code:'2160', name:'Inter-Company Payable',               cat:'Liability', type:'ic_payable' },

  { code:'2500', name:'NON-CURRENT LIABILITIES',             cat:'Liability', type:'header' },
  { code:'2510', name:'Bank Loan — Long Term',               cat:'Liability', type:'loan' },
  { code:'2520', name:'Directors Loan',                      cat:'Liability', type:'loan' },
  { code:'2530', name:'Lease Liability (IFRS 16)',            cat:'Liability', type:'lease' },

  // ── EQUITY ─────────────────────────────────────────────────────────────────
  { code:'3000', name:'EQUITY',                              cat:'Equity',    type:'header' },
  { code:'3100', name:'Ordinary Share Capital',              cat:'Equity',    type:'share_capital' },
  { code:'3200', name:'Share Premium',                       cat:'Equity',    type:'share_premium' },
  { code:'3300', name:'Retained Earnings',                   cat:'Equity',    type:'retained_earnings' },
  { code:'3400', name:'Current Year Profit / (Loss)',        cat:'Equity',    type:'current_profit' },

  // ── REVENUE ────────────────────────────────────────────────────────────────
  { code:'4000', name:'REVENUE',                             cat:'Income',    type:'header' },
  { code:'4100', name:'Revenue — Calibration Services',      cat:'Income',    type:'revenue' },
  { code:'4101', name:'Revenue — Calibration Lab (KEBS)',    cat:'Income',    type:'revenue' },
  { code:'4110', name:'Revenue — Instrumentation Supply',    cat:'Income',    type:'revenue' },
  { code:'4120', name:'Revenue — Engineering Services',      cat:'Income',    type:'revenue' },
  { code:'4121', name:'Revenue — Control Systems',           cat:'Income',    type:'revenue' },
  { code:'4122', name:'Revenue — Electrical Engineering',    cat:'Income',    type:'revenue' },
  { code:'4130', name:'Revenue — Equipment Rental',          cat:'Income',    type:'revenue' },
  { code:'4140', name:'Revenue — Maintenance Contracts',     cat:'Income',    type:'revenue' },
  { code:'4150', name:'Revenue — Training & Consultancy',    cat:'Income',    type:'revenue' },
  { code:'4200', name:'Revenue — Kisumu Branch',             cat:'Income',    type:'revenue' },
  { code:'4300', name:'Revenue — Export (Zero-rated)',        cat:'Income',    type:'revenue' },
  { code:'4900', name:'Other Income / Sundry',               cat:'Income',    type:'other_income' },
  { code:'4910', name:'Interest Income',                     cat:'Income',    type:'interest' },
  { code:'4920', name:'Forex Gain / (Loss)',                  cat:'Income',    type:'forex' },
  { code:'4930', name:'Management Fee Income (IC)',          cat:'Income',    type:'ic_income' },

  // ── COST OF SALES ──────────────────────────────────────────────────────────
  { code:'5000', name:'COST OF SALES',                       cat:'Expense',   type:'header' },
  { code:'5100', name:'Direct Labour — Engineering Staff',   cat:'Expense',   type:'cogs_labour' },
  { code:'5101', name:'Direct Labour — Casual Workers',      cat:'Expense',   type:'cogs_labour' },
  { code:'5102', name:'Direct Labour — Field Technicians',   cat:'Expense',   type:'cogs_labour' },
  { code:'5110', name:'Materials & Consumables',             cat:'Expense',   type:'cogs_materials' },
  { code:'5111', name:'Calibration Standards & Accessories', cat:'Expense',   type:'cogs_materials' },
  { code:'5120', name:'Subcontractor Costs',                 cat:'Expense',   type:'cogs_subcon' },
  { code:'5130', name:'Plant & Equipment Hire',              cat:'Expense',   type:'cogs_plant' },
  { code:'5140', name:'Project Transport & Logistics',       cat:'Expense',   type:'cogs_transport' },
  { code:'5150', name:'Site Accommodation & Allowances',     cat:'Expense',   type:'cogs_allowance' },
  { code:'5160', name:'Project Insurance & Bonds',           cat:'Expense',   type:'cogs_insurance' },
  { code:'5170', name:'HSE & Safety Costs (Project)',        cat:'Expense',   type:'cogs_hse' },

  // ── OPERATING EXPENSES ─────────────────────────────────────────────────────
  { code:'6000', name:'OPERATING EXPENSES',                  cat:'Expense',   type:'header' },

  // Staff Costs
  { code:'6100', name:'Salaries & Wages',                    cat:'Expense',   type:'opex_staff' },
  { code:'6101', name:'Employer NSSF Contribution',          cat:'Expense',   type:'opex_staff' },
  { code:'6102', name:'Employer NHIF/SHIF Contribution',     cat:'Expense',   type:'opex_staff' },
  { code:'6103', name:'Employer Housing Levy',               cat:'Expense',   type:'opex_staff' },
  { code:'6104', name:'Staff Medical Insurance',             cat:'Expense',   type:'opex_staff' },
  { code:'6105', name:'Staff Training & L&D',                cat:'Expense',   type:'opex_staff' },
  { code:'6106', name:'Staff Welfare & Benefits',            cat:'Expense',   type:'opex_staff' },
  { code:'6107', name:'Director Remuneration',               cat:'Expense',   type:'opex_staff' },

  // Premises
  { code:'6200', name:'Office Rent — Nairobi',               cat:'Expense',   type:'opex_premises' },
  { code:'6201', name:'Office Rent — Kisumu',                cat:'Expense',   type:'opex_premises' },
  { code:'6202', name:'Office Utilities (Power, Water)',      cat:'Expense',   type:'opex_premises' },
  { code:'6203', name:'Office Cleaning & Maintenance',       cat:'Expense',   type:'opex_premises' },

  // Fleet & Transport
  { code:'6300', name:'Fuel & Lubricants',                   cat:'Expense',   type:'opex_fleet' },
  { code:'6301', name:'Vehicle Maintenance & Repairs',       cat:'Expense',   type:'opex_fleet' },
  { code:'6302', name:'Vehicle Insurance',                   cat:'Expense',   type:'opex_fleet' },
  { code:'6303', name:'Vehicle Inspection (NTSA)',           cat:'Expense',   type:'opex_fleet' },
  { code:'6304', name:'Staff Travel — Air & Bus',            cat:'Expense',   type:'opex_fleet' },

  // Admin & Office
  { code:'6400', name:'Office Stationery & Supplies',        cat:'Expense',   type:'opex_admin' },
  { code:'6401', name:'Telephone & Internet',                cat:'Expense',   type:'opex_admin' },
  { code:'6402', name:'Postage & Courier',                   cat:'Expense',   type:'opex_admin' },
  { code:'6403', name:'Printing & Photocopying',             cat:'Expense',   type:'opex_admin' },
  { code:'6404', name:'Entertainment & Client Meetings',     cat:'Expense',   type:'opex_admin' },

  // Professional Fees
  { code:'6500', name:'Audit Fees',                          cat:'Expense',   type:'opex_professional' },
  { code:'6501', name:'Legal Fees',                          cat:'Expense',   type:'opex_professional' },
  { code:'6502', name:'Consulting & Advisory Fees',          cat:'Expense',   type:'opex_professional' },
  { code:'6503', name:'Tax Advisory (KPMG / Deloitte)',      cat:'Expense',   type:'opex_professional' },

  // Marketing & BD
  { code:'6600', name:'Advertising & Marketing',             cat:'Expense',   type:'opex_marketing' },
  { code:'6601', name:'Tender Document Fees',                cat:'Expense',   type:'opex_marketing' },
  { code:'6602', name:'Bid Bonds & Performance Bonds',       cat:'Expense',   type:'opex_marketing' },
  { code:'6603', name:'Business Development Travel',         cat:'Expense',   type:'opex_marketing' },

  // Compliance & Regulatory
  { code:'6700', name:'ISO Accreditation & Calibration',     cat:'Expense',   type:'opex_compliance' },
  { code:'6701', name:'NCA Annual Fees',                     cat:'Expense',   type:'opex_compliance' },
  { code:'6702', name:'EBK / Professional Body Fees',        cat:'Expense',   type:'opex_compliance' },
  { code:'6703', name:'Business Permits & Licences',         cat:'Expense',   type:'opex_compliance' },
  { code:'6704', name:'KRA Penalties & Interest (if any)',   cat:'Expense',   type:'opex_compliance' },
  { code:'6705', name:'Insurance — Office & Liability',      cat:'Expense',   type:'opex_compliance' },

  // ICT
  { code:'6800', name:'ICT — Software Licences & SaaS',     cat:'Expense',   type:'opex_ict' },
  { code:'6801', name:'ICT — Hardware Maintenance',         cat:'Expense',   type:'opex_ict' },
  { code:'6802', name:'ICT — Connectivity & Cloud',         cat:'Expense',   type:'opex_ict' },

  // Finance Costs
  { code:'6900', name:'Bank Charges & Fees',                 cat:'Expense',   type:'finance_cost' },
  { code:'6901', name:'Loan Interest',                       cat:'Expense',   type:'finance_cost' },
  { code:'6902', name:'Forex Loss',                          cat:'Expense',   type:'finance_cost' },

  // Depreciation
  { code:'7000', name:'DEPRECIATION',                        cat:'Expense',   type:'header' },
  { code:'7100', name:'Depreciation — Motor Vehicles',       cat:'Expense',   type:'depreciation' },
  { code:'7101', name:'Depreciation — IT Equipment',         cat:'Expense',   type:'depreciation' },
  { code:'7102', name:'Depreciation — Calibration Equipment',cat:'Expense',   type:'depreciation' },
  { code:'7103', name:'Depreciation — Test Equipment',       cat:'Expense',   type:'depreciation' },
  { code:'7104', name:'Depreciation — Furniture & Fittings', cat:'Expense',   type:'depreciation' },
  { code:'7105', name:'Depreciation — Leasehold Improv.',    cat:'Expense',   type:'depreciation' },
  { code:'7110', name:'Amortisation — Software',             cat:'Expense',   type:'depreciation' },
];

async function seedCOA() {
  const db = require('../src/lib/db.js');
  const { run } = db;

  console.log(`Seeding Chart of Accounts (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  // Clear existing COA
  await run(`DELETE FROM chart_of_accounts`);

  let count = 0;
  for (const acc of QSL_COA) {
    try {
      // INSERT OR IGNORE is SQLite-only syntax; ON CONFLICT DO NOTHING is
      // the PostgreSQL equivalent and also valid SQLite syntax (SQLite has
      // supported ON CONFLICT since 3.24), so this single form works
      // correctly on both backends without needing a branch here. Relies
      // on chart_of_accounts.code having a UNIQUE constraint (confirmed
      // in database/init.js) as the conflict target.
      await run(
        `INSERT INTO chart_of_accounts (id, code, name, category, type, is_active)
         VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT (code) DO NOTHING`,
        [uuid(), acc.code, acc.name, acc.cat, acc.type]
      );
      count++;
    } catch (e) {
      console.warn('Skip:', acc.code, e.message);
    }
  }

  console.log(`✅ Chart of Accounts seeded: ${count} accounts`);
  console.log('   Coverage: Current Assets · Fixed Assets · Liabilities · Equity · Revenue · COGS · OpEx · Depreciation');
}

seedCOA().catch(console.error);
