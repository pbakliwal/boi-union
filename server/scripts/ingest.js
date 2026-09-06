'use strict';

// CLI: ingest a salary-register file (CSV or Excel).
//   node scripts/ingest.js <file.csv|.xlsx> [--month M --year Y] [--reset] [--dry]
// If --month/--year are omitted it infers them from a MONYY token in the
// filename (e.g. UNION_APR26.csv -> April 2026).
// --reset wipes existing masters/contributions first (fresh bootstrap).
// --dry parses + runs everything then rolls back (no changes committed).

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { parseUnionCsv, parseUnionWorkbook, runIngest } = require('../ingestCore');

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name) => process.argv.includes(name);

function inferFromName(file) {
  const m = /([A-Za-z]{3})[ _-]?(\d{2})/.exec(path.basename(file));
  if (m && MONTHS[m[1].toUpperCase()]) return { month: MONTHS[m[1].toUpperCase()], year: 2000 + Number(m[2]) };
  return {};
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('Usage: node scripts/ingest.js <file.csv|.xlsx> [--month M --year Y] [--reset] [--dry]');
    process.exit(1);
  }
  const inferred = inferFromName(file);
  const month = Number(arg('--month') || inferred.month);
  const year = Number(arg('--year') || inferred.year);
  if (!month || !year) {
    console.error('Could not determine month/year — pass --month and --year.');
    process.exit(1);
  }

  const isExcel = /\.xlsx?$/i.test(file);
  const { rows } = isExcel
    ? parseUnionWorkbook(fs.readFileSync(path.resolve(file)))
    : parseUnionCsv(fs.readFileSync(path.resolve(file), 'utf8'));
  console.log(`Parsed ${rows.length} employee rows for ${month}/${year}${has('--reset') ? ' (reset)' : ''}${has('--dry') ? ' (dry-run)' : ''}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (has('--reset')) {
      await client.query('truncate contributions, periods, rates, members, branches, districts, zones, categories restart identity cascade');
      console.log('Wiped existing masters + contributions.');
    }
    const summary = await runIngest(client, { month, year, rows });
    if (has('--dry')) {
      await client.query('ROLLBACK');
      console.log('DRY RUN — rolled back.');
    } else {
      await client.query('COMMIT');
    }
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ingest failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().then(() => pool.end());
