import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
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
      setError(e.message);
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
              onChange={onFile}
            />
          </div>
          <div className="field">
            <label>Month</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Year</label>
            <input type="number" value={year} style={{ width: 100 }} onChange={(e) => setYear(Number(e.target.value))} />
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
          <strong style={{ color: 'var(--ok)' }}>Import applied ✓</strong>
          <Summary s={applied} />
          <Link className="btn primary" to={`/monthly/${applied.periodId}`}>Open the {monthName(applied.month)} {applied.year} draft →</Link>
        </div>
      )}

      {preview && (
        <div className="panel">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <strong>Preview (nothing saved yet)</strong>
            <button className="btn primary" disabled={busy} onClick={() => run(true)}>
              {busy ? 'Applying…' : 'Apply import'}
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

function Summary({ s }) {
  const stat = (label, value, color) => (
    <div>
      <div className="muted">{label}</div>
      <strong style={{ fontSize: 18, color: color || 'inherit' }}>{value}</strong>
    </div>
  );
  return (
    <>
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
