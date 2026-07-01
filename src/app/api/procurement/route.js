// src/app/api/procurement/route.js — Procurement, Stores & GRN API

import { v4 as uuid } from 'uuid';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'prs';

  try {
    switch (section) {
      case 'prs': {
        const rows = await query(
          `SELECT pr.*, e.first_name||' '||e.last_name as requestor_name, s.name as supplier_name
           FROM purchase_requisitions pr
           LEFT JOIN employees e ON pr.requested_by=e.id
           LEFT JOIN suppliers s ON pr.supplier_id=s.id
           ORDER BY pr.created_at DESC LIMIT 100`
        );
        return ok(rows);
      }
      case 'lpos': {
        const rows = await query(
          `SELECT l.*, s.name as supplier_name FROM lpos l LEFT JOIN suppliers s ON l.supplier_id=s.id ORDER BY l.date DESC`
        );
        return ok(rows);
      }
      case 'grns': {
        const rows = await query(
          `SELECT g.*, l.lpo_no, s.name as supplier_name
           FROM grns g JOIN lpos l ON g.lpo_id=l.id JOIN suppliers s ON l.supplier_id=s.id
           ORDER BY g.date DESC`
        );
        return ok(rows);
      }
      case 'suppliers': {
        return ok(await query(`SELECT * FROM suppliers WHERE is_approved=1 ORDER BY name`));
      }
      case 'inventory': {
        return ok(await query(`SELECT * FROM items WHERE is_active=1 ORDER BY category, name`));
      }

      // QSL_PurchaseRequisition_Template — generates a branded PR PDF
      case 'pr_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const pr = await queryOne(
          `SELECT pr.*, e.first_name||' '||e.last_name as requestor_name, s.name as supplier_name
           FROM purchase_requisitions pr
           LEFT JOIN employees e ON pr.requested_by=e.id
           LEFT JOIN suppliers s ON pr.supplier_id=s.id WHERE pr.id=?`, [id]);
        if (!pr) return err('Not found', 404);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('purchase_req', {
          docNo: pr.pr_no,
          blocks: {
            Requester: { Name: pr.requestor_name, Department: pr.department, Date: new Date(pr.created_at).toLocaleDateString('en-KE') },
            Purpose:   { Purpose: pr.purpose, Supplier: pr.supplier_name || 'TBD', Status: pr.status },
          },
          columns: [
            { label: 'Description', key: 'description', weight: 3 },
            { label: 'Amount (Kshs)', key: 'amount', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') },
          ],
          rows: [{ description: pr.description, amount: pr.amount }],
          totals: [{ label: 'TOTAL', value: `Kshs ${Number(pr.amount||0).toLocaleString('en-KE')}` }],
        });
        return ok(result);
      }

      // QSL_PurchaseOrder_Template — generates a branded LPO PDF
      case 'lpo_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const lpo = await queryOne(`SELECT l.*, s.name as supplier_name, s.address as supplier_address, s.kra_pin as supplier_pin
                                     FROM lpos l LEFT JOIN suppliers s ON l.supplier_id=s.id WHERE l.id=?`, [id]);
        if (!lpo) return err('Not found', 404);
        const lines = await query(`SELECT * FROM lpo_lines WHERE lpo_id=?`, [id]);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('purchase_order', {
          docNo: lpo.lpo_no,
          blocks: {
            Supplier: { Name: lpo.supplier_name, PIN: lpo.supplier_pin, Address: lpo.supplier_address },
            Delivery: { Date: lpo.delivery_date, Currency: lpo.currency, 'FX Rate': lpo.fx_rate },
          },
          columns: [
            { label: 'Description', key: 'description', weight: 3 },
            { label: 'Qty', key: 'quantity', weight: 1, align: 'right' },
            { label: 'Unit Price', key: 'unit_price', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') },
            { label: 'Total', key: 'total', weight: 1, align: 'right', format: v => Number(v||0).toLocaleString('en-KE') },
          ],
          rows: lines,
          totals: [
            { label: 'Subtotal', value: Number(lpo.total||0).toLocaleString('en-KE') },
            { label: 'VAT',      value: Number(lpo.vat||0).toLocaleString('en-KE') },
            { label: 'GRAND TOTAL', value: `Kshs ${Number(lpo.grand_total||0).toLocaleString('en-KE')}` },
          ],
          notes: lpo.landed_cost ? `Landed cost (incl. duty/freight/insurance/FX buffer): Kshs ${Number(lpo.landed_cost).toLocaleString('en-KE')}` : '',
        });
        return ok(result);
      }

      // QSL_GRN_Template — generates a branded Goods Received Note PDF
      case 'grn_pdf': {
        const id = searchParams.get('id');
        if (!id) return err('id required', 400);
        const grn = await queryOne(
          `SELECT g.*, l.lpo_no, s.name as supplier_name
           FROM grns g JOIN lpos l ON g.lpo_id=l.id JOIN suppliers s ON l.supplier_id=s.id WHERE g.id=?`, [id]);
        if (!grn) return err('Not found', 404);
        const lines = await query(`SELECT * FROM lpo_lines WHERE lpo_id=?`, [grn.lpo_id]);
        const { generateBusinessDoc, loadCompany } = require('../../../lib/pdf');
        await loadCompany();
        const result = await generateBusinessDoc('grn', {
          docNo: grn.grn_no,
          blocks: {
            Supplier: { Name: grn.supplier_name, 'LPO No': grn.lpo_no },
            Order:    { Date: grn.date, 'Stage 1': grn.stage1_done ? 'Done' : 'Pending', 'Stage 2': grn.stage2_done ? 'Done' : 'Pending' },
          },
          columns: [
            { label: 'Description', key: 'description', weight: 3 },
            { label: 'Qty Received', key: 'quantity', weight: 1, align: 'right' },
            { label: 'Unit', key: 'unit', weight: 1 },
          ],
          rows: lines,
          notes: grn.stage1_notes || '',
        });
        return ok(result);
      }
      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    return err('Server error', 500);
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

      case 'create_pr': {
        const { description, department, amount, purpose, supplier_id } = body;
        if (!description || !amount || !purpose) return err('description, amount, purpose required', 400);

        // PROC-003: Quotation threshold check
        let quotesRequired = 1;
        if (amount > 500000) quotesRequired = -1; // Formal tender
        else if (amount > 50000) quotesRequired = 3;

        if (quotesRequired === -1) {
          return err('PROC-003: Amount exceeds Kshs 500,000 — formal tender process required. Raise as formal tender, not a PR.', 400);
        }

        const id    = uuid();
        const pr_no = `PR-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

        await run(
          `INSERT INTO purchase_requisitions (id,pr_no,description,department,requested_by,amount,purpose,supplier_id,status)
           VALUES (?,?,?,?,?,?,?,?,'pending_dept')`,
          [id, pr_no, description, department, auth.user.employee_id, amount, purpose, supplier_id]
        );

        return ok({ id, pr_no, quotes_required: quotesRequired }, 201);
      }

      case 'approve_pr': {
        const { pr_id, level } = body;
        if (!pr_id || !level) return err('pr_id and level required', 400);

        const now = new Date().toISOString();
        if (level === 'dept') {
          await run(`UPDATE purchase_requisitions SET status='pending_fm', dept_approved_by=?, dept_approved_at=? WHERE id=?`, [auth.user.employee_id, now, pr_id]);
        } else if (level === 'fm') {
          await run(`UPDATE purchase_requisitions SET status='approved', fm_approved_by=?, fm_approved_at=? WHERE id=?`, [auth.user.employee_id, now, pr_id]);
        } else if (level === 'md') {
          await run(`UPDATE purchase_requisitions SET status='approved', md_approved_by=?, md_approved_at=? WHERE id=?`, [auth.user.employee_id, now, pr_id]);
        }

        // Notify PR requestor of decision
        try {
          const { sendApprovalRequest } = require('../../../lib/email');
          const pr = await queryOne(
            `SELECT pr.*, e.email as requestor_email, e.first_name||' '||e.last_name as requestor_name
             FROM purchase_requisitions pr JOIN employees e ON pr.requested_by=e.id WHERE pr.id=?`, [pr_id]
          );
          if (pr?.requestor_email) {
            await sendApprovalRequest({
              to: pr.requestor_email, approver_name: pr.requestor_name,
              action: `PR ${level.toUpperCase()} Approved`, document_ref: pr.pr_no,
              amount: pr.amount, requested_by: auth.user.name,
            });
          }
        } catch (e) { console.error('[PR email]', e.message); }

        return ok({ approved: true, level });
      }

      case 'upload_grn_photo': {
        try {
          const { parseFormData } = require('../../../lib/upload');
          const { fields, files } = await parseFormData(req, { category: 'grn_photos', multiple: true });
          if (!files?.length) return err('No photos provided', 400);
          const grn_id = fields.grn_id;
          if (!grn_id) return err('grn_id required', 400);
          const urls = files.map(f => f.url);
          await run(`UPDATE grns SET photo_paths=? WHERE id=?`, [JSON.stringify(urls), grn_id]);
          return ok({ uploaded: true, count: files.length, urls });
        } catch (uploadErr) {
          return err('Upload failed: ' + uploadErr.message, 500);
        }
      }

      case 'create_lpo': {
        const { pr_id, supplier_id, delivery_date, lines, currency, fx_rate, lead_time_days, freight, duty, insurance } = body;
        if (!supplier_id || !lines?.length) return err('supplier_id and lines required', 400);

        const s = require('../../../lib/settings');
        const total      = lines.reduce((s, l) => s + l.total, 0);
        const vatRate    = await s.getNum('finance.vat_rate', 0.16);
        const vat        = Math.round(total * vatRate);
        const grand_total = total + vat;
        const lpo_no    = `LPO-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
        const lpoId     = uuid();

        // FIN-015: FX risk buffer on import LPOs (USD/CNY) — 5% standard, 8%
        // when lead time exceeds the threshold. Landed cost (KES) = value × rate
        // + buffer + duties + freight + insurance.
        const cur = (currency || 'KES').toUpperCase();
        const rate = parseFloat(fx_rate) || 1;
        const f = parseFloat(freight)||0, d = parseFloat(duty)||0, ins = parseFloat(insurance)||0;
        let buffer_pct = 0, landed_cost;
        if (cur !== 'KES') {
          const lead = parseInt(lead_time_days||0, 10);
          const leadThreshold = await s.getInt('finance.fx_buffer_lead_days', 60);
          buffer_pct = lead > leadThreshold ? await s.getNum('finance.fx_buffer_long', 0.08) : await s.getNum('finance.fx_buffer', 0.05);
          landed_cost = Math.round(grand_total * rate * (1 + buffer_pct) + f + d + ins);
        } else {
          landed_cost = grand_total + f + d + ins;
        }

        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO lpos (id,lpo_no,pr_id,supplier_id,date,delivery_date,total,vat,grand_total,currency,fx_rate,fx_buffer_pct,lead_time_days,freight,duty,insurance,landed_cost)
             VALUES (?,?,?,?,date('now'),?,?,?,?,?,?,?,?,?,?,?,?)`,
            [lpoId, lpo_no, pr_id, supplier_id, delivery_date, total, vat, grand_total, cur, rate, buffer_pct, parseInt(lead_time_days||0,10), f, d, ins, landed_cost]
          );
          for (const l of lines) {
            await dbRun(
              `INSERT INTO lpo_lines (id,lpo_id,description,quantity,unit,unit_price,total) VALUES (?,?,?,?,?,?,?)`,
              [uuid(), lpoId, l.description, l.quantity, l.unit||'each', l.unit_price, l.quantity*l.unit_price]
            );
          }
          if (pr_id) await dbRun(`UPDATE purchase_requisitions SET lpo_id=?, status='lpo_issued' WHERE id=?`, [lpoId, pr_id]);
        });

        return ok({ lpo_id: lpoId, lpo_no, total, vat, grand_total, currency: cur, fx_buffer_pct: buffer_pct, landed_cost }, 201);
      }

      // STK-024B: attach a Stage 1 GRN inspection photo. Takes the image as
      // a base64 data URL (same convention as SOPs / job photos elsewhere
      // — the frontend's API client only ever sends JSON, so the older
      // multipart-only `upload_grn_photo` action was never actually
      // reachable from any UI). Appends to the existing photo set rather
      // than replacing it, so a user can attach photos one at a time —
      // e.g. straight from a phone camera — without losing earlier ones.
      case 'attach_grn_photo': {
        const { grn_id, file_name, file_data, caption } = body;
        if (!grn_id || !file_data) return err('grn_id and file_data required', 400);
        const match = /^data:([^;]+);base64,(.+)$/.exec(file_data);
        if (!match) return err('file_data must be a base64 data URL', 400);

        const path = require('path');
        const fs = require('fs');
        const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
        const dir = path.join(UPLOAD_DIR, 'grn_photos');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const buffer = Buffer.from(match[2], 'base64');
        const ext = path.extname(file_name || '') || '.jpg';
        const stored = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        fs.writeFileSync(path.join(dir, stored), buffer);
        const url = `/uploads/grn_photos/${stored}`;

        const grn = await queryOne(`SELECT photo_paths FROM grns WHERE id=?`, [grn_id]);
        if (!grn) return err('GRN not found', 404);
        let existing = [];
        try { existing = JSON.parse(grn.photo_paths || '[]'); } catch { existing = []; }
        existing.push({ url, caption: caption || null, uploaded_by: auth.user.employee_id, uploaded_at: new Date().toISOString() });
        await run(`UPDATE grns SET photo_paths=? WHERE id=?`, [JSON.stringify(existing), grn_id]);

        return ok({ url, count: existing.length }, 201);
      }

      case 'create_grn': {
        const { lpo_id, stage, notes, photo_paths } = body;
        if (!lpo_id) return err('lpo_id required', 400);

        const existing = await queryOne(`SELECT * FROM grns WHERE lpo_id=?`, [lpo_id]);
        const now      = new Date().toISOString();

        if (!existing && stage === 'stage1') {
          const id = uuid();
          const grn_no = `GRN-${Date.now()}`;
          await run(
            `INSERT INTO grns (id,grn_no,lpo_id,date,received_by,stage1_done,stage1_signed_at,stage1_notes,photo_paths)
             VALUES (?,?,?,date('now'),?,1,?,?,?)`,
            [id, grn_no, lpo_id, auth.user.employee_id, now, notes, JSON.stringify(photo_paths||[])]
          );
          return ok({ grn_id: id, grn_no, stage: 'stage1_complete' }, 201);
        }

        if (existing && stage === 'stage2') {
          if (!existing.stage1_done) return err('STK-020: Stage 1 physical inspection must be completed first', 400);
          if (!existing.photo_paths || existing.photo_paths === '[]') return err('STK-024B: Photo evidence required — upload photos before raising Stage 2 GRN', 400);

          await run(
            `UPDATE grns SET stage2_done=1, stage2_raised_at=?, status='complete' WHERE id=?`,
            [now, existing.id]
          );

          // Update stock
          const lpo   = await queryOne(`SELECT * FROM lpos WHERE id=?`, [lpo_id]);
          const lines = await query(`SELECT * FROM lpo_lines WHERE lpo_id=?`, [lpo_id]);

          for (const line of lines) {
            const item = await queryOne(`SELECT * FROM items WHERE name LIKE ?`, [`%${line.description.split(' ')[0]}%`]);
            if (item) {
              const [cur] = await query(`SELECT COALESCE(MAX(balance),0) as bal FROM stock_movements WHERE item_id=?`, [item.id]);
              await run(
                `INSERT INTO stock_movements (id,item_id,type,quantity,balance,reference,grn_id,done_by) VALUES (?,?,?,?,?,?,?,?)`,
                [uuid(), item.id, 'receipt', line.quantity, (cur?.bal||0)+line.quantity, lpo.lpo_no, existing.id, auth.user.employee_id]
              );
            }
          }
          await run(`UPDATE lpos SET status='delivered' WHERE id=?`, [lpo_id]);
          return ok({ updated: true, stage: 'stage2_complete' });
        }

        return err('Invalid GRN state or stage', 400);
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[Procurement POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
