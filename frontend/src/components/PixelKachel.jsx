import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

// Interne Pixel-Kachel für die Bereiche „Funnel" und „Meta".
// Zeigt den der Stelle zugeordneten Meta-Pixel (Name + Pixel-ID zum Kopieren)
// und den CAPI-Token (maskiert, zum Kopieren). NUR intern — der Token kommt aus
// der Env und taucht nie in Portal-/Public-/Mail-Antworten auf.
// Zuordnung direkt aus der Kachel: Gewerk-Vorschlag „übernehmen" oder per
// aufklappbarer Liste einen anderen Pixel aus talentone_pixel wählen (PATCH jobs.pixel_id).
// Prop `perspectiveHinweis`: zeigt zusätzlich den Hinweis, dass der Pixel in
// Perspective manuell unter Integrationen → Meta-Pixel eingetragen werden muss
// (die Perspective-API nimmt keine Pixel-ID entgegen).
export default function PixelKachel({ jobId, perspectiveHinweis = false, onChange }) {
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  const [kopiert, setKopiert] = useState('');
  const [busy, setBusy] = useState(false);
  const [waehlenOffen, setWaehlenOffen] = useState(false);

  function ladeCtx() {
    return api(`/jobs/${jobId}/pixel-context`)
      .then(r => { setCtx(r); return r; })
      .catch(e => { setError(e.body?.error || e.message); });
  }

  useEffect(() => {
    let aktiv = true;
    api(`/jobs/${jobId}/pixel-context`)
      .then(r => { if (aktiv) setCtx(r); })
      .catch(e => { if (aktiv) setError(e.body?.error || e.message); });
    return () => { aktiv = false; };
  }, [jobId]);

  async function copy(text, key) {
    try { await navigator.clipboard.writeText(text); setKopiert(key); setTimeout(() => setKopiert(''), 1800); }
    catch { /* Clipboard evtl. blockiert */ }
  }

  // Pixel der Stelle zuordnen/wechseln. null = Zuordnung entfernen (zurück auf Vorschlag/Fallback).
  async function setzePixel(pixelId) {
    setBusy(true); setError('');
    try {
      await api(`/jobs/${jobId}`, { method: 'PATCH', body: { pixel_id: pixelId } });
      setWaehlenOffen(false);
      await ladeCtx();
      onChange?.();
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="card"><div className="alert alert-error">Pixel: {error}</div></div>;
  if (!ctx) return <div className="card"><p className="pane-hint">Lade Pixel…</p></div>;

  const p = ctx.aktueller_pixel;
  const v = ctx.vorschlag;
  const token = ctx.capi_token || null;
  const liste = Array.isArray(ctx.aktiv_liste) ? ctx.aktiv_liste : [];

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>🎯 Meta-Pixel</h2>
        <Link to="/admin/pixel" className="pane-hint" style={{ fontSize: 12 }}>Pixel verwalten →</Link>
      </div>

      {p ? (
        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          <Zeile label="Pixel">
            <strong>{p.name}</strong>
            {p.fallback && <span className="pane-hint" style={{ marginLeft: 6, fontSize: 12 }}>(Fallback)</span>}
            {!p.aktiv && <span style={{ marginLeft: 6, fontSize: 12, color: '#c1272d' }}>· inaktiv</span>}
          </Zeile>
          <Zeile label="Pixel-ID">
            <code style={{ fontSize: 13 }}>{p.meta_pixel_id}</code>
            <KopierBtn aktiv={kopiert === 'pid'} onClick={() => copy(p.meta_pixel_id, 'pid')} />
          </Zeile>
          <Zeile label="CAPI-Token">
            {token ? (
              <>
                <code style={{ fontSize: 13 }}>{ctx.capi_token_masked}</code>
                <KopierBtn aktiv={kopiert === 'tok'} onClick={() => copy(token, 'tok')} />
              </>
            ) : <span className="pane-hint" style={{ fontSize: 12 }}>nicht in der Env gesetzt</span>}
          </Zeile>
          <Zeile label="Tracking">
            <TrackingBadge t={ctx.tracking} />
          </Zeile>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <p className="pane-hint" style={{ margin: 0 }}>Noch kein Pixel zugeordnet.</p>
          {v && (
            <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#f4f6fb', border: '1px solid #dbe3f3', borderRadius: 8, padding: '10px 12px' }}>
              <span style={{ fontSize: 13 }}>
                💡 Vorschlag{ctx.vorschlag_gewerk ? ` (Gewerk: ${ctx.vorschlag_gewerk})` : (v.via_fallback ? ' (Fallback)' : '')}:{' '}
                <strong>{v.name}</strong> · <code style={{ fontSize: 12 }}>{v.meta_pixel_id}</code>
              </span>
              <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => setzePixel(v.id)}>
                {busy ? '…' : 'übernehmen'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hinweis bei abweichendem Vorschlag (nur Anzeige — Wechsel unten per Liste). */}
      {p && v && v.id !== p.id && (
        <p className="pane-hint" style={{ marginTop: 10, fontSize: 12 }}>
          💡 Vorschlag laut Gewerk wäre <strong>{v.name}</strong>{v.via_fallback ? ' (Fallback)' : ''}. Laufende Kampagnen bleiben beim bisherigen Pixel bis zum nächsten Start.
        </p>
      )}

      {/* Aufklappbar: anderen Pixel aus talentone_pixel wählen. */}
      {liste.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="pane-hint"
            onClick={() => setWaehlenOffen(o => !o)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: '#33415c', fontWeight: 600 }}
          >
            {waehlenOffen ? '▾' : '▸'} {p ? 'anderen Pixel wählen' : 'Pixel manuell wählen'}
          </button>
          {waehlenOffen && (
            <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
              {liste.map(px => {
                const aktiv = ctx.aktueller === px.id;
                return (
                  <button
                    key={px.id}
                    type="button"
                    disabled={busy || aktiv}
                    onClick={() => setzePixel(px.id)}
                    style={{
                      textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between',
                      border: `1px solid ${aktiv ? 'var(--brand, #2563eb)' : 'var(--line, #e5e5e5)'}`,
                      background: aktiv ? '#eef2ff' : '#fff', borderRadius: 8, padding: '7px 10px',
                      cursor: aktiv ? 'default' : 'pointer', fontSize: 13,
                    }}
                  >
                    <span>
                      <strong>{px.name}</strong>
                      {px.gewerk && <span className="pane-hint" style={{ marginLeft: 6, fontSize: 11 }}>{px.gewerk}</span>}
                      {px.fallback && <span className="pane-hint" style={{ marginLeft: 6, fontSize: 11 }}>(Fallback)</span>}
                    </span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <code style={{ fontSize: 11 }}>{px.meta_pixel_id}</code>
                      {aktiv && <span style={{ fontSize: 11, color: 'var(--brand, #2563eb)', fontWeight: 700 }}>✓ aktiv</span>}
                    </span>
                  </button>
                );
              })}
              {p && (
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setzePixel(null)} style={{ marginTop: 2, alignSelf: 'flex-start' }}>
                  Zuordnung entfernen (zurück auf Vorschlag)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {perspectiveHinweis && (
        <div style={{ marginTop: 12, background: '#f4f6fb', border: '1px solid #dbe3f3', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#33415c' }}>
          ℹ️ <strong>Perspective:</strong> Die Pixel-ID lässt sich nicht automatisch an den Funnel übergeben.
          Trage sie in Perspective manuell unter <em>Integrationen → Meta-Pixel</em> ein{p ? <> (ID oben kopieren)</> : null}.
        </div>
      )}
    </div>
  );
}

function Zeile({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', minWidth: 92 }}>{label}</span>
      {children}
    </div>
  );
}

// Tracking-Quote: Meta-Events vs. Tool-Bewerbungen (14 T). Rot wenn Pixel nicht feuert.
function TrackingBadge({ t }) {
  if (!t) return <span className="pane-hint" style={{ fontSize: 12 }}>—</span>;
  const basis = <span className="pane-hint" style={{ fontSize: 12 }}>{t.events}/{t.bewerbungen} Events · {t.tage} T</span>;
  if (t.pixel_feuert_nicht) {
    return <span style={{ fontSize: 12.5, color: '#c1272d', fontWeight: 600 }}>⚠️ Pixel feuert nicht — {t.bewerbungen} Bewerbungen, 0 Events ({t.tage} T)</span>;
  }
  if (t.bewerbungen === 0) {
    return <span className="pane-hint" style={{ fontSize: 12 }}>keine Bewerbungen im Zeitraum ({t.tage} T)</span>;
  }
  const q = t.quote ?? 0;
  const farbe = q >= 70 ? '#1a7f37' : q >= 30 ? '#b7791f' : '#c1272d';
  return <span style={{ fontSize: 12.5, fontWeight: 600, color: farbe }}>{q}% {basis}</span>;
}

function KopierBtn({ aktiv, onClick }) {
  return (
    <button type="button" className="btn-ghost btn-sm" onClick={onClick} title="Kopieren" style={{ padding: '2px 8px' }}>
      {aktiv ? '✓ kopiert' : '📋 kopieren'}
    </button>
  );
}
