import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';

const STATUS_LABELS = {
  vorbereitung: 'Vorbereitung',
  kickoff_vereinbart: 'Kick-Off vereinbart',
  onboarding: 'Onboarding',
  golive_vereinbart: 'Go-Live vereinbart',
  warte_auf_go: 'Warte auf Go!',
  live: 'Live',
  pausiert: 'Pausiert',
  hold: 'Hold',
  abgeschlossen: 'Abgeschlossen',
};

const CHECK_KEYS = [
  'fb_zugang', 'formular_verschickt', 'fotograf_organisiert',
  'fotos_erhalten', 'fotos_fertig', 'formular_erhalten',
  'onboarding_formular', 'creatives_erstellt', 'adcopies_geschrieben',
  'url_bestellt', 'url_connected', 'url_verifiziert_fb', 'events_gesetzt',
  'bewerberliste_erstellt', 'zapier_eingerichtet', 'entwuerfe_verschickt',
  'go_vom_kunden', 'avv_unterzeichnet', 'adresse_werbekonto',
  'geschenk_verschickt', 'testi_vereinbaren',
];

function csvDownload(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export default function ProjekteOverview() {
  const [loading, setLoading] = useState(true);
  const [projekte, setProjekte] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [verantwFilter, setVerantwFilter] = useState('');
  const [artFilter, setArtFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api('/projekte');
      setProjekte(res.projekte || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const verantworten = useMemo(() => Array.from(new Set(projekte.map(p => p.verantwortlich).filter(Boolean))).sort(), [projekte]);
  const arten = useMemo(() => Array.from(new Set(projekte.map(p => p.projektart).filter(Boolean))).sort(), [projekte]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projekte.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (verantwFilter && p.verantwortlich !== verantwFilter) return false;
      if (artFilter && p.projektart !== artFilter) return false;
      if (q) {
        const hay = [p.projekt, p.kunde, p.gesuchte_positionen, p.standorte, p.notizen, p.email]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projekte, search, statusFilter, verantwFilter, artFilter]);

  async function updateField(id, field, value) {
    setProjekte(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    try {
      const res = await api(`/projekte/${id}`, { method: 'PATCH', body: { [field]: value } });
      setProjekte(prev => prev.map(p => p.id === id ? res.projekt : p));
    } catch (err) { console.error('save-fail', err.message); }
  }

  function checklistProgress(checkliste) {
    const done = CHECK_KEYS.filter(k => checkliste?.[k]).length;
    return { done, total: CHECK_KEYS.length };
  }

  function exportCsv() {
    const rows = filtered.map(p => ({
      Projektnummer: p.projektnummer || '',
      Projekt: p.projekt || '',
      Kunde: p.kunde || '',
      Status: STATUS_LABELS[p.status] || p.status,
      Verantwortlich: p.verantwortlich || '',
      Projektart: p.projektart || '',
      Positionen: p.gesuchte_positionen || '',
      Standorte: p.standorte || '',
      Email: p.email || '',
      Telefon: '',
      Pixel: p.pixel || '',
      Startdatum_Abo: p.startdatum_abo || '',
      Enddatum_Abo: p.enddatum_abo || '',
      Notizen: p.notizen || '',
    }));
    csvDownload(`projekte-${new Date().toISOString().slice(0,10)}.csv`, rows);
  }

  return (
    <div className="bew-overview">
      <header className="bew-overview-head">
        <h1>Projekte <span style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}>({filtered.length} von {projekte.length})</span></h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={exportCsv} disabled={!filtered.length}>⬇ CSV-Export</button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Neues Projekt</button>
        </div>
      </header>

      <section className="filter-bar">
        <div className="filter-group">
          <label>Suche</label>
          <input type="text" placeholder="Projekt, Kunde, Position…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-group">
          <label>Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Alle</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Verantwortlich</label>
          <select value={verantwFilter} onChange={e => setVerantwFilter(e.target.value)}>
            <option value="">Alle</option>
            {verantworten.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Projektart</label>
          <select value={artFilter} onChange={e => setArtFilter(e.target.value)}>
            <option value="">Alle</option>
            {arten.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </section>

      {loading ? <div className="motiv-sub">Lade Projekte…</div>
        : !filtered.length ? <div className="motiv-sub">Keine Projekte gefunden.</div>
        : (
          <div className="bewerbungen-table-scroll">
            <table className="bewerbungen-table">
              <thead><tr>
                <th>#</th>
                <th>Projekt</th>
                <th>Kunde</th>
                <th>Status</th>
                <th>Verantw.</th>
                <th>Projektart</th>
                <th>Positionen</th>
                <th>Standorte</th>
                <th>Checkliste</th>
                <th>Komm.</th>
                <th>Pixel</th>
                <th>Letzter Kontakt</th>
              </tr></thead>
              <tbody>
                {filtered.map(p => {
                  const { done, total } = checklistProgress(p.checkliste);
                  return (
                    <tr key={p.id}>
                      <td className="td-date">{p.projektnummer || '—'}</td>
                      <td><strong>{p.projekt || '—'}</strong></td>
                      <td>{p.kunde || '—'}</td>
                      <td>
                        <select className="cell-input" value={p.status} onChange={e => updateField(p.id, 'status', e.target.value)}>
                          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td>{p.verantwortlich || '—'}</td>
                      <td><span className="chip" style={{ fontSize: 11 }}>{p.projektart || '—'}</span></td>
                      <td style={{ maxWidth: 200 }}>{p.gesuchte_positionen || '—'}</td>
                      <td style={{ maxWidth: 200 }}>{p.standorte || '—'}</td>
                      <td>
                        <div className="proj-progress">
                          <div className="proj-progress-bar" style={{ width: `${(done/total) * 100}%` }} />
                          <span className="proj-progress-label">{done}/{total}</span>
                        </div>
                      </td>
                      <td>{p.kommentar_count || 0}</td>
                      <td>{p.pixel ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.pixel.slice(0, 8)}…</span> : '—'}</td>
                      <td className="td-date">{p.letzter_kontakt ? new Date(p.letzter_kontakt).toLocaleDateString('de-DE') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {showCreate && <CreateProjektModal onClose={() => setShowCreate(false)} onCreated={p => { setProjekte(prev => [p, ...prev]); setShowCreate(false); }} />}
    </div>
  );
}

function CreateProjektModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    projekt: '', kunde: '', projektart: '', gesuchte_positionen: '', standorte: '', verantwortlich: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const res = await api('/projekte', { method: 'POST', body: form });
      onCreated(res.projekt);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={true} onClose={() => !busy && onClose()} title="Neues Projekt"
      footer={<div className="zahlung-modal-actions">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button type="button" className="btn-zahlung-cta" onClick={submit} disabled={busy || (!form.projekt && !form.kunde)}>
          {busy ? 'Erstelle…' : '+ Projekt anlegen'}
        </button>
      </div>}>
      <div className="form-grid">
        <label className="field field-full"><span>Projektname</span>
          <input type="text" autoFocus value={form.projekt} onChange={e => setForm({ ...form, projekt: e.target.value })} placeholder="z.B. Hagedorn Servicetechniker" />
        </label>
        <label className="field field-full"><span>Kunde / Firma</span>
          <input type="text" value={form.kunde} onChange={e => setForm({ ...form, kunde: e.target.value })} placeholder="Firmenname" />
        </label>
        <label className="field"><span>Projektart</span>
          <input type="text" value={form.projektart} onChange={e => setForm({ ...form, projektart: e.target.value })} placeholder="Mitarbeitergewinnung, Abo …" />
        </label>
        <label className="field"><span>Verantwortlich</span>
          <input type="text" value={form.verantwortlich} onChange={e => setForm({ ...form, verantwortlich: e.target.value })} />
        </label>
        <label className="field field-full"><span>Gesuchte Positionen</span>
          <input type="text" value={form.gesuchte_positionen} onChange={e => setForm({ ...form, gesuchte_positionen: e.target.value })} />
        </label>
        <label className="field field-full"><span>Standorte</span>
          <input type="text" value={form.standorte} onChange={e => setForm({ ...form, standorte: e.target.value })} />
        </label>
      </div>
      {err && <div className="alert alert-error" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}
