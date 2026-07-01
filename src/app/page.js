// src/app/page.js — server wrapper for the Home route.
// Metadata + JSON-LD only live here (server component); the actual UI is
// HomeContent.js (client component, needs interactivity/hooks).

import HomeContent from './HomeContent';
import { getSiteUrl, localBusinessSchema, jsonLdScript } from '../lib/seo';

export async function generateMetadata() {
  const siteUrl = await getSiteUrl();
  return {
    title: 'Qalibrated Systems Limited — ISO/IEC 17025 Calibration & ISO/IEC 17020 Inspection, Nairobi',
    description: 'Accredited calibration, inspection, and equipment maintenance in Kenya, traceable to KEBS and BIPM. ISO/IEC 17025 (KENAS CL/059) & ISO/IEC 17020 accredited.',
    alternates: { canonical: siteUrl },
    openGraph: {
      title: 'Qalibrated Systems Limited — Calibration & Inspection, Nairobi',
      description: 'ISO/IEC 17025 & ISO/IEC 17020 accredited calibration, inspection, and equipment maintenance across Kenya.',
      url: siteUrl,
      siteName: 'Qalibrated Systems Limited',
      locale: 'en_KE',
      type: 'website',
    },
  };
}

export default async function HomePage() {
  const siteUrl = await getSiteUrl();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(localBusinessSchema(siteUrl))} />
      <HomeContent />
    </>
  );
}
