// src/app/checkout/page.js — Checkout page.

'use client';

import { useState } from 'react';
import { C, NavBar, Footer, PageEyebrow } from '../../components/public/shared';
import { useCart } from '../../components/public/CartContext';

export default function CheckoutPage() {
  const { items, subtotal, clear, loaded } = useCart();
  const [form, setForm] = useState({ customer_name: '', company_name: '', email: '', phone: '', delivery_address: '', notes: '' });
  const [status, setStatus] = useState({ state: 'idle', msg: '' }); // idle | sending | success | error
  const [confirmation, setConfirmation] = useState(null);

  const inputStyle = {
    width: '100%', padding: '11px 14px', border: `1.5px solid ${C.lgrey}`, borderRadius: 8,
    fontSize: 14, color: C.dgrey, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 14,
  };
  const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: C.dgrey, marginBottom: 6 };

  const vatEstimate = Math.round(subtotal * 0.16 * 100) / 100; // display estimate only — server computes the authoritative figure
  const totalEstimate = Math.round((subtotal + vatEstimate) * 100) / 100;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.customer_name || !form.email || !form.phone || !form.delivery_address) {
      setStatus({ state: 'error', msg: 'Please fill in your name, email, phone, and delivery address.' });
      return;
    }
    setStatus({ state: 'sending', msg: '' });
    try {
      const res = await fetch('/api/public/shop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order', ...form,
          items: items.map(p => ({ item_id: p.id, quantity: p.qty })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmation(data.data);
        clear();
        setStatus({ state: 'success', msg: '' });
      } else {
        setStatus({ state: 'error', msg: data.error || 'Could not place your order — please try again.' });
      }
    } catch {
      setStatus({ state: 'error', msg: 'Could not reach the server — please check your connection and try again.' });
    }
  };

  if (confirmation) {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt, minHeight: '100vh' }}>
        <NavBar active="/cart" />
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '60px 32px 90px' }}>
          <div style={{ background: '#F0FFF4', border: '1px solid #86EFAC', borderRadius: 12, padding: '32px 28px', textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.green, marginBottom: 6 }}>Order placed — {confirmation.order_no}</div>
            <div style={{ fontSize: 13.5, color: C.dgrey, lineHeight: 1.6 }}>
              We've emailed a confirmation and invoice {confirmation.invoice_no} is on its way. Our team will be in touch to arrange payment and delivery.
            </div>
          </div>
          <div style={{ background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12, padding: '22px 24px' }}>
            {confirmation.items.map(l => (
              <div key={l.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span>{l.name} × {l.quantity}</span>
                <span style={{ fontWeight: 600 }}>Kshs {l.line_total.toLocaleString('en-KE')}</span>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.lgrey}`, marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15, color: C.navy }}>
              <span>Total</span>
              <span>Kshs {confirmation.total.toLocaleString('en-KE')}</span>
            </div>
          </div>
          <a href="/shop" style={{ display: 'block', textAlign: 'center', marginTop: 24, fontSize: 13.5, fontWeight: 700, color: C.navy, textDecoration: 'none' }}>
            ← Continue shopping
          </a>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt, minHeight: '100vh' }}>
      <NavBar active="/cart" />

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '48px 32px 90px' }}>
        <PageEyebrow>Checkout</PageEyebrow>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.navy, margin: '0 0 24px', letterSpacing: '-0.01em' }}>Delivery & contact details</h1>

        {loaded && items.length === 0 && !confirmation && (
          <div style={{ background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12, padding: '32px 28px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: C.mgrey, marginBottom: 16 }}>Your cart is empty.</p>
            <a href="/shop" style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, textDecoration: 'none' }}>← Back to shop</a>
          </div>
        )}

        {items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 32, alignItems: 'start' }}>
            <form onSubmit={submit} style={{ background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12, padding: '26px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Your Name *</label>
                  <input style={inputStyle} value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} placeholder="Jane Mwangi" />
                </div>
                <div>
                  <label style={labelStyle}>Company (optional)</label>
                  <input style={inputStyle} value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} placeholder="Your organisation" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Email *</label>
                  <input style={inputStyle} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
                </div>
                <div>
                  <label style={labelStyle}>Phone *</label>
                  <input style={inputStyle} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+254 7xx xxx xxx" />
                </div>
              </div>
              <label style={labelStyle}>Delivery Address *</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }} value={form.delivery_address} onChange={e => setForm({ ...form, delivery_address: e.target.value })} placeholder="Where should we deliver this?" />
              <label style={labelStyle}>Order Notes (optional)</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Anything we should know?" />

              {status.state === 'error' && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#DC2626', padding: '10px 14px', borderRadius: 7, fontSize: 12.5, marginBottom: 14 }}>{status.msg}</div>
              )}
              <div style={{ fontSize: 11.5, color: C.mgrey, marginBottom: 14, lineHeight: 1.5 }}>
                No online payment is taken — we'll generate an invoice and arrange payment and delivery with you directly.
              </div>
              <button type="submit" disabled={status.state === 'sending'} style={{
                width: '100%', fontSize: 14, fontWeight: 700, color: C.navyD, background: C.gold, padding: '13px 26px',
                borderRadius: 8, border: 'none', cursor: status.state === 'sending' ? 'default' : 'pointer', opacity: status.state === 'sending' ? 0.6 : 1,
              }}>
                {status.state === 'sending' ? 'Placing order…' : 'Place Order'}
              </button>
            </form>

            <div style={{ background: C.white, border: `1px solid ${C.lgrey}`, borderRadius: 12, padding: '22px 24px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Order Summary</div>
              {items.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span>{p.name} × {p.qty}</span>
                  <span style={{ fontWeight: 600 }}>Kshs {(p.price * p.qty).toLocaleString('en-KE')}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${C.lgrey}`, marginTop: 10, paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: C.mgrey, marginBottom: 4 }}>
                  <span>Subtotal</span><span>Kshs {subtotal.toLocaleString('en-KE')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: C.mgrey, marginBottom: 8 }}>
                  <span>VAT (est. 16%)</span><span>Kshs {vatEstimate.toLocaleString('en-KE')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15, color: C.navy }}>
                  <span>Estimated Total</span><span>Kshs {totalEstimate.toLocaleString('en-KE')}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
