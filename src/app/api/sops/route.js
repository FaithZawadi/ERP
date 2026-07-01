// src/app/api/sops/route.js — Departmental SOP Library API
// Stores SOPs per department with full revision history. Each SOP keeps a
// current pointer (sop_documents) plus every uploaded revision
// (sop_document_versions), so earlier versions remain downloadable even
// after a new revision supersedes them. Files are sent as base64 data URLs
// in the JSON body (same convention already used for the branding logo
// upload), then written to /uploads/sops on disk.

import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import { requireAuth, ok, err, logAudit } from '../../../lib/auth';
import { query, queryOne, run, transaction } from '../../../lib/db';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const SOP_DIR = path.join(UPLOAD_DIR, 'sops');

function saveSopFile(fileName, dataUrl) {
  if (!dataUrl) return null;
  if (!fs.existsSync(SOP_DIR)) fs.mkdirSync(SOP_DIR, { recursive: true });
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  const ext = path.extname(fileName || '') || '.pdf';
  const stored = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.writeFileSync(path.join(SOP_DIR, stored), buffer);
  return `/uploads/sops/${stored}`;
}

export async function GET(req) {
  const auth = await requireAuth(req);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const section = searchParams.get('section') || 'list';

  try {
    switch (section) {
      case 'list': {
        const department = searchParams.get('department');
        let sql = `SELECT s.*, e.first_name||' '||e.last_name as reviewed_by_name
                   FROM sop_documents s LEFT JOIN employees e ON s.reviewed_by=e.id`;
        const params = [];
        if (department) { sql += ` WHERE s.department=?`; params.push(department); }
        sql += ` ORDER BY s.department, s.code`;
        return ok(await query(sql, params));
      }

      case 'versions': {
        const sop_id = searchParams.get('sop_id');
        if (!sop_id) return err('sop_id required', 400);
        const rows = await query(
          `SELECT v.*, e.first_name||' '||e.last_name as uploaded_by_name
           FROM sop_document_versions v LEFT JOIN employees e ON v.uploaded_by=e.id
           WHERE v.sop_id=? ORDER BY v.version_no DESC`, [sop_id]);
        return ok(rows);
      }

      default:
        return err('Unknown section', 400);
    }
  } catch (e) {
    console.error('[SOPs GET]', e);
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
      case 'create_sop': {
        const { code, title, department, category, next_review_date, file_name, file_data } = body;
        if (!code || !title || !department) return err('code, title and department required', 400);
        const existing = await queryOne(`SELECT id FROM sop_documents WHERE code=?`, [code]);
        if (existing) return err('An SOP with this code already exists', 409);

        const fileUrl = saveSopFile(file_name, file_data);
        const id = uuid();
        await transaction(async ({ run: dbRun }) => {
          await dbRun(
            `INSERT INTO sop_documents (id,code,title,department,category,current_version,file_url,reviewed_by,reviewed_at,next_review_date,created_by)
             VALUES (?,?,?,?,?,1,?,?,datetime('now'),?,?)`,
            [id, code, title, department, category || null, fileUrl, auth.user.employee_id, next_review_date || null, auth.user.employee_id]
          );
          await dbRun(
            `INSERT INTO sop_document_versions (id,sop_id,version_no,file_url,change_notes,uploaded_by,is_current) VALUES (?,?,1,?,?,?,1)`,
            [uuid(), id, fileUrl, 'Initial version', auth.user.employee_id]
          );
        });
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'CREATE_SOP', module: 'SOPs', recordId: id, newValue: { code, title } });
        return ok({ id, code, version: 1 }, 201);
      }

      case 'new_revision': {
        const { sop_id, change_notes, next_review_date, file_name, file_data } = body;
        if (!sop_id) return err('sop_id required', 400);
        const sop = await queryOne(`SELECT * FROM sop_documents WHERE id=?`, [sop_id]);
        if (!sop) return err('SOP not found', 404);
        const newVersion = (sop.current_version || 1) + 1;
        const fileUrl = saveSopFile(file_name, file_data) || sop.file_url;

        await transaction(async ({ run: dbRun }) => {
          await dbRun(`UPDATE sop_document_versions SET is_current=0 WHERE sop_id=?`, [sop_id]);
          await dbRun(
            `INSERT INTO sop_document_versions (id,sop_id,version_no,file_url,change_notes,uploaded_by,is_current) VALUES (?,?,?,?,?,?,1)`,
            [uuid(), sop_id, newVersion, fileUrl, change_notes || `Revision ${newVersion}`, auth.user.employee_id]
          );
          await dbRun(
            `UPDATE sop_documents SET current_version=?, file_url=?, reviewed_by=?, reviewed_at=datetime('now'), next_review_date=? WHERE id=?`,
            [newVersion, fileUrl, auth.user.employee_id, next_review_date || sop.next_review_date, sop_id]
          );
        });
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'SOP_NEW_REVISION', module: 'SOPs', recordId: sop_id, newValue: { version: newVersion } });
        return ok({ sop_id, version: newVersion }, 201);
      }

      case 'withdraw_sop': {
        const { sop_id } = body;
        if (!sop_id) return err('sop_id required', 400);
        await run(`UPDATE sop_documents SET status='withdrawn' WHERE id=?`, [sop_id]);
        await logAudit(query, { userId: auth.user.id, userName: auth.user.name, action: 'WITHDRAW_SOP', module: 'SOPs', recordId: sop_id });
        return ok({ withdrawn: true });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error('[SOPs POST]', e);
    return err('Server error: ' + e.message, 500);
  }
}
