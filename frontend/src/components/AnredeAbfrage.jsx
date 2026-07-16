// Anrede-Block für Versand-Modals.
//
// Solange am Kunden keine Anrede festgelegt ist (anrede_form = NULL), ist das
// hier ein PFLICHT-Block: der Versand-Button muss so lange deaktiviert bleiben
// (dafür: anredeOffen(kunde) im Modal prüfen). Ist die Anrede gesetzt, steht
// hier nur noch ein dezenter Hinweis mit Ändern-Link — nie wieder eine Abfrage.
//
// Verwendung:
//   <AnredeAbfrage kunde={kunde} onSaved={k => setKunde(k)} />
//   <button disabled={anredeOffen(kunde) || …}>Senden</button>

import { useState } from 'react';
import { api } from '../lib/api.js';
import { anredeOffen, anredeLabel, anrede, nachnameAus, vornameAus } from '../lib/anrede.js';

export default function AnredeAbfrage({ kunde, onSaved }) {
  const offen = anredeOffen(kunde);
  const [aendern, setAendern] = useState(false);
  const [form, setForm] = useState(kunde?.anrede_form || '');
  const [titel, setTitel] = useState(kunde?.anrede_titel || 'herr');
  const [nachname, setNachname] = useState(
    (kunde?.nachname || '').trim() || nachnameAus(kunde?.ansprechpartner) || ''
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!kunde?.id) return null;

  // Gesetzt und kein Änderungswunsch → nur Hinweis
  if (!offen && !aendern) {
    return (
      <div style={{ fontSize: 12, color: 'var(--ink-3)', margin: '8px 0 12px' }}>
        Anrede: <strong>{anredeLabel(kunde)}</strong>{' '}
        <button type="button" className="btn-ghost btn-sm" onClick={() => setAendern(true)}>Ändern</button>
      </div>
    );
  }

  const vorname = vornameAus(kunde?.ansprechpartner);
  const vorschau = form === 'sie'
    ? (titel && nachname ? `Hallo ${titel === 'frau' ? 'Frau' : 'Herr'} ${nachname}` : 'Guten Tag')
    : (vorname ? `Hallo ${vorname}` : 'Hallo');

  async function speichern() {
    setErr('');
    if (!form) return setErr('Bitte Du oder Sie wählen.');
    if (form === 'sie' && !nachname.trim()) return setErr('Nachname fehlt für die Sie-Anrede.');
    setBusy(true);
    try {
      const res = await api(`/kunden/${kunde.id}`, {
        method: 'PATCH',
        body: {
          anrede_form: form,
          anrede_titel: form === 'sie' ? titel : null,
          nachname: form === 'sie' ? nachname.trim() : (kunde.nachname || null),
        },
      });
      setAendern(false);
      onSaved?.(res.kunde);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{
      border: `1px solid ${offen ? '#fde68a' : 'var(--line)'}`,
      background: offen ? '#fffbeb' : 'var(--gray-50)',
      borderRadius: 8, padding: '12px 14px', margin: '8px 0 14px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        {offen ? '❗ ' : ''}Wie sprechen wir {kunde.ansprechpartner || kunde.firmenname || 'den Kunden'} an?
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
          <input type="radio" name={`anrede-${kunde.id}`} checked={form === 'du'} onChange={() => setForm('du')} />
          Per Du {vorname && <span style={{ color: 'var(--ink-4)' }}>→ „Hallo {vorname}"</span>}
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
          <input type="radio" name={`anrede-${kunde.id}`} checked={form === 'sie'} onChange={() => setForm('sie')} />
          Per Sie
        </label>
      </div>

      {form === 'sie' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={titel} onChange={e => setTitel(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
            <option value="herr">Herr</option>
            <option value="frau">Frau</option>
          </select>
          <input type="text" value={nachname} onChange={e => setNachname(e.target.value)}
            placeholder="Nachname"
            style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, minWidth: 160 }} />
        </div>
      )}

      {form && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
          Anrede in Mails: <strong>{vorschau},</strong>
        </div>
      )}
      {err && <div className="alert alert-error" style={{ marginTop: 8 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn-primary btn-sm" onClick={speichern} disabled={busy || !form}>
          {busy ? 'Speichere…' : 'Anrede speichern'}
        </button>
        {!offen && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setAendern(false)} disabled={busy}>
            Abbrechen
          </button>
        )}
      </div>
      {offen && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
          Wird am Kunden gespeichert und künftig nicht mehr abgefragt.
        </div>
      )}
    </div>
  );
}
