import { useEffect, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';

const STYLES = [
  { id: 'emotional', label: 'Emotional',     subtitle: 'Story / Gefühl', words: '150–200 Wörter' },
  { id: 'benefit',   label: 'Benefits',      subtitle: 'Faktenbasiert',  words: '120–150 Wörter' },
  { id: 'kompakt',   label: 'Knackig',       subtitle: 'Social-Media-Hook', words: '50–80 Wörter' },
];

export default function JobAdCopies() {
  const { job } = useJob();
  const [items, setItems] = useState([]);                  // alle adcopies aus DB
  const [drafts, setDrafts] = useState({});                // { stil: text } — User-Edit
  const [savingId, setSavingId] = useState(null);
  const [regenStil, setRegenStil] = useState(null);        // welcher Style gerade neu generiert wird
  const [genAllBusy, setGenAllBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);

  function load() {
    setLoading(true);
    api(`/adcopies?job_id=${job.id}`)
      .then(res => {
        const list = res.adcopies || [];
        setItems(list);
        setDrafts(Object.fromEntries(list.map(c => [c.stil, c.text])));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job.id]);

  function findItem(stil) { return items.find(c => c.stil === stil); }
  function isDirty(stil) {
    const cur = findItem(stil);
    if (!cur) return false;
    return (drafts[stil] ?? '') !== cur.text;
  }

  async function generateAll() {
    setError('');
    const hatBearbeitet = items.some(c => c.bearbeitet);
    const force = hatBearbeitet
      ? confirm('Achtung: mindestens ein Text wurde manuell bearbeitet. Wirklich alle drei überschreiben?')
      : false;
    if (hatBearbeitet && !force) return;
    setGenAllBusy(true);
    try {
      const res = await api('/adcopies/generate', {
        method: 'POST',
        body: { job_id: job.id, force: !!force },
      });
      // Liste neu laden für sauberes Mergen mit Skipped/Errors
      load();
      if (res.errors?.length) setError(`Teilfehler: ${res.errors.map(e => `${e.stil}: ${e.error}`).join(' · ')}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenAllBusy(false);
    }
  }

  async function generateOne(stil) {
    const existing = findItem(stil);
    if (existing?.bearbeitet) {
      const ok = confirm(`Der Text "${stil}" wurde manuell bearbeitet. Wirklich überschreiben?`);
      if (!ok) return;
    }
    setError('');
    setRegenStil(stil);
    try {
      let next;
      if (existing) {
        const res = await api(`/adcopies/${existing.id}/regenerate`, { method: 'POST' });
        next = res.adcopy;
      } else {
        const res = await api('/adcopies/generate', {
          method: 'POST',
          body: { job_id: job.id, styles: [stil], force: true },
        });
        next = res.adcopies?.[0];
      }
      if (next) {
        setItems(prev => [...prev.filter(c => c.id !== next.id && c.stil !== next.stil), next]);
        setDrafts(prev => ({ ...prev, [next.stil]: next.text }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenStil(null);
    }
  }

  async function saveOne(stil) {
    const existing = findItem(stil);
    if (!existing) return;
    setSavingId(existing.id);
    try {
      const res = await api(`/adcopies/${existing.id}`, {
        method: 'PATCH',
        body: { text: drafts[stil] ?? '' },
      });
      setItems(prev => prev.map(c => c.id === existing.id ? res.adcopy : c));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  async function copyOne(stil) {
    try {
      await navigator.clipboard.writeText(drafts[stil] ?? '');
      setCopied(stil);
      setTimeout(() => setCopied(null), 1500);
    } catch (err) {
      alert('Kopieren fehlgeschlagen.');
    }
  }

  return (
    <div>
      <div className="adcopy-head">
        <div>
          <h2 className="section-title">Werbetexte</h2>
          <p className="section-sub">Drei Stile auf Basis aller Briefing-Infos. Editierbar, einzeln oder alle neu generierbar.</p>
        </div>
        <button className="btn-primary" onClick={generateAll} disabled={genAllBusy || regenStil}>
          {genAllBusy ? 'Generiere alle…' : (items.length ? 'Alle neu generieren' : 'Ad Copies generieren')}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div>}

      {loading ? (
        <div className="card empty">Lade…</div>
      ) : items.length === 0 && !genAllBusy ? (
        <div className="card empty">
          <h2>Noch keine Ad Copies</h2>
          <p>Klick auf „Ad Copies generieren". Dauert ~10–20 Sekunden für alle drei.</p>
        </div>
      ) : (
        <div className="adcopy-grid">
          {STYLES.map(s => {
            const item = findItem(s.id);
            const text = drafts[s.id] ?? '';
            const dirty = isDirty(s.id);
            const busy = regenStil === s.id || (genAllBusy && !item);
            return (
              <div key={s.id} className={`adcopy-card ${item?.bearbeitet ? 'is-edited' : ''}`}>
                <header className="adcopy-card-head">
                  <div>
                    <div className="adcopy-style">{s.label}</div>
                    <div className="adcopy-substyle">{s.subtitle} · {s.words}</div>
                  </div>
                  {item?.bearbeitet && <span className="adcopy-edited-badge">bearbeitet</span>}
                </header>

                {!item && (genAllBusy || busy) && (
                  <div className="adcopy-skeleton">
                    <div /><div /><div /><div /><div className="short" />
                  </div>
                )}

                {item && (
                  <textarea
                    className="adcopy-text"
                    value={text}
                    onChange={e => setDrafts(prev => ({ ...prev, [s.id]: e.target.value }))}
                    rows={s.id === 'kompakt' ? 6 : (s.id === 'benefit' ? 12 : 14)}
                    disabled={busy}
                  />
                )}

                {!item && !busy && (
                  <div className="adcopy-empty">
                    <button className="btn-ghost btn-sm" onClick={() => generateOne(s.id)}>Diesen Stil generieren</button>
                  </div>
                )}

                {item && (
                  <footer className="adcopy-card-foot">
                    <div className="adcopy-actions-left">
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => copyOne(s.id)}
                        title="In Zwischenablage kopieren"
                      >
                        {copied === s.id ? '✓ Kopiert' : 'Kopieren'}
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => generateOne(s.id)}
                        disabled={busy}
                      >
                        {busy ? 'Generiere…' : 'Neu generieren'}
                      </button>
                    </div>
                    <button
                      className="btn-primary btn-sm"
                      onClick={() => saveOne(s.id)}
                      disabled={!dirty || savingId === item.id || busy}
                    >
                      {savingId === item.id ? 'Speichere…' : (dirty ? 'Speichern' : 'Gespeichert')}
                    </button>
                  </footer>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
