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
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10); // last day of month

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

  // Period must be a draft (create if new; refuse if finalized).
  let period = (await client.query('select id, status from periods where month = $1 and year = $2', [month, year])).rows[0];
  if (period && period.status === 'final') {
    const err = new Error(`${month}/${year} is finalized — reopen it before re-importing.`);
    err.status = 400;
    throw err;
  }
  if (!period) {
    period = (await client.query('insert into periods (month, year, status) values ($1, $2, $3) returning id', [month, year, 'draft'])).rows[0];
  }
  await client.query('delete from contributions where period_id = $1', [period.id]);

  // Caches
  const catCache = new Map();     // scale code -> { id, expected }
  const branchCache = new Map();  // branch name -> id
  const catIdExpected = new Map(); // category id -> expected amount

  (await client.query('select id, code from categories')).rows.forEach((c) => catCache.set(c.code.toUpperCase(), { id: c.id, expected: undefined }));
  (await client.query('select id, name from branches where district_id = $1', [districtId])).rows.forEach((b) => branchCache.set(b.name, b.id));

  async function ensureCategory(code) {
    let entry = catCache.get(code);
    if (!entry) {
      const ins = await client.query('insert into categories (code, name) values ($1, $2) returning id', [code, code]);
      entry = { id: ins.rows[0].id, expected: undefined };
      catCache.set(code, entry);
      summary.masters.categoriesCreated++;
    }
    if (entry.expected === undefined) {
      const rate = (await client.query(
        'select amount from rates where category_id = $1 and effective_from <= $2 order by effective_from desc limit 1',
        [entry.id, periodStart]
      )).rows[0];
      if (rate) {
        entry.expected = Number(rate.amount);
      } else {
        const rule = expectedRate(code);
        if (rule != null) {
          await client.query('insert into rates (category_id, amount, effective_from) values ($1, $2, $3)', [entry.id, rule, '2000-01-01']);
        }
        entry.expected = rule; // may be null
      }
      catIdExpected.set(entry.id, entry.expected);
    }
    return entry;
  }

  async function expectedForCatId(catId) {
    if (catIdExpected.has(catId)) return catIdExpected.get(catId);
    const rate = (await client.query(
      'select amount from rates where category_id = $1 and effective_from <= $2 order by effective_from desc limit 1',
      [catId, periodStart]
    )).rows[0];
    const val = rate ? Number(rate.amount) : null;
    catIdExpected.set(catId, val);
    return val;
  }

  async function ensureBranch(name) {
    let id = branchCache.get(name);
    if (!id) {
      const ins = await client.query('insert into branches (code, name, district_id) values ($1, $2, $3) returning id', [name, name, districtId]);
      id = ins.rows[0].id;
      branchCache.set(name, id);
      summary.masters.branchesCreated++;
    }
    return id;
  }

  const seen = [];
  for (const r of rows) {
    if (!r.employee_id || !r.branch) continue;
    const branchId = await ensureBranch(r.branch);

    const existing = (await client.query('select id, category_id from members where employee_id = $1', [r.employee_id])).rows[0];

    // Resolve category + expected rate. A missing/#N/A scale keeps the member's
    // existing category (so a transfer with a blanked scale isn't clobbered).
    const scaleValid = r.scale && !r.scale.includes('#');
    let catId;
    let expected;
    if (scaleValid) {
      const cat = await ensureCategory(r.scale);
      catId = cat.id;
      expected = cat.expected;
    } else if (existing && existing.category_id) {
      catId = existing.category_id;
      expected = await expectedForCatId(catId);
    } else {
      const cat = await ensureCategory('NA');
      catId = cat.id;
      expected = cat.expected;
    }

    // Upsert member by employee_id. Existing members are only mutated when this
    // is the latest month (a back-fill leaves the master roster as-is).
    let memberId;
    if (existing) {
      memberId = existing.id;
      if (isLatest) {
        await client.query(
          `update members set name=$1, sex=$2, mobile=coalesce($3, mobile), category_id=$4, branch_id=$5,
             active=true, left_on=null, joined_on = coalesce($6, joined_on) where id=$7`,
          [r.name, r.sex, r.mobile, catId, branchId, r.joined_on, memberId]
        );
        summary.employees.updated++;
      } else {
        summary.employees.unchanged++;
      }
    } else {
      const ins = await client.query(
        `insert into members (employee_id, name, sex, mobile, category_id, branch_id, active, joined_on)
         values ($1,$2,$3,$4,$5,$6,true,$7) returning id`,
        [r.employee_id, r.name, r.sex, r.mobile, catId, branchId, r.joined_on]
      );
      memberId = ins.rows[0].id;
      summary.employees.created++;
    }
    seen.push(r.employee_id);

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

    await client.query(
      `insert into contributions (period_id, member_id, branch_id, category_id, amount, received, flag, remarks, entry_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (period_id, member_id) do update set
         branch_id=excluded.branch_id, category_id=excluded.category_id, amount=excluded.amount,
         received=excluded.received, flag=excluded.flag, remarks=excluded.remarks`,
      [period.id, memberId, branchId, catId, r.amount, r.amount > 0, flag, remarks, periodStart]
    );

    summary.contributions.total++;
    if (r.amount > 0) summary.contributions.totalAmount += r.amount;
    if (flag === 'zero') summary.contributions.flaggedZero++;
    if (flag === 'differs') summary.contributions.flaggedDiffers++;
    if (flag) summary.flagged.push({ employee_id: r.employee_id, name: r.name, branch: r.branch, scale: r.scale, amount: r.amount, expected, flag });
  }

  // Mark employees in this district who are absent from the file as left —
  // only when importing the latest month (never on a back-fill).
  if (markLeft && isLatest) {
    const res = await client.query(
      `update members set active=false, left_on=$1
       where active=true and branch_id in (select id from branches where district_id=$2)
         and not (employee_id = any($3::text[]))`,
      [periodEnd, districtId, seen]
    );
    summary.employees.markedLeft = res.rowCount;
  }

  summary.periodId = period.id;
  return summary;
}

module.exports = { parseUnionCsv, parseUnionWorkbook, runIngest, expectedRate };
