// src/app/verify/[certNo]/page.js — the actual QR-code landing page.
//
// Fully server-rendered: fetches the certificate directly via the DB layer
// (no HTTP round-trip to /api/public/verify needed, since this already
// runs server-side) and renders the result with no client JS required for
// the page to be useful — NavBar/Footer are the only client boundaries,
// pulled in as already-built components.

import { queryOne } from '../../../lib/db';
import { NavBar, Footer, PageEyebrow } from '../../../components/public/shared';
import { C } from '../../../components/public/theme';

async function loadCert(certNo) {
  const cert = await queryOne(
    `SELECT c.cert_no, c.instrument, c.make, c.model, c.calibrated_at, c.next_cal_date, c.result, c.checked_at,
            t.first_name as tech_first, t.last_name as tech_last,
            k.first_name as checker_first, k.last_name as checker_last
     FROM calibration_certs c
     LEFT JOIN employees t ON t.id = c.technician_id
     LEFT JOIN employees k ON k.id = c.checked_by
     WHERE c.cert_no = ?`,
    [certNo]
  );
  return cert || null;
}

export async function generateMetadata({ params }) {
  // Individual cert pages are only meant to be reached via the QR code on
  // the physical/PDF certificate, not discovered through search — noindex
  // keeps thousands of thin, near-identical pages out of Google's index.
  return { title: `Certificate ${decodeURIComponent(params.certNo)} | QSL Verify`, robots: { index: false, follow: false } };
}

export default async function VerifyResultPage({ params }) {
  const certNo = decodeURIComponent(params.certNo);
  const cert = await loadCert(certNo);

  const today = new Date().toISOString().slice(0, 10);
  const isExpired = cert?.next_cal_date && cert.next_cal_date < today;
  const isPass = cert && (cert.result === 'pass' || cert.result === 'adjusted');

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt, minHeight: '100vh' }}>
      <NavBar active="/verify" />
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '60px 32px 90px' }}>
        <PageEyebrow>Certificate Verification</PageEyebrow>

        {!cert && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '32px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>Certificate not found</div>
            <div style={{ fontSize: 13.5, color: C.dgrey, lineHeight: 1.6 }}>
              "{certNo}" doesn't match any certificate on record. If you scanned a QR code and see this, please{' '}
              <a href="/contact" style={{ color: C.navy }}>contact us</a> so we can check it directly.
            </div>
          </div>
        )}

        {cert && (
          <>
            <div style={{
              background: isExpired ? '#FFFBEB' : '#F0FFF4', border: `1px solid ${isExpired ? '#FCD34D' : '#86EFAC'}`,
              borderRadius: 12, padding: '24px 26px', textAlign: 'center', marginBottom: 20,
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{isExpired ? '⏳' : '✅'}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: isExpired ? '#92400E' : C.green, marginBottom: 4 }}>
                {isExpired ? 'Certificate genuine — calibration due date has passed' : 'Certificate verified — genuine QSL document'}
              </div>
              <div style={{ fontSize: 12.5, color: C.mgrey }}>Issued by Qalibrated Systems Limited · KENAS CL/059</div>
            </div>

            <div style={{ background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12, padding: '22px 24px' }}>
              {[
                ['Certificate No.', cert.cert_no],
                ['Instrument', [cert.instrument, cert.make, cert.model].filter(Boolean).join(' · ')],
                ['Calibrated On', cert.calibrated_at],
                ['Next Calibration Due', cert.next_cal_date || '—'],
                ['Result', isPass ? 'PASS' : 'FAIL'],
                ['Technician', cert.tech_first ? `${cert.tech_first} ${cert.tech_last}` : '—'],
                ['Countersigned', cert.checked_at && cert.checker_first ? `${cert.checker_first} ${cert.checker_last}` : 'Not yet countersigned'],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.lgrey}`, fontSize: 13 }}>
                  <span style={{ color: C.mgrey }}>{label}</span>
                  <span style={{ fontWeight: 600, color: C.dgrey, textAlign: 'right' }}>{val}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <a href="/verify" style={{ display: 'block', textAlign: 'center', marginTop: 24, fontSize: 13, color: C.mgrey, textDecoration: 'none' }}>
          ← Verify a different certificate
        </a>
      </div>
      <Footer />
    </div>
  );
}
