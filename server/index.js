'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const PgSession = require('connect-pg-simple')(session);

const config = require('./config');
const { pool } = require('./db');
const { HttpError } = require('./routes/helpers');

const app = express();

if (config.isProd) {
  app.set('trust proxy', 1); // behind a reverse proxy (nginx) terminating TLS
}

// Security headers. CSP is disabled here because the production bundle is a
// hashed Vite build served from the same origin; tighten later if desired.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '25mb' })); // CSV/Excel uploads are posted as JSON text/base64

app.use(
  session({
    store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    name: 'boi.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// --- API routes ---
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/ingest', require('./routes/ingest'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/districts', require('./routes/districts'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/rates', require('./routes/rates'));
app.use('/api/members', require('./routes/members'));
app.use('/api/periods', require('./routes/periods'));
app.use('/api/contributions', require('./routes/contributions'));
app.use('/api/reports', require('./routes/reports'));

// --- Static client (production) ---
// In dev the client is served by Vite (port 5173) which proxies /api here.
if (config.isProd) {
  const dist = path.resolve(__dirname, '..', 'client', 'dist');
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// --- 404 + error handler ---
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Errors that carry an explicit client-error status (e.g. from ingest parsing)
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  // Postgres unique-violation -> friendly 409
  if (err && err.code === '23505') {
    return res.status(409).json({ error: 'That value already exists (duplicate).' });
  }
  if (err && err.code === '23503') {
    return res.status(409).json({ error: 'Referenced record is in use or does not exist.' });
  }
  // Invalid text -> type cast (e.g. a non-numeric id in the URL)
  if (err && err.code === '22P02') {
    return res.status(400).json({ error: 'Invalid identifier.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`BOI Union API listening on http://localhost:${config.port}`);
});
