'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, requireFields, toInt, badRequest } = require('./helpers');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

// List all periods with a member count and collected total.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(`
      select p.id, p.month, p.year, p.status, p.generated_at, p.finalized_at,
             (select count(*) from contributions c where c.period_id = p.id)::int as member_count,
             (select coalesce(sum(amount), 0) from contributions c
                where c.period_id = p.id and c.received) as total_received
      from periods p
      order by p.year desc, p.month desc
    `);
    res.json(rows);
  })
);

// Generate (or regenerate, while still draft) the month's draft entries.
router.post(
  '/generate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['month', 'year']);
    const month = toInt(req.body.month, 'month');
    const year = toInt(req.body.year, 'year');
    if (month < 1 || month > 12) badRequest('month must be 1-12');
    if (year < 2000 || year > 2100) badRequest('year out of range');

    const result = await db.withTransaction(async (client) => {
      const existing = await client.query(
        'select id, status from periods where month = $1 and year = $2',
        [month, year]
      );

      let periodId;
      if (existing.rows.length === 0) {
        const ins = await client.query(
          'insert into periods (month, year, status) values ($1, $2, $3) returning id',
          [month, year, 'draft']
        );
        periodId = ins.rows[0].id;
      } else {
        if (existing.rows[0].status === 'final') {
          badRequest('This month is finalized. Reopen it before regenerating.');
        }
        periodId = existing.rows[0].id;
        await client.query('delete from contributions where period_id = $1', [periodId]);
        await client.query(
          'update periods set generated_at = now(), import_hash = null, import_summary = null where id = $1',
          [periodId]
        );
      }

      // Snapshot branch/category/amount for every active member. Amount is the
      // latest effective rate for the member's category. Any per-member
      // adjustment (e.g. out-of-state members) is made afterwards by editing
      // the draft in the audit window.
      const ins = await client.query(
        `insert into contributions (period_id, member_id, branch_id, category_id, amount, received)
         select $1, m.id, m.branch_id, m.category_id,
           coalesce(
             (select r.amount from rates r
                where r.category_id = m.category_id
                  and r.effective_from <= make_date($2, $3, 1)
                order by r.effective_from desc limit 1),
             0
           ),
           true
         from members m
         where m.active = true`,
        [periodId, year, month]
      );

      return { periodId, inserted: ins.rowCount };
    });

    res.status(201).json({ id: result.periodId, generated: result.inserted, month, year, status: 'draft' });
  })
);

// A single period with its counts (for the audit page header).
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `select p.id, p.month, p.year, p.status, p.generated_at, p.finalized_at,
              (select count(*) from contributions c where c.period_id = p.id)::int as member_count,
              (select coalesce(sum(amount), 0) from contributions c
                 where c.period_id = p.id and c.received) as total_received
       from periods p where p.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  })
);

// Line entries for a period (the audit grid).
router.get(
  '/:id/contributions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `select c.id, c.member_id, c.amount, c.received, c.remarks, c.entry_date, c.flag,
              m.employee_id, m.name, m.surname, m.sex, m.is_out_of_state, m.home_state,
              cat.code as category_code, cat.name as category_name,
              b.code as branch_code, b.name as branch_name,
              d.name as district_name, z.name as zone_name,
              p.status as period_status
       from contributions c
       join periods p on p.id = c.period_id
       join members m on m.id = c.member_id
       join categories cat on cat.id = c.category_id
       join branches b on b.id = c.branch_id
       join districts d on d.id = b.district_id
       join zones z on z.id = d.zone_id
       where c.period_id = $1
       order by z.name, d.name, b.name, m.name`,
      [req.params.id]
    );
    res.json(rows);
  })
);

router.post(
  '/:id/finalize',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const upd = await db.query(
      `update periods set status = 'final', finalized_at = now(), finalized_by = $1
       where id = $2 and status = 'draft' returning id`,
      [req.session.user.id, req.params.id]
    );
    if (upd.rows.length === 0) badRequest('Period not found or already finalized.');
    res.json({ ok: true, status: 'final' });
  })
);

router.post(
  '/:id/reopen',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const upd = await db.query(
      `update periods set status = 'draft', finalized_at = null, finalized_by = null
       where id = $1 and status = 'final' returning id`,
      [req.params.id]
    );
    if (upd.rows.length === 0) badRequest('Period not found or not finalized.');
    res.json({ ok: true, status: 'draft' });
  })
);

// Delete a whole month (its draft + all contributions). Master data — members,
// branches, categories — is kept; only this month's report is removed. A
// finalized month must be reopened first.
router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const period = (await db.query('select id, status from periods where id = $1', [req.params.id])).rows[0];
    if (!period) return res.status(404).json({ error: 'Not found' });
    if (period.status === 'final') {
      badRequest('This month is finalized — reopen it before deleting.');
    }
    // contributions FK is ON DELETE CASCADE, so they go with the period.
    await db.query('delete from periods where id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
