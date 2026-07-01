import ShopContent from './ShopContent';
import { getSiteUrl, localBusinessSchema, jsonLdScript } from '../../lib/seo';

export async function generateMetadata() {
  const siteUrl = await getSiteUrl();
  return {
    title: 'Shop — Calibration Spares, Tools & Equipment | QSL Kenya',
    description: 'Order calibration spares, tools, and equipment directly from QSL\u2019s stores. Online ordering with invoicing and delivery across Kenya.',
    alternates: { canonical: `${siteUrl}/shop` },
    openGraph: { title: 'Shop — QSL Kenya', url: `${siteUrl}/shop`, type: 'website' },
  };
}

export default async function ShopPage() {
  const siteUrl = await getSiteUrl();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(localBusinessSchema(siteUrl))} />
      <ShopContent />
    </>
  );
}
