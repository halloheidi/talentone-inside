import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';

export default function Kunden() {
  const [kunden, setKunden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api('/kunden')
      .then(res => { if (!cancelled) setKunden(res.kunden || []); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Kunden</h1>
          <p className="page-sub">Übersicht aller Firmen, für die wir Kampagnen aufsetzen.</p>
        </div>
        <button className="btn-primary" disabled>
          <Icon name="plus" /> Neuer Kunde
        </button>
      </div>

      {loading && <div className="card empty">Lade…</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!loading && !error && kunden.length === 0 && (
        <div className="card empty">
          <h2>Noch keine Kunden angelegt</h2>
          <p>Sobald der erste Kunde erfasst ist, taucht er hier auf.</p>
        </div>
      )}

      {!loading && kunden.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Firma</th>
                <th>Ansprechpartner</th>
                <th>E-Mail</th>
                <th>Branche</th>
                <th>Angelegt</th>
              </tr>
            </thead>
            <tbody>
              {kunden.map(k => (
                <tr key={k.id}>
                  <td>{k.firmenname || '—'}</td>
                  <td>{k.ansprechpartner || '—'}</td>
                  <td>{k.email || '—'}</td>
                  <td>{k.branche || '—'}</td>
                  <td>{new Date(k.created_at).toLocaleDateString('de-DE')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
