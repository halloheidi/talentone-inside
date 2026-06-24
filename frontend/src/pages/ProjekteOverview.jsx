import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';

/* ─── Konstanten ─── */
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

// Kanban-Spalten — jede Status-Stufe einzeln
const PROJEKTART_OPTIONEN = [
  'Mitarbeitergewinnung',
  'TalentOne - Mitarbeitergewinnung',
  'Abo',
  'Neukundengewinnung',
  'Social Media Betreuung',
  'Employer Branding',
  'Mitarbeiterbefragung',
  'Homepage',
  'Karriereseite',
];

const PROJEKTDAUER_OPTIONEN = [
  '30 Tage', '60 Tage', '90 Tage', '6 Monate', '12 Monate', 'abo',
];

const KANBAN_COLUMNS = [
  { key: 'vorbereitung',       label: 'Kunde ohne Kick-Off', color: '#dc2626', match: ['vorbereitung'] },
  { key: 'kickoff_vereinbart', label: 'Kick-Off vereinbart', color: '#3b82f6', match: ['kickoff_vereinbart'] },
  { key: 'onboarding',         label: 'Onboarding',          color: '#8b5cf6', match: ['onboarding'] },
  { key: 'golive_vereinbart',  label: 'Go-Live vereinbart',  color: '#f59e0b', match: ['golive_vereinbart'] },
  { key: 'warte_auf_go',       label: 'Warte auf Go!',       color: '#b45309', match: ['warte_auf_go'] },
  { key: 'live',               label: 'Live',                color: '#15803d', match: ['live'] },
  { key: 'pausiert',           label: 'Pausiert',            color: '#6b7280', match: ['pausiert'] },
  { key: 'hold',               label: 'Hold',                color: '#1f2937', match: ['hold'] },
  { key: 'abgeschlossen',      label: 'Abgeschlossen',       color: '#10b981', match: ['abgeschlossen'] },
];

const CHECK_KEYS = [
  'fb_zugang', 'formular_verschickt', 'fotograf_organisiert',
  'fotos_erhalten', 'fotos_fertig', 'formular_erhalten',
  'onboarding_formular', 'creatives_erstellt', 'adcopies_geschrieben',
  'url_bestellt', 'url_connected', 'url_verifiziert_fb', 'events_gesetzt',
  'bewerberliste_erstellt', 'zapier_eingerichtet', 'entwuerfe_verschickt',
  'go_vom_kunden', 'avv_unterzeichnet', 'adresse_werbekonto',
  'geschenk_verschickt', 'testi_vereinbaren',
];
const CHECK_LABELS = {
  fb_zugang: 'Facebook-Zugang',
  formular_verschickt: 'Formular verschickt',
  fotograf_organisiert: 'Fotograf organisiert',
  fotos_erhalten: 'Fotos erhalten',
  fotos_fertig: 'Fotos fertig',
  formular_erhalten: 'Formular erhalten',
  onboarding_formular: 'Onboarding-Formular',
  creatives_erstellt: 'Creatives erstellt',
  adcopies_geschrieben: 'Ad-Copies geschrieben',
  url_bestellt: 'URL bestellt',
  url_connected: 'URL connected',
  url_verifiziert_fb: 'URL verifiziert in FB',
  events_gesetzt: 'Events gesetzt',
  bewerberliste_erstellt: 'Bewerberliste erstellt',
  zapier_eingerichtet: 'Zapier eingerichtet',
  entwuerfe_verschickt: 'Entwürfe verschickt',
  go_vom_kunden: 'Go vom Kunden',
  avv_unterzeichnet: 'AVV unterzeichnet',
  adresse_werbekonto: 'Adresse im Werbekonto',
  geschenk_verschickt: 'Geschenk verschickt',
  testi_vereinbaren: 'Testimonial vereinbaren',
};

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase();
}

function csvDownload(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = v => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ─── Debounced ─── */
function DebouncedInput({ value, onSave, type = 'text', rows, placeholder }) {
  const [local, setLocal] = useState(value ?? '');
  const t = useRef(null);
  const lastRef = useRef(value ?? '');
  useEffect(() => { setLocal(value ?? ''); lastRef.current = value ?? ''; }, [value]);
  function onChange(e) {
    const v = e.target.value;
    setLocal(v);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => { if (v !== lastRef.current) { lastRef.current = v; onSave(v); } }, 600);
  }
  function flush() { if (t.current) clearTimeout(t.current); if (local !== lastRef.current) { lastRef.current = local; onSave(local); } }
  if (rows) return <textarea className="cell-input" rows={rows} value={local} placeholder={placeholder} onChange={onChange} onBlur={flush} />;
  return <input className="cell-input" type={type} value={local} placeholder={placeholder} onChange={onChange} onBlur={flush} />;
}

/* ═════════════════════ HAUPTKOMPONENTE ═════════════════════ */

export default function ProjekteOverview() {
  const [loading, setLoading] = useState(true);
  const [projekte, setProjekte] = useState([]);
  const [view, setView] = useState('kanban'); // 'kanban' | 'liste'
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [verantwFilter, setVerantwFilter] = useState('');
  const [artFilter, setArtFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [team, setTeam] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll(ids) {
    setSelectedIds(prev => {
      const allSelected = ids.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }
  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!confirm(`${ids.length} Projekt${ids.length === 1 ? '' : 'e'} wirklich löschen? Alle zugehörigen Kommentare gehen auch verloren. Verknüpfte TalentOne-Kunden bleiben unberührt.`)) return;
    const errors = [];
    for (const id of ids) {
      try { await api(`/projekte/${id}`, { method: 'DELETE' }); }
      catch (err) { errors.push(`${id.slice(0, 8)}: ${err.message}`); }
    }
    setProjekte(prev => prev.filter(p => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
    if (errors.length) alert(`${errors.length} Fehler:\n${errors.join('\n')}`);
  }

  /* ─── Merge mehrerer Projekte ─── */
  const [mergeOpen, setMergeOpen] = useState(false);
  async function performMerge(hauptId) {
    const mergedIds = Array.from(selectedIds).filter(id => id !== hauptId);
    if (mergedIds.length === 0) return;
    const haupt = projekte.find(p => p.id === hauptId);
    if (!confirm(`${mergedIds.length} Projekt${mergedIds.length === 1 ? '' : 'e'} ins Hauptprojekt „${haupt?.projekt || haupt?.kunde || '?'}" zusammenführen?\n\nKommentare und Notizen werden übernommen, die zusammengeführten Projekte werden gelöscht. Verknüpfte TalentOne-Kunden bleiben unberührt. Das kann nicht rückgängig gemacht werden.`)) return;
    try {
      const res = await api('/projekte/merge', {
        method: 'POST',
        body: { haupt_id: hauptId, merged_ids: mergedIds },
      });
      // Frontend-State: andere entfernen, Hauptprojekt aktualisieren
      setProjekte(prev => prev
        .filter(p => !mergedIds.includes(p.id))
        .map(p => p.id === hauptId ? { ...p, ...res.projekt } : p));
      setSelectedIds(new Set());
      setMergeOpen(false);
      alert(`${mergedIds.length} Projekt${mergedIds.length === 1 ? '' : 'e'} erfolgreich zusammengeführt.`);
    } catch (err) {
      alert(`Merge fehlgeschlagen: ${err.message}`);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const [pres, tres] = await Promise.all([
        api('/projekte'),
        api('/projekte/team').catch(() => ({ team: [] })),
      ]);
      setProjekte(pres.projekte || []);
      setTeam(tres.team || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Full-width-Layout für Kanban — hebt .content max-width 1200px auf
  useEffect(() => {
    document.body.classList.add('proj-fullwidth');
    return () => document.body.classList.remove('proj-fullwidth');
  }, []);

  const verantworten = useMemo(() => Array.from(new Set(projekte.map(p => p.verantwortlich).filter(Boolean))).sort(), [projekte]);
  const arten = useMemo(() => Array.from(new Set(projekte.map(p => p.projektart).filter(Boolean))).sort(), [projekte]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projekte.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (verantwFilter && p.verantwortlich !== verantwFilter) return false;
      if (artFilter && p.projektart !== artFilter) return false;
      if (q) {
        const hay = [p.projekt, p.kunde, p.gesuchte_positionen, p.standorte, p.notizen, p.email].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projekte, search, statusFilter, verantwFilter, artFilter]);

  async function updateField(id, field, value) {
    setProjekte(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    try {
      const res = await api(`/projekte/${id}`, { method: 'PATCH', body: { [field]: value } });
      setProjekte(prev => prev.map(p => p.id === id ? { ...p, ...res.projekt } : p));
    } catch (err) { console.error('save-fail', err.message); }
  }

  async function moveToKanban(id, kanbanKey) {
    // Beim Drop in eine Spalte: setze status auf den primären Status der Spalte
    // (vorbereitung-Spalte → "vorbereitung", andere → ihr key)
    const newStatus = kanbanKey;
    await updateField(id, 'status', newStatus);
  }

  function exportCsv() {
    const rows = filtered.map(p => ({
      Projektnummer: p.projektnummer || '', Projekt: p.projekt || '', Kunde: p.kunde || '',
      Status: STATUS_LABELS[p.status] || p.status, Verantwortlich: p.verantwortlich || '',
      Projektart: p.projektart || '', Positionen: p.gesuchte_positionen || '', Standorte: p.standorte || '',
      Email: p.email || '', Pixel: p.pixel || '', Startdatum_Abo: p.startdatum_abo || '',
      Enddatum_Abo: p.enddatum_abo || '', Notizen: p.notizen || '',
    }));
    csvDownload(`projekte-${new Date().toISOString().slice(0,10)}.csv`, rows);
  }

  async function exportKommentare() {
    const all = [];
    for (const p of filtered) {
      try {
        const res = await api(`/projekte/${p.id}/kommentare`);
        for (const k of res.kommentare || []) {
          all.push({
            Projekt: p.projekt, Kunde: p.kunde,
            Datum: new Date(k.created_at).toLocaleString('de-DE'),
            Autor: k.autor || '', Quelle: k.quelle || '',
            Erwaehnungen: (k.erwaehnungen || []).join(', '),
            Text: (k.text || '').replace(/\s+/g, ' '),
          });
        }
      } catch { /* skip */ }
    }
    csvDownload(`kommentare-${new Date().toISOString().slice(0,10)}.csv`, all);
  }

  function checklistDone(c) { return CHECK_KEYS.filter(k => c?.[k]).length; }

  /* ─── Drag&Drop ─── */
  const dragId = useRef(null);
  function onDragStart(e, id) { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDrop(e, colKey) {
    e.preventDefault();
    const id = dragId.current;
    if (!id) return;
    moveToKanban(id, colKey);
    dragId.current = null;
  }

  return (
    <div className="bew-overview proj-overview">
      <header className="bew-overview-head">
        <h1>Projekte <span style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}>({filtered.length} von {projekte.length})</span></h1>
        <div className="proj-view-toggle">
          <button className={`pub-filter ${view === 'kanban' ? 'is-active' : ''}`} onClick={() => setView('kanban')}>Kanban</button>
          <button className={`pub-filter ${view === 'liste' ? 'is-active' : ''}`} onClick={() => setView('liste')}>Liste</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedIds.size >= 2 && (
            <button className="btn-ghost" onClick={() => setMergeOpen(true)}>
              🔗 {selectedIds.size} zusammenführen
            </button>
          )}
          {selectedIds.size > 0 && (
            <button className="btn-ghost btn-danger" onClick={bulkDelete}>
              🗑 {selectedIds.size} löschen
            </button>
          )}
          <button className="btn-ghost" onClick={exportKommentare} disabled={!filtered.length}>📝 Alle Kommentare</button>
          <button className="btn-ghost" onClick={exportCsv} disabled={!filtered.length}>⬇ CSV-Export</button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Neues Projekt</button>
        </div>
      </header>

      {mergeOpen && (
        <MergeProjekteModal
          projekte={projekte.filter(p => selectedIds.has(p.id))}
          onCancel={() => setMergeOpen(false)}
          onConfirm={performMerge}
        />
      )}

      <section className="filter-bar">
        <div className="filter-group"><label>Suche</label>
          <input type="text" placeholder="Projekt, Kunde, Position…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="filter-group"><label>Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Alle</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="filter-group"><label>Verantwortlich</label>
          <select value={verantwFilter} onChange={e => setVerantwFilter(e.target.value)}>
            <option value="">Alle</option>
            {verantworten.map(v => <option key={v} value={v}>{v}</option>)}
          </select></div>
        <div className="filter-group"><label>Projektart</label>
          <select value={artFilter} onChange={e => setArtFilter(e.target.value)}>
            <option value="">Alle</option>
            {arten.map(a => <option key={a} value={a}>{a}</option>)}
          </select></div>
      </section>

      {loading ? <div className="motiv-sub">Lade Projekte…</div>
        : !filtered.length ? <div className="motiv-sub">Keine Projekte gefunden.</div>
        : view === 'kanban'
          ? <KanbanBoard filtered={filtered} onCardClick={id => setSelectedId(id)} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} checklistDone={checklistDone} />
          : <ListView filtered={filtered} onCardClick={id => setSelectedId(id)} updateField={updateField} checklistDone={checklistDone}
                       selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} />
      }

      {showCreate && <CreateProjektModal team={team} onClose={() => setShowCreate(false)} onCreated={p => { setProjekte(prev => [p, ...prev]); setShowCreate(false); }} />}

      {selectedId && (
        <ProjektSlideOver
          projektId={selectedId}
          team={team}
          onClose={() => setSelectedId(null)}
          onUpdate={updated => {
            setProjekte(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
          }}
          onDeleted={(id) => {
            setProjekte(prev => prev.filter(p => p.id !== id));
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}

/* ═════════════════════ KANBAN-BOARD ═════════════════════ */

function KanbanBoard({ filtered, onCardClick, onDragStart, onDragOver, onDrop, checklistDone }) {
  return (
    <div className="kanban">
      {KANBAN_COLUMNS.map(col => {
        const cards = filtered.filter(p => col.match.includes(p.status));
        return (
          <div key={col.key} className="kanban-col" onDragOver={onDragOver} onDrop={e => onDrop(e, col.key)}>
            <div className="kanban-col-head">
              <span className="kanban-col-pill" style={{ background: col.color }}>{col.label}</span>
              <span className="kanban-col-count">{cards.length}</span>
            </div>
            <div className="kanban-col-body">
              {cards.map(p => {
                const done = checklistDone(p.checkliste);
                const zufRand = p.zufriedenheit ? (p.zufriedenheit >= 4 ? 'good' : p.zufriedenheit >= 3 ? 'ok' : 'bad') : null;
                return (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={e => onDragStart(e, p.id)}
                    onClick={() => onCardClick(p.id)}
                    className={`kanban-card ${zufRand ? 'card-zuf-' + zufRand : ''}`}
                  >
                    <div className="kanban-card-firma">{p.kunde || '—'}</div>
                    {p.gesuchte_positionen && <div className="kanban-card-pos">{p.gesuchte_positionen}{p.standorte ? ` · ${p.standorte}` : ''}</div>}
                    <div className="kanban-card-meta">
                      {p.projektart && <span className="kanban-badge">{p.projektart}</span>}
                      {p.verantwortlich && <span className="kanban-avatar" title={p.verantwortlich}>{initials(p.verantwortlich)}</span>}
                    </div>
                    <div className="proj-progress" style={{ marginTop: 6 }}>
                      <div className="proj-progress-bar" style={{ width: `${(done/CHECK_KEYS.length)*100}%` }} />
                      <span className="proj-progress-label">{done}/{CHECK_KEYS.length}</span>
                    </div>
                  </div>
                );
              })}
              {cards.length === 0 && <div className="kanban-empty">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═════════════════════ LISTEN-ANSICHT (kompakt) ═════════════════════ */

function ListView({ filtered, onCardClick, updateField, checklistDone, selectedIds, toggleSelect, toggleSelectAll }) {
  const ids = filtered.map(p => p.id);
  const allSelected = ids.length > 0 && ids.every(id => selectedIds.has(id));
  const someSelected = ids.some(id => selectedIds.has(id));
  return (
    <div className="bewerbungen-table-scroll">
      <table className="bewerbungen-table">
        <thead><tr>
          <th style={{ width: 36 }}>
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
              onChange={() => toggleSelectAll(ids)}
              title={allSelected ? 'Alle abwählen' : 'Alle auswählen'}
            />
          </th>
          <th>#</th><th>Projekt</th><th>Kunde</th><th>Status</th><th>Verantw.</th>
          <th>Projektart</th><th>Positionen</th><th>Standorte</th><th>Checkliste</th>
          <th>Komm.</th><th>Pixel</th><th>Letzter Kontakt</th>
        </tr></thead>
        <tbody>
          {filtered.map(p => {
            const done = checklistDone(p.checkliste);
            const isChecked = selectedIds.has(p.id);
            return (
              <tr key={p.id} onClick={() => onCardClick(p.id)} style={{ cursor: 'pointer' }} className={isChecked ? 'is-selected' : ''}>
                <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(p.id)} />
                </td>
                <td className="td-date">{p.projektnummer || '—'}</td>
                <td><strong>{p.projekt || '—'}</strong></td>
                <td>{p.kunde || '—'}</td>
                <td onClick={e => e.stopPropagation()}>
                  <select className="cell-input" value={p.status} onChange={e => updateField(p.id, 'status', e.target.value)}>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td>{p.verantwortlich || '—'}</td>
                <td><span className="chip" style={{ fontSize: 11 }}>{p.projektart || '—'}</span></td>
                <td style={{ maxWidth: 200 }}>{p.gesuchte_positionen || '—'}</td>
                <td style={{ maxWidth: 200 }}>{p.standorte || '—'}</td>
                <td><div className="proj-progress"><div className="proj-progress-bar" style={{ width: `${(done/CHECK_KEYS.length)*100}%` }} /><span className="proj-progress-label">{done}/{CHECK_KEYS.length}</span></div></td>
                <td>{p.kommentar_count || 0}</td>
                <td>{p.pixel ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.pixel.slice(0, 8)}…</span> : '—'}</td>
                <td className="td-date">{p.letzter_kontakt ? new Date(p.letzter_kontakt).toLocaleDateString('de-DE') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═════════════════════ SLIDE-OVER ═════════════════════ */

function ProjektSlideOver({ projektId, team, onClose, onUpdate, onDeleted }) {
  const [loading, setLoading] = useState(true);
  const [projekt, setProjekt] = useState(null);
  const [autoKeys, setAutoKeys] = useState([]);
  const [kommentare, setKommentare] = useState([]);

  async function load() {
    setLoading(true);
    try {
      const [pr, kr] = await Promise.all([
        api(`/projekte/${projektId}`),
        api(`/projekte/${projektId}/kommentare`),
      ]);
      setProjekt(pr.projekt);
      setAutoKeys(pr.auto_keys || []);
      setKommentare(kr.kommentare || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projektId]);

  async function patch(body) {
    setProjekt(prev => prev ? { ...prev, ...body } : prev);
    try {
      const res = await api(`/projekte/${projektId}`, { method: 'PATCH', body });
      setProjekt(res.projekt);
      onUpdate?.(res.projekt);
    } catch (err) { console.error('patch-fail', err.message); }
  }
  function patchField(field) { return v => patch({ [field]: v }); }

  function toggleCheck(key) {
    const c = { ...(projekt.checkliste || {}) };
    c[key] = !c[key];
    patch({ checkliste: c });
  }

  if (loading || !projekt) {
    return (
      <div className="slideover-backdrop" onClick={onClose}>
        <aside className="slideover slideover-projekt" onClick={e => e.stopPropagation()}>
          <header className="slideover-head"><h2>Lade…</h2><button className="btn-ghost" onClick={onClose}>×</button></header>
        </aside>
      </div>
    );
  }

  return (
    <div className="slideover-backdrop" onClick={onClose}>
      <aside className="slideover slideover-projekt" onClick={e => e.stopPropagation()}>
        <header className="slideover-head">
          <div>
            <h2>{projekt.projekt || projekt.kunde || '(Unbenannt)'}</h2>
            <p className="muted">
              {projekt.kunde && `${projekt.kunde} · `}
              {STATUS_LABELS[projekt.status]}
              {projekt.projektnummer ? ` · #${projekt.projektnummer}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className="btn-ghost btn-danger btn-sm"
              title="Projekt löschen"
              onClick={async () => {
                if (!confirm(`Projekt „${projekt.projekt || projekt.kunde || '(Unbenannt)'}" wirklich löschen? Alle zugehörigen Kommentare werden ebenfalls entfernt. Verknüpfte TalentOne-Kunden bleiben unberührt. Das kann nicht rückgängig gemacht werden.`)) return;
                try {
                  await api(`/projekte/${projektId}`, { method: 'DELETE' });
                  onDeleted?.(projektId);
                } catch (err) {
                  alert(`Löschen fehlgeschlagen: ${err.message}`);
                }
              }}
            >🗑 Löschen</button>
            <button className="btn-ghost" onClick={onClose}>×</button>
          </div>
        </header>

        <div className="slideover-body">
          {/* Projektinfo */}
          <section>
            <h3>Projekt</h3>
            <div className="slideover-form">
              <label className="slideover-full"><span>Projektname</span><DebouncedInput value={projekt.projekt || ''} onSave={patchField('projekt')} /></label>
              <label className="slideover-full"><span>Kunde / Firma</span><DebouncedInput value={projekt.kunde || ''} onSave={patchField('kunde')} /></label>
              <label><span>Status</span>
                <select className="cell-input" value={projekt.status} onChange={e => patch({ status: e.target.value })}>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label><span>Verantwortlich</span>
                <select className="cell-input" value={projekt.verantwortlich || ''} onChange={e => patch({ verantwortlich: e.target.value || null })}>
                  <option value="">—</option>
                  {team.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </label>
              <label><span>Projektart</span>
                <select className="cell-input" value={projekt.projektart || ''} onChange={e => patch({ projektart: e.target.value || null })}>
                  <option value="">—</option>
                  {PROJEKTART_OPTIONEN.map(o => <option key={o} value={o}>{o}</option>)}
                  {projekt.projektart && !PROJEKTART_OPTIONEN.includes(projekt.projektart) && <option value={projekt.projektart}>{projekt.projektart}</option>}
                </select>
              </label>
              <label><span>Projektdauer</span>
                <select className="cell-input" value={projekt.projektdauer || ''} onChange={e => patch({ projektdauer: e.target.value || null })}>
                  <option value="">—</option>
                  {PROJEKTDAUER_OPTIONEN.map(o => <option key={o} value={o}>{o}</option>)}
                  {projekt.projektdauer && !PROJEKTDAUER_OPTIONEN.includes(projekt.projektdauer) && <option value={projekt.projektdauer}>{projekt.projektdauer}</option>}
                </select>
              </label>
              <label className="slideover-full"><span>Gesuchte Positionen</span><DebouncedInput value={projekt.gesuchte_positionen || ''} onSave={patchField('gesuchte_positionen')} /></label>
              <label className="slideover-full"><span>Standorte</span><DebouncedInput value={projekt.standorte || ''} onSave={patchField('standorte')} /></label>
            </div>
          </section>

          {/* Phasen */}
          <section><h3>Phasen</h3>
            <div className="slideover-form">
              <label><span>Start Phase 1</span><input type="date" className="cell-input" value={projekt.start_phase1 || ''} onChange={e => patch({ start_phase1: e.target.value || null })} /></label>
              <label><span>Ende Phase 1</span><input type="date" className="cell-input" value={projekt.ende_phase1 || ''} onChange={e => patch({ ende_phase1: e.target.value || null })} /></label>
              <label className="slideover-full"><span>Phase 1 Einstellungen</span><DebouncedInput value={projekt.phase1_einstellungen || ''} onSave={patchField('phase1_einstellungen')} /></label>
              <label><span>Start Phase 2</span><input type="date" className="cell-input" value={projekt.start_phase2 || ''} onChange={e => patch({ start_phase2: e.target.value || null })} /></label>
              <label><span>Ende Phase 2</span><input type="date" className="cell-input" value={projekt.ende_phase2 || ''} onChange={e => patch({ ende_phase2: e.target.value || null })} /></label>
              <label className="slideover-full"><span>Phase 2 Einstellungen</span><DebouncedInput value={projekt.phase2_einstellungen || ''} onSave={patchField('phase2_einstellungen')} /></label>
            </div>
          </section>

          {/* Abo / Finanzen */}
          <section><h3>Abo & Finanzen</h3>
            <div className="slideover-form">
              <label><span>Startdatum Abo</span><input type="date" className="cell-input" value={projekt.startdatum_abo || ''} onChange={e => patch({ startdatum_abo: e.target.value || null })} /></label>
              <label><span>Enddatum Abo</span><input type="date" className="cell-input" value={projekt.enddatum_abo || ''} onChange={e => patch({ enddatum_abo: e.target.value || null })} /></label>
              <label><span>Pausiert seit</span><input type="date" className="cell-input" value={projekt.pausiert_seit || ''} onChange={e => patch({ pausiert_seit: e.target.value || null })} /></label>
              <label><span>Werbekosten</span><DebouncedInput value={projekt.werbekosten || ''} onSave={patchField('werbekosten')} /></label>
              <label><span>Ziel erreicht</span><input type="checkbox" checked={!!projekt.ziel_erreicht} onChange={e => patch({ ziel_erreicht: e.target.checked })} /></label>
              <label><span>RE bezahlt</span><input type="checkbox" checked={!!projekt.re_bezahlt} onChange={e => patch({ re_bezahlt: e.target.checked })} /></label>
              <label><span>RE 2 bezahlt</span><input type="checkbox" checked={!!projekt.re2_bezahlt} onChange={e => patch({ re2_bezahlt: e.target.checked })} /></label>
              <label><span>Bewertet</span><input type="checkbox" checked={!!projekt.bewertet} onChange={e => patch({ bewertet: e.target.checked })} /></label>
            </div>
          </section>

          {/* Kontakt */}
          <section><h3>Kontakt</h3>
            <div className="slideover-form">
              <label><span>E-Mail</span><DebouncedInput type="email" value={projekt.email || ''} onSave={patchField('email')} /></label>
              <label><span>Letzter Kontakt</span><input type="date" className="cell-input" value={projekt.letzter_kontakt || ''} onChange={e => patch({ letzter_kontakt: e.target.value || null })} /></label>
              <label className="slideover-full"><span>Kontaktstatus</span><DebouncedInput value={projekt.kontaktstatus || ''} onSave={patchField('kontaktstatus')} /></label>
              <label><span>Position im Unternehmen</span><DebouncedInput value={projekt.position_im_unternehmen || ''} onSave={patchField('position_im_unternehmen')} /></label>
              <label><span>Persönlichkeitstyp</span><DebouncedInput value={projekt.persoenlichkeitstyp || ''} onSave={patchField('persoenlichkeitstyp')} /></label>
            </div>
          </section>

          {/* Upsell */}
          <section><h3>Upsell</h3>
            <div className="slideover-form">
              <label><span>Ready for Upsell</span><input type="checkbox" checked={!!projekt.ready_for_upsell} onChange={e => patch({ ready_for_upsell: e.target.checked })} /></label>
              <label><span>Wer macht Upsell?</span><DebouncedInput value={projekt.upsell_wer || ''} onSave={patchField('upsell_wer')} /></label>
            </div>
          </section>

          {/* Notizen */}
          <section><h3>Notizen</h3>
            <DebouncedInput rows={4} value={projekt.notizen || ''} onSave={patchField('notizen')} />
          </section>

          {/* Onboarding-Checkliste */}
          <section>
            <h3>Onboarding-Checkliste ({CHECK_KEYS.filter(k => projekt.checkliste?.[k]).length}/{CHECK_KEYS.length})</h3>
            <div className="checklist-grid">
              {CHECK_KEYS.map(key => {
                const isAuto = autoKeys.includes(key);
                return (
                  <label key={key} className={`checklist-item ${projekt.checkliste?.[key] ? 'is-done' : ''}`}>
                    <input type="checkbox" checked={!!projekt.checkliste?.[key]} onChange={() => toggleCheck(key)} />
                    <span>{CHECK_LABELS[key]}</span>
                    {isAuto && <span className="checklist-auto" title="Auto-gesetzt aus Kampagnen-Tool">🔗</span>}
                  </label>
                );
              })}
            </div>
          </section>

          {/* Externe Verknüpfungen */}
          {(projekt.close_lead_id || projekt.kunde_id) && (
            <section><h3>Verknüpfungen</h3>
              <dl className="slideover-dl">
                {projekt.close_lead_id && <><dt>Close Lead</dt><dd><a href={`https://app.close.com/lead/${projekt.close_lead_id}`} target="_blank" rel="noreferrer">{projekt.close_lead_id} ↗</a></dd></>}
                {projekt.kunde_id && <><dt>TalentOne-Kunde</dt><dd><a href={`/kunden/${projekt.kunde_id}`}>Projekt öffnen ↗</a></dd></>}
                {projekt.pixel && <><dt>Pixel-ID</dt><dd style={{ fontFamily: 'monospace' }}>{projekt.pixel}</dd></>}
              </dl>
            </section>
          )}

          {/* Kommentare */}
          <section>
            <h3>Kommentare ({kommentare.length})</h3>
            <KommentarBlock
              team={team}
              kommentare={kommentare}
              onPost={async (text, erwaehnungen, autor) => {
                const res = await api(`/projekte/${projektId}/kommentare`, { method: 'POST', body: { text, erwaehnungen, autor } });
                setKommentare(prev => [res.kommentar, ...prev]);
              }}
              onEdit={async (id, text) => {
                const res = await api(`/projekte/kommentare/${id}`, { method: 'PATCH', body: { text } });
                setKommentare(prev => prev.map(k => k.id === id ? res.kommentar : k));
              }}
              onDelete={async (id) => {
                if (!confirm('Kommentar wirklich löschen?')) return;
                await api(`/projekte/kommentare/${id}`, { method: 'DELETE' });
                setKommentare(prev => prev.filter(k => k.id !== id));
              }}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}

/* ═════════════════════ KOMMENTAR-BLOCK mit @-Mention ═════════════════════ */

function KommentarBlock({ team, kommentare, onPost, onEdit, onDelete }) {
  const [text, setText] = useState('');
  const [autor, setAutor] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const textRef = useRef(null);

  function onChange(e) {
    const v = e.target.value;
    setText(v);
    const m = v.slice(0, e.target.selectionStart).match(/@(\w*)$/);
    if (m) { setMentionQuery(m[1]); setMentionOpen(true); }
    else setMentionOpen(false);
  }

  function insertMention(name) {
    const el = textRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    const before = text.slice(0, pos).replace(/@\w*$/, '');
    const after = text.slice(pos);
    const next = `${before}@${name} ${after}`;
    setText(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const newPos = before.length + name.length + 2;
      el.setSelectionRange(newPos, newPos);
    });
  }

  function extractMentions(s) {
    return team.map(m => m.name).filter(n => s.includes('@' + n));
  }

  async function submit() {
    if (!text.trim()) return;
    await onPost(text.trim(), extractMentions(text), autor.trim() || 'Mitarbeiter');
    setText('');
  }

  const filteredTeam = team.filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase()));

  function highlightText(s) {
    if (!s) return null;
    const parts = [];
    let last = 0;
    const re = new RegExp('@(' + team.map(m => m.name.replace(/[.\\+*?()|[\]{}^$]/g, '\\$&')).join('|') + ')', 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      parts.push(<span key={m.index} className="mention-chip">{m[0]}</span>);
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  }

  return (
    <div className="kommentar-block">
      <div className="kommentar-compose">
        <input className="cell-input" placeholder="Dein Name" value={autor} onChange={e => setAutor(e.target.value)} style={{ marginBottom: 6, fontSize: 12 }} />
        <textarea ref={textRef} className="cell-input" rows={3} placeholder="Neuer Kommentar — @Name für Erwähnung" value={text} onChange={onChange} />
        {mentionOpen && filteredTeam.length > 0 && (
          <div className="mention-dropdown">
            {filteredTeam.map(m => (
              <button key={m.name} type="button" onClick={() => insertMention(m.name)} className="mention-option">
                <strong>{m.name}</strong> <span className="muted">{m.email}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn-primary btn-sm" onClick={submit} disabled={!text.trim()}>Kommentar speichern</button>
        </div>
      </div>

      <div className="kommentar-list">
        {kommentare.map(k => (
          <div key={k.id} className={`kommentar-item ${k.quelle === 'airtable_import' ? 'is-airtable' : ''}`}>
            <div className="kommentar-meta">
              <strong>{k.autor || 'Unbekannt'}</strong>
              <span className="muted"> · {new Date(k.created_at).toLocaleString('de-DE')}</span>
              {k.quelle === 'airtable_import' && <span className="airtable-badge">Aus Airtable</span>}
            </div>
            {editId === k.id ? (
              <>
                <textarea className="cell-input" rows={3} value={editText} onChange={e => setEditText(e.target.value)} />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="btn-ghost btn-sm" onClick={() => { setEditId(null); setEditText(''); }}>Abbrechen</button>
                  <button className="btn-primary btn-sm" onClick={async () => { await onEdit(k.id, editText); setEditId(null); }}>Speichern</button>
                </div>
              </>
            ) : (
              <>
                <div className="kommentar-text">{highlightText(k.text)}</div>
                {k.quelle !== 'airtable_import' && (
                  <div className="kommentar-actions">
                    <button className="btn-ghost btn-sm" onClick={() => { setEditId(k.id); setEditText(k.text); }}>Bearbeiten</button>
                    <button className="btn-ghost btn-sm btn-danger" onClick={() => onDelete(k.id)}>Löschen</button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════ Create-Modal ═════════════════════ */

function CreateProjektModal({ team, onClose, onCreated }) {
  const [form, setForm] = useState({ projekt: '', kunde: '', projektart: '', gesuchte_positionen: '', standorte: '', verantwortlich: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr(''); setBusy(true);
    try { const res = await api('/projekte', { method: 'POST', body: form }); onCreated(res.projekt); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
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
        <label className="field field-full"><span>Projektname</span><input type="text" autoFocus value={form.projekt} onChange={e => setForm({ ...form, projekt: e.target.value })} /></label>
        <label className="field field-full"><span>Kunde / Firma</span><input type="text" value={form.kunde} onChange={e => setForm({ ...form, kunde: e.target.value })} /></label>
        <label className="field"><span>Projektart</span>
          <select value={form.projektart} onChange={e => setForm({ ...form, projektart: e.target.value })}>
            <option value="">—</option>
            {PROJEKTART_OPTIONEN.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="field"><span>Verantwortlich</span>
          <select value={form.verantwortlich} onChange={e => setForm({ ...form, verantwortlich: e.target.value })}>
            <option value="">—</option>
            {team.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </label>
        <label className="field field-full"><span>Gesuchte Positionen</span><input type="text" value={form.gesuchte_positionen} onChange={e => setForm({ ...form, gesuchte_positionen: e.target.value })} /></label>
        <label className="field field-full"><span>Standorte</span><input type="text" value={form.standorte} onChange={e => setForm({ ...form, standorte: e.target.value })} /></label>
      </div>
      {err && <div className="alert alert-error" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

/* ═════════════════════ MERGE-MODAL ═════════════════════ */

function MergeProjekteModal({ projekte, onCancel, onConfirm }) {
  const [hauptId, setHauptId] = useState(projekte[0]?.id || null);
  return (
    <Modal
      open={true}
      onClose={onCancel}
      title={`${projekte.length} Projekte zusammenführen`}
      footer={
        <>
          <button className="btn-ghost" onClick={onCancel}>Abbrechen</button>
          <button
            className="btn-primary"
            onClick={() => hauptId && onConfirm(hauptId)}
            disabled={!hauptId}
          >Zusammenführen</button>
        </>
      }
    >
      <p className="pane-hint">
        Wähle das <strong>Hauptprojekt</strong> — die anderen Projekte werden hineingeführt und anschließend gelöscht.
        Kommentare und Notizen aller Projekte werden übernommen, erledigte Checklisten-Punkte bleiben erledigt (OR-Logik).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {projekte.map(p => (
          <label
            key={p.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              border: '1.5px solid ' + (hauptId === p.id ? 'var(--accent-dark, #c8df00)' : 'var(--line, #e2e0dc)'),
              borderRadius: 10,
              background: hauptId === p.id ? 'rgba(232,255,61,0.10)' : '#fff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="haupt-projekt"
              checked={hauptId === p.id}
              onChange={() => setHauptId(p.id)}
              style={{ width: 16, height: 16 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--ink-1)' }}>{p.projekt || p.kunde || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {p.kunde && p.projekt ? p.kunde + ' · ' : ''}
                {p.status || '—'}
                {p.kommentar_count > 0 ? ` · ${p.kommentar_count} Kommentar${p.kommentar_count === 1 ? '' : 'e'}` : ''}
              </div>
            </div>
            {hauptId === p.id && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.06, textTransform: 'uppercase',
                padding: '2px 8px', background: 'var(--accent, #e8ff3d)', color: 'var(--ink-1)', borderRadius: 100,
              }}>Hauptprojekt</span>
            )}
          </label>
        ))}
      </div>
      <p className="pane-hint" style={{ marginTop: 14, fontSize: 12 }}>
        ⚠ <strong>Kann nicht rückgängig gemacht werden.</strong> Verknüpfte TalentOne-Kunden (Creatives, Funnels, …) bleiben unberührt.
      </p>
    </Modal>
  );
}
