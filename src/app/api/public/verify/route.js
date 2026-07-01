// src/app/api/public/verify/route.js — Public certificate verification.
//
// Unauthenticated, same family as /api/public/contact and /api/public/shop.
// This is what makes the "scan to verify" QR code on every calibration
// certificate (see src/lib/pdf.js generateCalibrationCert) actually go
// somewhere — previously the QR only encoded a text summary readable by a
// generic scanner app, with no public page behind it at all.
//
// GET ?cert_no=QSL/.../2026/0001
//
// Deliberately returns a narrow, verification-only field set — not the
// full internal certificate record. A scanner should be able to confirm
// "yes, this certificate is real, here's the result and validity," not
// pull every internal detail (uncertainty values, reference standard IDs,
// signatures) off a record anyone with the cert number can query.

import { ok, err } from '../../../../lib/auth';
import { queryOne } from '../../../../lib/db';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const certNo = searchParams.get('cert_no');
  if (!certNo) return err('cert_no required', 400);

  try {
    const cert = await queryOne(
      `SELECT c.cert_no, c.instrument, c.make, c.model, c.calibrated_at, c.next_cal_date, c.result,
              c.checked_at, t.first_name as tech_first, t.last_name as tech_last,
              k.first_name as checker_first, k.last_name as checker_last
       FROM calibration_certs c
       LEFT JOIN employees t ON t.id = c.technician_id
       LEFT JOIN employees k ON k.id = c.checked_by
       WHERE c.cert_no = ?`,
      [certNo]
    );

    if (!cert) {
      return ok({ found: false });
    }

    const today = new Date().toISOString().slice(0, 10);
    const isExpired = cert.next_cal_date && cert.next_cal_date < today;
    const isChecked = !!cert.checked_at;

    return ok({
      found: true,
      cert_no: cert.cert_no,
      instrument: cert.instrument,
      make: cert.make,
      model: cert.model,
      calibrated_at: cert.calibrated_at,
      next_cal_date: cert.next_cal_date,
      result: cert.result,
      status: isExpired ? 'expired' : 'valid',
      technician: cert.tech_first ? `${cert.tech_first} ${cert.tech_last}` : null,
      checked_by: isChecked && cert.checker_first ? `${cert.checker_first} ${cert.checker_last}` : null,
      countersigned: isChecked,
    });
  } catch (e) {
    console.error('Public verify error:', e);
    return err('Something went wrong looking up that certificate', 500);
  }
}
