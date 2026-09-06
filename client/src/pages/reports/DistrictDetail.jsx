import { useState } from 'react';
import { useFetch } from '../../hooks.js';
import { MonthYear, monthName, money, downloadCsv, CURRENT_MONTH, CURRENT_YEAR } from './shared.jsx';

export default function DistrictDetail() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [districtId, setDistrictId] = useState('');
  const districts = useFetch('/api/districts');

  const path = districtId
    ? `/api/reports/district-detail?month=${month}&year=${year}&district_id=${districtId}`
    : null;
  const { data, loading, error } = useFetch(path);

  const districtName = (districts.data || []).find((d) => String(d.id) === String(districtId))?.name;

  function exportCsv() {
    const rows = [['Branch', 'Member', 'Amount', 'Received', 'Remarks']];
    data.rows.forEach((r) =>
      rows.push([r.branch_name, `${r.name} ${r.surname || ''}`.trim(), r.amount, r.received ? 'Yes' : 'No', r.remarks || ''])
    );
    rows.push(['SUBTOTAL', '', data.subtotal, '', '']);
    downloadCsv(`district_${districtName || districtId}_${year}_${month}.csv`, rows);
  }

  return (
    <div>
      <div className="page-head">
        <h1>District Detail</h1>
        {data && <button className="btn" onClick={exportCsv}>Export CSV</button>}
      </div>
      <p className="muted">Member-level entries for one district — {monthName(month)} {year}.</p>

      <MonthYear month={month} year={year} onMonth={setMonth} onYear={setYear}>
        <div className="field" style={{ minWidth: 240 }}>
          <label>District</label>
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
            <option value="">— select district —</option>
            {(districts.data || []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.zone_name})
              </option>
            ))}
          </select>
        </div>
      </MonthYear>

      {!districtId && <div className="empty">Choose a district to view its entries.</div>}
      {loading && <div className="spinner">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Member</th>
                <th className="num">Amount</th>
                <th>Received</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.branch_name}</td>
                  <td>{r.name} {r.surname}</td>
                  <td className="num">{money(r.amount)}</td>
                  <td>{r.received ? <span className="badge yes">Yes</span> : <span className="badge no">No</span>}</td>
                  <td>{r.remarks}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={5} className="empty">No entries.</td></tr>
              )}
              {data.rows.length > 0 && (
                <tr className="grand">
                  <td>SUBTOTAL</td>
                  <td></td>
                  <td className="num">{money(data.subtotal)}</td>
                  <td colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
