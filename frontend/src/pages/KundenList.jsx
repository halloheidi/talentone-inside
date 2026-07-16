import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import QuickCreateModal from '../components/QuickCreateModal.jsx';
import NaechsterSchrittStapel from '../components/NaechsterSchrittBadge.jsx';

const VIEW_KEY = 'kundenList.view';

export default function KundenList() {
  const [kunden, setKunden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [agenturFilter, setAgenturFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [schritteMap, setSchritteMap] = useState({});
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || 'cards'; } catch (e) { return 'cards'; }
  });

  function setViewPersist(v) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
  }

  function load() {
    setLoading(true);
    const q = showArchived ? '?only_archived=1' : '';
    api(`/kunden${q}`)
      .then(res => {
        const list = res.kunden || [];
        setKunden(list);
        // Danach die Schritt-Badges nachladen (best-effort, blockt nicht)
        if (list.length) {
          const ids = list.map(k => k.id).join(',');
          api(`/kunden/naechste-schritte?ids=${ids}`)
            .then(r => setSchritteMap(r.schritte || {}))
            .catch(() => setSchritteMap({}));
        } else {
          setSchritteMap({});
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [showArchived]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kunden.filter(k => {
      if (agenturFilter && k.agentur !== agenturFilter) return false;
      if (!q) return true;
      const hay = [k.firmenname, k.email, k.ansprechpartner, k.branche, k.telefon, k.notizen]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [kunden, search, agenturFilter]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Kunden <span style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}>({filtered.length}{filtered.length !== kunden.length ? ` von ${kunden.length}` : ''})</span></h1>
          <p className="page-sub">Übersicht aller Firmen, für die wir Kampagnen aufsetzen.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="proj-view-toggle">
            <button className={`pub-filter ${view === 'cards' ? 'is-active' : ''}`} onClick={() => setViewPersist('cards')} title="Karten">Karten</button>
            <button className={`pub-filter ${view === 'liste' ? 'is-active' : ''}`} onClick={() => setViewPersist('liste')} title="Liste">Liste</button>
          </div>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Icon name="plus" /> Neuer Kunde
          </button>
        </div>
      </div>

      <section className="filter-bar" style={{ marginBottom: 16 }}>
        <div className="filter-group" style={{ flex: 1, minWidth: 240 }}>
          <label>Suche</label>
          <input
            type="text"
            placeholder="Firmenname, E-Mail, Ansprechpartner, Branche…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <label>Agentur</label>
          <select value={agenturFilter} onChange={e => setAgenturFilter(e.target.value)}>
            <option value="">Alle</option>
            <option value="talentone">TalentOne</option>
            <option value="nowagwirth">Nowag &amp; Wirth</option>
          </select>
        </div>
        <div className="filter-group" style={{ alignSelf: 'flex-end' }}>
          <button
            className={`pub-filter ${showArchived ? 'is-active' : ''}`}
            onClick={() => setShowArchived(v => !v)}
            title="Nur archivierte Kunden anzeigen"
          >
            {showArchived ? '📦 Archiv (aktiv)' : '📦 Archiv anzeigen'}
          </button>
        </div>
        {(search || agenturFilter) && (
          <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setAgenturFilter(''); }} style={{ alignSelf: 'flex-end' }}>
            Filter zurücksetzen
          </button>
        )}
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="card empty">Lade…</div>}

      {!loading && kunden.length === 0 && (
        <div className="card empty">
          <h2>Noch keine Kunden angelegt</h2>
          <p>Lege deinen ersten Kunden an, um eine Kampagne zu starten.</p>
        </div>
      )}

      {!loading && kunden.length > 0 && filtered.length === 0 && (
        <div className="card empty">
          <h2>Keine Treffer</h2>
          <p>Filter zurücksetzen oder einen anderen Suchbegriff probieren.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && view === 'cards' && (
        <div className="grid-cards">
          {filtered.map(k => (
            <Link key={k.id} to={`/kunden/${k.id}`} className={`kunde-card ${k.status === 'wartend' ? 'is-wartend' : ''}`}>
              <div className={`kunde-card-logo ${k.logo_url ? 'has-image' : ''}`}>
                {k.logo_url
                  ? <img src={k.logo_url} alt="" />
                  : <span>{(k.firmenname || '?').slice(0, 1).toUpperCase()}</span>}
              </div>
              <div className="kunde-card-body">
                <div className="kunde-card-name">
                  {k.firmenname || k.email || '—'}
                  {k.avv_offen && <span className="avv-warn" title="AVV noch nicht akzeptiert">⚠️</span>}
                </div>
                <div className="kunde-card-meta">
                  {k.branche && <span>{k.branche}</span>}
                  {k.ansprechpartner && <span>{k.ansprechpartner}</span>}
                  {k.status === 'wartend' && !k.firmenname && k.email && <span>{k.email}</span>}
                </div>
                {schritteMap[k.id] && (
                  <div style={{ marginTop: 8 }}>
                    <NaechsterSchrittStapel items={schritteMap[k.id]} kundeId={k.id} max={3} />
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && view === 'liste' && (
        <div className="bewerbungen-table-scroll">
          <table className="bewerbungen-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}></th>
                <th>Firma</th>
                <th>Branche</th>
                <th>Ansprechpartner</th>
                <th>E-Mail</th>
                <th>Telefon</th>
                <th>Agentur</th>
                <th style={{ minWidth: 260 }}>Nächster Schritt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(k => (
                <tr key={k.id} style={{ cursor: 'pointer' }} onClick={() => window.location.assign(`/kunden/${k.id}`)}>
                  <td>
                    <div className={`kunde-card-logo ${k.logo_url ? 'has-image' : ''}`} style={{ width: 32, height: 32, borderRadius: 6, fontSize: 14 }}>
                      {k.logo_url
                        ? <img src={k.logo_url} alt="" />
                        : <span>{(k.firmenname || '?').slice(0, 1).toUpperCase()}</span>}
                    </div>
                  </td>
                  <td><strong>{k.firmenname || k.email || '—'}</strong>{k.avv_offen && <span className="avv-warn" title="AVV noch nicht akzeptiert">⚠️</span>}</td>
                  <td>{k.branche || '—'}</td>
                  <td>{k.ansprechpartner || '—'}</td>
                  <td>{k.email ? <a href={`mailto:${k.email}`} onClick={e => e.stopPropagation()}>{k.email}</a> : '—'}</td>
                  <td>{k.telefon ? <a href={`tel:${k.telefon}`} onClick={e => e.stopPropagation()}>{k.telefon}</a> : '—'}</td>
                  <td>{k.agentur === 'nowagwirth' ? 'Nowag & Wirth' : k.agentur === 'talentone' ? 'TalentOne' : '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <NaechsterSchrittStapel items={schritteMap[k.id]} kundeId={k.id} max={3} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickCreateModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
