import { useState } from 'react';
import { api } from '../api.js';
import { useFetch } from '../hooks.js';
import { useAuth } from '../auth.jsx';
import Modal from '../components/Modal.jsx';

const ROLES = [
  { value: 'admin', label: 'admin — full access' },
  { value: 'viewer', label: 'viewer — read-only reports' },
];

export default function Users() {
  const { user, isAdmin } = useAuth();
  const { data, loading, error, reload } = useFetch(isAdmin ? '/api/users' : null);
  const [editing, setEditing] = useState(null); // {} = new, row = edit
  const [form, setForm] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!isAdmin) return <div className="empty">Admins only.</div>;

  function openNew() {
    setForm({ username: '', password: '', role: 'viewer' });
    setSaveError(null);
    setEditing({});
  }
  function openEdit(row) {
    setForm({ username: row.username, password: '', role: row.role });
    setSaveError(null);
    setEditing(row);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      if (editing.id) {
        const body = { role: form.role };
        if (form.password) body.password = form.password;
        await api.put(`/api/users/${editing.id}`, body);
      } else {
        await api.post('/api/users', form);
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
    if (!confirm(`Delete user "${row.username}"?`)) return;
    try {
      await api.del(`/api/users/${row.id}`);
      reload();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Users</h1>
        <button className="btn primary" onClick={openNew}>+ Add user</button>
      </div>
      <p className="muted">Admins manage all data; viewers can only view reports and master data.</p>

      {loading && <div className="spinner">Loading…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Created</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.username}
                    {u.id === user.id && <span className="muted"> (you)</span>}
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'yes' : 'draft'}`}>{u.role}</span>
                  </td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}</td>
                  <td className="right">
                    <button className="btn btn-sm" onClick={() => openEdit(u)}>Edit</button>{' '}
                    <button
                      className="btn btn-sm danger"
                      disabled={u.id === user.id}
                      title={u.id === user.id ? 'You cannot delete your own account' : ''}
                      onClick={() => remove(u)}
                    >
                      Del
                    </button>
                  </td>
                </tr>
              ))}
              {(data || []).length === 0 && (
                <tr><td colSpan={4} className="empty">No users.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? `Edit user — ${editing.username}` : 'New user'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {saveError && <div className="error">{saveError}</div>}

          {!editing.id && (
            <div className="field">
              <label>Username *</label>
              <input
                type="text"
                value={form.username}
                autoFocus
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
          )}

          <div className="field">
            <label>Role *</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{editing.id ? 'New password (leave blank to keep current)' : 'Password *'}</label>
            <input
              type="password"
              value={form.password}
              placeholder={editing.id ? '••••••••' : 'at least 8 characters'}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
