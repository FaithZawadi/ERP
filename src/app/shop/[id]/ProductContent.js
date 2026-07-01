// src/app/shop/[id]/page.js — Product detail page.

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { C, NavBar, Footer, PageEyebrow } from '../../../components/public/shared';
import { useCart } from '../../../components/public/CartContext';

export default function ProductPage() {
  const { id } = useParams();
  const router = useRouter();
  const { addItem } = useCart();
  const [product, setProduct] = useState(null);
  const [state, setState] = useState('loading');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    fetch(`/api/public/shop?section=product&id=${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) { setProduct(d.data); setState('ready'); }
        else setState('error');
      })
      .catch(() => setState('error'));
  }, [id]);

  if (state === 'loading') {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: C.offwt, minHeight: '100vh' }}>
        <NavBar active="/shop" />
        <div style={{ textAlign: 'center', padding: '90px 32px', color: C.mgrey, fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (state === 'error' || !product) {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: C.offwt, minHeight: '100vh' }}>
        <NavBar active="/shop" />
        <div style={{ textAlign: 'center', padding: '90px 32px' }}>
          <p style={{ color: C.mgrey, fontSize: 14, marginBottom: 16 }}>That product isn't available right now.</p>
          <a href="/shop" style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, textDecoration: 'none' }}>← Back to shop</a>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: C.dgrey, background: C.offwt, minHeight: '100vh' }}>
      <NavBar active="/shop" />

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '40px 32px 80px' }}>
        <a href="/shop" style={{ fontSize: 13, color: C.mgrey, textDecoration: 'none', display: 'inline-block', marginBottom: 24 }}>← Back to shop</a>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'start' }}>
          <div style={{
            height: 320, borderRadius: 14, background: product.image_url ? `url(${product.image_url}) center/cover` : C.white,
            border: `1px solid ${C.lgrey}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64,
          }}>
            {!product.image_url && '📦'}
          </div>

          <div>
            {product.category && <PageEyebrow>{product.category}</PageEyebrow>}
            <h1 style={{ fontSize: 26, fontWeight: 800, color: C.navy, margin: '0 0 6px', letterSpacing: '-0.01em' }}>{product.name}</h1>
            <div style={{ fontSize: 12, color: C.mgrey, marginBottom: 16, fontFamily: 'monospace' }}>{product.code}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.navy, marginBottom: 6 }}>
              Kshs {Number(product.price).toLocaleString('en-KE')}
              <span style={{ fontSize: 13, color: C.mgrey, fontWeight: 500 }}> / {product.unit}</span>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: product.stock_available > 5 ? C.green : C.gold, marginBottom: 20 }}>
              {product.stock_available > 5 ? `In stock (${product.stock_available} available)` : `Only ${product.stock_available} left in stock`}
            </div>
            {product.description && (
              <p style={{ fontSize: 14, color: C.dgrey, lineHeight: 1.65, marginBottom: 24 }}>{product.description}</p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${C.lgrey}`, borderRadius: 8 }}>
                <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ width: 36, height: 38, border: 'none', background: 'none', fontSize: 16, cursor: 'pointer', color: C.navy }}>−</button>
                <span style={{ width: 36, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>{qty}</span>
                <button onClick={() => setQty(q => Math.min(product.stock_available, q + 1))} style={{ width: 36, height: 38, border: 'none', background: 'none', fontSize: 16, cursor: 'pointer', color: C.navy }}>+</button>
              </div>
              <button
                onClick={() => { addItem(product, qty); setAdded(true); setTimeout(() => setAdded(false), 1800); }}
                disabled={product.stock_available === 0}
                style={{
                  flex: 1, fontSize: 14, fontWeight: 700, color: C.navyD, background: product.stock_available === 0 ? C.lgrey : C.gold,
                  padding: '12px 22px', borderRadius: 8, border: 'none', cursor: product.stock_available === 0 ? 'default' : 'pointer',
                }}
              >
                {product.stock_available === 0 ? 'Out of stock' : added ? 'Added ✓' : 'Add to Cart'}
              </button>
            </div>
            {added && (
              <a href="/cart" style={{ fontSize: 13, color: C.navy, fontWeight: 600, textDecoration: 'none' }}>View cart →</a>
            )}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
