# QSL ERP — Qalibrated Systems Limited
## Enterprise Resource Planning System

**Version:** 1.0 | **Stack:** Next.js 14 + Node.js + SQLite → PostgreSQL | **Kenya Compliant**

---

## 🚀 Quick Start (Development)

```bash
# 1. Clone / unzip project
cd qsl-erp

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env.local
# Edit .env.local with your credentials

# 4. Initialise database
npm run db:init

# 5. Seed with QSL sample data
npm run db:seed

# 6. Start development server
npm run dev
```

Open **http://localhost:3000**

**Default login:** `hadar@qalibrated.co.ke` / `QSL@2026!`

---

## 🐳 Docker Deployment (Production)

```bash
# 1. Copy environment file
cp .env.example .env
# Edit .env with production credentials

# 2. Build and start all services
docker compose up -d

# Services started:
#   qsl-erp-app   → Next.js app on :3000
#   qsl-erp-db    → PostgreSQL on :5432
#   qsl-erp-nginx → Nginx on :80/:443
#   qsl-erp-redis → Redis on :6379

# 3. Check logs
docker compose logs -f app

# 4. Access at https://erp.qalibrated.co.ke (after DNS/SSL setup)
```

---

## 📁 Project Structure

```
qsl-erp/
├── src/
│   ├── app/
│   │   ├── api/                    # Next.js API Routes
│   │   │   ├── auth/route.js       # Login, JWT, digital signatures
│   │   │   ├── finance/route.js    # Imprest, payroll, GL
│   │   │   ├── tax/route.js        # KRA eTIMS, VAT, PAYE returns
│   │   │   ├── hr/route.js         # Employees, attendance, KPI
│   │   │   ├── projects/route.js   # Projects, expenses, milestones
│   │   │   ├── procurement/route.js # PRs, LPOs, GRN 2-stage
│   │   │   ├── crm/route.js        # Clients, leads, transfers
│   │   │   ├── assets/route.js     # Fixed assets, depreciation
│   │   │   ├── fleet/route.js      # Vehicles, trips, fuel
│   │   │   ├── calibration/route.js # ISO 17025 certs, standards
│   │   │   ├── bids/route.js       # Stage 2B gate enforcement
│   │   │   ├── compliance/route.js  # Certificates, calendar
│   │   │   ├── tasks/route.js      # Task management
│   │   │   ├── ic/route.js         # Inter-company (5%/3% min)
│   │   │   ├── reports/route.js    # All 15 standard reports
│   │   │   └── integrations/route.js # eTIMS, PPIP, M-PESA
│   │   ├── dashboard/page.js       # Main ERP UI (all modules)
│   │   ├── login/page.js           # Login page
│   │   └── layout.js
│   ├── lib/
│   │   ├── db.js                   # SQLite/PostgreSQL client
│   │   ├── auth.js                 # JWT + RSA-2048 digital signatures
│   │   ├── tax.js                  # PAYE, VAT, NHIF, NSSF, Housing Levy
│   │   └── integrations/
│   │       ├── kra-etims.js        # KRA eTIMS API
│   │       ├── mpesa.js            # Safaricom M-PESA Daraja
│   │       └── ppip.js             # PPIP Tender Portal
│   └── hooks/
│       └── useApi.js               # Authenticated API client hook
├── database/
│   ├── init.js                     # Schema (50+ tables, all 17 modules)
│   ├── seed.js                     # QSL sample data (8 staff, clients, projects)
│   └── qsl_erp.db                  # SQLite file (auto-created)
├── docker/
│   └── nginx.conf                  # Nginx reverse proxy config
├── Dockerfile                      # Multi-stage production build
├── docker-compose.yml              # Full stack: App + PostgreSQL + Nginx + Redis
├── next.config.js
└── .env.example                    # All environment variables documented
```

---

## 🔌 API Reference

All API endpoints require JWT Bearer token from `POST /api/auth` (action: login).

| Endpoint | Methods | Description |
|---|---|---|
| `/api/auth` | POST | Login, register, verify/revoke digital signatures |
| `/api/finance` | GET, POST, PUT | Imprest (14-day rule), payroll (3-sig), GL, journal entries |
| `/api/tax` | GET, POST | Tax invoices → KRA eTIMS, VAT returns, PAYE returns, statutory calendar |
| `/api/hr` | GET, POST | Employees, clock-in/out, leave, KPI scorecards, L&D |
| `/api/projects` | GET, POST | Portfolio, expenses (budget block), milestones, MD override, handover |
| `/api/procurement` | GET, POST | PRs (quota tiers), LPOs, GRN 2-stage, suppliers ASR |
| `/api/crm` | GET, POST | Clients, leads, interactions, ownership transfer (CFO+MD) |
| `/api/assets` | GET, POST | Asset register, depreciation (SL/RB), disposal (3 sigs) |
| `/api/fleet` | GET, POST | Vehicles, trip log, fuel, service scheduling |
| `/api/calibration` | GET, POST | ISO 17025 certs (auto-signed RSA), reference standards |
| `/api/bids` | GET, POST | Stage 2B gate (auto-stop on DOES NOT MEET), pipeline |
| `/api/ic` | GET, POST | IC transactions (5%/3% minimum enforced, ICSA required) |
| `/api/compliance` | GET, POST | Certificates, policy sign-offs, statutory calendar, tasks |
| `/api/reports` | GET | 15 standard reports (RPT-001 to RPT-015) |
| `/api/integrations` | GET, POST | KRA eTIMS, PPIP sync, M-PESA STK push, email |
| `/api/tasks` | GET, POST | Task CRUD, complete, filter |

### Example API call

```bash
# Login
curl -X POST http://localhost:3000/api/auth \
  -H "Content-Type: application/json" \
  -d '{"action":"login","email":"hadar@qalibrated.co.ke","password":"QSL@2026!"}'

# Create imprest (with JWT token)
curl -X POST http://localhost:3000/api/finance \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"create_imprest","employee_id":"E001","amount":15000,"purpose":"Site visit Mombasa"}'

# Submit invoice to KRA eTIMS
curl -X POST http://localhost:3000/api/tax \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"create_invoice","client_id":"CLT-001","date":"2026-06-16","submit_to_etims":true,"lines":[{"description":"Calibration Services","amount":50000,"vat_category":"A","quantity":1,"unit_price":50000}]}'
```

---

## 🏛️ Kenya Regulatory Compliance

### KRA eTIMS
Set in `.env.local`:
```
KRA_ETIMS_PIN=P000000001K
KRA_ETIMS_DEVICE_ID=<from KRA eTIMS portal>
KRA_ETIMS_KEY=<API key>
KRA_ETIMS_ENV=production
```
All tax invoices auto-submit to eTIMS. Purchase receipts sync stock to KRA.

### Tax Rates Built-in (Finance Act 2023)
- **PAYE:** 5-band progressive (10% → 35%), personal relief Kshs 2,400/month
- **NHIF/SHIF:** 2.75% of gross
- **NSSF:** 6% Tier I (≤7K) + 6% Tier II (≤36K), employer matches
- **Housing Levy:** 1.5% employee + 1.5% employer
- **VAT:** 16% standard (categories A/B/C/E for eTIMS)
- **WHT:** Professional 5%, Construction 3%, Rent 30%

### Statutory Filing Calendar (Auto-generated)
| Obligation | Due | Agency |
|---|---|---|
| PAYE | 9th of month | KRA |
| NHIF/SHIF | 9th of month | NHIF |
| NSSF | 15th of month | NSSF |
| VAT | 20th of month | KRA |
| Housing Levy | 9th of month | NHFC |
| Withholding Tax | 20th of month | KRA |

---

## 🔐 Security Architecture

- **Authentication:** JWT (8hr expiry), bcrypt password hashing (12 rounds)
- **Digital Signatures:** RSA-2048 per staff member, generated at registration
  - Private key encrypted server-side, never sent to browser
  - Applied on: payroll approval, budget overrides, client transfers, calibration certs
  - Revoked same day as employment separation (ARCH-007B / COMP-010)
- **RBAC:** Role-based access — MD, CFO, FM, HR Manager, Project Manager, Sales, Staff
- **Audit Trail:** Immutable — every create/update/delete/approval logged with user, timestamp, old/new values
- **Rate Limiting:** Nginx — 5 login attempts/min, 30 API requests/min per IP

---

## 🔄 Switching to PostgreSQL (Production)

1. Set `DATABASE_URL` in `.env.local`
2. Replace `sql.js` client in `src/lib/db.js` with `pg`:

```js
// src/lib/db.js — PostgreSQL version
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}
```

3. Run `node database/init.js` against PostgreSQL to create schema
4. Run `node database/seed.js` for initial data

---

## 👥 Default User Accounts (After Seed)

| Role | Email | Password |
|---|---|---|
| Managing Director | hadar@qalibrated.co.ke | QSL@2026! |
| Finance Manager | skamau@qalibrated.co.ke | QSL@2026! |
| Project Manager | jotieno@qalibrated.co.ke | QSL@2026! |
| HR Manager | gwanjiku@qalibrated.co.ke | QSL@2026! |
| Senior Engineer | dmwangi@qalibrated.co.ke | QSL@2026! |
| Sales Engineer | fnjeri@qalibrated.co.ke | QSL@2026! |
| ICT Head | pochieng@qalibrated.co.ke | QSL@2026! |
| Accountant | makinyi@qalibrated.co.ke | QSL@2026! |

**Change all passwords immediately after first login in production.**
