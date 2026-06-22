'use client';
// src/app/login/page.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const T = {
  navy: '#1B3A5C', navyD: '#0D2238', gold: '#C8960C',
  white: '#FFFFFF', offwt: '#F0F4F8', lgrey: '#E8ECF0',
  mgrey: '#94A3B8', dgrey: '#334155', green: '#1E6B3C',
  greenL: '#DCFCE7', red: '#C00000', redL: '#FEE2E2',
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('hadar@qalibrated.co.ke');
  const [password, setPassword] = useState('QSL@2026!');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  // Branding loaded before auth via the public /api/branding endpoint
  const [brand, setBrand] = useState({ primary_color: T.navy, accent_color: T.gold, company_display_name: 'QSL', logo_url: null });
  useEffect(() => { fetch('/api/branding').then(r=>r.json()).then(r=>{ if(r?.success) setBrand(b=>({...b,...r.data})); }).catch(()=>{}); }, []);
  const primary = brand.primary_color || T.navy;
  const accent  = brand.accent_color  || T.gold;

  const login = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email, password }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Login failed'); setLoading(false); return; }
      localStorage.setItem('qsl_token', data.data.token);
      localStorage.setItem('qsl_user',  JSON.stringify(data.data.user));
      router.push('/dashboard');
    } catch {
      setError('Network error — check your connection');
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: T.navyD, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          {brand.logo_url
            ? <img src={brand.logo_url} alt={brand.company_display_name} style={{ maxHeight: 64, maxWidth: 240, objectFit: 'contain' }}/>
            : <div style={{ fontSize: 36, fontWeight: 800, color: accent, letterSpacing: -1 }}>{brand.company_display_name || 'QSL'}</div>}
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', letterSpacing: 2, marginTop: 4, textTransform: 'uppercase' }}>Enterprise Resource Planning</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 8 }}>Qalibrated Systems Limited</div>
        </div>

        {/* Card */}
        <div style={{ background: T.white, borderRadius: 16, padding: 36, boxShadow: '0 24px 64px rgba(0,0,0,.4)' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: primary, marginBottom: 6 }}>Sign in to ERP</h1>
          <p style={{ fontSize: 13, color: T.mgrey, marginBottom: 28 }}>Use your QSL email and ERP password</p>

          {error && (
            <div style={{ background: T.redL, border: `1px solid #FCA5A5`, color: T.red, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
              {error}
            </div>
          )}

          <form onSubmit={login}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.dgrey, marginBottom: 5 }}>Email Address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                style={{ width: '100%', padding: '10px 13px', border: `1.5px solid ${T.lgrey}`, borderRadius: 8, fontSize: 14, color: T.dgrey, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.dgrey, marginBottom: 5 }}>Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)} required
                style={{ width: '100%', padding: '10px 13px', border: `1.5px solid ${T.lgrey}`, borderRadius: 8, fontSize: 14, color: T.dgrey, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <button
              type="submit" disabled={loading}
              style={{ width: '100%', padding: '12px', background: loading ? T.mgrey : primary, color: T.white, border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div style={{ marginTop: 24, padding: '14px 16px', background: T.offwt, borderRadius: 8, fontSize: 11, color: T.mgrey }}>
            <strong style={{ color: T.navy }}>Demo credentials</strong><br />
            All staff: <span style={{ fontFamily: 'monospace' }}>QSL@2026!</span><br />
            MD: hadar@qalibrated.co.ke<br />
            Finance: skamau@qalibrated.co.ke
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'rgba(255,255,255,.3)' }}>
          QSL ERP v1.0 · Secured with RSA-2048 digital signatures · ARCH-007B
        </div>
      </div>
    </div>
  );
}
