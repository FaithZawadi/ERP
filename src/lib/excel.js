// src/lib/excel.js — Excel Report Generator (ExcelJS)
// Generates: payroll summary, aged debtors, project P&L, asset register, audit trail

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

// ── STYLE CONSTANTS ───────────────────────────────────────────────────────────
const NAVY   = { argb: 'FF1B3A5C' };
const GOLD   = { argb: 'FFC8960C' };
const WHITE  = { argb: 'FFFFFFFF' };
const LGREY  = { argb: 'FFE8ECF0' };
const OFFWHT = { argb: 'FFF0F4F8' };
const GREEN  = { argb: 'FF1E6B3C' };
const RED    = { argb: 'FFC00000' };
const AMBER  = { argb: 'FFB8600B' };

function headerStyle(ws, row, cols, label) {
  const r = ws.addRow([]);
  r.height = 24;
  ws.mergeCells(`A${r.number}:${cols}${r.number}`);
  const cell = ws.getCell(`A${r.number}`);
  cell.value = label;
  cell.fill  = { type:'pattern', pattern:'solid', fgColor: NAVY };
  cell.font  = { bold:true, color: WHITE, size: 11, name:'Calibri' };
  cell.alignment = { vertical:'middle', horizontal:'left', indent: 1 };
  return r;
}

function tableHeader(ws, headers, widths) {
  const r = ws.addRow(headers);
  r.height = 18;
  r.eachCell(cell => {
    cell.fill  = { type:'pattern', pattern:'solid', fgColor: NAVY };
    cell.font  = { bold:true, color: WHITE, size: 9, name:'Calibri' };
    cell.alignment = { vertical:'middle', horizontal:'center' };
    cell.border = { bottom: { style:'thin', color: GOLD } };
  });
  if (widths) widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return r;
}

function dataRow(ws, values, even, formats = {}) {
  const r = ws.addRow(values);
  r.eachCell((cell, colNum) => {
    cell.fill = { type:'pattern', pattern:'solid', fgColor: even ? OFFWHT : WHITE };
    cell.font = { size: 9, name: 'Calibri' };
    cell.alignment = { vertical:'middle' };
    if (formats[colNum]) { cell.numFmt = formats[colNum]; }
  });
  return r;
}

function kes(n) { return Math.round(Number(n) || 0); }

function addQSLHeader(ws, title, subtitle, cols) {
  // Row 1 — Title
  ws.addRow([]);
  const titleRow = ws.addRow([`QSL ERP — ${title}`]);
  ws.mergeCells(`A2:${cols}2`);
  const tc = ws.getCell('A2');
  tc.fill  = { type:'pattern', pattern:'solid', fgColor: NAVY };
  tc.font  = { bold:true, color: GOLD, size: 14, name:'Calibri' };
  tc.alignment = { vertical:'middle', horizontal:'center' };
  titleRow.height = 28;

  // Row 3 — Subtitle
  const subRow = ws.addRow([subtitle || `Generated: ${new Date().toLocaleDateString('en-KE')}`]);
  ws.mergeCells(`A3:${cols}3`);
  const sc = ws.getCell('A3');
  sc.fill  = { type:'pattern', pattern:'solid', fgColor: { argb: 'FF0D2238' } };
  sc.font  = { color: { argb: 'FFAABBCC' }, size: 9, name:'Calibri' };
  sc.alignment = { vertical:'middle', horizontal:'center' };
  subRow.height = 16;

  ws.addRow([]); // spacer
}

// ── PAYROLL SUMMARY ───────────────────────────────────────────────────────────

async function generatePayrollExcel(payrollRun, entries, period) {
  const wb  = new ExcelJS.Workbook();
  wb.creator = 'QSL ERP';
  wb.created = new Date();

  // Sheet 1: Summary
  const ws = wb.addWorksheet('Payroll Summary', { views: [{ state:'frozen', ySplit:4 }] });
  addQSLHeader(ws, `Payroll Summary — ${period}`, `Status: ${payrollRun?.status?.toUpperCase()} | Period: ${period}`, 'J');

  tableHeader(ws,
    ['Emp No','Employee Name','Department','Basic Salary','Allowances','Gross Pay','PAYE','NHIF','NSSF','Housing Levy','Total Ded.','Net Pay'],
    [10, 22, 16, 14, 12, 14, 12, 10, 10, 12, 12, 14]
  );

  const kesFormat = '#,##0';
  let totalGross = 0, totalPAYE = 0, totalNHIF = 0, totalNSSF = 0, totalHousing = 0, totalNet = 0;

  entries.forEach((e, i) => {
    const totalDed = kes(e.paye) + kes(e.nhif) + kes(e.nssf) + kes(e.housing_levy) + kes(e.imprest_deduct||0);
    const r = dataRow(ws,
      [e.emp_no||'—', e.name||`${e.first_name} ${e.last_name}`, e.department, kes(e.basic_salary),
       kes(e.allowances||0), kes(e.gross_pay), kes(e.paye), kes(e.nhif), kes(e.nssf), kes(e.housing_levy), totalDed, kes(e.net_pay)],
      i % 2 === 0,
      { 4:kesFormat, 5:kesFormat, 6:kesFormat, 7:kesFormat, 8:kesFormat, 9:kesFormat, 10:kesFormat, 11:kesFormat, 12:kesFormat }
    );
    totalGross += kes(e.gross_pay); totalPAYE += kes(e.paye);
    totalNHIF  += kes(e.nhif);      totalNSSF += kes(e.nssf);
    totalHousing += kes(e.housing_levy); totalNet += kes(e.net_pay);
  });

  // Totals row
  const totRow = ws.addRow(['', 'TOTALS', '', '', '', totalGross, totalPAYE, totalNHIF, totalNSSF, totalHousing, '', totalNet]);
  totRow.height = 22;
  totRow.eachCell(cell => {
    cell.fill = { type:'pattern', pattern:'solid', fgColor: NAVY };
    cell.font = { bold:true, color: GOLD, size: 10, name:'Calibri' };
    cell.numFmt = '#,##0';
    cell.alignment = { vertical:'middle', horizontal:'center' };
  });

  // Sheet 2: Employer Costs
  const ws2 = wb.addWorksheet('Employer Costs');
  addQSLHeader(ws2, `Employer Cost Summary — ${period}`, '', 'E');
  tableHeader(ws2, ['Description','Employee Contribution','Employer Contribution','Total Cost'], [30, 22, 22, 22]);

  [
    ['PAYE (employee only)', totalPAYE, 0],
    ['NHIF/SHIF', totalNHIF, totalNHIF],
    ['NSSF', totalNSSF, totalNSSF],
    ['Housing Levy', totalHousing, totalHousing],
  ].forEach(([desc, emp, er], i) => {
    dataRow(ws2, [desc, emp, er, emp + er], i % 2 === 0, { 2:'#,##0', 3:'#,##0', 4:'#,##0' });
  });

  dataRow(ws2, ['TOTAL', totalPAYE + totalNHIF + totalNSSF + totalHousing, totalNHIF + totalNSSF + totalHousing, totalPAYE + 2*(totalNHIF + totalNSSF + totalHousing)], false, { 2:'#,##0', 3:'#,##0', 4:'#,##0' });

  const dir = path.join(UPLOAD_DIR, 'reports'); ensureDir(dir);
  const file = path.join(dir, `payroll_${period.replace('-','_')}.xlsx`);
  await wb.xlsx.writeFile(file);
  return { path: file, url: `/uploads/reports/${path.basename(file)}` };
}

// ── AGED DEBTORS EXCEL ────────────────────────────────────────────────────────

async function generateAgedDebtorsExcel(clients) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QSL ERP';
  const ws = wb.addWorksheet('Aged Debtors', { views: [{ state:'frozen', ySplit:4 }] });
  const today = new Date();

  addQSLHeader(ws, 'Aged Debtors Report', `As at: ${today.toLocaleDateString('en-KE')}`, 'G');
  tableHeader(ws, ['Code','Client Name','Account Owner','Contact','Phone','Outstanding (Kshs)','Credit Limit (Kshs)','Status'], [10,28,18,18,14,18,18,12]);

  let total = 0;
  clients.forEach((c, i) => {
    const r = dataRow(ws,
      [c.code||'—', c.name, c.account_owner||'—', c.contact_person||'—', c.phone||'—', kes(c.outstanding), kes(c.credit_limit||0), c.outstanding>0?'OUTSTANDING':'CLEARED'],
      i % 2 === 0, { 6:'#,##0', 7:'#,##0' }
    );
    // Color outstanding cells
    const outCell = r.getCell(6);
    if (c.outstanding > 0) {
      outCell.font = { bold:true, color: RED, name:'Calibri', size:9 };
    }
    const statCell = r.getCell(8);
    statCell.font  = { bold:true, color: c.outstanding>0 ? RED : GREEN, name:'Calibri', size:9 };
    total += kes(c.outstanding);
  });

  const totRow = ws.addRow(['', 'TOTAL', '', '', '', total, '', '']);
  totRow.getCell(6).numFmt = '#,##0';
  totRow.eachCell(c => { c.fill = {type:'pattern',pattern:'solid',fgColor:NAVY}; c.font={bold:true,color:GOLD,name:'Calibri'}; });

  const dir = path.join(UPLOAD_DIR, 'reports'); ensureDir(dir);
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(dir, `aged_debtors_${date}.xlsx`);
  await wb.xlsx.writeFile(file);
  return { path: file, url: `/uploads/reports/${path.basename(file)}` };
}

// ── PROJECT P&L EXCEL ─────────────────────────────────────────────────────────

async function generateProjectPLExcel(projects) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QSL ERP';
  const ws = wb.addWorksheet('Project P&L', { views: [{ state:'frozen', ySplit:4 }] });

  addQSLHeader(ws, 'Project Profitability Report', `As at: ${new Date().toLocaleDateString('en-KE')}`, 'I');
  tableHeader(ws,
    ['Ref No','Project Name','Client','Value (Kshs)','Budget (Kshs)','Expenses (Kshs)','Invoiced (Kshs)','Collected (Kshs)','Gross Profit (Kshs)','Margin %','PM','Status'],
    [12,28,20,15,15,15,15,15,16,10,14,10]
  );

  let totValue=0, totBudget=0, totExp=0, totInv=0, totCol=0, totGP=0;
  projects.forEach((p, i) => {
    const gp     = kes(p.contract_value) - kes(p.expenses_total);
    const margin = p.contract_value > 0 ? (gp / kes(p.contract_value)) : 0;
    const r = dataRow(ws,
      [p.ref_no, p.name, p.client_name||p.client||'—', kes(p.contract_value), kes(p.budget_total), kes(p.expenses_total),
       kes(p.invoiced_total), kes(p.collected_total), gp, margin, p.pm||p.pm_name||'—', p.status],
      i % 2 === 0,
      { 4:'#,##0', 5:'#,##0', 6:'#,##0', 7:'#,##0', 8:'#,##0', 9:'#,##0', 10:'0.0%' }
    );
    // Colour GP cell
    const gpCell = r.getCell(9);
    gpCell.font  = { bold:true, color: gp > 0 ? GREEN : RED, name:'Calibri', size:9 };
    const marCell = r.getCell(10);
    marCell.font = { bold:true, color: margin >= 0.15 ? GREEN : margin >= 0.10 ? { argb:'FFB8600B' } : RED, name:'Calibri', size:9 };
    totValue+=kes(p.contract_value); totBudget+=kes(p.budget_total); totExp+=kes(p.expenses_total);
    totInv+=kes(p.invoiced_total); totCol+=kes(p.collected_total); totGP+=gp;
  });

  const totRow = ws.addRow(['','TOTALS','', totValue, totBudget, totExp, totInv, totCol, totGP, totValue>0?totGP/totValue:0,'','']);
  totRow.eachCell(c => { c.fill={type:'pattern',pattern:'solid',fgColor:NAVY}; c.font={bold:true,color:GOLD,name:'Calibri',size:10}; c.numFmt='#,##0'; c.alignment={vertical:'middle',horizontal:'center'}; });
  totRow.getCell(10).numFmt = '0.0%';
  totRow.height = 22;

  const dir = path.join(UPLOAD_DIR, 'reports'); ensureDir(dir);
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(dir, `project_pl_${date}.xlsx`);
  await wb.xlsx.writeFile(file);
  return { path: file, url: `/uploads/reports/${path.basename(file)}` };
}

// ── ASSET REGISTER EXCEL ──────────────────────────────────────────────────────

async function generateAssetRegisterExcel(assets, totals) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QSL ERP';
  const ws  = wb.addWorksheet('Asset Register', { views: [{ state:'frozen', ySplit:4 }] });

  addQSLHeader(ws, 'Fixed Asset Register', `As at: ${new Date().toLocaleDateString('en-KE')} | Total NBV: Kshs ${(totals?.total_nbv||0).toLocaleString()}`, 'J');
  tableHeader(ws,
    ['Tag No','Description','Category','Serial No','Purchase Date','Cost (Kshs)','Method','Rate','NBV (Kshs)','Custodian','Location','Status'],
    [12,22,16,14,13,14,10,8,14,16,14,10]
  );

  assets.forEach((a, i) => {
    const r = dataRow(ws,
      [a.tag_no, a.name, a.category, a.serial_no||'—', a.purchase_date, kes(a.cost),
       a.dep_method==='straight_line'?'SL':'RB', `${Math.round((a.dep_rate||0)*100)}%`,
       kes(a.nbv), a.custodian_name||'—', a.location||'HQ', a.status],
      i % 2 === 0, { 6:'#,##0', 9:'#,##0' }
    );
    // Highlight low NBV
    const nbvCell = r.getCell(9);
    const pct = a.cost > 0 ? a.nbv / a.cost : 0;
    if (pct < 0.1) nbvCell.font = { color: RED, bold:true, name:'Calibri', size:9 };
  });

  const dir = path.join(UPLOAD_DIR, 'reports'); ensureDir(dir);
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(dir, `asset_register_${date}.xlsx`);
  await wb.xlsx.writeFile(file);
  return { path: file, url: `/uploads/reports/${path.basename(file)}` };
}

// ── AUDIT TRAIL EXCEL ─────────────────────────────────────────────────────────

async function generateAuditTrailExcel(entries, filters) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QSL ERP';
  const ws  = wb.addWorksheet('Audit Trail', { views: [{ state:'frozen', ySplit:4 }] });

  addQSLHeader(ws, 'Audit Trail Export', `${entries.length} records | Module: ${filters?.module||'All'} | ${new Date().toLocaleDateString('en-KE')}`, 'G');
  tableHeader(ws, ['Timestamp','User','Role','Module','Action','Record ID','Details'], [20,18,12,14,22,14,30]);

  entries.forEach((e, i) => {
    dataRow(ws, [
      new Date(e.created_at).toLocaleString('en-KE'),
      e.user_name||'—', e.user_role||'—', e.module, e.action,
      e.record_id ? e.record_id.slice(0,12) : '—',
      e.new_value ? JSON.stringify(e.new_value).slice(0,80) : '',
    ], i % 2 === 0);
  });

  const dir  = path.join(UPLOAD_DIR, 'reports'); ensureDir(dir);
  const date = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const file = path.join(dir, `audit_trail_${date}.xlsx`);
  await wb.xlsx.writeFile(file);
  return { path: file, url: `/uploads/reports/${path.basename(file)}` };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── GENERIC TABULAR REPORT EXCEL (point 4 — Reporting exports) ───────────────
// Mirrors generateTabularReport in pdf.js — shared by Inventory, Requisitions,
// Vehicles, and User Activity exports rather than four near-duplicate functions.
//
// columns: [{ key, label, width, format(value,row), numFmt }]
// rows: array of plain objects

async function generateTabularReportExcel({ title, subtitle, columns, rows, sheetName, filenamePrefix }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QSL ERP';
  const colLetter = String.fromCharCode(64 + Math.min(columns.length, 26));
  const ws = wb.addWorksheet(sheetName || 'Report', { views: [{ state: 'frozen', ySplit: 4 }] });

  addQSLHeader(ws, title, subtitle, colLetter);
  tableHeader(ws, columns.map(c => c.label), columns.map(c => c.width || 16));

  rows.forEach((row, i) => {
    const values = columns.map(c => c.format ? c.format(row[c.key], row) : (row[c.key] ?? '—'));
    const formats = {};
    columns.forEach((c, idx) => { if (c.numFmt) formats[idx + 1] = c.numFmt; });
    dataRow(ws, values, i % 2 === 0, formats);
  });

  const dir = path.join(UPLOAD_DIR, 'reports'); ensureDir(dir);
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(dir, `${filenamePrefix || 'report'}_${date}.xlsx`);
  await wb.xlsx.writeFile(file);
  return { path: file, url: `/uploads/reports/${path.basename(file)}` };
}

module.exports = {
  generatePayrollExcel,
  generateAgedDebtorsExcel,
  generateProjectPLExcel,
  generateAssetRegisterExcel,
  generateAuditTrailExcel,
  generateTabularReportExcel,
};
