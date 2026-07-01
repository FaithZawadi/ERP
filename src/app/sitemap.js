// src/app/sitemap.js — Next.js App Router sitemap convention.
// Served at /sitemap.xml automatically.

import { getSiteUrl } from '../lib/seo';
import { query } from '../lib/db';

export default async function sitemap() {
  const siteUrl = await getSiteUrl();
  const now = new Date();

  const staticPages = [
    { url: `${siteUrl}/`,         changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${siteUrl}/services`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/about`,    changeFrequency: 'monthly', priority: 0.7 },
    { url: `${siteUrl}/contact`,  changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/shop`,     changeFrequency: 'daily',   priority: 0.9 },
    { url: `${siteUrl}/verify`,   changeFrequency: 'monthly', priority: 0.3 },
  ].map(p => ({ ...p, lastModified: now }));

  let productPages = [];
  try {
    const products = await query(
      `SELECT id, created_at FROM items WHERE is_active=1 AND COALESCE(is_publicly_sellable,0)=1`
    );
    productPages = products.map(p => ({
      url: `${siteUrl}/shop/${p.id}`,
      lastModified: p.created_at ? new Date(p.created_at) : now,
      changeFrequency: 'weekly',
      priority: 0.6,
    }));
  } catch {
    // DB unavailable at build time in some environments — sitemap still
    // returns the static pages rather than failing the whole build.
  }

  return [...staticPages, ...productPages];
}
