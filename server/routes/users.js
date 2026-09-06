'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { asyncHandler, requireFields, badRequest } = require('./helpers');
const { requireAdmin } = require('../auth');

const router = express.Router();

const ROLES = ['admin', 'viewer'];
const MIN_PASSWORD = 8;

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) {
    badRequest(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
}

function validateRole(role) {
  if (!ROLES.includes(role)) badRequest(`Role must be one of: ${ROLES.join(', ')}`);
}

async function adminCount() {
  const { rows } = await db.query(`select count(*)::int as n from users where role = 'admin'`);
  return rows[0].n;
}

// All routes here are admin-only.
router.use(requireAdmin);

// List users — never expose password hashes.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      'select id, username, role, created_at from users order by username'
    );
    res.json(rows);
  })
);

// Create a user.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['username', 'password', 'role']);
    const username = String(req.body.username).trim();
    validatePassword(req.body.password);
    validateRole(req.body.role);

    const hash = await bcrypt.hash(req.body.password, 12);
    const { rows } = await db.query(
      'insert into users (username, password_hash, role) values ($1, $2, $3) returning id, username, role, created_at',
      [username, hash, req.body.role]
    );
    res.status(201).json(rows[0]);
  })
);

// Update a user's role and/or reset the password. Blank password = unchanged.
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const target = (await db.query('select id, username, role from users where id = $1', [id])).rows[0];
    if (!target) return res.status(404).json({ error: 'Not found' });

    const nextRole = req.body.role !== undefined ? req.body.role : target.role;
    validateRole(nextRole);

    // Guard against demoting the last admin.
    if (target.role === 'admin' && nextRole !== 'admin' && (await adminCount()) <= 1) {
      badRequest('Cannot change the role of the last remaining admin.');
    }

    let hash = null;
    if (req.body.password) {
      validatePassword(req.body.password);
      hash = await bcrypt.hash(req.body.password, 12);
    }

    const { rows } = await db.query(
      `update users set
         role = $1,
         password_hash = coalesce($2, password_hash)
       where id = $3
       returning id, username, role, created_at`,
      [nextRole, hash, id]
    );
    res.json(rows[0]);
  })
);

// Delete a user — cannot delete yourself or the last admin.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.session.user.id) badRequest('You cannot delete your own account.');

    const target = (await db.query('select id, role from users where id = $1', [id])).rows[0];
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.role === 'admin' && (await adminCount()) <= 1) {
      badRequest('Cannot delete the last remaining admin.');
    }

    await db.query('delete from users where id = $1', [id]);
    res.json({ ok: true });
  })
);

module.exports = router;
