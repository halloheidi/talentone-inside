import { useEffect, useState, useRef } from 'react';
import { api, downloadAuthed } from '../lib/api.js';

const fmtBytes = b => !b ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

function KontextPanel({ kontext }) {
  if (!kontext) return null;
  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 10px', margin: '0 0 12px', fontSize: 12.5 }}>
      {kontext.typ === 'kunde'
        ? <>🏢 <b>{kontext.firmenname}</b>{kontext.projekt_status ? ` · Status: ${kontext.projekt_status}` : ''}{kontext.naechster_schritt ? ` · nächster Schritt: ${kontext.naechster_schritt}` : ''}{kontext.offene_rechnungen ? ` · ${kontext.offene_rechnungen} offene Rechnung(en)` : ''}</>
        : <>👤 <b>{kontext.name}</b>{kontext.job_stelle ? ` · ${kontext.job_stelle}` : ''} · Status: {kontext.telefonisten_status}</>}
    </div>
  );
}

export default function MailSlideOver({ mail, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [bilder, setBilder] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  // Antwort-Strecke
  const [vorschlag, setVorschlag] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hinweis, setHinweis] = useState(null);
  const [status, setStatus] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const timer = useRef(null);
  const kontoId = mail.konto_email;

  function load(mitBilder) {
    setData(null); setErr(null);
    api(`/gmail/nachricht?kontoId=${encodeURIComponent(kontoId)}&messageId=${encodeURIComponent(mail.id)}&bilder=${mitBilder ? 1 : 0}`)
      .then(setData).catch(e => setErr(e.message));
  }
  useEffect(() => { load(false); /* eslint-disable-next-line */ }, [mail.id]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function vorschlagen() {
    setReplyOpen(true); setBusy(true); setHinweis(null);
    try {
      const r = await api('/gmail/vorschlag', { method: 'POST', body: { kontoId, messageId: mail.id } });
      setVorschlag(r.vorschlag || ''); setHinweis(r.hinweis || null);
    } catch (e) { setHinweis(e.message); } finally { setBusy(false); }
  }
  function startSend() {
    setCountdown(10);
    timer.current = setInterval(() => setCountdown(c => {
      if (c <= 1) {
        clearInterval(timer.current); timer.current = null;
        api('/gmail/senden', { method: 'POST', body: { kontoId, messageId: mail.id, text: vorschlag } })
          .then(() => { setStatus('gesendet'); setReplyOpen(false); }).catch(e => setHinweis(e.message));
        return 0;
      }
      return c - 1;
    }), 1000);
  }
  function undo() { if (timer.current) { clearInterval(timer.current); timer.current = null; } setCountdown(0); }
  async function draft() {
    setBusy(true);
    try { await api('/gmail/draft', { method: 'POST', body: { kontoId, messageId: mail.id, text: vorschlag } }); setStatus('draft'); setReplyOpen(false); }
    catch (e) { setHinweis(e.message); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#0006', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(620px, 100%)', height: '100%', background: '#fff', boxShadow: '-8px 0 30px #0003', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #ececea', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{mail.subject}</div>
            <div style={{ fontSize: 12.5, color: '#5a5955' }}><b>{mail.fromName}</b> &lt;{mail.fromEmail}&gt;{data?.date ? ` · ${new Date(data.date).toLocaleString('de-DE')}` : ''}</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <KontextPanel kontext={data?.kontext} />
          {err && <div className="alert alert-error">{err}</div>}
          {!data && !err && <div className="heute-empty">Lade Mail…</div>}

          {data && (
            <>
              {data.bilderBlockiert && !bilder && (
                <div style={{ background: '#fffaeb', border: '1px solid #f2d76b', borderRadius: 7, padding: '6px 10px', marginBottom: 10, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                  🖼 Externe Bilder blockiert.
                  <button className="heute-chip" style={{ background: '#0a0a0a', color: '#fff' }} onClick={() => { setBilder(true); load(true); }}>Bilder laden</button>
                </div>
              )}
              {data.html
                ? <iframe title="Mail" sandbox="" style={{ width: '100%', minHeight: 320, border: '1px solid #f0efed', borderRadius: 8, background: '#fff' }} srcDoc={data.html} />
                : <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, fontFamily: 'inherit', margin: 0 }}>{data.text || '(kein Textinhalt)'}</pre>}

              {data.anhaenge?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#5a5955', marginBottom: 4 }}>📎 Anhänge</div>
                  {data.anhaenge.map((a, i) => (
                    <button key={i} className="heute-chip" style={{ background: '#f0efed', color: '#333', border: '1px solid #ececea', marginRight: 6, marginBottom: 4 }}
                      onClick={() => downloadAuthed(`/gmail/anhang?kontoId=${encodeURIComponent(kontoId)}&messageId=${encodeURIComponent(mail.id)}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}&mimeType=${encodeURIComponent(a.mimeType)}`, a.filename)}>
                      ⬇ {a.filename} <span style={{ color: '#9a9994' }}>{fmtBytes(a.size)}</span>
                    </button>
                  ))}
                </div>
              )}

              {data.thread?.length > 1 && (
                <div style={{ marginTop: 14 }}>
                  <button onClick={() => setThreadOpen(o => !o)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#5a5955' }}>
                    {threadOpen ? '▾' : '▸'} Thread-Verlauf ({data.thread.length})
                  </button>
                  {threadOpen && data.thread.map((t, i) => (
                    <div key={i} style={{ borderLeft: '2px solid #ececea', paddingLeft: 8, margin: '6px 0', fontSize: 12 }}>
                      <div style={{ color: '#5a5955' }}><b>{(t.from || '').replace(/<[^>]+>/, '').trim()}</b> · {t.date ? new Date(t.date).toLocaleString('de-DE') : ''}</div>
                      <div style={{ color: '#9a9994' }}>{t.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Antwort-Strecke */}
        <div style={{ borderTop: '1px solid #ececea', padding: 12 }}>
          {status === 'gesendet' ? <div style={{ color: '#027a48', fontSize: 13, fontWeight: 600 }}>✓ Antwort gesendet</div>
            : status === 'draft' ? <div style={{ color: '#1d4ed8', fontSize: 13, fontWeight: 600 }}>✓ Als Gmail-Entwurf abgelegt</div>
            : !replyOpen ? <button className="btn-primary" onClick={vorschlagen} disabled={!data}>✏︎ Antwort vorschlagen</button>
            : (
              <>
                {hinweis && <div style={{ fontSize: 11, color: '#b54708', marginBottom: 4 }}>Hinweis: {hinweis}</div>}
                {busy && !vorschlag ? <div className="heute-empty">KI formuliert…</div> : (
                  <>
                    <textarea value={vorschlag} onChange={e => setVorschlag(e.target.value)} rows={6} style={{ width: '100%', padding: '8px 10px', border: '1px solid #ececea', borderRadius: 8, fontSize: 13, resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                      {countdown > 0
                        ? <><span style={{ fontSize: 12, color: '#b54708' }}>Senden in {countdown}s…</span><button className="heute-chip" style={{ background: '#b42318', color: '#fff' }} onClick={undo}>↩ Rückgängig</button></>
                        : <>
                            <button className="btn-primary" disabled={busy || !vorschlag.trim()} onClick={startSend}>Senden</button>
                            <button className="heute-chip" style={{ background: '#f0efed', color: '#333', border: '1px solid #ececea' }} disabled={busy || !vorschlag.trim()} onClick={draft}>Als Gmail-Entwurf</button>
                            <button className="heute-chip" style={{ background: 'none', color: '#999', border: 'none' }} onClick={() => setReplyOpen(false)}>Abbrechen</button>
                          </>}
                    </div>
                  </>
                )}
              </>
            )}
        </div>
      </div>
    </div>
  );
}
