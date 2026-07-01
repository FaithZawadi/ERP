import ServicesContent from './ServicesContent';
import { getSiteUrl, localBusinessSchema, jsonLdScript } from '../../lib/seo';

export async function generateMetadata() {
  const siteUrl = await getSiteUrl();
  return {
    title: 'Calibration & Inspection Services — ISO/IEC 17025 & 17020 | QSL Kenya',
    description: 'Accredited calibration (mass, temperature, pressure, volume, flow, humidity), ISO/IEC 17020 inspection, equipment repair, and fleet/asset support across Kenya.',
    alternates: { canonical: `${siteUrl}/services` },
    openGraph: { title: 'Calibration & Inspection Services — QSL Kenya', url: `${siteUrl}/services`, type: 'website' },
  };
}

export default async function ServicesPage() {
  const siteUrl = await getSiteUrl();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(localBusinessSchema(siteUrl))} />
      <ServicesContent />
    </>
  );
}
