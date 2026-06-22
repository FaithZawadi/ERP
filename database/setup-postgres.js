// database/setup-postgres.js — Apply the generated schema to a real Postgres DB
//
// Run: node database/setup-postgres.js
// Requires: DATABASE_URL env var pointing to PostgreSQL
//
// This replaces the old migrate-postgres.js, which hard-coded 21 tables
// from an early point in development and was never updated as the schema
// grew to 80 tables — a real, confirmed drift that would have silently
// produced an incomplete Postgres database (missing the entire Stores,
// Requisitions, RBAC, and Companies work, among others).
//
// This script instead applies database/pg-schema.sql, which is itself
// generated directly from the live SQLite database by
// database/generate-pg-schema.js — so re-running that generator after any
// future schema change keeps this script correct without manual upkeep.
//
// NOT TESTED against a real running PostgreSQL instance — the environment
// this was written in has no network access to install or run Postgres
// (confirmed: apt-get install postgresql fails against the package
// mirror). The SQL itself was verified by translating every actual query
// string in the codebase and checking the output is valid syntax, but
// running this script end-to-end against a live Postgres server has not
// been done. Test against the docker-compose Postgres container (or any
// real Postgres instance) before trusting this with real data.

require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set. Set it in .env.local, e.g.:');
  console.error('   DATABASE_URL=postgresql://qsl_user:qsl_pass_2026@localhost:5432/qsl_erp');
  process.exit(1);
}

async function main() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL });

  const schemaPath = path.join(__dirname, 'pg-schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ ${schemaPath} not found. Generate it first with: node database/generate-pg-schema.js`);
    process.exit(1);
  }
  const schema = fs.readFileSync(schemaPath, 'utf8');

  console.log('Connecting to PostgreSQL...');
  const client = await pool.connect();
  try {
    console.log('Applying schema (this creates tables IF NOT EXISTS — safe to re-run)...');
    await client.query(schema);
    console.log('✅ Schema applied successfully.');

    const tableCount = await client.query(
      `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema='public'`
    );
    console.log(`   ${tableCount.rows[0].count} tables now present in the database.`);
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\nNext steps:');
  console.log('  1. Run database/seed.js and database/seed-coa.js against this same DATABASE_URL to load demo data');
  console.log('     (these currently write via the sql.js-style query()/run() API in src/lib/db.js, which');
  console.log('      automatically targets Postgres once DATABASE_URL is set — no separate Postgres-specific');
  console.log('      seed scripts were needed, since the migration kept that interface identical)');
  console.log('  2. Run database/migrate-v3.js the same way to seed RBAC, module flags, companies, etc.');
  console.log('  3. Start the app with DATABASE_URL set and confirm it boots against Postgres instead of sql.js.');
}

main().catch(e => {
  console.error('❌ Failed:', e.message);
  process.exit(1);
});
