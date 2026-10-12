import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const sidebarRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const onChange = () => {
      setIsMobile(media.matches);
      setNavOpen(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen || !isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => sidebarRef.current.querySelector('button').focus());
    const onKey = (event) => {
      if (event.key === 'Escape') setNavOpen(false);
      if (event.key !== 'Tab') return;
      const controls = sidebarRef.current.querySelectorAll('a[href], button');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      if (window.matchMedia('(max-width: 768px)').matches) menuRef.current?.focus();
    };
  }, [navOpen, isMobile]);

  return (
    <div className="app">
      {isMobile && navOpen && (
        <button className="nav-backdrop" aria-label="Close navigation" tabIndex={-1} onClick={() => setNavOpen(false)} />
      )}
      <aside
        id="app-navigation"
        ref={sidebarRef}
        className={`sidebar${navOpen ? ' is-open' : ''}`}
        role={isMobile && navOpen ? 'dialog' : undefined}
        aria-modal={isMobile && navOpen ? true : undefined}
        aria-labelledby="navigation-brand"
        {...(isMobile && !navOpen ? { inert: '' } : {})}
        onClick={(event) => {
          if (event.target.closest('a')) setNavOpen(false);
        }}
      >
        <button className="btn nav-close" aria-label="Close navigation" title="Close navigation" onClick={() => setNavOpen(false)}>
          <X size={22} aria-hidden="true" />
        </button>
        <div className="brand" id="navigation-brand">
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

      <div className="main" {...(isMobile && navOpen ? { inert: '' } : {})}>
        <div className="topbar">
          <div className="topbar-start">
            <button
              ref={menuRef}
              className="btn menu-toggle"
              aria-label="Open navigation"
              aria-controls="app-navigation"
              aria-expanded={navOpen}
              title="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
            <span className="mobile-brand">BOI Union</span>
          </div>
          <div className="topbar-account">
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
