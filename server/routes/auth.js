'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { asyncHandler, requireFields } = require('./helpers');
const { requireAuth } = require('../auth');

const router = express.Router();

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['username', 'password']);
    const { username, password } = req.body;

    const result = await db.query(
      'select id, username, password_hash, role from users where username = $1',
      [username]
    );
    const user = result.rows[0];

    // Always run a compare to avoid leaking whether the user exists via timing.
    const hash = user ? user.password_hash : '$2a$12$0000000000000000000000000000000000000000000000000000';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Session error' });
      req.session.user = { id: user.id, username: user.username, role: user.role };
      res.json({ username: user.username, role: user.role });
    });
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('boi.sid');
    res.json({ ok: true });
  });
});

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(req.session.user);
  })
);

module.exports = router;
