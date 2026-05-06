import { useEffect, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';

const FIELDS = [
  { key: 'stelle', label: 'Stellenbezeichnung', full: true },
  { key: 'region', label: 'Region' },
  { key: 'gehalt', label: 'Gehalt' },
  { key: 'eingabe_methode', label: 'Eingabe-Methode' },
  { key: 'url', label: 'Stellenanzeigen-URL', full: true },
  { key: 'besonderheiten', label: 'Besonderheiten', full: true, textarea: true },
];

export default function JobStelleninfos() {
  const { job, reload } = useJob();
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setForm({
      stelle: job.stelle || '',
      region: job.region || '',
      gehalt: job.gehalt || '',
      eingabe_methode: job.eingabe_methode || '',
      url: job.url || '',
      besonderheiten: job.besonderheiten || '',
      reisebereitschaft: !!job.reisebereitschaft,
      quereinsteiger: !!job.quereinsteiger,
    });
  }, [job]);

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await api(`/jobs/${job.id}`, { method: 'PATCH', body: form });
      await reload();
      setMsg('Gespeichert.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSave} className="card-form">
      <div className="form-grid">
        {FIELDS.map(f => (
          <label key={f.key} className={`field ${f.full ? 'field-full' : ''}`}>
            <span>{f.label}</span>
            {f.textarea
              ? <textarea rows={3} value={form[f.key] || ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
              : <input value={form[f.key] || ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />}
          </label>
        ))}
        <label className="field-checkbox">
          <input type="checkbox" checked={!!form.reisebereitschaft} onChange={e => setForm({ ...form, reisebereitschaft: e.target.checked })} />
          <span>Reisebereitschaft erforderlich</span>
        </label>
        <label className="field-checkbox">
          <input type="checkbox" checked={!!form.quereinsteiger} onChange={e => setForm({ ...form, quereinsteiger: e.target.checked })} />
          <span>Quereinsteiger willkommen</span>
        </label>
      </div>
      <div className="form-actions">
        {msg && <span className="form-msg">{msg}</span>}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Speichere…' : 'Änderungen speichern'}
        </button>
      </div>
    </form>
  );
}
