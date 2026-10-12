'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const XLSX = require('xlsx');
const { runIngest, parseUnionCsv, parseUnionWorkbook } = require('./ingestCore');

function makeRows(count = 500) {
  return Array.from({ length: count }, (_, i) => ({
    employee_id: String(100000 + i),
    name: `Member ${i}`,
    sex: i % 2 ? 'F' : 'M',
    branch: `Branch ${i % 87}`,
    scale: ['CK1', 'CK2', 'SS1', 'SS2'][i % 4],
    joined_on: '2020-01-01',
    mobile: `90000${String(i).padStart(5, '0')}`,
    amount: i % 10 === 0 ? 0 : i % 11 === 0 ? 80 : i % 4 < 2 ? 100 : 50,
    union: 'INDORE ZONE 1',
  }));
}

test('rejects duplicate IDs and invalid input before any writes', async () => {
  const client = { query() { throw new Error('Validation must precede SQL'); } };
  const rows = makeRows(2);
  await assert.rejects(runIngest(client, {
    month: 5, year: 2026, rows: [rows[0], rows[0]],
  }), /Duplicate Employee ID 100000/);
  await assert.rejects(runIngest(client, { month: 5, year: 2026, rows: [] }), /No employee rows/);
  await assert.rejects(runIngest(client, {
    month: 5, year: 2026, rows: [{ ...rows[0], branch: '' }],
  }), /has no ID or branch/);
  await assert.rejects(runIngest(client, {
    month: 5, year: 2026, rows: [{ ...rows[0], amount: Infinity }],
  }), /Invalid deduction amount/);
  await assert.rejects(runIngest(client, { month: 13, year: 2026, rows }), /out of range/);
});

test('CSV and Excel retain the same normalized import shape', () => {
  const cells = [
    ['EMPLOYEE ID', 'NAME', 'BRANCH', 'SCALE', 'INDORE ZONE 1'],
    ['100000', 'Member Zero', 'Branch 0', 'CK1', 0],
    ['100001', 'Member One', 'Branch 1', 'SS1', 50],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(cells), 'Register');
  const excel = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const csv = cells.map((r) => r.join(',')).join('\n');
  assert.deepEqual(parseUnionWorkbook(excel), parseUnionCsv(csv));
});

test('CSV and Excel find a complete header within the first five rows', async (context) => {
  const data = [
    ['S.NO', 'EMP ID', 'EMP NAME', 'LOCATION', 'GRADE', 'UNION CODE-INDORE ZONE 1'],
    [1, '100000', 'Member Zero', 'Branch 0', 'CK1', 0],
    [2, '100001', 'Member One', 'Branch 1', 'SS1', 50],
  ];
  const expected = parseUnionCsv(data.map((row) => row.join(',')).join('\n'));
  const preamble = [
    ['Salary register deductions'],
    ['SN', 'Reference only'],
    [],
    ['EMPLOYEE ID', 'Register heading'],
  ];
  for (let headerRow = 1; headerRow <= 5; headerRow++) {
    await context.test(`header on row ${headerRow}`, () => {
      const cells = [...preamble.slice(0, headerRow - 1), ...data];
      const csv = cells.map((row) => row.join(',')).join('\n');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(cells), 'Register');
      const excel = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      assert.deepEqual(parseUnionCsv(csv), expected);
      assert.deepEqual(parseUnionWorkbook(excel), expected);
    });
  }
});

test('CSV and Excel report header errors only after checking the first five rows', () => {
  const cases = [
    {
      cells: [
        ...Array.from({ length: 5 }, () => ['Salary register heading']),
        ['EMPLOYEE ID', 'NAME', 'BRANCH', 'SCALE', 'INDORE ZONE 1'],
        ['100000', 'Member Zero', 'Branch 0', 'CK1', 100],
      ],
      message: /first 5 rows/,
    },
    {
      cells: [
        ...Array.from({ length: 5 }, () => []),
        ['EMPLOYEE ID', 'NAME', 'BRANCH', 'SCALE', 'INDORE ZONE 1'],
        ['100000', 'Member Zero', 'Branch 0', 'CK1', 100],
      ],
      message: /first 5 rows/,
    },
    {
      cells: [['Salary register'], ['SN', 'NAME', 'BRANCH', 'SCALE', 'INDORE ZONE 1']],
      message: /Header is missing required columns/,
    },
    {
      cells: [['Salary register'], ['EMPLOYEE ID', 'NAME', 'BRANCH', 'SCALE']],
      message: /No union\/deduction columns/,
    },
  ];
  for (const { cells, message } of cases) {
    const csv = cells.map((row) => row.join(',')).join('\n');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(cells), 'Register');
    const excel = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const matches = (error) => error.status === 400 && message.test(error.message);
    assert.throws(() => parseUnionCsv(csv), matches);
    assert.throws(() => parseUnionWorkbook(excel), matches);
  }
});

test('bulk import PostgreSQL integration', {
  skip: !process.env.INGEST_TEST_DATABASE_URL,
}, async (t) => {
  const schema = `ingest_test_${randomUUID().replaceAll('-', '')}`;
  const connectionString = process.env.INGEST_TEST_DATABASE_URL;
  const client = new Client({ connectionString });
  await client.connect();
  const rows = makeRows();
  let queries = 0;
  const counted = {
    async query(sql, params) {
      queries++;
      return client.query(sql, params);
    },
  };
  async function transaction(action, db = client) {
    await db.query('BEGIN');
    try {
      const result = await action();
      await db.query('COMMIT');
      return result;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }
  async function count(table) {
    return Number((await client.query(`select count(*) as n from "${table}"`)).rows[0].n);
  }
  try {
    await client.query(`create schema "${schema}"`);
    await client.query(`set search_path to "${schema}"`);
    for (const file of fs.readdirSync(path.join(__dirname, 'migrations')).sort()) {
      if (!file.endsWith('.sql')) continue;
      let sql = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
      // The legacy migration checks constraint names globally; scope its fixture
      // check so a populated application schema cannot mask this test constraint.
      sql = sql.replace(
        "conname = 'members_employee_id_key'",
        "conname = 'members_employee_id_key' and connamespace = current_schema()::regnamespace"
      );
      await client.query(sql);
    }

    let imported;
    await t.test('500 members use at most 24 queries with correct flags and totals', async () => {
      const start = performance.now();
      imported = await transaction(() => runIngest(counted, { month: 5, year: 2026, rows }));
      assert.ok(queries <= 24, `Expected <=24 queries, got ${queries}`);
      assert.equal(imported.employees.created, 500);
      assert.equal(imported.masters.branchesCreated, 87);
      assert.equal(imported.masters.categoriesCreated, 4);
      assert.equal(imported.contributions.totalAmount, rows.reduce((s, r) => s + r.amount, 0));
      assert.equal(imported.contributions.flaggedZero, 50);
      assert.equal(imported.flagged.length, rows.filter((r) => r.amount === 0 ||
        r.amount !== (r.scale.startsWith('CK') ? 100 : 50)).length);
      assert.equal(await count('members'), 500);
      assert.equal(await count('contributions'), 500);
      t.diagnostic(`500 members, 87 branches: ${queries} queries, ${(performance.now() - start).toFixed(1)} ms (test database)`);
    });

    await t.test('response-loss retry after commit preserves manual corrections and IDs', async () => {
      const before = (await client.query('select id from contributions order by id')).rows;
      await client.query(
        `update contributions set amount=125.50, received=true, remarks='Manually corrected'
         where member_id=(select id from members where employee_id=$1)`,
        [rows[0].employee_id]
      );
      queries = 0;
      const retry = await transaction(() => runIngest(counted, { month: 5, year: 2026, rows }));
      assert.deepEqual(retry, { ...imported, alreadyApplied: true });
      assert.equal(queries, 3);
      assert.equal(await count('members'), 500);
      assert.deepEqual((await client.query('select id from contributions order by id')).rows, before);
      const corrected = (await client.query(
        'select amount, received, remarks from contributions where remarks=$1', ['Manually corrected']
      )).rows[0];
      assert.equal(corrected.amount, '125.50');
      assert.equal(corrected.received, true);
    });

    await t.test('failure after deletion rolls back old draft, new masters and receipt', async () => {
      const changed = [{ ...rows[0], branch: 'New Branch', scale: 'CK9', amount: 45 }];
      const failing = {
        query(sql, params) {
          if (sql.startsWith('insert into contributions')) throw new Error('Injected mid-import failure');
          return client.query(sql, params);
        },
      };
      await assert.rejects(transaction(() => runIngest(failing, {
        month: 5, year: 2026, rows: changed,
      })), /Injected mid-import failure/);
      assert.equal(await count('contributions'), 500);
      assert.equal(await count('branches'), 87);
      assert.equal(await count('categories'), 4);
      assert.equal((await client.query('select amount from contributions where remarks=$1', ['Manually corrected'])).rows[0].amount, '125.50');
      const retry = await transaction(() => runIngest(client, { month: 5, year: 2026, rows }));
      assert.equal(retry.alreadyApplied, true);
    });

    await t.test('fresh failed month leaves nothing and can be retried in full', async () => {
      const failing = {
        query(sql, params) {
          if (sql.startsWith('update periods set import_hash')) throw new Error('Failure before receipt');
          return client.query(sql, params);
        },
      };
      await assert.rejects(transaction(() => runIngest(failing, {
        month: 6, year: 2026, rows,
      })), /Failure before receipt/);
      assert.equal(await count('periods'), 1);
      assert.equal(await count('contributions'), 500);
      const retry = await transaction(() => runIngest(client, { month: 6, year: 2026, rows }));
      assert.equal(retry.alreadyApplied, undefined);
      assert.equal(await count('members'), 500);
      assert.equal(await count('contributions'), 1000);
    });

    await t.test('changed file replaces draft, missing scale retains category, backfill preserves roster', async () => {
      const changed = [{ ...rows[0], name: 'Transferred', branch: 'New Branch', scale: '#N/A', mobile: null, joined_on: null, amount: 100 }];
      const result = await transaction(() => runIngest(client, { month: 6, year: 2026, rows: changed }));
      assert.equal(result.employees.markedLeft, 499);
      assert.equal(result.contributions.flaggedDiffers, 0);
      const member = (await client.query(
        `select m.name, m.mobile, m.joined_on::text, cat.code, b.name as branch
         from members m join categories cat on cat.id=m.category_id
         join branches b on b.id=m.branch_id where m.employee_id=$1`,
        [rows[0].employee_id]
      )).rows[0];
      assert.equal(member.name, 'Transferred');
      assert.equal(member.code, 'CK1');
      assert.equal(member.mobile, rows[0].mobile);
      assert.equal(member.joined_on, '2020-01-01');
      assert.equal(member.branch, 'New Branch');
      const backfill = await transaction(() => runIngest(client, { month: 4, year: 2026, rows }));
      assert.equal(backfill.isLatest, false);
      assert.equal(backfill.employees.unchanged, 500);
      assert.equal((await client.query('select name from members where employee_id=$1', [rows[0].employee_id])).rows[0].name, 'Transferred');
      assert.equal((await client.query('select count(*)::int as n from members where active')).rows[0].n, 1);
      assert.equal((await client.query('select distinct left_on::text from members where not active')).rows[0].left_on, '2026-06-30');
    });

    await t.test('concurrent same-file imports serialize and second returns receipt', async () => {
      const second = new Client({ connectionString });
      await second.connect();
      try {
        await second.query(`set search_path to "${schema}"`);
        const results = await Promise.all([
          transaction(() => runIngest(client, { month: 7, year: 2026, rows })),
          transaction(() => runIngest(second, { month: 7, year: 2026, rows }), second),
        ]);
        assert.equal(results.filter((r) => r.alreadyApplied).length, 1);
        assert.equal((await client.query('select count(*)::int as n from periods where month=7')).rows[0].n, 1);
        assert.equal(await count('members'), 500);
      } finally {
        await second.end();
      }
    });

    await t.test('final month accepts harmless retry but rejects changed file', async () => {
      await client.query("update periods set status='final' where month=7");
      assert.equal((await transaction(() => runIngest(client, { month: 7, year: 2026, rows }))).alreadyApplied, true);
      await assert.rejects(transaction(() => runIngest(client, {
        month: 7, year: 2026, rows: [{ ...rows[0], amount: 99 }],
      })), /finalized/);
      await client.query("update periods set status='draft', import_hash=null, import_summary=null where month=7");
      const fresh = await transaction(() => runIngest(client, { month: 7, year: 2026, rows }));
      assert.equal(fresh.alreadyApplied, undefined);
    });

    await t.test('preview rollback stores no receipt or partial month', async () => {
      await client.query('BEGIN');
      try {
        await runIngest(client, { month: 8, year: 2026, rows });
      } finally {
        await client.query('ROLLBACK');
      }
      assert.equal((await client.query('select count(*)::int as n from periods where month=8')).rows[0].n, 0);
    });

    await t.test('disconnect before commit rolls back and a new connection can safely retry', async () => {
      const interrupted = new Client({ connectionString });
      await interrupted.connect();
      try {
        await interrupted.query(`set search_path to "${schema}"`);
        await interrupted.query('BEGIN');
        await runIngest(interrupted, { month: 9, year: 2026, rows });
      } finally {
        // PostgreSQL aborts the transaction when the connection ends without COMMIT.
        await interrupted.end();
      }
      assert.equal((await client.query('select count(*)::int as n from periods where month=9')).rows[0].n, 0);
      const fresh = new Client({ connectionString });
      await fresh.connect();
      try {
        await fresh.query(`set search_path to "${schema}"`);
        const first = await transaction(() => runIngest(fresh, { month: 9, year: 2026, rows }), fresh);
        assert.equal(first.employees.created, 0);
        assert.equal(first.alreadyApplied, undefined);
      } finally {
        await fresh.end();
      }
      const retry = await transaction(() => runIngest(client, { month: 9, year: 2026, rows }));
      assert.equal(retry.alreadyApplied, true);
      assert.equal(await count('members'), 500);
    });
  } finally {
    await client.query(`drop schema if exists "${schema}" cascade`);
    await client.end();
  }
});
