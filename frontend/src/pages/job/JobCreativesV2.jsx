import { useEffect, useMemo, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';

// Creative-Wizard V2 (Test, paralleler Reiter). Reine VERDRAHTUNG der bestehenden
// Render-Pfade (keine neue Render-Logik):
//   Eigenes Foto + Layout A/B   → POST /creatives/layout-render
//   Eigenes Foto + Nur Overlay  → POST /creatives/generate (mode=overlay)
//   Eigenes Foto + Foto-KI-Look → POST /creatives/generate (mode=foto)   [extern; bei ki_verarbeitung_erlaubt=nein gesperrt]
//   KI-Motiv + Freier KI-Look   → POST /creatives/generate (mode=ki)     [extern]
//   Ohne Bild + Nur Overlay     → POST /creatives/generate (mode=overlay)

const FORMATE = [{ k: 'quadrat', l: '1:1' }, { k: 'feed', l: '4:5' }, { k: 'story', l: '9:16' }];

export default function JobCreativesV2() {
  const { job, kunde } = useJob();
  const [fotos, setFotos] = useState([]);
  const [vorlagenInfo, setVorlagenInfo] = useState({ freisteller_verfuegbar: false });
  const [step, setStep] = useState(1);

  // Auswahl
  const [bildquelle, setBildquelle] = useState(null);     // eigenes_foto | ki_motiv | ohne_bild
  const [fotoId, setFotoId] = useState(null);
  const [gestaltung, setGestaltung] = useState(null);     // foto_ki | layout_a | layout_b | overlay | ki_look
  const [motiv, setMotiv] = useState('');
  const [motivVorschlaege, setMotivVorschlaege] = useState([]);
  const [motivHinweis, setMotivHinweis] = useState('');
  const [motivBusy, setMotivBusy] = useState(false);
  const [spruch, setSpruch] = useState('');
  const [formate, setFormate] = useState({ quadrat: true, feed: false, story: false });
  const [freisteller, setFreisteller] = useState(true);

  const [rendering, setRendering] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!kunde?.id) return;
    api(`/kunden/${kunde.id}/referenzbilder`).then(r => setFotos((r.referenzbilder || []).filter(x => x.typ !== 'logo'))).catch(() => {});
    api('/creatives/layout-vorlagen').then(r => setVorlagenInfo(r)).catch(() => {});
    ladeResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunde?.id, job?.id]);

  function ladeResults() {
    api(`/creatives?job_id=${job.id}`).then(r => setResults((r.creatives || []).slice(0, 12))).catch(() => {});
  }

  // ── Bildlage-Diagnose ──
  const diagnose = useMemo(() => {
    const n = fotos.length;
    const personen = fotos.filter(f => f.hat_person === true).length;
    if (n === 0) return { badge: 'keine Fotos', farbe: '#991b1b', bg: '#fee2e2', empfehlung: 'ki_motiv', grund: 'Keine Fotos in der Akte — KI-Motiv oder reines Overlay.' };
    if (personen > 0) return { badge: 'Material gut', farbe: '#166534', bg: '#dcfce7', empfehlung: 'eigenes_foto', grund: `${personen} Foto(s) mit Personen — echtes Kundenfoto bevorzugen (wirkt am glaubwürdigsten).` };
    return { badge: 'nur Umgebung', farbe: '#92400e', bg: '#fef3c7', empfehlung: 'ki_motiv', grund: `${n} Foto(s), aber ohne markierte Personen — KI-Motiv oder Umgebung (Szenen-Komposition folgt in V2).` };
  }, [fotos]);

  // Empfohlenen Pfad vorwählen (frei änderbar)
  useEffect(() => { if (!bildquelle && fotos !== null) setBildquelle(diagnose.empfehlung); /* eslint-disable-next-line */ }, [diagnose.empfehlung]);

  const selFoto = fotos.find(f => f.id === fotoId) || null;
  const fotoKiGesperrt = !!(selFoto && selFoto.ki_verarbeitung_erlaubt === false);

  async function ladeMotive() {
    setMotivBusy(true); setErr('');
    try { const r = await api('/creatives/v2/motiv-vorschlaege', { method: 'POST', body: { job_id: job.id } }); setMotivVorschlaege(r.motive || []); setMotivHinweis(r.hinweis || ''); }
    catch (e) { setErr(e.body?.error || e.message); }
    finally { setMotivBusy(false); }
  }

  const formatKeys = Object.entries(formate).filter(([, v]) => v).map(([k]) => k);

  async function rendern() {
    setErr(''); setMsg(''); setRendering(true);
    try {
      if (gestaltung === 'layout_a' || gestaltung === 'layout_b') {
        const res = await api('/creatives/layout-render', {
          method: 'POST',
          body: { job_id: job.id, vorlage: gestaltung === 'layout_a' ? 'A' : 'B', foto_id: fotoId, slots: { spruch }, freisteller, formats: formatKeys.length ? formatKeys : ['quadrat'] },
        });
        setMsg(`${(res.creatives || []).length} Creative(s) gerendert.`);
        ladeResults();
      } else {
        // generate (async): mode ki/foto/overlay
        const mode = gestaltung === 'ki_look' ? 'ki' : gestaltung === 'foto_ki' ? 'foto' : 'overlay';
        const body = { job_id: job.id, mode, formats: formatKeys.length ? formatKeys : ['quadrat'], spruch };
        if (mode === 'ki') body.motiv = motiv;
        if (mode === 'foto') body.foto_id = fotoId;
        await api('/creatives/generate', { method: 'POST', body });
        setMsg('Generierung gestartet — Ergebnisse erscheinen automatisch unten (Galerie wird aktualisiert).');
        pollResults();
      }
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setRendering(false); }
  }

  function pollResults() {
    let n = 0;
    const t = setInterval(() => { n++; ladeResults(); if (n >= 12) clearInterval(t); }, 5000);
  }

  // Gestaltungs-Optionen je Bildquelle (Enablement)
  const gestaltungsOpts = useMemo(() => {
    if (bildquelle === 'ki_motiv') return [{ k: 'ki_look', l: 'Freier KI-Look', ok: true, hint: 'Die KI komponiert das gesamte Motiv.' }];
    if (bildquelle === 'ohne_bild') return [{ k: 'overlay', l: 'Nur Overlay-PNG', ok: true, hint: 'Transparentes Text-Overlay zum Selbst-Zusammenbauen.' }];
    // eigenes_foto
    return [
      { k: 'foto_ki', l: 'Foto als KI-Basis', ok: !fotoKiGesperrt, hint: fotoKiGesperrt ? 'Gesperrt — dieses Foto darf nicht extern (KI) verarbeitet werden. Nur lokale Verarbeitung.' : 'Foto als Hintergrund, KI ergänzt das Overlay (externe API).' },
      { k: 'layout_a', l: 'Layout-Vorlage A', ok: true, hint: 'Deterministisch (serverseitig) — immer erlaubt.' },
      { k: 'layout_b', l: 'Layout-Vorlage B', ok: true, hint: 'Deterministisch (serverseitig) — immer erlaubt.' },
      { k: 'overlay', l: 'Nur Overlay-PNG', ok: true, hint: 'Transparentes Text-Overlay (serverseitig).' },
    ];
  }, [bildquelle, fotoKiGesperrt]);

  const canStep2 = bildquelle && (bildquelle !== 'eigenes_foto' || fotoId);
  const canStep3 = gestaltung && (gestaltung !== 'ki_look' || motiv.trim());

  return (
    <div className="v2-wizard" style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Creatives V2 <span className="chip" style={{ background: '#eef3ff', color: '#1b3f80' }}>Test</span></h2>
      </div>
      <p className="section-sub">Geführter Wizard — nutzt dieselben Render-Pfade wie der bisherige Generator.</p>
      {err && <div className="alert alert-error" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div className="alert" style={{ marginBottom: 10, background: '#e7f6ec', color: '#0a5c2b' }}>{msg}</div>}

      {/* Schrittleiste */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['Bildquelle', 'Gestaltung', 'Slots & Rendern'].map((l, i) => (
          <div key={l} style={{ flex: 1, padding: '6px 10px', borderRadius: 8, fontSize: 13, textAlign: 'center', fontWeight: step === i + 1 ? 700 : 500, background: step === i + 1 ? '#1b3f80' : '#f0efea', color: step === i + 1 ? '#fff' : 'var(--ink-3)' }}>
            {i + 1}. {l}
          </div>
        ))}
      </div>

      {/* ── Schritt 1: Bildquelle ── */}
      {step === 1 && (
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: diagnose.bg, color: diagnose.farbe, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Bildlage: {diagnose.badge}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 12px' }}>{diagnose.grund} <em>Empfehlung ist vorgewählt, frei änderbar.</em></p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {[{ k: 'eigenes_foto', l: '📷 Eigenes Foto aus Akte' }, { k: 'ki_motiv', l: '✨ KI-Motiv' }, { k: 'ohne_bild', l: '▭ Ohne Bild' }].map(o => (
              <button key={o.k} type="button" onClick={() => { setBildquelle(o.k); setGestaltung(null); }}
                style={{ flex: '1 1 180px', padding: '14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  border: bildquelle === o.k ? '2px solid #1b3f80' : '1px solid var(--line)', background: bildquelle === o.k ? '#eef3ff' : '#fff', fontWeight: 600 }}>
                {o.l}{diagnose.empfehlung === o.k ? <span style={{ marginLeft: 6, fontSize: 11, color: '#166534' }}>★ empfohlen</span> : null}
              </button>
            ))}
          </div>

          {bildquelle === 'eigenes_foto' && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Foto wählen & Einwilligung prüfen:</div>
              {fotos.length === 0 ? <p className="pane-hint">Keine Fotos in der Akte.</p> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: 10 }}>
                  {fotos.map(f => <FotoKachel key={f.id} foto={f} selected={fotoId === f.id} onSelect={() => setFotoId(f.id)} onFlag={(patch) => patchFoto(f.id, patch, setFotos)} />)}
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" disabled={!canStep2} onClick={() => setStep(2)}>Weiter →</button>
          </div>
        </div>
      )}

      {/* ── Schritt 2: Gestaltung ── */}
      {step === 2 && (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {gestaltungsOpts.map(o => (
              <button key={o.k} type="button" disabled={!o.ok} onClick={() => o.ok && setGestaltung(o.k)}
                style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: o.ok ? 'pointer' : 'not-allowed',
                  opacity: o.ok ? 1 : 0.5, border: gestaltung === o.k ? '2px solid #1b3f80' : '1px solid var(--line)', background: gestaltung === o.k ? '#eef3ff' : '#fff' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{o.l}{!o.ok && ' 🔒'}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{o.hint}</div>
              </button>
            ))}
          </div>
          {bildquelle === 'ki_motiv' && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>Motiv-Vorschläge (V2)</strong>
                <button className="btn-ghost btn-sm" onClick={ladeMotive} disabled={motivBusy}>{motivBusy ? 'Lädt…' : 'Vorschläge laden'}</button>
              </div>
              {motivHinweis && <div className="chip" style={{ background: '#fff7e6', color: '#8a5a00', marginTop: 6, display: 'inline-block' }}>⚠ {motivHinweis}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {motivVorschlaege.map((m, i) => (
                  <button key={i} type="button" className="btn-ghost btn-sm" style={{ textAlign: 'left' }} onClick={() => setMotiv(m)}>{m}</button>
                ))}
              </div>
              <textarea rows={2} value={motiv} onChange={e => setMotiv(e.target.value)} placeholder="Motiv-Beschreibung…" style={{ width: '100%', marginTop: 8 }} />
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn-ghost" onClick={() => setStep(1)}>← Zurück</button>
            <button className="btn-primary" disabled={!canStep3} onClick={() => setStep(3)}>Weiter →</button>
          </div>
        </div>
      )}

      {/* ── Schritt 3: Slots & Rendern ── */}
      {step === 3 && (
        <div>
          <label className="field field-full" style={{ marginBottom: 10 }}>
            <span>Spruch / Hook</span>
            <input type="text" value={spruch} onChange={e => setSpruch(e.target.value)} placeholder="z. B. ZUKUNFT INSTALLIEREN" />
          </label>
          {(gestaltung === 'layout_a' || gestaltung === 'layout_b') && vorlagenInfo.freisteller_verfuegbar && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
              <input type="checkbox" checked={freisteller} onChange={e => setFreisteller(e.target.checked)} /> Person freistellen (remove.bg)
            </label>
          )}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Formate</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {FORMATE.map(f => (
                <label key={f.k} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={!!formate[f.k]} onChange={e => setFormate(p => ({ ...p, [f.k]: e.target.checked }))} /> {f.l}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn-ghost" onClick={() => setStep(2)}>← Zurück</button>
            <button className="btn-primary" disabled={rendering || !formatKeys.length} onClick={rendern}>{rendering ? 'Rendere…' : '✨ Rendern'}</button>
          </div>
        </div>
      )}

      {/* Ergebnisse */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="section-title" style={{ fontSize: 15, margin: 0 }}>Ergebnisse</h3>
          <button className="btn-ghost btn-sm" onClick={ladeResults}>↻ Aktualisieren</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 10, marginTop: 8 }}>
          {results.map(c => (
            <a key={c.id} href={c.bild_url} target="_blank" rel="noreferrer" style={{ display: 'block', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
              {c.typ === 'video' ? <video src={c.bild_url} style={{ width: '100%' }} muted /> : <img src={c.bild_url} alt="" style={{ width: '100%', display: 'block' }} />}
            </a>
          ))}
          {results.length === 0 && <p className="pane-hint">Noch keine Creatives.</p>}
        </div>
      </div>
    </div>
  );
}

async function patchFoto(id, patch, setFotos) {
  try {
    const r = await api(`/kunden/referenzbilder/${id}`, { method: 'PATCH', body: patch });
    setFotos(prev => prev.map(f => f.id === id ? { ...f, ...r.referenzbild } : f));
  } catch (e) { alert(e.body?.error || e.message); }
}

function FotoKachel({ foto, selected, onSelect, onFlag }) {
  const wf = foto.werbefreigabe || 'ungeklaert';
  const wfMeta = { ja: { l: '✓ Werbefreigabe', c: '#166534', b: '#dcfce7' }, nein: { l: '✗ keine Freigabe', c: '#991b1b', b: '#fee2e2' }, ungeklaert: { l: '? Freigabe ungeklärt', c: '#92400e', b: '#fef3c7' } }[wf];
  return (
    <div style={{ border: selected ? '2px solid #1b3f80' : '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      <button type="button" onClick={onSelect} style={{ display: 'block', width: '100%', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }}>
        <img src={foto.bild_url} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
      </button>
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: wfMeta.c, background: wfMeta.b, borderRadius: 5, padding: '2px 6px', alignSelf: 'flex-start' }}>{wfMeta.l}</span>
        <select className="cell-input" style={{ fontSize: 11 }} value={wf} onChange={e => onFlag({ werbefreigabe: e.target.value })}>
          <option value="ungeklaert">Freigabe: ungeklärt</option>
          <option value="ja">Freigabe: ja</option>
          <option value="nein">Freigabe: nein</option>
        </select>
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={foto.ki_verarbeitung_erlaubt !== false} onChange={e => onFlag({ ki_verarbeitung_erlaubt: e.target.checked })} /> KI-Verarbeitung erlaubt
        </label>
        <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={foto.hat_person === true} onChange={e => onFlag({ hat_person: e.target.checked })} /> Person im Bild
        </label>
        {foto.ki_verarbeitung_erlaubt === false && <span style={{ fontSize: 10, color: '#92400e' }}>nur lokale Verarbeitung</span>}
      </div>
    </div>
  );
}
