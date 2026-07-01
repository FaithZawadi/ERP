// database/migrate-v13.js — Closes the two biggest gaps in the revenue
// chain: calibration jobs had no connection to billing at all, and there
// was no way to manually record a client payment (bank transfer, cheque)
// against an invoice — only an automated M-Pesa callback could ever mark
// an invoice paid. See src/lib/invoicing.js, the new generate_job_invoice
// action in /api/calibration, and the new record_payment action in
// /api/tax for the actual logic this schema supports.
//
// Run: node database/migrate-v13.js — idempotent, safe to re-run.

async function migrate() {
  const db = require('../src/lib/db.js');
  const { query, queryOne, run } = db;
  console.log(`Running migration v13 (backend: ${db.USE_POSTGRES ? 'PostgreSQL' : 'sql.js'})...`);

  const addColumnIfMissing = async (table, columnDef) => {
    try {
      await run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
      console.log(`  ${table}.${columnDef.split(' ')[0]} added`);
    } catch (e) {
      console.log(`  ${table}.${columnDef.split(' ')[0]} already exists, skipping`);
    }
  };

  // ── 1. Calibration jobs — link to the quote that priced them, and to
  //       the invoice that eventually bills them ─────────────────────────
  console.log('Adding billing columns to calibration_jobs...');
  await addColumnIfMissing('calibration_jobs', 'quote_id TEXT REFERENCES quotes(id)');
  await addColumnIfMissing('calibration_jobs', 'invoice_id TEXT REFERENCES tax_invoices(id)');
  await addColumnIfMissing('calibration_jobs', "billing_status TEXT DEFAULT 'unbilled'");

  // ── 2. Invoices — real payment tracking, not a single overloaded
  //       status column that only two places in the codebase ever set ────
  console.log('Adding payment-tracking columns to tax_invoices...');
  await addColumnIfMissing('tax_invoices', "payment_status TEXT DEFAULT 'unpaid'");
  await addColumnIfMissing('tax_invoices', 'amount_paid REAL DEFAULT 0');

  // Backfill: any invoice already sitting at status='paid' under the old
  // overloaded-status scheme (M-Pesa callback, shop order fulfilment)
  // should read as fully paid under the new payment_status/amount_paid
  // fields too, so existing paid invoices don't regress to "unpaid".
  console.log('Backfilling payment_status for already-paid invoices...');
  const alreadyPaid = await query(`SELECT id, total FROM tax_invoices WHERE status='paid' AND COALESCE(amount_paid,0) = 0`);
  for (const inv of alreadyPaid) {
    await run(`UPDATE tax_invoices SET payment_status='paid', amount_paid=? WHERE id=?`, [inv.total, inv.id]);
  }
  console.log(`  ${alreadyPaid.length} already-paid invoice(s) backfilled`);

  // ── 3. Payment ledger — every payment against an invoice, whoever
  //       recorded it and however it arrived (bank transfer, cheque,
  //       cash, or the automated M-Pesa/shop paths) ──────────────────────
  console.log('Creating invoice_payments...');
  await run(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id           TEXT PRIMARY KEY,
      invoice_id   TEXT REFERENCES tax_invoices(id),
      amount       REAL NOT NULL,
      method       TEXT NOT NULL,
      reference    TEXT,
      date         TEXT NOT NULL,
      recorded_by  TEXT REFERENCES employees(id),
      notes        TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log('invoice_payments ready');

  console.log('');
  console.log('=== MIGRATION v13 COMPLETE ===');
}

migrate().catch(function(e) { console.error('MIGRATION FAILED:', e); process.exit(1); });
