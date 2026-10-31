import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import Modal from '../../components/Modal.jsx';

/**
 * Versand der Angebots-Begleitmail mit KI-Entwurf + Annahme-Link.
 * Lädt den KI-Entwurf (annahme-mail-preview), editierbar, Absender wählbar,
 * sendet über send-annahme-mail (Resend, easybill-PDF im Anhang, BCC intern).
 */
export default function AnnahmeMailModal({ offer, onClose, onSent }) {
  const [absender, setAbsender] = useState('johannes');
  const [absenderOptionen, setAbsenderOptionen] = useState([{ key: 'johannes', name: 'Johannes Wirth' }, { key: 'daniel', name: 'Daniel Nowag' }]);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [annahmeUrl, setAnnahmeUrl] = useState('');
  const [laden, setLaden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function entwurfLaden(abs = absender) {
    setLaden(true); setError('');
    try {
      const r = await api(`/offers/${offer.id}/annahme-mail-preview?absender=${abs}`);
      setSubject(r.subject || ''); setBody(r.body || '');
      setTo(prev => prev || r.to || '');
      setAnnahmeUrl(r.annahme_url || '');
      if (Array.isArray(r.absender_optionen) && r.absender_optionen.length) setAbsenderOptionen(r.absender_optionen);
    } catch (e) { setError(e.message); }
    finally { setLaden(false); }
  }

  useEffect(() => { entwurfLaden('johannes'); /* eslint-disable-next-line */ }, [offer.id]);

  async function senden() {
    if (!to.trim() || !subject.trim() || !body.trim()) { setError('Empfänger, Betreff und Text erforderlich.'); return; }
    setBusy(true); setError('');
    try {
      await api(`/offers/${offer.id}/send-annahme-mail`, { method: 'POST', body: { to: to.trim(), subject, body, absender } });
      onSent?.();
    } catch (e) { setError(e.body?.error || e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Angebot per Mail versenden">
      <div style={{ display: 'grid', gap: 10, minWidth: 460, maxWidth: 560 }}>
        {error && <div className="alert alert-error">{error}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Absender
            <select className="input" value={absender} onChange={e => { setAbsender(e.target.value); entwurfLaden(e.target.value); }}>
              {absenderOptionen.map(a => <option key={a.key} value={a.key}>{a.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 3, fontSize: 12, flex: 1, minWidth: 220 }}>Empfänger
            <input className="input" value={to} onChange={e => setTo(e.target.value)} placeholder="kunde@firma.de" />
          </label>
        </div>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Betreff
          <input className="input" value={subject} onChange={e => setSubject(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Text {laden && <span style={{ color: 'var(--ink-3)' }}>(KI entwirft…)</span>}
          <textarea className="input" rows={9} value={body} onChange={e => setBody(e.target.value)} style={{ resize: 'vertical' }} />
        </label>
        {annahmeUrl && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Annahme-Link (als Button in der Mail): {annahmeUrl}</div>}
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Das easybill-PDF wird automatisch angehängt, intern geht eine BCC mit.</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
          <button className="btn-ghost" onClick={() => entwurfLaden(absender)} disabled={busy || laden}>KI neu entwerfen</button>
          <button className="btn-primary" onClick={senden} disabled={busy || laden}>{busy ? 'Sende…' : 'Mit Annahme-Link senden'}</button>
        </div>
      </div>
    </Modal>
  );
}
