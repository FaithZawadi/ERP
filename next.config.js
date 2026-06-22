/** @type {import('next').NextConfig} */
const nextConfig = {
  // sql.js and pdfkit both break when webpack bundles them for the Next.js
  // server runtime: sql.js throws "Cannot set properties of undefined
  // (setting 'exports')" and pdfkit throws "PDFDocument is not a
  // constructor" — both are CJS/ESM interop issues that only surface under
  // webpack bundling, not under a plain `node` require. Marking them
  // external tells Next.js to require() them natively via Node at runtime
  // instead of bundling — the standard fix for this class of issue.
  experimental: {
    serverComponentsExternalPackages: ['sql.js', 'pdfkit'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('sql.js', 'pdfkit');
    }
    return config;
  },
  env: {
    JWT_SECRET: process.env.JWT_SECRET || 'qsl-erp-secret-2026-change-in-production',
    API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:4000',
    KRA_ETIMS_URL: process.env.KRA_ETIMS_URL || 'https://etims-api.kra.go.ke/etims-api',
    KRA_ETIMS_KEY: process.env.KRA_ETIMS_KEY || '',
    PPIP_API_URL: process.env.PPIP_API_URL || 'https://tenders.go.ke/api',
    PPIP_API_KEY: process.env.PPIP_API_KEY || '',
    MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY || '',
    MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET || '',
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
    SMTP_PORT: process.env.SMTP_PORT || '587',
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
