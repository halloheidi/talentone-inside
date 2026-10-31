import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// Lead-ID aus Freitext/URL extrahieren (lead_xxx) bzw. abschließenden / entfernen.
export function parseLeadId(input) {
  const s = String(input || '').trim();
  const m = s.match(/lead_[A-Za-z0-9]+/);
  if (m) return m[0];
  return s.replace(/\/+$/, '');
}

/**
 * Close-Lead am Angebot verknüpfen (Schritt 3, beide Tabs). Funktioniert MIT und
 * OHNE Inside-Kunden: mit Kunde wird dessen close_lead_id vorbefüllt + bei Änderung
 * zurückgeschrieben; ohne Kunde bleibt die ID am Angebot (über onLeadChange nach
 * oben gereicht und mit dem Angebot gespeichert). Lead per Firmenname-Suche ODER
 * Lead-ID/URL einfügen.
 */
export default function CloseVerknuepfenBox({ kundeId, firmenname, initialLeadId = null, onLeadChange }) {
  const [leadId, setLeadId] = useState(initialLeadId);
  const [leadName, setLeadName] = useState(null);
  const [geladen, setGeladen] = useState(!kundeId); // ohne Kunde direkt bereit
  const [aendern, setAendern] = useState(false);
  const [q, setQ] = useState(firmenname || '');
  const [paste, setPaste] = useState('');
  const [treffer, setTreffer] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoSuche = useRef(false);

  // Mit Inside-Kunden: dessen close_lead_id als Startwert laden.
  useEffect(() => {
    if (!kundeId) { setGeladen(true); return; }
    api(`/kunden/${kundeId}`).then(r => {
      const id = r.kunde?.close_lead_id || initialLeadId || null;
      setLeadId(id); setGeladen(true);
      if (id) onLeadChange?.(id);
    }).catch(() => setGeladen(true));
    // eslint-disable-next-line
  }, [kundeId]);

  async function suchen() {
    if (!q.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await api(`/offers/ki/lead-suche?q=${encodeURIComponent(q.trim())}`);
      setTreffer(r.leads || []);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (geladen && !leadId && !autoSuche.current && q.trim()) { autoSuche.current = true; suchen(); }
    // eslint-disable-next-line
  }, [geladen, leadId]);

  async function setzen(id, name = null) {
    setBusy(true); setError('');
    try {
      if (kundeId) await api('/offers/ki/close-verknuepfen', { method: 'POST', body: { kunde_id: kundeId, lead_id: id } });
      setLeadId(id); setLeadName(name); setAendern(false); setTreffer([]); setPaste('');
      onLeadChange?.(id);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function pasteUebernehmen() {
    const id = parseLeadId(paste);
    if (!id) return;
    setzen(id, null);
  }

  if (!geladen) return null;
  const verknuepft = leadId && !aendern;

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16, background: verknuepft ? '#f0fdf4' : '#fffbeb', border: `1px solid ${verknuepft ? '#86efac' : '#fde68a'}` }}>
      {verknuepft ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
          <span>✓ Close-Lead verknüpft{leadName ? `: ${leadName}` : ''} <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>({leadId})</span></span>
          <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setAendern(true)}>ändern</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#92400e' }}>Close-Lead verknüpfen</div>
          <div style={{ fontSize: 12.5, color: '#92400e' }}>Ohne Verknüpfung fehlt der Close-Gesprächskontext für das KI-Angebot.{!kundeId && ' (Altkunde ohne Inside-Kunden — die ID bleibt am Angebot.)'}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="Firmenname…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && suchen()} style={{ flex: 1 }} />
            <button className="btn-ghost" disabled={busy} onClick={suchen}>Suchen</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="…oder Lead-ID / Lead-URL einfügen" value={paste} onChange={e => setPaste(e.target.value)} onKeyDown={e => e.key === 'Enter' && pasteUebernehmen()} style={{ flex: 1 }} />
            <button className="btn-ghost" disabled={busy || !paste.trim()} onClick={pasteUebernehmen}>Übernehmen</button>
          </div>
          {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gap: 4 }}>
            {treffer.map(l => (
              <button key={l.id} className="btn-ghost" style={{ justifyContent: 'flex-start', fontSize: 12.5 }} disabled={busy} onClick={() => setzen(l.id, l.name)}>
                {l.name}{l.ort ? ` · ${l.ort}` : ''}{l.status ? ` · ${l.status}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
