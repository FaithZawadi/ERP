// src/app/robots.js — Next.js App Router robots convention.
// Served at /robots.txt automatically.

import { getSiteUrl } from '../lib/seo';

export default async function robots() {
  const siteUrl = await getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Authenticated ERP, auth APIs, and transactional pages have no
        // value as search results and shouldn't be crawled — /api/public/*
        // is deliberately left crawlable-adjacent (not linked, so it won't
        // actually get indexed, but nothing here needs to block it either).
        disallow: ['/dashboard', '/login', '/api/', '/cart', '/checkout'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
