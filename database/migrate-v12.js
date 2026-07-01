// database/migrate-v12.js — Website SEO foundation.
//
// Seeds branding.site_url (used to build canonical URLs, the sitemap, and
// the verify-link encoded in every calibration certificate's QR code —
// see src/lib/seo.js and src/lib/pdf.js generateCalibrationCert). The
// settings.js DEFAULTS already cover this with a fallback even without a
// DB row, but seeding it here makes it visible and editable from
// Admin → System Settings like every other setting, rather than being a
// hidden hardcoded value.
//
// Run: node database/migrate-v12.js — idempotent, safe to re-run.

async function migrate() {
  const db = require('../src/lib/db.js');
  const { queryOne, run } = db;
  console.log(`Running migration v12 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  const existing = await queryOne(`SELECT 1 as found FROM system_settings WHERE key=?`, ['branding.site_url']);
  if (!existing) {
    await run(
      `INSERT INTO system_settings (key, value, category) VALUES (?,?,?)`,
      ['branding.site_url', 'https://qalibrated.co.ke', 'branding']
    );
    console.log('  branding.site_url seeded — update this in Admin > System Settings once the real production domain is live');
  } else {
    console.log('  branding.site_url already set, skipping');
  }

  console.log('');
  console.log('=== MIGRATION v12 COMPLETE ===');
}

migrate().catch(function(e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
