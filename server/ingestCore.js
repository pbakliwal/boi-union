'use strict';

// Parse a Bank-of-India "salary register deductions" file (CSV or Excel) and
// sync it into the DB: upsert masters (Indore zone/district, branches, scale
// categories), upsert employees, mark absent employees as left, and build the
// month's DRAFT contributions with anomaly flags. Shared by the CLI
// (scripts/ingest.js) and the upload endpoint (routes/ingest.js).
//
// The bank's export layout varies month to month (column order, names,
// SN column, TOTAL vs NIL, UNION CODE- prefixes, extra preamble rows). The
// parser therefore scans for the header row rather than assuming a fixed
// position, resolves columns by alias, and treats every non-standard column
// as a union bucket, summing them for the amount.

const XLSX = require('xlsx');
const { createHash } = require('crypto');

const ZONE_NAME = 'Indore';
const DISTRICT_NAME = 'Indore';

// Serial-number column labels — a row whose first cell is one of these is
// treated as the header row (the real table starts there), regardless of how
// many blank/preamble rows precede it in the export.
const SN_TOKENS = new Set(['SN', 'S.NO', 'S NO', 'SR', 'SR.NO', 'SRNO', 'SL NO', 'SL.NO', 'SLNO', 'S/N', '#']);
const EMP_ID_ALIASES = ['EMPLOYEE ID', 'EMP ID'];

// Columns that are NOT union buckets (everything else in the header is).
const META_COLUMNS = new Set([
  'SN', 'S.NO', 'S NO', 'SR', 'SRNO',
  'EMPLOYEE ID', 'EMP ID', 'EMPLOYEE NAME', 'NAME', 'EMP NAME',
  'MOB', 'MOBILE', 'PHONE',
  'LOC_DESCR', 'LOCATION DESCRIPTION', 'LOCATION', 'BRANCH',
  'DEPARTMENT', 'DEPT', 'DESIGNATION', 'SCALE', 'GRADE',
  'DOB', 'DOJ', 'GENDER', 'SEX', 'TOTAL', 'NIL',
]);

// A row is the header row if its first cell is an SN-style label, OR any cell
// is an Employee-ID-style label. Whichever condition is met first (scanning
// top to bottom) wins, so this works for exports with or without an SN column.
function isHeaderRow(cells) {
  const first = String(cells[0] || '').trim().toUpperCase();
  if (SN_TOKENS.has(first)) return true;
  return cells.some((c) => EMP_ID_ALIASES.includes(String(c || '').trim().toUpperCase()));
}

// Expected monthly rate by scale prefix. CK* = clerical, SS* = sub-staff.
function expectedRate(scale) {
  const s = String(scale || '').toUpperCase();
  if (s.startsWith('CK')) return 100;
  if (s.startsWith('SS')) return 50;
  return null; // unknown scale -> can't judge automatically
}

// --- CSV parsing ---------------------------------------------------------

// Parse one CSV line honoring double-quoted fields (values may contain commas).
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*\.\s*$/, '') // strip a trailing " ." placeholder surname
    .trim();
}

// dd/mm/yy -> 'YYYY-MM-DD' (yy < 40 => 20yy else 19yy). Returns null if invalid.
function parseDate(raw) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(raw || '').trim());
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = yy < 40 ? 2000 + yy : 1900 + yy;
  return `${year}-${m[2]}-${m[1]}`;
}

function num(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '' || s.toUpperCase() === 'NIL') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Normalize a mobile number cell. The bank's export sometimes leaves "#N/A",
// or Excel has mangled the value into scientific notation (e.g. "9.18085E+11")
// — that form has already lost digits of precision, so the original number is
// NOT recoverable; store null rather than a fabricated value that only looks
// precise.
function cleanMobile(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '#N/A' || /e\+?\d+$/i.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 13 ? digits : null;
}

// Normalize a union column label (drop a "UNION CODE-" prefix, trim).
function normUnion(name) {
  return String(name || '').replace(/^union\s*code\s*[-:]\s*/i, '').trim();
}

function firstIndex(colMap, aliases) {
  for (const a of aliases) if (colMap[a] !== undefined) return colMap[a];
  return undefined;
}

// Parse the whole file into normalized rows. Returns { rows, unionCols }.
// Scans row by row (ignoring any number of preamble/title rows above the
// real table) and treats the first row matching isHeaderRow() as the header.
function parseUnionCsv(text) {
  const clean = String(text).replace(/^﻿/, '');
  const lines = clean.split(/\r\n|\n|\r/);
  const allCells = lines.map((l) => splitCsvLine(l));

  const headerIdx = allCells.findIndex(isHeaderRow);
  if (headerIdx === -1) {
    const err = new Error(
      'Could not find the header row (expected a first column like "SN", or an "EMPLOYEE ID" column).'
    );
    err.status = 400;
    throw err;
  }

  const header = allCells[headerIdx].map((h) => h.trim());
  const col = {};
  header.forEach((name, i) => { if (name) col[name.toUpperCase()] = i; });

  const idEmp = firstIndex(col, EMP_ID_ALIASES);
  const idName = firstIndex(col, ['EMPLOYEE NAME', 'NAME', 'EMP NAME']);
  const idGender = firstIndex(col, ['GENDER', 'SEX']);
  const idLoc = firstIndex(col, ['LOCATION DESCRIPTION', 'LOC_DESCR', 'LOCATION', 'BRANCH']);
  const idScale = firstIndex(col, ['SCALE', 'GRADE']);
  const idDoj = firstIndex(col, ['DOJ']);
  const idMobile = firstIndex(col, ['MOB', 'MOBILE', 'PHONE']);
  if ([idEmp, idName, idLoc, idScale].some((x) => x === undefined)) {
    const err = new Error('Header is missing required columns (EMPLOYEE ID, NAME, LOCATION, SCALE).');
    err.status = 400;
    throw err;
  }

  // Union columns = every header cell that isn't a known meta column.
  const unionCols = [];
  header.forEach((name, i) => {
    if (name && !META_COLUMNS.has(name.toUpperCase())) unionCols.push({ index: i, name: normUnion(name) });
  });
  if (unionCols.length === 0) {
    const err = new Error('No union/deduction columns found in the header.');
    err.status = 400;
    throw err;
  }

  const rows = [];
  for (let li = headerIdx + 1; li < allCells.length; li++) {
    const cells = allCells[li];
    if (cells.every((c) => !String(c || '').trim())) continue; // skip blank rows
    const empId = String(cells[idEmp] || '').trim();
    if (empId.toUpperCase() === 'TOTAL') break;
    if (!/^\d+$/.test(empId)) continue; // skip non-data lines (SN totals, blanks)

    let amount = 0;
    let unionLabel = null;
    let best = 0;
    for (const u of unionCols) {
      const v = num(cells[u.index]);
      amount += v;
      if (v > best) { best = v; unionLabel = u.name; }
    }

    const gender = idGender !== undefined ? String(cells[idGender] || '').trim().toUpperCase() : '';
    rows.push({
      employee_id: empId,
      name: cleanName(cells[idName]),
      sex: gender === 'M' || gender === 'F' ? gender : null,
      branch: String(cells[idLoc] || '').trim(),
      scale: String(cells[idScale] || '').trim().toUpperCase(),
      joined_on: idDoj !== undefined ? parseDate(cells[idDoj]) : null,
      mobile: idMobile !== undefined ? cleanMobile(cells[idMobile]) : null,
      amount,
      union: unionLabel,
    });
  }

  return { rows, unionCols: unionCols.map((u) => u.name) };
}

// Parse a native Excel workbook (.xlsx/.xls) by converting its first sheet to
// CSV text and running it through the same parser as a plain CSV upload —
// same header-scan, column-alias, and union-bucket logic either way.
function parseUnionWorkbook(buffer) {
  let workbook;
  try {
    // cellFormula/cellHTML disabled — only cell values are needed, which
    // avoids unnecessary parsing of anything else embedded in the file.
    workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false, cellDates: false });
  } catch (e) {
    const err = new Error(`Could not read the Excel file: ${e.message}`);
    err.status = 400;
    throw err;
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName && workbook.Sheets[sheetName];
  if (!sheet) {
    const err = new Error('The uploaded workbook has no sheets.');
    err.status = 400;
    throw err;
  }
  const csvText = XLSX.utils.sheet_to_csv(sheet, { blankrows: true });
  return parseUnionCsv(csvText);
}

// --- Ingest --------------------------------------------------------------

async function ensureZoneDistrict(client, summary) {
  let z = (await client.query('select id from zones where lower(name) = lower($1)', [ZONE_NAME])).rows[0];
  if (!z) {
    z = (await client.query('insert into zones (code, name) values ($1, $2) returning id', ['INDORE', ZONE_NAME])).rows[0];
    summary.masters.zonesCreated++;
  }
  let d = (await client.query('select id from districts where lower(name) = lower($1) and zone_id = $2', [DISTRICT_NAME, z.id])).rows[0];
  if (!d) {
    d = (await client.query('insert into districts (code, name, zone_id) values ($1, $2, $3) returning id', ['INDORE', DISTRICT_NAME, z.id])).rows[0];
    summary.masters.districtsCreated++;
  }
  return { zoneId: z.id, districtId: d.id };
}

// Main entry. Caller owns the transaction (client). month/year are the period.
async function runIngest(client, { month, year, rows, markLeft = true }) {
  const invalid = (message) => {
    const err = new Error(message);
    err.status = 400;
    throw err;
  };
  if (!Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 2000 || year > 2100) {
    invalid('Import month/year is out of range.');
  }
  if (!rows.length) invalid('No employee rows found in the file.');
  const seen = new Set();
  for (const row of rows) {
    if (!row.employee_id || !row.branch) invalid(`Employee ${row.employee_id || '(missing ID)'} has no ID or branch.`);
    if (seen.has(row.employee_id)) invalid(`Duplicate Employee ID ${row.employee_id} in the file. Remove the duplicate row before importing.`);
    if (!Number.isFinite(row.amount) || row.amount < 0 || row.amount > 9999999999.99) {
      invalid(`Invalid deduction amount for employee ${row.employee_id}.`);
    }
    seen.add(row.employee_id);
  }

  const hash = createHash('sha256').update(JSON.stringify({ month, year, rows, markLeft })).digest('hex');
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  // Serialize imports across months because they share the latest master roster.
  // Transaction-scoped locks are released on commit, rollback or connection loss.
  await client.query('select pg_advisory_xact_lock(1112492361)');
  await client.query(
    `insert into periods (month, year, status) values ($1, $2, 'draft')
     on conflict (month, year) do nothing`,
    [month, year]
  );
  const period = (await client.query(
    'select id, status, import_hash, import_summary from periods where month = $1 and year = $2 for update',
    [month, year]
  )).rows[0];
  if (period.import_hash === hash && period.import_summary) {
    return { ...period.import_summary, alreadyApplied: true };
  }
  if (period.status === 'final') invalid(`${month}/${year} is finalized — reopen it before re-importing.`);

  const summary = {
    month, year,
    isLatest: true,
    masters: { zonesCreated: 0, districtsCreated: 0, branchesCreated: 0, categoriesCreated: 0 },
    employees: { created: 0, updated: 0, unchanged: 0, markedLeft: 0 },
    contributions: { total: 0, totalAmount: 0, flaggedZero: 0, flaggedDiffers: 0 },
    flagged: [],
  };

  // Master data is only synced when importing the most recent month. Importing
  // an OLDER month just (re)writes that month's contributions (the report) and
  // leaves the member roster / branches / active status untouched, so a
  // back-fill never reverts the current master state.
  const periodKey = year * 12 + (month - 1);
  const maxOther = (await client.query(
    'select coalesce(max(year * 12 + (month - 1)), -1) as k from periods where not (month = $1 and year = $2)',
    [month, year]
  )).rows[0];
  const isLatest = periodKey >= Number(maxOther.k);
  summary.isLatest = isLatest;

  const { districtId } = await ensureZoneDistrict(client, summary);

  const ids = [...seen];
  const existingMembers = new Map((await client.query(
    'select id, employee_id, category_id from members where employee_id = any($1::text[])',
    [ids]
  )).rows.map((m) => [m.employee_id, m]));
  const branchCache = new Map((await client.query(
    'select id, name from branches where district_id = $1', [districtId]
  )).rows.map((b) => [b.name, b.id]));
  const missingBranches = [...new Set(rows.map((r) => r.branch))].filter((name) => !branchCache.has(name));
  if (missingBranches.length) {
    const inserted = await client.query(
      `insert into branches (code, name, district_id)
       select name, name, $2 from jsonb_array_elements_text($1::jsonb) as input(name)
       returning id, name`,
      [JSON.stringify(missingBranches), districtId]
    );
    summary.masters.branchesCreated = inserted.rowCount;
    inserted.rows.forEach((b) => branchCache.set(b.name, b.id));
  }

  const catCache = new Map((await client.query('select id, code from categories')).rows.map((c) => [c.code.toUpperCase(), c.id]));
  const usedCodes = new Set();
  for (const r of rows) {
    if (r.scale && !r.scale.includes('#')) usedCodes.add(r.scale);
    else if (!existingMembers.has(r.employee_id)) usedCodes.add('NA');
  }
  const missingCodes = [...usedCodes].filter((code) => !catCache.has(code));
  if (missingCodes.length) {
    const inserted = await client.query(
      `insert into categories (code, name)
       select code, code from jsonb_array_elements_text($1::jsonb) as input(code)
       returning id, code`,
      [JSON.stringify(missingCodes)]
    );
    summary.masters.categoriesCreated = inserted.rowCount;
    inserted.rows.forEach((c) => catCache.set(c.code.toUpperCase(), c.id));
  }
  const expectedByCat = new Map((await client.query(
    `select distinct on (category_id) category_id, amount from rates
     where effective_from <= $1 order by category_id, effective_from desc`,
    [periodStart]
  )).rows.map((r) => [r.category_id, Number(r.amount)]));
  const defaultRates = [];
  for (const code of usedCodes) {
    const categoryId = catCache.get(code);
    const amount = expectedRate(code);
    if (!expectedByCat.has(categoryId) && amount != null) {
      defaultRates.push({ category_id: categoryId, amount });
      expectedByCat.set(categoryId, amount);
    }
  }
  if (defaultRates.length) {
    await client.query(
      `insert into rates (category_id, amount, effective_from)
       select category_id, amount, '2000-01-01'::date
       from jsonb_to_recordset($1::jsonb) as input(category_id integer, amount numeric)
       on conflict (category_id, effective_from) do nothing`,
      [JSON.stringify(defaultRates)]
    );
  }

  const entries = [];
  for (const r of rows) {
    const existing = existingMembers.get(r.employee_id);
    const catId = r.scale && !r.scale.includes('#')
      ? catCache.get(r.scale)
      : existing?.category_id || catCache.get('NA');
    const expected = expectedByCat.get(catId) ?? null;
    if (existing) {
      if (isLatest) summary.employees.updated++;
      else summary.employees.unchanged++;
    } else summary.employees.created++;

    // Flag: zero amount, off-rate amount, or an amount with no known rate.
    let flag = null;
    if (r.amount === 0) flag = 'zero';
    else if (expected != null && r.amount !== expected) flag = 'differs';
    else if (expected == null) flag = 'differs';

    const notes = [];
    if (r.union && r.union.toUpperCase() !== 'INDORE ZONE 1') notes.push(`Union: ${r.union}`);
    if (flag === 'differs' && expected != null) notes.push(`file ₹${r.amount} vs expected ₹${expected}`);
    if (flag === 'differs' && expected == null) notes.push('no rate set for this scale — review');
    if (flag === 'zero') notes.push('no deduction');
    const remarks = notes.join('; ') || null;

    entries.push({ ...r, category_id: catId, branch_id: branchCache.get(r.branch), flag, remarks });

    summary.contributions.total++;
    if (r.amount > 0) summary.contributions.totalAmount += r.amount;
    if (flag === 'zero') summary.contributions.flaggedZero++;
    if (flag === 'differs') summary.contributions.flaggedDiffers++;
    if (flag) summary.flagged.push({ employee_id: r.employee_id, name: r.name, branch: r.branch, scale: r.scale, amount: r.amount, expected, flag });
  }

  const payload = JSON.stringify(entries);
  await client.query(
    `insert into members (employee_id, name, sex, mobile, category_id, branch_id, active, joined_on)
     select employee_id, name, sex, mobile, category_id, branch_id, true, joined_on
     from jsonb_to_recordset($1::jsonb) as input(
       employee_id text, name text, sex char(1), mobile text,
       category_id integer, branch_id integer, joined_on date)
     on conflict (employee_id) do update set
       name=excluded.name, sex=excluded.sex, mobile=coalesce(excluded.mobile, members.mobile),
       category_id=excluded.category_id, branch_id=excluded.branch_id,
       active=true, left_on=null, joined_on=coalesce(excluded.joined_on, members.joined_on)
     where $2::boolean`,
    [payload, isLatest]
  );
  await client.query('delete from contributions where period_id = $1', [period.id]);
  await client.query(
    `insert into contributions (period_id, member_id, branch_id, category_id, amount, received, flag, remarks, entry_date)
     select $2, m.id, input.branch_id, input.category_id, input.amount,
            input.amount > 0, input.flag, input.remarks, $3::date
     from jsonb_to_recordset($1::jsonb) as input(
       employee_id text, branch_id integer, category_id integer, amount numeric, flag text, remarks text)
     join members m on m.employee_id = input.employee_id
     on conflict (period_id, member_id) do update set
       branch_id=excluded.branch_id, category_id=excluded.category_id, amount=excluded.amount,
       received=excluded.received, flag=excluded.flag, remarks=excluded.remarks`,
    [payload, period.id, periodStart]
  );

  // Mark employees in this district who are absent from the file as left —
  // only when importing the latest month (never on a back-fill).
  if (markLeft && isLatest) {
    const res = await client.query(
      `update members set active=false, left_on=$1
       where active=true and branch_id in (select id from branches where district_id=$2)
         and not (employee_id = any($3::text[]))`,
      [periodEnd, districtId, ids]
    );
    summary.employees.markedLeft = res.rowCount;
  }

  summary.periodId = period.id;
  await client.query(
    'update periods set import_hash = $1, import_summary = $2::jsonb where id = $3',
    [hash, JSON.stringify(summary), period.id]
  );
  return summary;
}

module.exports = { parseUnionCsv, parseUnionWorkbook, runIngest, expectedRate };
