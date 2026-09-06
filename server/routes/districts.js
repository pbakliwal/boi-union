'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, requireFields, toInt } = require('./helpers');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

const SELECT = `
  select d.id, d.code, d.name, d.zone_id, z.name as zone_name
  from districts d
  join zones z on z.id = d.zone_id
`;

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.zone_id) {
      params.push(toInt(req.query.zone_id, 'zone_id'));
      where = `where d.zone_id = $1`;
    }
    const { rows } = await db.query(`${SELECT} ${where} order by z.name, d.name`, params);
    res.json(rows);
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['code', 'name', 'zone_id']);
    const { code, name } = req.body;
    const zoneId = toInt(req.body.zone_id, 'zone_id');
    const { rows } = await db.query(
      'insert into districts (code, name, zone_id) values ($1, $2, $3) returning id',
      [String(code).trim(), String(name).trim(), zoneId]
    );
    const created = await db.query(`${SELECT} where d.id = $1`, [rows[0].id]);
    res.status(201).json(created.rows[0]);
  })
);

router.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['code', 'name', 'zone_id']);
    const { code, name } = req.body;
    const zoneId = toInt(req.body.zone_id, 'zone_id');
    const upd = await db.query(
      'update districts set code = $1, name = $2, zone_id = $3 where id = $4 returning id',
      [String(code).trim(), String(name).trim(), zoneId, req.params.id]
    );
    if (upd.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const updated = await db.query(`${SELECT} where d.id = $1`, [req.params.id]);
    res.json(updated.rows[0]);
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await db.query('delete from districts where id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
