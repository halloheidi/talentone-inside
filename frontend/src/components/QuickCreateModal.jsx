import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

const TABS = [
  { id: 'url', label: 'URL' },
  { id: 'file', label: 'PDF / DOCX' },
  { id: 'manual', label: 'Manuell' },
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

  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  // Logo (optional, für alle drei Modi)
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const logoInputRef = useRef(null);

  function reset() {
    setTab('url');
    setError('');
    setBusy(false);
    setUrl('');
    setFile(null);
    setManual(EMPTY_MANUAL);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview(null);
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
      footer={
        <>
          <button className="btn-ghost" onClick={close} disabled={busy}>Abbrechen</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy
              ? (tab === 'manual' ? 'Speichere…' : 'Analysiere…')
              : (tab === 'manual' ? 'Anlegen' : 'Analysieren & Anlegen')}
          </button>
        </>
      }
    >
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

      {/* Logo-Upload (für alle Modi gemeinsam) */}
      <div className="logo-upload-row">
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
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}
      {busy && (tab === 'url' || tab === 'file') && (
        <div className="extract-hint">
          {tab === 'url' ? 'Lade Seite und extrahiere Daten — kann 10-30 Sekunden dauern…' : 'Lese Datei und extrahiere Daten…'}
        </div>
      )}
    </Modal>
  );
}
