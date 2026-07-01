// src/app/verify/VerifySearchContent.js — manual certificate lookup form.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { C, NavBar, Footer, PageEyebrow } from '../../components/public/shared';

export default function VerifySearchContent() {
  const router = useRouter();
  const [certNo, setCertNo] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!certNo.trim()) return;
    router.push(`/verify/${encodeURIComponent(certNo.trim())}`);
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt, minHeight: '100vh' }}>
      <NavBar active="/verify" />
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '70px 32px 90px', textAlign: 'center' }}>
        <PageEyebrow>Certificate Verification</PageEyebrow>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: C.navy, margin: '0 0 12px', letterSpacing: '-0.01em' }}>
          Verify a QSL calibration certificate
        </h1>
        <p style={{ fontSize: 14, color: C.mgrey, lineHeight: 1.6, marginBottom: 28 }}>
          Every certificate we issue carries a QR code linking here. Enter the certificate number printed
          on the document to confirm it's genuine and check its current status.
        </p>
        <form onSubmit={submit} style={{ display: 'flex', gap: 10 }}>
          <input
            value={certNo}
            onChange={e => setCertNo(e.target.value)}
            placeholder="e.g. QSL/QP/19/CERT/0001"
            style={{
              flex: 1, padding: '12px 16px', border: `1.5px solid ${C.lgrey}`, borderRadius: 8,
              fontSize: 14, color: C.dgrey, outline: 'none', fontFamily: 'inherit',
            }}
          />
          <button type="submit" style={{
            fontSize: 14, fontWeight: 700, color: C.navyD, background: C.gold, padding: '12px 24px',
            borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            Verify →
          </button>
        </form>
      </div>
      <Footer />
    </div>
  );
}
