import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';

const EMPTY_FORM = { firmenname: '', ansprechpartner: '', email: '', telefon: '', branche: '', notizen: '' };

export default function KundenList() {
  const [kunden, setKunden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    api('/kunden')
      .then(res => setKunden(res.kunden || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function onCreate(e) {
    e.preventDefault();
    if (!form.firmenname.trim()) return;
    setCreating(true);
    try {
      await api('/kunden', { method: 'POST', body: form });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

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

      <Modal
        open={showCreate}
        onClose={() => !creating && setShowCreate(false)}
        title="Neuer Kunde"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowCreate(false)} disabled={creating}>
              Abbrechen
            </button>
            <button className="btn-primary" onClick={onCreate} disabled={creating || !form.firmenname.trim()}>
              {creating ? 'Speichere…' : 'Anlegen'}
            </button>
          </>
        }
      >
        <form onSubmit={onCreate} className="form-grid">
          <label className="field">
            <span>Firmenname *</span>
            <input value={form.firmenname} onChange={e => setForm({ ...form, firmenname: e.target.value })} required />
          </label>
          <label className="field">
            <span>Ansprechpartner</span>
            <input value={form.ansprechpartner} onChange={e => setForm({ ...form, ansprechpartner: e.target.value })} />
          </label>
          <label className="field">
            <span>E-Mail</span>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="field">
            <span>Telefon</span>
            <input value={form.telefon} onChange={e => setForm({ ...form, telefon: e.target.value })} />
          </label>
          <label className="field">
            <span>Branche</span>
            <input value={form.branche} onChange={e => setForm({ ...form, branche: e.target.value })} />
          </label>
          <label className="field field-full">
            <span>Notizen</span>
            <textarea rows={3} value={form.notizen} onChange={e => setForm({ ...form, notizen: e.target.value })} />
          </label>
        </form>
      </Modal>
    </div>
  );
}
