import { useState } from 'react';

/*
 * AnfragenKanban — EINE Kanban-Implementierung für Anfragen/Leads, geteilt von
 * PublicPortal (Vario-Ansicht) und PublicAnfragen (Token-Anfragenliste).
 *
 * Spalten = pipeline_stufen (Reihenfolge kommt vom Aufrufer bereits sortiert;
 * Farbe aus stufe.farbe, Titel aus stufe.name). Anfragen werden nach status →
 * stufe.id gruppiert; Status, die keiner Stufe entsprechen, landen in der ERSTEN
 * Spalte (nicht verworfen). Statuswechsel per Drag & Drop UND per Dropdown auf der
 * Karte — beides ruft denselben `onMove(anfrageId, stufeId)` auf (der Aufrufer
 * schreibt über seinen jeweiligen PATCH-Endpoint).
 *
 * Props:
 *   stufen  Array<{ id, name, farbe, reihenfolge }>  (bereits sortiert)
 *   anfragen Array<{ id, name, telefon, status, daten, created_at }>
 *   onOpen  (anfrage) => void   — Karte anklicken öffnet Detailansicht
 *   onMove  (anfrageId, stufeId) => void|Promise  — Statuswechsel persistieren
 */
export default function AnfragenKanban({ stufen = [], anfragen = [], onOpen, onMove }) {
  const [dragId, setDragId] = useState(null);
  const catchAllKey = stufen[0]?.id || 'neu';
  const grouped = {};
  for (const s of stufen) grouped[s.id] = [];
  for (const a of anfragen) {
    const bucket = stufen.find(s => s.id === a.status) ? a.status : catchAllKey;
    (grouped[bucket] ||= []).push(a);
  }

  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: `repeat(${stufen.length}, minmax(180px, 1fr))`, overflowX: 'auto' }}>
      {stufen.map(s => (
        <div key={s.id}
          onDragOver={e => e.preventDefault()}
          onDrop={() => dragId && onMove(dragId, s.id)}
          style={{ background: '#fafaf8', borderRadius: 8, padding: 8, minHeight: 200 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 100, background: s.farbe }} />
            <strong style={{ fontSize: 12, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955' }}>{s.name}</strong>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9a9994' }}>{(grouped[s.id] || []).length}</span>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {(grouped[s.id] || []).map(a => {
              const d = a.daten || {};
              const pick = (...keys) => { for (const k of keys) { const v = d[k]; if (v != null && String(v).trim() !== '') return String(v); } return null; };
              const projektname = pick('Projektname', 'projektname');
              const firma       = pick('Firma', 'Unternehmen', 'firma', 'unternehmen');
              const standort    = pick('Standort Freiflaeche', 'Standort Freifläche', 'Adresse', 'standort');
              const groesse     = pick('Groesse der Flaeche', 'Größe der Fläche', 'größe', 'groesse');
              const anmerkung   = pick('Anmerkung', 'bemerkung');
              const gemeinde    = pick('Gemeinde', 'gemeinde');
              const plz         = pick('Postleitzahl', 'plz');
              const title = projektname || a.name || '—';
              return (
                <div key={a.id}
                  draggable
                  onDragStart={() => setDragId(a.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen?.(a)}
                  style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 8, padding: 10, fontSize: 12, cursor: 'grab' }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
                  {projektname && a.name && <div style={{ fontSize: 11, color: '#5a5955' }}>👤 {a.name}</div>}
                  {firma && <div style={{ fontSize: 11, color: '#5a5955' }}>🏢 {firma}</div>}
                  {a.telefon && <div style={{ color: '#5a5955' }}>📞 {a.telefon}</div>}
                  {standort && <div style={{ color: '#5a5955', marginTop: 2 }}>📍 {[plz, gemeinde].filter(Boolean).join(' ') || standort}</div>}
                  {groesse && <div style={{ color: '#0a0a0a', marginTop: 2, fontWeight: 500 }}>📐 {groesse}</div>}
                  {anmerkung && (
                    <div style={{ color: '#5a5955', marginTop: 4, fontSize: 11, fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      „{anmerkung}"
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <span style={{ color: '#9a9994', fontSize: 10 }}>{new Date(a.created_at).toLocaleDateString('de-DE')}</span>
                    {/* Status-Dropdown als touch-/mobil-taugliche Alternative zum Drag & Drop */}
                    <select
                      value={stufen.find(x => x.id === a.status) ? a.status : catchAllKey}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { e.stopPropagation(); onMove(a.id, e.target.value); }}
                      style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', maxWidth: 120 }}
                    >
                      {stufen.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
