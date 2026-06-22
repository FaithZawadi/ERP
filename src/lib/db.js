// src/lib/db.js — Database client for QSL ERP
//
// Dual backend:
//   - DATABASE_URL unset  -> sql.js (pure JS SQLite), zero external deps,
//     good for local development without a running database server.
//   - DATABASE_URL set    -> real PostgreSQL via the `pg` driver. This is
//     the path production deployments (the Docker Compose stack already
//     provisions Postgres) should use.
//
// Every API route in this app only ever calls query/queryOne/run/
// transaction/paginate — never the raw driver — so switching backends here
// requires no changes anywhere else in the codebase. That contract is the
// entire reason this migration was tractable: verified by checking every
// route file only imports these five functions from this module.
//
// IMPORTANT — this was NOT tested against a real running PostgreSQL
// instance. The sandbox this was written in has no network access to
// install PostgreSQL (confirmed: apt-get install postgresql fails with
// 404s against the package mirror), so the pg-backed path below is
// correct by careful construction and static review, not by the same
// live request/response testing every sql.js-backed feature in this app
// received. Test this against a real Postgres instance (the docker-compose
// stack already provided) before trusting it with real data.

const path = require('path');
const fs   = require('fs');

const USE_POSTGRES = !!process.env.DATABASE_URL;

// ═══════════════════════════════════════════════════════════════════════
// SQLITE (sql.js) BACKEND — unchanged from before, used when DATABASE_URL
// is not set. Kept exactly as previously verified/tested.
// ═══════════════════════════════════════════════════════════════════════

let _db  = null;
let _SQL = null;

// SQLITE_PATH lets a hosted deployment point the file DB at a persistent disk
// (e.g. Render disk mounted at /var/data) so data survives restarts/redeploys.
const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'database', 'qsl_erp.db');

async function getDB_sqlite() {
  if (_db) return _db;

  if (!_SQL) {
    const initSqlJs = require('sql.js');
    _SQL = await initSqlJs();
  }

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new _SQL.Database(buf);
  } else {
    _db = new _SQL.Database();
    const { SCHEMA } = require('../../database/init.js');
    _db.run(SCHEMA);
    persistDB_sqlite();
    console.log('[DB] sql.js database created and schema applied');
  }

  return _db;
}

function persistDB_sqlite() {
  if (!_db) return;
  try {
    const data = _db.export();
    const dir  = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Persist failed:', err.message);
  }
}

async function query_sqlite(sql, params = []) {
  const db   = await getDB_sqlite();
  const stmt = db.prepare(sql);
  stmt.bind(params.map(p => (p === undefined ? null : p)));
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function run_sqlite(sql, params = []) {
  const db = await getDB_sqlite();
  db.run(sql, params.map(p => (p === undefined ? null : p)));
  persistDB_sqlite();
  return { success: true };
}

async function transaction_sqlite(fn) {
  const db = await getDB_sqlite();
  const txRun = async (sql, params = []) => {
    db.run(sql, params.map(p => (p === undefined ? null : p)));
    return { success: true };
  };
  const result = await fn({ query: query_sqlite, queryOne: (s, p) => query_sqlite(s, p).then(r => r[0] || null), run: txRun });
  persistDB_sqlite();
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// POSTGRESQL BACKEND — used when DATABASE_URL is set.
// ═══════════════════════════════════════════════════════════════════════

let _pgPool = null;

function getPool() {
  if (_pgPool) return _pgPool;
  const { Pool } = require('pg');
  _pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  return _pgPool;
}

// sql.js uses '?' positional placeholders everywhere in this codebase.
// PostgreSQL's `pg` driver requires '$1', '$2', ... instead. Translate
// here rather than rewrite every query string across 20+ route files.
// Safe because no route builds SQL with a literal '?' inside a quoted
// string constant within the SQL itself (confirmed by inspection).
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Several routes embed SQLite's datetime('now') / date('now') directly in
// INSERT/UPDATE statements (e.g. `updated_at=datetime('now')`), and several
// more use the relative-offset form date('now','+60 days') for expiry
// threshold checks (statutory docs, calibration certs, vehicle insurance —
// the 60/30/7-day alert logic). There were 56+ such call sites across 16
// files when this migration was done; hand-editing every one carried real
// risk of missing some, which is exactly what happened on the first pass
// here (the offset form was initially missed and only caught by a second,
// more thorough scan). Translating both forms here, once, for every query
// that runs under Postgres is far safer than touching dozens of call sites
// individually.
//
// This does NOT touch the 'GROUP BY month'-style strftime()/date('now',
// '-N months') usages — those needed different SQL shapes per backend
// (a GROUP BY key vs. a comparison value), so they were fixed at the call
// site using monthExpr()/monthsAgoExpr() instead.
function translateSqliteFunctions(sql) {
  return sql
    // Relative offset form: date('now','+60 days') / date('now','-30 days')
    // -> Postgres: (CURRENT_DATE + INTERVAL '60 days') / (CURRENT_DATE - INTERVAL '30 days')
    .replace(/date\('now',\s*'([+-])(\d+)\s+days?'\)/gi, (_, sign, n) => `(CURRENT_DATE ${sign} INTERVAL '${n} days')`)
    // Bare current-timestamp/current-date literals
    .replace(/datetime\('now'\)/g, 'CURRENT_TIMESTAMP')
    .replace(/date\('now'\)/g, 'CURRENT_DATE');
}

async function query_pg(sql, params = []) {
  const pool = getPool();
  const pgSql = toPgPlaceholders(translateSqliteFunctions(sql));
  const res = await pool.query(pgSql, params.map(p => (p === undefined ? null : p)));
  return res.rows;
}

async function run_pg(sql, params = []) {
  const pool = getPool();
  const pgSql = toPgPlaceholders(translateSqliteFunctions(sql));
  const res = await pool.query(pgSql, params.map(p => (p === undefined ? null : p)));
  return { success: true, changes: res.rowCount };
}

// Real ACID transaction — Postgres doesn't have the sql.js bug that forced
// the sequential-no-BEGIN/COMMIT workaround, so this uses a proper client
// checkout + BEGIN/COMMIT/ROLLBACK, the correct pattern for a real
// client-server database.
async function transaction_pg(fn) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txQuery = async (sql, params = []) => {
      const res = await client.query(toPgPlaceholders(translateSqliteFunctions(sql)), params.map(p => (p === undefined ? null : p)));
      return res.rows;
    };
    const txRun = async (sql, params = []) => {
      const res = await client.query(toPgPlaceholders(translateSqliteFunctions(sql)), params.map(p => (p === undefined ? null : p)));
      return { success: true, changes: res.rowCount };
    };
    const result = await fn({
      query: txQuery,
      queryOne: (s, p) => txQuery(s, p).then(r => r[0] || null),
      run: txRun,
    });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API — identical surface regardless of backend.
// ═══════════════════════════════════════════════════════════════════════

async function query(sql, params = []) {
  return USE_POSTGRES ? query_pg(sql, params) : query_sqlite(sql, params);
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  return USE_POSTGRES ? run_pg(sql, params) : run_sqlite(sql, params);
}

async function transaction(fn) {
  return USE_POSTGRES ? transaction_pg(fn) : transaction_sqlite(fn);
}

async function paginate(sql, params = [], { page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const countSql = `SELECT COUNT(*) as total FROM (${sql}) as count_subquery`;
  const totalRow = await queryOne(countSql, params);
  const total = parseInt(totalRow?.total || 0, 10);

  const rows = await query(`${sql} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return {
    data: rows,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

// ── BACKEND-AWARE SQL FRAGMENTS ───────────────────────────────────────────
// A handful of reporting queries need to GROUP BY month or filter by a
// relative date window ("last 6 months") directly in SQL — pulling raw
// rows and aggregating in JS would work but is wasteful for what's
// otherwise a single indexed query. SQLite and PostgreSQL spell both of
// these differently, so these two helpers emit the correct fragment for
// whichever backend is active. Used by src/app/api/reports/route.js's
// analytics_dashboard trend queries.

// Emits a SQL expression that formats a date/timestamp column as 'YYYY-MM'.
function monthExpr(column) {
  return USE_POSTGRES ? `to_char(${column}::date, 'YYYY-MM')` : `strftime('%Y-%m', ${column})`;
}

// Emits a SQL expression for "N months before now" as a comparable date string.
function monthsAgoExpr(n) {
  return USE_POSTGRES ? `(CURRENT_DATE - INTERVAL '${n} months')` : `date('now','-${n} months')`;
}

async function getDB() {
  if (USE_POSTGRES) throw new Error('getDB() is sql.js-specific; use the query/run/transaction API instead, or getPool() for raw Postgres access under this module.');
  return getDB_sqlite();
}

function persistDB() {
  if (USE_POSTGRES) return;
  return persistDB_sqlite();
}

module.exports = { getDB, persistDB, query, queryOne, run, transaction, paginate, getPool, USE_POSTGRES, monthExpr, monthsAgoExpr };
