'use strict';

const express = require('express');
const { pool } = require('../db');
const { asyncHandler, requireFields, toInt, badRequest } = require('./helpers');
const { requireAdmin } = require('../auth');
const { parseUnionCsv, parseUnionWorkbook, runIngest } = require('../ingestCore');

const router = express.Router();

// Upload a salary-register file — either CSV text (`csv`) or a base64-encoded
// Excel workbook (`xlsx`). commit=false (default) is a dry-run preview that
// rolls back; commit=true applies it. Admin only.
router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['month', 'year']);
    const month = toInt(req.body.month, 'month');
    const year = toInt(req.body.year, 'year');
    if (month < 1 || month > 12) badRequest('month must be 1-12');
    if (year < 2000 || year > 2100) badRequest('year out of range');
    const commit = req.body.commit === true;

    let parsed;
    if (req.body.xlsx) {
      let buf;
      try {
        buf = Buffer.from(req.body.xlsx, 'base64');
      } catch {
        badRequest('Invalid Excel file data.');
      }
      parsed = parseUnionWorkbook(buf);
    } else if (req.body.csv) {
      parsed = parseUnionCsv(req.body.csv);
    } else {
      badRequest('Provide either csv text or an xlsx file.');
    }
    const { rows } = parsed;
    if (rows.length === 0) badRequest('No employee rows found in the file.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const summary = await runIngest(client, { month, year, rows });
      if (commit) await client.query('COMMIT');
      else await client.query('ROLLBACK');
      res.json({ dryRun: !commit, parsedRows: rows.length, ...summary });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Import rollback failed (connection may have been lost):', rollbackError.message);
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
