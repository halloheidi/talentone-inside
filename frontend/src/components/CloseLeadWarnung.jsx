import { useState } from 'react';
import { api } from '../lib/api.js';

// Zeigt eine Warnung wenn kunde.close_lead_id fehlt, mit Inline-Feld zum
// Nachtragen. onSaved(kunde) bekommt den aktualisierten Kunden geliefert,
// damit der Parent-State (Modal) sofort weiß dass die ID jetzt da ist.
export default function CloseLeadWarnung({ kunde, onSaved }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!kunde || kunde.close_lead_id) return null;

  async function save() {
    setError('');
    const v = value.trim();
    if (!v.startsWith('lead_')) {
      setError('Die ID muss mit lead_ beginnen.');
      return;
    }
    setBusy(true);
    try {
      const res = await api(`/kunden/${kunde.id}`, { method: 'PATCH', body: { close_lead_id: v } });
      onSaved?.(res.kunde);
      setValue('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8,
      padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#78350f',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        ⚠️ Keine Close Lead ID hinterlegt — diese Aktion wird nicht in Close protokolliert.
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <input
          type="text"
          placeholder="lead_XXXXX…"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && save()}
          disabled={busy}
          style={{
            flex: 1, padding: '6px 10px', border: '1px solid #d4d4d0',
            borderRadius: 6, fontSize: 13, background: '#fff',
          }}
        />
        <button
          type="button" onClick={save} disabled={busy || !value.trim()}
          className="btn-primary btn-sm"
          style={{ padding: '6px 12px', fontSize: 12 }}
        >
          {busy ? '…' : 'Speichern'}
        </button>
      </div>
      <div style={{ fontSize: 11, marginTop: 6, color: '#92400e' }}>
        Lead in Close öffnen → ID aus der URL kopieren (beginnt mit <code>lead_</code>).
      </div>
      {error && <div style={{ color: '#c1272d', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
