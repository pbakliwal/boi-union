import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useFetch } from '../hooks.js';
import { MONTHS, monthName, money, CURRENT_YEAR } from './reports/shared.jsx';

const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

// Guess month/year from a filename like UNION_APR26.csv
function inferPeriod(name) {
  const m = /([A-Za-z]{3})[ _-]?(\d{2})/.exec(name || '');
  if (m && MON[m[1].toUpperCase()]) return { month: MON[m[1].toUpperCase()], year: 2000 + Number(m[2]) };
  return {};
}

// Read a File as a base64 string (no data:...;base64, prefix).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export default function Import() {
  const { isAdmin } = useAuth();
  const [csv, setCsv] = useState(null);
  const [xlsx, setXlsx] = useState(null);
  const [filename, setFilename] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [preview, setPreview] = useState(null);
  const [applied, setApplied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!isAdmin) return <div className="empty">Admins only.</div>;

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPreview(null);
    setApplied(null);
    setError(null);
    if (/\.xlsx?$/i.test(f.name)) {
      setXlsx(await fileToBase64(f));
      setCsv(null);
    } else {
      setCsv(await f.text());
      setXlsx(null);
    }
    setFilename(f.name);
    const g = inferPeriod(f.name);
    if (g.month) setMonth(g.month);
    if (g.year) setYear(g.year);
  }

  async function run(commit) {
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const body = xlsx ? { month, year, xlsx, commit } : { month, year, csv, commit };
      const res = await api.post('/api/ingest', body);
      if (commit) {
        setApplied(res);
        setPreview(null);
      } else {
        setPreview(res);
      }
    } catch (e) {
      setError(commit
        ? `${e.message} Retry Apply import with the same file and month. Failed transactions leave no partial data; completed imports are detected automatically.`
        : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Import salary register</h1>
      </div>
      <p className="muted">
        Upload the bank's monthly deduction file — a CSV export or the original Excel workbook. It
        updates branches, categories and employees, then builds that month's <strong>draft</strong> —
        flagging any zero or off-rate amount for review. Employees in Indore missing from the file
        are marked <em>left</em>.
      </p>

      <div className="panel">
        <div className="toolbar">
          <div className="field">
            <label>CSV or Excel file</label>
            <input
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              disabled={busy}
              onChange={onFile}
            />
          </div>
          <div className="field">
            <label>Month</label>
            <select disabled={busy} value={month} onChange={(e) => { setMonth(Number(e.target.value)); setPreview(null); setApplied(null); }}>
              {MONTHS.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Year</label>
            <input type="number" disabled={busy} value={year} style={{ width: 100 }} onChange={(e) => { setYear(Number(e.target.value)); setPreview(null); setApplied(null); }} />
          </div>
          <button className="btn" disabled={(!csv && !xlsx) || busy} onClick={() => run(false)}>
            {busy ? 'Working…' : 'Preview'}
          </button>
        </div>
        {filename && <div className="muted">{filename} — importing into {monthName(month)} {year}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      {applied && (
        <div className="panel" style={{ borderColor: 'var(--ok)' }}>
          <strong style={{ color: 'var(--ok)' }}>{applied.alreadyApplied ? 'Already imported — no data changed' : 'Import applied ✓'}</strong>
          <div className="muted">Import summary (before manual edits)</div>
          <Summary s={applied} />
          <Link className="btn primary" to={`/monthly/${applied.periodId}`}>Open the {monthName(applied.month)} {applied.year} draft →</Link>
          {applied.flagged?.length > 0 && <AppliedFlagged summary={applied} />}
        </div>
      )}

      {preview && (
        <div className="panel">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <strong>{preview.alreadyApplied ? 'This file is already imported' : 'Preview (nothing saved yet)'}</strong>
            <button className="btn primary" disabled={busy} onClick={() => run(true)}>
              {busy ? 'Applying…' : preview.alreadyApplied ? 'Open import result' : 'Apply import'}
            </button>
          </div>
          <Summary s={preview} />
          {preview.flagged?.length > 0 && (
            <>
              <h4 style={{ margin: '14px 0 6px' }}>Flagged amounts ({preview.flagged.length})</h4>
              <div className="table-wrap" style={{ maxHeight: 320 }}>
                <table className="data">
                  <thead>
                    <tr><th>Emp ID</th><th>Name</th><th>Branch</th><th>Scale</th><th className="num">Amount</th><th className="num">Expected</th><th>Flag</th></tr>
                  </thead>
                  <tbody>
                    {preview.flagged.map((r) => (
                      <tr key={r.employee_id} className="flag-row">
                        <td>{r.employee_id}</td>
                        <td>{r.name}</td>
                        <td>{r.branch}</td>
                        <td>{r.scale}</td>
                        <td className="num">{money(r.amount)}</td>
                        <td className="num">{r.expected == null ? '—' : money(r.expected)}</td>
                        <td><span className={`badge ${r.flag === 'zero' ? 'no' : 'oos'}`}>{r.flag}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AppliedFlagged({ summary }) {
  const contributions = useFetch(`/api/periods/${summary.periodId}/contributions`);
  const rows = contributions.data?.filter((r) => r.flag) || [];

  async function save(rowId, patch) {
    try {
      const updated = await api.put(`/api/contributions/${rowId}`, patch);
      contributions.setData((current) => current.map((r) => r.id === rowId ? { ...r, ...updated } : r));
    } catch (e) {
      contributions.reload();
      throw e;
    }
  }

  return (
    <>
      <h4 style={{ margin: '14px 0 6px' }}>Edit flagged amounts ({rows.length})</h4>
      <p className="muted">
        Save each correction below. Check Received if a previously missing deduction has now
        been collected, so it counts in reports. Flags and import remarks remain as a record
        of the original file; you can edit remarks in the draft.
      </p>
      {contributions.loading && <div className="muted">Loading flagged amounts…</div>}
      {contributions.error && <div className="error" role="alert">{contributions.error}</div>}
      <button className="btn btn-sm" disabled={contributions.loading} onClick={contributions.reload}>Refresh entries</button>
      {!contributions.loading && !contributions.error && (
        <div className="table-wrap" style={{ maxHeight: 400, marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr><th>Emp ID</th><th>Name</th><th>Branch</th><th>Scale</th><th className="num">Amount</th><th className="num">Expected</th><th>Flag</th><th>Received</th><th>Action</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FlaggedEditor
                  key={row.id}
                  row={row}
                  expected={summary.flagged.find((r) => r.employee_id === row.employee_id)?.expected}
                  onSave={save}
                />
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="empty">No flagged entries.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FlaggedEditor({ row, expected, onSave }) {
  const [amount, setAmount] = useState(row.amount);
  const [received, setReceived] = useState(row.received);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const editable = row.period_status === 'draft';
  const changed = String(amount).trim() === '' || Number(amount) !== Number(row.amount) || received !== row.received;

  useEffect(() => {
    setAmount(row.amount);
    setReceived(row.received);
  }, [row.amount, row.received]);

  async function save() {
    setError(null);
    setSaved(false);
    if (!/^\d+(\.\d{1,2})?$/.test(String(amount)) || !Number.isFinite(Number(amount))) {
      setError('Enter a non-negative amount with at most two decimal places.');
      return;
    }
    setBusy(true);
    try {
      await onSave(row.id, { amount: Number(amount), received });
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="flag-row">
      <td>{row.employee_id}</td>
      <td>{row.name} {row.surname}</td>
      <td>{row.branch_name}</td>
      <td>{row.category_code}</td>
      <td className="num">
        {editable ? (
          <input
            className="inline-input"
            type="number"
            min="0"
            step="0.01"
            aria-label={`Amount for ${row.employee_id}`}
            value={amount}
            disabled={busy}
            onChange={(e) => { setAmount(e.target.value); setSaved(false); setError(null); }}
          />
        ) : money(row.amount)}
      </td>
      <td className="num">{expected == null ? '—' : money(expected)}</td>
      <td><span className={`badge ${row.flag === 'zero' ? 'no' : 'oos'}`}>{row.flag}</span></td>
      <td>
        <input
          type="checkbox"
          aria-label={`Received for ${row.employee_id}`}
          checked={received}
          disabled={!editable || busy}
          onChange={(e) => { setReceived(e.target.checked); setSaved(false); setError(null); }}
        />
      </td>
      <td>
        {editable ? <button className="btn btn-sm" disabled={busy || !changed} onClick={save}>{busy ? 'Saving…' : 'Save'}</button> : <span className="muted">Finalized — reopen the draft to edit.</span>}
        {saved && <span role="status" style={{ color: 'var(--ok)', marginLeft: 6 }}>Saved</span>}
        {error && <div className="error" role="alert">{error}</div>}
      </td>
    </tr>
  );
}

function Summary({ s }) {
  const stat = (label, value, color) => (
    <div>
      <div className="muted">{label}</div>
      <strong style={{ fontSize: 18, color: color || 'inherit' }}>{value}</strong>
    </div>
  );
  return (
    <>
      {s.alreadyApplied && (
        <p className="muted">
          Showing the saved receipt for this file. No records were rewritten and manual corrections
          were preserved. A changed file replaces the draft; Generate or Delete clears this receipt.
        </p>
      )}
      {s.isLatest === false && (
        <div className="muted" style={{ margin: '6px 0' }}>
          ↩ Older month than the latest on record — master roster is left untouched; only this
          month's contributions are written.
        </div>
      )}
      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', margin: '10px 0' }}>
        {stat('Employees new', s.employees.created, 'var(--ok)')}
        {stat('Updated', s.employees.updated)}
        {stat('Unchanged', s.employees.unchanged)}
        {stat('Marked left', s.employees.markedLeft, s.employees.markedLeft ? 'var(--danger)' : undefined)}
        {stat('New branches', s.masters.branchesCreated)}
        {stat('New categories', s.masters.categoriesCreated)}
        {stat('Contributions', s.contributions.total)}
        {stat('Total amount', money(s.contributions.totalAmount))}
        {stat('Flagged (zero)', s.contributions.flaggedZero, s.contributions.flaggedZero ? '#b9770e' : undefined)}
        {stat('Flagged (differs)', s.contributions.flaggedDiffers, s.contributions.flaggedDiffers ? '#b9770e' : undefined)}
      </div>
    </>
  );
}
