// src/app/layout.js
export const metadata = {
  title: 'QSL Software — Qalibrated Systems Limited',
  description: 'The QSL ERP and other in-house software built by Qalibrated Systems Limited.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, fontFamily: "'Inter', sans-serif", background: '#F0F4F8' }}>
        {children}
      </body>
    </html>
  );
}
