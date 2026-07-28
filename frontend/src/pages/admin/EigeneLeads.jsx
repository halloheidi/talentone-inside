// Admin-Bereich "🎯 Eigene Leads": importierte Meta-Lead-Ads-Leads + Konfiguration
// der Sheet-Quellen inkl. dynamischem Close-Mapping (feste Felder, Task, Status).

import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Modal from '../../components/Modal.jsx';

const STATUS_BADGE = {
  ok: { bg: '#dcfce7', fg: '#166534', label: '✓ In Close' },
  ausstehend: { bg: '#fef3c7', fg: '#92400e', label: '⏳ Close-Sync ausstehend' },
  fehler: { bg: '#fee2e2', fg: '#991b1b', label: '⚠️ Fehler' },
};

const leerQuelle = () => ({
  name: '', spreadsheet_id: '', sheet_name: '', aktiv: true, benachrichtigung: true,
  close_task_text: '', close_task_assignee: '', close_task_faelligkeit: { mode: 'today' },
  close_fixed_fields: [], close_lead_status_id: '', spalten_mapping: [],
});

export default function EigeneLeads() {
  const [tab, setTab] = useState('leads');
  const [leads, setLeads] = useState([]);
  const [quellen, setQuellen] = useState([]);
  const [meta, setMeta] = useState({ users: [], customFields: [], statuses: [], service_account_email: null });
  const [edit, setEdit] = useState(null);      // Quelle im Editor (oder null)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);

  async function load() {
    const [l, q, m] = await Promise.all([
      api('/eigene-leads').catch(() => ({ leads: [] })),
      api('/eigene-leads/quellen').catch(() => ({ quellen: [] })),
      api('/eigene-leads/close-metadata').catch(() => ({})),
    ]);
    setLeads(l.leads || []);
    setQuellen(q.quellen || []);
    setMeta({ users: m.users || [], customFields: m.customFields || [], statuses: m.statuses || [], service_account_email: m.service_account_email || null });
  }
  useEffect(() => { load(); }, []);

  function flash(text, isErr = false) { setErr(isErr); setMsg(text); setTimeout(() => setMsg(''), 4000); }

  async function saveQuelle() {
    if (!edit.name?.trim() || !edit.spreadsheet_id?.trim()) { flash('Name und Spreadsheet-ID sind Pflicht.', true); return; }
    setBusy(true);
    try {
      const body = { ...edit };
      if (edit.id) await api(`/eigene-leads/quellen/${edit.id}`, { method: 'PATCH', body });
      else await api('/eigene-leads/quellen', { method: 'POST', body });
      setEdit(null); await load(); flash('Quelle gespeichert.');
    } catch (e) { flash(e.body?.error || e.message, true); }
    finally { setBusy(false); }
  }
  async function deleteQuelle(q) {
    if (!confirm(`Quelle "${q.name}" löschen? Die bereits importierten Leads bleiben erhalten.`)) return;
    try { await api(`/eigene-leads/quellen/${q.id}`, { method: 'DELETE' }); await load(); flash('Quelle gelöscht.'); }
    catch (e) { flash(e.message, true); }
  }
  async function testLead(q) {
    setBusy(true);
    try {
      const r = await api(`/eigene-leads/quellen/${q.id}/test`, { method: 'POST' });
      await load();
      flash(r.ok ? `Test-Lead nach Close übertragen (${r.close_lead_id}). Bitte in Close prüfen und danach löschen.` : `Test-Lead angelegt, Close-Fehler: ${r.error}`, !r.ok);
    } catch (e) { flash(e.body?.error || e.message, true); }
    finally { setBusy(false); }
  }
  async function pollNow() {
    setBusy(true);
    try { const r = await api('/eigene-leads/poll', { method: 'POST' }); await load(); flash(`Poll fertig — ${r.neu || 0} neue Lead(s).`); }
    catch (e) { flash(e.body?.error || e.message, true); }
    finally { setBusy(false); }
  }
  async function deleteLead(lead) {
    if (!confirm(`Lead "${lead.name || '—'}" löschen?${lead.ist_test && lead.close_lead_id ? ' (inkl. Close-Test-Lead)' : ''}`)) return;
    try {
      const q = lead.ist_test ? '?close=1' : '';
      await api(`/eigene-leads/${lead.id}${q}`, { method: 'DELETE' });
      await load(); flash('Lead gelöscht.');
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🎯 Eigene Leads</h1>
          <p className="page-sub">Meta-Lead-Ads aus Google Sheets — automatisch ins Tool und nach Close (inkl. Task).</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={pollNow} disabled={busy}>↻ Jetzt pollen</button>
          {tab === 'quellen' && <button className="btn-primary" onClick={() => setEdit(leerQuelle())}>+ Neue Quelle</button>}
        </div>
      </div>

      {meta.service_account_email && (
        <div className="alert" style={{ background: '#f0f9ff', border: '1px solid #bae6fd', color: '#075985', marginBottom: 12, fontSize: 13 }}>
          📄 Sheet für diese Service-Account-Adresse als <strong>Betrachter</strong> freigeben: <code>{meta.service_account_email}</code>
        </div>
      )}
      {msg && <div className={`alert ${err ? 'alert-error' : ''}`} style={{ marginBottom: 12, ...(err ? {} : { background: '#dcfce7', color: '#166534' }) }}>{msg}</div>}

      <div className="tabs" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button className={tab === 'leads' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTab('leads')}>Leads ({leads.length})</button>
        <button className={tab === 'quellen' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTab('quellen')}>Quellen ({quellen.length})</button>
      </div>

      {tab === 'leads' && (
        <div className="bewerbungen-table-scroll">
          <table className="bewerbungen-table">
            <thead><tr>
              <th>Name</th><th>Kontakt</th><th>Kampagne / Quelle</th><th>Datum</th><th>Close</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {leads.length === 0 && <tr><td colSpan={7} style={{ padding: 20, color: 'var(--ink-3)' }}>Noch keine Leads importiert.</td></tr>}
              {leads.map(l => {
                const b = STATUS_BADGE[l.close_status] || STATUS_BADGE.ausstehend;
                return (
                  <tr key={l.id}>
                    <td><strong>{l.name || '—'}</strong>{l.ist_test && <span style={{ marginLeft: 6, fontSize: 10, background: '#fde68a', padding: '1px 5px', borderRadius: 4 }}>TEST</span>}</td>
                    <td>{[l.telefon, l.email].filter(Boolean).map((x, i) => <div key={i} style={{ fontSize: 12 }}>{x}</div>)}</td>
                    <td>{l.kampagne || l.quelle_name || '—'}</td>
                    <td style={{ fontSize: 12 }}>{new Date(l.created_at).toLocaleString('de-DE')}</td>
                    <td>{l.close_lead_id ? <a href={`https://app.close.com/lead/${l.close_lead_id}/`} target="_blank" rel="noreferrer">öffnen ↗</a> : '—'}</td>
                    <td><span style={{ background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }} title={l.close_error || ''}>{b.label}</span></td>
                    <td><button className="btn-ghost btn-sm" onClick={() => deleteLead(l)}>Löschen</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'quellen' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {quellen.length === 0 && <div className="card empty">Noch keine Sheet-Quelle angelegt.</div>}
          {quellen.map(q => (
            <div key={q.id} className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{q.name} {!q.aktiv && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>(inaktiv)</span>}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  Sheet: {q.spreadsheet_id?.slice(0, 18)}… {q.sheet_name ? `· ${q.sheet_name}` : ''} · {(q.close_fixed_fields || []).length} feste Felder · Task: {q.close_task_text ? '✓' : '—'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className="btn-ghost btn-sm" onClick={() => testLead(q)} disabled={busy}>🧪 Test-Lead</button>
                <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...leerQuelle(), ...q })}>Bearbeiten</button>
                <button className="btn-ghost btn-sm" onClick={() => deleteQuelle(q)}>Löschen</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <QuelleEditor
          quelle={edit} setQuelle={setEdit} meta={meta} busy={busy}
          onSave={saveQuelle} onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────── Quellen-Editor (Modal) ─────────────────────── */
function QuelleEditor({ quelle, setQuelle, meta, busy, onSave, onClose }) {
  const set = (patch) => setQuelle({ ...quelle, ...patch });
  const fields = meta.customFields || [];
  const fieldById = (id) => fields.find(f => f.id === id);

  const faell = quelle.close_task_faelligkeit || { mode: 'today' };

  return (
    <Modal open onClose={onClose} title={quelle.id ? 'Quelle bearbeiten' : 'Neue Quelle'} footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button className="btn-primary" onClick={onSave} disabled={busy}>{busy ? 'Speichere…' : 'Speichern'}</button>
      </>
    }>
      <div className="form-grid">
        <label className="field field-full"><span>Name der Quelle</span>
          <input value={quelle.name} onChange={e => set({ name: e.target.value })} placeholder="z. B. N&W Solar" />
        </label>
        <label className="field field-full"><span>Google-Spreadsheet-ID</span>
          <input value={quelle.spreadsheet_id} onChange={e => set({ spreadsheet_id: e.target.value })} placeholder="aus der Sheet-URL (…/d/<ID>/edit)" />
        </label>
        <label className="field"><span>Tabellenblatt (leer = erstes)</span>
          <input value={quelle.sheet_name || ''} onChange={e => set({ sheet_name: e.target.value })} placeholder="optional" />
        </label>
        <label className="field-checkbox"><input type="checkbox" checked={!!quelle.aktiv} onChange={e => set({ aktiv: e.target.checked })} /><span>Aktiv (wird gepollt)</span></label>
        <label className="field-checkbox"><input type="checkbox" checked={quelle.benachrichtigung !== false} onChange={e => set({ benachrichtigung: e.target.checked })} /><span>Interne Benachrichtigungs-Mail pro Lead</span></label>
      </div>

      {/* ── Close-Lead-Status ── */}
      <h3 style={{ marginTop: 18, fontSize: 14 }}>Close-Lead</h3>
      <label className="field field-full"><span>Lead-Status</span>
        <select value={quelle.close_lead_status_id || ''} onChange={e => set({ close_lead_status_id: e.target.value })}>
          <option value="">— (Close-Default) —</option>
          {(meta.statuses || []).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>

      {/* ── Feste Close-Felder ── */}
      <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Feste Close-Felder (bei jedem Lead dieser Quelle)</span>
          <button className="btn-ghost btn-sm" onClick={() => set({ close_fixed_fields: [...(quelle.close_fixed_fields || []), { field_id: '', field_name: '', value: '' }] })}>+ Feld</button>
        </div>
        {(quelle.close_fixed_fields || []).map((row, i) => {
          const f = fieldById(row.field_id);
          const update = (patch) => { const a = [...quelle.close_fixed_fields]; a[i] = { ...a[i], ...patch }; set({ close_fixed_fields: a }); };
          return (
            <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
              <select value={row.field_id} onChange={e => update({ field_id: e.target.value, field_name: fieldById(e.target.value)?.name || '', value: '' })} style={{ flex: 1 }}>
                <option value="">— Close-Feld —</option>
                {fields.map(cf => <option key={cf.id} value={cf.id}>{cf.name} ({cf.type})</option>)}
              </select>
              {f?.type === 'choices'
                ? <select value={row.value} onChange={e => update({ value: e.target.value })} style={{ flex: 1 }}>
                    <option value="">— Wert —</option>
                    {(f.choices || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                : f?.type === 'user'
                ? <select value={row.value} onChange={e => update({ value: e.target.value })} style={{ flex: 1 }}>
                    <option value="">— User —</option>
                    {(meta.users || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                : <input value={row.value} onChange={e => update({ value: e.target.value })} placeholder="Wert" style={{ flex: 1 }} />}
              <button className="btn-ghost btn-sm" onClick={() => set({ close_fixed_fields: quelle.close_fixed_fields.filter((_, x) => x !== i) })}>×</button>
            </div>
          );
        })}
      </div>

      {/* ── Task ── */}
      <h3 style={{ marginTop: 18, fontSize: 14 }}>Close-Task</h3>
      <label className="field field-full"><span>Task-Text (Platzhalter: [Name], [Telefon], [Kampagne], [Sheet-Feld:X])</span>
        <input value={quelle.close_task_text || ''} onChange={e => set({ close_task_text: e.target.value })} placeholder="z. B. Neuen Solar-Lead [Name] anrufen ([Telefon])" />
      </label>
      <div className="form-grid">
        <label className="field"><span>Zugewiesen an</span>
          <select value={quelle.close_task_assignee || ''} onChange={e => set({ close_task_assignee: e.target.value })}>
            <option value="">— niemand —</option>
            {(meta.users || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Fälligkeit</span>
          <select value={faell.mode === 'plus_days' ? `plus_${faell.days || 1}` : 'today'}
            onChange={e => { const v = e.target.value; set({ close_task_faelligkeit: v === 'today' ? { mode: 'today' } : { mode: 'plus_days', days: Number(v.split('_')[1]) } }); }}>
            <option value="today">Heute</option>
            <option value="plus_1">+1 Tag</option>
            <option value="plus_3">+3 Tage</option>
            <option value="plus_7">+7 Tage</option>
          </select>
        </label>
      </div>

      {/* ── Spalten -> Close-Custom-Field-Mapping ── */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Sheet-Spalte → Close-Feld (optional)</span>
          <button className="btn-ghost btn-sm" onClick={() => set({ spalten_mapping: [...(quelle.spalten_mapping || []), { sheet_col: '', close_field_id: '', close_field_name: '' }] })}>+ Zuordnung</button>
        </div>
        {(quelle.spalten_mapping || []).map((row, i) => {
          const update = (patch) => { const a = [...quelle.spalten_mapping]; a[i] = { ...a[i], ...patch }; set({ spalten_mapping: a }); };
          return (
            <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
              <input value={row.sheet_col} onChange={e => update({ sheet_col: e.target.value })} placeholder="Sheet-Spaltenname (Header)" style={{ flex: 1 }} />
              <span>→</span>
              <select value={row.close_field_id} onChange={e => update({ close_field_id: e.target.value, close_field_name: fieldById(e.target.value)?.name || '' })} style={{ flex: 1 }}>
                <option value="">— Close-Feld —</option>
                {fields.map(cf => <option key={cf.id} value={cf.id}>{cf.name}</option>)}
              </select>
              <button className="btn-ghost btn-sm" onClick={() => set({ spalten_mapping: quelle.spalten_mapping.filter((_, x) => x !== i) })}>×</button>
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-3)' }}>
        Kontaktdaten (Name, Telefon, E-Mail) werden automatisch aus den Sheet-Spalten erkannt; alle übrigen Antworten landen als Note am Close-Lead.
      </p>
    </Modal>
  );
}
