// Geteilte Bewerber-Liste + Kandidatenakte.
//
// EINE Komponente, zwei Modi:
//  - modus='kunde'  → Portal (read-only; zeigt Notizen ÜBER den Kandidaten, keine Kundendaten)
//  - modus='intern' → /vorqualifizierung (B4): editierbare Kriterien-Checkliste + Ampel via onPatch
//
// Rein additiv: Portal nutzt modus='kunde' ohne onPatch → verhält sich wie bisher (nur Optik-Upgrade).
import { useState } from 'react';
import { t } from '../lib/anrede.js';

/* ── Status-Bucket aus den Ist-Werten (Mapping identisch intern/Portal) ── */
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

/* ── Ampel (grün/gelb/rot, ohne Ampel = offen) ── */
export const AMPELN = [
  { key: 'gruen', label: 'Grün', color: '#16a34a' },
  { key: 'gelb',  label: 'Gelb', color: '#d97706' },
  { key: 'rot',   label: 'Rot',  color: '#dc2626' },
  { key: 'offen', label: 'Offen', color: '#9a9994' },
];
const AMPEL_FARBE = Object.fromEntries(AMPELN.map(a => [a.key, a.color]));
export function ampelOf(notiz) {
  const a = notiz?.ampel;
  return (a === 'gruen' || a === 'gelb' || a === 'rot') ? a : 'offen';
}
export function ampelVerteilung(bewerbungen) {
  const c = { gruen: 0, gelb: 0, rot: 0, offen: 0 };
  for (const b of bewerbungen) c[ampelOf(b.notiz)]++;
  return c;
}

export function trefferText(struktur, check) {
  const c = check || {};
  const z = arr => { const total = (arr || []).length; const ja = (arr || []).filter(i => c[i.id] === true).length; return `${ja}/${total}`; };
  return `KO ${z(struktur?.ko)} · Muss ${z(struktur?.muss)}`;
}

function initialen(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '–';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const thStyle = { padding: '8px 10px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955', whiteSpace: 'nowrap' };
const tdStyle = { padding: '8px 10px', fontSize: 12, verticalAlign: 'top' };

/* ══════════════════════ Liste ══════════════════════ */
export function BewerberListe({ job, bewerbungen, kunde, primary, modus = 'kunde', ampelFilter, onAmpelFilter, akteBewId, onAkte, onPatch }) {
  const [filter, setFilter] = useState('alle');
  const frageSpalten = [];
  for (const b of bewerbungen) {
    for (const a of (Array.isArray(b.antworten) ? b.antworten : [])) {
      const f = (a?.frage_text || '').trim();
      if (f && !frageSpalten.includes(f)) frageSpalten.push(f);
    }
  }
  const antwortFor = (b, frage) => (Array.isArray(b.antworten) ? b.antworten : []).find(a => (a?.frage_text || '').trim() === frage)?.antwort || '';
  const kurzDatum = (d) => { try { return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }); } catch { return d; } };
  const hatKontakt = bewerbungen.some(b => (b.kontaktversuche || []).length);
  let gefiltert = filter === 'alle' ? bewerbungen : bewerbungen.filter(b => portalStatusBucket(b.notiz) === filter);
  if (ampelFilter) gefiltert = gefiltert.filter(b => ampelOf(b.notiz) === ampelFilter);
  const akte = bewerbungen.find(b => b.id === akteBewId) || null;

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
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
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafaf8', borderBottom: '1px solid #ececea' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Datum</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Kriterien</th>
                <th style={thStyle}>E-Mail</th>
                <th style={thStyle}>Telefon</th>
                <th style={thStyle}>Quelle</th>
                {frageSpalten.map(f => <th key={`fr-${f}`} style={{ ...thStyle }} title={f}>{f.length > 32 ? f.slice(0, 30) + '…' : f}</th>)}
                {hatKontakt && <th style={thStyle}>📞 Kontaktversuche</th>}
                {(job.vorqual_spalten || []).map(sp => (
                  <th key={`vq-${sp.name}`} style={{ ...thStyle, background: '#f4f7ff' }}
                    title={[sp.wichtig ? 'Wichtiges Prüf-Kriterium' : 'Vorqualifizierung', sp.anforderung ? `Anforderung: ${sp.anforderung}` : null, sp.pflicht ? 'Pflicht' : null].filter(Boolean).join(' · ')}>
                    {sp.wichtig ? '⭐ ' : ''}{sp.name}{sp.pflicht ? ' ❗' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gefiltert.map(b => {
                const bucket = portalStatusBucket(b.notiz);
                const amp = ampelOf(b.notiz);
                return (
                  <tr key={b.id} style={{ borderBottom: '1px solid #f1f1ee', opacity: b.ko_kriterium ? 0.6 : 1, cursor: 'pointer' }} onClick={() => onAkte?.(b.id)} title="Akte öffnen">
                    <td style={{ ...tdStyle }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ position: 'relative', flexShrink: 0 }}>
                          <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#eef0f4', color: '#44474d', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initialen(b.name)}</span>
                          <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: '50%', background: AMPEL_FARBE[amp], border: '2px solid #fff' }} />
                        </span>
                        <span style={{ fontWeight: 600, color: '#1b3f80' }}>{b.name || '—'}</span>
                      </div>
                    </td>
                    <td style={tdStyle}>{new Date(b.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td style={tdStyle}><span style={{ fontSize: 11, fontWeight: 700, color: BUCKET_COLOR[bucket] }}>{BUCKET_LABEL[bucket]}</span></td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{trefferText(job.kriterien_struktur, b.notiz?.kriterien_check)}</td>
                    <td style={tdStyle} onClick={e => e.stopPropagation()}>{b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : '—'}</td>
                    <td style={tdStyle} onClick={e => e.stopPropagation()}>{b.telefon ? <a href={`tel:${b.telefon}`}>{b.telefon}</a> : '—'}</td>
                    <td style={tdStyle}>{b.quelle || 'funnel'}</td>
                    {frageSpalten.map(f => { const v = antwortFor(b, f); return <td key={`fr-${f}`} style={{ ...tdStyle, color: v ? undefined : '#9a9994' }}>{v || '—'}</td>; })}
                    {hatKontakt && (
                      <td style={tdStyle}>
                        {(b.kontaktversuche || []).length
                          ? <span title={b.erreicht_am ? `Erreicht am ${new Date(b.erreicht_am).toLocaleDateString('de-DE')}` : ''}>
                              {b.kontaktversuche.map((v, i) => `${i ? ' / ' : ''}${kurzDatum(v.datum)}${v.erreicht ? ' ✓' : ''}`).join('')}
                            </span>
                          : <span style={{ color: '#9a9994' }}>—</span>}
                      </td>
                    )}
                    {(job.vorqual_spalten || []).map(sp => {
                      const v = b.vorqualifizierung_werte?.[sp.name];
                      const hat = v != null && String(v).trim() !== '';
                      return <td key={`vq-${sp.name}`} style={{ ...tdStyle, background: '#fbfcff', color: hat ? undefined : '#9a9994' }}>{hat ? String(v) : '—'}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {akte && <BewerberAkte bewerbung={akte} job={job} kunde={kunde} primary={primary} modus={modus} onClose={() => onAkte?.(null)} onPatch={onPatch} />}
    </div>
  );
}

/* ══════════════════════ Kandidatenakte (rechts einfahrender Drawer) ══════════════════════ */
export function BewerberAkte({ bewerbung: b, job, kunde, primary, modus = 'kunde', onClose, onPatch }) {
  const n = b.notiz || {};
  const struktur = job.kriterien_struktur || { ko: [], muss: [], wunsch: [] };
  const check = n.kriterien_check || {};
  const antworten = Array.isArray(b.antworten) ? b.antworten : [];
  const anhaenge = Array.isArray(b.anhaenge) ? b.anhaenge : [];
  const amp = ampelOf(n);
  const editierbar = modus === 'intern' && typeof onPatch === 'function';

  const row = (label, val) => val ? <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0' }}><span style={{ color: '#5a5955', minWidth: 130 }}>{label}</span><span style={{ fontWeight: 500 }}>{val}</span></div> : null;
  const checkIcon = v => v === true ? '✓' : v === false ? '✗' : '–';
  const checkCol = v => v === true ? '#16a34a' : v === false ? '#dc2626' : '#9a9994';
  // Intern: Checkliste togglen (offen → ✓ → ✗ → offen)
  const nextCheck = v => v === true ? false : v === false ? null : true;

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
              <select value={amp} onChange={e => onPatch({ ampel: e.target.value === 'offen' ? null : e.target.value })}
                style={{ marginLeft: 'auto', border: '1px solid #ececea', borderRadius: 8, padding: '5px 8px', fontSize: 12 }}>
                {AMPELN.map(a => <option key={a.key} value={a.key}>Ampel: {a.label}</option>)}
              </select>
            )}
          </div>

          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.04, color: '#5a5955', margin: '0 0 6px' }}>Stammdaten</h3>
          {row('E-Mail', b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : null)}
          {row('Telefon', b.telefon ? <a href={`tel:${b.telefon}`}>{b.telefon}</a> : null)}
          {row('Quelle', b.quelle || 'funnel')}
          {row('Verfügbarkeit', n.verfuegbarkeit)}
          {row('Gehaltswunsch', n.gehaltswunsch)}
          {row('VG-Termin', n.vg_vereinbart_am ? new Date(n.vg_vereinbart_am).toLocaleDateString('de-DE') : null)}
          {row('Nächste Aktion', n.naechste_aktion)}
          {row('Eingestellt', n.eingestellt && n.eingestellt !== 'offen' ? n.eingestellt : null)}

          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.04, color: '#5a5955', margin: '18px 0 6px' }}>Kriterien</h3>
          {['ko', 'muss', 'wunsch'].every(k => (struktur[k] || []).length === 0)
            ? <p style={{ fontSize: 12.5, color: '#9a9994', margin: 0 }}>Keine Kriterien hinterlegt.</p>
            : ['ko', 'muss', 'wunsch'].map(kat => (struktur[kat] || []).length > 0 && (
                <div key={kat} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: kat === 'ko' ? '#b91c1c' : kat === 'muss' ? '#92400e' : '#1e40af', textTransform: 'uppercase' }}>{kat === 'ko' ? 'Ausschluss (KO)' : kat === 'muss' ? 'Muss' : 'Wunsch'}</div>
                  {struktur[kat].map(item => {
                    const v = check[item.id];
                    const inner = (
                      <>
                        <span style={{ color: checkCol(v), fontWeight: 700, width: 14, textAlign: 'center' }}>{checkIcon(v)}</span>
                        <span>{item.text}</span>
                      </>
                    );
                    return editierbar
                      ? <button key={item.id} onClick={() => onPatch({ kriterien_check: { ...check, [item.id]: nextCheck(v) } })}
                          style={{ display: 'flex', gap: 6, padding: '3px 2px', fontSize: 12.5, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>{inner}</button>
                      : <div key={item.id} style={{ fontSize: 12.5, display: 'flex', gap: 6, padding: '1px 0' }}>{inner}</div>;
                  })}
                </div>
              ))}

          {antworten.length > 0 && <>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.04, color: '#5a5955', margin: '18px 0 6px' }}>Funnel-Antworten</h3>
            {antworten.map((a, i) => <div key={i} style={{ fontSize: 13, padding: '3px 0' }}><span style={{ color: '#5a5955' }}>{a.frage_text}:</span> <strong>{a.antwort}{a.ko ? ' ⚠️ (KO)' : ''}</strong></div>)}
          </>}

          {anhaenge.length > 0 && <>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.04, color: '#5a5955', margin: '18px 0 6px' }}>Anhänge</h3>
            {anhaenge.map((a, i) => <div key={i} style={{ fontSize: 13 }}><a href={a.download_url || a.url} target="_blank" rel="noreferrer">📎 {a.dateiname || a.name || `Anhang ${i + 1}`}</a></div>)}
          </>}

          {n.notizen && <>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.04, color: '#5a5955', margin: '18px 0 6px' }}>Notiz</h3>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#fafaf8', borderRadius: 8, padding: 10 }}>{n.notizen}</div>
          </>}

          {(n.anrufversuche || []).length > 0 && <>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.04, color: '#5a5955', margin: '18px 0 6px' }}>Kontaktversuche</h3>
            {n.anrufversuche.filter(a => a?.datum).map((a, i) => (
              <div key={i} style={{ fontSize: 13, padding: '2px 0' }}>{new Date(a.datum).toLocaleDateString('de-DE')} · {a.ergebnis || '—'}{a.notiz ? ` · ${a.notiz}` : ''}</div>
            ))}
          </>}
        </div>
      </div>
    </div>
  );
}
