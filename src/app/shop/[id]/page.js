import ProductContent from './ProductContent';
import { getSiteUrl, localBusinessSchema, jsonLdScript } from '../../../lib/seo';
import { queryOne } from '../../../lib/db';
import { getSellingPrice } from '../../../lib/pricing';

async function loadProduct(id) {
  try {
    const item = await queryOne(
      `SELECT * FROM items WHERE id=? AND is_active=1 AND COALESCE(is_publicly_sellable,0)=1`, [id]
    );
    return item || null;
  } catch { return null; }
}

export async function generateMetadata({ params }) {
  const siteUrl = await getSiteUrl();
  const item = await loadProduct(params.id);
  if (!item) {
    return { title: 'Product Not Found | QSL Shop', robots: { index: false } };
  }
  const desc = item.shop_description || item.description || `${item.name} — available from QSL's stores in Nairobi, Kenya.`;
  return {
    title: `${item.name} | QSL Shop`,
    description: desc.slice(0, 160),
    alternates: { canonical: `${siteUrl}/shop/${item.id}` },
    openGraph: { title: item.name, description: desc.slice(0, 160), url: `${siteUrl}/shop/${item.id}`, type: 'website' },
  };
}

export default async function ProductPage({ params }) {
  return (
    <>
      <ProductSchema id={params.id} />
      <ProductContent />
    </>
  );
}

// Separate component so the schema-building logic (DB fetch + price calc)
// stays out of ProductPage's own body and is easy to find/adjust on its own.
async function ProductSchema({ id }) {
  const siteUrl = await getSiteUrl();
  const item = await loadProduct(id);
  if (!item) return null;
  const { price } = await getSellingPrice(item);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.name,
    description: item.shop_description || item.description || item.name,
    sku: item.code,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'KES',
      price,
      availability: 'https://schema.org/InStock',
      url: `${siteUrl}/shop/${item.id}`,
    },
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(data)} />;
}
