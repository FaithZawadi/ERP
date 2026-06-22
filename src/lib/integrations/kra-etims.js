// src/lib/integrations/kra-etims.js
// KRA Electronic Tax Invoice Management System (eTIMS) Integration
// API Docs: https://developer.kra.go.ke/documentation/etims

const axios = require('axios');

const BASE_URL   = process.env.KRA_ETIMS_ENV === 'production'
  ? process.env.KRA_ETIMS_URL
  : process.env.KRA_ETIMS_SANDBOX_URL || 'https://etims-sbx-api.kra.go.ke/etims-api';

const KRA_PIN    = process.env.KRA_ETIMS_PIN    || '';
const BRANCH_ID  = process.env.KRA_ETIMS_BRANCH_ID || '00';
const DEVICE_ID  = process.env.KRA_ETIMS_DEVICE_ID || '';
const API_KEY    = process.env.KRA_ETIMS_KEY    || '';

// VAT category mappings for eTIMS
const VAT_CATS = {
  'A': { rate: 16, desc: 'Standard rated' },
  'B': { rate: 0,  desc: 'Zero rated — exports' },
  'C': { rate: 0,  desc: 'Zero rated — other' },
  'E': { rate: 0,  desc: 'Exempt' },
};

// ── CORE API CLIENT ───────────────────────────────────────────────────────────

async function etimsRequest(endpoint, data) {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const res = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        'tin':  KRA_PIN,
        'bhfId': BRANCH_ID,
        'cmcKey': API_KEY,
      },
      timeout: 30000,
    });
    return { success: true, data: res.data };
  } catch (err) {
    const errData = err.response?.data || { message: err.message };
    return { success: false, error: errData, statusCode: err.response?.status };
  }
}

// ── INITIALIZATION ────────────────────────────────────────────────────────────

/**
 * Initialize eTIMS connection — call once on app startup.
 * GET /etims-api/osdc/selectInitInfo
 */
async function initialize() {
  return etimsRequest('/osdc/selectInitInfo', { tin: KRA_PIN, bhfId: BRANCH_ID });
}

// ── SUBMIT TAX INVOICE ────────────────────────────────────────────────────────

/**
 * Submit a sales invoice to KRA eTIMS.
 * Returns the eTIMS receipt number and CU number.
 *
 * @param {object} invoice - Invoice data from tax_invoices table
 * @param {Array}  lines   - Invoice line items
 * @param {object} client  - Client data (name, PIN)
 */
async function submitInvoice(invoice, lines, client) {
  const now = new Date();
  const salesDtm = now.toISOString().replace('T', '').slice(0, 14);

  const payload = {
    tin:     KRA_PIN,
    bhfId:   BRANCH_ID,
    invcNo:  parseInt(invoice.invoice_no?.replace(/\D/g, '') || '1'),
    orgInvcNo: 0,
    cisInvcNo: invoice.invoice_no,
    custTin:  client.kra_pin || '',
    custNm:   client.name,
    salesTyCd: 'N',      // Normal sale
    rcptTyCd:  'S',      // Sales receipt
    pmtTyCd:   '01',     // Cash
    salesSttsCd: '02',   // Approved
    cfmDt:   salesDtm,
    salesDt: invoice.date?.replace(/-/g, '') || salesDtm.slice(0, 8),
    stockRlsDt: null,
    cnclReqDt:  null,
    cnclDt:     null,
    rfdDt:      null,
    rfdRsnCd:   null,
    totItemCnt: lines.length,
    taxblAmtA:  lines.filter(l => l.vat_category === 'A').reduce((s, l) => s + l.amount, 0),
    taxblAmtB:  lines.filter(l => l.vat_category === 'B').reduce((s, l) => s + l.amount, 0),
    taxblAmtC:  0,
    taxblAmtD:  0,
    taxblAmtE:  lines.filter(l => l.vat_category === 'E').reduce((s, l) => s + l.amount, 0),
    taxRtA:  16,
    taxRtB:  0,
    taxRtC:  0,
    taxRtD:  0,
    taxRtE:  0,
    taxAmtA: lines.filter(l => l.vat_category === 'A').reduce((s, l) => s + l.vat_amount, 0),
    taxAmtB: 0,
    taxAmtC: 0,
    taxAmtD: 0,
    taxAmtE: 0,
    totTaxblAmt: lines.reduce((s, l) => s + l.amount, 0),
    totTaxAmt:   lines.reduce((s, l) => s + (l.vat_amount || 0), 0),
    totAmt:      invoice.total,
    prchrAcptcYn: 'N',
    remark: '',
    regrId:   'SYSTEM',
    regrNm:   'QSL ERP',
    modrId:   'SYSTEM',
    modrNm:   'QSL ERP',
    itemList: lines.map((line, i) => ({
      itemSeq:    i + 1,
      itemCd:     line.item_code || `ITEM${i + 1}`,
      itemClsCd:  '57101500',   // Default UN SPSC code for services
      itemNm:     line.description,
      bcd:        '',
      pkgUnitCd:  'NT',
      pkg:        line.quantity,
      qtyUnitCd:  'U',
      qty:        line.quantity,
      prc:        line.unit_price,
      splyAmt:    line.amount,
      dcRt:       0,
      dcAmt:      0,
      isrccCd:    '',
      isrccNm:    '',
      isrcRt:     0,
      isrcAmt:    0,
      vatCatCd:   line.vat_category || 'A',
      exciseTxCatCd: null,
      vatTaxblAmt: line.amount,
      exciseTaxblAmt: 0,
      vatAmt:     line.vat_amount || 0,
      exciseTxAmt: 0,
      totAmt:     line.amount + (line.vat_amount || 0),
      regrId:     'SYSTEM',
      regrNm:     'QSL ERP',
      modrId:     'SYSTEM',
      modrNm:     'QSL ERP',
    })),
  };

  return etimsRequest('/trnsSales/saveSales', payload);
}

/**
 * Query status of a submitted invoice.
 */
async function getInvoiceStatus(invoiceNo) {
  return etimsRequest('/trnsSales/selectSales', {
    tin: KRA_PIN, bhfId: BRANCH_ID, lastReqDt: '20240101000000',
  });
}

/**
 * Submit a stock movement (purchase) to eTIMS.
 */
async function submitPurchase(lpo, lines, supplier) {
  const payload = {
    tin:   KRA_PIN,
    bhfId: BRANCH_ID,
    invcNo: parseInt(lpo.lpo_no?.replace(/\D/g, '') || '1'),
    spplrTin:  supplier.kra_pin || '',
    spplrNm:   supplier.name,
    spplrInvcNo: lpo.lpo_no,
    regTyCd:   'M',
    pchsSttsCd: '02',
    pchsDt:    lpo.date?.replace(/-/g, '') || '',
    totItemCnt: lines.length,
    totTaxblAmt: lines.reduce((s, l) => s + l.total, 0),
    totTaxAmt:  lines.reduce((s, l) => s + (l.total * 0.16), 0),
    totAmt:    lpo.grand_total,
    remark: `LPO ${lpo.lpo_no}`,
    regrId: 'SYSTEM',
    regrNm: 'QSL ERP',
    modrId: 'SYSTEM',
    modrNm: 'QSL ERP',
    itemList: lines.map((line, i) => ({
      itemSeq: i + 1,
      itemCd:  line.item_code || '',
      itemNm:  line.description,
      qty:     line.quantity,
      prc:     line.unit_price,
      splyAmt: line.total,
      vatCatCd: 'A',
      vatAmt:  Math.round(line.total * 0.16),
      totAmt:  line.total + Math.round(line.total * 0.16),
      regrId:  'SYSTEM',
      regrNm:  'QSL ERP',
      modrId:  'SYSTEM',
      modrNm:  'QSL ERP',
    })),
  };

  return etimsRequest('/trnsPurchase/savePurchase', payload);
}

// ── STOCK MANAGEMENT ──────────────────────────────────────────────────────────

async function syncStockItem(item) {
  return etimsRequest('/stock/saveItems', {
    tin:   KRA_PIN,
    bhfId: BRANCH_ID,
    itemList: [{
      itemCd:     item.code,
      itemClsCd:  '57101500',
      itemTyCd:   '1',
      itemNm:     item.name,
      itemStdNm:  item.name,
      orgnNatCd:  'KE',
      pkgUnitCd:  'NT',
      qtyUnitCd:  'U',
      taxTyCd:    'A',
      btchNo:     null,
      bcd:        null,
      dftPrc:     item.msp,
      addInfo:    item.description || '',
      sftyQty:    item.reorder_level,
      isrcAplcbYn: 'N',
      useYn:       'Y',
      regrId:      'SYSTEM',
      regrNm:      'QSL ERP',
      modrId:      'SYSTEM',
      modrNm:      'QSL ERP',
    }],
  });
}

// ── LOGGING ───────────────────────────────────────────────────────────────────

async function logIntegration(db, { service, direction, endpoint, request, response, statusCode, success, error, refId }) {
  const { v4: uuidv4 } = require('uuid');
  try {
    await db.run(
      `INSERT INTO integration_logs (id,service,direction,endpoint,request,response,status_code,success,error,ref_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), service, direction, endpoint,
       JSON.stringify(request), JSON.stringify(response),
       statusCode, success ? 1 : 0, error, refId]
    );
  } catch {}
}

module.exports = {
  initialize,
  submitInvoice,
  getInvoiceStatus,
  submitPurchase,
  syncStockItem,
  logIntegration,
  VAT_CATS,
};
