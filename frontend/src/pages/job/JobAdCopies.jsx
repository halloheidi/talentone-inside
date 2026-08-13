import { useEffect, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import { getBrandBaseUrl } from '../../lib/branding.js';

const STYLES = [
  { id: 'emotional', label: 'Emotional',     subtitle: 'Story / Gefühl', words: '150–200 Wörter' },
  { id: 'benefit',   label: 'Benefits',      subtitle: 'Faktenbasiert',  words: '120–150 Wörter' },
  { id: 'kompakt',   label: 'Knackig',       subtitle: 'Social-Media-Hook', words: '50–80 Wörter' },
];

export default function JobAdCopies() {
  const { job, kunde } = useJob();
  const [items, setItems] = useState([]);                  // alle adcopies aus DB
  const [drafts, setDrafts] = useState({});                // { stil: text } — User-Edit
  const [savingId, setSavingId] = useState(null);
  const [regenStil, setRegenStil] = useState(null);        // welcher Style gerade neu generiert wird
  const [genAllBusy, setGenAllBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);
  const [copiedUeb, setCopiedUeb] = useState(null);
  const [funnelUrl, setFunnelUrl] = useState(null);
  const [updateLinksBusy, setUpdateLinksBusy] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      api(`/adcopies?job_id=${job.id}`),
      api(`/funnels?job_id=${job.id}`).catch(() => ({ funnel: null })),
    ])
      .then(([res, f]) => {
        const list = res.adcopies || [];
        setItems(list);
        setDrafts(Object.fromEntries(list.map(c => [c.stil, c.text])));
        // Funnel-URL ermitteln (gleiche Logik wie Backend)
        const fn = f.funnel;
        if (fn?.extern && fn.extern_url) setFunnelUrl(fn.extern_url);
        else if (fn?.veroeffentlicht) setFunnelUrl(`${getBrandBaseUrl(kunde?.agentur)}/f/${fn.id}`);
        else setFunnelUrl(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job.id]);

  /* ───── Kunden-Kommentare aus Review laden ───── */
  const [reviewKommentare, setReviewKommentare] = useState({});
  useEffect(() => {
    let cancelled = false;
    api(`/jobs/${job.id}/export/review`)
      .then(res => {
        if (cancelled) return;
        const k = res.review?.kommentare;
        setReviewKommentare(k && typeof k === 'object' ? k : {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job.id]);

  /* ───── Headlines / Überschriften ───── */
  const [headlines, setHeadlines] = useState([]);
  const [headlinesBusy, setHeadlinesBusy] = useState(false);
  const [headlinesCopiedIdx, setHeadlinesCopiedIdx] = useState(null);
  const [headlinesDirty, setHeadlinesDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api(`/adcopies/headlines?job_id=${job.id}`)
      .then(res => { if (!cancelled) setHeadlines(res.headlines || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job.id]);

  async function generateHeadlines() {
    setHeadlinesBusy(true);
    try {
      const res = await api('/adcopies/headlines/generate', { method: 'POST', body: { job_id: job.id } });
      setHeadlines(res.headlines || []);
      setHeadlinesDirty(false);
    } catch (err) {
      alert(`Headlines: ${err.message}`);
    } finally {
      setHeadlinesBusy(false);
    }
  }

  const headlinesTimer = useRef(null);
  async function saveHeadlinesNow(arr) {
    try {
      await api('/adcopies/headlines', { method: 'PATCH', body: { job_id: job.id, headlines: arr } });
      setHeadlinesDirty(false);
    } catch { /* dirty bleibt — nächster Blur/Tastendruck versucht erneut */ }
  }
  function saveHeadlines() { return saveHeadlinesNow(headlines); }

  function setHeadlineAt(idx, val) {
    setHeadlines(prev => {
      const next = prev.map((h, i) => i === idx ? val : h);
      clearTimeout(headlinesTimer.current);
      headlinesTimer.current = setTimeout(() => saveHeadlinesNow(next), 800);
      return next;
    });
    setHeadlinesDirty(true);
  }

  async function copyHeadline(idx) {
    try {
      await navigator.clipboard.writeText(headlines[idx] || '');
      setHeadlinesCopiedIdx(idx);
      setTimeout(() => setHeadlinesCopiedIdx(null), 1200);
    } catch (e) {}
  }

  async function updateLinks() {
    setUpdateLinksBusy(true);
    try {
      const res = await api('/adcopies/update-links', { method: 'POST', body: { job_id: job.id } });
      load(); // reload mit aktualisierten Texten
      alert(`${res.updated} Text(e) aktualisiert${res.skipped ? `, ${res.skipped} unverändert` : ''}.`);
    } catch (err) {
      alert(err.message);
    } finally {
      setUpdateLinksBusy(false);
    }
  }

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

  const saveTimers = useRef({});
  // Debounced Auto-Save pro Stil. textOverride, damit der jüngste Tastendruck
  // gespeichert wird (drafts-State ist im setTimeout ggf. noch nicht aktualisiert).
  async function saveOne(stil, textOverride) {
    const existing = findItem(stil);
    if (!existing) return;
    const text = textOverride !== undefined ? textOverride : (drafts[stil] ?? '');
    setSavingId(existing.id);
    try {
      const res = await api(`/adcopies/${existing.id}`, {
        method: 'PATCH',
        body: { text },
      });
      setItems(prev => prev.map(c => c.id === existing.id ? res.adcopy : c));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }
  function scheduleSave(stil, val) {
    clearTimeout(saveTimers.current[stil]);
    saveTimers.current[stil] = setTimeout(() => saveOne(stil, val), 800);
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

  // Einzelne Meta-Überschrift kopieren (key = `${adcopyId}:${idx}`).
  async function copyUeberschrift(key, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUeb(key);
      setTimeout(() => setCopiedUeb(null), 1500);
    } catch (err) {
      alert('Kopieren fehlgeschlagen.');
    }
  }

  const hasItems = items.length > 0;
  const hasPlaceholder = hasItems && items.some(i => (drafts[i.stil] || i.text || '').includes('[Funnel-Link wird ergänzt]'));
  const hasOldLink = hasItems && funnelUrl && items.some(i => {
    const t = drafts[i.stil] || i.text || '';
    return /https?:\/\/\S+/.test(t) && !t.includes(funnelUrl);
  });
  const canUpdateLinks = !!funnelUrl && hasItems && (hasPlaceholder || hasOldLink || items.some(i => {
    const t = drafts[i.stil] || i.text || '';
    return !t.includes(funnelUrl);
  }));

  return (
    <div>
      <div className="adcopy-head">
        <div>
          <h2 className="section-title">Werbetexte</h2>
          <p className="section-sub">Drei Stile auf Basis aller Briefing-Infos. Editierbar, einzeln oder alle neu generierbar.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {funnelUrl && canUpdateLinks && (
            <button className="btn-ghost" onClick={updateLinks} disabled={updateLinksBusy}>
              {updateLinksBusy ? 'Aktualisiere…' : '🔗 Links in Ad Copies aktualisieren'}
            </button>
          )}
          <button className="btn-primary" onClick={generateAll} disabled={genAllBusy || regenStil}>
            {genAllBusy ? 'Generiere alle…' : (items.length ? 'Alle neu generieren' : 'Ad Copies generieren')}
          </button>
        </div>
      </div>

      {!funnelUrl && (
        <div className="warn-banner">
          ⚠️ Noch kein Bewerbungslink vorhanden — bitte zuerst im Tab „Funnel" einen Funnel anlegen und veröffentlichen oder einen externen Link eintragen. Solange erscheint im Text nur ein Platzhalter.
        </div>
      )}

      {/* ─────── Headlines / Überschriften ─────── */}
      <section className="card-form" style={{ marginBottom: 18 }}>
        <div className="adcopy-head" style={{ marginBottom: 0 }}>
          <div>
            <div className="form-section-title" style={{ marginBottom: 4 }}>Überschriften (Headlines)</div>
            <div className="motiv-sub">
              5 kurze Headlines mit Emoji — für Meta-Anzeigen-Texte oder als Variante in den Funnel-Screens. Editierbar.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {headlines.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: headlinesDirty ? 'var(--ink-4)' : '#0a8043' }}>
                {headlinesDirty ? 'Auto-Save…' : '✓ Gespeichert'}
              </span>
            )}
            <button className="btn-ghost btn-sm" onClick={generateHeadlines} disabled={headlinesBusy}>
              {headlinesBusy ? 'Generiere…' : (headlines.length ? '🔄 Neu generieren' : '✨ Headlines generieren')}
            </button>
          </div>
        </div>

        {headlinesBusy && headlines.length === 0 && (
          <div className="motiv-skeleton" style={{ marginTop: 12 }}><div /><div /><div /><div /><div /></div>
        )}

        {headlines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {headlines.map((h, i) => (
              <div key={i} className="headline-row">
                <span className="headline-num">{i + 1}</span>
                <input
                  type="text"
                  value={h}
                  onChange={e => setHeadlineAt(i, e.target.value)}
                  onBlur={() => headlinesDirty && saveHeadlines()}
                  maxLength={80}
                  className="headline-input"
                />
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => copyHeadline(i)}
                  title="In Zwischenablage kopieren"
                >{headlinesCopiedIdx === i ? '✓ Kopiert' : 'Kopieren'}</button>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
              Tipp: Pro Headline max. 40 Zeichen für Meta-Anzeigen. Änderungen werden beim Verlassen des Felds automatisch gespeichert.
            </div>
          </div>
        )}

        {!headlinesBusy && headlines.length === 0 && (
          <p className="motiv-sub" style={{ marginTop: 12, marginBottom: 0 }}>
            Noch keine Headlines generiert — Klick oben rechts auf „Headlines generieren".
          </p>
        )}
      </section>

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
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {item?.bearbeitet && <span className="adcopy-edited-badge">bearbeitet</span>}
                    {item && (reviewKommentare[`adcopy_${item.id}`] || '').trim() && (
                      <span className="adcopy-feedback-badge" title="Kunde hat einen Änderungswunsch hinterlassen">📝 Änderungswunsch</span>
                    )}
                  </div>
                </header>

                {item && (reviewKommentare[`adcopy_${item.id}`] || '').trim() && (
                  <div className="creative-kommentar" style={{ margin: '8px 0 12px' }}>
                    <div className="creative-kommentar-head">📝 Änderungswunsch vom Kunden</div>
                    <div className="creative-kommentar-body">{reviewKommentare[`adcopy_${item.id}`]}</div>
                  </div>
                )}

                {!item && (genAllBusy || busy) && (
                  <div className="adcopy-skeleton">
                    <div /><div /><div /><div /><div className="short" />
                  </div>
                )}

                {item && (
                  <textarea
                    className="adcopy-text"
                    value={text}
                    onChange={e => { const v = e.target.value; setDrafts(prev => ({ ...prev, [s.id]: v })); scheduleSave(s.id, v); }}
                    onBlur={() => { clearTimeout(saveTimers.current[s.id]); if (isDirty(s.id)) saveOne(s.id, drafts[s.id]); }}
                    rows={s.id === 'kompakt' ? 6 : (s.id === 'benefit' ? 12 : 14)}
                    disabled={busy}
                  />
                )}

                {item && Array.isArray(item.ueberschriften) && item.ueberschriften.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: '1px dashed var(--line, #e5e5e5)', paddingTop: 10 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.05, color: 'var(--ink-3)', marginBottom: 6 }}>
                      Überschriften · Meta (~40 Zeichen)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {item.ueberschriften.map((u, i) => {
                        const key = `${item.id}:${i}`;
                        const tooLong = (u || '').length > 40;
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ flex: 1, fontSize: 13 }} title={tooLong ? 'Länger als 40 Zeichen — wird bei Meta ggf. abgeschnitten' : undefined}>
                              {u}{tooLong && <span style={{ color: 'var(--ink-4, #b26b00)', marginLeft: 6, fontSize: 11 }}>· {u.length}</span>}
                            </span>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => copyUeberschrift(key, u)} title="In Zwischenablage kopieren">
                              {copiedUeb === key ? '✓ Kopiert' : 'Kopieren'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
                    <span style={{ fontSize: 12, fontWeight: 600, color: savingId === item.id ? 'var(--ink-3)' : (dirty ? 'var(--ink-4)' : '#0a8043') }}>
                      {savingId === item.id ? 'Speichert…' : (dirty ? 'Auto-Save…' : '✓ Gespeichert')}
                    </span>
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
