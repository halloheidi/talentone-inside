import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

// Admin-Verwaltung der Kunden-Mail-Vorlagen (talentone_email_templates).
// Übersicht nach Bereich · Editor (Du/Sie · Betreff/Body) mit Platzhalter-Leiste ·
// Live-Vorschau mit Demo-Kunde · Test-Mail an mich · Auf Standard zurücksetzen.
// Änderungen greifen sofort ohne Deploy (der Versand liest die DB via renderEmail).

const AGENTUR_LABEL = { talentone: 'TalentOne', nowagwirth: 'Nowag & Wirth' };

export default function EmailVorlagen() {
  const { me } = useAuth();
  const [bereiche, setBereiche] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [agentur, setAgentur] = useState('talentone');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api('/email-vorlagen');
      setBereiche(res.bereiche || []);
      setTemplates(res.templates || []);
      setError('');
    } catch (err) {
      setError(err.body?.error || err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const openTemplate = templates.find(t => t.key === openKey) || null;

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">✉️ E-Mail-Vorlagen</h1>
          <p className="page-sub">Alle Mails, die das Tool an Kunden versendet — getrennte Du-/Sie-Fassung, sofort wirksam ohne Deploy.</p>
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid #d8d7d2', borderRadius: 100, overflow: 'hidden' }}>
          {['talentone', 'nowagwirth'].map(a => (
            <button key={a} onClick={() => setAgentur(a)}
              style={{
                padding: '8px 16px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                background: agentur === a ? '#0a0a0a' : '#fff', color: agentur === a ? '#fff' : '#5a5955',
              }}>
              {AGENTUR_LABEL[a]}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="page-sub">Lade…</div>}

      {!loading && bereiche.map(b => {
        const items = templates.filter(t => t.bereich === b.id);
        if (!items.length) return null;
        return (
          <div key={b.id} style={{ marginBottom: 28 }}>
            <div className="nav-section" style={{ margin: '0 0 10px' }}>{b.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {items.map(t => {
                const row = t.rows[agentur];
                const inaktiv = row && row.aktiv === false;
                return (
                  <button key={t.key} onClick={() => setOpenKey(t.key)}
                    style={{
                      textAlign: 'left', background: '#fff', border: '1px solid #ececea', borderRadius: 12,
                      padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14 }}>{t.name}</strong>
                      {t.betreffOnly && <span style={badge('#eef')}>Nur Betreff</span>}
                      {inaktiv && <span style={badge('#fee', '#b00')}>Inaktiv</span>}
                    </div>
                    <span style={{ fontSize: 12, lineHeight: 1.5, color: '#5a5955' }}>{t.beschreibung}</span>
                    <span style={{ fontSize: 11, color: '#9a9994', marginTop: 2 }}>
                      Betreff: {row?.[`betreff_du`] || <em>—</em>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {!loading && (
        <div style={{ marginTop: 28 }}>
          <div className="nav-section" style={{ margin: '0 0 10px' }}>Weitere Mails — im Angebots-Katalog editierbar</div>
          <div style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 12, padding: 16 }}>
            <p style={{ fontSize: 12.5, lineHeight: 1.55, color: '#5a5955', margin: '0 0 12px' }}>
              Diese Kunden-Mails laufen bereits über ein eigenes Vorlagen-System (markenspezifische Textbausteine, mit
              Merge-Tags statt getrennter Du-/Sie-Fassung). Sie sind unter <strong>Admin → Angebots-Katalog → Textbausteine</strong> editierbar:
            </p>
            <ul style={{ fontSize: 13, lineHeight: 1.7, color: '#2a2a2a', margin: '0 0 12px', paddingLeft: 18 }}>
              <li><strong>Angebots-Versand</strong> (offer_email_subject/body)</li>
              <li><strong>Auftragsbestätigung / AB</strong> (order_email_subject/body)</li>
              <li><strong>easybill-Rechnung</strong> (invoice_email_subject/body)</li>
              <li><strong>Zahlungserinnerung</strong> (reminder_email)</li>
              <li><strong>Hire-Meilenstein</strong> — erste Einstellung / Fortschritt / Ziel erreicht (hire_email_subject + hire_email_body_first/progress/complete)</li>
            </ul>
            <a href="/admin/angebots-katalog" className="btn-ghost btn-sm">→ Zum Angebots-Katalog</a>
          </div>
        </div>
      )}

      {openTemplate && (
        <Editor
          key={openTemplate.key + agentur}
          template={openTemplate}
          agentur={agentur}
          myEmail={me?.email}
          onClose={() => setOpenKey(null)}
          onSaved={() => { load(); }}
        />
      )}
    </div>
  );
}

function badge(bg, color = '#334') {
  return { fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', background: bg, color, padding: '2px 7px', borderRadius: 100 };
}

// ─────────────── Editor-Overlay ───────────────
function Editor({ template, agentur, myEmail, onClose, onSaved }) {
  const row = template.rows[agentur] || {};
  const [draft, setDraft] = useState({
    betreff_du: row.betreff_du || '',
    betreff_sie: row.betreff_sie || '',
    body_du: row.body_du || '',
    body_sie: row.body_sie || '',
    aktiv: row.aktiv === undefined ? true : !!row.aktiv,
  });
  const [tab, setTab] = useState('du');            // Du-/Sie-Fassung, die man bearbeitet
  const [preview, setPreview] = useState(null);    // { subject, html }
  const [previewErr, setPreviewErr] = useState('');
  const [busy, setBusy] = useState('');            // 'save' | 'test' | 'reset'
  const [notice, setNotice] = useState('');
  const activeFieldRef = useRef(null);             // zuletzt fokussiertes Feld für Platzhalter-Einfügen

  const betreffOnly = template.betreffOnly;
  const betreffVal = draft[`betreff_${tab}`];
  const bodyVal = draft[`body_${tab}`];

  function setField(field, value) {
    setDraft(d => ({ ...d, [`${field}_${tab}`]: value }));
  }

  function insertPlaceholder(ph) {
    const token = `{{${ph}}}`;
    const ctx = activeFieldRef.current;
    if (!ctx || !ctx.el) {
      // Kein Feld fokussiert → an Betreff anhängen.
      setField('betreff', (betreffVal || '') + token);
      return;
    }
    const el = ctx.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const val = el.value;
    const next = val.slice(0, start) + token + val.slice(end);
    setField(ctx.field, next);
    requestAnimationFrame(() => {
      try { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; } catch {}
    });
  }

  // Live-Vorschau (debounced) — rendert Editor-Inhalt serverseitig mit Demo-Kunde.
  useEffect(() => {
    const h = setTimeout(async () => {
      try {
        const res = await api(`/email-vorlagen/${template.key}/${agentur}/preview`, {
          method: 'POST',
          body: { form: tab, betreff: betreffVal, body: bodyVal },
        });
        setPreview(res);
        setPreviewErr('');
      } catch (err) {
        setPreviewErr(err.body?.error || err.message);
      }
    }, 350);
    return () => clearTimeout(h);
  }, [template.key, agentur, tab, betreffVal, bodyVal]);

  async function save() {
    setBusy('save'); setNotice('');
    try {
      await api(`/email-vorlagen/${template.key}/${agentur}`, {
        method: 'PUT',
        body: {
          betreff_du: draft.betreff_du, betreff_sie: draft.betreff_sie,
          body_du: betreffOnly ? null : draft.body_du,
          body_sie: betreffOnly ? null : draft.body_sie,
          aktiv: draft.aktiv,
        },
      });
      setNotice('Gespeichert ✓');
      onSaved();
    } catch (err) {
      setNotice('Fehler: ' + (err.body?.error || err.message));
    } finally { setBusy(''); }
  }

  async function testMail() {
    setBusy('test'); setNotice('');
    try {
      const res = await api(`/email-vorlagen/${template.key}/${agentur}/test`, {
        method: 'POST',
        body: { form: tab, betreff: betreffVal, body: bodyVal },
      });
      setNotice(`Test-Mail (${tab.toUpperCase()}) an ${res.to} verschickt ✓`);
    } catch (err) {
      setNotice('Fehler: ' + (err.body?.error || err.message));
    } finally { setBusy(''); }
  }

  async function reset() {
    if (!window.confirm(`„${template.name}" (${AGENTUR_LABEL[agentur]}) auf den Standard-Text zurücksetzen? Deine Änderungen an dieser Fassung gehen verloren.`)) return;
    setBusy('reset'); setNotice('');
    try {
      const res = await api(`/email-vorlagen/${template.key}/${agentur}/reset`, { method: 'POST' });
      const t = res.template || {};
      setDraft({
        betreff_du: t.betreff_du || '', betreff_sie: t.betreff_sie || '',
        body_du: t.body_du || '', body_sie: t.body_sie || '',
        aktiv: t.aktiv === undefined ? true : !!t.aktiv,
      });
      setNotice('Auf Standard zurückgesetzt ✓');
      onSaved();
    } catch (err) {
      setNotice('Fehler: ' + (err.body?.error || err.message));
    } finally { setBusy(''); }
  }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panel}>
        {/* Kopf */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid #ececea' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{template.name}</strong>
            <span style={badge('#f0efed')}>{AGENTUR_LABEL[agentur]}</span>
            {betreffOnly && <span style={badge('#eef')}>Nur Betreff editierbar</span>}
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose}>Schließen</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 0, flex: 1, minHeight: 0 }}>
          {/* Editor links */}
          <div style={{ padding: 20, overflowY: 'auto', borderRight: '1px solid #ececea' }}>
            <p style={{ fontSize: 12, lineHeight: 1.5, color: '#5a5955', margin: '0 0 14px' }}>{template.beschreibung}</p>

            {/* Du/Sie-Tabs */}
            <div style={{ display: 'inline-flex', border: '1px solid #d8d7d2', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
              {['du', 'sie'].map(f => (
                <button key={f} onClick={() => setTab(f)}
                  style={{ padding: '6px 18px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    background: tab === f ? '#0a0a0a' : '#fff', color: tab === f ? '#fff' : '#5a5955' }}>
                  {f === 'du' ? 'Du' : 'Sie'}
                </button>
              ))}
            </div>

            {/* Platzhalter-Leiste */}
            {template.platzhalter?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#9a9994', marginBottom: 6 }}>Platzhalter einfügen (an Cursor-Position):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {template.platzhalter.map(ph => (
                    <button key={ph} type="button" onClick={() => insertPlaceholder(ph)}
                      style={{ fontSize: 12, fontFamily: 'monospace', background: '#f0efed', border: '1px solid #d8d7d2',
                        borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                      {`{{${ph}}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Betreff */}
            <label className="field field-full">
              <span>Betreff ({tab === 'du' ? 'Du' : 'Sie'})</span>
              <input type="text" value={betreffVal}
                onChange={e => setField('betreff', e.target.value)}
                onFocus={e => { activeFieldRef.current = { el: e.target, field: 'betreff' }; }} />
            </label>

            {/* Body */}
            {betreffOnly ? (
              <div style={{ marginTop: 12, padding: 14, background: '#f0efed', borderRadius: 8, fontSize: 13, lineHeight: 1.5, color: '#5a5955' }}>
                <strong>Nur Betreff editierbar.</strong> Der Inhalt dieser Mail wird beim echten Versand dynamisch im Code erzeugt (Struktur, Buttons, Daten) — hier gibt es daher keinen editierbaren Body.
              </div>
            ) : (
              <label className="field field-full" style={{ marginTop: 12 }}>
                <span>Body ({tab === 'du' ? 'Du' : 'Sie'}) — Text, Absätze mit Leerzeile</span>
                <textarea rows={12} value={bodyVal}
                  onChange={e => setField('body', e.target.value)}
                  onFocus={e => { activeFieldRef.current = { el: e.target, field: 'body' }; }}
                  style={{ fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, resize: 'vertical' }} />
              </label>
            )}

            <label className="field-checkbox field-full" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={draft.aktiv} onChange={e => setDraft(d => ({ ...d, aktiv: e.target.checked }))} />
              <span>Aktiv <em style={{ fontStyle: 'normal', color: '#9a9994', fontSize: 12 }}>(inaktiv → beim Versand greift der Code-Standard)</em></span>
            </label>
          </div>

          {/* Vorschau rechts */}
          <div style={{ padding: 20, overflowY: 'auto', background: '#f7f6f4' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9a9994', marginBottom: 10 }}>
              Live-Vorschau · {tab === 'du' ? 'Du' : 'Sie'} · Demo-Kunde „Elektrotechnik Sonnberg GmbH"
            </div>
            {previewErr && <div className="alert alert-error">{previewErr}</div>}
            <div style={{ background: '#fff', border: '1px solid #ececea', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: '#9a9994' }}>Betreff</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{preview?.subject || <em style={{ color: '#c0bfba' }}>—</em>}</div>
            </div>
            <iframe title="preview" srcDoc={preview?.html || ''} style={{ width: '100%', height: 460, border: '1px solid #ececea', borderRadius: 8, background: '#fff' }} />
          </div>
        </div>

        {/* Fuß */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid #ececea', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Speichern…' : 'Speichern'}</button>
          <button className="btn-ghost" onClick={testMail} disabled={!!busy} title={myEmail ? `an ${myEmail}` : ''}>
            {busy === 'test' ? 'Sende…' : '✉️ Test-Mail an mich'}
          </button>
          <button className="btn-ghost btn-danger" onClick={reset} disabled={!!busy}>{busy === 'reset' ? 'Setze zurück…' : 'Auf Standard zurücksetzen'}</button>
          {notice && <span style={{ fontSize: 13, color: notice.startsWith('Fehler') ? '#b00' : '#0a7a0a', marginLeft: 4 }}>{notice}</span>}
          {myEmail && <span style={{ fontSize: 11, color: '#9a9994', marginLeft: 'auto' }}>Test-Mail geht an {myEmail}</span>}
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.45)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const panel = {
  background: '#fff', borderRadius: 16, width: 'min(1100px, 96vw)', height: 'min(88vh, 900px)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
};
