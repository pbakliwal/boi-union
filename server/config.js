'use strict';

const path = require('path');

// Load .env from the repo root regardless of the current working directory.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const isProd = process.env.NODE_ENV === 'production';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. See .env.example`);
  }
  return value;
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required('DATABASE_URL'),
  // Managed Postgres (Supabase, RDS, etc.) requires TLS; a local/VPS Postgres
  // usually doesn't have a cert configured at all. This has to be an explicit
  // opt-in per environment rather than inferred from NODE_ENV, since a
  // self-hosted production Postgres (e.g. the VPS setup) has no TLS either.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  sessionSecret: isProd ? required('SESSION_SECRET') : (process.env.SESSION_SECRET || 'dev-insecure-secret'),
  admin: {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },
};
