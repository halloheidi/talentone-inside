import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import CloseLeadWarnung from './CloseLeadWarnung.jsx';
import AnredeAbfrage from './AnredeAbfrage.jsx';
import { anredeOffen, anrede } from '../lib/anrede.js';
import { api } from '../lib/api.js';

// Termin-Einladung senden. Kontext = Job (endpoint=/jobs/:id/export/termin-einladung)
// ODER Kunde direkt (endpoint=/kunden/:id/termin-einladung).
// Terminarten + Calendly-Links kommen dynamisch vom Backend (GET /termine/config).
export default function TerminEinladungModal({
  open, onClose, kunde,
  // Entweder jobId ODER kundeId muss gesetzt sein
  jobId, kundeId,
  onKundeUpdated, onSent,
}) {
  const [config, setConfig] = useState(null);
  const [terminKey, setTerminKey] = useState('');
  const [personKey, setPersonKey] = useState('');
  const [empfaenger, setEmpfaenger] = useState('');
  const [subject, setSubject] = useState('');
  const [customText, setCustomText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Config nachladen sobald Modal offen
  useEffect(() => {
    if (!open || config) return;
    api('/termine/config').then(res => setConfig(res.termine || {})).catch(() => setConfig({}));
  }, [open, config]);

  // Beim Öffnen: Empfänger vorbelegen, erste Terminart auswählen
  useEffect(() => {
    if (!open) return;
    setEmpfaenger((kunde?.email || '').trim());
    setMsg('');
    if (config && !terminKey) {
      const firstKey = Object.keys(config)[0] || '';
      setTerminKey(firstKey);
    }
  }, [open, kunde?.email, config, terminKey]);

  // Wenn Terminart wechselt: person automatisch setzen (wenn nur eine verfügbar)
  useEffect(() => {
    if (!terminKey || !config?.[terminKey]) return;
    const personen = config[terminKey].personen || [];
    if (personen.length === 1) setPersonKey(personen[0].key);
    else if (!personen.some(p => p.key === personKey)) setPersonKey('');
    // Betreff + Text-Default aus Config vorbelegen. Der Mail-Text wird in der am
    // Kunden gesetzten Anrede (Du/Sie) erzeugt — erst wenn diese feststeht.
    setSubject(config[terminKey].subject || '');
    setCustomText(anredeOffen(kunde)
      ? ''
      : `${anrede(kunde)},\n\n${config[terminKey].intro || ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminKey, config, kunde?.anrede_form]);

  const verfuegbarePersonen = useMemo(() => {
    return config?.[terminKey]?.personen || [];
  }, [config, terminKey]);

  async function send() {
    setMsg(''); setBusy(true);
    try {
      if (!terminKey) throw new Error('Bitte eine Terminart wählen.');
      if (!personKey) throw new Error('Bitte auswählen: bei wem?');
      if (!empfaenger.trim()) throw new Error('Empfänger-E-Mail fehlt.');
      const path = jobId
        ? `/jobs/${jobId}/export/termin-einladung`
        : `/kunden/${kundeId}/termin-einladung`;
      await api(path, {
        method: 'POST',
        body: {
          terminKey, personKey,
          to: empfaenger.trim(),
          subject: subject.trim() || null,
          customText: customText.trim() || null,
        },
      });
      onSent?.();
      onClose();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const linkPreview = config?.[terminKey]?.[personKey]
    || (verfuegbarePersonen.find(p => p.key === personKey) ? '' : '');

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="📅 Termin-Einladung senden"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="btn-primary" onClick={send}
            disabled={busy || !terminKey || !personKey || !empfaenger.trim() || anredeOffen(kunde)}>
            {busy ? 'Sende…' : 'Einladung senden'}
          </button>
        </>
      }
    >
      {!config ? (
        <p>Lade Termin-Katalog…</p>
      ) : (
        <>
          <AnredeAbfrage kunde={kunde} onSaved={onKundeUpdated} />
          <CloseLeadWarnung kunde={kunde} onSaved={onKundeUpdated} />

          <div className="form-grid" style={{ marginBottom: 12 }}>
            <label className="field field-full">
              <span>Terminart</span>
              <select value={terminKey} onChange={e => setTerminKey(e.target.value)}>
                {Object.entries(config).map(([k, t]) => (
                  <option key={k} value={k}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="field field-full">
              <span>Bei wem</span>
              {verfuegbarePersonen.length <= 1 ? (
                <input readOnly value={verfuegbarePersonen[0]?.label || '—'}
                  style={{ background: '#fafaf8' }} />
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  {verfuegbarePersonen.map(p => (
                    <button
                      key={p.key} type="button"
                      onClick={() => setPersonKey(p.key)}
                      className={`pub-filter ${personKey === p.key ? 'is-active' : ''}`}
                    >{p.label}</button>
                  ))}
                </div>
              )}
            </label>
            <label className="field field-full">
              <span>Empfänger</span>
              <input type="email" value={empfaenger}
                onChange={e => setEmpfaenger(e.target.value)} />
            </label>
            <label className="field field-full">
              <span>Betreff</span>
              <input value={subject} onChange={e => setSubject(e.target.value)} />
            </label>
            {anredeOffen(kunde) ? (
              <div className="field-full" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                Bitte oben zuerst die Anrede festlegen — danach wird der Mail-Text in der passenden Form (Du/Sie) erzeugt und lässt sich hier prüfen.
              </div>
            ) : (
              <label className="field field-full">
                <span>Mail-Text (editierbar)</span>
                <textarea rows={7} value={customText} onChange={e => setCustomText(e.target.value)} />
              </label>
            )}
          </div>

          {linkPreview && (
            <p style={{ fontSize: 12, color: '#5a5955', marginTop: 0 }}>
              Calendly-Link: <code style={{ fontSize: 11 }}>{linkPreview}</code>
            </p>
          )}

          {msg && <div className="form-msg" style={{ color: '#c1272d' }}>{msg}</div>}
        </>
      )}
    </Modal>
  );
}
