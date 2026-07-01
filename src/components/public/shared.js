// src/components/public/shared.js — shared chrome and primitives for the
// public Qalibrated Systems Limited site (Home, About, Services, Contact).
//
// Pulled out of the old single-page src/app/page.js so each route can be a
// real page (own URL, own <title>, shareable/bookmarkable) instead of an
// anchor-scroll section, while keeping one visual identity across all four.

'use client';

import { useState } from 'react';
import { useCart } from './CartContext';
import { C } from './theme';
export { C };

export function GridMotif({ opacity = 0.06 }) {
  return (
    <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <defs>
        <pattern id="calGrid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke={C.white} strokeWidth="1" opacity={opacity} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#calGrid)" />
    </svg>
  );
}

const NAV_LINKS = [
  ['Home', '/'],
  ['Shop', '/shop'],
  ['Services', '/services'],
  ['About', '/about'],
  ['Contact', '/contact'],
];

export function NavBar({ active = '/' }) {
  const { count } = useCart();
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 30, background: 'rgba(13,34,56,0.94)', backdropFilter: 'blur(8px)',
      borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 32px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
    }}>
      <a href="/" style={{ display: 'flex', alignItems: 'baseline', gap: 8, textDecoration: 'none' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.gold, letterSpacing: '0.02em' }}>QSL</span>
        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.06em' }}>QALIBRATED SYSTEMS LIMITED</span>
      </a>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        {NAV_LINKS.map(([label, href]) => (
          <a key={label} href={href} style={{
            fontSize: 13.5, textDecoration: 'none', fontWeight: active === href ? 700 : 500,
            color: active === href ? C.goldL : 'rgba(255,255,255,0.75)',
            borderBottom: active === href ? `2px solid ${C.goldL}` : '2px solid transparent',
            paddingBottom: 3,
          }}>{label}</a>
        ))}
        <a href="/cart" style={{ position: 'relative', display: 'flex', alignItems: 'center', textDecoration: 'none', fontSize: 18 }}>
          🛒
          {count > 0 && (
            <span style={{
              position: 'absolute', top: -8, right: -10, background: C.gold, color: C.navyD,
              fontSize: 10, fontWeight: 800, borderRadius: 99, minWidth: 16, height: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
            }}>{count}</span>
          )}
        </a>
        <a href="/login" style={{
          fontSize: 13, fontWeight: 700, color: C.navyD, background: C.gold, padding: '9px 20px',
          borderRadius: 7, textDecoration: 'none',
        }}>
          Staff Login →
        </a>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <div style={{ padding: '36px 32px', textAlign: 'center', borderTop: `1px solid ${C.lgrey}` }}>
      <div style={{ fontSize: 12.5, color: C.mgrey, marginBottom: 4 }}>
        Qalibrated Systems Limited — Birdi Singh Complex, Off Mombasa Road, Nairobi, Kenya
      </div>
      <div style={{ fontSize: 12, color: C.mgrey }}>
        <a href="mailto:info@qalibrated.co.ke" style={{ color: C.mgrey, textDecoration: 'none' }}>info@qalibrated.co.ke</a>
        {' · '}
        <span>+254 714 999 996</span>
        {' · '}
        <a href="/verify" style={{ color: C.mgrey, textDecoration: 'none' }}>Verify a Certificate</a>
        {' · '}
        <a href="/login" style={{ color: C.mgrey, textDecoration: 'none' }}>Staff Login</a>
      </div>
    </div>
  );
}

export function StaffLoginStrip() {
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 32px 80px' }}>
      <div style={{
        background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 14, padding: '28px 36px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap',
      }}>
        <div style={{ maxWidth: 460 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.navy, marginBottom: 6 }}>QSL Staff</div>
          <div style={{ fontSize: 13.5, color: C.mgrey, lineHeight: 1.55 }}>
            Sign in to the QSL ERP to access calibration jobs, finance, stores, CRM, and every other system module for your role.
          </div>
        </div>
        <a href="/login" style={{
          fontSize: 13.5, fontWeight: 700, color: C.white, background: C.navy, padding: '12px 24px',
          borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap',
        }}>
          Staff Login →
        </a>
      </div>
    </div>
  );
}

export function PageEyebrow({ children }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.gold, marginBottom: 10 }}>
      {children}
    </div>
  );
}

export function ServiceCard({ icon, title, desc, points }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12, padding: '26px 24px' }}>
      <div style={{ fontSize: 26, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.navy, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: C.mgrey, lineHeight: 1.6, marginBottom: 14 }}>{desc}</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {points.map(p => (
          <li key={p} style={{ fontSize: 12.5, color: C.dgrey, marginBottom: 6, paddingLeft: 18, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0, color: C.gold, fontWeight: 700 }}>✓</span>{p}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AccreditationBadge({ code, title, body }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
      padding: '24px 22px', flex: '1 1 260px',
    }}>
      <div style={{
        display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.navyD,
        background: C.goldL, borderRadius: 6, padding: '4px 10px', marginBottom: 12,
      }}>{code}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.white, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

export function ProductCard({ product }) {
  return (
    <a href={`/shop/${product.id}`} style={{
      display: 'block', background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12,
      overflow: 'hidden', textDecoration: 'none', color: 'inherit',
    }}>
      <div style={{
        height: 140, background: product.image_url ? `url(${product.image_url}) center/cover` : C.offwt,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36,
      }}>
        {!product.image_url && '📦'}
      </div>
      <div style={{ padding: '16px 16px 18px' }}>
        {product.category && (
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.gold, marginBottom: 6 }}>
            {product.category}
          </div>
        )}
        <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, marginBottom: 6, lineHeight: 1.35 }}>{product.name}</div>
        <div style={{ fontSize: 12, color: C.mgrey, marginBottom: 12, lineHeight: 1.5, minHeight: 18 }}>
          {product.description ? (product.description.length > 80 ? product.description.slice(0, 80) + '…' : product.description) : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>
            Kshs {Number(product.price).toLocaleString('en-KE')}
          </div>
          <div style={{ fontSize: 11, color: product.stock_available > 5 ? C.green : C.gold, fontWeight: 600 }}>
            {product.stock_available > 5 ? 'In stock' : `Only ${product.stock_available} left`}
          </div>
        </div>
      </div>
    </a>
  );
}

export function ContactForm() {
  const [form, setForm] = useState({ company: '', contact_name: '', email: '', phone: '', service: 'Calibration Services', message: '' });
  const [status, setStatus] = useState({ state: 'idle', msg: '' }); // idle | sending | success | error

  const submit = async (e) => {
    e.preventDefault();
    if (!form.contact_name || !form.email || !form.message) {
      setStatus({ state: 'error', msg: 'Please fill in your name, email, and a short message.' });
      return;
    }
    setStatus({ state: 'sending', msg: '' });
    try {
      const res = await fetch('/api/public/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setStatus({ state: 'success', msg: `Thank you — your enquiry (${data.data.ref_no}) has been received. We'll be in touch shortly.` });
        setForm({ company: '', contact_name: '', email: '', phone: '', service: 'Calibration Services', message: '' });
      } else {
        setStatus({ state: 'error', msg: data.error || 'Something went wrong — please try again.' });
      }
    } catch {
      setStatus({ state: 'error', msg: 'Could not reach the server — please check your connection and try again.' });
    }
  };

  const inputStyle = {
    width: '100%', padding: '11px 14px', border: `1.5px solid ${C.lgrey}`, borderRadius: 8,
    fontSize: 14, color: C.dgrey, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 14,
  };
  const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: C.dgrey, marginBottom: 6 };

  if (status.state === 'success') {
    return (
      <div style={{ background: '#F0FFF4', border: '1px solid #86EFAC', borderRadius: 12, padding: '28px 26px', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>✅</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.green, marginBottom: 6 }}>Enquiry received</div>
        <div style={{ fontSize: 13.5, color: C.dgrey }}>{status.msg}</div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12, padding: '28px 26px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelStyle}>Your Name *</label>
          <input style={inputStyle} value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} placeholder="Jane Mwangi" />
        </div>
        <div>
          <label style={labelStyle}>Company</label>
          <input style={inputStyle} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Your organisation" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelStyle}>Email *</label>
          <input style={inputStyle} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
        </div>
        <div>
          <label style={labelStyle}>Phone</label>
          <input style={inputStyle} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+254 7xx xxx xxx" />
        </div>
      </div>
      <label style={labelStyle}>Service of Interest</label>
      <select style={{ ...inputStyle, background: C.white }} value={form.service} onChange={e => setForm({ ...form, service: e.target.value })}>
        {['Calibration Services', 'Inspection Services', 'Equipment Repair & Maintenance', 'Fleet / Asset Management', 'Other'].map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <label style={labelStyle}>Message *</label>
      <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Tell us what you need calibrated, inspected, or serviced…" />
      {status.state === 'error' && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#DC2626', padding: '10px 14px', borderRadius: 7, fontSize: 12.5, marginBottom: 14 }}>{status.msg}</div>
      )}
      <button type="submit" disabled={status.state === 'sending'} style={{
        width: '100%', fontSize: 14, fontWeight: 700, color: C.navyD, background: C.gold, padding: '13px 26px',
        borderRadius: 8, border: 'none', cursor: status.state === 'sending' ? 'default' : 'pointer', opacity: status.state === 'sending' ? 0.6 : 1,
      }}>
        {status.state === 'sending' ? 'Sending…' : 'Send Enquiry'}
      </button>
    </form>
  );
}

export const SERVICES = [
  { icon: '⚖️', title: 'Calibration Services',
    desc: 'ISO/IEC 17025 accredited calibration across mass, temperature, pressure, volume, flow, and humidity, traceable to KEBS/BIPM.',
    points: ['Mass standards & weighing instruments (NAWI)', 'Temperature, pressure, volume, flow, humidity', 'On-site and in-lab calibration', 'Digitally-signed calibration certificates'] },
  { icon: '🔍', title: 'Inspection Services',
    desc: 'ISO/IEC 17020 accredited inspection body, with mandatory pre- and post-work checks on every field job.',
    points: ['Equipment & installation inspection', 'Pre-work / post-work compliance checks', 'Non-conformance reporting & resolution', 'Photographic evidence with GPS + timestamp'] },
  { icon: '🔧', title: 'Equipment Repair & Maintenance',
    desc: 'Field service and workshop repair for instrumentation and weighing equipment, backed by genuine parts and trained technicians.',
    points: ['Field service with full job documentation', 'Genuine parts sourced through our stores', 'Preventive maintenance scheduling', 'Service history retained per asset'] },
  { icon: '🚗', title: 'Fleet & Asset Support',
    desc: 'Supporting infrastructure that keeps accredited work on schedule — a managed fleet and tracked asset register.',
    points: ['Vehicle insurance & service tracking', 'Asset register with depreciation', 'Reference standard traceability chain'] },
];

export const ACCREDITATIONS = [
  { code: 'ISO/IEC 17025', title: 'Calibration Laboratory — KENAS CL/059',
    body: 'Accredited by the Kenya Accreditation Service for the competence of testing and calibration laboratories. Every certificate carries a QR code for verification and traceability to KEBS/BIPM national standards.' },
  { code: 'ISO/IEC 17020', title: 'Inspection Body',
    body: 'Accredited for the operation of inspection bodies. Mandatory pre-work and post-work inspection checklists are enforced on every field job — not optional paperwork.' },
  { code: 'ilac-MRA', title: 'International Recognition',
    body: 'Operating under the ILAC Mutual Recognition Arrangement, so our results are recognised by accreditation bodies worldwide.' },
];
