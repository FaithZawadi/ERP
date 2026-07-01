// src/lib/pricing.js — selling price generation, shared by the admin
// Stores screens and the public online shop.
//
// items.msp ("Minimum Selling Price", STK-010 / Part 4.3) is the
// already-existing field for a manually-set floor price. Where it hasn't
// been set, this derives a price from unit_cost + the item's category
// margin (system_settings msp.margin_*) — the same margin table Admin →
// System Settings already exposes, just not previously wired to anything
// that priced an item automatically.

const { queryOne } = require('./db');
const { getNum } = require('./settings');

// item_categories.code -> system_settings margin key. Two categories
// (IT & Office Equipment, Consumables) had no margin setting at all before
// this — msp.margin_it_office and msp.margin_consumables are added by
// migrate-v11.js specifically so every category has a real, distinct
// margin rather than being silently folded into an unrelated one.
const MARGIN_KEY_BY_CATEGORY_CODE = {
  'CAT-001': 'msp.margin_calibration',   // Calibration Equipment
  'CAT-002': 'msp.margin_calibration',   // Test & Measurement Instruments
  'CAT-003': 'msp.margin_spare_parts',   // Electrical Components
  'CAT-004': 'msp.margin_spare_parts',   // Mechanical Spares
  'CAT-005': 'msp.margin_safety',        // PPE & Safety Equipment
  'CAT-006': 'msp.margin_it_office',     // IT & Office Equipment
  'CAT-007': 'msp.margin_consumables',   // Consumables
  'CAT-008': 'msp.margin_spare_parts',   // Vehicle Spares & Tyres
  'CAT-009': 'msp.margin_tools',         // Tools
};
const DEFAULT_MARGIN_KEY = 'msp.margin_spare_parts';

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

// Resolve the margin key for an item, given its category_id (a row id in
// item_categories — items.category_id, not the free-text items.category).
async function marginKeyForCategoryId(category_id) {
  if (!category_id) return DEFAULT_MARGIN_KEY;
  const cat = await queryOne('SELECT code FROM item_categories WHERE id=?', [category_id]);
  return (cat && MARGIN_KEY_BY_CATEGORY_CODE[cat.code]) || DEFAULT_MARGIN_KEY;
}

// Core pricing decision: explicit msp wins if set and positive; otherwise
// derive from cost + category margin. Returns { price, source } so callers
// (and the admin listings screen) can show *why* a price is what it is.
async function getSellingPrice(item) {
  if (item.msp && Number(item.msp) > 0) {
    return { price: round2(item.msp), source: 'msp' };
  }
  const marginKey = await marginKeyForCategoryId(item.category_id);
  const margin = await getNum(marginKey, 0.20);
  const cost = Number(item.unit_cost) || 0;
  return { price: round2(cost * (1 + margin)), source: 'cost_plus_margin', marginKey, margin };
}

module.exports = { getSellingPrice, marginKeyForCategoryId, MARGIN_KEY_BY_CATEGORY_CODE, DEFAULT_MARGIN_KEY, round2 };
