// src/lib/upload.js — File Upload Handler (Next.js native FormData)
// Handles: receipts, RAMS documents, policy PDFs, GRN photos, certificates
//
// Note: uses Next.js App Router's built-in request.formData() rather than
// multer, since all API routes here run on the Next.js Edge/Node runtime,
// not a standalone Express server. See parseFormData() below — that is the
// function every API route actually calls.

const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const MAX_SIZE   = parseInt(process.env.MAX_FILE_SIZE || '10485760'); // 10MB

// Ensure directories exist
const DIRS = ['receipts', 'rams', 'policies', 'grn_photos', 'certificates', 'contracts', 'invoices', 'id_documents', 'branding'];
DIRS.forEach(d => {
  const dir = path.join(UPLOAD_DIR, d);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── ALLOWED FILE TYPES ────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// ── FILE INFO HELPER ──────────────────────────────────────────────────────────

function getFileInfo(file) {
  if (!file) return null;
  return {
    original_name: file.originalname,
    stored_name:   file.filename,
    path:          file.path,
    relative_path: path.relative(UPLOAD_DIR, file.path),
    size:          file.size,
    mime_type:     file.mimetype,
    url:           `/uploads/${path.relative(UPLOAD_DIR, file.path).replace(/\\/g, '/')}`,
  };
}

// ── DELETE FILE ───────────────────────────────────────────────────────────────

function deleteFile(relativePath) {
  try {
    const full = path.join(UPLOAD_DIR, relativePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return true;
  } catch {
    return false;
  }
}

// ── NEXT.JS APP ROUTER HANDLER ────────────────────────────────────────────────
// Use this in API routes that need file uploads

async function parseFormData(req, options = {}) {
  const { category = 'receipts', multiple = false } = options;

  // For Next.js App Router — use built-in FormData
  try {
    const formData = await req.formData();
    const files    = formData.getAll('file');
    const fields   = {};

    for (const [key, val] of formData.entries()) {
      if (key !== 'file') fields[key] = val;
    }

    if (files.length === 0) return { fields, files: [], file: null };

    const savedFiles = [];
    for (const file of files) {
      if (!(file instanceof File)) continue;

      const ext      = path.extname(file.name).toLowerCase();
      const hash     = crypto.randomBytes(8).toString('hex');
      const filename = `${Date.now()}-${hash}${ext}`;
      const dir      = path.join(UPLOAD_DIR, DIRS.includes(category) ? category : 'receipts');
      const filepath = path.join(dir, filename);

      // Write file to disk
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filepath, buffer);

      savedFiles.push({
        original_name: file.name,
        stored_name:   filename,
        path:          filepath,
        relative_path: `${category}/${filename}`,
        size:          file.size,
        mime_type:     file.type,
        url:           `/uploads/${category}/${filename}`,
      });
    }

    return { fields, files: savedFiles, file: savedFiles[0] || null };
  } catch (err) {
    throw new Error(`File upload failed: ${err.message}`);
  }
}

module.exports = { getFileInfo, deleteFile, parseFormData, UPLOAD_DIR };
