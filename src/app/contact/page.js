import ContactContent from './ContactContent';
import { getSiteUrl, localBusinessSchema, jsonLdScript } from '../../lib/seo';

export async function generateMetadata() {
  const siteUrl = await getSiteUrl();
  return {
    title: 'Contact QSL — Request a Calibration or Inspection Quote',
    description: 'Get in touch with Qalibrated Systems Limited for calibration, inspection, or equipment maintenance in Nairobi and across Kenya. We typically respond within one business day.',
    alternates: { canonical: `${siteUrl}/contact` },
    openGraph: { title: 'Contact Qalibrated Systems Limited', url: `${siteUrl}/contact`, type: 'website' },
  };
}

export default async function ContactPage() {
  const siteUrl = await getSiteUrl();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(localBusinessSchema(siteUrl))} />
      <ContactContent />
    </>
  );
}
