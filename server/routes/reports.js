'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, toInt, badRequest } = require('./helpers');
const { requireAuth } = require('../auth');

const router = express.Router();

function monthYear(req) {
  const month = toInt(req.query.month, 'month');
  const year = toInt(req.query.year, 'year');
  if (month < 1 || month > 12) badRequest('month must be 1-12');
  return { month, year };
}

// The 12 (month, year) columns for a report spanning a full year. For the
// Indian financial year (basis=fy), `year` is the FY's starting year — the
// window runs April(year) through March(year+1), so it straddles two
// calendar years; each month number (1-12) still appears exactly once.
function yearColumns(basis, year) {
  if (basis === 'fy') {
    const cols = [];
    for (let m = 4; m <= 12; m++) cols.push({ month: m, year });
    for (let m = 1; m <= 3; m++) cols.push({ month: m, year: year + 1 });
    return cols;
  }
  const cols = [];
  for (let m = 1; m <= 12; m++) cols.push({ month: m, year });
  return cols;
}

// 1) Monthly summary — collected amount grouped Zone -> District, with
//    zone subtotals and a grand total. (SUMM.TXT)
router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { month, year } = monthYear(req);
    const { rows } = await db.query(
      `select z.id as zone_id, z.name as zone_name,
              d.id as district_id, d.name as district_name,
              coalesce(sum(c.amount) filter (where c.received), 0) as amount,
              count(*) filter (where c.received)::int as paid_count
       from periods p
       join contributions c on c.period_id = p.id
       join branches b on b.id = c.branch_id
       join districts d on d.id = b.district_id
       join zones z on z.id = d.zone_id
       where p.month = $1 and p.year = $2
       group by z.id, z.name, d.id, d.name
       order by z.name, d.name`,
      [month, year]
    );

    const zones = [];
    let grand = 0;
    for (const r of rows) {
      let zone = zones.find((z) => z.zone_id === r.zone_id);
      if (!zone) {
        zone = { zone_id: r.zone_id, zone_name: r.zone_name, districts: [], subtotal: 0 };
        zones.push(zone);
      }
      const amount = Number(r.amount);
      zone.districts.push({
        district_id: r.district_id,
        district_name: r.district_name,
        amount,
        paid_count: r.paid_count,
      });
      zone.subtotal += amount;
      grand += amount;
    }
    res.json({ month, year, zones, grand_total: grand });
  })
);

// 2) District detail — member lines for one district in a month. (MIN.TXT)
router.get(
  '/district-detail',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { month, year } = monthYear(req);
    const districtId = toInt(req.query.district_id, 'district_id');
    const { rows } = await db.query(
      `select m.name, m.surname, b.code as branch_code, b.name as branch_name,
              c.amount, c.received, c.remarks, c.entry_date
       from periods p
       join contributions c on c.period_id = p.id
       join members m on m.id = c.member_id
       join branches b on b.id = c.branch_id
       where p.month = $1 and p.year = $2 and b.district_id = $3
       order by b.name, m.name`,
      [month, year, districtId]
    );
    const subtotal = rows.reduce((s, r) => s + (r.received ? Number(r.amount) : 0), 0);
    res.json({ month, year, district_id: districtId, rows, subtotal });
  })
);

// 3) One-third list — per-district totals across the given months, plus a
//    one-third column (total / 3). Default months = last quarter Oct-Dec.
router.get(
  '/one-third',
  requireAuth,
  asyncHandler(async (req, res) => {
    const year = toInt(req.query.year, 'year');
    const months = String(req.query.months || '10,11,12')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
    if (months.length === 0) badRequest('Provide at least one valid month');

    const { rows } = await db.query(
      `select d.id as district_id, d.name as district_name, p.month,
              coalesce(sum(c.amount) filter (where c.received), 0) as amount
       from periods p
       join contributions c on c.period_id = p.id
       join branches b on b.id = c.branch_id
       join districts d on d.id = b.district_id
       where p.year = $1 and p.month = any($2::int[])
       group by d.id, d.name, p.month
       order by d.name`,
      [year, months]
    );

    const byDistrict = new Map();
    for (const r of rows) {
      if (!byDistrict.has(r.district_id)) {
        byDistrict.set(r.district_id, {
          district_id: r.district_id,
          district_name: r.district_name,
          months: {},
          total: 0,
        });
      }
      const d = byDistrict.get(r.district_id);
      const amount = Number(r.amount);
      d.months[r.month] = amount;
      d.total += amount;
    }
    const districts = [...byDistrict.values()].map((d) => ({
      ...d,
      one_third: Math.round(d.total / 3),
    }));
    res.json({ year, months, districts });
  })
);

// 4) Yearly members list — per member, amount per month (1-12), with grouping
//    labels for Zone -> District -> Branch. (STAFF.TXT)
router.get(
  '/yearly',
  requireAuth,
  asyncHandler(async (req, res) => {
    const year = toInt(req.query.year, 'year');
    const basis = req.query.basis === 'fy' ? 'fy' : 'calendar';
    const columns = yearColumns(basis, year);

    const values = columns.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
    const params = columns.flatMap((c) => [c.month, c.year]);

    const { rows } = await db.query(
      `select z.name as zone_name, d.name as district_name,
              b.code as branch_code, b.name as branch_name,
              m.id as member_id, m.employee_id, m.name, m.surname, m.sex, cat.code as category_code,
              p.month,
              coalesce(sum(c.amount) filter (where c.received), 0) as amount
       from periods p
       join contributions c on c.period_id = p.id
       join members m on m.id = c.member_id
       join categories cat on cat.id = c.category_id
       join branches b on b.id = c.branch_id
       join districts d on d.id = b.district_id
       join zones z on z.id = d.zone_id
       where (p.month, p.year) in (values ${values})
       group by z.name, d.name, b.code, b.name, m.id, m.employee_id, m.name, m.surname, m.sex, cat.code, p.month
       order by z.name, d.name, b.name, m.name`,
      params
    );

    const byMember = new Map();
    for (const r of rows) {
      if (!byMember.has(r.member_id)) {
        byMember.set(r.member_id, {
          zone_name: r.zone_name,
          district_name: r.district_name,
          branch_code: r.branch_code,
          branch_name: r.branch_name,
          member_id: r.member_id,
          employee_id: r.employee_id,
          name: r.name,
          surname: r.surname,
          sex: r.sex,
          category_code: r.category_code,
          months: {},
          total: 0,
        });
      }
      const m = byMember.get(r.member_id);
      const amount = Number(r.amount);
      m.months[r.month] = amount;
      m.total += amount;
    }
    res.json({ year, basis, columns, members: [...byMember.values()] });
  })
);

module.exports = router;
