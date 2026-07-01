// src/app/uploads/[...path]/route.js — serves every generated/uploaded
// file (PDFs, Excel reports, certificates, GRN/job photos, SOPs, branding
// logo) directly through Next.js.
//
// WHY THIS EXISTS: every PDF/Excel generator in src/lib/pdf.js and
// src/lib/excel.js writes a file to UPLOAD_DIR and returns a URL like
// "/uploads/reports/aged_debtors_2026-06-30.pdf". That URL was only ever
// reachable through the nginx container defined in docker-compose.yml
// (see docker/nginx.conf's `location /uploads/`) — Next.js itself does
// NOT serve an arbitrary runtime-written directory; it only auto-serves
// the build-time `/public` folder. Any deployment that runs `next start`
// directly (a plain Render/Railway/Fly web service, for example, without
// the nginx sidecar) had every `/uploads/...` link silently 404 — the
// generation always worked (verified repeatedly with real files), the
// browser just had nowhere to actually fetch them from.
//
// This route closes that gap for every deployment topology, with zero
// changes needed anywhere else — every existing `/uploads/...` URL
// returned by every generator function now resolves correctly.

import fs from 'fs';
import path from 'path';
import { verifyToken } from '../../../lib/auth';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

const CONTENT_TYPES = {
  '.pdf':  'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
  '.csv':  'text/csv',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export async function GET(req, { params }) {
  // Require a valid signed-in session before serving any uploaded
  // document — these are calibration certificates, payslips, GRN photos,
  // signed quotes, etc, not public content. A normal Authorization header
  // works for fetch()-based calls; for places the browser issues the
  // request itself (an <img src>, or window.open on a plain link) there's
  // no way to attach a header, so a `?token=` query parameter carrying the
  // same JWT is accepted as a fallback — every frontend call site appends
  // it automatically (see DocPdfButton and the few direct-link usages).
  const { searchParams } = new URL(req.url);
  const authHeader = req.headers.get('authorization');
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = headerToken || searchParams.get('token');
  const payload = token && verifyToken(token);
  if (!payload) {
    return new Response('Unauthorized — sign in to view this file', { status: 401 });
  }

  const segments = params.path || [];

  // Reject any attempt to escape UPLOAD_DIR via .. segments before doing
  // any filesystem work — path.join below would otherwise happily resolve
  // a crafted "../../../etc/passwd"-style request.
  if (segments.some(s => s === '..' || s.includes('\0'))) {
    return new Response('Invalid path', { status: 400 });
  }

  const filePath = path.join(UPLOAD_DIR, ...segments);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) {
    return new Response('Invalid path', { status: 400 });
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return new Response('Not found', { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
  const buffer = fs.readFileSync(resolved);

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // inline (not attachment) so PDFs/images open and preview directly
      // in a new tab rather than forcing a download dialog — matches the
      // behaviour every DocPdfButton click already expects.
      'Content-Disposition': `inline; filename="${path.basename(resolved)}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
