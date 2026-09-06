export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const monthName = (m) => MONTHS[m - 1] || m;

export const money = (n) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const now = new Date();
export const CURRENT_MONTH = now.getMonth() + 1;
export const CURRENT_YEAR = now.getFullYear();
// Indian financial year runs April-March; its "start year" is this calendar
// year once April has begun, else the previous calendar year.
export const CURRENT_FY_YEAR = CURRENT_MONTH >= 4 ? CURRENT_YEAR : CURRENT_YEAR - 1;

export const fyLabel = (startYear) => `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

// Calendar-year / financial-year toggle used by reports spanning a full year.
export function BasisSelect({ basis, onChange }) {
  return (
    <div className="field">
      <label>Year basis</label>
      <select value={basis} onChange={(e) => onChange(e.target.value)}>
        <option value="calendar">Calendar year (Jan–Dec)</option>
        <option value="fy">Financial year (Apr–Mar)</option>
      </select>
    </div>
  );
}

// Month + Year selector used by most reports.
export function MonthYear({ month, year, onMonth, onYear, children }) {
  return (
    <div className="toolbar">
      <div className="field">
        <label>Month</label>
        <select value={month} onChange={(e) => onMonth(Number(e.target.value))}>
          {MONTHS.map((name, i) => (
            <option key={i + 1} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Year</label>
        <input
          type="number"
          value={year}
          style={{ width: 100 }}
          onChange={(e) => onYear(Number(e.target.value))}
        />
      </div>
      {children}
    </div>
  );
}

// Turn a matrix into a CSV file and trigger a download.
export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
