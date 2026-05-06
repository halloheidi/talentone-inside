import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import Icon from '../components/Icon.jsx';

const NAV = [
  { to: '/kunden', label: 'Kunden', icon: 'users' },
  { to: '/creatives', label: 'Creatives', icon: 'image' },
  { to: '/adcopies', label: 'Ad Copies', icon: 'text' },
  { to: '/funnel', label: 'Funnel', icon: 'funnel' },
  { to: '/export', label: 'Export', icon: 'download' },
];

export default function DashboardLayout() {
  const { user, signOut } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>Talent</span>
          <span className="brand-accent">One</span>
          <span className="brand-sub">Inside</span>
        </div>
        <nav className="nav">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">v0.1 · intern</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-spacer" />
          <div className="topbar-user">
            <div className="avatar">{(user?.email || '?').slice(0, 1).toUpperCase()}</div>
            <div className="user-meta">
              <div className="user-email">{user?.email}</div>
              <div className="user-role">Mitarbeiter</div>
            </div>
            <button className="btn-ghost" onClick={signOut} title="Abmelden">
              <Icon name="logout" />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
