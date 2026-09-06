'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, requireFields, toInt } = require('./helpers');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

const SELECT = `
  select b.id, b.code, b.name, b.district_id,
         d.name as district_name, z.id as zone_id, z.name as zone_name
  from branches b
  join districts d on d.id = b.district_id
  join zones z on z.id = d.zone_id
`;

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = [];
    const clauses = [];
    if (req.query.district_id) {
      params.push(toInt(req.query.district_id, 'district_id'));
      clauses.push(`b.district_id = $${params.length}`);
    }
    if (req.query.zone_id) {
      params.push(toInt(req.query.zone_id, 'zone_id'));
      clauses.push(`z.id = $${params.length}`);
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const { rows } = await db.query(`${SELECT} ${where} order by z.name, d.name, b.name`, params);
    res.json(rows);
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['code', 'name', 'district_id']);
    const { code, name } = req.body;
    const districtId = toInt(req.body.district_id, 'district_id');
    const { rows } = await db.query(
      'insert into branches (code, name, district_id) values ($1, $2, $3) returning id',
      [String(code).trim(), String(name).trim(), districtId]
    );
    const created = await db.query(`${SELECT} where b.id = $1`, [rows[0].id]);
    res.status(201).json(created.rows[0]);
  })
);

router.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['code', 'name', 'district_id']);
    const { code, name } = req.body;
    const districtId = toInt(req.body.district_id, 'district_id');
    const upd = await db.query(
      'update branches set code = $1, name = $2, district_id = $3 where id = $4 returning id',
      [String(code).trim(), String(name).trim(), districtId, req.params.id]
    );
    if (upd.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const updated = await db.query(`${SELECT} where b.id = $1`, [req.params.id]);
    res.json(updated.rows[0]);
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await db.query('delete from branches where id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
