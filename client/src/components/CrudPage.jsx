import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useFetch } from '../hooks.js';
import Modal from './Modal.jsx';

// Generic master-data screen driven by a config object:
//   { title, endpoint, columns[], fields[], defaults, searchable }
// columns: { key, label, num?, render?(row) }
// fields:  { name, label, type: text|number|date|checkbox|select, required?,
//            optionsEndpoint?, optionValue?, optionLabel?(o) }
export default function CrudPage({ config, canWrite }) {
  const { title, endpoint, columns, fields, defaults = {}, searchable } = config;
  const { data, loading, error, reload } = useFetch(endpoint);
  const [options, setOptions] = useState({});
  const [editing, setEditing] = useState(null); // row being edited, or {} for new
  const [form, setForm] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Load option lists for any select fields.
  const optionEndpoints = useMemo(
    () => [...new Set(fields.filter((f) => f.optionsEndpoint).map((f) => f.optionsEndpoint))],
    [fields]
  );
  useEffect(() => {
    let alive = true;
    Promise.all(optionEndpoints.map((ep) => api.get(ep).then((rows) => [ep, rows]))).then((pairs) => {
      if (alive) setOptions(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [optionEndpoints.join('|')]);

  function openNew() {
    setForm({ ...defaults });
    setSaveError(null);
    setEditing({});
  }

  function openEdit(row) {
    const initial = {};
    fields.forEach((f) => {
      let v = row[f.name];
      if (f.type === 'checkbox') v = !!v;
      else if (v === null || v === undefined) v = '';
      initial[f.name] = v;
    });
    setForm(initial);
    setSaveError(null);
    setEditing(row);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      if (editing && editing.id) {
        await api.put(`${endpoint}/${editing.id}`, form);
      } else {
        await api.post(endpoint, form);
      }
      setEditing(null);
      reload();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    if (!confirm(`Delete this ${title.replace(/s$/, '').toLowerCase()}?`)) return;
    try {
      await api.del(`${endpoint}/${row.id}`);
      reload();
    } catch (e) {
      alert(e.message);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    if (!searchable || !search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((r) =>
      columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q))
    );
  }, [data, search, searchable, columns]);

  return (
    <div>
      <div className="page-head">
        <h1>{title}</h1>
        {canWrite && (
          <button className="btn primary" onClick={openNew}>
            + Add
          </button>
        )}
      </div>

      {searchable && (
        <div className="toolbar">
          <div className="field" style={{ minWidth: 260 }}>
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      )}

      {loading && <div className="spinner">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.num ? 'num' : ''}>
                    {c.label}
                  </th>
                ))}
                {canWrite && <th style={{ width: 120 }}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? 'num' : ''}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                  {canWrite && (
                    <td className="right">
                      <button className="btn btn-sm" onClick={() => openEdit(row)}>
                        Edit
                      </button>{' '}
                      <button className="btn btn-sm danger" onClick={() => remove(row)}>
                        Del
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (canWrite ? 1 : 0)} className="empty">
                    No records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={`${editing.id ? 'Edit' : 'New'} ${title.replace(/s$/, '')}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {saveError && <div className="error">{saveError}</div>}
          {fields.map((f) => (
            <Field
              key={f.name}
              field={f}
              value={form[f.name]}
              options={options[f.optionsEndpoint]}
              onChange={(v) => setForm((prev) => ({ ...prev, [f.name]: v }))}
            />
          ))}
        </Modal>
      )}
    </div>
  );
}

function Field({ field, value, options, onChange }) {
  const { name, label, type = 'text', required } = field;

  if (type === 'checkbox') {
    return (
      <div className="field check">
        <input
          id={name}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label htmlFor={name}>{label}</label>
      </div>
    );
  }

  if (type === 'select') {
    const valueKey = field.optionValue || 'id';
    const labelOf = field.optionLabel || ((o) => o.name ?? o.code ?? o[valueKey]);
    const list = field.staticOptions || options || [];
    return (
      <div className="field">
        <label>
          {label} {required && '*'}
        </label>
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {list.map((o) => (
            <option key={o[valueKey]} value={o[valueKey]}>
              {labelOf(o)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="field">
      <label>
        {label} {required && '*'}
      </label>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
