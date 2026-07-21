// Modal für „Neues Projekt" bei bestehendem Kunden — 4 Wege:
// URL · PDF/DOCX · Manuell · Briefing-Mail an Kunden

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal.jsx';
import CloseLeadWarnung from './CloseLeadWarnung.jsx';
import ProjektFlagsFields from './ProjektFlagsFields.jsx';
import AnredeAbfrage from './AnredeAbfrage.jsx';
import { anredeOffen } from '../lib/anrede.js';
import { api } from '../lib/api.js';

const TABS = [
  { id: 'url', label: 'URL' },
  { id: 'file', label: 'PDF / DOCX' },
  { id: 'manual', label: 'Manuell' },
  { id: 'formular', label: 'Kunde füllt aus' },
];

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

export default function NewProjectModal({ open, onClose, kunde }) {
  const nav = useNavigate();
  const [tab, setTab] = useState('url');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null); // { mode: 'formular', email }
  // Wenn die Close Lead ID im Modal nachgetragen wird, halten wir sie lokal
  // vor — der Parent sieht das Update erst nach Modal-Close per onCreated.
  const [kundeLocal, setKundeLocal] = useState(null);
  const currentKunde = kundeLocal || kunde;
  // Projekttyp — bei N&W wählbar zwischen Mitarbeitergewinnung (default)
  // und Neukundengewinnung. Bei TalentOne bleibt es fix Mitarbeitergewinnung.
  const kannNeukunden = kunde?.agentur === 'nowagwirth';
  const [projekttyp, setProjekttyp] = useState('mitarbeitergewinnung');
  const [projektStatus, setProjektStatus] = useState('vorbereitung');
  const [kickoffTermin, setKickoffTermin] = useState('');
  const [projektFlags, setProjektFlags] = useState({
    projektdauer: '', fotograf_noetig: false, zahlung_aufgeteilt: false,
    garantie: false, garantie_details: '',
  });

  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [manual, setManual] = useState({ stelle: '', region: '', gehalt: '' });
  const [customText, setCustomText] = useState('');
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setTab('url');
    setBusy(false);
    setError('');
    setSuccess(null);
    setUrl('');
    setFile(null);
    setManual({ stelle: '', region: '', gehalt: '' });
    setCustomText('');
    setDragOver(false);
  }

  function close() {
    if (busy) return;
    reset();
    onClose?.();
  }

  async function submit() {
    setError('');
    setBusy(true);
    try {
      let body = {
        kunde_id: kunde.id, projekttyp,
        projekt_status: projektStatus,
        kickoff_termin: projektStatus === 'kickoff_vereinbart' ? (kickoffTermin || null) : null,
        projektdauer: projektFlags.projektdauer || null,
        fotograf_noetig: !!projektFlags.fotograf_noetig,
        zahlung_aufgeteilt: !!projektFlags.zahlung_aufgeteilt,
        garantie: !!projektFlags.garantie,
        garantie_details: projektFlags.garantie ? (projektFlags.garantie_details || null) : null,
      };
      if (tab === 'url') {
        if (!url.trim()) throw new Error('Bitte URL eingeben.');
        body.mode = 'url';
        body.url = url.trim();
      } else if (tab === 'file') {
        if (!file) throw new Error('Bitte Datei auswählen.');
        const fileType = detectFileType(file);
        if (!fileType) throw new Error('Nur PDF oder DOCX werden unterstützt.');
        body.mode = 'file';
        body.fileType = fileType;
        body.fileData = await fileToBase64(file);
      } else if (tab === 'manual') {
        if (!manual.stelle.trim()) throw new Error('Stellenbezeichnung ist Pflicht.');
        body.mode = 'manual';
        body.job = manual;
      } else if (tab === 'formular') {
        if (!kunde.email) throw new Error('Kunde hat keine E-Mail-Adresse hinterlegt.');
        body.mode = 'formular';
        if (customText.trim()) body.customText = customText.trim();
      }

      const res = await api('/jobs/quick-create', { method: 'POST', body });

      if (body.mode === 'formular') {
        setSuccess({ mode: 'formular', email: kunde.email });
      } else {
        reset();
        onClose?.();
        nav(`/kunden/${kunde.id}/jobs/${res.job.id}`);
      }
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
      title={`Neues Projekt für ${kunde?.firmenname || '?'}`}
      footer={success ? null : (
        <>
          <button className="btn-ghost" onClick={close} disabled={busy}>Abbrechen</button>
          <button className="btn-primary" onClick={submit} disabled={busy || (tab === 'formular' && anredeOffen(currentKunde))}>
            {busy
              ? (tab === 'formular' ? 'Sende Mail…' : (tab === 'manual' ? 'Speichere…' : 'Analysiere…'))
              : (tab === 'formular' ? 'Briefing-Mail senden'
                : tab === 'manual' ? 'Projekt anlegen'
                : 'Analysieren & anlegen')}
          </button>
        </>
      )}
    >
      {success ? (
        <div className="invite-success">
          <strong>Briefing-Mail verschickt.</strong>
          <p>Wir haben eine Briefing-Anfrage an <strong>{success.email}</strong> geschickt. Das Projekt steht jetzt mit Status „[Briefing ausstehend]" in der Kanban-Übersicht. Sobald der Kunde antwortet, kannst du die Details manuell ergänzen oder einen neuen Briefing-Modus starten.</p>
          <button className="btn-primary" onClick={() => { reset(); onClose?.(); }}>Schließen</button>
        </div>
      ) : (
        <>
          {kannNeukunden && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: 0.03 }}>PROJEKTTYP</span>
              <button type="button" onClick={() => setProjekttyp('mitarbeitergewinnung')} disabled={busy}
                className={`pub-filter ${projekttyp === 'mitarbeitergewinnung' ? 'is-active' : ''}`}>
                👷 Mitarbeitergewinnung
              </button>
              <button type="button" onClick={() => setProjekttyp('neukundengewinnung')} disabled={busy}
                className={`pub-filter ${projekttyp === 'neukundengewinnung' ? 'is-active' : ''}`}>
                🎯 Neukundengewinnung
              </button>
            </div>
          )}

          <div style={{ padding: 12, background: '#fafaf8', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: 0.03, marginBottom: 8 }}>PROJEKT-ECKDATEN</div>
            <div className="form-grid" style={{ marginBottom: 10 }}>
              <label className="field">
                <span>Start-Status</span>
                <select value={projektStatus} onChange={e => setProjektStatus(e.target.value)}>
                  <option value="vorbereitung">Vorbereitung</option>
                  <option value="kickoff_vereinbart">Kick-Off vereinbart</option>
                  <option value="onboarding">Onboarding</option>
                  <option value="warte_auf_go">Warte auf Go!</option>
                  <option value="live">Live</option>
                </select>
              </label>
              {projektStatus === 'kickoff_vereinbart' && (
                <label className="field">
                  <span>Kick-Off Termin</span>
                  <input type="date" value={kickoffTermin} onChange={e => setKickoffTermin(e.target.value)} />
                </label>
              )}
            </div>
            <ProjektFlagsFields
              value={projektFlags}
              onChange={setProjektFlags}
              agentur={kunde?.agentur}
            />
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
              <p className="pane-hint">URL einer Stellenanzeige einfügen — die KI extrahiert Stelle, Benefits, Aufgaben etc. automatisch.</p>
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
              <p className="pane-hint">PDF oder DOCX der Stellenanzeige hochladen — die KI extrahiert alle relevanten Felder.</p>
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
              <p className="pane-hint">Trage die Eckdaten des Projekts direkt ein.</p>
              <div className="form-grid">
                <label className="field field-full">
                  <span>Stellenbezeichnung *</span>
                  <input
                    value={manual.stelle}
                    onChange={e => setManual({ ...manual, stelle: e.target.value })}
                    placeholder="z.B. Servicetechniker:in im Außendienst"
                    required
                  />
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
          )}

          {tab === 'formular' && (
            <div className="modal-pane">
              <p className="pane-hint">
                Wir verschicken eine Briefing-Anfrage an <strong>{currentKunde?.email || '(keine E-Mail hinterlegt)'}</strong>. Das Projekt wird mit Status „[Briefing ausstehend]" in der Kanban-Übersicht angelegt. Sobald der Kunde antwortet (per Mail-Antwort oder über den Upload-Link), kannst du die Details direkt im Projekt ergänzen.
              </p>
              {!currentKunde?.email && (
                <div className="alert alert-warn" style={{ marginBottom: 12 }}>
                  ⚠ Der Kunde hat keine E-Mail-Adresse hinterlegt — bitte erst beim Kunden ergänzen.
                </div>
              )}
              <CloseLeadWarnung kunde={currentKunde} onSaved={setKundeLocal} />
              <AnredeAbfrage kunde={currentKunde} onSaved={setKundeLocal} />
              <label className="field field-full">
                <span>Persönlicher Mail-Text (optional)</span>
                <textarea
                  rows={4}
                  placeholder="Wenn leer, nehmen wir den Standard-Text mit Bitte um Briefing-Infos zum neuen Projekt."
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                />
              </label>
            </div>
          )}

          {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}
          {busy && (tab === 'url' || tab === 'file') && (
            <div className="extract-hint">
              {tab === 'url' ? 'Lade Seite und extrahiere Daten — kann 10-30 Sekunden dauern…' : 'Lese Datei und extrahiere Daten…'}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
