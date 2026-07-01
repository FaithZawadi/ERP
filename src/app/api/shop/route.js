// src/app/api/shop/route.js — Admin-side Online Shop management.
//
// Authenticated counterpart to /api/public/shop. Two areas:
//
// GET  ?section=listings              -> all active items + whether each is
//                                         publicly sellable + computed price
// GET  ?section=orders                -> sales orders placed on the website
// GET  ?section=order_detail&id=      -> one order + its lines
//
// POST { action: 'toggle_listing', item_id, enabled }
// POST { action: 'update_listing', item_id, shop_description, image_url }
// POST { action: 'mark_paid', order_id }
// POST { action: 'mark_fulfilled', order_id }
// POST { action: 'cancel_order', order_id }   -> restocks every line

import { requireAuth, requirePermission, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';
import { getSellingPrice } from '../../../lib/pricing';
import { restock } from '../../../lib/stock';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'orders';

  try {
    if (section === 'listings') {
      const permCheck = await requirePermission('shop.manage_listings')(req);
      if (permCheck.error) return err(permCheck.error, permCheck.status);

      const items = await query(
        `SELECT i.*, c.name as category_name,
                (SELECT COALESCE(SUM(quantity),0) FROM stock_balances WHERE item_id=i.id) as stock_available
         FROM items i LEFT JOIN item_categories c ON c.id=i.category_id
         WHERE i.is_active=1 ORDER BY i.name`
      );
      const withPrice = [];
      for (const item of items) {
        const { price, source } = await getSellingPrice(item);
        withPrice.push({ ...item, computed_price: price, price_source: source });
      }
      return ok(withPrice);
    }

    if (section === 'orders') {
      const permCheck = await requirePermission('shop.view_orders')(req);
      if (permCheck.error) return err(permCheck.error, permCheck.status);

      const rows = await query(`SELECT * FROM sales_orders ORDER BY created_at DESC`);
      return ok(rows);
    }

    if (section === 'order_detail') {
      const permCheck = await requirePermission('shop.view_orders')(req);
      if (permCheck.error) return err(permCheck.error, permCheck.status);

      const id = searchParams.get('id');
      if (!id) return err('id required', 400);
      const order = await queryOne(`SELECT * FROM sales_orders WHERE id=?`, [id]);
      if (!order) return err('Order not found', 404);
      const lines = await query(`SELECT * FROM sales_order_lines WHERE order_id=?`, [id]);
      const invoice = order.invoice_id ? await queryOne(`SELECT * FROM tax_invoices WHERE id=?`, [order.invoice_id]) : null;
      return ok({ order, lines, invoice });
    }

    return err('Unknown section', 400);
  } catch (e) {
    console.error('Admin shop GET error:', e);
    return err('Something went wrong', 500);
  }
}

export async function POST(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON', 400); }
  const { action } = body;

  try {
    switch (action) {
      case 'toggle_listing': {
        const permCheck = await requirePermission('shop.manage_listings')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { item_id, enabled } = body;
        if (!item_id) return err('item_id required', 400);
        await run(`UPDATE items SET is_publicly_sellable=? WHERE id=?`, [enabled ? 1 : 0, item_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: enabled ? 'SHOP_LIST_ITEM' : 'SHOP_UNLIST_ITEM', module: 'Shop', recordId: item_id });
        return ok({ updated: true, item_id, enabled: !!enabled });
      }

      case 'update_listing': {
        const permCheck = await requirePermission('shop.manage_listings')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { item_id, shop_description, image_url } = body;
        if (!item_id) return err('item_id required', 400);
        await run(`UPDATE items SET shop_description=?, image_url=? WHERE id=?`, [shop_description || null, image_url || null, item_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SHOP_UPDATE_LISTING', module: 'Shop', recordId: item_id });
        return ok({ updated: true });
      }

      case 'mark_paid': {
        const permCheck = await requirePermission('shop.fulfill_orders')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { order_id } = body;
        if (!order_id) return err('order_id required', 400);
        const order = await queryOne(`SELECT * FROM sales_orders WHERE id=?`, [order_id]);
        if (!order) return err('Order not found', 404);
        await run(`UPDATE sales_orders SET status='paid' WHERE id=?`, [order_id]);
        if (order.invoice_id) {
          const invoice = await queryOne(`SELECT total FROM tax_invoices WHERE id=?`, [order.invoice_id]);
          const { v4: uuid } = require('uuid');
          await run(
            `INSERT INTO invoice_payments (id,invoice_id,amount,method,reference,date,recorded_by,notes) VALUES (?,?,?,?,?,date('now'),?,?)`,
            [uuid(), order.invoice_id, invoice?.total || order.total, 'other', order.order_no, auth.user.employee_id, 'Recorded via Online Shop order fulfilment']
          );
          await run(`UPDATE tax_invoices SET status='paid', payment_status='paid', amount_paid=? WHERE id=?`, [invoice?.total || order.total, order.invoice_id]);
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SHOP_ORDER_MARK_PAID', module: 'Shop', recordId: order_id });
        return ok({ updated: true, status: 'paid' });
      }

      case 'mark_fulfilled': {
        const permCheck = await requirePermission('shop.fulfill_orders')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { order_id } = body;
        if (!order_id) return err('order_id required', 400);
        const order = await queryOne(`SELECT id FROM sales_orders WHERE id=?`, [order_id]);
        if (!order) return err('Order not found', 404);
        await run(`UPDATE sales_orders SET status='fulfilled' WHERE id=?`, [order_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SHOP_ORDER_FULFILLED', module: 'Shop', recordId: order_id });
        return ok({ updated: true, status: 'fulfilled' });
      }

      case 'cancel_order': {
        const permCheck = await requirePermission('shop.cancel_orders')(req);
        if (permCheck.error) return err(permCheck.error, permCheck.status);

        const { order_id, reason } = body;
        if (!order_id) return err('order_id required', 400);
        const order = await queryOne(`SELECT * FROM sales_orders WHERE id=?`, [order_id]);
        if (!order) return err('Order not found', 404);
        if (order.status === 'cancelled') return err('Order is already cancelled', 400);
        if (order.status === 'fulfilled') return err('Cannot cancel an order that has already been fulfilled', 400);

        const lines = await query(`SELECT * FROM sales_order_lines WHERE order_id=?`, [order_id]);
        for (const l of lines) {
          await restock(l.item_id, l.quantity, { reference: order.order_no, doneBy: auth.user.employee_id, notes: `Cancelled order ${order.order_no}${reason ? ` — ${reason}` : ''}` });
        }
        await run(`UPDATE sales_orders SET status='cancelled', notes=COALESCE(notes,'') || ? WHERE id=?`, [reason ? `\n[Cancelled: ${reason}]` : '\n[Cancelled]', order_id]);
        if (order.invoice_id) await run(`UPDATE tax_invoices SET status='cancelled' WHERE id=?`, [order.invoice_id]);

        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SHOP_ORDER_CANCELLED', module: 'Shop', recordId: order_id, newValue: { reason } });
        return ok({ updated: true, status: 'cancelled', restocked_lines: lines.length });
      }

      default:
        return err('Unknown action', 400);
    }
  } catch (e) {
    console.error('Admin shop POST error:', e);
    return err('Something went wrong', 500);
  }
}
