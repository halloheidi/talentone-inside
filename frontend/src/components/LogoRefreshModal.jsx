// Logo-Tausch auf bestehende Creatives — rendert nur die Logo-Schicht neu,
// ohne die KI-Bilder neu zu generieren (Motiv/Text bleiben identisch).
//
// Zeigt alle aktiven Creatives mit Checkboxen; tauschbare (mit Basisbild bzw.
// Overlay) sind vorausgewählt, nicht-tauschbare (Video / kein Basisbild) sind
// deaktiviert mit Begründung. Läuft eine offene Review-Runde, gibt es einen
// Transparenz-Hinweis (kein Blocker).

import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

export default function LogoRefreshModal({ open, jobId, onClose, onDone }) {
  const [info, setInfo] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ergebnis, setErgebnis] = useState(null);

  useEffect(() => {
    if (!open) { setInfo(null); setErgebnis(null); setErr(''); setSel(new Set()); return; }
    setLoading(true); setErr('');
    api(`/creatives/logo-refresh-info?job_id=${jobId}`)
      .then(res => {
        setInfo(res);
        // Vorauswahl: alle tauschbaren, die noch die alte Logo-Fassung tragen.
        const pre = new Set(
          (res.creatives || []).filter(c => c.swappable && c.veraltet).map(c => c.id)
        );
        setSel(pre);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open, jobId]);

  const creatives = info?.creatives || [];
  const swappable = creatives.filter(c => c.swappable);
  const blocked = creatives.filter(c => !c.swappable);

  function toggle(id) {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function alleAn() { setSel(new Set(swappable.map(c => c.id))); }
  function alleAus() { setSel(new Set()); }

  async function ausfuehren() {
    if (sel.size === 0) return;
    setBusy(true); setErr('');
    try {
      const res = await api('/creatives/logo-refresh', {
        method: 'POST',
        body: { job_id: jobId, creative_ids: [...sel] },
      });
      setErgebnis(res);
      onDone?.(); // Galerie neu laden
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const alleSwappableGewaehlt = swappable.length > 0 && swappable.every(c => sel.has(c.id));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="🔄 Logo auf Creatives aktualisieren"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            {ergebnis ? 'Schließen' : 'Abbrechen'}
          </button>
          {!ergebnis && (
            <button className="btn-primary" onClick={ausfuehren} disabled={busy || sel.size === 0}>
              {busy ? 'Rendere neu…' : `${sel.size} Creative${sel.size === 1 ? '' : 's'} aktualisieren`}
            </button>
          )}
        </div>
      }
    >
      {loading && <div className="card empty">Lade Creatives…</div>}
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}

      {!loading && info && !ergebnis && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 0 }}>
            Das aktuelle Logo wird als neue Schicht über das gespeicherte KI-Bild gerendert —
            Motiv und Text bleiben identisch, keine Neu-Generierung.
          </p>

          {info.offene_review && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
              padding: '10px 14px', fontSize: 13, color: '#78350f', marginBottom: 12,
            }}>
              ⚠️ Es läuft eine offene Review-Runde{info.review_runde ? ` (Runde ${info.review_runde})` : ''} —
              aktualisierte Creatives erscheinen dort <strong>sofort</strong> beim Kunden.
            </div>
          )}

          {swappable.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button className="btn-ghost btn-sm" onClick={alleSwappableGewaehlt ? alleAus : alleAn}>
                {alleSwappableGewaehlt ? 'Auswahl aufheben' : 'Alle auswählen'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{sel.size} von {swappable.length} gewählt</span>
            </div>
          )}

          <div style={{ display: 'grid', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
            {swappable.map(c => (
              <label key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
                border: '1px solid var(--line)', borderRadius: 8, cursor: 'pointer',
                background: sel.has(c.id) ? '#f6f8f0' : '#fff',
              }}>
                <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                <img src={c.bild_url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
                <span style={{ flex: 1, fontSize: 13 }}>
                  {c.format}{c.typ === 'overlay' ? ' · Overlay' : ''}
                  {c.hat_position && <span style={{ color: 'var(--ink-4)', fontSize: 11 }}> · eigene Logo-Position</span>}
                </span>
                {c.veraltet
                  ? <span style={{ fontSize: 11, color: '#b45309' }}>altes Logo</span>
                  : <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>aktuell</span>}
              </label>
            ))}
          </div>

          {blocked.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>
                Nicht möglich ({blocked.length})
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {blocked.map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--ink-4)' }}>
                    <img src={c.bild_url} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--line)', opacity: 0.6 }} />
                    <span>{c.format} — {c.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {ergebnis && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            ✓ {ergebnis.aktualisiert} von {ergebnis.gesamt} Creative{ergebnis.gesamt === 1 ? '' : 's'} aktualisiert.
          </div>
          {ergebnis.ergebnisse.filter(r => !r.ok).map(r => (
            <div key={r.id} style={{ fontSize: 12, color: '#b45309' }}>· übersprungen: {r.reason}</div>
          ))}
        </div>
      )}
    </Modal>
  );
}
