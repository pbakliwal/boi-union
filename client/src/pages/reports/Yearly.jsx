import { Fragment, useState } from 'react';
import { useFetch } from '../../hooks.js';
import { MONTHS, money, downloadCsv, BasisSelect, fyLabel, CURRENT_YEAR, CURRENT_FY_YEAR } from './shared.jsx';

const shortMonth = (m) => MONTHS[m - 1].slice(0, 3);

export default function Yearly() {
  const [basis, setBasis] = useState('calendar');
  const [year, setYear] = useState(CURRENT_YEAR);
  const { data, loading, error } = useFetch(`/api/reports/yearly?year=${year}&basis=${basis}`);

  function onBasisChange(next) {
    setBasis(next);
    setYear(next === 'fy' ? CURRENT_FY_YEAR : CURRENT_YEAR);
  }

  const columns = data?.columns || [];
  // For calendar basis every column shares one year — plain month names read
  // fine. For FY, the Dec→Jan boundary crosses two calendar years, so each
  // column also shows its year.
  const columnLabel = (c) => (basis === 'fy' ? `${shortMonth(c.month)} '${String(c.year).slice(-2)}` : shortMonth(c.month));
  const colSpan = columns.length + 4; // Emp ID, Member, Cat, Total

  function exportCsv() {
    const header = ['Zone', 'District', 'Branch', 'Emp ID', 'Member', 'Cat', ...columns.map(columnLabel), 'Total'];
    const rows = [header];
    data.members.forEach((m) => {
      rows.push([
        m.zone_name, m.district_name, m.branch_name, m.employee_id,
        `${m.name} ${m.surname || ''}`.trim(), m.category_code,
        ...columns.map((c) => m.months[c.month] || 0), m.total,
      ]);
    });
    downloadCsv(`yearly_${basis === 'fy' ? fyLabel(year).replace(' ', '_') : year}.csv`, rows);
  }

  let lastGroup = null;

  return (
    <div>
      <div className="page-head">
        <h1>Yearly Members List</h1>
        {data && <button className="btn" onClick={exportCsv}>Export CSV</button>}
      </div>
      <p className="muted">
        Each member's monthly contribution across {basis === 'fy' ? fyLabel(year) : year}, grouped
        Zone → District → Branch.
      </p>

      <div className="toolbar">
        <BasisSelect basis={basis} onChange={onBasisChange} />
        <div className="field">
          <label>{basis === 'fy' ? 'FY start year' : 'Year'}</label>
          <input type="number" value={year} style={{ width: 100 }} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        {basis === 'fy' && <span className="muted" style={{ alignSelf: 'center' }}>{fyLabel(year)} = Apr {year} – Mar {year + 1}</span>}
      </div>

      {loading && <div className="spinner">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Emp ID</th>
                <th>Member</th>
                <th>Cat</th>
                {columns.map((c) => (
                  <th key={`${c.year}-${c.month}`} className="num">{columnLabel(c)}</th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.members.length === 0 && (
                <tr><td colSpan={colSpan} className="empty">No contributions recorded for {basis === 'fy' ? fyLabel(year) : year}.</td></tr>
              )}
              {data.members.map((m) => {
                const group = `${m.zone_name} ▸ ${m.district_name} ▸ ${m.branch_code} ${m.branch_name}`;
                const showGroup = group !== lastGroup;
                lastGroup = group;
                return (
                  <Fragment key={m.member_id}>
                    {showGroup && (
                      <tr className="group-row">
                        <td colSpan={colSpan}>{group}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="muted">{m.employee_id}</td>
                      <td>{m.name} {m.surname}</td>
                      <td>{m.category_code}</td>
                      {columns.map((c) => (
                        <td key={`${c.year}-${c.month}`} className="num">{m.months[c.month] ? money(m.months[c.month]) : ''}</td>
                      ))}
                      <td className="num"><strong>{money(m.total)}</strong></td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
