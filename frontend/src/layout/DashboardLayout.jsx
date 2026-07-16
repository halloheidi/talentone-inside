import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { PageWidthProvider } from '../components/PageContainer.jsx';

function GlobalNav({ isAdmin }) {
  return (
    <nav className="nav">
      <NavLink to="/kunden" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon name="users" />
        <span>Kunden</span>
      </NavLink>
      <NavLink to="/bewerbungen" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon name="users" />
        <span>Bewerbungen</span>
      </NavLink>
      <NavLink to="/zahlungen" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon name="users" />
        <span>Zahlungen</span>
      </NavLink>
      <NavLink to="/projekte" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon name="users" />
        <span>Projekte</span>
      </NavLink>
      <NavLink to="/live-kampagnen" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon name="users" />
        <span>Live-Kampagnen</span>
      </NavLink>
      <NavLink to="/controlling" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon name="users" />
        <span>📊 Controlling</span>
      </NavLink>
      <NavLink to="/angebote" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon name="users" />
        <span>Angebote</span>
      </NavLink>
      <NavLink to="/analyse-funnel" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon name="users" />
        <span>Analyse-Funnel</span>
      </NavLink>
      {isAdmin && (
        <>
          <div className="nav-section">Admin</div>
          <NavLink to="/admin/controlling" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
            <Icon name="users" />
            <span>Finanz-Controlling</span>
          </NavLink>
          <NavLink to="/admin/angebots-katalog" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
            <Icon name="users" />
            <span>Angebots-Katalog</span>
          </NavLink>
          <NavLink to="/admin/stilvorlagen" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
            <Icon name="users" />
            <span>🎨 Stilvorlagen</span>
          </NavLink>
        </>
      )}
    </nav>
  );
}

function KundeNav({ kundeId }) {
  const [kunde, setKunde] = useState(null);
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api(`/kunden/${kundeId}`).catch(() => ({ kunde: null })),
      api(`/jobs?kunde_id=${kundeId}`).catch(() => ({ jobs: [] })),
    ]).then(([k, j]) => {
      if (cancelled) return;
      setKunde(k.kunde);
      setJobs(j.jobs || []);
    });
    return () => { cancelled = true; };
  }, [kundeId]);

  return (
    <div className="ctx-nav">
      <Link to="/kunden" className="ctx-back">
        <span aria-hidden>←</span> Alle Kunden
      </Link>
      <NavLink
        to={`/kunden/${kundeId}`}
        end
        className={({ isActive }) => `ctx-kunde ${isActive ? 'is-active' : ''}`}
      >
        <Icon name="users" size={16} />
        <span className="ctx-kunde-name">{kunde?.firmenname || 'Kunde'}</span>
      </NavLink>
      <div className="ctx-section">Projekte</div>
      <div className="ctx-list">
        {jobs.length === 0 && <div className="ctx-empty">Noch keine Projekte.</div>}
        {jobs.map(j => (
          <NavLink
            key={j.id}
            to={`/kunden/${kundeId}/jobs/${j.id}`}
            className={({ isActive }) => `ctx-job ${isActive ? 'is-active' : ''}`}
            title={j.stelle || 'Unbenanntes Projekt'}
          >
            <span className="ctx-job-dot" />
            <span className="ctx-job-name">{j.stelle || 'Unbenannt'}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export default function DashboardLayout() {
  const { user, signOut, isAdmin } = useAuth();
  const kundeMatch = useMatch('/kunden/:kundeId/*');
  const kundeId = kundeMatch?.params?.kundeId;
  // Standard = begrenzte Lesebreite; Seiten schalten via <PageContainer wide> um.
  const [wide, setWide] = useState(false);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/kunden" className="brand">
          <span>Talent</span>
          <span className="brand-accent">One</span>
          <span className="brand-sub">Inside</span>
        </Link>
        {kundeId ? <KundeNav kundeId={kundeId} /> : <GlobalNav isAdmin={isAdmin} />}
        <div className="sidebar-foot">v0.2 · intern</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-spacer" />
          <div className="topbar-user">
            <div className="avatar">{(user?.email || '?').slice(0, 1).toUpperCase()}</div>
            <div className="user-meta">
              <div className="user-email">{user?.email}</div>
              <div className="user-role">{isAdmin ? 'Admin' : 'Mitarbeiter'}</div>
            </div>
            <button className="btn-ghost" onClick={signOut} title="Abmelden">
              <Icon name="logout" />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <section className={`content ${wide ? 'is-wide' : ''}`}>
          <PageWidthProvider value={setWide}>
            <Outlet />
          </PageWidthProvider>
        </section>
      </main>
    </div>
  );
}
