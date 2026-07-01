// src/app/api/public/shop/route.js — Public online shop.
//
// Unauthenticated by design, same as /api/public/contact — this is the
// storefront, not the ERP. Two responsibilities:
//
// GET  ?section=products            -> catalog: publicly-sellable, active,
//                                       in-stock items with a computed price
// GET  ?section=product&id=         -> single item detail
// POST { action: 'create_order' }   -> cart -> sales_orders + lines,
//                                       deducts real stock, generates a
//                                       draft tax_invoice for Finance to
//                                       collect payment against offline
//                                       (per the chosen checkout model —
//                                       no online payment processing here)
//
// Prices are always computed server-side via src/lib/pricing.js, never
// trusted from the client cart payload — a tampered price in the request
// body is silently ignored in favour of the authoritative one.

import { v4 as uuid } from 'uuid';
import { ok, err, logAudit } from '../../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../../lib/db';
import { getSellingPrice } from '../../../../lib/pricing';
import { getTotalStock, deductStockAcrossLocations } from '../../../../lib/stock';
import { getNum } from '../../../../lib/settings';

function isValidEmail(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

async function productSummary(item) {
  const { price } = await getSellingPrice(item);
  const stock = await getTotalStock(item.id);
  const category = item.category_id ? await queryOne('SELECT name FROM item_categories WHERE id=?', [item.category_id]) : null;
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    description: item.shop_description || item.description || '',
    image_url: item.image_url || null,
    category: category?.name || item.category || null,
    unit: item.unit,
    price,
    in_stock: stock > 0,
    stock_available: stock,
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'products';

  try {
    if (section === 'products') {
      const items = await query(
        `SELECT * FROM items WHERE is_active=1 AND COALESCE(is_publicly_sellable,0)=1 ORDER BY name`
      );
      const products = [];
      for (const item of items) {
        const summary = await productSummary(item);
        if (summary.stock_available > 0) products.push(summary);
      }
      return ok(products);
    }

    if (section === 'product') {
      const id = searchParams.get('id');
      if (!id) return err('id required', 400);
      const item = await queryOne(
        `SELECT * FROM items WHERE id=? AND is_active=1 AND COALESCE(is_publicly_sellable,0)=1`, [id]
      );
      if (!item) return err('Product not found', 404);
      return ok(await productSummary(item));
    }

    return err('Unknown section', 400);
  } catch (e) {
    console.error('Public shop GET error:', e);
    return err('Something went wrong loading the shop', 500);
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }

  const { action } = body;
  if (action !== 'create_order') return err('Unknown action', 400);

  const { customer_name, company_name, email, phone, delivery_address, notes, items } = body;

  if (!customer_name || !String(customer_name).trim()) return err('Please enter your name', 400);
  if (!email || !isValidEmail(email)) return err('Please enter a valid email address', 400);
  if (!phone || !String(phone).trim()) return err('Please enter a phone number', 400);
  if (!delivery_address || !String(delivery_address).trim()) return err('Please enter a delivery address', 400);
  if (!Array.isArray(items) || items.length === 0) return err('Your cart is empty', 400);

  try {
    // Resolve + price every line server-side, and check stock up front so
    // we fail with a clear per-item message before touching any balances.
    const lines = [];
    for (const cartLine of items) {
      const qty = Number(cartLine.quantity);
      if (!cartLine.item_id || !qty || qty <= 0) return err('Invalid cart line', 400);

      const item = await queryOne(
        `SELECT * FROM items WHERE id=? AND is_active=1 AND COALESCE(is_publicly_sellable,0)=1`, [cartLine.item_id]
      );
      if (!item) return err(`One of the items in your cart is no longer available`, 400);

      const available = await getTotalStock(item.id);
      if (available < qty) {
        return err(`Only ${available} of "${item.name}" left in stock (you requested ${qty})`, 400);
      }

      const { price } = await getSellingPrice(item);
      lines.push({ item, qty, unit_price: price, line_total: Math.round(price * qty * 100) / 100 });
    }

    const subtotal = Math.round(lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100;
    const vatRate = await getNum('finance.vat_rate', 0.16);
    const vatAmount = Math.round(subtotal * vatRate * 100) / 100;
    const total = Math.round((subtotal + vatAmount) * 100) / 100;

    // Find-or-create the client this order belongs to, keyed on email —
    // the same way a walk-in/online customer becomes a CRM-visible client
    // rather than a one-off record nobody can follow up on.
    let client = await queryOne(`SELECT id FROM clients WHERE email=?`, [email]);
    let clientId;
    if (client) {
      clientId = client.id;
    } else {
      const primaryCompany = await queryOne(`SELECT id FROM companies WHERE is_primary=1`);
      clientId = uuid();
      await run(
        `INSERT INTO clients (id,code,name,contact_person,email,phone,address,segment,company_id) VALUES (?,?,?,?,?,?,?,?,?)`,
        [clientId, `CLT-${Date.now()}`, company_name || customer_name, customer_name, email, phone, delivery_address, 'Online Shop', primaryCompany?.id || null]
      );
    }

    const orderNo = `SO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const invoiceNo = `INV-SHOP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const orderId = uuid();
    const invoiceId = uuid();
    const primaryCompany = await queryOne(`SELECT id FROM companies WHERE is_primary=1`);
    const today = new Date().toISOString().slice(0, 10);
    // Online shop orders are paid offline post-delivery; 14 days is the
    // standard term used for walk-in/online sales (distinct from the
    // negotiated per-client terms set on regular CRM clients).
    const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    // Deduct real stock for every line before committing the order records,
    // so a mid-batch stock failure can't leave a sales order with no stock
    // behind it. Each call already re-validates availability atomically.
    for (const l of lines) {
      await deductStockAcrossLocations(l.item.id, l.qty, {
        reference: orderNo, notes: `Online shop order ${orderNo}`, type: 'sale',
      });
    }

    await transaction(async ({ run: dbRun }) => {
      await dbRun(
        `INSERT INTO tax_invoices (id,invoice_no,client_id,company_id,date,due_date,subtotal,vat_amount,vat_rate,total,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,'draft')`,
        [invoiceId, invoiceNo, clientId, primaryCompany?.id || null, today, dueDate, subtotal, vatAmount, vatRate, total]
      );
      for (const l of lines) {
        await dbRun(
          `INSERT INTO tax_invoice_lines (id,invoice_id,item_id,description,quantity,unit_price,amount,vat_amount)
           VALUES (?,?,?,?,?,?,?,?)`,
          [uuid(), invoiceId, l.item.id, l.item.name, l.qty, l.unit_price, l.line_total, Math.round(l.line_total * vatRate * 100) / 100]
        );
      }

      await dbRun(
        `INSERT INTO sales_orders (id,order_no,client_id,invoice_id,customer_name,company_name,email,phone,delivery_address,notes,status,subtotal,vat_amount,vat_rate,total,source)
         VALUES (?,?,?,?,?,?,?,?,?,?,'pending_payment',?,?,?,?,'Website')`,
        [orderId, orderNo, clientId, invoiceId, customer_name, company_name || null, email, phone, delivery_address, notes || null, subtotal, vatAmount, vatRate, total]
      );
      for (const l of lines) {
        await dbRun(
          `INSERT INTO sales_order_lines (id,order_id,item_id,item_name,item_code,quantity,unit_price,line_total)
           VALUES (?,?,?,?,?,?,?,?)`,
          [uuid(), orderId, l.item.id, l.item.name, l.item.code, l.qty, l.unit_price, l.line_total]
        );
      }
    });

    await logAudit(query, { userId: null, userName: `${customer_name} (online shop)`, action: 'CREATE_ONLINE_ORDER', module: 'Shop', recordId: orderId, newValue: { orderNo, total } });

    // Notify Commercial the same way a contact-form lead does — best
    // effort, never blocks the customer's order from succeeding.
    try {
      const { send } = require('../../../../lib/email');
      const notifyTo = process.env.SALES_NOTIFY_EMAIL || 'info@qalibrated.co.ke';
      await send({
        to: notifyTo,
        subject: `New online order ${orderNo} — ${customer_name}${company_name ? ` (${company_name})` : ''}`,
        html: `<div style="font-family:Inter,Arial,sans-serif;color:#334155;max-width:560px;">
          <h2 style="color:#1B3A5C;">New Online Order — ${orderNo}</h2>
          <p>${lines.length} item(s), total Kshs ${total.toLocaleString('en-KE')}.</p>
          <p>Invoice ${invoiceNo} has been created as a draft — check Admin → Online Shop to fulfil.</p>
        </div>`,
      });
    } catch (e) { /* non-blocking */ }

    return ok({
      order_no: orderNo,
      invoice_no: invoiceNo,
      subtotal, vat_amount: vatAmount, total,
      items: lines.map(l => ({ name: l.item.name, code: l.item.code, quantity: l.qty, unit_price: l.unit_price, line_total: l.line_total })),
    }, 201);
  } catch (e) {
    console.error('Public shop order error:', e);
    return err(e.message && e.message.startsWith('Insufficient stock') ? e.message : 'Could not place your order — please try again.', 400);
  }
}
