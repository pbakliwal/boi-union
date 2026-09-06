'use strict';

// Minimal forward-only migration runner. Applies every *.sql file in
// ./migrations (in filename order) that has not been applied yet, tracking
// applied files in the _migrations table. Run with: npm run migrate

const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  await pool.query(`
    create table if not exists _migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await pool.query('select filename from _migrations')).rows.map((r) => r.filename)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Applying ${file} ...`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('insert into _migrations (filename) values ($1)', [file]);
      await client.query('COMMIT');
      count += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed on ${file}:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? 'Already up to date.' : `Applied ${count} migration(s).`);
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
