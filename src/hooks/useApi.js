// src/hooks/useApi.js — Authenticated API client
'use client';
import { useCallback } from 'react';
import { useRouter }   from 'next/navigation';

export function useApi() {
  const router = useRouter();

  const getToken = () => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('qsl_token');
  };

  const getUser = () => {
    if (typeof window === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem('qsl_user') || 'null'); }
    catch { return null; }
  };

  const request = useCallback(async (url, options = {}) => {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };

    try {
      const res  = await fetch(url, { ...options, headers });
      const data = await res.json();

      if (res.status === 401) {
        localStorage.removeItem('qsl_token');
        localStorage.removeItem('qsl_user');
        router.push('/login');
        return null;
      }

      return data;
    } catch (err) {
      console.error('[API]', url, err);
      return { success: false, error: 'Network error' };
    }
  }, [router]);

  const get  = (url)         => request(url);
  const post = (url, body)   => request(url, { method: 'POST',   body: JSON.stringify(body) });
  const put  = (url, body)   => request(url, { method: 'PUT',    body: JSON.stringify(body) });
  const del  = (url)         => request(url, { method: 'DELETE' });

  return { get, post, put, del, getUser, getToken };
}
