import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// B4: „Bewerbungen" = Kundenübersicht aus Bewerber-Sicht (nur live/pausiert).
// Je Kunde Karten mit Stellen-Zeilen; Zähler aus der Bearbeitungs-Ableitung.
const ZAEHLER = [
  { key: 'neu', label: 'Neu', color: '#6b7280' },
  { key: 'kontaktversuch', label: 'Kontaktversuch', color: '#b45309' },
  { key: 'in_bearbeitung', label: 'In Bearbeitung', color: '#5a5955' },
  { key: 'vorqualifiziert', label: 'Vorqualifiziert', color: '#1e40af' },
];

export default function BewerbungenOverview() {
  const navigate = useNavigate();
  const [kunden, setKunden] = useState(null);
  const [error, setError] = useState('');
  const [chip, setChip] = useState('alle'); // alle | neue | kommentare

  useEffect(() => {
    api('/bewerbungen/uebersicht').then(r => setKunden(r.kunden || [])).catch(e => setError(e.message));
  }, []);

  const sichtbar = useMemo(() => {
    if (!kunden) return [];
    let list = kunden.map(k => ({ ...k, summeNeu: k.stellen.reduce((s, x) => s + x.neu, 0), summeKomm: k.stellen.reduce((s, x) => s + x.kommentare, 0) }));
    if (chip === 'neue') list = list.filter(k => k.summeNeu > 0);
    if (chip === 'kommentare') list = list.filter(k => k.summeKomm > 0);
    return list.sort((a, b) => b.summeNeu - a.summeNeu || a.firmenname.localeCompare(b.firmenname));
  }, [kunden, chip]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!kunden) return <div className="card empty">Lade…</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Bewerbungen</h1>
          <p className="page-sub">Kunden mit laufenden Stellen — Stand der Bearbeitung je Stelle.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {[['alle', 'Alle'], ['neue', 'Nur mit Neuen'], ['kommentare', 'Nur mit Kommentaren']].map(([k, l]) => (
          <button key={k} className={`pub-filter ${chip === k ? 'is-active' : ''}`} onClick={() => setChip(k)}>{l}</button>
        ))}
      </div>

      {sichtbar.length === 0 ? (
        <div className="card empty"><p>Keine Kunden in dieser Ansicht.</p></div>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
          {sichtbar.map(k => (
            <div key={k.id} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                {k.logo_url
                  ? <img src={k.logo_url} alt="" style={{ height: 34, maxWidth: 90, objectFit: 'contain' }} />
                  : <span style={{ width: 34, height: 34, borderRadius: 8, background: '#eef0f4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#44474d' }}>{(k.firmenname || '?')[0]}</span>}
                <strong style={{ fontSize: 15 }}>{k.firmenname}</strong>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {k.stellen.map(s => (
                  <button key={s.job_id} onClick={() => navigate(`/kunden/${k.id}/jobs/${s.job_id}/bewerber`)}
                    style={{ textAlign: 'left', background: '#fafaf8', border: '1px solid #eceae6', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0 }}>{s.stelle}</span>
                      {s.kommentare > 0 && <span title="Offene Kundenkommentare" style={{ fontSize: 12 }}>💬 {s.kommentare}</span>}
                      {s.kriterien_geaendert && <span title="Kriterien geändert — neu prüfen" style={{ fontSize: 12 }}>⚠</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {ZAEHLER.map(z => (
                        <span key={z.key} style={{ fontSize: 12, color: s[z.key] ? z.color : '#b8b8b4', fontWeight: s[z.key] ? 700 : 400 }}>
                          {s[z.key]} {z.label}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
                {k.stellen.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Keine laufenden Stellen.</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
