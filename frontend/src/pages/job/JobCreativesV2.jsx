import { useEffect, useMemo, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';

// Creative-Wizard V2 (Test, paralleler Reiter). Reine VERDRAHTUNG der bestehenden
// Render-Pfade (keine neue Render-Logik):
//   Eigenes Foto + Layout A/B   → POST /creatives/layout-render
//   Eigenes Foto + Nur Overlay  → POST /creatives/generate (mode=overlay)
//   Eigenes Foto + Foto-KI-Look → POST /creatives/generate (mode=foto)   [extern; bei ki_verarbeitung_erlaubt=nein gesperrt]
//   KI-Motiv + Freier KI-Look   → POST /creatives/generate (mode=ki)     [extern]
//   Ohne Bild + Nur Overlay     → POST /creatives/generate (mode=overlay)

const FORMATE = [{ k: 'quadrat', l: '1:1' }, { k: 'feed', l: '4:5' }, { k: 'story', l: '9:16' }];

// Spruch-Vorschläge: gleiche Engine wie im Alt-Generator ({text, kategorie}).
const spruchText = s => (typeof s === 'string' ? s : (s?.text || ''));
const spruchKat = s => (typeof s === 'string' ? '' : (s?.kategorie || ''));
function groupSprueche(list) {
  const g = new Map();
  for (const s of list || []) { const k = spruchKat(s) || 'Vorschläge'; if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
  return [...g.entries()];
}

export default function JobCreativesV2() {
  const { job, kunde } = useJob();
  const { isAdmin } = useAuth();
  const [reelBusy, setReelBusy] = useState(null);
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
  const [spruchVorschlaege, setSpruchVorschlaege] = useState([]);
  const [loadingSprueche, setLoadingSprueche] = useState(false);
  const [verbessertVarianten, setVerbessertVarianten] = useState([]);
  const [verbessernBusy, setVerbessernBusy] = useState(false);
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
    if (n === 0) return { badge: 'keine Fotos', farbe: '#991b1b', bg: '#fee2e2', empfehlung: 'ki_motiv', grund: 'Keine Fotos in der Akte — komplett neues KI-Bild. Tipp: Kundenfotos anfragen (echtes Material wirkt glaubwürdiger).' };
    if (personen > 0) return { badge: 'Material gut', farbe: '#166534', bg: '#dcfce7', empfehlung: 'eigenes_foto', grund: `${personen} Foto(s) mit Personen — echtes Kundenfoto bevorzugen (wirkt am glaubwürdigsten).` };
    return { badge: 'nur Umgebung', farbe: '#92400e', bg: '#fef3c7', empfehlung: 'eigenes_foto', grund: `${n} Foto(s), aber ohne markierte Personen — eigenes Foto nutzen und im nächsten Schritt „Szene mit Personen beleben".` };
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

  // Sprüche-Vorschläge (gleiche Endpoints wie V1) — beim Betreten von Schritt 3 laden.
  async function ladeSprueche() {
    setLoadingSprueche(true); setVerbessertVarianten([]);
    try {
      const body = { job_id: job.id };
      if (bildquelle === 'ki_motiv' && motiv.trim()) body.motiv = motiv.trim();
      const res = await api('/creatives/spruch-vorschlaege', { method: 'POST', body });
      setSpruchVorschlaege(res.sprueche || []);
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setLoadingSprueche(false); }
  }
  async function verbessereDenSpruch() {
    if (!spruch.trim()) return;
    setVerbessernBusy(true); setVerbessertVarianten([]);
    try {
      const res = await api('/creatives/spruch-verbessern', { method: 'POST', body: { job_id: job.id, spruch: spruch.trim() } });
      setVerbessertVarianten(res.varianten || []);
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setVerbessernBusy(false); }
  }
  useEffect(() => {
    if (step === 3 && spruchVorschlaege.length === 0 && !loadingSprueche) ladeSprueche();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const formatKeys = Object.entries(formate).filter(([, v]) => v).map(([k]) => k);

  async function rendern() {
    setErr(''); setMsg(''); setRendering(true);
    try {
      if (gestaltung === 'szene') {
        await szeneRendern(false);
      } else if (gestaltung === 'layout_a' || gestaltung === 'layout_b') {
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

  async function szeneRendern(bestaetigt) {
    const fmt = (formatKeys[0] || 'quadrat');
    try {
      const res = await api('/creatives/v2/szenen-komposition', {
        method: 'POST',
        body: { job_id: job.id, foto_id: fotoId, spruch, text_stil: null, format: fmt, kunde_informiert_bestaetigt: bestaetigt },
      });
      setMsg('Szenen-Komposition erstellt (enthält generische KI-Personen).');
      ladeResults();
      return res;
    } catch (e) {
      if (e.status === 409 && e.body?.needs_confirm) {
        if (window.confirm(e.body.error + '\n\nFortfahren und als „Kunde informiert" vermerken?')) {
          setRendering(true);
          try { await szeneRendern(true); } finally { setRendering(false); }
        }
        return;
      }
      throw e;
    }
  }

  async function reelAbleiten(creativeId) {
    setReelBusy(creativeId); setErr(''); setMsg('');
    try {
      await api(`/creatives/${creativeId}/reel-v2`, { method: 'POST' });
      setMsg('Story-Video (10s) erstellt.');
      ladeResults();
    } catch (e) { setErr(e.body?.error || e.message); }
    finally { setReelBusy(null); }
  }

  // Gestaltungs-Optionen je Bildquelle (Enablement)
  const gestaltungsOpts = useMemo(() => {
    if (bildquelle === 'ki_motiv') return [{ k: 'ki_look', l: 'Freier KI-Look', ok: true, hint: 'Die KI komponiert das gesamte Motiv.' }];
    if (bildquelle === 'ohne_bild') return [{ k: 'overlay', l: 'Nur Overlay-PNG', ok: true, hint: 'Transparentes Text-Overlay zum Selbst-Zusammenbauen.' }];
    // eigenes_foto
    const envOnly = selFoto && selFoto.hat_person !== true;
    return [
      { k: 'foto_ki', l: 'Foto als KI-Basis', ok: !fotoKiGesperrt, hint: fotoKiGesperrt ? 'Gesperrt — dieses Foto darf nicht extern (KI) verarbeitet werden. Nur lokale Verarbeitung.' : 'Foto als Hintergrund, KI ergänzt das Overlay (externe API).' },
      { k: 'szene', l: 'Umgebung beleben (KI-Personen)', ok: !fotoKiGesperrt && envOnly, hint: fotoKiGesperrt ? 'Gesperrt — KI-Verarbeitung für dieses Foto nicht erlaubt.' : (envOnly ? 'Setzt generische KI-Personen in das Umgebungsfoto (externe API). Kennzeichnung „enthält KI-Personen".' : 'Nur für personenlose Umgebungsfotos.') },
      { k: 'layout_a', l: 'Layout-Vorlage A', ok: true, hint: 'Deterministisch (serverseitig) — immer erlaubt.' },
      { k: 'layout_b', l: 'Layout-Vorlage B', ok: true, hint: 'Deterministisch (serverseitig) — immer erlaubt.' },
      { k: 'overlay', l: 'Nur Overlay-PNG', ok: true, hint: 'Transparentes Text-Overlay (serverseitig).' },
    ];
  }, [bildquelle, fotoKiGesperrt, selFoto]);

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
            {[
              { k: 'eigenes_foto', l: '📷 Eigenes Foto aus Akte', sub: 'Echtes Kundenfoto als Basis. Ohne Personen im Foto? Im nächsten Schritt können KI-Personen in die Szene gesetzt werden (Szenen-Komposition).' },
              { k: 'ki_motiv', l: '✨ Komplett neues KI-Bild', sub: 'Ganze Szene wird generiert — für Kunden ohne brauchbare Fotos.' },
              { k: 'ohne_bild', l: '▭ Nur Text-Overlay (PNG für Canva)', sub: 'Transparente Text-Ebene zum Drüberlegen in Canva — Foto bleibt lokal, keine KI-Verarbeitung (geeignet bei fehlender KI-Einwilligung).' },
            ].map(o => (
              <button key={o.k} type="button" onClick={() => { setBildquelle(o.k); setGestaltung(null); }}
                style={{ flex: '1 1 220px', padding: '14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column',
                  border: bildquelle === o.k ? '2px solid #1b3f80' : '1px solid var(--line)', background: bildquelle === o.k ? '#eef3ff' : '#fff' }}>
                <span style={{ fontWeight: 600 }}>{o.l}{diagnose.empfehlung === o.k ? <span style={{ marginLeft: 6, fontSize: 11, color: '#166534' }}>★ empfohlen</span> : null}</span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, marginTop: 5, lineHeight: 1.4 }}>{o.sub}</span>
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
          {bildquelle === 'eigenes_foto' && selFoto && selFoto.hat_person !== true && !fotoKiGesperrt && (
            <div style={{ border: '1px solid #cdddff', background: '#f3f7ff', borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Personenloses Foto erkannt — wie einsetzen?</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setGestaltung('szene')}
                  style={{ flex: '1 1 240px', textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer', border: gestaltung === 'szene' ? '2px solid #1b3f80' : '1px solid var(--line)', background: gestaltung === 'szene' ? '#eef3ff' : '#fff' }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>🧑‍🤝‍🧑 Szene mit Personen beleben (KI)</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Generische KI-Personen ins Umgebungsfoto — Kennzeichnung „enthält KI-Personen", Einwilligung erforderlich.</div>
                </button>
                <button type="button" onClick={() => setGestaltung('layout_a')}
                  style={{ flex: '1 1 240px', textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer', border: gestaltung === 'layout_a' ? '2px solid #1b3f80' : '1px solid var(--line)', background: gestaltung === 'layout_a' ? '#eef3ff' : '#fff' }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>📝 Foto pur verwenden</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Text trägt die Botschaft — deterministische Vorlage, keine KI.</div>
                </button>
              </div>
            </div>
          )}
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

          {/* Sprüche-Vorschläge (gleiche Engine wie Alt-Generator) */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>💡 Spruch-Vorschläge</strong>
              <button type="button" className="btn-ghost btn-sm" onClick={ladeSprueche} disabled={loadingSprueche}>{loadingSprueche ? 'Lädt…' : '↻ Neu vorschlagen'}</button>
            </div>
            {loadingSprueche && spruchVorschlaege.length === 0 && <p className="pane-hint" style={{ margin: 0 }}>Vorschläge werden erstellt…</p>}
            {spruchVorschlaege.length > 0 && groupSprueche(spruchVorschlaege).map(([kat, items]) => (
              <div key={kat} style={{ marginBottom: 6 }}>
                {kat && <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, margin: '4px 0 2px' }}>{kat}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {items.map((s, i) => {
                    const txt = spruchText(s);
                    return <button key={i} type="button" onClick={() => setSpruch(txt)}
                      style={{ fontSize: 12, padding: '5px 10px', borderRadius: 100, cursor: 'pointer', border: spruch === txt ? '2px solid #1b3f80' : '1px solid var(--line)', background: spruch === txt ? '#eef3ff' : '#fff' }}>{txt}</button>;
                  })}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <button type="button" className="btn-ghost btn-sm" onClick={verbessereDenSpruch} disabled={verbessernBusy || !spruch.trim()}>{verbessernBusy ? 'Verbessere…' : '✨ Mit KI verbessern'}</button>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Verfeinert den aktuell gewählten Spruch.</span>
            </div>
          </div>

          {/* A5: Freigegebene Mitarbeiterstimmen als Hook übernehmbar */}
          <div style={{ marginBottom: 12 }}>
            <MitarbeiterStimmenVorschlag kundeId={kunde?.id} onInsert={s => s.zitat && setSpruch(s.zitat)} />
            {verbessertVarianten.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {verbessertVarianten.map((v, i) => {
                  const txt = spruchText(v);
                  return <button key={i} type="button" onClick={() => setSpruch(txt)}
                    style={{ fontSize: 12, padding: '5px 10px', borderRadius: 100, cursor: 'pointer', border: '1px dashed #1b3f80', background: '#f3f7ff' }}>✨ {txt}</button>;
                })}
              </div>
            )}
          </div>
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
            <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
              <a href={c.bild_url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                {c.typ === 'video' ? <video src={c.bild_url} style={{ width: '100%', display: 'block' }} muted /> : <img src={c.bild_url} alt="" style={{ width: '100%', display: 'block' }} />}
              </a>
              {c.enthaelt_ki_personen && <span style={{ position: 'absolute', top: 4, left: 4, background: '#fff7e6', color: '#8a5a00', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4 }} title="Enthält generische KI-Personen">🤖 KI-Personen</span>}
              {c.typ === 'video' && <span style={{ position: 'absolute', top: 4, right: 4, background: '#1b3f80', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4 }}>Story-Video</span>}
              {isAdmin && c.typ !== 'video' && (
                <button type="button" className="btn-ghost btn-sm" style={{ width: '100%', borderTop: '1px solid var(--line)', borderRadius: 0 }}
                  disabled={reelBusy === c.id} onClick={() => reelAbleiten(c.id)}>
                  {reelBusy === c.id ? '🎬 Reel läuft…' : '🎬 Als Reel ableiten (10s)'}
                </button>
              )}
            </div>
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
  const [lowRes, setLowRes] = useState(false);
  const wf = foto.werbefreigabe || 'ungeklaert';
  const wfMeta = { ja: { l: '✓ Werbefreigabe', c: '#166534', b: '#dcfce7' }, nein: { l: '✗ keine Freigabe', c: '#991b1b', b: '#fee2e2' }, ungeklaert: { l: '? Freigabe ungeklärt', c: '#92400e', b: '#fef3c7' } }[wf];
  return (
    <div style={{ border: selected ? '2px solid #1b3f80' : '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      <button type="button" onClick={onSelect} style={{ display: 'block', width: '100%', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }}>
        <img src={foto.bild_url} alt="" onLoad={e => { const w = e.target.naturalWidth, h = e.target.naturalHeight; if (w && h && Math.min(w, h) < 1200) setLowRes(true); }} style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
      </button>
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: wfMeta.c, background: wfMeta.b, borderRadius: 5, padding: '2px 6px', alignSelf: 'flex-start' }}>{wfMeta.l}</span>
        {lowRes && <span style={{ fontSize: 10, fontWeight: 600, color: '#92400e', background: '#fef3c7', borderRadius: 5, padding: '2px 6px', alignSelf: 'flex-start', lineHeight: 1.3 }} title="Veredelung (Upscale) folgt">⚠ Niedrige Auflösung — Veredelung (Upscale) folgt; aktuell über Johannes anfragen</span>}
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
