import { useEffect, useMemo, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { fileToBase64 } from '../../lib/files.js';

// Reel-Modul R1: Schritt 1 (Skript & Motive) + Schritt 2 (Bilder). Video = R2 (deaktiviert).
// Siehe docs/reel-modul-spec.md. Testphase: nur Admins (Tab + Backend-Gate).

const STILE = [
  { key: 'foto', label: 'Foto' },
  { key: 'illustration', label: 'Illustration' },
  { key: '3d', label: '3D-Animation' },
];
const ROLLE_LABEL = { person: '👤', fahrzeug: '🚐', logo: '🏷️', gebaeude: '🏢' };

function Schritt({ nr, titel, aktiv, children }) {
  return (
    <section style={{ opacity: aktiv ? 1 : 0.5, pointerEvents: aktiv ? 'auto' : 'none', marginTop: 18 }}>
      <h3 style={{ margin: '0 0 10px' }}>{nr}. {titel}</h3>
      {children}
    </section>
  );
}

export default function JobReel() {
  const { job, kunde } = useJob();
  const { isAdmin } = useAuth();

  const [reel, setReel] = useState(null);
  const [laden, setLaden] = useState(true);
  const [busy, setBusy] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [referenzbilder, setReferenzbilder] = useState([]);
  const [kundeJobs, setKundeJobs] = useState([]);
  const [credits, setCredits] = useState(null);

  // Anlegen-Form
  const [stil, setStil] = useState('foto');
  const [anrede, setAnrede] = useState(kunde?.anrede_form === 'sie' ? 'sie' : 'du');
  const [gehalt, setGehalt] = useState(false);
  const [jobAuswahl, setJobAuswahl] = useState(() => new Set(job?.id ? [job.id] : []));

  // Skript-Entwurf (lokal editierbar)
  const [draft, setDraft] = useState(null);
  const uploadRefs = useRef({});

  async function ladeAlles() {
    if (!kunde?.id || !job?.id) return;
    setLaden(true);
    try {
      const [r, refb, jb, cr] = await Promise.all([
        api(`/reel?job_id=${job.id}`),
        api(`/kunden/${kunde.id}/referenzbilder`).catch(() => ({ referenzbilder: [] })),
        api(`/jobs?kunde_id=${kunde.id}`).catch(() => ({ jobs: [] })),
        api('/reel/meta/credits').catch(() => null),
      ]);
      setReel((r.reels || [])[0] || null);
      setReferenzbilder(refb.referenzbilder || []);
      setKundeJobs(jb.jobs || []);
      setCredits(cr);
    } catch (e) {
      setFehler(e.message);
    } finally {
      setLaden(false);
    }
  }

  useEffect(() => { ladeAlles(); /* eslint-disable-next-line */ }, [job?.id, kunde?.id]);
  useEffect(() => { setDraft(reel ? { skript: reel.skript || [], motive: reel.motive || [] } : null); }, [reel?.id, reel?.updated_at]);

  const fotos = useMemo(() => referenzbilder.filter((r) => r.typ === 'foto'), [referenzbilder]);

  function fotoLabel(r) {
    const name = r.label || r.beschreibung || 'Foto';
    const gesperrt = r.kunde_freigabe === 'nein' || r.ki_verarbeitung_erlaubt === false;
    return gesperrt ? `${name} (gesperrt)` : name;
  }

  async function run(key, fn) {
    setBusy(key); setFehler(null);
    try { await fn(); } catch (e) { setFehler(e.message || 'Fehler'); } finally { setBusy(null); }
  }

  // POST mit 409-Einwilligungs-/Referenzperson-Behandlung.
  async function postMitConfirm(path, body = {}) {
    try {
      return await api(path, { method: 'POST', body });
    } catch (e) {
      if (e.status === 409 && e.body?.needs_confirm) {
        if (window.confirm(`${e.body.error}\n\nFortfahren und Erstnutzung bestätigen?`)) {
          return await api(path, { method: 'POST', body: { ...body, bestaetigt_informiert: true } });
        }
        return null;
      }
      if (e.status === 409 && e.body?.needs_referenzperson) { window.alert(e.body.error); return null; }
      throw e;
    }
  }

  if (!isAdmin) return <div className="card" style={{ padding: 20 }}>Das Reel-Modul ist in der Testphase nur für Admins.</div>;
  if (laden) return <div style={{ padding: 20 }}>Lade…</div>;

  /* ───────── Anlegen ───────── */
  async function anlegen() {
    const job_ids = [...jobAuswahl];
    if (!job_ids.length) { setFehler('Mindestens eine Stelle wählen.'); return; }
    const r = await api('/reel', { method: 'POST', body: { kunde_id: kunde.id, job_ids, stil, anrede, gehalt_anzeigen: gehalt } });
    setReel(r.reel);
  }

  /* ───────── Schritt 1 ───────── */
  async function skriptGenerieren() { const r = await api(`/reel/${reel.id}/skript`, { method: 'POST' }); setReel(r.reel); }
  async function satzNeu(nr) { const r = await api(`/reel/${reel.id}/skript/satz/${nr}`, { method: 'POST' }); setReel(r.reel); }
  async function draftSpeichern() { const r = await api(`/reel/${reel.id}`, { method: 'PATCH', body: { skript: draft.skript, motive: draft.motive } }); setReel(r.reel); }
  async function skriptFreigeben() { const r = await api(`/reel/${reel.id}/freigabe/skript`, { method: 'POST' }); setReel(r.reel); }

  function setSatzFeld(nr, feld, wert) {
    setDraft((d) => ({ ...d, skript: d.skript.map((s) => (s.nr === nr ? { ...s, [feld]: wert } : s)) }));
  }
  function setMotivFeld(nr, feld, wert) {
    setDraft((d) => ({ ...d, motive: d.motive.map((m) => (m.nr === nr ? { ...m, [feld]: wert } : m)) }));
  }

  /* ───────── Schritt 2 ───────── */
  async function referenzSetzen(feld, wert) { const r = await api(`/reel/${reel.id}/referenzen`, { method: 'PATCH', body: { [feld]: wert || null } }); setReel(r.reel); }
  async function referenzpersonErzeugen() { const r = await postMitConfirm(`/reel/${reel.id}/referenzperson`); if (r) setReel(r.reel); }
  async function bildErzeugen(nr) { const r = await postMitConfirm(`/reel/${reel.id}/motive/${nr}/bild`); if (r) setReel(r.reel); }
  async function bildFreigabe(nr, wert) { const r = await api(`/reel/${reel.id}/motive/${nr}`, { method: 'PATCH', body: { freigegeben: wert } }); setReel(r.reel); }
  async function ausReferenz(nr, refId) { if (!refId) return; const r = await api(`/reel/${reel.id}/motive/${nr}`, { method: 'PATCH', body: { bild_quelle: 'referenz', referenzbild_id: refId } }); setReel(r.reel); }
  async function bildFreigeben() { const r = await api(`/reel/${reel.id}/freigabe/bilder`, { method: 'POST' }); setReel(r.reel); }

  async function bildHochladen(nr, file) {
    if (!file) return;
    const data_base64 = await fileToBase64(file);
    const r = await api(`/reel/${reel.id}/motive/${nr}/upload`, { method: 'POST', body: { data_base64, dateiname: file.name, content_type: file.type } });
    setReel(r.reel);
  }

  const creditBar = credits && (
    <div className="card" style={{ padding: '8px 14px', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
      <span>🎬 Reel-Kosten diesen Monat: <b>{credits.usd_monat?.toFixed(2)} USD</b>{credits.credits_monat ? ` · ${credits.credits_monat} Credits` : ''}</span>
      <span style={{ color: '#6b7280' }}>Warnschwelle {credits.warnschwelle} · {credits.hinweis}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Reel</h2>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Recruiting-Reel (B-Roll) · Testphase</span>
      </div>
      {creditBar}
      {fehler && <div className="card" style={{ padding: 10, background: '#fef2f2', color: '#991b1b' }}>{fehler}</div>}

      {!reel && (
        <div className="card" style={{ padding: 18, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>Neues Reel anlegen</h3>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Stil</label>
            {STILE.map((s) => (
              <label key={s.key} style={{ marginRight: 14 }}>
                <input type="radio" name="stil" checked={stil === s.key} onChange={() => setStil(s.key)} /> {s.label}
              </label>
            ))}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Ansprache</label>
            <label style={{ marginRight: 14 }}><input type="radio" name="anrede" checked={anrede === 'du'} onChange={() => setAnrede('du')} /> Du</label>
            <label><input type="radio" name="anrede" checked={anrede === 'sie'} onChange={() => setAnrede('sie')} /> Sie</label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label><input type="checkbox" checked={gehalt} onChange={(e) => setGehalt(e.target.checked)} /> Gehalt im Skript nennen (wenn in den Daten)</label>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Stellen (gemeinsames Reel möglich)</label>
            {(kundeJobs.length ? kundeJobs : [{ id: job.id, stelle: job.stelle }]).map((j) => (
              <label key={j.id} style={{ display: 'block' }}>
                <input type="checkbox" checked={jobAuswahl.has(j.id)} onChange={(e) => {
                  setJobAuswahl((prev) => { const n = new Set(prev); e.target.checked ? n.add(j.id) : n.delete(j.id); return n; });
                }} /> {j.stelle}{j.id === job.id ? ' (diese Stelle)' : ''}
              </label>
            ))}
          </div>
          <button className="btn-primary" disabled={busy === 'anlegen'} onClick={() => run('anlegen', anlegen)}>
            {busy === 'anlegen' ? 'Lege an…' : 'Reel anlegen'}
          </button>
        </div>
      )}

      {reel && draft && (
        <>
          {/* Schritt 1: Skript & Motive */}
          <Schritt nr={1} titel="Skript & Motive" aktiv>
            {!(reel.skript && reel.skript.length) ? (
              <button className="btn-primary" disabled={busy === 'skript'} onClick={() => run('skript', skriptGenerieren)}>
                {busy === 'skript' ? 'Generiere…' : '✨ Skript generieren'}
              </button>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <button className="btn-ghost btn-sm" disabled={busy} onClick={() => { if (window.confirm('Skript komplett neu vorschlagen? Texte werden überschrieben.')) run('skript', skriptGenerieren); }}>🔄 Neu vorschlagen</button>
                  <button className="btn-ghost btn-sm" disabled={busy === 'save'} onClick={() => run('save', draftSpeichern)}>💾 Änderungen speichern</button>
                  <button className="btn-primary btn-sm" disabled={busy || reel.status !== 'entwurf'} onClick={() => run('fg1', skriptFreigeben)}>
                    {reel.status === 'entwurf' ? '✓ Skript freigeben' : '✓ Skript freigegeben'}
                  </button>
                </div>
                <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
                  <thead><tr><th style={{ width: 28 }}>#</th><th>Satz</th><th style={{ width: 180 }}>Schlüsselwörter</th><th>Motiv</th><th style={{ width: 70 }} /></tr></thead>
                  <tbody>
                    {draft.skript.map((s) => {
                      const motiv = draft.motive.find((m) => m.nr === s.motiv_nr);
                      return (
                        <tr key={s.nr}>
                          <td>{s.motiv_nr || '—'}</td>
                          <td>
                            <textarea value={s.text} onChange={(e) => setSatzFeld(s.nr, 'text', e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} />
                          </td>
                          <td>
                            <input value={(s.schluesselwoerter || []).join(', ')} onChange={(e) => setSatzFeld(s.nr, 'schluesselwoerter', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} style={{ width: '100%' }} placeholder="—" />
                          </td>
                          <td>
                            {motiv ? (
                              <details>
                                <summary style={{ cursor: 'pointer' }}>{motiv.titel} {(motiv.benoetigte_referenzen || []).map((r) => ROLLE_LABEL[r] || r).join(' ')}{motiv.volle_breite ? ' · breit' : ''}</summary>
                                <textarea value={motiv.prompt} onChange={(e) => setMotivFeld(motiv.nr, 'prompt', e.target.value)} rows={3} style={{ width: '100%', marginTop: 4 }} />
                                <input value={motiv.bewegung || ''} onChange={(e) => setMotivFeld(motiv.nr, 'bewegung', e.target.value)} style={{ width: '100%', marginTop: 4 }} placeholder="Bewegung" />
                              </details>
                            ) : <span style={{ color: '#9ca3af' }}>Endkarte</span>}
                          </td>
                          <td>
                            {s.motiv_nr && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(`satz${s.nr}`, () => satzNeu(s.nr))}>{busy === `satz${s.nr}` ? '…' : 'Satz neu'}</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </Schritt>

          {/* Schritt 2: Bilder */}
          <Schritt nr={2} titel="Bilder" aktiv={reel.status !== 'entwurf'}>
            {reel.status === 'entwurf'
              ? <p style={{ color: '#6b7280' }}>Erst das Skript freigeben.</p>
              : (
                <>
                  <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <label style={{ fontWeight: 600, display: 'block', fontSize: 12 }}>Person</label>
                      <select value={reel.referenzen?.person || ''} onChange={(e) => run('ref', () => referenzSetzen('person', e.target.value))}>
                        <option value="">— keine (Person erfinden) —</option>
                        {fotos.map((f) => <option key={f.id} value={f.id}>{fotoLabel(f)}</option>)}
                      </select>
                      {!reel.referenzen?.person && (
                        <button className="btn-ghost btn-sm" style={{ marginLeft: 8 }} disabled={busy === 'refperson'} onClick={() => run('refperson', referenzpersonErzeugen)}>
                          {busy === 'refperson' ? '…' : (reel.referenzen?.person_ki_url ? '↻ Referenzperson' : '＋ Person erfinden')}
                        </button>
                      )}
                      {reel.referenzen?.person_ki_url && !reel.referenzen?.person && (
                        <img src={reel.referenzen.person_ki_url} alt="" style={{ height: 40, borderRadius: 6, marginLeft: 8, verticalAlign: 'middle' }} />
                      )}
                    </div>
                    <div>
                      <label style={{ fontWeight: 600, display: 'block', fontSize: 12 }}>Fahrzeug</label>
                      <select value={reel.referenzen?.fahrzeug || ''} onChange={(e) => run('ref', () => referenzSetzen('fahrzeug', e.target.value))}>
                        <option value="">— keins —</option>
                        {fotos.map((f) => <option key={f.id} value={f.id}>{fotoLabel(f)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontWeight: 600, display: 'block', fontSize: 12 }}>Gebäude</label>
                      <select value={reel.referenzen?.gebaeude || ''} onChange={(e) => run('ref', () => referenzSetzen('gebaeude', e.target.value))}>
                        <option value="">— keins —</option>
                        {fotos.map((f) => <option key={f.id} value={f.id}>{fotoLabel(f)}</option>)}
                      </select>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>Logo: {kunde?.logo_url ? 'vorhanden' : '— fehlt —'}</div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {(reel.motive || []).map((m) => (
                      <div key={m.nr} className="card" style={{ padding: 8 }}>
                        <div style={{ aspectRatio: '2/3', background: '#f3f4f6', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
                          {m.bild_url ? <img src={m.bild_url} alt={m.titel} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 12, color: '#9ca3af', padding: 8, textAlign: 'center' }}>{m.titel}</span>}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{m.nr}. {m.titel} {(m.benoetigte_referenzen || []).map((r) => ROLLE_LABEL[r] || r).join(' ')}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                          <button className="btn-primary btn-sm" disabled={busy === `bild${m.nr}`} onClick={() => run(`bild${m.nr}`, () => bildErzeugen(m.nr))}>
                            {busy === `bild${m.nr}` ? '…' : m.bild_url ? '↻ Neu' : '✨ Erzeugen'}
                          </button>
                          <button className="btn-ghost btn-sm" onClick={() => uploadRefs.current[m.nr]?.click()}>⬆︎ Hochladen</button>
                          <input ref={(el) => { uploadRefs.current[m.nr] = el; }} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(`bild${m.nr}`, () => bildHochladen(m.nr, f)); }} />
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <select defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) run(`bild${m.nr}`, () => ausReferenz(m.nr, v)); }} style={{ fontSize: 11, maxWidth: 120 }}>
                            <option value="">Aus Referenz…</option>
                            {fotos.map((f) => <option key={f.id} value={f.id}>{fotoLabel(f)}</option>)}
                          </select>
                          <label style={{ fontSize: 12 }}><input type="checkbox" checked={!!m.freigegeben} disabled={!m.bild_url} onChange={(e) => run(`fg${m.nr}`, () => bildFreigabe(m.nr, e.target.checked))} /> frei</label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <button className="btn-primary" disabled={busy === 'fg2'} onClick={() => run('fg2', bildFreigeben)}>✓ Bilder freigeben</button>
                    {reel.status === 'bilder_ok' && <span style={{ marginLeft: 10, color: '#16a34a', fontSize: 13 }}>Bilder freigegeben.</span>}
                  </div>
                </>
              )}
          </Schritt>

          {/* Schritt 3: Video (R2) */}
          <Schritt nr={3} titel="Video" aktiv>
            <button className="btn-ghost" disabled title="Kommt in R2">🎞️ Video (kommt in R2)</button>
          </Schritt>
        </>
      )}
    </div>
  );
}
