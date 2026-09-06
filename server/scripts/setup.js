'use strict';

// One-time bootstrap: create the initial admin account and seed the two
// contribution categories seen in the legacy system. Safe to re-run — it
// only inserts what is missing. Run AFTER `npm run migrate`.
//
//   ADMIN_USER / ADMIN_PASSWORD come from .env

const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const config = require('../config');

async function run() {
  const { username, password } = config.admin;

  if (!password || password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be set in .env and be at least 8 characters.');
  }

  const existing = await pool.query('select id from users where username = $1', [username]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'insert into users (username, password_hash, role) values ($1, $2, $3)',
      [username, hash, 'admin']
    );
    console.log(`Created admin user "${username}".`);
  } else {
    console.log(`Admin user "${username}" already exists — leaving it unchanged.`);
  }

  // Seed placeholder categories (codes 2 and 3 as seen in the old app).
  // Rename them and set their rates from the admin UI.
  const cat = await pool.query('select count(*)::int as n from categories');
  if (cat.rows[0].n === 0) {
    await pool.query(
      `insert into categories (code, name) values ('2', 'Category 2'), ('3', 'Category 3')`
    );
    console.log('Seeded placeholder categories 2 and 3 (rename + set rates in the app).');
  }

  console.log('Setup complete.');
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    pool.end().finally(() => process.exit(1));
  });
