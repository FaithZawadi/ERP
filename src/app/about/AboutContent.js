// src/app/about/page.js — About page of the public Qalibrated site.

'use client';

import { C, GridMotif, NavBar, Footer, StaffLoginStrip, PageEyebrow, AccreditationBadge, ACCREDITATIONS } from '../../components/public/shared';

export default function AboutPage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt }}>
      <NavBar active="/about" />

      <div style={{ position: 'relative', background: `linear-gradient(160deg, ${C.navyD} 0%, ${C.navy} 65%, ${C.navyL} 100%)`, overflow: 'hidden' }}>
        <GridMotif />
        <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto', padding: '80px 32px 64px' }}>
          <PageEyebrow>About QSL</PageEyebrow>
          <h1 style={{ fontSize: 'clamp(30px, 4.5vw, 42px)', fontWeight: 800, color: C.white, lineHeight: 1.15, letterSpacing: '-0.015em', margin: '0 0 16px', maxWidth: 720 }}>
            Built on traceability, not guesswork.
          </h1>
          <p style={{ fontSize: 15.5, color: 'rgba(255,255,255,0.75)', lineHeight: 1.65, maxWidth: 600, margin: 0 }}>
            Qalibrated Systems Limited is based in Nairobi, Kenya, providing accredited calibration and
            inspection services to industrial, utility, and government clients across the region.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '64px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 48, alignItems: 'start' }}>
          <div>
            <p style={{ fontSize: 14.5, color: C.mgrey, lineHeight: 1.75, marginBottom: 18 }}>
              Every job — from a single instrument calibration to a multi-site inspection programme — runs
              through the same quality system, with documented traceability at every step. That discipline
              is what an accredited laboratory and inspection body owes its clients: a result you can verify,
              not just one you're asked to trust.
            </p>
            <p style={{ fontSize: 14.5, color: C.mgrey, lineHeight: 1.75, marginBottom: 18 }}>
              Our technicians work from the same internal system that manages our stores, fleet, and finance —
              so a part used in your repair, a reference standard used in your calibration, and the technician
              who did the work are all on record. Field jobs carry mandatory pre-work and post-work inspection
              checklists, and photographic evidence with GPS and timestamp, as a matter of course rather than
              optional paperwork.
            </p>
            <p style={{ fontSize: 14.5, color: C.mgrey, lineHeight: 1.75 }}>
              Certificates and reports are digitally signed and carry a QR code for independent verification,
              with full traceability back to KEBS and BIPM national measurement standards.
            </p>
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

      <StaffLoginStrip />
      <Footer />
    </div>
  );
}
