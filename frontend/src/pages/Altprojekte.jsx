import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import PageContainer from '../components/PageContainer.jsx';

// Altprojekte = Airtable-Altbestand: Projekte aus talentone_projekte OHNE verknüpfte
// Stelle (kunde_id NULL oder kein Job mit diesem projekt_id). Reine Lese-Ansicht,
// keine Anlage möglich. Quelle: GET /api/projekte/altbestand.
function zeitraum(p) {
  if (p.projektdauer) return p.projektdauer;
  const fmt = d => (d ? new Date(d).toLocaleDateString('de-DE') : null);
  const von = fmt(p.startdatum_abo) || fmt(p.start_datum);
  const bis = fmt(p.enddatum_abo);
  if (von && bis) return `${von} – ${bis}`;
  if (von) return `ab ${von}`;
  return '—';
}

export default function Altprojekte() {
  const [projekte, setProjekte] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    setLoading(true);
    api('/projekte/altbestand')
      .then(res => setProjekte(res.projekte || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const term = q.trim().toLowerCase();
  const gefiltert = term
    ? projekte.filter(p => [p.projekt, p.kunde, p.status, p.projektart, p.notizen]
        .some(f => (f || '').toString().toLowerCase().includes(term)))
    : projekte;

  return (
    <div>
      <PageContainer wide />
      <div className="page-head">
        <div>
          <h1 className="page-title">Altprojekte</h1>
          <p className="page-sub">
            Airtable-Altbestand — Projekte ohne verknüpfte Stelle. Reine Historie, nur lesbar.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Suche (Projekt, Kunde, Status, Notizen)…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ width: '100%', maxWidth: 420, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14 }}
        />
      </div>

      {loading ? (
        <div className="card empty">Lade…</div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : gefiltert.length === 0 ? (
        <div className="card empty">
          <h2>Keine Altprojekte</h2>
          <p>{term ? 'Keine Treffer für die Suche.' : 'Es gibt keine Projekte ohne verknüpfte Stelle.'}</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, width: '100%' }}>
              <thead>
                <tr>
                  <th>Projekt</th>
                  <th>Kunde</th>
                  <th>Status</th>
                  <th>Zeitraum</th>
                  <th>Notizen</th>
                </tr>
              </thead>
              <tbody>
                {gefiltert.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.projekt || p.projektart || '—'}</td>
                    <td>{p.kunde || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.status || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{zeitraum(p)}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 360 }}>
                      {p.notizen ? <span title={p.notizen}>{p.notizen}</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--ink-4)', borderTop: '1px solid var(--line)' }}>
            {gefiltert.length} Altprojekt{gefiltert.length === 1 ? '' : 'e'}{term ? ` (gefiltert aus ${projekte.length})` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
