// src/lib/tax.js — Kenya Tax Calculations (KRA Compliant)
// Updated for Finance Act 2023 rates + Housing Levy

// ── PAYE BANDS (2024/2025 Kenya) ─────────────────────────────────────────────
// Source: KRA - https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye

const PAYE_BANDS = [
  { from: 0,       to: 24000,   rate: 0.10 },
  { from: 24001,   to: 32333,   rate: 0.25 },
  { from: 32334,   to: 500000,  rate: 0.30 },
  { from: 500001,  to: 800000,  rate: 0.325 },
  { from: 800001,  to: Infinity,rate: 0.35 },
];

const PERSONAL_RELIEF_MONTHLY = 2400;    // Kshs 28,800 per year / 12
const INSURANCE_RELIEF_MAX    = 5000;    // Monthly max insurance premium relief
const INSURANCE_RELIEF_RATE   = 0.15;   // 15% of premium

// NHIF rates (SHIF effective 2024 — 2.75% of gross)
const NHIF_RATE = 0.0275;
const NHIF_MIN  = 500;
const NHIF_MAX  = 1700;   // Currently capped; remove cap when full SHIF active

// NSSF (new rates - NSSF Act 2013 tiers)
const NSSF_TIER1 = { ceiling: 7000,  rate: 0.06 };
const NSSF_TIER2 = { ceiling: 36000, rate: 0.06 };

// Housing Levy (Finance Act 2023)
const HOUSING_LEVY_RATE      = 0.015;
const HOUSING_LEVY_EMPLOYER  = 0.015;

// VAT
const VAT_STANDARD_RATE = 0.16;
const VAT_ZERO_RATE     = 0;
const VAT_EXEMPT        = null;

// WHT rates
const WHT_RATES = {
  professional_fees:    0.05,
  management_fees:      0.05,
  rent_commercial:      0.30,
  dividend_resident:    0.05,
  dividend_nonresident: 0.10,
  interest_bank:        0.15,
  construction:         0.03,
  agency_comm:          0.05,
};

// ── PAYE CALCULATION ─────────────────────────────────────────────────────────

/**
 * Calculate monthly PAYE tax.
 * @param {number} grossMonthly - Gross monthly pay in Kshs
 * @param {number} insurancePremium - Monthly insurance premium (optional)
 * @returns {object} Tax breakdown
 */
function calculatePAYE(grossMonthly, insurancePremium = 0) {
  let tax = 0;
  let remaining = grossMonthly;

  for (const band of PAYE_BANDS) {
    if (remaining <= 0) break;
    const bandSize = Math.min(remaining, band.to - band.from + 1);
    const taxable  = Math.min(remaining, bandSize);
    tax += taxable * band.rate;
    remaining -= taxable;
    if (remaining <= 0) break;
  }

  // Personal relief
  tax -= PERSONAL_RELIEF_MONTHLY;

  // Insurance relief (15% of premium, max Kshs 5,000/month)
  if (insurancePremium > 0) {
    const insuranceRelief = Math.min(insurancePremium * INSURANCE_RELIEF_RATE, INSURANCE_RELIEF_MAX);
    tax -= insuranceRelief;
  }

  // PAYE cannot be negative
  tax = Math.max(0, Math.round(tax));

  return {
    grossMonthly,
    taxableIncome: grossMonthly,
    grossTax:      Math.round(grossMonthly > 0 ? (grossMonthly * 0.35) : 0), // approx
    personalRelief: PERSONAL_RELIEF_MONTHLY,
    paye:          tax,
    effectiveRate: grossMonthly > 0 ? (tax / grossMonthly) : 0,
  };
}

// ── NHIF / SHIF CALCULATION ──────────────────────────────────────────────────

/**
 * Calculate NHIF contribution (moving to SHIF 2.75%).
 * Currently using old slab-based NHIF; update when SHIF fully active.
 */
function calculateNHIF(grossMonthly) {
  // New SHIF: 2.75% of gross (no cap when fully implemented)
  // Using current hybrid approach:
  const computed = Math.round(grossMonthly * NHIF_RATE);
  return Math.min(Math.max(computed, NHIF_MIN), NHIF_MAX);
}

// ── NSSF CALCULATION ─────────────────────────────────────────────────────────

/**
 * Calculate NSSF contribution (employee share).
 * Tier I: 6% up to KES 7,000
 * Tier II: 6% on amount between 7,001 and 36,000
 */
function calculateNSSF(grossMonthly) {
  const tier1Base = Math.min(grossMonthly, NSSF_TIER1.ceiling);
  const tier1     = Math.round(tier1Base * NSSF_TIER1.rate);

  const tier2Base = Math.max(0, Math.min(grossMonthly, NSSF_TIER2.ceiling) - NSSF_TIER1.ceiling);
  const tier2     = Math.round(tier2Base * NSSF_TIER2.rate);

  return { tier1, tier2, total: tier1 + tier2, employer: tier1 + tier2 };
}

// ── HOUSING LEVY ─────────────────────────────────────────────────────────────

function calculateHousingLevy(grossMonthly) {
  return {
    employee: Math.round(grossMonthly * HOUSING_LEVY_RATE),
    employer: Math.round(grossMonthly * HOUSING_LEVY_EMPLOYER),
  };
}

// ── FULL PAYSLIP CALCULATION ─────────────────────────────────────────────────

/**
 * Calculate complete payslip for one employee for one month.
 * @param {object} employee - { basic_salary, allowances, insurance_premium, imprest_deductions }
 * @returns {object} Full payslip breakdown
 */
function calculatePayslip(employee) {
  const {
    basic_salary      = 0,
    allowances        = 0,
    overtime          = 0,   // taxable overtime earnings (HR-012)
    helb              = 0,   // monthly HELB loan repayment, post-tax deduction (HR-007)
    insurance_premium = 0,
    imprest_deductions = 0,
    other_deductions  = 0,
  } = employee;

  const grossPay = basic_salary + allowances + overtime;

  const paye_calc   = calculatePAYE(grossPay, insurance_premium);
  const nhif        = calculateNHIF(grossPay);
  const nssf_calc   = calculateNSSF(grossPay);
  const housing_calc = calculateHousingLevy(grossPay);

  const totalDeductions = paye_calc.paye + nhif + nssf_calc.total + housing_calc.employee + helb + imprest_deductions + other_deductions;
  const netPay          = Math.max(0, grossPay - totalDeductions);

  return {
    basic_salary,
    allowances,
    overtime,
    gross_pay:     grossPay,
    paye:          paye_calc.paye,
    nhif,
    nssf:          nssf_calc.total,
    nssf_tier1:    nssf_calc.tier1,
    nssf_tier2:    nssf_calc.tier2,
    housing_levy:  housing_calc.employee,
    helb,
    employer_nssf: nssf_calc.employer,
    employer_housing: housing_calc.employer,
    imprest_deductions,
    other_deductions,
    total_deductions: totalDeductions,
    net_pay:       netPay,
    effective_paye_rate: paye_calc.effectiveRate,
  };
}

// HR-012: overtime earnings — 1.5× normal hourly rate on weekdays, 2× on
// Sundays/public holidays (Employment Act 2007). Hourly rate = monthly basic
// over a 26-day × 8-hour month.
function calculateOvertime(basicSalary, weekdayHours = 0, holidayHours = 0) {
  const hourly = basicSalary / 26 / 8;
  const weekday = Math.round(weekdayHours * hourly * 1.5);
  const holiday = Math.round(holidayHours * hourly * 2);
  return { hourly: Math.round(hourly * 100) / 100, weekday, holiday, total: weekday + holiday };
}

// ── VAT CALCULATION ───────────────────────────────────────────────────────────

/**
 * Calculate VAT on a sale.
 * @param {number} amount - Exclusive of VAT
 * @param {string} category - 'A' (standard 16%), 'B' (zero-rated), 'E' (exempt)
 */
function calculateVAT(amount, category = 'A', standardRate = 0.16) {
  // The standard (category A) rate is configurable via System Settings
  // (finance.vat_rate); zero-rated/exempt/special categories stay at 0.
  const rates = { 'A': standardRate, 'B': 0, 'E': 0, 'C': 0 };
  const rate  = rates[category] ?? standardRate;
  const vatAmount = Math.round(amount * rate * 100) / 100;
  return {
    exclusive:  amount,
    vat_amount: vatAmount,
    inclusive:  amount + vatAmount,
    rate,
    category,
  };
}

/**
 * Extract VAT from an inclusive amount.
 */
function extractVAT(inclusive, rate = 0.16) {
  const vatAmount = (inclusive * rate) / (1 + rate);
  return {
    inclusive,
    vat_amount: Math.round(vatAmount * 100) / 100,
    exclusive:  Math.round((inclusive - vatAmount) * 100) / 100,
    rate,
  };
}

// ── WHT CALCULATION ───────────────────────────────────────────────────────────

function calculateWHT(amount, type = 'professional_fees') {
  const rate = WHT_RATES[type] || 0;
  return {
    gross:      amount,
    wht_rate:   rate,
    wht_amount: Math.round(amount * rate),
    net_payable: Math.round(amount * (1 - rate)),
    type,
  };
}

// ── VAT RETURN COMPUTATION ────────────────────────────────────────────────────

/**
 * Compute net VAT payable for a period.
 * @param {Array} sales     - Array of { amount, vat_amount } (output VAT)
 * @param {Array} purchases - Array of { amount, vat_amount } (input VAT claimable)
 */
function computeVATReturn(sales = [], purchases = []) {
  const outputVAT = sales.reduce((s, i) => s + (i.vat_amount || 0), 0);
  const inputVAT  = purchases.reduce((s, i) => s + (i.vat_amount || 0), 0);
  const netVAT    = outputVAT - inputVAT;
  return {
    output_vat:  Math.round(outputVAT),
    input_vat:   Math.round(inputVAT),
    net_vat:     Math.round(netVAT),
    payable:     Math.max(0, Math.round(netVAT)),
    refundable:  Math.max(0, Math.round(-netVAT)),
  };
}

// ── PAYE RETURN ───────────────────────────────────────────────────────────────

function computePAYEReturn(entries = []) {
  return {
    total_gross: entries.reduce((s, e) => s + (e.gross_pay || 0), 0),
    total_paye:  entries.reduce((s, e) => s + (e.paye || 0), 0),
    total_nhif:  entries.reduce((s, e) => s + (e.nhif || 0), 0),
    total_nssf:  entries.reduce((s, e) => s + (e.nssf || 0), 0),
    total_housing: entries.reduce((s, e) => s + (e.housing_levy || 0), 0),
    employee_count: entries.length,
  };
}

// ── STATUTORY CALENDAR ────────────────────────────────────────────────────────

const STATUTORY_OBLIGATIONS = [
  { code: 'PAYE',      name: 'PAYE Monthly Return & Payment',     due_day: 9,  frequency: 'monthly',   agency: 'KRA' },
  { code: 'NHIF',      name: 'NHIF Monthly Contribution',         due_day: 9,  frequency: 'monthly',   agency: 'NHIF/SHIF' },
  { code: 'NSSF',      name: 'NSSF Monthly Contribution',         due_day: 15, frequency: 'monthly',   agency: 'NSSF' },
  { code: 'VAT',       name: 'VAT Monthly Return & Payment',      due_day: 20, frequency: 'monthly',   agency: 'KRA' },
  { code: 'HOUSING',   name: 'Housing Levy Monthly Remittance',   due_day: 9,  frequency: 'monthly',   agency: 'NHFC' },
  { code: 'CORP_TAX',  name: 'Corporation Tax Instalment (Q1)',   due_day: 20, frequency: 'quarterly', agency: 'KRA' },
  { code: 'WITHHOLDING', name: 'Withholding Tax Return',          due_day: 20, frequency: 'monthly',   agency: 'KRA' },
  { code: 'ANN_RETURN', name: 'Annual Company Return (Registrar)',due_day: 0,  frequency: 'annual',    agency: 'BRS' },
  { code: 'AUDIT',     name: 'Audited Financial Statements',      due_day: 0,  frequency: 'annual',    agency: 'ICPAK' },
  { code: 'TCC',       name: 'Tax Compliance Certificate Renewal',due_day: 0,  frequency: 'annual',    agency: 'KRA' },
];

function getNextDueDate(obligation, referenceDate = new Date()) {
  const now     = new Date(referenceDate);
  const year    = now.getFullYear();
  const month   = now.getMonth();

  if (obligation.frequency === 'monthly') {
    let dueDate = new Date(year, month, obligation.due_day);
    if (dueDate <= now) {
      dueDate = new Date(year, month + 1, obligation.due_day);
    }
    return dueDate.toISOString().split('T')[0];
  }
  return null;
}

module.exports = {
  calculatePAYE,
  calculateNHIF,
  calculateNSSF,
  calculateHousingLevy,
  calculatePayslip,
  calculateOvertime,
  calculateVAT,
  extractVAT,
  calculateWHT,
  computeVATReturn,
  computePAYEReturn,
  STATUTORY_OBLIGATIONS,
  getNextDueDate,
  VAT_STANDARD_RATE,
  WHT_RATES,
  PAYE_BANDS,
};
