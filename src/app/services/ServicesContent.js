// src/app/services/page.js — Services page of the public Qalibrated site.

'use client';

import { C, GridMotif, NavBar, Footer, StaffLoginStrip, PageEyebrow, ServiceCard, SERVICES } from '../../components/public/shared';

const PROCESS = [
  ['Enquire', 'Tell us what needs calibrating, inspecting, or serviced — on-site or in our Nairobi lab.'],
  ['Schedule', 'We confirm scope, standards, and a date that fits your operation.'],
  ['Execute', 'Our technicians do the work against documented procedures, with photographic evidence on field jobs.'],
  ['Certify', 'You receive a digitally-signed, QR-verifiable certificate or report, traceable to KEBS/BIPM.'],
];

export default function ServicesPage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt }}>
      <NavBar active="/services" />

      <div style={{ position: 'relative', background: `linear-gradient(160deg, ${C.navyD} 0%, ${C.navy} 65%, ${C.navyL} 100%)`, overflow: 'hidden' }}>
        <GridMotif />
        <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto', padding: '80px 32px 64px' }}>
          <PageEyebrow>What we do</PageEyebrow>
          <h1 style={{ fontSize: 'clamp(30px, 4.5vw, 42px)', fontWeight: 800, color: C.white, lineHeight: 1.15, letterSpacing: '-0.015em', margin: '0 0 16px', maxWidth: 720 }}>
            Accredited services for industry, utilities, and government.
          </h1>
          <p style={{ fontSize: 15.5, color: 'rgba(255,255,255,0.75)', lineHeight: 1.65, maxWidth: 600, margin: 0 }}>
            From a single instrument calibration to a multi-site inspection programme, every job runs through
            the same ISO/IEC 17025 and ISO/IEC 17020 accredited quality system.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '64px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          {SERVICES.map(s => <ServiceCard key={s.title} {...s} />)}
        </div>
      </div>

      {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
      <div style={{ background: C.white, borderTop: `1px solid ${C.lgrey}`, borderBottom: `1px solid ${C.lgrey}`, padding: '64px 32px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <PageEyebrow>How it works</PageEyebrow>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: C.navy, margin: '0 0 36px', letterSpacing: '-0.01em' }}>From enquiry to certificate.</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
            {PROCESS.map(([title, desc], i) => (
              <div key={title} style={{ borderLeft: `2px solid ${C.gold}`, paddingLeft: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, letterSpacing: '0.06em', marginBottom: 6 }}>STEP {i + 1}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{title}</div>
                <div style={{ fontSize: 13, color: C.mgrey, lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '64px 32px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: C.navy, margin: '0 0 12px', letterSpacing: '-0.01em' }}>Need one of these services?</h2>
        <p style={{ fontSize: 14, color: C.mgrey, margin: '0 0 24px' }}>Tell us what you need — our Commercial team typically responds within one business day.</p>
        <a href="/contact" style={{ fontSize: 14, fontWeight: 700, color: C.navyD, background: C.gold, padding: '13px 26px', borderRadius: 8, textDecoration: 'none' }}>
          Request a Quote →
        </a>
      </div>

      <StaffLoginStrip />
      <Footer />
    </div>
  );
}
