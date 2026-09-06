'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, requireFields } = require('./helpers');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('select id, code, name from zones order by name');
    res.json(rows);
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['code', 'name']);
    const { code, name } = req.body;
    const { rows } = await db.query(
      'insert into zones (code, name) values ($1, $2) returning id, code, name',
      [String(code).trim(), String(name).trim()]
    );
    res.status(201).json(rows[0]);
  })
);

router.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['code', 'name']);
    const { code, name } = req.body;
    const { rows } = await db.query(
      'update zones set code = $1, name = $2 where id = $3 returning id, code, name',
      [String(code).trim(), String(name).trim(), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await db.query('delete from zones where id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
