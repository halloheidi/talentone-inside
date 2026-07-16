import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Schlanke Kundensuche (Firmenname/E-Mail) mit Debounce. onPick(kunde) beim Auswählen.
export default function KundePicker({ onPick, placeholder = 'Kunde suchen (Firmenname / E-Mail)…', autoFocus }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResults([]); setBusy(false); return; }
    let cancel = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api(`/kunden/suche?q=${encodeURIComponent(t)}`);
        if (!cancel) setResults(res.kunden || []);
      } catch { if (!cancel) setResults([]); }
      finally { if (!cancel) setBusy(false); }
    }, 250);
    return () => { cancel = true; clearTimeout(timer); };
  }, [q]);

  return (
    <div className="kunde-picker">
      <input autoFocus={autoFocus} value={q} onChange={e => setQ(e.target.value)}
        placeholder={placeholder} className="cell-input" style={{ width: '100%' }} />
      {q.trim().length >= 2 && (
        <div className="kunde-picker-results">
          {busy && <div className="kunde-picker-empty">Suche…</div>}
          {!busy && results.length === 0 && <div className="kunde-picker-empty">Keine Treffer.</div>}
          {results.map(k => (
            <button key={k.id} type="button" className="kunde-picker-row" onClick={() => onPick(k)}>
              <strong>{k.firmenname || '—'}</strong>
              <span>{[k.email, k.agentur === 'nowagwirth' ? 'Nowag & Wirth' : 'TalentOne'].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
