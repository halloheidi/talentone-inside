import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

/**
 * Erster Schritt im Angebots-Wizard (beide Tabs): Close-Lead verknüpfen, wenn der
 * Kunde noch keine close_lead_id hat. Überspringbar. Bei vorhandener ID: Name +
 * „ändern". Speichert kunden.close_lead_id über /offers/ki/close-verknuepfen.
 */
export default function CloseVerknuepfenBox({ kundeId, firmenname }) {
  const [leadId, setLeadId] = useState(undefined); // undefined = lädt, null = keiner, string = verknüpft
  const [leadName, setLeadName] = useState(null);
  const [aendern, setAendern] = useState(false);
  const [q, setQ] = useState(firmenname || '');
  const [treffer, setTreffer] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const geladen = useRef(false);

  useEffect(() => {
    if (!kundeId) { setLeadId(null); return; }
    api(`/kunden/${kundeId}`).then(r => {
      setLeadId(r.kunde?.close_lead_id || null);
    }).catch(() => setLeadId(null));
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
  // Treffer einmalig automatisch laden, wenn kein Lead verknüpft ist.
  useEffect(() => {
    if (leadId === null && !geladen.current && q.trim()) { geladen.current = true; suchen(); }
    // eslint-disable-next-line
  }, [leadId]);

  async function waehlen(lead) {
    setBusy(true); setError('');
    try {
      await api('/offers/ki/close-verknuepfen', { method: 'POST', body: { kunde_id: kundeId, lead_id: lead.id } });
      setLeadId(lead.id); setLeadName(lead.name); setAendern(false); setTreffer([]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!kundeId || leadId === undefined) return null;

  const verknuepft = leadId && !aendern;

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16, background: verknuepft ? '#f0fdf4' : '#fffbeb', border: `1px solid ${verknuepft ? '#86efac' : '#fde68a'}` }}>
      {verknuepft ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
          <span>✓ Close-Lead verknüpft{leadName ? `: ${leadName}` : ''}</span>
          <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setAendern(true)}>ändern</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#92400e' }}>Close-Lead verknüpfen</div>
          <div style={{ fontSize: 12.5, color: '#92400e' }}>Ohne Verknüpfung fehlt der Close-Gesprächskontext für das KI-Angebot.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="Firmenname…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && suchen()} style={{ flex: 1 }} />
            <button className="btn-ghost" disabled={busy} onClick={suchen}>Suchen</button>
          </div>
          {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gap: 4 }}>
            {treffer.map(l => (
              <button key={l.id} className="btn-ghost" style={{ justifyContent: 'flex-start', fontSize: 12.5 }} disabled={busy} onClick={() => waehlen(l)}>
                {l.name}{l.ort ? ` · ${l.ort}` : ''}{l.status ? ` · ${l.status}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
