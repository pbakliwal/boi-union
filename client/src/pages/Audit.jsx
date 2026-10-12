import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useFetch } from '../hooks.js';
import { useAuth } from '../auth.jsx';
import { monthName, money } from './reports/shared.jsx';

export default function Audit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const period = useFetch(`/api/periods/${id}`);
  const contrib = useFetch(`/api/periods/${id}/contributions`);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  useEffect(() => {
    if (contrib.data) setRows(contrib.data);
  }, [contrib.data]);

  const p = period.data;
  const editable = isAdmin && p?.status === 'draft';

  async function saveRow(rowId, patch) {
    try {
      const updated = await api.put(`/api/contributions/${rowId}`, patch);
      setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...updated } : r)));
    } catch (e) {
      alert(e.message);
      contrib.reload();
    }
  }

  async function finalize() {
    if (!confirm('Finalize this month? Entries will be locked.')) return;
    await api.post(`/api/periods/${id}/finalize`).then(() => period.reload()).catch((e) => alert(e.message));
  }
  async function reopen() {
    if (!confirm('Reopen this month for editing?')) return;
    await api.post(`/api/periods/${id}/reopen`).then(() => period.reload()).catch((e) => alert(e.message));
  }
  async function remove() {
    const label = p ? `${monthName(p.month)} ${p.year}` : 'this month';
    if (!confirm(`Delete ${label} entirely? This removes all its contribution entries. Members and branches are kept.`)) return;
    await api.del(`/api/periods/${id}`).then(() => navigate('/monthly')).catch((e) => alert(e.message));
  }

  const filtered = useMemo(() => {
    let list = flaggedOnly ? rows.filter((r) => r.flag) : rows;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.employee_id, r.name, r.surname, r.branch_name, r.district_name, r.zone_name]
          .some((v) => String(v ?? '').toLowerCase().includes(q))
      );
    }
    return list;
  }, [rows, search, flaggedOnly]);

  const collected = rows.reduce((s, r) => s + (r.received ? Number(r.amount) : 0), 0);
  const notReceived = rows.filter((r) => !r.received).length;
  const hasOos = rows.some((r) => r.is_out_of_state);
  const flaggedCount = rows.filter((r) => r.flag).length;

  if (period.loading) return <div className="spinner">Loading…</div>;
  if (period.error) return <div className="error">{period.error}</div>;

  let lastGroup = null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>
            {p && `${monthName(p.month)} ${p.year}`}{' '}
            <span className={`badge ${p?.status}`}>{p?.status}</span>
          </h1>
          <Link to="/monthly" className="muted">
            ← Back to months
          </Link>
        </div>
        <div className="page-actions">
          {isAdmin && p?.status === 'draft' && (
            <button className="btn primary" onClick={finalize}>
              Finalize month
            </button>
          )}
          {isAdmin && p?.status === 'final' && (
            <button className="btn" onClick={reopen}>
              Reopen
            </button>
          )}
          {isAdmin && p?.status === 'draft' && (
            <button className="btn danger" onClick={remove}>
              Delete month
            </button>
          )}
        </div>
      </div>

      <div className="panel audit-summary">
        <div>
          <div className="muted">Members</div>
          <strong style={{ fontSize: 18 }}>{rows.length}</strong>
        </div>
        <div>
          <div className="muted">Collected</div>
          <strong style={{ fontSize: 18 }}>{money(collected)}</strong>
        </div>
        <div>
          <div className="muted">Not received</div>
          <strong style={{ fontSize: 18, color: notReceived ? 'var(--danger)' : 'inherit' }}>{notReceived}</strong>
        </div>
        <div>
          <div className="muted">Flagged</div>
          <strong style={{ fontSize: 18, color: flaggedCount ? '#b9770e' : 'inherit' }}>{flaggedCount}</strong>
        </div>
      </div>

      <div className="toolbar">
        <div className="field" style={{ minWidth: 280 }}>
          <input type="text" placeholder="Search emp ID / member / branch…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {flaggedCount > 0 && (
          <label className="field check" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            <span>Flagged only ({flaggedCount})</span>
          </label>
        )}
        {hasOos && (
          <span className="muted">⚑ = transferred from another state — review their amount.</span>
        )}
        {!editable && p?.status === 'final' && (
          <span className="muted">This month is finalized — reopen it to make changes.</span>
        )}
        {!editable && !isAdmin && <span className="muted">Read-only (report viewer).</span>}
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Member</th>
              <th>Cat</th>
              <th className="num">Amount</th>
              <th>Received</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const group = `${r.zone_name} ▸ ${r.district_name} ▸ ${r.branch_name}`;
              const showGroup = group !== lastGroup;
              lastGroup = group;
              return (
                <Row
                  key={r.id}
                  row={r}
                  group={showGroup ? group : null}
                  editable={editable}
                  onSave={saveRow}
                />
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row, group, editable, onSave }) {
  const [amount, setAmount] = useState(row.amount);
  const [remarks, setRemarks] = useState(row.remarks || '');

  useEffect(() => {
    setAmount(row.amount);
    setRemarks(row.remarks || '');
  }, [row.amount, row.remarks]);

  return (
    <>
      {group && (
        <tr className="group-row">
          <td colSpan={5}>{group}</td>
        </tr>
      )}
      <tr className={row.flag ? 'flag-row' : row.is_out_of_state ? 'oos-row' : ''}>
        <td>
          <span className="muted">{row.employee_id}</span> {row.name} {row.surname}{' '}
          <span className="muted">· {row.sex}</span>
          {row.flag && (
            <span
              className={`badge ${row.flag === 'zero' ? 'no' : 'oos'}`}
              title={row.remarks || ''}
            >
              {' '}⚠ {row.flag === 'zero' ? 'no deduction' : 'amount differs'}
            </span>
          )}
          {row.is_out_of_state && (
            <span
              className="badge oos"
              title={row.home_state ? `Out-of-state: ${row.home_state}` : 'Out-of-state'}
            >
              {' '}⚑ {row.home_state || 'Out-of-state'}
            </span>
          )}
        </td>
        <td>{row.category_code}</td>
        <td className="num">
          {editable ? (
            <input
              className="inline-input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => {
                if (String(amount) !== String(row.amount)) onSave(row.id, { amount });
              }}
            />
          ) : (
            money(row.amount)
          )}
        </td>
        <td>
          {editable ? (
            <input
              type="checkbox"
              checked={row.received}
              onChange={(e) => onSave(row.id, { received: e.target.checked })}
            />
          ) : row.received ? (
            <span className="badge yes">Yes</span>
          ) : (
            <span className="badge no">No</span>
          )}
        </td>
        <td>
          {editable ? (
            <input
              className="inline-text"
              type="text"
              value={remarks}
              placeholder={row.received ? '' : 'reason…'}
              onChange={(e) => setRemarks(e.target.value)}
              onBlur={() => {
                if (remarks !== (row.remarks || '')) onSave(row.id, { remarks });
              }}
            />
          ) : (
            row.remarks
          )}
        </td>
      </tr>
    </>
  );
}
