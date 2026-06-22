// src/lib/integrations/mpesa.js
// Safaricom M-PESA Daraja API Integration
// Docs: https://developer.safaricom.co.ke/documentation

const axios = require('axios');

const IS_SANDBOX = process.env.MPESA_ENVIRONMENT !== 'production';
const BASE_URL   = IS_SANDBOX
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY    || '';
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
const SHORTCODE       = process.env.MPESA_SHORTCODE       || '';
const PASSKEY         = process.env.MPESA_PASSKEY         || '';
const CALLBACK_URL    = process.env.MPESA_CALLBACK_URL    || '';

let _accessToken = null;
let _tokenExpiry = 0;

// ── AUTHENTICATION ────────────────────────────────────────────────────────────

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;

  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    // Return mock token for dev
    _accessToken = 'mock-mpesa-token';
    _tokenExpiry = Date.now() + 3600000;
    return _accessToken;
  }

  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { 'Authorization': `Basic ${credentials}` },
  });

  _accessToken = res.data.access_token;
  _tokenExpiry = Date.now() + (parseInt(res.data.expires_in) - 60) * 1000;
  return _accessToken;
}

// ── STK PUSH (Client Payment Request) ────────────────────────────────────────

/**
 * Trigger M-PESA STK Push — prompt client to pay via phone.
 * Used for collection of outstanding invoices.
 *
 * @param {string} phone     - Phone number in 254XXXXXXXXX format
 * @param {number} amount    - Amount in Kshs (whole number)
 * @param {string} accountRef - Invoice number or reference
 * @param {string} description - Payment description
 */
async function stkPush(phone, amount, accountRef, description = 'QSL Invoice Payment') {
  const token     = await getAccessToken();
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password  = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

  const payload = {
    BusinessShortCode: SHORTCODE,
    Password:         password,
    Timestamp:        timestamp,
    TransactionType:  'CustomerPayBillOnline',
    Amount:           Math.round(amount),
    PartyA:           phone,
    PartyB:           SHORTCODE,
    PhoneNumber:      phone,
    CallBackURL:      `${CALLBACK_URL}/mpesa/stk`,
    AccountReference: accountRef,
    TransactionDesc:  description,
  };

  if (!CONSUMER_KEY) {
    // Mock response for development
    return {
      success: true,
      isMock: true,
      data: {
        MerchantRequestID: `MOCK-${Date.now()}`,
        CheckoutRequestID: `ws_CO_${Date.now()}`,
        ResponseCode:      '0',
        ResponseDescription: 'Success. Request accepted for processing',
        CustomerMessage:   'Success. Request accepted for processing',
      },
    };
  }

  try {
    const res = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 * Query STK Push status.
 */
async function stkQuery(checkoutRequestId) {
  const token     = await getAccessToken();
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password  = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

  try {
    const res = await axios.post(
      `${BASE_URL}/mpesa/stkpushquery/v1/query`,
      { BusinessShortCode: SHORTCODE, Password: password, Timestamp: timestamp, CheckoutRequestID: checkoutRequestId },
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 * B2C Payment — for supplier payments or salary disbursements.
 */
async function b2cPayment(phone, amount, remarks, occasion = '') {
  const token = await getAccessToken();

  if (!CONSUMER_KEY) {
    return { success: true, isMock: true, data: { ConversationID: `MOCK-B2C-${Date.now()}` } };
  }

  const payload = {
    InitiatorName:      'QSL_API',
    SecurityCredential: '',   // Encrypted password
    CommandID:          'BusinessPayment',
    Amount:             Math.round(amount),
    PartyA:             SHORTCODE,
    PartyB:             phone,
    Remarks:            remarks,
    QueueTimeOutURL:    `${CALLBACK_URL}/mpesa/b2c/timeout`,
    ResultURL:          `${CALLBACK_URL}/mpesa/b2c/result`,
    Occasion:           occasion,
  };

  try {
    const res = await axios.post(
      `${BASE_URL}/mpesa/b2c/v1/paymentrequest`,
      payload,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err.response?.data || err.message };
  }
}

/**
 * Parse M-PESA callback data.
 * Called by the /api/integrations/mpesa/callback endpoint.
 */
function parseCallback(callbackData) {
  const stkCallback = callbackData?.Body?.stkCallback;
  if (!stkCallback) return null;

  const items = stkCallback.CallbackMetadata?.Item || [];
  const get   = (name) => items.find(i => i.Name === name)?.Value;

  return {
    merchantRequestId:  stkCallback.MerchantRequestID,
    checkoutRequestId:  stkCallback.CheckoutRequestID,
    resultCode:         stkCallback.ResultCode,
    resultDesc:         stkCallback.ResultDesc,
    success:            stkCallback.ResultCode === 0,
    amount:             get('Amount'),
    mpesaReceiptNumber: get('MpesaReceiptNumber'),
    transactionDate:    get('TransactionDate'),
    phoneNumber:        get('PhoneNumber'),
  };
}

module.exports = {
  stkPush,
  stkQuery,
  b2cPayment,
  parseCallback,
};
