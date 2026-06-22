// src/lib/integrations/ppip.js
// Public Procurement Information Portal (PPIP) Integration
// Portal: https://tenders.go.ke

const axios = require('axios');

const BASE_URL = process.env.PPIP_API_URL || 'https://tenders.go.ke/api/v1';
const API_KEY  = process.env.PPIP_API_KEY  || '';

async function ppipRequest(endpoint, params = {}) {
  try {
    const res = await axios.get(`${BASE_URL}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' },
      params,
      timeout: 20000,
    });
    return { success: true, data: res.data };
  } catch (err) {
    // If no API key, return mock data for development
    if (!API_KEY) {
      return { success: true, data: getMockTenders(endpoint), isMock: true };
    }
    return { success: false, error: err.response?.data || err.message };
  }
}

// ── TENDER SEARCH ─────────────────────────────────────────────────────────────

/**
 * Search for tenders relevant to QSL's business lines.
 * @param {object} opts - { keywords, category, region, minValue, maxValue }
 */
async function searchTenders(opts = {}) {
  const params = {
    keywords:    opts.keywords   || 'calibration instrumentation engineering',
    category:    opts.category   || '',
    region:      opts.region     || '',
    min_value:   opts.minValue   || '',
    max_value:   opts.maxValue   || '',
    status:      'open',
    page:        opts.page       || 1,
    per_page:    opts.perPage    || 20,
  };
  return ppipRequest('/tenders', params);
}

/**
 * Get details of a specific tender.
 */
async function getTenderDetails(tenderId) {
  return ppipRequest(`/tenders/${tenderId}`);
}

/**
 * Get tenders by procuring entity.
 */
async function getTendersByEntity(entityCode) {
  return ppipRequest('/tenders', { entity: entityCode, status: 'open' });
}

/**
 * Get awarded contracts (useful for competitor intelligence).
 */
async function getAwardedContracts(opts = {}) {
  return ppipRequest('/contracts', {
    category: opts.category || 'engineering',
    year:     opts.year     || new Date().getFullYear(),
  });
}

/**
 * Get QSL's submitted bids (requires entity code).
 */
async function getQSLSubmissions() {
  const entityCode = process.env.PPIP_ENTITY_CODE || '';
  if (!entityCode) return { success: false, error: 'PPIP_ENTITY_CODE not configured' };
  return ppipRequest(`/entities/${entityCode}/submissions`);
}

// ── MOCK DATA (for development without API key) ───────────────────────────────

function getMockTenders(endpoint) {
  if (endpoint.includes('/tenders')) {
    return {
      tenders: [
        {
          id: 'TND-2026-00447',
          title: 'Supply and Installation of Flow Metering Systems — NWSC Eldoret',
          procuring_entity: 'National Water and Sewerage Corporation',
          category: 'Engineering Services',
          estimated_value: 45000000,
          deadline: '2026-07-15',
          region: 'Rift Valley',
          status: 'open',
          document_fee: 5000,
          ppip_url: 'https://tenders.go.ke/tenders/TND-2026-00447',
        },
        {
          id: 'TND-2026-00512',
          title: 'Annual Calibration Services for KEBS Laboratories — Nairobi & Mombasa',
          procuring_entity: 'Kenya Bureau of Standards',
          category: 'Calibration Services',
          estimated_value: 8500000,
          deadline: '2026-07-30',
          region: 'Nairobi',
          status: 'open',
          document_fee: 2000,
          ppip_url: 'https://tenders.go.ke/tenders/TND-2026-00512',
        },
        {
          id: 'TND-2026-00389',
          title: 'Instrumentation & Control Systems Upgrade — KEPLC Olkaria',
          procuring_entity: 'Kenya Electricity Generating Company',
          category: 'Electrical Engineering',
          estimated_value: 120000000,
          deadline: '2026-08-10',
          region: 'Rift Valley',
          status: 'open',
          document_fee: 10000,
          ppip_url: 'https://tenders.go.ke/tenders/TND-2026-00389',
        },
        {
          id: 'TND-2026-00401',
          title: 'Medical Equipment Calibration — County Hospitals Programme',
          procuring_entity: 'Ministry of Health',
          category: 'Medical Equipment',
          estimated_value: 22000000,
          deadline: '2026-07-20',
          region: 'Nationwide',
          status: 'open',
          document_fee: 3000,
          ppip_url: 'https://tenders.go.ke/tenders/TND-2026-00401',
        },
        {
          id: 'TND-2026-00468',
          title: 'GPS Vehicle Tracking Solution — Kenya Power Fleet',
          procuring_entity: 'Kenya Power & Lighting Co.',
          category: 'ICT Services',
          estimated_value: 15000000,
          deadline: '2026-06-30',
          region: 'Nationwide',
          status: 'closing_soon',
          document_fee: 5000,
          ppip_url: 'https://tenders.go.ke/tenders/TND-2026-00468',
        },
      ],
      total: 5,
      page: 1,
    };
  }
  return {};
}

module.exports = {
  searchTenders,
  getTenderDetails,
  getTendersByEntity,
  getAwardedContracts,
  getQSLSubmissions,
};
