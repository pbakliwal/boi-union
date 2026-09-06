import { useState } from 'react';
import { useFetch } from '../../hooks.js';
import { MonthYear, monthName, money, downloadCsv, CURRENT_MONTH, CURRENT_YEAR } from './shared.jsx';

export default function Summary() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [year, setYear] = useState(CURRENT_YEAR);
  const { data, loading, error } = useFetch(`/api/reports/summary?month=${month}&year=${year}`);

  function exportCsv() {
    const rows = [['Zone', 'District', 'Paid members', 'Amount']];
    (data.zones || []).forEach((z) => {
      z.districts.forEach((d) => rows.push([z.zone_name, d.district_name, d.paid_count, d.amount]));
      rows.push([z.zone_name + ' — SUBTOTAL', '', '', z.subtotal]);
    });
    rows.push(['GRAND TOTAL', '', '', data.grand_total]);
    downloadCsv(`summary_${year}_${month}.csv`, rows);
  }

  return (
    <div>
      <div className="page-head">
        <h1>Monthly Summary</h1>
        {data && <button className="btn" onClick={exportCsv}>Export CSV</button>}
      </div>
      <p className="muted">Collected amount by Zone → District — {monthName(month)} {year}.</p>

      <MonthYear month={month} year={year} onMonth={setMonth} onYear={setYear} />

      {loading && <div className="spinner">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>District</th>
                <th className="num">Paid members</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.zones.length === 0 && (
                <tr><td colSpan={3} className="empty">No data for this month.</td></tr>
              )}
              {data.zones.map((z) => (
                <ZoneBlock key={z.zone_id} zone={z} />
              ))}
              {data.zones.length > 0 && (
                <tr className="grand">
                  <td>GRAND TOTAL</td>
                  <td className="num"></td>
                  <td className="num">{money(data.grand_total)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ZoneBlock({ zone }) {
  return (
    <>
      <tr className="group-row">
        <td colSpan={3}>Zone: {zone.zone_name}</td>
      </tr>
      {zone.districts.map((d) => (
        <tr key={d.district_id}>
          <td>{d.district_name}</td>
          <td className="num">{d.paid_count}</td>
          <td className="num">{money(d.amount)}</td>
        </tr>
      ))}
      <tr className="subtotal">
        <td>Subtotal — {zone.zone_name}</td>
        <td className="num"></td>
        <td className="num">{money(zone.subtotal)}</td>
      </tr>
    </>
  );
}
