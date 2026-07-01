// src/app/page.js — Home page of the public Qalibrated Systems Limited site.
//
// Now one of four routes (Home, /services, /about, /contact) sharing chrome
// from src/components/public/shared.js. Home stays a condensed overview —
// hero + teaser of each section — and links out to the full page for detail,
// rather than trying to hold everything in one long scroll.

'use client';

import { C, GridMotif, NavBar, Footer, StaffLoginStrip, PageEyebrow, ServiceCard, AccreditationBadge, SERVICES, ACCREDITATIONS } from '../components/public/shared';

export default function HomePage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt }}>
      <NavBar active="/" />

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', background: `linear-gradient(160deg, ${C.navyD} 0%, ${C.navy} 65%, ${C.navyL} 100%)`, overflow: 'hidden' }}>
        <GridMotif />
        <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto', padding: '110px 32px 90px' }}>
          <div style={{
            display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: C.goldL, border: '1px solid rgba(232,184,77,0.4)', borderRadius: 99, padding: '5px 14px', marginBottom: 22,
          }}>
            ISO/IEC 17025 &amp; ISO/IEC 17020 Accredited — KENAS CL/059
          </div>
          <h1 style={{ fontSize: 'clamp(34px, 5vw, 50px)', fontWeight: 800, color: C.white, lineHeight: 1.1, letterSpacing: '-0.015em', margin: '0 0 22px', maxWidth: 760 }}>
            Calibration and inspection you can trust, traced back to national standards.
          </h1>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, maxWidth: 580, margin: '0 0 44px' }}>
            Qalibrated Systems Limited provides accredited calibration, inspection, and equipment maintenance
            services across Kenya — traceable to KEBS and BIPM national measurement standards.
          </p>
          <div style={{ display: 'flex', gap: 14, marginBottom: 0, flexWrap: 'wrap' }}>
            <a href="/contact" style={{ fontSize: 14, fontWeight: 700, color: C.navyD, background: C.gold, padding: '13px 26px', borderRadius: 8, textDecoration: 'none' }}>
              Request a Quote →
            </a>
            <a href="/services" style={{ fontSize: 14, fontWeight: 600, color: C.white, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', padding: '13px 26px', borderRadius: 8, textDecoration: 'none' }}>
              Our Services
            </a>
          </div>
        </div>
      </div>

      {/* ── SERVICES TEASER ────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '80px 32px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 44 }}>
          <div style={{ maxWidth: 560 }}>
            <PageEyebrow>What we do</PageEyebrow>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: C.navy, margin: '0 0 10px', letterSpacing: '-0.01em' }}>Accredited services for industry, utilities, and government.</h2>
          </div>
          <a href="/services" style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            View all services →
          </a>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 18 }}>
          {SERVICES.map(s => <ServiceCard key={s.title} {...s} />)}
        </div>
      </div>

      {/* ── ACCREDITATION ───────────────────────────────────────────────── */}
      <div style={{ background: C.navyD, padding: '70px 32px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.gold, marginBottom: 14, textAlign: 'center' }}>Quality you can verify</div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.white, margin: '0 0 36px', letterSpacing: '-0.01em', textAlign: 'center' }}>Independently accredited, not self-declared.</h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {ACCREDITATIONS.map(a => <AccreditationBadge key={a.code} {...a} />)}
          </div>
        </div>
      </div>

      {/* ── ABOUT TEASER ───────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '80px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
          <div>
            <PageEyebrow>About QSL</PageEyebrow>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: C.navy, margin: '0 0 16px', letterSpacing: '-0.01em' }}>Built on traceability, not guesswork.</h2>
            <p style={{ fontSize: 14.5, color: C.mgrey, lineHeight: 1.7, marginBottom: 22 }}>
              Based in Nairobi, Kenya, QSL provides accredited calibration and inspection services to
              industrial, utility, and government clients across the region — every job runs through the
              same quality system, with documented traceability at every step.
            </p>
            <a href="/about" style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, textDecoration: 'none' }}>
              More about QSL →
            </a>
          </div>
          <div style={{ background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12, padding: '28px 26px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Get in touch</div>
            {[
              ['📍', 'Address', 'Birdi Singh Complex, Off Mombasa Road, Nairobi, Kenya'],
              ['📞', 'Phone', '+254 714 999 996 / 756 999 996'],
              ['✉️', 'Email', 'info@qalibrated.co.ke'],
              ['🏢', 'P.O. Box', '34463-00100 GPO Nairobi'],
            ].map(([icon, label, val]) => (
              <div key={label} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 18 }}>{icon}</div>
                <div>
                  <div style={{ fontSize: 11, color: C.mgrey, fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ fontSize: 13.5, color: C.dgrey }}>{val}</div>
                </div>
              </div>
            ))}
            <a href="/contact" style={{
              display: 'block', textAlign: 'center', marginTop: 8, fontSize: 13.5, fontWeight: 700, color: C.navyD,
              background: C.gold, padding: '12px 20px', borderRadius: 8, textDecoration: 'none',
            }}>
              Request a Quote →
            </a>
          </div>
        </div>
      </div>

      <StaffLoginStrip />
      <Footer />
    </div>
  );
}
