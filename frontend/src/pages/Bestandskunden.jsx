import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';

const eur = n => `${Math.round(Number(n) || 0).toLocaleString('de-DE')} €`;
const datum = d => (d ? new Date(d).toLocaleDateString('de-DE') : '—');
const monatJahr = d => (d ? new Date(d).toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' }) : '—');

const STATUS = {
  aktiv:        { label: 'Aktiv',            color: '#15803d', bg: '#dcfce7' },
  inaktiv_1_2:  { label: 'Inaktiv 1–2 J',    color: '#a16207', bg: '#fef9c3' },
  inaktiv_2plus:{ label: 'Inaktiv > 2 J',    color: '#c2410c', bg: '#ffedd5' },
};
const REAKT = { offen: 'Offen', angehen: 'Angehen', verbrannt: 'Verbrannt' };

export default function Bestandskunden() {
  const [kunden, setKunden] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reaktFilter, setReaktFilter] = useState('');
  const [zustFilter, setZustFilter] = useState('');
  const [sort, setSort] = useState({ key: 'inaktiv', dir: 'asc' });
  const [detail, setDetail] = useState(null);        // kunde für Drawer
  const [detailRechnungen, setDetailRechnungen] = useState(null);
  const [leadChoice, setLeadChoice] = useState(null); // { kunde, candidates }
  const [refreshing, setRefreshing] = useState(false);

  const userMap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u.name])), [users]);

  async function load() {
    setLoading(true);
    try {
      const [kres, ures] = await Promise.all([
        api('/bestandskunden'),
        api('/bestandskunden/close-users').catch(() => ({ users: [] })),
      ]);
      setKunden(kres.kunden || []);
      setUsers(ures.users || []);
    } catch (err) { setNotice('Fehler: ' + err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function applyResult(id, res) {
    if (res.needs_lead_choice) {
      setLeadChoice({ kunde: res.kunde, candidates: res.candidates || [] });
      return;
    }
    if (res.kunde) setKunden(prev => prev.map(k => k.id === id ? { ...k, ...res.kunde } : k));
    if (res.close_warnung) setNotice('⚠️ ' + res.close_warnung);
  }

  async function updateField(id, field, value) {
    setKunden(prev => prev.map(k => k.id === id ? { ...k, [field]: value } : k));
    setBusyId(id); setNotice('');
    try {
      const res = await api(`/bestandskunden/${id}`, { method: 'PATCH', body: { [field]: value } });
      applyResult(id, res);
    } catch (err) { setNotice('Fehler: ' + err.message); load(); }
    finally { setBusyId(null); }
  }

  async function chooseLead(candidateId) {
    const id = leadChoice.kunde.id;
    setLeadChoice(null); setBusyId(id);
    try {
      const res = await api(`/bestandskunden/${id}`, { method: 'PATCH', body: { close_lead_id: candidateId } });
      applyResult(id, res);
      setNotice('Lead verknüpft ✓');
    } catch (err) { setNotice('Fehler: ' + err.message); }
    finally { setBusyId(null); }
  }

  async function openDetail(k) {
    setDetail(k); setDetailRechnungen(null);
    try { const res = await api(`/bestandskunden/${k.id}/rechnungen`); setDetailRechnungen(res.rechnungen || []); }
    catch { setDetailRechnungen([]); }
  }

  async function refreshCloseStatus() {
    setRefreshing(true); setNotice('');
    try { await api('/bestandskunden/close-status-refresh', { method: 'POST' }); await load(); setNotice('Close-Status aktualisiert ✓'); }
    catch (err) { setNotice('Fehler: ' + err.message); }
    finally { setRefreshing(false); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = kunden.filter(k => {
      if (statusFilter && k.status !== statusFilter) return false;
      if (reaktFilter && k.reaktivierung !== reaktFilter) return false;
      if (zustFilter && k.zustaendig_close_user_id !== zustFilter) return false;
      if (q) {
        const hay = [k.firma, k.fruehere_bezeichnung, k.ort, k.kundennummer].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sort.key === 'inaktiv') {
        // Default: inaktivste zuerst (älteste letzte_rechnung, null ganz oben), dann Umsatz absteigend
        const la = a.letzte_rechnung || '', lb = b.letzte_rechnung || '';
        if (la !== lb) return la < lb ? -1 : 1;
        return (Number(b.umsatz_netto) || 0) - (Number(a.umsatz_netto) || 0);
      }
      if (sort.key === 'umsatz') return dir * ((Number(a.umsatz_netto) || 0) - (Number(b.umsatz_netto) || 0));
      if (sort.key === 'letzte') return dir * ((a.letzte_rechnung || '') < (b.letzte_rechnung || '') ? -1 : 1);
      if (sort.key === 'firma') return dir * String(a.firma || '').localeCompare(String(b.firma || ''));
      return 0;
    });
    return list;
  }, [kunden, search, statusFilter, reaktFilter, zustFilter, sort]);

  const setSortKey = key => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Bestandskunden</h1>
          <p className="page-sub">Alle Rechnungskunden seit 2021 — Reaktivierungs-Steuerung. {kunden.length} Kunden.</p>
        </div>
        <button className="btn-ghost" onClick={refreshCloseStatus} disabled={refreshing}>
          {refreshing ? '⏳ Aktualisiere…' : '↻ Close-Status abgleichen'}
        </button>
      </div>

      {notice && <div className={`alert ${notice.startsWith('Fehler') ? 'alert-error' : 'alert-info'}`} style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="filter-bar" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input placeholder="Suche: Firma, Ort, Kundennr." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: '1 1 240px', minWidth: 200 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Alle Status</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={reaktFilter} onChange={e => setReaktFilter(e.target.value)}>
          <option value="">Alle Reaktivierung</option>
          {Object.entries(REAKT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={zustFilter} onChange={e => setZustFilter(e.target.value)}>
          <option value="">Alle Zuständigen</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--ink-3,#666)' }}>{filtered.length} angezeigt</span>
      </div>

      {loading ? <div className="full-loading">Lade…</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>Status</th>
                <th style={{ cursor: 'pointer' }} onClick={() => setSortKey('firma')}>Firma</th>
                <th>Ort</th>
                <th style={{ cursor: 'pointer' }} onClick={() => setSortKey('letzte')}>Letzte Rg.</th>
                <th>Anz.</th>
                <th style={{ cursor: 'pointer' }} onClick={() => setSortKey('umsatz')}>Umsatz netto</th>
                <th>Reaktivierung</th>
                <th>Zuständig</th>
                <th>Close-Task</th>
                <th>Notiz</th>
                <th>Telefon / E-Mail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(k => {
                const st = STATUS[k.status] || STATUS.inaktiv_2plus;
                const isBusy = busyId === k.id;
                return (
                  <tr key={k.id} style={{ opacity: isBusy ? 0.6 : 1 }}>
                    <td><span style={{ padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, whiteSpace: 'nowrap' }}>{st.label}</span></td>
                    <td>
                      <button onClick={() => openDetail(k)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 600, color: '#0a0a0a' }}>
                        {k.firma}
                      </button>
                      <div style={{ fontSize: 11, color: 'var(--ink-4,#999)' }}>
                        Nr. {k.kundennummer}{k.fruehere_bezeichnung ? ` · früher: ${k.fruehere_bezeichnung}` : ''}
                      </div>
                    </td>
                    <td>{k.ort || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{datum(k.letzte_rechnung)}</td>
                    <td>{k.anzahl_rechnungen || 0}</td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(k.umsatz_netto)}</td>
                    <td>
                      <select className="cell-input" value={k.reaktivierung} disabled={isBusy}
                        onChange={e => updateField(k.id, 'reaktivierung', e.target.value)}>
                        {Object.entries(REAKT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="cell-input" value={k.zustaendig_close_user_id || ''} disabled={isBusy}
                        onChange={e => updateField(k.id, 'zustaendig_close_user_id', e.target.value)}>
                        <option value="">—</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {k.close_task_status === 'offen'
                        ? <span style={{ color: '#a16207' }}>offen{k.zustaendig_close_user_id ? ` · ${userMap[k.zustaendig_close_user_id] || ''}` : ''}</span>
                        : k.close_task_status === 'erledigt'
                        ? <span style={{ color: '#15803d' }}>✓ erledigt</span>
                        : <span style={{ color: 'var(--ink-4,#999)' }}>—</span>}
                      {k.close_lead_id && <> · <a href={`https://app.close.com/lead/${k.close_lead_id}/`} target="_blank" rel="noreferrer">Lead</a></>}
                    </td>
                    <td>
                      <input className="cell-input" defaultValue={k.notiz || ''} placeholder="Notiz…" style={{ minWidth: 120 }}
                        onBlur={e => { if ((e.target.value || '') !== (k.notiz || '')) updateField(k.id, 'notiz', e.target.value); }} />
                    </td>
                    <td>
                      <input className="cell-input" defaultValue={k.telefon || ''} placeholder="Tel." style={{ width: 110 }}
                        onBlur={e => { if ((e.target.value || '') !== (k.telefon || '')) updateField(k.id, 'telefon', e.target.value); }} />
                      <input className="cell-input" defaultValue={k.email || ''} placeholder="E-Mail" style={{ width: 150, marginTop: 3 }}
                        onBlur={e => { if ((e.target.value || '') !== (k.email || '')) updateField(k.id, 'email', e.target.value); }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail-Drawer: Rechnungshistorie */}
      {detail && (
        <Modal open onClose={() => setDetail(null)} title={`${detail.firma} — Rechnungen`}>
          <div style={{ fontSize: 13, marginBottom: 10, color: 'var(--ink-3,#666)' }}>
            Kundennr. {detail.kundennummer} · {detail.ort || '—'} · Umsatz netto gesamt {eur(detail.umsatz_netto)} · Quelle: {detail.quelle || '—'}
          </div>
          {detailRechnungen === null ? <div>Lade…</div> : detailRechnungen.length === 0 ? <div>Keine Rechnungen.</div> : (
            <table className="table" style={{ width: '100%', fontSize: 13 }}>
              <thead><tr><th>Datum</th><th>Beleg</th><th>Art</th><th style={{ textAlign: 'right' }}>Netto</th><th style={{ textAlign: 'right' }}>Brutto</th><th>Quelle</th></tr></thead>
              <tbody>
                {detailRechnungen.map(r => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{datum(r.datum)}</td>
                    <td>{r.dokument_nr || '—'}</td>
                    <td>{r.art}</td>
                    <td style={{ textAlign: 'right' }}>{r.netto != null ? eur(r.netto) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.brutto != null ? eur(r.brutto) : '—'}</td>
                    <td>{r.quelle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {/* Lead-Kandidaten-Auswahl (mehrdeutig) */}
      {leadChoice && (
        <Modal open onClose={() => setLeadChoice(null)} title="Close-Lead auswählen"
          footer={<button className="btn-ghost" onClick={() => setLeadChoice(null)}>Abbrechen</button>}>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            Mehrere mögliche Leads für <strong>{leadChoice.kunde?.firma}</strong>. Bitte den richtigen wählen — es wird nichts geraten.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {leadChoice.candidates.map(c => (
              <button key={c.id} className="btn-ghost" style={{ textAlign: 'left' }} onClick={() => chooseLead(c.id)}>
                {c.name} <span style={{ color: 'var(--ink-4,#999)', fontSize: 11 }}>({c.id})</span>
              </button>
            ))}
            {leadChoice.candidates.length === 0 && <div style={{ fontSize: 13 }}>Keine Kandidaten gefunden.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
