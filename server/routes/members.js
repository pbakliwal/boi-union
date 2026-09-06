'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, requireFields, toInt } = require('./helpers');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

const SELECT = `
  select m.id, m.employee_id, m.name, m.surname, m.sex, m.mobile, m.category_id, m.branch_id,
         m.is_out_of_state, m.home_state, m.active,
         m.joined_on, m.left_on,
         c.code as category_code, c.name as category_name,
         b.code as branch_code, b.name as branch_name,
         d.id as district_id, d.name as district_name,
         z.id as zone_id, z.name as zone_name
  from members m
  join categories c on c.id = m.category_id
  join branches b on b.id = m.branch_id
  join districts d on d.id = b.district_id
  join zones z on z.id = d.zone_id
`;

// Normalise the editable columns from a request body into a value list.
function readBody(body) {
  requireFields(body, ['employee_id', 'name', 'category_id', 'branch_id']);
  return {
    employee_id: String(body.employee_id).trim(),
    name: String(body.name).trim(),
    surname: body.surname ? String(body.surname).trim() : null,
    sex: body.sex === 'M' || body.sex === 'F' ? body.sex : null,
    mobile: body.mobile ? String(body.mobile).trim() : null,
    category_id: toInt(body.category_id, 'category_id'),
    branch_id: toInt(body.branch_id, 'branch_id'),
    is_out_of_state: Boolean(body.is_out_of_state),
    home_state: body.home_state ? String(body.home_state).trim() : null,
    active: body.active === undefined ? true : Boolean(body.active),
    joined_on: body.joined_on || null,
    left_on: body.left_on || null,
  };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = [];
    const clauses = [];
    if (req.query.branch_id) {
      params.push(toInt(req.query.branch_id, 'branch_id'));
      clauses.push(`m.branch_id = $${params.length}`);
    }
    if (req.query.active !== undefined && req.query.active !== '') {
      params.push(req.query.active === 'true' || req.query.active === '1');
      clauses.push(`m.active = $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${req.query.q.toLowerCase()}%`);
      clauses.push(
        `(lower(m.name) like $${params.length} or lower(m.surname) like $${params.length}
          or lower(m.employee_id) like $${params.length} or lower(m.mobile) like $${params.length})`
      );
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const { rows } = await db.query(
      `${SELECT} ${where} order by m.name, m.surname`,
      params
    );
    res.json(rows);
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(`${SELECT} where m.id = $1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  })
);

router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const v = readBody(req.body);
    const { rows } = await db.query(
      `insert into members
        (employee_id, name, surname, sex, mobile, category_id, branch_id, is_out_of_state, home_state, active, joined_on, left_on)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [v.employee_id, v.name, v.surname, v.sex, v.mobile, v.category_id, v.branch_id, v.is_out_of_state, v.home_state, v.active, v.joined_on, v.left_on]
    );
    const created = await db.query(`${SELECT} where m.id = $1`, [rows[0].id]);
    res.status(201).json(created.rows[0]);
  })
);

router.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const v = readBody(req.body);
    const upd = await db.query(
      `update members set
        employee_id=$1, name=$2, surname=$3, sex=$4, mobile=$5, category_id=$6, branch_id=$7,
        is_out_of_state=$8, home_state=$9, active=$10, joined_on=$11, left_on=$12
       where id=$13 returning id`,
      [v.employee_id, v.name, v.surname, v.sex, v.mobile, v.category_id, v.branch_id, v.is_out_of_state, v.home_state, v.active, v.joined_on, v.left_on, req.params.id]
    );
    if (upd.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const updated = await db.query(`${SELECT} where m.id = $1`, [req.params.id]);
    res.json(updated.rows[0]);
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await db.query('delete from members where id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
