import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

// Interne Pixel-Kachel für die Bereiche „Funnel" und „Meta".
// Zeigt den der Stelle zugeordneten Meta-Pixel (Name + Pixel-ID zum Kopieren)
// und den CAPI-Token (maskiert, zum Kopieren). NUR intern — der Token kommt aus
// der Env und taucht nie in Portal-/Public-/Mail-Antworten auf.
// Prop `perspectiveHinweis`: zeigt zusätzlich den Hinweis, dass der Pixel in
// Perspective manuell unter Integrationen → Meta-Pixel eingetragen werden muss
// (die Perspective-API nimmt keine Pixel-ID entgegen).
export default function PixelKachel({ jobId, perspectiveHinweis = false }) {
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  const [kopiert, setKopiert] = useState('');

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

  if (error) return <div className="card"><div className="alert alert-error">Pixel: {error}</div></div>;
  if (!ctx) return <div className="card"><p className="pane-hint">Lade Pixel…</p></div>;

  const p = ctx.aktueller_pixel;
  const v = ctx.vorschlag;
  const token = ctx.capi_token || null;

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
        <p className="pane-hint" style={{ marginTop: 10 }}>
          Noch kein Pixel zugeordnet.
          {v && <> Vorschlag: <strong>{v.name}</strong>{v.via_fallback ? ' (Fallback)' : ''} — im Bereich „Stelle" zuordnen.</>}
        </p>
      )}

      {/* Hinweis bei abweichendem Vorschlag (nur Anzeige, nichts wird umgehängt). */}
      {p && v && v.id !== p.id && (
        <p className="pane-hint" style={{ marginTop: 10, fontSize: 12 }}>
          💡 Vorschlag laut Gewerk wäre <strong>{v.name}</strong>{v.via_fallback ? ' (Fallback)' : ''}. Änderung im Bereich „Stelle" — laufende Kampagnen bleiben beim bisherigen Pixel bis zum nächsten Start.
        </p>
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
