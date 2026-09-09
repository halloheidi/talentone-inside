import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import QuickCreateModal from '../components/QuickCreateModal.jsx';
import NaechsterSchrittStapel from '../components/NaechsterSchrittBadge.jsx';
import AvvAnfrageModal from '../components/AvvAnfrageModal.jsx';

const VIEW_KEY = 'kundenList.view';

function truncate(s, n = 80) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

/* ─── Kompaktes Werbekosten-Badge: K / N&W / — ─── */
function WerbekostenChip({ value }) {
  const v = value || null;
  if (!v) return <span style={{ color: 'var(--ink-4, #999)' }}>—</span>;
  const label = v === 'Kunde' ? 'K' : v === 'N&W' ? 'N&W' : v;
  const isKunde = v === 'Kunde';
  return (
    <span
      title={`Werbekosten: ${v}`}
      style={{
        display: 'inline-flex', alignItems: 'center',
        background: isKunde ? '#dbeafe' : '#ede9fe',
        color: isKunde ? '#1e40af' : '#5b21b6',
        border: `1px solid ${isKunde ? '#bfdbfe' : '#ddd6fe'}`,
        padding: '1px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700,
      }}
    >{label}</span>
  );
}

/* ─── Kommentar-Badge mit aufklappbarer Vorschau (letzte 2–3 Kommentare) ─── */
function KommentarPopover({ info }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const count = info?.kommentar_count || 0;
  const letzte = info?.letzte || [];

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!count) return <span style={{ color: 'var(--ink-4, #999)' }}>—</span>;

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        title={`${count} Kommentar${count === 1 ? '' : 'e'} — klicken für Vorschau`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0',
          padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: 'pointer',
        }}
      >💬 {count}</button>
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
            width: 280, background: '#fff', border: '1px solid var(--line, #e2e0dc)',
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 12,
            textAlign: 'left', cursor: 'default',
          }}
        >
          {letzte.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-3, #666)' }}>Keine Vorschau verfügbar.</div>
          ) : letzte.slice(0, 3).map((k, i) => (
            <div key={i} style={{ padding: '6px 0', borderTop: i > 0 ? '1px solid var(--bg-2, #f0f0ee)' : 'none' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3, #666)' }}>
                <strong>{k.autor || 'Unbekannt'}</strong>
                {k.created_at ? ` · ${new Date(k.created_at).toLocaleDateString('de-DE')}` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-1, #333)', marginTop: 2 }}>{truncate(k.text)}</div>
            </div>
          ))}
          <Link to="/projekte" onClick={e => e.stopPropagation()}
            style={{ fontSize: 11, display: 'inline-block', marginTop: 8, fontWeight: 600 }}>
            Alle ansehen →
          </Link>
        </div>
      )}
    </span>
  );
}

export default function KundenList() {
  const [kunden, setKunden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [avvKunde, setAvvKunde] = useState(null); // Kunde für AVV-Anfrage-Modal
  const [search, setSearch] = useState('');
  const [agenturFilter, setAgenturFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [schritteMap, setSchritteMap] = useState({});
  const [projektMap, setProjektMap] = useState({}); // { kunde_id: { kommentar_count, werbekosten, letzte } }
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
          // Projekt-Übersicht (Werbekosten + Kommentar-Aggregat) pro Kunde
          api(`/kunden/projekt-uebersicht?ids=${ids}`)
            .then(r => setProjektMap(r || {}))
            .catch(() => setProjektMap({}));
        } else {
          setSchritteMap({});
          setProjektMap({});
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
                  {k.avv_offen && (
                    <span className="avv-warn" role="button" tabIndex={0} title="AVV noch nicht akzeptiert — klicken zum Senden"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAvvKunde(k); }}>⚠️</span>
                  )}
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
                {projektMap[k.id] && (projektMap[k.id].werbekosten || projektMap[k.id].kommentar_count) && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    {projektMap[k.id].werbekosten && <WerbekostenChip value={projektMap[k.id].werbekosten} />}
                    <KommentarPopover info={projektMap[k.id]} />
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && view === 'liste' && (
        <div style={{ width: '100%' }}>
          <table className="bewerbungen-table" style={{ width: '100%', tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}></th>
                <th style={{ width: '24%' }}>Firma</th>
                <th style={{ width: '16%' }}>Branche</th>
                <th style={{ width: '12%' }}>Agentur</th>
                <th style={{ width: 70 }}>Werbek.</th>
                <th>Nächster Schritt</th>
                <th style={{ width: 70 }}>Komm.</th>
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
                  <td><strong>{k.firmenname || k.email || '—'}</strong>{k.avv_offen && (
                    <span className="avv-warn" role="button" tabIndex={0} title="AVV noch nicht akzeptiert — klicken zum Senden"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAvvKunde(k); }}>⚠️</span>
                  )}</td>
                  <td>{k.branche || '—'}</td>
                  <td>{k.agentur === 'nowagwirth' ? 'Nowag & Wirth' : k.agentur === 'talentone' ? 'TalentOne' : '—'}</td>
                  <td><WerbekostenChip value={projektMap[k.id]?.werbekosten} /></td>
                  <td onClick={e => e.stopPropagation()}>
                    <NaechsterSchrittStapel items={schritteMap[k.id]} kundeId={k.id} max={3} />
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <KommentarPopover info={projektMap[k.id]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickCreateModal open={showCreate} onClose={() => setShowCreate(false)} />
      <AvvAnfrageModal open={!!avvKunde} kunde={avvKunde} onClose={() => setAvvKunde(null)} />
    </div>
  );
}
