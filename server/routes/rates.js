'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, requireFields, toInt, toNumber } = require('./helpers');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

const SELECT = `
  select r.id, r.category_id, r.amount, r.effective_from, c.code as category_code, c.name as category_name
  from rates r
  join categories c on c.id = r.category_id
`;

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.category_id) {
      params.push(toInt(req.query.category_id, 'category_id'));
      where = 'where r.category_id = $1';
    }
    const { rows } = await db.query(
      `${SELECT} ${where} order by c.code, r.effective_from desc`,
      params
    );
    res.json(rows);
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['category_id', 'amount', 'effective_from']);
    const categoryId = toInt(req.body.category_id, 'category_id');
    const amount = toNumber(req.body.amount, 'amount');
    const { rows } = await db.query(
      'insert into rates (category_id, amount, effective_from) values ($1, $2, $3) returning id',
      [categoryId, amount, req.body.effective_from]
    );
    const created = await db.query(`${SELECT} where r.id = $1`, [rows[0].id]);
    res.status(201).json(created.rows[0]);
  })
);

router.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['category_id', 'amount', 'effective_from']);
    const categoryId = toInt(req.body.category_id, 'category_id');
    const amount = toNumber(req.body.amount, 'amount');
    const upd = await db.query(
      'update rates set category_id = $1, amount = $2, effective_from = $3 where id = $4 returning id',
      [categoryId, amount, req.body.effective_from, req.params.id]
    );
    if (upd.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const updated = await db.query(`${SELECT} where r.id = $1`, [req.params.id]);
    res.json(updated.rows[0]);
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await db.query('delete from rates where id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
