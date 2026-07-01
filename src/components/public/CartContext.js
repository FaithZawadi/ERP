// src/components/public/CartContext.js — public-site shopping cart.
//
// Plain React context + localStorage. This is the real production app
// (not a claude.ai artifact), so localStorage is fine here — it's exactly
// what useApi.js already uses for the staff auth token.

'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const CartContext = createContext(null);
const STORAGE_KEY = 'qsl_shop_cart';

export function CartProvider({ children }) {
  const [items, setItems] = useState([]); // [{ id, code, name, price, unit, qty, stock_available }]
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch { /* ignore corrupt cart */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return; // don't clobber storage with the initial empty state before load runs
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* storage unavailable */ }
  }, [items, loaded]);

  const addItem = useCallback((product, qty = 1) => {
    setItems(prev => {
      const existing = prev.find(p => p.id === product.id);
      const maxQty = product.stock_available ?? Infinity;
      if (existing) {
        const newQty = Math.min(existing.qty + qty, maxQty);
        return prev.map(p => p.id === product.id ? { ...p, qty: newQty } : p);
      }
      return [...prev, {
        id: product.id, code: product.code, name: product.name, price: product.price,
        unit: product.unit, stock_available: product.stock_available, qty: Math.min(qty, maxQty),
      }];
    });
  }, []);

  const updateQty = useCallback((id, qty) => {
    setItems(prev => prev
      .map(p => p.id === id ? { ...p, qty: Math.max(1, Math.min(qty, p.stock_available ?? Infinity)) } : p)
    );
  }, []);

  const removeItem = useCallback((id) => {
    setItems(prev => prev.filter(p => p.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((s, p) => s + p.qty, 0);
  const subtotal = Math.round(items.reduce((s, p) => s + p.qty * p.price, 0) * 100) / 100;

  return (
    <CartContext.Provider value={{ items, addItem, updateQty, removeItem, clear, count, subtotal, loaded }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
