// src/lib/db.postgres.js — PostgreSQL client (production)
// To use: rename this file to db.js (replacing the sql.js version)
// Requires: npm install pg
//           DATABASE_URL set in .env.local

const { Pool } = require('pg');

let _pool = null;

function getPool() {
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    max:            20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  _pool.on('error', (err) => console.error('[DB Pool error]', err));
  return _pool;
}

/**
 * Execute a SELECT and return all rows.
 */
async function query(sql, params = []) {
  const pool   = getPool();
  // Convert ? placeholders (SQLite) to $1,$2,... (PostgreSQL)
  const pgSql  = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return result.rows;
}

/**
 * Execute a SELECT and return the first row or null.
 */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * Execute an INSERT / UPDATE / DELETE.
 */
async function run(sql, params = []) {
  const pool  = getPool();
  const pgSql = convertPlaceholders(sql);
  await pool.query(pgSql, params);
  return { success: true };
}

/**
 * Execute multiple statements in a transaction.
 */
async function transaction(fn) {
  const pool   = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      query:    (sql, p) => client.query(convertPlaceholders(sql), p).then(r => r.rows),
      queryOne: (sql, p) => client.query(convertPlaceholders(sql), p).then(r => r.rows[0] || null),
      run:      (sql, p) => client.query(convertPlaceholders(sql), p).then(() => ({ success: true })),
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Paginate results.
 */
async function paginate(sql, params = [], { page = 1, limit = 50 } = {}) {
  const offset   = (page - 1) * limit;
  const countSql = `SELECT COUNT(*) as total FROM (${sql}) AS _count_query`;
  const totalRow = await queryOne(countSql, params);
  const total    = parseInt(totalRow?.total || 0);
  const rows     = await query(`${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
  return {
    data: rows,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Convert SQLite ? placeholders to PostgreSQL $1, $2, ...
 */
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * No-op for PostgreSQL (no file to persist).
 */
function persistDB() {}

module.exports = { query, queryOne, run, transaction, paginate, persistDB };
