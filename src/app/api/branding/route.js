// src/app/api/branding/route.js — Public Branding Settings
//
// Deliberately separate from /api/admin (which is fully auth-gated). The
// login screen and the public landing page both need the logo/theme
// BEFORE anyone has authenticated, so this route exposes only the small,
// safe subset of system_settings meant for public display — never RBAC,
// user, or financial data. Editing branding still requires md/admin via
// POST /api/admin (action: update_setting / upload_logo), same as every
// other system setting.
//
// GET  -> { logo_url, primary_color, font_family, company_display_name }

import { query } from '../../../lib/db';

const PUBLIC_KEYS = ['branding.logo_url', 'branding.primary_color', 'branding.accent_color', 'branding.font_family', 'branding.company_display_name'];

export async function GET() {
  try {
    const rows = await query(
      `SELECT key, value FROM system_settings WHERE key IN (${PUBLIC_KEYS.map(() => '?').join(',')})`,
      PUBLIC_KEYS
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    return new Response(JSON.stringify({
      success: true,
      data: {
        logo_url:             map['branding.logo_url'] || null,
        primary_color:        map['branding.primary_color'] || '#1B3A5C', // QSL navy default
        accent_color:         map['branding.accent_color'] || '#C8960C',  // QSL gold default
        font_family:          map['branding.font_family'] || 'Inter',
        company_display_name: map['branding.company_display_name'] || 'QSL ERP',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[Branding GET]', e);
    // Fail soft — branding is cosmetic, never block the login/landing page over it
    return new Response(JSON.stringify({
      success: true,
      data: { logo_url: null, primary_color: '#1B3A5C', accent_color: '#C8960C', font_family: 'Inter', company_display_name: 'QSL ERP' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}
