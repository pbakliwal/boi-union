'use strict';

const { Pool, types } = require('pg');
const config = require('./config');

// Return DATE (oid 1082) as a plain 'YYYY-MM-DD' string instead of a JS Date,
// so values round-trip through <input type="date"> without timezone shifts.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

function query(text, params) {
  return pool.query(text, params);
}

// Run a set of statements inside a single transaction. The callback receives a
// dedicated client; it is committed on success and rolled back on any error.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
