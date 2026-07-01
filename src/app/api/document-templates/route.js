// src/app/api/document-templates/route.js — in-app editor for the 19
// auto-generated business document PDFs (quotes, debit/credit notes, LPOs,
// GRNs, leave forms, NDAs, etc). Lets an admin change each document's
// title, footer note, terms & conditions text, and signatory labels
// without touching code — generateBusinessDoc() in src/lib/pdf.js reads
// these overrides on every PDF it generates.

import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run } from '../../../lib/db';
import { DOC_TYPES } from '../../../lib/pdf';

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  try {
    const overrides = await query('SELECT * FROM document_templates');
    const byType = Object.fromEntries(overrides.map(o => [o.doc_type, o]));

    // Merge the built-in default config (from pdf.js) with any saved
    // override, so the editor always shows every document type — even
    // ones nobody has customised yet — with its current effective values.
    const list = Object.entries(DOC_TYPES).map(([key, base]) => {
      const o = byType[key];
      return {
        doc_type: key,
        default_title: base.title,
        title: o?.title || base.title,
        default_sign_labels: base.sign,
        sign_labels: o?.sign_labels ? JSON.parse(o.sign_labels) : base.sign,
        footer_note: o?.footer_note || '',
        terms_text: o?.terms_text || '',
        is_active: o ? !!o.is_active : true,
        is_customised: !!o,
        updated_at: o?.updated_at || null,
        table: base.table,
        folder: base.folder,
      };
    });
    return ok(list);
  } catch (e) {
    console.error('[DocumentTemplates GET]', e);
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
      // Upserts the override row for one document type. Any field left
      // blank/empty falls back to the built-in default at render time
      // (generateBusinessDoc only applies non-empty overrides).
      case 'save_template': {
        const { doc_type, title, footer_note, terms_text, sign_labels } = body;
        if (!doc_type || !DOC_TYPES[doc_type]) return err('Unknown doc_type', 400);

        const existing = await queryOne('SELECT doc_type FROM document_templates WHERE doc_type=?', [doc_type]);
        const signJson = Array.isArray(sign_labels) ? JSON.stringify(sign_labels) : null;

        if (existing) {
          await run(
            `UPDATE document_templates SET title=?, footer_note=?, terms_text=?, sign_labels=?, updated_by=?, updated_at=datetime('now') WHERE doc_type=?`,
            [title || null, footer_note || null, terms_text || null, signJson, auth.user.employee_id, doc_type]
          );
        } else {
          await run(
            `INSERT INTO document_templates (doc_type,title,footer_note,terms_text,sign_labels,updated_by) VALUES (?,?,?,?,?,?)`,
            [doc_type, title || null, footer_note || null, terms_text || null, signJson, auth.user.employee_id]
          );
        }
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SAVE_DOCUMENT_TEMPLATE', module: 'DocumentTemplates', recordId: doc_type, newValue: { title, footer_note, terms_text, sign_labels } });
        return ok({ saved: true });
      }

      // Removes the override entirely — the document type reverts to its
      // built-in default (it doesn't delete a "blank" template, since the
      // built-in defaults are code-defined, not stored rows).
      case 'reset_template': {
        const { doc_type } = body;
        if (!doc_type) return err('doc_type required', 400);
        await run('DELETE FROM document_templates WHERE doc_type=?', [doc_type]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'RESET_DOCUMENT_TEMPLATE', module: 'DocumentTemplates', recordId: doc_type });
        return ok({ reset: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[DocumentTemplates POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
