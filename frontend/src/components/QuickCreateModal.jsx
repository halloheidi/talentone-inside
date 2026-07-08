import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

// Debounced Dubletten-Check während des Tippens — sucht in Kunden + Projekten
function useDubletten(firmenname) {
  const [hits, setHits] = useState({ kunden: [], projekte: [] });
  useEffect(() => {
    const q = (firmenname || '').trim();
    if (q.length < 3) { setHits({ kunden: [], projekte: [] }); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await api(`/kunden/dubletten-check?q=${encodeURIComponent(q)}`);
        setHits({ kunden: res.kunden || [], projekte: res.projekte || [] });
      } catch (e) { /* still */ }
    }, 350);
    return () => clearTimeout(timer);
  }, [firmenname]);
  return hits;
}

const PROJEKT_STATUS_OPTIONS = [
  { value: 'kickoff_vereinbart', label: 'Kick-Off vereinbart' },
  { value: 'vorbereitung',       label: 'Kunde ohne Kick-Off' },
  { value: 'onboarding',         label: 'Onboarding' },
  { value: 'golive_vereinbart',  label: 'Go-Live vereinbart' },
  { value: 'warte_auf_go',       label: 'Warte auf Go!' },
  { value: 'live',               label: 'Live' },
  { value: 'pausiert',           label: 'Pausiert' },
  { value: 'hold',               label: 'Hold' },
];
const PROJEKTART_OPTIONEN = [
  'Mitarbeitergewinnung', 'TalentOne - Mitarbeitergewinnung', 'Abo',
  'Neukundengewinnung', 'Social Media Betreuung', 'Employer Branding',
  'Mitarbeiterbefragung', 'Homepage', 'Karriereseite',
];

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
  const [projektStatus, setProjektStatus] = useState('kickoff_vereinbart');
  const [projektart, setProjektart] = useState('');
  const [verantwortlich, setVerantwortlich] = useState('');
  const [team, setTeam] = useState([]);

  useEffect(() => {
    api('/projekte/team').then(r => setTeam(r.team || [])).catch(() => setTeam([]));
  }, []);

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
  const [inviteProjekttyp, setInviteProjekttyp] = useState('mitarbeitergewinnung');
  const [inviteSuccess, setInviteSuccess] = useState(null); // { firmenname, formularUrl } | null

  // Dubletten-Check: nutzt das aktive Firmenname-Feld je nach Tab (manual / invite)
  const watchedFirma = tab === 'invite' ? invite.firmenname : (tab === 'manual' ? manual.firmenname : '');
  const dubletten = useDubletten(watchedFirma);
  const hasDubletten = (dubletten.kunden.length + dubletten.projekte.length) > 0;

  function reset() {
    setTab('url');
    setError('');
    setBusy(false);
    setAgentur('talentone');
    setProjektStatus('kickoff_vereinbart');
    setProjektart('');
    setVerantwortlich('');
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
            projekttyp: agentur === 'nowagwirth' ? inviteProjekttyp : 'mitarbeitergewinnung',
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
      body.projekt_status = projektStatus;
      body.projektart = projektart || null;
      body.verantwortlich = verantwortlich || null;
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

      {/* Projekt-Eckdaten — landen direkt im Kanban */}
      {tab !== 'invite' && (
        <div className="projekt-picker">
          <label className="projekt-picker-label">Projekt-Eckdaten (für Kanban-Übersicht)</label>
          <div className="projekt-picker-grid">
            <label>
              <span>Status</span>
              <select value={projektStatus} onChange={e => setProjektStatus(e.target.value)} disabled={busy}>
                {PROJEKT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label>
              <span>Projektart</span>
              <select value={projektart} onChange={e => setProjektart(e.target.value)} disabled={busy}>
                <option value="">— Auto (passend zur Agentur) —</option>
                {PROJEKTART_OPTIONEN.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label>
              <span>Verantwortlich</span>
              <select value={verantwortlich} onChange={e => setVerantwortlich(e.target.value)} disabled={busy}>
                <option value="">—</option>
                {team.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}

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
                {tab === 'invite' && hasDubletten && (
                  <div className="field-full">
                    <DublettenHinweis
                      hits={dubletten}
                      onPickKunde={(k) => {
                        reset(); onClose();
                        nav(`/kunden/${k.id}`);
                      }}
                    />
                  </div>
                )}
                <label className="field">
                  <span>Ansprechpartner (optional)</span>
                  <input value={invite.ansprechpartner} onChange={e => setInvite({ ...invite, ansprechpartner: e.target.value })} />
                </label>
                {agentur === 'nowagwirth' && (
                  <div className="field field-full">
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5a5955', letterSpacing: 0.05, textTransform: 'uppercase', marginBottom: 6 }}>Projekttyp</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => setInviteProjekttyp('mitarbeitergewinnung')}
                        className={`pub-filter ${inviteProjekttyp === 'mitarbeitergewinnung' ? 'is-active' : ''}`}>
                        👥 Mitarbeitergewinnung
                      </button>
                      <button type="button" onClick={() => setInviteProjekttyp('neukundengewinnung')}
                        className={`pub-filter ${inviteProjekttyp === 'neukundengewinnung' ? 'is-active' : ''}`}>
                        🎯 Neukundengewinnung
                      </button>
                    </div>
                  </div>
                )}
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
              {tab === 'manual' && hasDubletten && (
                <div className="field-full">
                  <DublettenHinweis
                    hits={dubletten}
                    onPickKunde={(k) => {
                      reset(); onClose();
                      nav(`/kunden/${k.id}`);
                    }}
                  />
                </div>
              )}
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

function DublettenHinweis({ hits, onPickKunde }) {
  const all = [
    ...hits.kunden.map(k => ({ type: 'kunde', id: k.id, name: k.firmenname, sub: k.email || k.agentur, raw: k })),
    ...hits.projekte.map(p => ({ type: 'projekt', id: p.id, name: p.projekt || p.kunde, sub: p.kunde + (p.status ? ` · ${p.status}` : ''), raw: p })),
  ].slice(0, 6);

  return (
    <div style={{
      marginTop: 10, padding: '12px 14px',
      background: '#fffbeb', border: '1.5px solid #f59e0b', borderRadius: 10,
      fontSize: 13, color: 'var(--ink-1, #0a0a0a)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        ⚠️ Ähnliche{all.length > 1 ? ' Einträge' : 'r Eintrag'} gefunden — derselbe Kunde?
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {all.map(item => (
          <div key={item.type + item.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', background: '#fff', border: '1px solid var(--line, #e2e0dc)',
            borderRadius: 6, fontSize: 12.5,
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.05, textTransform: 'uppercase',
              padding: '2px 6px',
              background: item.type === 'kunde' ? 'rgba(20,170,80,0.12)' : 'rgba(100,100,100,0.12)',
              color: item.type === 'kunde' ? '#15803d' : 'var(--ink-2, #5a5955)',
              borderRadius: 100, flexShrink: 0,
            }}>{item.type === 'kunde' ? 'Kunde' : 'Projekt'}</span>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{item.name}</div>
              {item.sub && <div style={{ fontSize: 11, color: 'var(--ink-3, #999790)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{item.sub}</div>}
            </div>
            {item.type === 'kunde' && (
              <button
                type="button"
                onClick={() => onPickKunde(item.raw)}
                style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 10px',
                  background: 'var(--ink-1, #0a0a0a)', color: '#fff', border: 'none',
                  borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >Öffnen + Projekt anlegen →</button>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3, #5a5955)' }}>
        Wenn es derselbe Kunde ist: oben „Öffnen" — dann legst du das neue Projekt direkt dort an. Sonst einfach ignorieren und unten weiter anlegen.
      </div>
    </div>
  );
}
