// src/lib/seo.js — shared SEO helpers for the public site's server-component
// page wrappers (the small page.js files that just export metadata and
// render the *Content.js client component for that route).

async function getSiteUrl() {
  try {
    const { getSetting } = require('./settings');
    return await getSetting('branding.site_url', 'https://qalibrated.co.ke');
  } catch {
    return 'https://qalibrated.co.ke';
  }
}

// Organization/LocalBusiness structured data — present on every public
// page so Google has a consistent entity to attach to search results and
// the Maps/local-pack listing. Static enough (company identity rarely
// changes) that hardcoding the KENAS/accreditation facts here, rather than
// threading them through settings, is the simpler and more honest choice.
function localBusinessSchema(siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${siteUrl}/#organization`,
    name: 'Qalibrated Systems Limited',
    alternateName: 'QSL',
    url: siteUrl,
    logo: `${siteUrl}/logo.svg`,
    image: `${siteUrl}/logo.svg`,
    description: 'ISO/IEC 17025 accredited calibration laboratory (KENAS CL/059) and ISO/IEC 17020 accredited inspection body in Nairobi, Kenya, providing calibration, inspection, and equipment maintenance services traceable to KEBS and BIPM national standards.',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Birdi Singh Complex, Off Mombasa Road',
      addressLocality: 'Nairobi',
      addressCountry: 'KE',
    },
    telephone: '+254714999996',
    email: 'info@qalibrated.co.ke',
    priceRange: '$$',
    areaServed: { '@type': 'Country', name: 'Kenya' },
    hasCredential: [
      { '@type': 'EducationalOccupationalCredential', credentialCategory: 'Accreditation', name: 'ISO/IEC 17025 — KENAS CL/059' },
      { '@type': 'EducationalOccupationalCredential', credentialCategory: 'Accreditation', name: 'ISO/IEC 17020 Inspection Body' },
    ],
  };
}

function jsonLdScript(data) {
  // eslint-disable-next-line react/no-danger
  return { __html: JSON.stringify(data) };
}

module.exports = { getSiteUrl, localBusinessSchema, jsonLdScript };
