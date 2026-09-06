import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useFetch } from '../hooks.js';
import { useAuth } from '../auth.jsx';
import { MONTHS, monthName, money, CURRENT_MONTH, CURRENT_YEAR } from './reports/shared.jsx';

export default function Monthly() {
  const { isAdmin } = useAuth();
  const { data, loading, error, reload } = useFetch('/api/periods');
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function generate() {
    if (!confirm(`Generate draft entries for ${monthName(month)} ${year}? This replaces any existing draft for that month.`))
      return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post('/api/periods/generate', { month, year });
      setMsg(`Generated ${r.generated} draft entries for ${monthName(month)} ${year}.`);
      reload();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function finalize(p) {
    if (!confirm(`Finalize ${monthName(p.month)} ${p.year}? Entries will be locked.`)) return;
    await api.post(`/api/periods/${p.id}/finalize`).then(reload).catch((e) => alert(e.message));
  }
  async function reopen(p) {
    if (!confirm(`Reopen ${monthName(p.month)} ${p.year} for editing?`)) return;
    await api.post(`/api/periods/${p.id}/reopen`).then(reload).catch((e) => alert(e.message));
  }
  async function remove(p) {
    if (!confirm(`Delete ${monthName(p.month)} ${p.year} entirely? This removes all ${p.member_count} contribution entries for that month. Members and branches are kept.`))
      return;
    await api.del(`/api/periods/${p.id}`).then(reload).catch((e) => alert(e.message));
  }

  return (
    <div>
      <div className="page-head">
        <h1>Monthly Entry &amp; Audit</h1>
      </div>

      {isAdmin && (
        <div className="panel">
          <strong>Generate a month</strong>
          <p className="muted" style={{ marginTop: 4 }}>
            Creates a draft contribution for every active member at their current rate. Review and edit
            it in the audit grid, then finalize.
          </p>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <div className="field">
              <label>Month</label>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((name, i) => (
                  <option key={i + 1} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Year</label>
              <input type="number" value={year} style={{ width: 100 }} onChange={(e) => setYear(Number(e.target.value))} />
            </div>
            <button className="btn primary" onClick={generate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate draft'}
            </button>
          </div>
          {msg && <div className="muted">{msg}</div>}
        </div>
      )}

      {loading && <div className="spinner">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th className="num">Members</th>
                <th className="num">Collected</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/monthly/${p.id}`}>
                      {monthName(p.month)} {p.year}
                    </Link>
                  </td>
                  <td>
                    <span className={`badge ${p.status}`}>{p.status}</span>
                  </td>
                  <td className="num">{p.member_count}</td>
                  <td className="num">{money(p.total_received)}</td>
                  <td className="right">
                    <Link className="btn btn-sm" to={`/monthly/${p.id}`}>
                      Open
                    </Link>{' '}
                    {isAdmin && p.status === 'draft' && (
                      <button className="btn btn-sm primary" onClick={() => finalize(p)}>
                        Finalize
                      </button>
                    )}
                    {isAdmin && p.status === 'final' && (
                      <button className="btn btn-sm" onClick={() => reopen(p)}>
                        Reopen
                      </button>
                    )}{' '}
                    {isAdmin && p.status === 'draft' && (
                      <button className="btn btn-sm danger" onClick={() => remove(p)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(data || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No months generated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
