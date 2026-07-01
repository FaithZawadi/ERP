// src/app/layout.js
import { CartProvider } from '../components/public/CartContext';

export const metadata = {
  title: 'Qalibrated Systems Limited — ISO 17025 Calibration & ISO 17020 Inspection',
  description: 'Accredited calibration, inspection, and equipment maintenance services in Kenya, traceable to KEBS and BIPM national standards. ISO/IEC 17025 & ISO/IEC 17020 accredited — KENAS CL/059.',
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
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
