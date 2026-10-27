// Geteilte Kriterien-Kachel: kompakte Zusammenfassung + „Kriterien anpassen" → Editor im Modal.
// Gleiche Kachel im Portal (modus kunde) und in /vorqualifizierung (B4, modus intern).
// Speichern erfolgt über die übergebene onSave(value)-Funktion (Endpunkt kennt der Aufrufer).
import { useState } from 'react';
import KriterienStrukturEditor from './KriterienStrukturEditor.jsx';

const LEER = { ko: [], muss: [], wunsch: [], hinweis_freitext: '' };

function Chips({ items, bg, fg }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map(i => <span key={i.id} style={{ background: bg, color: fg, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 100 }}>{i.text}</span>)}
    </div>
  );
}

export default function KriterienKachel({ value, onSave, accent = '#0a0a0a', titel = 'Worauf wir achten', hinweis, readOnly = false }) {
  const v = value && typeof value === 'object' ? { ...LEER, ...value } : { ...LEER };
  const [open, setOpen] = useState(false);
  const [entwurf, setEntwurf] = useState(v);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const leer = !v.ko.length && !v.muss.length && !v.wunsch.length && !(v.hinweis_freitext || '').trim();

  function oeffnen() { setEntwurf({ ...LEER, ...v }); setMsg(''); setOpen(true); }
  async function speichern() {
    setBusy(true); setMsg('');
    try { await onSave?.(entwurf); setOpen(false); }
    catch (e) { setMsg(e.message || 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>⭐ {titel}</h2>
      {hinweis && <p style={{ fontSize: 12.5, color: '#5a5955', margin: '0 0 12px' }}>{hinweis}</p>}

      {leer ? (
        <p style={{ fontSize: 13, color: '#9a9994', margin: '4px 0 12px' }}>Noch nichts festgelegt.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
          {v.ko.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', marginBottom: 5 }}>Ausschluss (KO)</div><Chips items={v.ko} bg="#fde7e7" fg="#b91c1c" /></div>}
          {v.muss.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', marginBottom: 5 }}>Muss</div><Chips items={v.muss} bg="#fef1dd" fg="#92400e" /></div>}
          {v.wunsch.length > 0 && <div><div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', marginBottom: 5 }}>Wunsch</div><Chips items={v.wunsch} bg="#e6edff" fg="#1e40af" /></div>}
          {(v.hinweis_freitext || '').trim() && (
            <div style={{ fontSize: 12.5, color: '#44474d', background: '#fafaf8', borderRadius: 8, padding: '8px 10px' }}>
              {v.hinweis_freitext.length > 220 ? v.hinweis_freitext.slice(0, 215) + '…' : v.hinweis_freitext}
            </div>
          )}
        </div>
      )}

      {!readOnly && (
        <button onClick={oeffnen} style={{ background: 'transparent', border: `1.5px solid ${accent}`, color: accent, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          {leer ? 'Kriterien festlegen' : 'Kriterien anpassen'}
        </button>
      )}

      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 130, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '5vh 16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 640, width: '100%', padding: 22 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>Kriterien anpassen</h3>
            {hinweis && <p style={{ fontSize: 12.5, color: '#5a5955', margin: '0 0 14px' }}>{hinweis}</p>}
            <KriterienStrukturEditor value={entwurf} onChange={setEntwurf} accent={accent} />
            {msg && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{msg}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setOpen(false)} disabled={busy} style={{ background: 'transparent', border: '1px solid #ececea', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={speichern} disabled={busy} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 700 }}>{busy ? 'Speichere…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
