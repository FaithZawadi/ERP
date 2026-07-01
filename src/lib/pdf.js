// src/lib/pdf.js — PDF Generator (PDFKit)
// Generates: payslips, tax invoices, calibration certificates, audit trail exports

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path   = require('path');
const fs     = require('fs');

const NAVY   = '#1B3A5C';
const GOLD   = '#C8960C';
const GREY   = '#94A3B8';
const DKGREY = '#334155';
const LGREY  = '#E8ECF0';
const GREEN  = '#1E6B3C';
const RED    = '#C00000';
const AMBER  = '#92400E';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

// Real QSL logo (icon + wordmark), extracted directly from the original
// QSL_*_Template.pdf design files and saved as a static asset — embedded in
// every document's header box, in place of the plain "QSL" text that was
// there before. Read once and cached as a buffer (PDFKit accepts a Buffer
// directly via doc.image()).
let _logoBuffer = null;
function getLogoBuffer() {
  if (_logoBuffer !== null) return _logoBuffer;
  try {
    _logoBuffer = fs.readFileSync(path.join(process.cwd(), 'public', 'brand', 'qsl-logo-full.png'));
  } catch {
    _logoBuffer = false; // tried and failed — don't keep retrying the disk read
  }
  return _logoBuffer;
}

// Company identity shown on every PDF. Defaults match the original hardcoded
// values; loadCompany() refreshes them from System Settings (company.*) and
// should be called once before generating a document. It's a shared global
// (company identity is the same for all requests), so caching is safe.
let _company = {
  legal_name: 'QALIBRATED SYSTEMS LIMITED',
  address:    'Birdi Singh Complex, Off Mombasa Road, Nairobi',
  email:      'info@qalibrated.co.ke',
  phone:      '+254 714 999 996',
  kra_pin:    'P000000001K',
  site_url:   'https://qalibrated.co.ke',
};
async function loadCompany() {
  try {
    const c = await require('./settings').getCompany();
    if (c && c.legal_name) _company = { ...c };
  } catch { /* keep defaults */ }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function kes(n) {
  return `Kshs ${Number(n||0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

function dateStr(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Compact DD/MM/YYYY format — matches the official QSL calibration
// certificate exactly (CALIBRATION DATE / CERTIFICATE EXPIRY / signature
// dates all use this numeric form, not the verbose "06 February 2026").
function dateNum(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

function drawHRule(doc, y, color = LGREY) {
  doc.moveTo(50, y).lineTo(545, y).strokeColor(color).lineWidth(0.5).stroke();
}

// Every QSL document carries a QR code in the header (top-right of the navy
// bar) encoding its document/certificate number, so a printed copy can be
// verified or looked up. Generated once per document as a PNG buffer (qrcode
// is promise-based; the buffer is awaited by the caller before any synchronous
// PDFKit drawing begins, since PDFKit itself has no async drawing API).
async function getQrBuffer(text) {
  try {
    return await QRCode.toBuffer(String(text || 'QSL-ERP'), {
      type: 'png', width: 150, margin: 0, errorCorrectionLevel: 'M',
      color: { dark: '#1B3A5C', light: '#FFFFFF' },
    });
  } catch { return null; }
}

// Builds the actual text payload encoded in a document's QR code. Previously
// every QR just encoded the bare document number (e.g. "QT-2026-84400"),
// which told a scanner nothing without separately looking the document up
// in the ERP. This composes a self-contained, human-readable summary —
// company, document type/number, the other party's name, the date, the
// headline amount, and status — straight from the same data already used
// to render the PDF, so scanning the code alone tells you what the
// document actually is. Capped at a conservative length so it still scans
// reliably at the printed size (QR codes get visually denser, and thus
// harder for a phone camera to read at a few cm across, as payload grows).
function buildQrText(lines) {
  const text = lines.filter(Boolean).join('\n');
  return text.length > 500 ? text.slice(0, 497) + '...' : text;
}

// extra: { date, badge, badgeVariant } — date prints as a third white line
// under the doc number; badge (e.g. "Valid until 10 July 2026", "Due 26
// July 2026", "✓ Approved") prints as a bordered pill beneath that, exactly
// matching the original Quote/Invoice/Credit Note templates. Both are
// optional so existing callers that only pass (doc, title, subtitle) still
// render correctly with a slightly shorter header.
function addHeader(doc, title, subtitle = '', qrBuffer = null, extra = {}) {
  const HEADER_H = 132;
  doc.rect(0, 0, 595, HEADER_H).fill(NAVY);
  doc.rect(0, HEADER_H, 595, 5).fill(GOLD);

  // White logo box, top-left — real QSL mark, not text
  const boxX = 50, boxY = 24, boxW = 86, boxH = 86;
  doc.roundedRect(boxX, boxY, boxW, boxH, 5).fill('#ffffff');
  const logo = getLogoBuffer();
  if (logo) {
    const pad = 10;
    doc.image(logo, boxX + pad, boxY + pad, { fit: [boxW - pad * 2, boxH - pad * 2], align: 'center', valign: 'center' });
  } else {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(GOLD).text('QSL', boxX, boxY + boxH / 2 - 10, { width: boxW, align: 'center' });
  }

  // Title block, right-aligned within a safe zone that starts clear of the
  // logo box (boxX+boxW=136) — previously the title's box started at x=0,
  // so a long title (e.g. "NON-DISCLOSURE AGREEMENT") could right-align
  // close enough to the left that its first letter rendered behind/under
  // the logo. The box now always starts well clear of the logo, and the
  // font size auto-shrinks (down to a sane floor) so a long title still
  // fits on one line rather than wrapping awkwardly under the subtitle.
  const titleBoxX = boxX + boxW + 24; // 160 — comfortably clear of the logo
  const titleBoxW = 545 - titleBoxX;  // 385
  let titleSize = 24;
  doc.font('Helvetica-Bold');
  while (titleSize > 14 && doc.fontSize(titleSize).widthOfString(title) > titleBoxW) titleSize -= 1;
  doc.fontSize(titleSize).fillColor('#ffffff').text(title, titleBoxX, 28, { align: 'right', width: titleBoxW });
  let ry = 60;
  if (subtitle) { doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD).text(subtitle, titleBoxX, ry, { align: 'right', width: titleBoxW }); ry += 18; }
  if (extra.date) { doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text(extra.date, titleBoxX, ry, { align: 'right', width: titleBoxW }); ry += 20; }
  if (extra.badge) {
    const bw = doc.font('Helvetica-Bold').fontSize(8.5).widthOfString(extra.badge) + 24;
    const bx = 545 - bw;
    const variant = extra.badgeVariant || 'amber'; // amber | green
    const badgeBg = variant === 'green' ? '#F0FFF4' : '#FFFBEB';
    const badgeBorder = variant === 'green' ? '#86EFAC' : '#FCD34D';
    const badgeText = variant === 'green' ? GREEN : '#92400E';
    doc.roundedRect(bx, ry, bw, 20, 4).fill(badgeBg).roundedRect(bx, ry, bw, 20, 4).strokeColor(badgeBorder).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(badgeText).text(extra.badge, bx, ry + 6, { width: bw, align: 'center' });
  }

  return HEADER_H + 25; // y position after header
}

// QR moves to the footer (bottom-left, with a caption) to match every
// original QSL_*_Template design — never in the header. customNote
// overrides the centered company block's bottom line (used by the
// Document Templates editor); qrBuffer is the same buffer already
// generated for this document, just drawn here instead of in the header.
function addFooter(doc, customNote, qrBuffer = null) {
  // PDFKit's auto-pagination triggers on ANY .text() call whose y-position
  // falls past `page.height - margins.bottom`, even when x/y are passed
  // explicitly — it silently inserts a new page rather than just drawing
  // off the printable area. The footer is deliberately drawn inside the
  // 50pt margin reserved for body content, so we drop the bottom margin to
  // zero for the duration of this function and restore it immediately
  // after, rather than fighting the auto-pager with workarounds per call.
  const prevBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  const bottom = doc.page.height - 92;
  doc.rect(50, bottom, 495, 1).fill(GOLD);

  if (qrBuffer) {
    doc.image(qrBuffer, 50, bottom + 14, { width: 44, height: 44 });
    doc.font('Helvetica').fontSize(6.5).fillColor(GREY).text('Scan to verify', 50, bottom + 60, { width: 44, align: 'center', lineBreak: false });
  }

  const textX = qrBuffer ? 110 : 50;
  const textW = qrBuffer ? 435 : 495;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(_company.legal_name, textX, bottom + 14, { width: textW, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(GREY)
    .text(`P.O. Box 34463-00100, Nairobi, Kenya  |  PIN: ${_company.kra_pin}`, textX, bottom + 28, { width: textW, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(GREY)
    .text(`${_company.phone}  |  ${_company.email}  |  www.qalibrated.co.ke`, textX, bottom + 40, { width: textW, align: 'center', lineBreak: false });
  if (customNote) {
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(GREY).text(customNote, textX, bottom + 54, { width: textW, align: 'center' });
  }

  doc.page.margins.bottom = prevBottomMargin;
}

// ── GENERIC BUSINESS DOCUMENT ENGINE ───────────────────────────────────────────
// Single configurable renderer covering the 19 QSL_*_Template document types
// (Finance / Procurement / Stores / BD_CRM / HR). Each call site supplies a
// `kind` (see DOC_TYPES below) plus the record data; layout, two-block header,
// line-item table and signature strip are all driven from DOC_TYPES so adding
// a new document only requires a new config entry, not new drawing code.

const DOC_TYPES = {
  quote:            { title: 'QUOTATION',           folder: 'quotes',       blocks: ['client','validity'],  table: true,  sign: ['Prepared by','Approved by'],
    defaultTerms: ['Sale of goods and services are subject to the standard terms and conditions of sale.', 'All quoted prices are valid until the date stated above.', 'Anything else noted to be defective as the work progresses shall be quoted for separately.'],
    disclaimer: 'This document is a price quotation for informational and planning purposes and does not constitute a binding contract. It becomes a confirmed order only upon written acceptance by the client and counter-signature by an authorised representative of Qalibrated Systems Limited.' },
  debit_note:       { title: 'DEBIT NOTE',           folder: 'debit_notes',  blocks: ['client','ref'],       table: true,  sign: ['Issued by','Approved by'],
    defaultTerms: ['This debit note is issued in respect of the original invoice referenced above only.', 'The debit amount will be reflected in your next statement of account.', 'Please retain this document for your records and VAT reporting purposes.'],
    disclaimer: 'This debit note is issued under the VAT Act in respect of the invoice referenced above. Qalibrated Systems Limited KRA PIN: see footer. This document does not constitute a cash demand outside the agreed payment terms unless explicitly stated.' },
  credit_note:      { title: 'CREDIT NOTE',          folder: 'credit_notes', blocks: ['client','ref'],       table: true,  sign: ['Issued by','Approved by'],
    defaultTerms: ['This credit note is issued in respect of the original invoice referenced above only.', 'The credit amount will be reflected in your next statement of account.', 'Please retain this document for your records and VAT reporting purposes.'],
    disclaimer: 'This credit note is issued under the VAT Act in respect of the invoice referenced above. Qalibrated Systems Limited KRA PIN: see footer. This document does not constitute a refund of cash unless explicitly agreed in writing.' },
  statement:        { title: 'STATEMENT OF ACCOUNT', folder: 'statements',   blocks: ['client','period'],    table: true,  sign: [] },
  imprest_form:     { title: 'IMPREST REQUEST',      folder: 'imprest',      blocks: ['requester','purpose'],table: true,  sign: ['Requested by','Approved by'] },
  travel_claim:     { title: 'TRAVEL CLAIM',         folder: 'travel_claims',blocks: ['claimant','trip'],    table: true,  sign: ['Claimant','Approved by'] },
  purchase_req:     { title: 'PURCHASE REQUISITION', folder: 'requisitions', blocks: ['requester','dept'],   table: true,  sign: ['Requested by','Approved by'] },
  purchase_order:   { title: 'PURCHASE ORDER',       folder: 'lpos',         blocks: ['supplier','delivery'],table: true,  sign: ['Issued by','Authorised by'] },
  grn:              { title: 'GOODS RECEIVED NOTE',  folder: 'grns',         blocks: ['supplier','order'],   table: true,  sign: ['Received by','Verified by'] },
  goods_issue:      { title: 'GOODS ISSUE NOTE',     folder: 'gins',         blocks: ['issuedTo','project'], table: true,  sign: ['Issued by','Received by'] },
  stock_transfer:   { title: 'STOCK TRANSFER NOTE',  folder: 'stn',          blocks: ['from','to'],          table: true,  sign: ['Released by','Received by'] },
  stock_take:       { title: 'STOCK TAKE SHEET',     folder: 'stocktake',    blocks: ['location','date'],    table: true,  sign: ['Counted by','Verified by'], maxRowsPerPage: 28 },
  leave_application:{ title: 'LEAVE APPLICATION',    folder: 'leave',        blocks: ['employee','leave'],   table: false, sign: ['Employee','Approved by (Supervisor)'] },
  nda:              { title: 'NON-DISCLOSURE AGREEMENT', folder: 'nda',      blocks: ['party'],              table: false, sign: ['QSL Representative','Counterparty'] },
  lead_capture:     { title: 'LEAD CAPTURE FORM',    folder: 'leads',        blocks: ['lead','source'],      table: false, sign: ['Captured by'] },
  client_visit:     { title: 'CLIENT VISIT REPORT',  folder: 'visit_reports',blocks: ['client','visit'],     table: false, sign: ['Reported by'] },
  contract_cover:   { title: 'CONTRACT COVER SHEET', folder: 'contracts',    blocks: ['client','contract'],  table: false, sign: ['Prepared by','Authorised by'] },
  client_onboarding:{ title: 'CLIENT ONBOARDING',    folder: 'onboarding',   blocks: ['client','account'],   table: false, sign: ['Onboarded by'] },
  client_transfer:  { title: 'CLIENT TRANSFER',      folder: 'transfers',    blocks: ['client','transfer'],  table: false, sign: ['Released by','Received by'] },
  service_request:  { title: 'SERVICE REQUEST FORM',  folder: 'srf',          blocks: ['customer','request'], table: false, sign: ['Applicant','Reviewed by'] },
  job_card:         { title: 'FIELD JOB CARD',        folder: 'job_cards',    blocks: ['client','job'],       table: false, sign: ['Technician','Client Representative'] },
};

function fileSlug(s) { return String(s || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40); }

/**
 * Render any of the document kinds above.
 * @param {string} kind        key into DOC_TYPES
 * @param {object} data        { docNo, blocks: {label:{Key:Val}}, columns, rows, totals, notes }
 *   data.blocks   – e.g. { 'Supplier': {Name:'...', PIN:'...'}, 'Delivery': {Address:'...'} }
 *   data.columns  – [{label,key,weight,align,format}] (when table:true)
 *   data.rows     – array of row objects (when table:true)
 *   data.totals   – [{label, value}] printed under the table
 *   data.body     – free-text paragraphs for non-tabular docs (array of strings)
 *   data.notes    – footer note string
 */
async function generateBusinessDoc(kind, data = {}) {
  const base = DOC_TYPES[kind];
  if (!base) throw new Error(`Unknown document kind: ${kind}`);

  // Apply any saved in-app template edit (Admin → Document Templates) on
  // top of the built-in default. A doc type with no saved override (or one
  // marked inactive) just falls through to `base` unchanged.
  let cfg = base;
  let override = null;
  try {
    const { queryOne } = require('./db');
    override = await queryOne('SELECT * FROM document_templates WHERE doc_type=? AND is_active=1', [kind]);
  } catch { /* table may not exist yet on an un-migrated install — fall back silently */ }
  if (override) {
    cfg = {
      ...base,
      title: override.title || base.title,
      sign: override.sign_labels ? JSON.parse(override.sign_labels) : base.sign,
    };
  }

  const dir  = path.join(UPLOAD_DIR, cfg.folder);
  ensureDir(dir);
  const file = path.join(dir, `${cfg.folder}_${fileSlug(data.docNo)}_${Date.now()}.pdf`);

  // Pull the "headline" party name, a date, and a status out of whichever
  // block fields happen to carry them (every doc type names these fields
  // slightly differently — Client/Supplier/Claimant/Employee, Date/
  // Calibration Date/etc) rather than hardcoding per doc type.
  const allFields = Object.values(data.blocks || {}).flatMap(f => Object.entries(f || {}));
  const partyName = allFields.find(([k]) => /name/i.test(k))?.[1];
  const dateField = allFields.find(([k]) => /^date$|date$/i.test(k))?.[1];
  const statusField = allFields.find(([k]) => /status/i.test(k))?.[1];
  const headlineTotal = data.totals?.length ? data.totals[data.totals.length - 1] : null;

  const qrBuffer = await getQrBuffer(buildQrText([
    `${_company.legal_name || 'Qalibrated Systems Limited'}`,
    `${cfg.title}`,
    `Doc No: ${data.docNo || '—'}`,
    partyName && `Party: ${partyName}`,
    dateField && `Date: ${dateField}`,
    headlineTotal && `${headlineTotal.label}: ${headlineTotal.value}`,
    statusField && `Status: ${statusField}`,
    `Verify: ${_company.email || 'info@qalibrated.co.ke'}`,
  ]));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const ws  = fs.createWriteStream(file);
    doc.pipe(ws);

    // Optional third header line (e.g. "Date Issued: 26 June 2026") and a
    // bordered status badge (e.g. "Valid until 10 July 2026", "Due 26 July
    // 2026", "✓ Approved") — both opt-in per call site via data.headerDate /
    // data.headerBadge, matching the original Quote/Invoice/Credit Note
    // templates' header layout. Docs that don't pass these just get the
    // plain title + doc number, same as before.
    const headerExtra = {
      date: data.headerDate || null,
      badge: data.headerBadge || null,
      badgeVariant: data.headerBadgeVariant || 'amber',
    };
    addHeader(doc, cfg.title, data.docNo || '', qrBuffer, headerExtra);
    let y = 157;

    // Every section after the line-item table (payment details, terms,
    // disclaimer, signature strip) used to just keep adding to `y` with no
    // check against the page bottom. The table loop already guards itself
    // (see `if (y + rowH > doc.page.height - 160) { doc.addPage(); ... }`),
    // but nothing after it did — so a document with a long terms list or
    // notes field could push `y` past PDFKit's own auto-pagination
    // threshold. PDFKit then silently inserts a page break on whichever
    // .text() call crosses that line, but our own `y` bookkeeping has no
    // way to know that happened and keeps computing coordinates against
    // the page we *think* we're on — which is how the signature strip
    // ended up orphaned onto a near-blank new page, directly colliding
    // with the footer (fixed at `doc.page.height - 92` on whatever page is
    // current) into unreadable overlapping text. Call this before any
    // fixed-height section to force our bookkeeping and PDFKit's actual
    // page to move together, on our terms, before it happens by accident.
    const ensureRoom = (neededHeight) => {
      if (y + neededHeight > doc.page.height - 160) {
        doc.addPage();
        y = 50;
      }
    };

    // Two-block info section (e.g. Supplier / Delivery, Client / Validity).
    // Each field's vertical advance is measured from its actual wrapped
    // text height rather than assumed to be a single line — a long value
    // (e.g. a multi-line Purpose) pushes the next field down instead of
    // silently overlapping it.
    const blockEntries = Object.entries(data.blocks || {});
    if (blockEntries.length) {
      const colW = blockEntries.length > 1 ? 237 : 495;
      const valueWidth = colW - 4;
      let maxBlockHeight = 0;
      blockEntries.slice(0, 2).forEach(([label, fields], i) => {
        const x = 50 + i * (colW + 8);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text(label.toUpperCase(), x, y);
        doc.moveTo(x, y + 12).lineTo(x + colW, y + 12).strokeColor(GOLD).lineWidth(1.2).stroke();
        let fy = y + 18;
        Object.entries(fields || {}).forEach(([k, v]) => {
          const valueText = String(v ?? '—');
          doc.font('Helvetica').fontSize(7.5).fillColor(GREY).text(String(k).toUpperCase(), x, fy);
          doc.font('Helvetica-Bold').fontSize(9);
          const valueHeight = doc.heightOfString(valueText, { width: valueWidth });
          doc.fillColor(DKGREY).text(valueText, x, fy + 9, { width: valueWidth });
          fy += Math.max(26, valueHeight + 9 + 8);
        });
        maxBlockHeight = Math.max(maxBlockHeight, fy - (y + 18));
      });
      y += 18 + maxBlockHeight + 14;
    }

    // Line-item table — a row-number "#" column is added automatically
    // ahead of whatever columns the caller supplies, matching every
    // original QSL_*_Template's numbered line-item table.
    if (cfg.table && Array.isArray(data.columns) && Array.isArray(data.rows)) {
      const usableWidth = 495;
      const numColW = 22;
      const tableColumns = [{ label: '#', key: '__rownum', weight: 0, fixedWidth: numColW, align: 'center' }, ...data.columns];
      const totalWeight = data.columns.reduce((s, c) => s + (c.weight || 1), 0);
      const flexWidth = usableWidth - numColW;
      let cursorX = 50;
      const colX = [];
      const colW = [];
      tableColumns.forEach(c => {
        colX.push(cursorX);
        const w = c.fixedWidth || (flexWidth * (c.weight || 1)) / totalWeight;
        colW.push(w);
        cursorX += w;
      });

      const drawTableHeader = (atY) => {
        doc.rect(50, atY, usableWidth, 20).fill(NAVY);
        tableColumns.forEach((c, i) => {
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
            .text(c.label, colX[i] + 5, atY + 6, { width: colW[i] - 8, align: c.align || 'left' });
        });
        return atY + 20;
      };

      y = drawTableHeader(y);
      let rowsOnPage = 0;
      const maxRows = cfg.maxRowsPerPage || Infinity;

      data.rows.forEach((row, i) => {
        // Measure how tall this row actually needs to be — the widest-
        // wrapping cell (almost always a free-text Description/Reason
        // column) decides the row height, instead of every row silently
        // assuming a single line and clipping/overlapping the next row.
        let maxCellHeight = 12;
        const cellValues = tableColumns.map((c, ci) => {
          const val = c.key === '__rownum' ? i + 1 : (c.format ? c.format(row[c.key], row) : (row[c.key] ?? '—'));
          const text = String(val);
          doc.font(ci === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
          maxCellHeight = Math.max(maxCellHeight, doc.heightOfString(text, { width: colW[ci] - 8 }));
          return text;
        });
        const rowH = Math.max(18, maxCellHeight + 8);

        if (y + rowH > doc.page.height - 160 || rowsOnPage >= maxRows) {
          doc.addPage();
          y = 50;
          y = drawTableHeader(y);
          rowsOnPage = 0;
        }
        if (rowsOnPage % 2 === 0) doc.rect(50, y, usableWidth, rowH).fill('#F8FAFC');
        tableColumns.forEach((c, ci) => {
          doc.font(ci === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(ci === 0 ? GREY : DKGREY)
            .text(cellValues[ci], colX[ci] + 5, y + 5, { width: colW[ci] - 8, align: c.align || 'left' });
        });
        y += rowH;
        rowsOnPage++;
      });
      y += 10;

      // Totals — every row except the last prints as plain text with a
      // hairline rule beneath it; the last (grand total / total due / total
      // credit) gets the bold navy bar with a large gold figure, matching
      // every original template's emphasis treatment.
      (data.totals || []).forEach((t, i) => {
        const isLast = i === (data.totals.length - 1);
        if (isLast) {
          doc.rect(50, y, usableWidth, 26).fill(NAVY);
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text(t.label, 62, y + 7);
          doc.font('Helvetica-Bold').fontSize(13).fillColor(GOLD).text(String(t.value), 50, y + 6, { width: usableWidth - 12, align: 'right' });
          y += 26;
        } else {
          doc.font('Helvetica').fontSize(9).fillColor(DKGREY).text(t.label, 305, y + 3, { width: 120 });
          doc.font('Helvetica-Bold').fontSize(9).fillColor(DKGREY).text(String(t.value), 305, y + 3, { width: usableWidth - 255, align: 'right' });
          y += 17;
          doc.moveTo(305, y).lineTo(545, y).strokeColor(LGREY).lineWidth(0.5).stroke();
        }
      });
      y += 16;
    }

    // Free-text body (non-tabular docs: NDA, leave application, reports, etc.)
    if (!cfg.table && Array.isArray(data.body)) {
      data.body.forEach(p => {
        doc.font('Helvetica').fontSize(9.5).fillColor(DKGREY).text(p, 50, y, { width: 495, align: 'left' });
        y = doc.y + 10;
      });
    }

    const sectionHeading = (label) => {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(label, 50, y);
      doc.moveTo(50, y + 13).lineTo(110, y + 13).strokeColor(GOLD).lineWidth(1.5).stroke();
      y += 20;
    };

    if (data.notes) {
      sectionHeading('NOTES');
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY).text(data.notes, 50, y, { width: 495 });
      y = doc.y + 14;
    }

    // Payment details — bank/M-PESA info box, used by financial documents
    // (quote, invoice, debit/credit note) exactly as in the original
    // templates. Optional per call site via data.paymentDetails. Laid out
    // as inline "Label: value" segments that wrap manually — each
    // segment's width is measured explicitly with widthOfString before
    // drawing, rather than relying on PDFKit's continued-text x-tracking
    // (which doesn't survive a font-size/style change mid-line and was
    // producing overlapping, garbled text here).
    if (data.paymentDetails) {
      sectionHeading('PAYMENT DETAILS');
      const pairs = Object.entries(data.paymentDetails);
      const padX = 12, padY = 10, boxX = 50, boxW = 495, innerW = boxW - padX * 2;
      const lineH = 13;

      // Pre-compute wrapped line count so the box can be drawn at the
      // right height before any text is placed inside it.
      doc.font('Helvetica-Bold').fontSize(8);
      let measureX = 0, lines = 1;
      pairs.forEach(([k, v], i) => {
        const segments = [[`${k}: `, true], [String(v) + (i < pairs.length - 1 ? '   ·   ' : ''), false]];
        segments.forEach(([txt, bold]) => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
          const w = doc.widthOfString(txt);
          if (measureX + w > innerW) { lines++; measureX = 0; }
          measureX += w;
        });
      });
      const boxH = lines * lineH + padY * 2;
      ensureRoom(boxH);
      doc.rect(boxX, y, boxW, boxH).fill('#F8FAFC');

      let cx = boxX + padX, cy = y + padY;
      pairs.forEach(([k, v], i) => {
        const segments = [[`${k}: `, true], [String(v) + (i < pairs.length - 1 ? '   ·   ' : ''), false]];
        segments.forEach(([txt, bold]) => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(DKGREY);
          const w = doc.widthOfString(txt);
          if (cx + w > boxX + boxW - padX) { cy += lineH; cx = boxX + padX; }
          doc.text(txt, cx, cy, { lineBreak: false });
          cx += w;
        });
      });
      y += boxH + 14;
    }

    // Terms & conditions — a saved override (Admin → Document Templates)
    // takes priority; otherwise fall back to the document type's sensible
    // numbered default, matching the original templates' "Dear valued
    // customer," + numbered list + italic disclaimer structure.
    const termsLines = override?.terms_text
      ? override.terms_text.split(/\n+/).filter(Boolean)
      : (cfg.defaultTerms || null);
    if (termsLines && termsLines.length) {
      sectionHeading('TERMS & CONDITIONS');
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY).text('Dear valued customer,', 50, y);
      y = doc.y + 4;
      termsLines.forEach((line, i) => {
        doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY).text(`${i + 1}. ${line}`, 58, y, { width: 487 });
        y = doc.y + 3;
      });
      y += 4;
      if (cfg.disclaimer) {
        doc.moveTo(50, y).lineTo(545, y).strokeColor(LGREY).lineWidth(0.5).stroke();
        y += 6;
        doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(GREY).text(cfg.disclaimer, 50, y, { width: 495 });
        y = doc.y + 12;
      }
    }

    // Signature strip — ensureRoom guarantees at least (signature height +
    // footer's ~92pt reserved zone) of clearance before drawing, forcing a
    // fresh page first if `y` is already too close to the bottom. Without
    // this, a document whose content ran long (a lengthy terms list, a
    // large payment-details box) could leave `y` sitting right at the page
    // edge — Math.max(y + 20, ...) would then place the signature line and
    // "Prepared by"/"Approved by" labels within a few points of the fixed-
    // position footer drawn immediately after, the two overlapping into
    // unreadable garbled text exactly where the signature block met
    // "Qalibrated Systems Limited" in the footer.
    if (cfg.sign.length) {
      ensureRoom(60);
      const sigY = Math.max(y + 20, doc.page.height - 140);
      const sigW = 495 / cfg.sign.length;
      cfg.sign.forEach((label, i) => {
        const x = 50 + i * sigW;
        doc.moveTo(x, sigY + 30).lineTo(x + sigW - 20, sigY + 30).strokeColor(DKGREY).lineWidth(0.7).stroke();
        doc.font('Helvetica').fontSize(8).fillColor(GREY).text(label, x, sigY + 34);
      });
    }

    addFooter(doc, override?.footer_note, qrBuffer);
    doc.end();

    ws.on('finish', () => resolve({ path: file, url: `/uploads/${cfg.folder}/${path.basename(file)}` }));
    ws.on('error', reject);
  });
}

// ── PAYSLIP PDF ───────────────────────────────────────────────────────────────

async function generatePayslip(employee, payslip, period) {
  const dir  = path.join(UPLOAD_DIR, 'payslips');
  ensureDir(dir);
  const file = path.join(dir, `payslip_${employee.emp_no}_${period.replace('-', '_')}.pdf`);
  const qrBuffer = await getQrBuffer(buildQrText([
    `${_company.legal_name || 'Qalibrated Systems Limited'}`,
    'PAYSLIP',
    `Employee: ${employee.name || employee.emp_no}`,
    `Emp No: ${employee.emp_no}`,
    `Period: ${period}`,
    `Net Pay: Kshs ${Number(payslip.net_pay || 0).toLocaleString('en-KE')}`,
    `Verify: ${_company.email || 'info@qalibrated.co.ke'}`,
  ]));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const ws  = fs.createWriteStream(file);
    doc.pipe(ws);

    let y = addHeader(doc, 'PAYSLIP', period, qrBuffer);
    y = 157;

    // Employee details box
    doc.rect(50, y, 495, 70).fillColor('#F0F4F8').fill();
    doc.rect(50, y, 495, 70).strokeColor(LGREY).lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(employee.first_name + ' ' + employee.last_name, 65, y + 12);
    doc.font('Helvetica').fontSize(8).fillColor(DKGREY)
      .text(`Employee No: ${employee.emp_no}`, 65, y + 26)
      .text(`Department: ${employee.department}`, 65, y + 38)
      .text(`Role: ${employee.role}`, 65, y + 50);
    doc.font('Helvetica').fontSize(8).fillColor(DKGREY)
      .text(`KRA PIN: ${employee.kra_pin || '—'}`, 310, y + 26)
      .text(`NHIF No: ${employee.nhif_no || '—'}`, 310, y + 38)
      .text(`NSSF No: ${employee.nssf_no || '—'}`, 310, y + 50)
      .text(`Pay Date: ${dateStr(new Date())}`, 310, y + 62 - 12);

    y += 85;

    // Earnings section
    doc.rect(50, y, 495, 18).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text('EARNINGS', 65, y + 5);
    y += 18;

    const earnings = [
      ['Basic Salary', payslip.basic_salary],
      ['Allowances', payslip.allowances || 0],
    ];
    earnings.forEach(([label, amount], i) => {
      if (i % 2 === 0) doc.rect(50, y, 495, 18).fillColor('#F8FAFC').fill();
      doc.font('Helvetica').fontSize(9).fillColor(DKGREY)
        .text(label, 65, y + 5)
        .text(kes(amount), 0, y + 5, { align: 'right', width: 540 });
      y += 18;
    });

    // Gross
    doc.rect(50, y, 495, 22).fillColor('#E8F5E9').fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN)
      .text('GROSS PAY', 65, y + 6)
      .text(kes(payslip.gross_pay), 0, y + 6, { align: 'right', width: 540 });
    y += 28;

    // Deductions
    doc.rect(50, y, 495, 18).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text('STATUTORY DEDUCTIONS', 65, y + 5);
    y += 18;

    const deductions = [
      ['PAYE (Income Tax)', payslip.paye, 'KRA — computed on progressive bands'],
      ['NHIF / SHIF', payslip.nhif, '2.75% of gross — NHIF/SHIF'],
      ['NSSF (Tier I + II)', payslip.nssf, '6% on Tier I (≤7,000) + 6% on Tier II (≤36,000)'],
      ['Affordable Housing Levy', payslip.housing_levy, '1.5% of gross (Finance Act 2023)'],
    ];
    if (payslip.imprest_deductions > 0) deductions.push(['Imprest Recovery', payslip.imprest_deductions, 'Outstanding imprest advance recovery']);
    if (payslip.other_deductions > 0)   deductions.push(['Other Deductions', payslip.other_deductions, '']);

    deductions.forEach(([label, amount, note], i) => {
      if (i % 2 === 0) doc.rect(50, y, 495, 22).fillColor('#FFF8F8').fill();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(RED).text(`(${kes(amount)})`, 0, y + 5, { align: 'right', width: 540 });
      doc.font('Helvetica').fontSize(9).fillColor(DKGREY).text(label, 65, y + 5);
      if (note) doc.font('Helvetica').fontSize(7).fillColor(GREY).text(note, 65, y + 15);
      y += (note ? 24 : 18);
    });

    // Total deductions
    const totalDed = payslip.total_deductions || (payslip.paye + payslip.nhif + payslip.nssf + payslip.housing_levy + (payslip.imprest_deductions||0) + (payslip.other_deductions||0));
    doc.rect(50, y, 495, 20).fillColor('#FEE2E2').fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(RED)
      .text('TOTAL DEDUCTIONS', 65, y + 6)
      .text(`(${kes(totalDed)})`, 0, y + 6, { align: 'right', width: 540 });
    y += 26;

    // Net pay — big box
    doc.rect(50, y, 495, 40).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD).text('NET PAY', 65, y + 14);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD).text(kes(payslip.net_pay), 0, y + 14, { align: 'right', width: 540 });
    y += 50;

    // Employer contributions note
    doc.rect(50, y, 495, 50).fillColor('#F0F4F8').fill();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text('EMPLOYER CONTRIBUTIONS (not deducted from salary)', 65, y + 8);
    doc.font('Helvetica').fontSize(8).fillColor(DKGREY)
      .text(`NSSF Employer:  ${kes(payslip.employer_nssf || payslip.nssf)}`, 65, y + 22)
      .text(`Housing Levy Employer:  ${kes(payslip.employer_housing || payslip.housing_levy)}`, 250, y + 22);
    y += 60;

    // Digital signature notice
    doc.font('Helvetica').fontSize(7).fillColor(GREY)
      .text('This payslip is digitally signed and verified by QSL ERP (ARCH-007B). For disputes contact HR within 5 working days of receipt.', 50, y, { width: 495, align: 'center' });

    addFooter(doc, null, qrBuffer);
    doc.end();

    ws.on('finish', () => resolve({ path: file, url: `/uploads/payslips/${path.basename(file)}` }));
    ws.on('error', reject);
  });
}

// ── TAX INVOICE PDF ───────────────────────────────────────────────────────────

async function generateInvoice(invoice, client, lines) {
  const dir  = path.join(UPLOAD_DIR, 'invoices');
  ensureDir(dir);
  const file = path.join(dir, `invoice_${invoice.invoice_no.replace(/\//g,'_')}.pdf`);
  const qrBuffer = await getQrBuffer(buildQrText([
    `${_company.legal_name || 'Qalibrated Systems Limited'}`,
    'TAX INVOICE',
    `Invoice No: ${invoice.invoice_no}`,
    `Client: ${client?.name || '—'}`,
    `Date: ${invoice.date || '—'}`,
    `Total: Kshs ${Number(invoice.total || 0).toLocaleString('en-KE')}`,
    `Verify: ${_company.email || 'info@qalibrated.co.ke'}`,
  ]));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const ws  = fs.createWriteStream(file);
    doc.pipe(ws);

    let y = addHeader(doc, 'TAX INVOICE', invoice.invoice_no, qrBuffer);
    y = 157;

    // Invoice meta + client info
    doc.rect(50, y, 240, 80).fillColor('#F8FAFC').fill().rect(50, y, 240, 80).strokeColor(LGREY).lineWidth(0.5).stroke();
    doc.rect(305, y, 240, 80).fillColor('#F8FAFC').fill().rect(305, y, 240, 80).strokeColor(LGREY).lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text('BILL TO', 65, y + 10);
    doc.font('Helvetica').fontSize(9).fillColor(DKGREY)
      .text(client.name, 65, y + 22)
      .text(client.address || '', 65, y + 34, { width: 210 })
      .text(`KRA PIN: ${client.kra_pin || 'N/A'}`, 65, y + 58);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text('INVOICE DETAILS', 320, y + 10);
    doc.font('Helvetica').fontSize(9).fillColor(DKGREY)
      .text(`Invoice No:`, 320, y + 22).text(invoice.invoice_no, 395, y + 22, { align: 'right', width: 140 })
      .text(`Date:`, 320, y + 34).text(dateStr(invoice.date), 395, y + 34, { align: 'right', width: 140 })
      .text(`Due Date:`, 320, y + 46).text(dateStr(invoice.due_date) || '30 days', 395, y + 46, { align: 'right', width: 140 })
      .text(`Currency:`, 320, y + 58).text('KES', 395, y + 58, { align: 'right', width: 140 });

    y += 95;

    // Line items table header
    doc.rect(50, y, 495, 20).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
      .text('DESCRIPTION', 65, y + 6)
      .text('QTY', 340, y + 6)
      .text('UNIT PRICE', 380, y + 6)
      .text('VAT CAT', 440, y + 6)
      .text('AMOUNT', 490, y + 6, { align: 'right', width: 50 });
    y += 20;

    (lines || []).forEach((line, i) => {
      const rowH = 22;
      if (i % 2 === 0) doc.rect(50, y, 495, rowH).fillColor('#FAFAFA').fill();
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY)
        .text(line.description, 65, y + 6, { width: 270 })
        .text(String(line.quantity || 1), 340, y + 6)
        .text(kes(line.unit_price || line.amount), 375, y + 6)
        .text(line.vat_category || 'A', 447, y + 6)
        .text(kes(line.amount || line.exclusive), 490, y + 6, { align: 'right', width: 50 });
      y += rowH;
    });

    // Totals
    y += 5;
    drawHRule(doc, y);
    y += 8;

    const subtotal   = invoice.subtotal || lines.reduce((s, l) => s + (l.amount || l.exclusive || 0), 0);
    const vatAmount  = invoice.vat_amount || 0;
    const total      = invoice.total || subtotal + vatAmount;

    [['Subtotal (excl. VAT)', subtotal], ['VAT @ 16%', vatAmount]].forEach(([label, amount]) => {
      doc.font('Helvetica').fontSize(9).fillColor(DKGREY)
        .text(label, 350, y)
        .text(kes(amount), 0, y, { align: 'right', width: 540 });
      y += 16;
    });

    doc.rect(50, y, 495, 28).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD)
      .text('TOTAL DUE', 65, y + 9)
      .text(kes(total), 0, y + 9, { align: 'right', width: 540 });
    y += 36;

    // KRA eTIMS info
    doc.rect(50, y, 495, 32).fillColor('#F0F9F4').fill().rect(50, y, 495, 32).strokeColor('#86EFAC').lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN).text('KRA eTIMS', 65, y + 8);
    doc.font('Helvetica').fontSize(7.5).fillColor(DKGREY)
      .text(`CU Invoice No: ${invoice.etims_cu_no || 'Pending submission'}`, 65, y + 20)
      .text(`QSL KRA PIN: ${_company.kra_pin}`, 280, y + 20);
    y += 40;

    // Payment details
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text('PAYMENT INSTRUCTIONS', 50, y);
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor(DKGREY)
      .text('Bank Transfer: Equity Bank Kenya · A/C: [Account Number] · Branch: [Branch]', 50, y)
      .text(`M-PESA Paybill: ${process.env.MPESA_SHORTCODE || '[Paybill]'} · Account: ${invoice.invoice_no}`, 50, y + 12);

    addFooter(doc, null, qrBuffer);
    doc.end();

    ws.on('finish', () => resolve({ path: file, url: `/uploads/invoices/${path.basename(file)}` }));
    ws.on('error', reject);
  });
}

// ── CALIBRATION CERTIFICATE PDF ───────────────────────────────────────────────

async function generateCalibrationCert(cert, client, technician, refStandard) {
  const dir  = path.join(UPLOAD_DIR, 'certificates');
  ensureDir(dir);
  const file = path.join(dir, `cert_${cert.cert_no.replace(/\//g,'_')}.pdf`);
  const techName = technician?.first_name ? `${technician.first_name} ${technician.last_name}` : '—';
  const qrBuffer = await getQrBuffer(buildQrText([
    `${_company.legal_name || 'Qalibrated Systems Limited'}`,
    'CALIBRATION CERTIFICATE',
    `Cert No: ${cert.cert_no}`,
    `Instrument: ${cert.instrument || '—'}`,
    cert.serial_no && `Serial No: ${cert.serial_no}`,
    `Client: ${client?.name || '—'}`,
    `Calibrated: ${dateStr(cert.calibrated_at)} by ${techName}`,
    `Expires: ${dateStr(cert.next_cal_date)}`,
    `Result: ${(cert.result === 'pass' || cert.result === 'adjusted') ? 'PASS' : 'FAIL'}`,
    `KENAS CL/059 | Verify online:`,
    `${_company.site_url || 'https://qalibrated.co.ke'}/verify/${encodeURIComponent(cert.cert_no)}`,
  ]));
  const docCode = cert.cert_no || 'QSL/QP/19/CERT';
  const checkerName = cert.checked_by_name || '________________';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const ws  = fs.createWriteStream(file);
    doc.pipe(ws);

    const runningHeader = (page, total) => {
      doc.font('Helvetica-Oblique').fontSize(7).fillColor(GREY)
        .text('ISO/IEC 17025 Calibration Laboratory — KENAS Accredited CL/059', 50, 30)
        .text(`Document generated by QSL-CMS`, 0, 30, { align: 'right', width: 495 });
      const logo = getLogoBuffer();
      if (logo) {
        doc.image(logo, 50, 44, { width: 88 });
      } else {
        doc.font('Helvetica-Bold').fontSize(20).fillColor(GOLD).text('QSL', 50, 44);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(_company.legal_name, 95, 48);
      }
      doc.font('Helvetica-Bold').fontSize(7).fillColor(DKGREY).text('ilac-MRA', 0, 44, { align: 'right', width: 420 });
      doc.font('Helvetica-Bold').fontSize(7).fillColor(NAVY).text('KENAS CL/059', 0, 56, { align: 'right', width: 420 });
      if (qrBuffer) doc.image(qrBuffer, 497, 40, { width: 48, height: 48 });
      drawHRule(doc, 130, LGREY);
      // "Page X of Y" is added in a final pass after all content is drawn
      // (see below doc.end()) — the true total page count for a
      // certificate with a long results table (e.g. 50 mass items
      // spanning 3 pages) isn't known until rendering finishes.
    };

    const runningFooter = () => {
      const bottom = doc.page.height - 100;
      doc.rect(50, bottom, 495, 1).fill(GOLD);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(DKGREY)
        .text(`${_company.legal_name} - QSL CENTRE, ${_company.address}`, 50, bottom + 6, { width: 495, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(7).fillColor(GREY)
        .text(`P.O Box 34463-00100 GPO Nairobi Kenya  Cell: ${_company.phone}`, 50, bottom + 15, { width: 495, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(6.5).fillColor(GREY)
        .text(`Mail: ${_company.email}`, 50, bottom + 24, { width: 495, align: 'center', lineBreak: false });
      doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(GREY)
        .text(`${docCode} — This is a system-generated certificate, validated with digital signatures.`, 50, bottom + 33, { width: 495, align: 'center', lineBreak: false });
    };

    // ── PAGE 1 ──────────────────────────────────────────────────────────────
    runningHeader(1, 2);
    let y = 148;

    doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('CALIBRATION CERTIFICATE', 50, y);
    doc.rect(50, y + 22, 130, 2).fill(GOLD);
    y += 30;
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(DKGREY).text(cert.instrument || 'Instrument Calibration', 50, y);
    y += 20;

    // Object-of-calibration info box
    const infoRows = [
      ['CERTIFICATE NO.', cert.cert_no],
      ['REQUESTED BY', client?.name || '—'],
      ['ADDRESS', client?.address || '—'],
      ['EQUIPMENT', cert.instrument || '—'],
      ['TYPE / MODEL', cert.model || '—'],
      ['MANUFACTURER', cert.make || '—'],
      ['SERIAL NUMBER', cert.serial_no || '—'],
      ['LOCATION', cert.location || 'QSL Calibration Laboratory'],
      ['CALIBRATION DATE', dateNum(cert.calibrated_at)],
      ['CERTIFICATE EXPIRY', dateNum(cert.next_cal_date)],
    ];
    const boxH = infoRows.length * 16 + 10;
    doc.rect(50, y, 495, boxH).fill('#F0F2F5');
    infoRows.forEach(([label, value], i) => {
      const ry = y + 8 + i * 16;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(DKGREY).text(label, 62, ry);
      doc.font('Helvetica').fontSize(8).fillColor(NAVY).text(String(value ?? '—'), 230, ry, { width: 300 });
    });
    y += boxH + 16;

    const sectionHeader = (num, title) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(`${num} ${title}`, 50, y);
      doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(LGREY).lineWidth(0.6).stroke();
      y += 18;
    };
    const para = (text) => {
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY).text(text, 50, y, { width: 495, align: 'justify' });
      y = doc.y + 6;
    };

    sectionHeader('1.0', 'REFERENCE STANDARDS AND EQUIPMENT USED');
    para(`The instrument was calibrated against ${refStandard?.name || 'a calibrated reference standard'}` +
      (refStandard?.traceable_to ? `, traceable to ${refStandard.traceable_to} national standards.` : '.'));

    sectionHeader('2.0', 'METROLOGICAL TRACEABILITY');
    para('This calibration certificate documents traceability to the national measurement standards, and to the units of measurement realized at KEBS, or other recognized national standards laboratories, according to the International System of Units (SI).');

    sectionHeader('3.0', 'CALIBRATION PROCEDURE');
    para(cert.procedure_ref || `QSL/QP/19 — Standard QSL Calibration Procedure for ${cert.instrument || 'this instrument class'}.`);

    sectionHeader('4.0', 'ENVIRONMENTAL CONDITIONS');
    const envY = y;
    const hasEnd = cert.temp_c_end != null || cert.humidity_pct_end != null;
    doc.rect(50, envY, 247, 30).fill('#F8FAFC').rect(50, envY, 247, 30).strokeColor(LGREY).lineWidth(0.5).stroke();
    doc.rect(298, envY, 247, 30).fill('#F8FAFC').rect(298, envY, 247, 30).strokeColor(LGREY).lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREY).text(hasEnd ? 'TEMPERATURE (START -> END)' : 'TEMPERATURE', 62, envY + 6);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(
      cert.temp_c ? `${cert.temp_c} °C${hasEnd && cert.temp_c_end != null ? ` -> ${cert.temp_c_end} °C` : ''}` : '—', 62, envY + 16);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREY).text(hasEnd ? 'RELATIVE HUMIDITY (START -> END)' : 'RELATIVE HUMIDITY', 310, envY + 6);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(
      cert.humidity_pct ? `${cert.humidity_pct} %${hasEnd && cert.humidity_pct_end != null ? ` -> ${cert.humidity_pct_end} %` : ''}` : '—', 310, envY + 16);
    y = envY + 40;

    sectionHeader('5.0', 'VALIDITY AND AUTHORIZATION');
    const sigY = y;
    const colW = 165;
    ['VALIDITY', 'TECHNICAL SIGNATORY', 'AUTHORISED SIGNATORY'].forEach((h, i) => {
      doc.rect(50 + i * colW, sigY, colW - (i < 2 ? 2 : 0), 20).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(h, 50 + i * colW, sigY + 6, { width: colW, align: 'center' });
    });
    const sigBoxY = sigY + 20;
    doc.rect(50, sigBoxY, colW * 3, 50).strokeColor(LGREY).lineWidth(0.5).stroke();
    doc.moveTo(50 + colW, sigBoxY).lineTo(50 + colW, sigBoxY + 50).strokeColor(LGREY).lineWidth(0.5).stroke();
    doc.moveTo(50 + colW * 2, sigBoxY).lineTo(50 + colW * 2, sigBoxY + 50).strokeColor(LGREY).lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(cert.next_cal_date ? `Expires ${dateNum(cert.next_cal_date)}` : (cert.validity_note || '—'), 58, sigBoxY + 18, { width: colW - 16, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text(techName, 58 + colW, sigBoxY + 30, { width: colW - 16, align: 'center' });
    doc.moveTo(58 + colW, sigBoxY + 27).lineTo(58 + colW + colW - 16, sigBoxY + 27).strokeColor(DKGREY).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(GREY).text(`[${dateNum(cert.calibrated_at)}]`, 58 + colW, sigBoxY + 40, { width: colW - 16, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text(checkerName, 58 + colW * 2, sigBoxY + 30, { width: colW - 16, align: 'center' });
    doc.moveTo(58 + colW * 2, sigBoxY + 27).lineTo(58 + colW * 2 + colW - 16, sigBoxY + 27).strokeColor(DKGREY).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(GREY).text(`[${cert.checked_at ? dateNum(cert.checked_at) : 'pending'}]`, 58 + colW * 2, sigBoxY + 40, { width: colW - 16, align: 'center' });
    y = sigBoxY + 64;

    doc.rect(50, y, 495, 24).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff')
      .text('This certificate was issued without any erasure or alteration whatsoever', 50, y + 8, { width: 495, align: 'center' });

    runningFooter();
    doc.addPage();

    // ── PAGE 2 — MEASUREMENT RESULTS ─────────────────────────────────────────
    runningHeader(2, 2);
    y = 148;
    sectionHeaderP2(doc, y, '6.0', 'MEASUREMENT RESULTS'); y += 18;

    const passed = cert.result === 'pass' || cert.result === 'adjusted';
    const isNawi = cert.instrument_type === 'nawi' && cert.nawi;
    const isMass = cert.instrument_type === 'mass' && Array.isArray(cert.massItems) && cert.massItems.length;
    const ensureRoom = (needed) => { if (y + needed > doc.page.height - 110) { runningFooter(); doc.addPage(); runningHeader(2, 2); y = 148; } };

    const drawTableHeaderRow = (cols) => {
      let cx = 50;
      doc.rect(50, y, 495, 24).fill(NAVY);
      cols.forEach(c => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff').text(c.label, cx + 4, y + 4, { width: c.w - 6 }); cx += c.w; });
      y += 24;
    };
    const drawTable = (cols, rows, rowColor) => {
      drawTableHeaderRow(cols);
      rows.forEach((r, ri) => {
        if (y + 16 > doc.page.height - 110) {
          runningFooter(); doc.addPage(); runningHeader(2, 2); y = 148;
          drawTableHeaderRow(cols);
        }
        if (ri % 2 === 0) doc.rect(50, y, 495, 16).fill('#F8FAFC');
        let cx = 50;
        cols.forEach((c, ci) => {
          doc.font('Helvetica').fontSize(7.5).fillColor(rowColor ? rowColor(r) : DKGREY).text(String(r[ci] ?? '—'), cx + 4, y + 4, { width: c.w - 6 });
          cx += c.w;
        });
        y += 16;
      });
      y += 10;
    };

    if (isMass) {
      // OIML R111:2004 — one row per individually calibrated mass standard,
      // matching the official QSL_CERT-MASS certificate exactly.
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY)
        .text(`Results below relate to the ${cert.massItems.length} individually calibrated mass standards, identified by item number.`, 50, y, { width: 495 });
      y = doc.y + 10;
      drawTable(
        [{ label: 'ITEM NO.', w: 65 }, { label: 'NOMINAL MASS / MARKING', w: 175 }, { label: 'CONVENTIONAL MASS ERROR', w: 130 }, { label: 'ERROR LIMIT (± g)', w: 65 }, { label: 'UNCERTAINTY (± g)', w: 60 }],
        cert.massItems.map(m => [m.item_no, m.nominal_mass, m.error, m.error_limit, m.uncertainty])
      );
      ensureRoom(20);
      doc.rect(50, y, 495, 22).fill(passed ? '#F0FFF4' : '#FFF0F0');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(passed ? GREEN : RED)
        .text(passed ? 'OVERALL RESULT: PASS — all items within specified tolerance' : 'OVERALL RESULT: FAIL — see items above', 60, y + 6);
      y += 32;
    } else if (isNawi) {
      // EURAMET cg-18 §8.3 — error of indication at each applied test load
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY)
        .text('Error of indication — results at each applied test load (EURAMET cg-18 §4 step 4):', 50, y, { width: 495 });
      y = doc.y + 8;
      drawTable(
        [{ label: 'TEST LOAD', w: 140 }, { label: 'INDICATION', w: 120 }, { label: 'ERROR', w: 110 }, { label: 'UNCERTAINTY (± k=2)', w: 125 }],
        cert.nawi.test_points.map(p => [p.test_load, p.indication ?? '—', p.error ?? '—', p.uncertainty ?? '—'])
      );

      ensureRoom(60);
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY)
        .text(`Eccentricity test (cg-18 §4 step 3):`, 50, y, { width: 495 });
      y = doc.y + 8;
      if (cert.nawi.eccentricity?.length) {
        drawTable(
          [{ label: 'POSITION', w: 165 }, { label: 'INDICATION', w: 165 }, { label: 'DEVIATION FROM CENTRE', w: 165 }],
          cert.nawi.eccentricity.map(e => [e.position, e.indication ?? '—', e.deviation ?? '—'])
        );
      } else {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(GREY).text('Omitted — construction-related restrictions make eccentric loading impossible.', 50, y, { width: 495 });
        y = doc.y + 14;
      }

      ensureRoom(50);
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY)
        .text(`Repeatability test (cg-18 §4 step 2) — ${cert.nawi.repeatability.length} readings of the same load:`, 50, y, { width: 495 });
      y = doc.y + 8;
      const repVals = cert.nawi.repeatability.map(r => r.indication).filter(v => v !== null && v !== undefined);
      drawTable(
        [{ label: '#', w: 40 }, ...cert.nawi.repeatability.map((_, i) => ({ label: `R${i + 1}`, w: Math.floor(455 / cert.nawi.repeatability.length) }))],
        [['Indication', ...repVals]]
      );
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
        .text(`Standard deviation: ${cert.repeatability_stdev != null ? Number(cert.repeatability_stdev).toFixed(4) : '—'}`, 50, y);
      if (cert.min_weight) doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(`Minimum weight: ${cert.min_weight}`, 300, y);
      y += 20;

      ensureRoom(20);
      doc.rect(50, y, 495, 22).fill(passed ? '#F0FFF4' : '#FFF0F0');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(passed ? GREEN : RED)
        .text(passed ? 'OVERALL RESULT: PASS — within declared tolerance class' : 'OVERALL RESULT: FAIL — outside declared tolerance class', 60, y + 6);
      y += 32;
    } else {
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY)
        .text('Results below relate to the item(s) identified in Section 1.0 of this certificate.', 50, y, { width: 495 });
      y += 22;
      const cols = [
        { label: 'PARAMETER', w: 110 }, { label: 'NOMINAL / RANGE', w: 110 },
        { label: 'READING / RESULT', w: 110 }, { label: 'UNCERTAINTY (± k=2)', w: 100 }, { label: 'PASS/FAIL', w: 65 },
      ];
      let cx = 50;
      doc.rect(50, y, 495, 20).fill(NAVY);
      cols.forEach(c => { doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(c.label, cx + 5, y + 6, { width: c.w - 8 }); cx += c.w; });
      y += 20;
      const row = [cert.instrument || '—', cert.range || '—', passed ? 'Within tolerance' : 'Out of tolerance', cert.uncertainty || '—', passed ? 'PASS' : 'FAIL'];
      cx = 50;
      doc.rect(50, y, 495, 22).fill('#F8FAFC');
      cols.forEach((c, i) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(i === 4 ? (passed ? GREEN : RED) : DKGREY)
          .text(row[i], cx + 5, y + 7, { width: c.w - 8 });
        cx += c.w;
      });
      y += 22 + 16;
    }

    ensureRoom(80);
    sectionHeaderP2(doc, y, '7.0', 'COMMENTS'); y += 18;
    [
      'The results in clause 6.0 relate only to the item(s) calibrated.',
      `All calibrated parameters ${passed ? 'fall within the specified tolerance.' : 'were assessed against the specified tolerance — see result above.'}`,
      'The reported expanded uncertainty is based on a standard uncertainty multiplied by a coverage factor k = 2, providing a level of confidence of approximately 95%, unless stated otherwise.',
    ].forEach((t, i) => {
      ensureRoom(20);
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY).text(`${i + 1}. ${t}`, 50, y, { width: 495 });
      y = doc.y + 4;
    });
    y += 8;

    ensureRoom(70);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('— END OF CERTIFICATE —', 50, y, { width: 495, align: 'center' });
    y += 24;

    doc.rect(50, y, 60, 14).fill('#FBBF24');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000').text('NOTE', 50, y + 4, { width: 60, align: 'center' });
    y += 18;
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(DKGREY)
      .text('This certificate shall not be reproduced except in full without the written approval of the Laboratory. Results relate only to the items calibrated.', 50, y, { width: 495 });

    runningFooter();

    // Final pass: now that every page has been drawn, the true total page
    // count is known — go back and stamp "Page X of Y" on each one.
    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor(GREY)
        .text(`Page ${i + 1} of ${pageRange.count}`, 0, 30, { align: 'right', width: 545, lineBreak: false });
    }

    doc.end();

    ws.on('finish', () => resolve({ path: file, url: `/uploads/certificates/${path.basename(file)}` }));
    ws.on('error', reject);
  });
}

function sectionHeaderP2(doc, y, num, title) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(`${num} ${title}`, 50, y);
  doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(LGREY).lineWidth(0.6).stroke();
}

// ── AGED DEBTORS REPORT PDF ───────────────────────────────────────────────────

async function generateAgedDebtorsReport(clients, generatedBy) {
  const dir  = path.join(UPLOAD_DIR, 'reports');
  ensureDir(dir);
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(dir, `aged_debtors_${date}.pdf`);
  const qrBuffer = await getQrBuffer(buildQrText([
    `${_company.legal_name || 'Qalibrated Systems Limited'}`,
    'AGED DEBTORS REPORT',
    `Generated: ${date}`,
    `Generated By: ${generatedBy || '—'}`,
    `Clients: ${clients?.length || 0}`,
    `Total Outstanding: Kshs ${(clients || []).reduce((s, c) => s + Number(c.outstanding || 0), 0).toLocaleString('en-KE')}`,
    `Verify: ${_company.email || 'info@qalibrated.co.ke'}`,
  ]));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, layout: 'landscape' });
    const ws  = fs.createWriteStream(file);
    doc.pipe(ws);

    addHeader(doc, 'AGED DEBTORS REPORT', `Generated: ${dateStr(new Date())} by ${generatedBy}`, qrBuffer);

    let y = 157;
    const total = clients.reduce((s, c) => s + (c.outstanding || 0), 0);

    // Summary box
    doc.rect(50, y, 745, 35).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD)
      .text(`Total Outstanding: ${kes(total)}`, 65, y + 13)
      .text(`${clients.length} Clients`, 0, y + 13, { align: 'right', width: 790 });
    y += 45;

    // Table header
    const cols = [65, 280, 390, 470, 560, 680];
    const headers = ['Client Name', 'Contact', 'Account Owner', 'Outstanding (Kshs)', 'Credit Limit', 'Status'];
    doc.rect(50, y, 745, 20).fillColor('#334155').fill();
    headers.forEach((h, i) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(h, cols[i], y + 6);
    });
    y += 20;

    clients.forEach((c, i) => {
      const rowH = 18;
      if (i % 2 === 0) doc.rect(50, y, 745, rowH).fillColor('#F8FAFC').fill();
      doc.font('Helvetica').fontSize(8).fillColor(DKGREY)
        .text(c.name, cols[0], y + 5, { width: 210 })
        .text(c.contact_person || '—', cols[1], y + 5, { width: 105 })
        .text(c.account_owner || '—', cols[2], y + 5, { width: 75 })
        .text(kes(c.outstanding), cols[3], y + 5, { width: 85 })
        .text(kes(c.credit_limit || 0), cols[4], y + 5, { width: 115 });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(c.outstanding > 0 ? RED : GREEN)
        .text(c.outstanding > 0 ? 'OUTSTANDING' : 'CLEARED', cols[5], y + 5);
      y += rowH;

      if (y > doc.page.height - 80) {
        doc.addPage({ layout: 'landscape' });
        y = 50;
      }
    });

    addFooter(doc, null, qrBuffer);
    doc.end();

    ws.on('finish', () => resolve({ path: file, url: `/uploads/reports/${path.basename(file)}` }));
    ws.on('error', reject);
  });
}

// ── AUDIT TRAIL EXPORT PDF ────────────────────────────────────────────────────

async function generateAuditTrail(entries, filters, generatedBy) {
  const dir  = path.join(UPLOAD_DIR, 'reports');
  ensureDir(dir);
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `audit_trail_${date}.pdf`);
  const qrBuffer = await getQrBuffer(buildQrText([
    `${_company.legal_name || 'Qalibrated Systems Limited'}`,
    'AUDIT TRAIL EXPORT',
    `Generated: ${date}`,
    `Generated By: ${generatedBy || '—'}`,
    `Entries: ${entries?.length || 0}`,
    filters && Object.keys(filters).length ? `Filters: ${Object.entries(filters).map(([k,v])=>`${k}=${v}`).join(', ')}` : null,
    `Verify: ${_company.email || 'info@qalibrated.co.ke'}`,
  ]));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, layout: 'landscape' });
    const ws  = fs.createWriteStream(file);
    doc.pipe(ws);

    addHeader(doc, 'AUDIT TRAIL EXPORT', `Generated: ${dateStr(new Date())} · ${entries.length} records · By: ${generatedBy}`, qrBuffer);

    let y = 157;
    if (filters) {
      doc.font('Helvetica').fontSize(8).fillColor(GREY)
        .text(`Filters — Module: ${filters.module || 'All'} | User: ${filters.user || 'All'} | Date: ${filters.from || '—'} to ${filters.to || '—'}`, 50, y);
      y += 20;
    }

    const cols = [50, 165, 255, 340, 440, 560];
    const headers = ['Timestamp', 'User', 'Module', 'Action', 'Record ID', 'Details'];
    doc.rect(50, y, 745, 20).fillColor(NAVY).fill();
    headers.forEach((h, i) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(h, cols[i], y + 6);
    });
    y += 20;

    entries.forEach((e, i) => {
      const rowH = 16;
      if (i % 2 === 0) doc.rect(50, y, 745, rowH).fillColor('#FAFAFA').fill();
      doc.font('Helvetica').fontSize(7).fillColor(DKGREY)
        .text(new Date(e.created_at).toLocaleString('en-KE'), cols[0], y + 4, { width: 110 })
        .text(e.user_name || '—', cols[1], y + 4, { width: 85 })
        .text(e.module, cols[2], y + 4, { width: 80 })
        .text(e.action, cols[3], y + 4, { width: 95 })
        .text(e.record_id ? e.record_id.slice(0, 12) + '…' : '—', cols[4], y + 4, { width: 115 })
        .text(e.new_value ? JSON.stringify(e.new_value).slice(0, 40) : '', cols[5], y + 4, { width: 185 });
      y += rowH;

      if (y > doc.page.height - 80) {
        doc.addPage({ layout: 'landscape' });
        y = 50;
        // Re-draw header on new page
        doc.rect(50, y, 745, 20).fillColor(NAVY).fill();
        headers.forEach((h, i) => doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(h, cols[i], y + 6));
        y += 20;
      }
    });

    addFooter(doc, null, qrBuffer);
    doc.end();

    ws.on('finish', () => resolve({ path: file, url: `/uploads/reports/${path.basename(file)}` }));
    ws.on('error', reject);
  });
}

// ── PROFIT & LOSS STATEMENT PDF ───────────────────────────────────────────────

async function generateProfitAndLoss(plData, period, generatedBy) {
  const dir  = path.join(UPLOAD_DIR, 'reports');
  ensureDir(dir);
  const file = path.join(dir, `pnl_${period.replace(/[\s\/]/g,'_')}.pdf`);
  const qrBuffer = await getQrBuffer(buildQrText([
    `${_company.legal_name || 'Qalibrated Systems Limited'}`,
    'PROFIT & LOSS STATEMENT',
    `Period: ${period}`,
    `Generated By: ${generatedBy || '—'}`,
    plData?.netProfit != null && `Net Profit: Kshs ${Number(plData.netProfit).toLocaleString('en-KE')}`,
    `Verify: ${_company.email || 'info@qalibrated.co.ke'}`,
  ]));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const ws  = fs.createWriteStream(file);
    doc.pipe(ws);

    let y = addHeader(doc, 'PROFIT & LOSS STATEMENT', `Period: ${period}`, qrBuffer);
    y = 157;

    doc.font('Helvetica').fontSize(8).fillColor(GREY)
      .text(`Generated: ${dateStr(new Date())} by ${generatedBy} · All figures in Kenya Shillings (Kshs)`, 50, y);
    y += 18;

    const section = (label, rows, total, totalColor = NAVY, fillHeader = NAVY) => {
      doc.rect(50, y, 495, 18).fillColor(fillHeader).fill();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(label, 65, y + 5);
      y += 18;
      rows.forEach((r, i) => {
        if (i % 2 === 0) doc.rect(50, y, 495, 16).fillColor('#F8FAFC').fill();
        doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY).text(r.name, 65, y + 4, { width: 350 });
        doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY).text(kes(r.amount), 0, y + 4, { align: 'right', width: 530 });
        y += 16;
      });
      doc.rect(50, y, 495, 20).fillColor('#F0F4F8').fill();
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(totalColor).text(`Total ${label}`, 65, y + 5);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(totalColor).text(kes(total), 0, y + 5, { align: 'right', width: 530 });
      y += 28;
    };

    if (!plData.has_gl_data) {
      doc.rect(50, y, 495, 50).fillColor('#FFFBEB').fill().rect(50, y, 495, 50).strokeColor('#FCD34D').lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(AMBER).text('No General Ledger postings found for this period.', 65, y + 12);
      doc.font('Helvetica').fontSize(8.5).fillColor(DKGREY).text('Post journal entries via Finance -> Journal Entries for figures to appear here. This statement will populate automatically once postings exist.', 65, y + 28, { width: 460 });
      y += 60;
    }

    section('Revenue', plData.revenue, plData.totalRevenue, GREEN, NAVY);
    section('Cost of Sales', plData.cogs, plData.totalCOGS, RED, NAVY);

    doc.rect(50, y, 495, 24).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD).text('GROSS PROFIT', 65, y + 7);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD).text(kes(plData.grossProfit), 0, y + 7, { align: 'right', width: 530 });
    doc.font('Helvetica').fontSize(7).fillColor('#C8D4DE').text(`Margin: ${plData.totalRevenue ? ((plData.grossProfit/plData.totalRevenue)*100).toFixed(1) : '0.0'}%`, 65, y + 17);
    y += 34;

    section('Operating Expenses', plData.opex, plData.totalOpex, RED, NAVY);
    section('Depreciation & Amortisation', plData.depreciation, plData.totalDepreciation, RED, NAVY);

    doc.rect(50, y, 495, 24).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD).text('OPERATING PROFIT (EBIT)', 65, y + 7);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD).text(kes(plData.operatingProfit), 0, y + 7, { align: 'right', width: 530 });
    y += 34;

    if (plData.otherIncome.length || plData.financeCosts.length) {
      section('Other Income', plData.otherIncome, plData.totalOtherIncome, GREEN, NAVY);
      section('Finance Costs', plData.financeCosts, plData.totalFinanceCosts, RED, NAVY);
    }

    doc.rect(50, y, 495, 36).fillColor(plData.netProfit >= 0 ? GREEN : RED).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text('NET PROFIT / (LOSS)', 65, y + 13);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text(kes(plData.netProfit), 0, y + 13, { align: 'right', width: 530 });
    y += 46;

    doc.font('Helvetica').fontSize(7).fillColor(GREY)
      .text('Prepared in accordance with the QSL Chart of Accounts (ICPAK-aligned). This statement is system-generated from posted General Ledger journal entries.', 50, y, { width: 495 });

    addFooter(doc, null, qrBuffer);
    doc.end();

    ws.on('finish', () => resolve({ path: file, url: `/uploads/reports/${path.basename(file)}` }));
    ws.on('error', reject);
  });
}

// ── GENERIC TABULAR REPORT PDF (point 4 — Reporting exports) ─────────────────
// Shared by Inventory, Requisitions, Vehicles, and User Activity reports so
// each doesn't need its own near-identical layout function. Caller supplies
// the title, column definitions, rows, and an optional filter summary line.

async function generateTabularReport({ title, subtitle, filtersSummary, columns, rows, generatedBy, filenamePrefix }) {
  const dir  = path.join(UPLOAD_DIR, 'reports');
  ensureDir(dir);
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(dir, `${filenamePrefix || 'report'}_${date}.pdf`);
  const qrBuffer = await getQrBuffer(buildQrText([
    `${_company.legal_name || 'Qalibrated Systems Limited'}`,
    title || 'REPORT',
    subtitle || null,
    `Generated: ${date}`,
    `Generated By: ${generatedBy || '—'}`,
    `Rows: ${rows?.length || 0}`,
    filtersSummary || null,
    `Verify: ${_company.email || 'info@qalibrated.co.ke'}`,
  ]));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, layout: 'landscape' });
    const ws  = fs.createWriteStream(file);
    doc.pipe(ws);

    addHeader(doc, title, subtitle || `Generated: ${dateStr(new Date())} by ${generatedBy}`, qrBuffer);

    let y = 157;

    if (filtersSummary) {
      doc.font('Helvetica').fontSize(8).fillColor(GREY).text(`Filters: ${filtersSummary}`, 50, y);
      y += 16;
    }

    doc.rect(50, y, 745, 26).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD)
      .text(`${rows.length} record(s)`, 65, y + 8);
    y += 36;

    // Compute column widths proportionally across the 745pt usable width
    const totalWeight = columns.reduce((s, c) => s + (c.weight || 1), 0);
    const usableWidth  = 745;
    let cursorX = 50;
    const colX = [];
    columns.forEach(c => {
      colX.push(cursorX);
      cursorX += (usableWidth * (c.weight || 1)) / totalWeight;
    });

    doc.rect(50, y, 745, 20).fillColor('#334155').fill();
    columns.forEach((c, i) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(c.label, colX[i] + 5, y + 6, { width: (usableWidth * (c.weight || 1)) / totalWeight - 8 });
    });
    y += 20;

    rows.forEach((row, i) => {
      const rowH = 18;
      if (y > doc.page.height - 80) {
        doc.addPage({ layout: 'landscape' });
        y = 50;
      }
      if (i % 2 === 0) doc.rect(50, y, 745, rowH).fillColor('#F8FAFC').fill();
      columns.forEach((c, ci) => {
        const val = c.format ? c.format(row[c.key], row) : (row[c.key] ?? '—');
        doc.font('Helvetica').fontSize(8).fillColor(c.color ? c.color(row[c.key], row) : DKGREY)
          .text(String(val), colX[ci] + 5, y + 5, { width: (usableWidth * (c.weight || 1)) / totalWeight - 8 });
      });
      y += rowH;
    });

    addFooter(doc, null, qrBuffer);
    doc.end();

    ws.on('finish', () => resolve({ path: file, url: `/uploads/reports/${path.basename(file)}` }));
    ws.on('error', reject);
  });
}

module.exports = {
  loadCompany,
  generatePayslip,
  generateInvoice,
  generateCalibrationCert,
  generateAgedDebtorsReport,
  generateAuditTrail,
  generateProfitAndLoss,
  generateTabularReport,
  generateBusinessDoc,
  DOC_TYPES,
};
