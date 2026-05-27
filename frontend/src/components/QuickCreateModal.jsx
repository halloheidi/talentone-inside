import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

const TABS = [
  { id: 'url', label: 'URL' },
  { id: 'file', label: 'PDF / DOCX' },
  { id: 'manual', label: 'Manuell' },
  { id: 'invite', label: 'Kunde füllt aus' },
];

const EMPTY_MANUAL = {
  firmenname: '', ansprechpartner: '', email: '', telefon: '', branche: '', notizen: '',
  stelle: '', region: '', gehalt: '',
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function detectFileType(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(file.name)
  ) return 'docx';
  return null;
}

export default function QuickCreateModal({ open, onClose }) {
  const nav = useNavigate();
  const [tab, setTab] = useState('url');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [agentur, setAgentur] = useState('talentone');

  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  // Logo (optional, für alle drei Modi)
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const logoInputRef = useRef(null);

  // Invite-Tab: Kunde füllt selbst aus
  const [invite, setInvite] = useState({ email: '', firmenname: '', ansprechpartner: '', customText: '' });
  const [inviteSuccess, setInviteSuccess] = useState(null); // { firmenname, formularUrl } | null

  function reset() {
    setTab('url');
    setError('');
    setBusy(false);
    setAgentur('talentone');
    setUrl('');
    setFile(null);
    setManual(EMPTY_MANUAL);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview(null);
    setInvite({ email: '', firmenname: '', ansprechpartner: '', customText: '' });
    setInviteSuccess(null);
  }

  function onLogoSelected(f) {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    if (!f) { setLogoFile(null); setLogoPreview(null); return; }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function submit() {
    setError('');
    setBusy(true);
    try {
      // Modus "Kunde füllt aus" — anderer Endpoint, kein Job-Anlegen
      if (tab === 'invite') {
        if (!invite.email.trim()) throw new Error('E-Mail des Kunden ist Pflicht.');
        const res = await api('/kunden/formular-anlegen', {
          method: 'POST',
          body: {
            email: invite.email.trim(),
            firmenname: invite.firmenname.trim() || undefined,
            ansprechpartner: invite.ansprechpartner.trim() || undefined,
            customText: invite.customText.trim() || undefined,
            agentur,
          },
        });
        setInviteSuccess({
          firmenname: res.kunde.firmenname || invite.email.trim(),
          formularUrl: res.formularUrl,
        });
        return;
      }

      let body;
      if (tab === 'url') {
        if (!url.trim()) throw new Error('Bitte URL eingeben.');
        body = { mode: 'url', url: url.trim() };
      } else if (tab === 'file') {
        if (!file) throw new Error('Bitte Datei auswählen.');
        const fileType = detectFileType(file);
        if (!fileType) throw new Error('Nur PDF oder DOCX werden unterstützt.');
        const fileData = await fileToBase64(file);
        body = { mode: 'file', fileType, fileData };
      } else {
        if (!manual.firmenname.trim()) throw new Error('Firmenname ist Pflicht.');
        if (!manual.stelle.trim()) throw new Error('Stelle ist Pflicht.');
        body = {
          mode: 'manual',
          kunde: {
            firmenname: manual.firmenname,
            ansprechpartner: manual.ansprechpartner,
            email: manual.email,
            telefon: manual.telefon,
            branche: manual.branche,
            notizen: manual.notizen,
          },
          job: { stelle: manual.stelle, region: manual.region, gehalt: manual.gehalt },
        };
      }

      // Optionales Logo — gilt für alle drei Modi
      if (logoFile) {
        const logoData = await fileToBase64(logoFile);
        body.logo = {
          fileData: logoData,
          fileName: logoFile.name,
          contentType: logoFile.type || 'image/png',
        };
      }

      body.agentur = agentur;
      const res = await api('/kunden/quick-create', { method: 'POST', body });
      reset();
      onClose();
      nav(`/kunden/${res.kunde.id}/jobs/${res.job.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Neuer Kunde / neues Projekt"
      footer={inviteSuccess ? null : (
        <>
          <button className="btn-ghost" onClick={close} disabled={busy}>Abbrechen</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy
              ? (tab === 'invite' || tab === 'manual' ? 'Sende…' : 'Analysiere…')
              : (tab === 'invite' ? 'Formular senden'
                : tab === 'manual' ? 'Anlegen'
                : 'Analysieren & Anlegen')}
          </button>
        </>
      )}
    >
      {/* Agentur-Auswahl — ganz oben, bestimmt komplettes Branding für diesen Kunden */}
      <div className="agentur-picker">
        <label className="agentur-picker-label">Für welche Agentur ist dieser Kunde?</label>
        <div className="agentur-options">
          <label className={`agentur-option ${agentur === 'talentone' ? 'is-active' : ''}`}>
            <input type="radio" name="agentur" value="talentone" checked={agentur === 'talentone'} onChange={() => setAgentur('talentone')} disabled={busy} />
            <strong>TalentOne</strong>
            <span>inside.talent-one.de</span>
          </label>
          <label className={`agentur-option ${agentur === 'nowagwirth' ? 'is-active' : ''}`}>
            <input type="radio" name="agentur" value="nowagwirth" checked={agentur === 'nowagwirth'} onChange={() => setAgentur('nowagwirth')} disabled={busy} />
            <strong>Nowag &amp; Wirth</strong>
            <span>recruiting.nowagwirth.com</span>
          </label>
        </div>
      </div>

      <div className="modal-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`modal-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => !busy && setTab(t.id)}
            disabled={busy}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'url' && (
        <div className="modal-pane">
          <p className="pane-hint">URL einer Stellenanzeige einfügen — wir scrapen die Seite und lassen die KI Firma, Stelle, Benefits etc. automatisch erkennen.</p>
          <label className="field field-full">
            <span>URL der Stellenanzeige</span>
            <input
              type="url"
              placeholder="https://…"
              value={url}
              onChange={e => setUrl(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
      )}

      {tab === 'file' && (
        <div className="modal-pane">
          <p className="pane-hint">PDF oder DOCX hochladen — die KI extrahiert alle relevanten Felder.</p>
          <div
            className={`drop-zone ${dragOver ? 'is-over' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !busy && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }}
              onChange={e => setFile(e.target.files?.[0] || null)}
              disabled={busy}
            />
            {file ? (
              <div className="drop-file">
                <strong>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(0)} KB · klicken zum Tauschen</span>
              </div>
            ) : (
              <div className="drop-empty">
                <strong>Datei hierher ziehen</strong>
                <span>oder klicken, um auszuwählen — PDF oder DOCX</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'invite' && (
        <div className="modal-pane">
          {inviteSuccess ? (
            <div className="invite-success">
              <strong>Mail verschickt.</strong>
              <p>Wir haben das Briefing-Formular an <strong>{invite.email}</strong> geschickt. Sobald der Kunde es ausfüllt, erscheint er automatisch in der Liste.</p>
              <p className="invite-link">Persönlicher Link: <a href={inviteSuccess.formularUrl} target="_blank" rel="noreferrer">{inviteSuccess.formularUrl}</a></p>
              <button className="btn-primary" onClick={() => { reset(); onClose(); }}>Schließen</button>
            </div>
          ) : (
            <>
              <p className="pane-hint">Wir verschicken eine Mail mit einem persönlichen Briefing-Formular. Der Kunde trägt dort alles ein (Firma, Stelle, Benefits, Logo, Fotos…), Status wechselt automatisch von „wartend" auf „aktiv", sobald er fertig ist.</p>
              <div className="form-grid">
                <label className="field field-full">
                  <span>E-Mail des Kunden *</span>
                  <input
                    type="email"
                    placeholder="ansprechpartner@firma.de"
                    value={invite.email}
                    onChange={e => setInvite({ ...invite, email: e.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>Firmenname (optional)</span>
                  <input value={invite.firmenname} onChange={e => setInvite({ ...invite, firmenname: e.target.value })} />
                </label>
                <label className="field">
                  <span>Ansprechpartner (optional)</span>
                  <input value={invite.ansprechpartner} onChange={e => setInvite({ ...invite, ansprechpartner: e.target.value })} />
                </label>
                <label className="field field-full">
                  <span>Persönlicher Mail-Text (optional)</span>
                  <textarea
                    rows={3}
                    placeholder="Wenn leer, nehmen wir den Standard-Text."
                    value={invite.customText}
                    onChange={e => setInvite({ ...invite, customText: e.target.value })}
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'manual' && (
        <div className="modal-pane">
          <p className="pane-hint">Trage Kunde und erste Stelle direkt ein.</p>
          <div className="form-section">
            <div className="form-section-title">Kunde</div>
            <div className="form-grid">
              <label className="field field-full">
                <span>Firmenname *</span>
                <input value={manual.firmenname} onChange={e => setManual({ ...manual, firmenname: e.target.value })} required />
              </label>
              <label className="field">
                <span>Ansprechpartner</span>
                <input value={manual.ansprechpartner} onChange={e => setManual({ ...manual, ansprechpartner: e.target.value })} />
              </label>
              <label className="field">
                <span>Branche</span>
                <input value={manual.branche} onChange={e => setManual({ ...manual, branche: e.target.value })} />
              </label>
              <label className="field">
                <span>E-Mail</span>
                <input type="email" value={manual.email} onChange={e => setManual({ ...manual, email: e.target.value })} />
              </label>
              <label className="field">
                <span>Telefon</span>
                <input value={manual.telefon} onChange={e => setManual({ ...manual, telefon: e.target.value })} />
              </label>
            </div>
          </div>
          <div className="form-section">
            <div className="form-section-title">Erstes Projekt</div>
            <div className="form-grid">
              <label className="field field-full">
                <span>Stellenbezeichnung *</span>
                <input value={manual.stelle} onChange={e => setManual({ ...manual, stelle: e.target.value })} required />
              </label>
              <label className="field">
                <span>Region</span>
                <input value={manual.region} onChange={e => setManual({ ...manual, region: e.target.value })} />
              </label>
              <label className="field">
                <span>Gehalt</span>
                <input value={manual.gehalt} onChange={e => setManual({ ...manual, gehalt: e.target.value })} />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Logo-Upload (für alle Modi gemeinsam — außer "Kunde füllt aus") */}
      {tab !== 'invite' && <div className="logo-upload-row">
        <div className="logo-upload-preview">
          {logoPreview
            ? <img src={logoPreview} alt="Logo-Vorschau" />
            : <span>Logo</span>}
        </div>
        <div className="logo-upload-text">
          <strong>Logo (optional)</strong>
          <span>Wir extrahieren daraus auch die Markenfarben für die Creatives.</span>
        </div>
        <div className="logo-upload-actions">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            style={{ display: 'none' }}
            onChange={e => onLogoSelected(e.target.files?.[0] || null)}
            disabled={busy}
          />
          {logoFile
            ? (
              <>
                <button className="btn-ghost btn-sm" onClick={() => logoInputRef.current?.click()} disabled={busy}>Tauschen</button>
                <button className="btn-ghost btn-sm" onClick={() => onLogoSelected(null)} disabled={busy}>Entfernen</button>
              </>
            )
            : <button className="btn-ghost btn-sm" onClick={() => logoInputRef.current?.click()} disabled={busy}>Datei wählen</button>}
        </div>
      </div>}

      {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}
      {busy && (tab === 'url' || tab === 'file') && (
        <div className="extract-hint">
          {tab === 'url' ? 'Lade Seite und extrahiere Daten — kann 10-30 Sekunden dauern…' : 'Lese Datei und extrahiere Daten…'}
        </div>
      )}
    </Modal>
  );
}
