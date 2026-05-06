import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import QuickCreateModal from '../components/QuickCreateModal.jsx';

export default function KundenList() {
  const [kunden, setKunden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    setLoading(true);
    api('/kunden')
      .then(res => setKunden(res.kunden || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Kunden</h1>
          <p className="page-sub">Übersicht aller Firmen, für die wir Kampagnen aufsetzen.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Icon name="plus" /> Neuer Kunde
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading && <div className="card empty">Lade…</div>}

      {!loading && kunden.length === 0 && (
        <div className="card empty">
          <h2>Noch keine Kunden angelegt</h2>
          <p>Lege deinen ersten Kunden an, um eine Kampagne zu starten.</p>
        </div>
      )}

      {!loading && kunden.length > 0 && (
        <div className="grid-cards">
          {kunden.map(k => (
            <Link key={k.id} to={`/kunden/${k.id}`} className="kunde-card">
              <div className="kunde-card-logo">
                {k.logo_url
                  ? <img src={k.logo_url} alt="" />
                  : <span>{(k.firmenname || '?').slice(0, 1).toUpperCase()}</span>}
              </div>
              <div className="kunde-card-body">
                <div className="kunde-card-name">{k.firmenname || '—'}</div>
                <div className="kunde-card-meta">
                  {k.branche && <span>{k.branche}</span>}
                  {k.ansprechpartner && <span>{k.ansprechpartner}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <QuickCreateModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
