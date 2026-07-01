# QSL ERP merge — Render deployment checklist

This covers the manual steps needed on Render after merging the B (qslerp)
feature set into A (ERP) — quotes/debit/credit notes, travel claims, SOP
library, NAWI calibration certs, CPD & monthly appraisals, and the new
DocPdfButton-driven document downloads across Finance/CRM/Procurement/
Stores/HR.

## A. Database migration (existing deployments only)

`database/init.js` already contains the full schema including all new
tables/columns, so **fresh deploys need no extra step** — `npm run db:init`
creates everything in one pass.

For the **existing live qsl-erp.onrender.com database**, run the migration
once against it before (or right after) deploying the new code:

```bash
npm run db:migrate-v4-v7
```

This runs `database/migrate-v4-through-v7-consolidated.js`, which applies
migrations v4–v7 in sequence in a single process:

- v4 — `quotes`, `quote_lines`, `debit_notes`, `credit_notes`, `travel_claims`, `travel_claim_lines`
- v5 — `sop_documents`, `sop_document_versions`
- v6 — NAWI test-data tables + `calibration_certs` columns (`instrument_type`, `temp_c_end`, `humidity_pct_end`, `min_weight`, `repeatability_stdev`, `checked_by`, `checked_sig`, `checked_at`)
- v7 — CPD/appraisal/job-inspection tables + `employees.cpd_points`/`cpd_target` + `cpd_logs.verification_url`, and seeds the 12 default CPD platform links

It is safe to re-run (every `CREATE TABLE` is `IF NOT EXISTS`, every
`ALTER TABLE ADD COLUMN` is caught/skipped if the column already exists, and
the CPD platform seed checks for an existing row by name before inserting).
Running the four individual scripts (`npm run db:migrate-v4` ... `db:migrate-v7`)
instead is equivalent.

Run this as a Render **one-off job** (or a temporary SSH/shell session)
against the same `SQLITE_PATH` the web service uses, so it's applied before
the new frontend/API code goes live and starts querying the new tables.

## B. Environment variables

No new environment variables are required. The new features reuse existing
config:

- Job-site photo uploads (`upload_job_photo`) and SOP document uploads both
  write under the existing `UPLOAD_DIR` (default `/app/data/uploads` per
  `render.yaml`), into new `job_photos/` and `sops/` subfolders that are
  created on demand the first time each endpoint is called.
- PDF generation (quotes, debit/credit notes, travel claims, NDA, contracts,
  onboarding packs, visit reports, lead capture forms, PR/LPO/GRN, stock
  take/transfer sheets, leave applications) all go through the existing
  `src/lib/pdf.js` output pipeline and existing `UPLOAD_DIR`/`SQLITE_PATH`
  wiring — nothing new to configure.

## C. Build / deploy commands

No `Dockerfile` or `render.yaml` changes are required:

- `public/docs/` (20 document templates + 7 calibration procedure PDFs) is
  committed to the repo and served as static files by Next.js automatically,
  the same way `public/templates/` already is.
- `public/templates/` is kept as-is for backward compatibility until all
  `DocPdfButton` endpoints are confirmed working in production, per the
  merge instructions.
- The existing `dockerCommand: npm start` in `render.yaml` is unchanged —
  just run the migration (step A) as a separate one-off step against the
  live DB before/alongside this deploy.

## D. Seed data

- The 12 default CPD platform links (Alison, LinkedIn Learning, Coursera,
  edX, Udemy, Saylor Academy, Google Digital Garage, FutureLearn, Khan
  Academy, NEBOSH/IOSH, KASNEB, EBK CPD Portal) are seeded automatically by
  the migration in step A — no manual data entry needed.
- No other new seed data is required; quotes/notes/claims/SOPs/appraisals
  are created through the app as users start using the new tabs.

## E. package.json

`qrcode` (used by the new QR-code header in `src/lib/pdf.js`) was **already
present** in A's `package.json` (`^1.5.0`) — no dependency addition is
needed. B pins a slightly newer patch (`^1.5.4`, vs. `pdfkit` `^0.15.2` vs
A's `^0.15.0`); both are semver-compatible with A's existing lockfile, so no
version bump is required to run this merge, and none was made.

Added four `npm run db:migrate-v*` scripts and one `npm run db:migrate-v4-v7`
script (for the consolidated migration) to `scripts`, mirroring what B
already had for the individual migrations.
