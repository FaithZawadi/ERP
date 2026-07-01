// src/app/shop/page.js — Shop catalog page.

'use client';

import { useEffect, useState } from 'react';
import { C, GridMotif, NavBar, Footer, PageEyebrow, ProductCard } from '../../components/public/shared';

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error

  useEffect(() => {
    fetch('/api/public/shop?section=products')
      .then(r => r.json())
      .then(d => {
        if (d.success) { setProducts(d.data); setState('ready'); }
        else setState('error');
      })
      .catch(() => setState('error'));
  }, []);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt, minHeight: '100vh' }}>
      <NavBar active="/shop" />

      <div style={{ position: 'relative', background: `linear-gradient(160deg, ${C.navyD} 0%, ${C.navy} 65%, ${C.navyL} 100%)`, overflow: 'hidden' }}>
        <GridMotif />
        <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto', padding: '70px 32px 56px' }}>
          <PageEyebrow>Shop</PageEyebrow>
          <h1 style={{ fontSize: 'clamp(28px, 4.5vw, 40px)', fontWeight: 800, color: C.white, lineHeight: 1.15, letterSpacing: '-0.015em', margin: '0 0 14px', maxWidth: 700 }}>
            Spare parts, tools, and equipment — straight from our stores.
          </h1>
          <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, maxWidth: 560, margin: 0 }}>
            Order directly from QSL's inventory. Place your order online, we'll confirm by email, and
            payment is settled on delivery or invoice.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 32px 80px' }}>
        {state === 'loading' && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.mgrey, fontSize: 14 }}>Loading products…</div>
        )}
        {state === 'error' && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.mgrey, fontSize: 14 }}>
            Couldn't load the shop right now — please try again shortly, or <a href="/contact" style={{ color: C.navy }}>contact us</a> directly.
          </div>
        )}
        {state === 'ready' && products.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: C.mgrey, fontSize: 14 }}>
            Nothing listed in the shop right now — <a href="/contact" style={{ color: C.navy }}>get in touch</a> and we'll help directly.
          </div>
        )}
        {state === 'ready' && products.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 18 }}>
            {products.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
