'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, toNumber, badRequest } = require('./helpers');
const { requireAdmin } = require('../auth');

const router = express.Router();

// Edit a single line during the audit window. Only allowed while the owning
// period is still a draft — finalized months are locked.
router.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const current = await db.query(
      `select c.id, p.status
       from contributions c join periods p on p.id = c.period_id
       where c.id = $1`,
      [req.params.id]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (current.rows[0].status === 'final') {
      badRequest('This month is finalized and cannot be edited. Reopen it first.');
    }

    const amount = req.body.amount === undefined ? undefined : toNumber(req.body.amount, 'amount');
    const received = req.body.received === undefined ? undefined : Boolean(req.body.received);
    const remarks = req.body.remarks === undefined ? undefined : (req.body.remarks || null);

    const { rows } = await db.query(
      `update contributions set
         amount   = coalesce($1, amount),
         received = coalesce($2, received),
         remarks  = case when $3::boolean then $4 else remarks end
       where id = $5
       returning id, amount, received, remarks`,
      [
        amount === undefined ? null : amount,
        received === undefined ? null : received,
        remarks !== undefined, // whether to overwrite remarks
        remarks === undefined ? null : remarks,
        req.params.id,
      ]
    );
    res.json(rows[0]);
  })
);

module.exports = router;
