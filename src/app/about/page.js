import AboutContent from './AboutContent';
import { getSiteUrl, localBusinessSchema, jsonLdScript } from '../../lib/seo';

export async function generateMetadata() {
  const siteUrl = await getSiteUrl();
  return {
    title: 'About QSL — Accredited Calibration Laboratory in Nairobi, Kenya',
    description: 'Qalibrated Systems Limited is a Nairobi-based ISO/IEC 17025 (KENAS CL/059) and ISO/IEC 17020 accredited calibration and inspection company, traceable to KEBS and BIPM national standards.',
    alternates: { canonical: `${siteUrl}/about` },
    openGraph: { title: 'About Qalibrated Systems Limited', url: `${siteUrl}/about`, type: 'website' },
  };
}

export default async function AboutPage() {
  const siteUrl = await getSiteUrl();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(localBusinessSchema(siteUrl))} />
      <AboutContent />
    </>
  );
}
