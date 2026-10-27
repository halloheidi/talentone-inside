// Geteilte Bewerber-Liste + Kandidatenakte (Drawer).
//
// EINE Komponente, zwei Modi:
//  - modus='kunde'  → Portal (Notizen ÜBER den Kandidaten sichtbar; Kundenfeedback + Kommentar editierbar)
//  - modus='intern' → /vorqualifizierung (B4): zusätzlich Kriterien-Checkliste + Ampel via onPatch editierbar
//
// Anzeige in BEIDEN Modi identisch; die Callbacks steuern nur die Editierbarkeit:
//  onPatch(patch)        → Notiz-/Kriterien-/Ampel-Edit (intern)
//  onFeedback(patch)     → Kundenfeedback (Status/VG) — im Portal immer vorhanden
//  onKommentar(text)     → neuer Kommentar in den gemeinsamen Verlauf (beide Modi)
//  onReload()            → Daten nach einer Mutation neu laden
import { useState } from 'react';
import { t } from '../lib/anrede.js';

/* ── Status-Bucket (interner Fortschritt) ── */
export function portalStatusBucket(notiz) {
  if (!notiz) return 'neu';
  if (notiz.status === 'abgesagt') return 'abgesagt';
  if (notiz.vg_vereinbart_am) return 'vg';
  if (notiz.kunde_kontaktiert) return 'vorgestellt';
  if (['kontaktiert', 'interessiert'].includes(notiz.status)) return 'vorqual';
  return 'neu';
}
export const BUCKET_LABEL = { neu: 'Neu', vorqual: 'In Vorqualifizierung', vorgestellt: 'Vorgestellt', vg: 'VG vereinbart', abgesagt: 'Abgesagt' };
export const BUCKET_COLOR = { neu: '#6b7280', vorqual: '#1e40af', vorgestellt: '#5b21b6', vg: '#166534', abgesagt: '#b91c1c' };

/* ── Kundenfeedback-Status (vom Kunden gepflegt) ── */
export const FEEDBACK_OPTIONS = [
  { key: '', label: 'Offen' },
  { key: 'interessant', label: 'Interessant' },
  { key: 'vorstellungsgespraech', label: 'VG gewünscht' },
  { key: 'absage', label: 'Abgesagt' },
];
const FEEDBACK_LABEL = { neu: 'Offen', interessant: 'Interessant', vorstellungsgespraech: 'VG gewünscht', eingestellt: 'Eingestellt', ungeeignet: 'Ungeeignet', absage: 'Abgesagt', abgesagt: 'Abgesagt' };
const FEEDBACK_COLOR = { interessant: '#1e40af', vorstellungsgespraech: '#5b21b6', eingestellt: '#166534', absage: '#b91c1c', abgesagt: '#b91c1c', ungeeignet: '#b45309' };

/* ── Ampel ── */
export const AMPELN = [
  { key: 'gruen', label: 'Grün', color: '#16a34a' },
  { key: 'gelb',  label: 'Gelb', color: '#d97706' },
  { key: 'rot',   label: 'Rot',  color: '#dc2626' },
  { key: 'offen', label: 'Offen', color: '#9a9994' },
];
const AMPEL_FARBE = Object.fromEntries(AMPELN.map(a => [a.key, a.color]));
export function ampelOf(notiz) { const a = notiz?.ampel; return (a === 'gruen' || a === 'gelb' || a === 'rot') ? a : 'offen'; }
export function ampelVerteilung(bewerbungen) {
  const c = { gruen: 0, gelb: 0, rot: 0, offen: 0 };
  for (const b of bewerbungen) c[ampelOf(b.notiz)]++;
  return c;
}

export function hatKriterien(struktur) {
  return !!struktur && ((struktur.ko || []).length + (struktur.muss || []).length + (struktur.wunsch || []).length) > 0;
}
export function trefferText(struktur, check) {
  // Punkt 4: ohne definierte Kriterien kein „0/0" — einfach „–".
  if (!struktur || ((struktur.ko || []).length + (struktur.muss || []).length) === 0) return '–';
  const c = check || {};
  const z = arr => { const total = (arr || []).length; const ja = (arr || []).filter(i => c[i.id] === true).length; return `${ja}/${total}`; };
  return `KO ${z(struktur.ko)} · Muss ${z(struktur.muss)}`;
}

// Lesbare Funnel-Fragetitel für Stummel aus dem Funnel-Export.
const FRAGE_TITEL = { 'bei uns erwarten?': 'Was erwartest du von uns?' };
function frageTitel(txt) { const s = (txt || '').trim(); return FRAGE_TITEL[s.toLowerCase()] || s; }

function initialen(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '–';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
// Sticky: Kopfzeile oben, Name-Spalte links. Volle Arbeitsliste scrollt nur im Container.
const thBase = { padding: '8px 10px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955', whiteSpace: 'nowrap', background: '#fafaf8', position: 'sticky', top: 0, zIndex: 2, borderBottom: '1px solid #ececea' };
const thName = { ...thBase, left: 0, zIndex: 3 };
const tdBase = { padding: '8px 10px', fontSize: 12, verticalAlign: 'middle', whiteSpace: 'nowrap', borderBottom: '1px solid #f1f1ee' };
const tdName = { ...tdBase, position: 'sticky', left: 0, background: '#fff', zIndex: 1, borderRight: '1px solid #eceae6' };

/* ══════════════════════ Liste ══════════════════════ */
export function BewerberListe({ job, bewerbungen, kunde, primary, modus = 'kunde', ampelFilter, onAmpelFilter, akteBewId, onAkte, onPatch, onFeedback, onKommentar, onSpalte, onReload }) {
  const [filter, setFilter] = useState('alle');
  let gefiltert = filter === 'alle' ? bewerbungen : bewerbungen.filter(b => portalStatusBucket(b.notiz) === filter);
  if (ampelFilter) gefiltert = gefiltert.filter(b => ampelOf(b.notiz) === ampelFilter);
  const akte = bewerbungen.find(b => b.id === akteBewId) || null;
  const kriterienDa = hatKriterien(job.kriterien_struktur);
  const intern = modus === 'intern';

  // Volle Arbeitsliste: Funnel-Antworten (alle Fragen) + kundensichtbare Custom-Spalten + E-Mail/Telefon.
  const frageSpalten = [];
  for (const b of bewerbungen) for (const a of (Array.isArray(b.antworten) ? b.antworten : [])) {
    const f = (a?.frage_text || '').trim();
    if (f && !frageSpalten.includes(f)) frageSpalten.push(f);
  }
  const antwortFor = (b, frage) => (Array.isArray(b.antworten) ? b.antworten : []).find(a => (a?.frage_text || '').trim() === frage)?.antwort || '';
  const customSpalten = Array.isArray(job.bewerber_spalten) ? job.bewerber_spalten : [];

  const stop = e => e.stopPropagation();
  const inlineSel = { fontSize: 12, padding: '3px 6px', border: '1px solid #e0e0dd', borderRadius: 6, background: '#fff', maxWidth: 160 };
  async function saveFeedback(bewId, patch) { try { await onFeedback?.(bewId, patch); await onReload?.(); } catch (e) { alert(e.message); } }
  async function savePatch(bewId, patch) { try { await onPatch?.(bewId, patch); await onReload?.(); } catch (e) { alert(e.message); } }
  async function saveSpalte(bewId, spalteId, wert) { try { await onSpalte?.(bewId, spalteId, wert); await onReload?.(); } catch (e) { alert(e.message); } }

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', minWidth: 0 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>👥 {t(kunde, 'Deine', 'Ihre')} Bewerbungen ({bewerbungen.length})</h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {['alle', 'neu', 'vorqual', 'vorgestellt', 'vg', 'abgesagt'].map(f => {
          const aktiv = filter === f;
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontSize: 12, padding: '4px 11px', borderRadius: 100, cursor: 'pointer',
              border: aktiv ? `1.5px solid ${primary}` : '1px solid #ececea',
              background: aktiv ? primary : '#fff', color: aktiv ? '#fff' : '#0a0a0a', fontWeight: aktiv ? 700 : 500,
            }}>{f === 'alle' ? 'Alle' : BUCKET_LABEL[f]}</button>
          );
        })}
        {ampelFilter && (
          <button onClick={() => onAmpelFilter?.(null)} style={{ fontSize: 12, padding: '4px 11px', borderRadius: 100, cursor: 'pointer', border: '1px solid #ececea', background: '#fafaf8' }}>
            Ampel: {AMPELN.find(a => a.key === ampelFilter)?.label} ×
          </button>
        )}
      </div>
      {bewerbungen.length === 0 ? (
        <p style={{ color: '#9a9994' }}>Noch keine Bewerbungen eingegangen.</p>
      ) : gefiltert.length === 0 ? (
        <p style={{ color: '#9a9994' }}>Keine Bewerbungen in dieser Ansicht.</p>
      ) : (
        <div style={{ overflowX: 'auto', maxWidth: '100%', border: '1px solid #f1f1ee', borderRadius: 10 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={thName}>Name</th>
                <th style={thBase}>Eingang</th>
                <th style={thBase}>Status</th>
                <th style={thBase}>Kriterien</th>
                <th style={thBase}>Feedback</th>
                {intern && <th style={thBase}>Ampel</th>}
                {intern && <th style={thBase}>Bearbeitung</th>}
                {frageSpalten.map(f => <th key={`fr-${f}`} style={thBase} title={f}>{frageTitel(f).length > 32 ? frageTitel(f).slice(0, 30) + '…' : frageTitel(f)}</th>)}
                {customSpalten.map(sp => <th key={`cs-${sp.id}`} style={{ ...thBase, background: '#f4f7ff' }}>{sp.name}</th>)}
                <th style={thBase}>E-Mail</th>
                <th style={thBase}>Telefon</th>
                {intern && <th style={thBase}>Notiz</th>}
              </tr>
            </thead>
            <tbody>
              {gefiltert.map(b => {
                const bucket = portalStatusBucket(b.notiz);
                const amp = ampelOf(b.notiz);
                const fb = b.feedback?.status || '';
                const fbSel = FEEDBACK_OPTIONS.some(o => o.key === fb) ? fb : '';
                const neuerKomm = (b.kommentare || []).some(k => k.autor_typ === 'kunde' && (!b.notiz?.updated_at || k.created_at > b.notiz.updated_at));
                const werte = b.spalten_werte || {};
                return (
                  <tr key={b.id} style={{ opacity: b.ko_kriterium ? 0.6 : 1 }}>
                    <td style={{ ...tdName, cursor: 'pointer' }} onClick={() => onAkte?.(b.id)} title="Akte öffnen">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ position: 'relative', flexShrink: 0 }}>
                          <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#eef0f4', color: '#44474d', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initialen(b.name)}</span>
                          <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: '50%', background: AMPEL_FARBE[amp], border: '2px solid #fff' }} />
                        </span>
                        <span style={{ fontWeight: 600, color: '#1b3f80', textDecoration: 'underline' }}>{b.name || '—'}</span>
                        {neuerKomm && <span title="Neuer Kommentar vom Kunden" style={{ flexShrink: 0 }}>💬</span>}
                      </div>
                    </td>
                    <td style={tdBase}>{new Date(b.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</td>
                    <td style={tdBase}><span style={{ fontSize: 11, fontWeight: 700, color: BUCKET_COLOR[bucket] }}>{BUCKET_LABEL[bucket]}</span></td>
                    <td style={{ ...tdBase, color: kriterienDa ? undefined : '#9a9994' }}>{trefferText(job.kriterien_struktur, b.notiz?.kriterien_check)}</td>
                    {/* Feedback-Status inline (Kunde) */}
                    <td style={tdBase} onClick={stop}>
                      {onFeedback ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <select value={fbSel} onChange={e => saveFeedback(b.id, { status: e.target.value || 'neu' })} style={inlineSel}>
                            {FEEDBACK_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                          </select>
                          <input type="date" value={(b.feedback?.vorstellungsgespraech_am || '').slice(0, 10)} title="VG-Termin"
                            onChange={e => saveFeedback(b.id, { vorstellungsgespraech_am: e.target.value || null })} style={{ ...inlineSel, maxWidth: 130 }} />
                        </div>
                      ) : (fb ? <span style={{ fontSize: 11, fontWeight: 700, color: FEEDBACK_COLOR[fb] || '#5a5955' }}>{FEEDBACK_LABEL[fb] || fb}</span> : <span style={{ color: '#9a9994' }}>—</span>)}
                    </td>
                    {intern && (
                      <td style={tdBase} onClick={stop}>
                        <select value={amp} onChange={e => savePatch(b.id, { ampel: e.target.value === 'offen' ? null : e.target.value })} style={inlineSel}>
                          {AMPELN.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                        </select>
                      </td>
                    )}
                    {intern && (
                      <td style={tdBase} onClick={stop}>
                        <select value={b.notiz?.status || 'neu'} onChange={e => savePatch(b.id, { status: e.target.value })} style={inlineSel}>
                          {['neu', 'kontaktiert', 'interessiert', 'abgesagt'].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    )}
                    {frageSpalten.map(f => { const v = antwortFor(b, f); return <td key={`fr-${f}`} style={{ ...tdBase, color: v ? undefined : '#9a9994' }}>{v || '—'}</td>; })}
                    {customSpalten.map(sp => {
                      const v = werte[sp.id] ?? '';
                      if (!onSpalte) return <td key={`cs-${sp.id}`} style={{ ...tdBase, background: '#fbfcff' }}>{v || '—'}</td>;
                      return (
                        <td key={`cs-${sp.id}`} style={{ ...tdBase, background: '#fbfcff' }} onClick={stop}>
                          {sp.typ === 'dropdown' && Array.isArray(sp.optionen)
                            ? <select value={v} onChange={e => saveSpalte(b.id, sp.id, e.target.value)} style={inlineSel}><option value="">—</option>{sp.optionen.map(o => <option key={o} value={o}>{o}</option>)}</select>
                            : sp.typ === 'datum'
                              ? <input type="date" value={(v || '').slice(0, 10)} onChange={e => saveSpalte(b.id, sp.id, e.target.value)} style={inlineSel} />
                              : <input defaultValue={v} onBlur={e => e.target.value !== v && saveSpalte(b.id, sp.id, e.target.value)} style={inlineSel} />}
                        </td>
                      );
                    })}
                    <td style={tdBase} onClick={stop}>{b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : '—'}</td>
                    <td style={tdBase} onClick={stop}>{b.telefon ? <a href={`tel:${b.telefon}`}>{b.telefon}</a> : '—'}</td>
                    {intern && (
                      <td style={tdBase} onClick={stop}>
                        <input defaultValue={b.notiz?.notizen || ''} placeholder="Notiz…" onBlur={e => (e.target.value || '') !== (b.notiz?.notizen || '') && savePatch(b.id, { notizen: e.target.value || null })} style={{ ...inlineSel, maxWidth: 180 }} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {akte && <BewerberAkte bewerbung={akte} job={job} kunde={kunde} primary={primary} modus={modus}
        onClose={() => onAkte?.(null)}
        onPatch={onPatch ? (patch) => onPatch(akte.id, patch) : undefined}
        onFeedback={onFeedback ? (patch) => onFeedback(akte.id, patch) : undefined}
        onKommentar={onKommentar ? (text) => onKommentar(akte.id, text) : undefined}
        onReload={onReload} />}
    </div>
  );
}

/* ══════════════════════ Kandidatenakte (rechts einfahrender Drawer) ══════════════════════ */
export function BewerberAkte({ bewerbung: b, job, kunde, primary, modus = 'kunde', onClose, onPatch, onFeedback, onKommentar, onReload }) {
  const n = b.notiz || {};
  const struktur = job.kriterien_struktur || { ko: [], muss: [], wunsch: [] };
  const check = n.kriterien_check || {};
  const antworten = Array.isArray(b.antworten) ? b.antworten : [];
  const anhaenge = Array.isArray(b.anhaenge) ? b.anhaenge : [];
  const amp = ampelOf(n);
  const editierbar = modus === 'intern' && typeof onPatch === 'function';
  const [kommEntwurf, setKommEntwurf] = useState('');
  const [busy, setBusy] = useState(false);

  const row = (label, val) => val ? <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0' }}><span style={{ color: '#5a5955', minWidth: 130 }}>{label}</span><span style={{ fontWeight: 500 }}>{val}</span></div> : null;
  const checkIcon = v => v === true ? '✓' : v === false ? '✗' : '–';
  const checkCol = v => v === true ? '#16a34a' : v === false ? '#dc2626' : '#9a9994';
  const nextCheck = v => v === true ? false : v === false ? null : true;
  const h3 = { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.04, color: '#5a5955', margin: '18px 0 6px' };

  async function sendeKommentar() {
    const text = kommEntwurf.trim();
    if (!text || !onKommentar) return;
    setBusy(true);
    try { await onKommentar(text); setKommEntwurf(''); await onReload?.(); }
    catch (e) { alert(e.message || 'Kommentar fehlgeschlagen.'); } finally { setBusy(false); }
  }
  async function setFeedback(patch) {
    if (!onFeedback) return;
    try { await onFeedback(patch); await onReload?.(); } catch (e) { alert(e.message || 'Speichern fehlgeschlagen.'); }
  }

  // Gemeinsamer Verlauf: Eingang + Anrufversuche + Kommentare, chronologisch.
  const events = [];
  if (b.created_at) events.push({ at: b.created_at, rolle: null, autor: null, text: 'Bewerbung eingegangen', typ: 'eingang' });
  for (const a of (n.anrufversuche || [])) if (a?.datum) events.push({ at: a.datum, rolle: 'nw', autor: 'TalentOne', text: `Anrufversuch — ${a.ergebnis || 'offen'}${a.notiz ? ` · ${a.notiz}` : ''}`, typ: 'anruf' });
  for (const k of (b.kommentare || [])) events.push({ at: k.created_at, rolle: k.autor_typ, autor: k.autor_name || (k.autor_typ === 'kunde' ? 'Kunde' : 'TalentOne'), text: k.text, typ: 'kommentar' });
  events.sort((x, y) => new Date(x.at) - new Date(y.at));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 120, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: 560, maxWidth: '100%', height: '100%', overflowY: 'auto', boxShadow: '-8px 0 30px rgba(0,0,0,0.15)', animation: 'bl-slidein .22s ease' }}>
        <style>{`@keyframes bl-slidein{from{transform:translateX(24px);opacity:.4}to{transform:translateX(0);opacity:1}}`}</style>
        <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #f1f1ee', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, zIndex: 1 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ position: 'relative', flexShrink: 0 }}>
              <span style={{ width: 40, height: 40, borderRadius: '50%', background: '#eef0f4', color: '#44474d', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initialen(b.name)}</span>
              <span style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: '50%', background: AMPEL_FARBE[amp], border: '2px solid #fff' }} />
            </span>
            <div>
              <h2 style={{ margin: 0, fontSize: 19 }}>{b.name || 'Bewerber:in'}</h2>
              <div style={{ fontSize: 12, color: '#5a5955' }}>{job.stelle} · Eingang {new Date(b.created_at).toLocaleDateString('de-DE')}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #ececea', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', gap: 7, alignItems: 'center', background: '#fafaf8', borderRadius: 100, padding: '5px 12px' }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: AMPEL_FARBE[amp] }} />
              <strong style={{ fontSize: 13 }}>{BUCKET_LABEL[portalStatusBucket(n)] || 'Neu'}</strong>
            </span>
            {n.bewertung ? <span style={{ fontSize: 14, color: '#d97706' }}>{'★'.repeat(n.bewertung)}{'☆'.repeat(5 - n.bewertung)}</span> : null}
            {editierbar && (
              <select value={amp} onChange={e => setFeedbackSafe(onPatch, { ampel: e.target.value === 'offen' ? null : e.target.value }, onReload)}
                style={{ marginLeft: 'auto', border: '1px solid #ececea', borderRadius: 8, padding: '5px 8px', fontSize: 12 }}>
                {AMPELN.map(a => <option key={a.key} value={a.key}>Ampel: {a.label}</option>)}
              </select>
            )}
          </div>

          {/* Kundenfeedback — im Portal (onFeedback) immer editierbar */}
          {onFeedback && (
            <div style={{ background: '#f7f9ff', border: '1px solid #e3e9ff', borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 8 }}>{t(kunde, 'Dein Feedback', 'Ihr Feedback')}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>Status
                  <select value={b.feedback?.status && FEEDBACK_OPTIONS.some(o => o.key === b.feedback.status) ? b.feedback.status : ''}
                    onChange={e => setFeedback({ status: e.target.value || 'neu' })}
                    style={{ border: '1px solid #ccd3e6', borderRadius: 8, padding: '5px 8px', fontSize: 12 }}>
                    {FEEDBACK_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>VG-Termin
                  <input type="date" value={(b.feedback?.vorstellungsgespraech_am || '').slice(0, 10)}
                    onChange={e => setFeedback({ vorstellungsgespraech_am: e.target.value || null })}
                    style={{ border: '1px solid #ccd3e6', borderRadius: 8, padding: '4px 8px', fontSize: 12 }} />
                </label>
              </div>
            </div>
          )}

          <h3 style={{ ...h3, marginTop: 0 }}>Stammdaten</h3>
          {row('E-Mail', b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : null)}
          {row('Telefon', b.telefon ? <a href={`tel:${b.telefon}`}>{b.telefon}</a> : null)}
          {row('Quelle', b.quelle || 'funnel')}
          {row('Verfügbarkeit', n.verfuegbarkeit)}
          {row('Gehaltswunsch', n.gehaltswunsch)}
          {row('VG-Termin (intern)', n.vg_vereinbart_am ? new Date(n.vg_vereinbart_am).toLocaleDateString('de-DE') : null)}
          {row('Nächste Aktion', n.naechste_aktion)}
          {row('Eingestellt', n.eingestellt && n.eingestellt !== 'offen' ? n.eingestellt : null)}

          <h3 style={h3}>Kriterien</h3>
          {['ko', 'muss', 'wunsch'].every(k => (struktur[k] || []).length === 0)
            ? <p style={{ fontSize: 12.5, color: '#9a9994', margin: 0 }}>Keine Kriterien hinterlegt.</p>
            : ['ko', 'muss', 'wunsch'].map(kat => (struktur[kat] || []).length > 0 && (
                <div key={kat} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: kat === 'ko' ? '#b91c1c' : kat === 'muss' ? '#92400e' : '#1e40af', textTransform: 'uppercase' }}>{kat === 'ko' ? 'Ausschluss (KO)' : kat === 'muss' ? 'Muss' : 'Wunsch'}</div>
                  {struktur[kat].map(item => {
                    const v = check[item.id];
                    const inner = (<><span style={{ color: checkCol(v), fontWeight: 700, width: 14, textAlign: 'center' }}>{checkIcon(v)}</span><span>{item.text}</span></>);
                    return editierbar
                      ? <button key={item.id} onClick={() => setFeedbackSafe(onPatch, { kriterien_check: { ...check, [item.id]: nextCheck(v) } }, onReload)}
                          style={{ display: 'flex', gap: 6, padding: '3px 2px', fontSize: 12.5, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>{inner}</button>
                      : <div key={item.id} style={{ fontSize: 12.5, display: 'flex', gap: 6, padding: '1px 0' }}>{inner}</div>;
                  })}
                </div>
              ))}

          {antworten.length > 0 && <>
            <h3 style={h3}>Funnel-Antworten</h3>
            {antworten.map((a, i) => <div key={i} style={{ fontSize: 13, padding: '3px 0' }}><span style={{ color: '#5a5955' }}>{frageTitel(a.frage_text)}:</span> <strong>{a.antwort}{a.ko ? ' ⚠️ (KO)' : ''}</strong></div>)}
          </>}

          {anhaenge.length > 0 && <>
            <h3 style={h3}>Anhänge</h3>
            {anhaenge.map((a, i) => <div key={i} style={{ fontSize: 13 }}><a href={a.download_url || a.url} target="_blank" rel="noreferrer">📎 {a.dateiname || a.name || `Anhang ${i + 1}`}</a></div>)}
          </>}

          {n.notizen && <>
            <h3 style={h3}>Interne Notiz</h3>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#fafaf8', borderRadius: 8, padding: 10 }}>{n.notizen}</div>
          </>}

          {/* Gemeinsamer Verlauf (beide Modi) */}
          <h3 style={h3}>Verlauf</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.length === 0 && <p style={{ fontSize: 12.5, color: '#9a9994', margin: 0 }}>Noch keine Ereignisse.</p>}
            {events.map((e, i) => {
              const kunde_ev = e.rolle === 'kunde';
              return (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: e.typ === 'kommentar' ? (kunde_ev ? '#1e40af' : '#6b7280') : '#d4d4d0' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#9a9994' }}>
                      {new Date(e.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                      {e.autor && <> · <strong style={{ color: kunde_ev ? '#1e40af' : '#5a5955' }}>{e.autor}</strong> ({kunde_ev ? 'Kunde' : 'TalentOne'})</>}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {onKommentar && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <textarea rows={2} value={kommEntwurf} onChange={e => setKommEntwurf(e.target.value)} placeholder="Kommentar schreiben…"
                style={{ flex: 1, border: '1px solid #ececea', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
              <button onClick={sendeKommentar} disabled={busy || !kommEntwurf.trim()}
                style={{ background: primary, color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Senden</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Intern-Edit (onPatch) + Reload in einem.
async function setFeedbackSafe(onPatch, patch, onReload) {
  if (!onPatch) return;
  try { await onPatch(patch); await onReload?.(); } catch (e) { alert(e.message || 'Speichern fehlgeschlagen.'); }
}
