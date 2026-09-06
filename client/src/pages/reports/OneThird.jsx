import { useState } from 'react';
import { useFetch } from '../../hooks.js';
import { monthName, money, downloadCsv, BasisSelect, CURRENT_YEAR, CURRENT_FY_YEAR } from './shared.jsx';

// Every quarter — calendar or financial-year — sits entirely inside one
// calendar year, so no backend change is needed: only *which* calendar year
// a quarter resolves to differs (FY Q4, Jan–Mar, belongs to `year + 1`).
const CALENDAR_QUARTERS = {
  'Q1 (Jan–Mar)': { months: [1, 2, 3], yearOffset: 0 },
  'Q2 (Apr–Jun)': { months: [4, 5, 6], yearOffset: 0 },
  'Q3 (Jul–Sep)': { months: [7, 8, 9], yearOffset: 0 },
  'Q4 (Oct–Dec)': { months: [10, 11, 12], yearOffset: 0 },
};
const FY_QUARTERS = {
  'Q1 (Apr–Jun)': { months: [4, 5, 6], yearOffset: 0 },
  'Q2 (Jul–Sep)': { months: [7, 8, 9], yearOffset: 0 },
  'Q3 (Oct–Dec)': { months: [10, 11, 12], yearOffset: 0 },
  'Q4 (Jan–Mar)': { months: [1, 2, 3], yearOffset: 1 },
};
const QUARTERS_BY_BASIS = { calendar: CALENDAR_QUARTERS, fy: FY_QUARTERS };

// Preserve the same default 3-month window (Oct–Dec) across both bases.
function defaultQuarterKey(quarters) {
  return Object.keys(quarters).find((k) => quarters[k].months.join(',') === '10,11,12') || Object.keys(quarters)[0];
}

export default function OneThird() {
  const [basis, setBasis] = useState('calendar');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [quarter, setQuarter] = useState(defaultQuarterKey(CALENDAR_QUARTERS));

  const quarters = QUARTERS_BY_BASIS[basis];
  const def = quarters[quarter] || quarters[defaultQuarterKey(quarters)];
  const months = def.months;
  const queryYear = year + def.yearOffset;

  const { data, loading, error } = useFetch(
    `/api/reports/one-third?year=${queryYear}&months=${months.join(',')}`
  );

  function onBasisChange(next) {
    setBasis(next);
    setQuarter(defaultQuarterKey(QUARTERS_BY_BASIS[next]));
    setYear(next === 'fy' ? CURRENT_FY_YEAR : CURRENT_YEAR);
  }

  function exportCsv() {
    const header = ['District', ...months.map(monthName), 'Total', 'One-Third'];
    const rows = [header];
    data.districts.forEach((d) => {
      rows.push([d.district_name, ...months.map((m) => d.months[m] || 0), d.total, d.one_third]);
    });
    downloadCsv(`one_third_${queryYear}_${quarter.slice(0, 2)}.csv`, rows);
  }

  return (
    <div>
      <div className="page-head">
        <h1>One-Third List</h1>
        {data && <button className="btn" onClick={exportCsv}>Export CSV</button>}
      </div>
      <p className="muted">Per-district totals across a quarter, with the one-third share.</p>

      <div className="toolbar">
        <BasisSelect basis={basis} onChange={onBasisChange} />
        <div className="field">
          <label>Quarter</label>
          <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            {Object.keys(quarters).map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{basis === 'fy' ? 'FY start year' : 'Year'}</label>
          <input type="number" value={year} style={{ width: 100 }} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        <span className="muted" style={{ alignSelf: 'center' }}>
          → {monthName(months[0])}–{monthName(months[months.length - 1])} {queryYear}
        </span>
      </div>

      {loading && <div className="spinner">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>District</th>
                {months.map((m) => (
                  <th key={m} className="num">{monthName(m)}</th>
                ))}
                <th className="num">Total</th>
                <th className="num">One-Third</th>
              </tr>
            </thead>
            <tbody>
              {data.districts.length === 0 && (
                <tr><td colSpan={months.length + 3} className="empty">No data for this quarter.</td></tr>
              )}
              {data.districts.map((d) => (
                <tr key={d.district_id}>
                  <td>{d.district_name}</td>
                  {months.map((m) => (
                    <td key={m} className="num">{money(d.months[m] || 0)}</td>
                  ))}
                  <td className="num">{money(d.total)}</td>
                  <td className="num">{money(d.one_third)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
