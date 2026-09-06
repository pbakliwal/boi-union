import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const masterLinks = [
  { to: '/members', label: 'Members' },
  { to: '/branches', label: 'Branches' },
  { to: '/districts', label: 'Districts' },
  { to: '/zones', label: 'Zones' },
  { to: '/categories', label: 'Categories' },
  { to: '/rates', label: 'Rates' },
];

const reportLinks = [
  { to: '/reports/summary', label: 'Monthly Summary' },
  { to: '/reports/district', label: 'District Detail' },
  { to: '/reports/one-third', label: 'One-Third List' },
  { to: '/reports/yearly', label: 'Yearly Members' },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          BOI Employees' Union
          <small>Madhya Pradesh</small>
        </div>

        <nav className="nav-group">
          <h4>Contributions</h4>
          <NavLink className="nav-link" to="/monthly">
            Monthly Entry &amp; Audit
          </NavLink>
          {isAdmin && (
            <NavLink className="nav-link" to="/import">
              Import Salary Register
            </NavLink>
          )}
        </nav>

        <nav className="nav-group">
          <h4>Reports</h4>
          {reportLinks.map((l) => (
            <NavLink key={l.to} className="nav-link" to={l.to}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <nav className="nav-group">
          <h4>Master Data</h4>
          {masterLinks.map((l) => (
            <NavLink key={l.to} className="nav-link" to={l.to}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        {isAdmin && (
          <nav className="nav-group">
            <h4>Administration</h4>
            <NavLink className="nav-link" to="/users">
              Users
            </NavLink>
          </nav>
        )}
      </aside>

      <div className="main">
        <div className="topbar">
          <div />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="who">
              {user?.username} · {user?.role}
            </span>
            <button className="btn btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
