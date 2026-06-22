// src/app/page.js — Public landing page
//
// Introduces the QSL ERP (and, in time, other internal software QSL
// builds) to anyone who lands on the root domain — staff finding their
// way to the login screen, and eventually outside visitors curious about
// QSL's software capability. This is deliberately NOT inside the
// authenticated dashboard — different audience, no login required, and
// a different visual register (a calibration-certificate motif rather
// than a working business app's chrome).
//
// Colors and font are pulled directly from what's actually live in
// src/app/dashboard/page.js's `T` theme and src/app/layout.js's font
// stack (Inter) — not a separately-invented palette — so this page reads
// as the front door of the same system, not a disconnected marketing
// site bolted on afterward.

'use client';

const C = {
  navy:   '#1B3A5C',
  navyD:  '#0D2238',
  navyL:  '#2E5F8A',
  gold:   '#C8960C',
  goldL:  '#E8B84D',
  white:  '#FFFFFF',
  offwt:  '#F0F4F8',
  lgrey:  '#E8ECF0',
  mgrey:  '#94A3B8',
  dgrey:  '#334155',
};

function GridMotif({ opacity = 0.06 }) {
  // Faint crosshair/calibration-grid lines — the one signature visual
  // element on this page, used once in the hero and nowhere else.
  return (
    <svg
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <defs>
        <pattern id="calGrid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke={C.white} strokeWidth="1" opacity={opacity} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#calGrid)" />
    </svg>
  );
}

function ReadoutStat({ label, value, unit }) {
  return (
    <div style={{ borderLeft: `2px solid ${C.gold}`, paddingLeft: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 600, color: C.white, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>{unit}</span>}
      </div>
    </div>
  );
}

function ModuleCard({ icon, title, desc }) {
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 10, padding: '22px 20px',
      transition: 'border-color 0.15s, transform 0.15s',
    }}>
      <div style={{ fontSize: 22, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.mgrey, lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, background: 'rgba(13,34,56,0.92)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.gold, letterSpacing: '0.02em' }}>QSL</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em' }}>SOFTWARE</span>
        </div>
        <a href="/login" style={{
          fontSize: 13, fontWeight: 600, color: C.navyD, background: C.gold, padding: '9px 20px',
          borderRadius: 7, textDecoration: 'none',
        }}>
          Sign in
        </a>
      </div>

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', background: `linear-gradient(160deg, ${C.navyD} 0%, ${C.navy} 65%, ${C.navyL} 100%)`, overflow: 'hidden' }}>
        <GridMotif />
        <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto', padding: '110px 32px 90px' }}>
          <div style={{
            display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: C.goldL, border: `1px solid rgba(232,184,77,0.4)`, borderRadius: 99, padding: '5px 14px', marginBottom: 22,
          }}>
            Built in-house at Qalibrated Systems Limited
          </div>

          <h1 style={{
            fontSize: 'clamp(34px, 5vw, 52px)', fontWeight: 800, color: C.white, lineHeight: 1.08,
            letterSpacing: '-0.015em', margin: '0 0 22px', maxWidth: 760,
          }}>
            One system of record for every job QSL runs.
          </h1>

          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, maxWidth: 560, margin: '0 0 44px' }}>
            The QSL ERP brings finance, stores, projects, fleet, compliance, and calibration work into one
            place — built for how QSL actually operates, not adapted from someone else's workflow.
          </p>

          <div style={{ display: 'flex', gap: 14, marginBottom: 64, flexWrap: 'wrap' }}>
            <a href="/login" style={{
              fontSize: 14, fontWeight: 700, color: C.navyD, background: C.gold, padding: '13px 26px',
              borderRadius: 8, textDecoration: 'none',
            }}>
              Open the ERP →
            </a>
            <a href="#modules" style={{
              fontSize: 14, fontWeight: 600, color: C.white, background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.18)', padding: '13px 26px', borderRadius: 8, textDecoration: 'none',
            }}>
              See what's inside
            </a>
          </div>

          {/* Readout strip — framed like an instrument panel, not a marketing stat block */}
          <div style={{
            display: 'flex', gap: 36, flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 28,
          }}>
            <ReadoutStat label="Modules live" value="17" />
            <ReadoutStat label="Roles configured" value="11" />
            <ReadoutStat label="Database" value="PostgreSQL" />
            <ReadoutStat label="Status" value="In production" />
          </div>
        </div>
      </div>

      {/* ── MODULES ─────────────────────────────────────────────────────── */}
      <div id="modules" style={{ maxWidth: 1080, margin: '0 auto', padding: '80px 32px 40px' }}>
        <div style={{ maxWidth: 540, marginBottom: 44 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.gold, marginBottom: 10 }}>
            What's inside
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: C.navy, margin: '0 0 10px', letterSpacing: '-0.01em' }}>
            Every part of the business, one login.
          </h2>
          <p style={{ fontSize: 14.5, color: C.mgrey, lineHeight: 1.6, margin: 0 }}>
            Each module below is connected to the same database — a calibration job, a stock movement,
            and an invoice all trace back to the same record.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <ModuleCard icon="💰" title="Finance & Tax" desc="GL, payroll, imprest, VAT/PAYE, and KRA eTIMS submission in one ledger." />
          <ModuleCard icon="🏪" title="Stores & Requisitions" desc="Real-time stock across every location, with approval-gated requisitions." />
          <ModuleCard icon="🔬" title="Calibration" desc="Job tracking, certificate generation, and statutory expiry alerts." />
          <ModuleCard icon="🏛️" title="Projects" desc="Budgets, milestones, and expenses tracked against contract value." />
          <ModuleCard icon="🤝" title="CRM & Sales" desc="Client accounts, debtors, and the full sales pipeline." />
          <ModuleCard icon="🚗" title="Fleet" desc="Vehicle utilisation, insurance and service expiry, trip logs." />
          <ModuleCard icon="✅" title="Compliance" desc="Statutory calendar, certificate renewals, and audit-ready records." />
          <ModuleCard icon="🛡️" title="Administration" desc="Role-based access, branding, audit log, and module controls." />
        </div>
      </div>

      {/* ── ROLE-AWARE STRIP ────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 32px 80px' }}>
        <div style={{
          background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 14, padding: '32px 36px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap',
        }}>
          <div style={{ maxWidth: 460 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.navy, marginBottom: 6 }}>
              Every role sees only what their job needs.
            </div>
            <div style={{ fontSize: 13.5, color: C.mgrey, lineHeight: 1.55 }}>
              A technician sees calibration jobs and parts requisitions. A CFO sees finance, tax, and debtors.
              Nobody wades through eight modules that don't apply to them.
            </div>
          </div>
          <a href="/login" style={{
            fontSize: 13.5, fontWeight: 700, color: C.white, background: C.navy, padding: '12px 24px',
            borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap',
          }}>
            Sign in to your dashboard
          </a>
        </div>
      </div>

      {/* ── FUTURE PRODUCTS ─────────────────────────────────────────────── */}
      <div style={{ background: C.navyD, padding: '70px 32px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.gold, marginBottom: 14 }}>
            What's next
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: C.white, margin: '0 0 14px', letterSpacing: '-0.01em' }}>
            QSL Software is a suite, not a single app.
          </h2>
          <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.65)', lineHeight: 1.65, margin: 0 }}>
            The ERP is the first piece. Field apps for technicians and drivers, and tools for other parts
            of the business, are built on the same foundation as they're ready — each one will show up
            here when it's live.
          </p>
        </div>
      </div>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '36px 32px', textAlign: 'center', borderTop: `1px solid ${C.lgrey}` }}>
        <div style={{ fontSize: 12.5, color: C.mgrey, marginBottom: 4 }}>
          Qalibrated Systems Limited — Birdi Singh Complex, 1st Floor, Off Mombasa Road, Nairobi, Kenya
        </div>
        <div style={{ fontSize: 12, color: C.mgrey }}>
          <a href="https://www.qalibrated.co.ke" style={{ color: C.mgrey, textDecoration: 'none' }}>www.qalibrated.co.ke</a>
          {' · '}
          <a href="mailto:info@qalibrated.co.ke" style={{ color: C.mgrey, textDecoration: 'none' }}>info@qalibrated.co.ke</a>
        </div>
      </div>
    </div>
  );
}
