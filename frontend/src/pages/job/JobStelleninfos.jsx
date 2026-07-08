import { useEffect, useMemo, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import { fileToBase64 } from '../../lib/files.js';
import BrancheField from '../../components/BrancheField.jsx';
const MITARBEITER_OPTIONS = [
  { value: '', label: '— nicht angegeben —' },
  { value: '1-10', label: '1–10' },
  { value: '11-50', label: '11–50' },
  { value: '51-200', label: '51–200' },
  { value: '200+', label: '200+' },
];
const EINGABE_OPTIONS = [
  { value: '', label: '— nicht angegeben —' },
  { value: 'neu', label: 'Manuell' },
  { value: 'url', label: 'URL' },
  { value: 'pdf', label: 'PDF / DOCX' },
  { value: 'formular', label: 'Formular (Kunde)' },
];
const REISE_OPTIONS = [
  { value: 'keine', label: 'Keine' },
  { value: 'regional', label: 'Regional' },
  { value: 'bundesweit', label: 'Bundesweit' },
];
const ERFAHRUNG_OPTIONS = [
  { value: '', label: 'egal' },
  { value: '1-2', label: '1–2 Jahre' },
  { value: '3-5', label: '3–5 Jahre' },
  { value: '5+', label: '5+ Jahre' },
];
const SOFT_SKILL_OPTIONS = [
  'Teamfähigkeit', 'Zuverlässigkeit', 'Eigeninitiative',
  'Kommunikationsstärke', 'Belastbarkeit', 'Lernbereitschaft',
  'Organisationstalent', 'Kundenorientierung',
];

// Reisebereitschaft im Job ist boolean — wir mappen für die UI auf 3-Wege-Dropdown via formdata.
function reiseFromJob(job, fd) {
  if (fd?.reisebereitschaft && typeof fd.reisebereitschaft === 'string') return fd.reisebereitschaft;
  return job?.reisebereitschaft ? 'regional' : 'keine';
}

export default function JobStelleninfos() {
  const { job, kunde, reload } = useJob();
  // Weiche: bei Neukundengewinnung eigene Ansicht „Produkt & Zielgruppe".
  if (job?.projekttyp === 'neukundengewinnung') {
    return <NeukundenProduktTab job={job} kunde={kunde} reload={reload} />;
  }
  const fd = job.formdata_komplett || {};

  const [form, setForm] = useState(() => ({
    // Stelle
    stelle: job.stelle || '',
    region: job.region || '',
    gehalt: job.gehalt || '',
    eingabe_methode: job.eingabe_methode || '',
    url: job.url || '',
    besonderheiten: job.besonderheiten || '',
    reisebereitschaft: reiseFromJob(job, fd),
    quereinsteiger: !!job.quereinsteiger,
    // Branche (auf Kunde-Ebene)
    branche: kunde?.branche || '',
    // Benefits
    benefits: Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [],
    benefits_zusatz: fd.benefits_zusatz || '',
    // Über das Unternehmen (formdata)
    unterschied: fd.unterschied || '',
    mitarbeiter_gerne: fd.mitarbeiter_gerne || '',
    unternehmenskultur: fd.unternehmenskultur || '',
    mitarbeiter_anzahl: fd.mitarbeiter_anzahl || '',
    // Idealer Kandidat (formdata)
    ausbildung: fd.ausbildung || '',
    soft_skills: Array.isArray(fd.soft_skills) ? fd.soft_skills : [],
    soft_skills_zusatz: fd.soft_skills_zusatz || '',
    berufserfahrung: fd.berufserfahrung || '',
    kandidat_eigenschaften: fd.kandidat_eigenschaften || '',
  }));

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [showAnalyse, setShowAnalyse] = useState(false);
  const [newBenefit, setNewBenefit] = useState('');
  const [newSoftSkill, setNewSoftSkill] = useState('');
  const logoInputRef = useRef(null);

  // KI-Auto-Befüllung
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiFields, setAiFields] = useState(new Set()); // Keys mit "KI-Vorschlag"-Badge

  const SUGGESTIBLE_KEYS = ['unterschied', 'mitarbeiter_gerne', 'unternehmenskultur', 'ausbildung', 'kandidat_eigenschaften'];
  const emptySuggestible = SUGGESTIBLE_KEYS.filter(k => !(form[k] || '').trim());
  const allSuggestibleFull = emptySuggestible.length === 0;

  async function requestAiSuggestions() {
    if (allSuggestibleFull || aiBusy) return;
    setAiBusy(true);
    setAiError('');
    try {
      const res = await api(`/jobs/${job.id}/felder-vorschlaege`, {
        method: 'POST',
        body: { felder: emptySuggestible },
      });
      const vorschlaege = res.vorschlaege || {};
      setForm(prev => {
        const next = { ...prev };
        for (const k of emptySuggestible) {
          if (typeof vorschlaege[k] === 'string' && vorschlaege[k].trim()) {
            next[k] = vorschlaege[k];
          }
        }
        return next;
      });
      setAiFields(new Set(Object.keys(vorschlaege).filter(k => vorschlaege[k]?.trim())));
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiBusy(false);
    }
  }

  // Wenn der User ein AI-vorgeschlagenes Feld manuell ändert, Badge entfernen
  function setFWithAiClear(k, v) {
    setF(k, v);
    if (aiFields.has(k)) {
      setAiFields(prev => {
        const n = new Set(prev);
        n.delete(k);
        return n;
      });
    }
  }

  // Original-State für "dirty"-Vergleich + Reset bei externer Job/Kunde-Änderung
  useEffect(() => {
    setForm({
      stelle: job.stelle || '',
      region: job.region || '',
      gehalt: job.gehalt || '',
      eingabe_methode: job.eingabe_methode || '',
      url: job.url || '',
      besonderheiten: job.besonderheiten || '',
      reisebereitschaft: reiseFromJob(job, fd),
      quereinsteiger: !!job.quereinsteiger,
      branche: kunde?.branche || '',
      benefits: Array.isArray(job.benefits) ? job.benefits.filter(Boolean) : [],
      benefits_zusatz: fd.benefits_zusatz || '',
      unterschied: fd.unterschied || '',
      mitarbeiter_gerne: fd.mitarbeiter_gerne || '',
      unternehmenskultur: fd.unternehmenskultur || '',
      mitarbeiter_anzahl: fd.mitarbeiter_anzahl || '',
      ausbildung: fd.ausbildung || '',
      soft_skills: Array.isArray(fd.soft_skills) ? fd.soft_skills : [],
      soft_skills_zusatz: fd.soft_skills_zusatz || '',
      berufserfahrung: fd.berufserfahrung || '',
      kandidat_eigenschaften: fd.kandidat_eigenschaften || '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, kunde?.id, job.updated_at]);

  const setF = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  function addBenefit(value) {
    const v = (value || '').trim();
    if (!v) return;
    if (form.benefits.includes(v)) return;
    setF('benefits', [...form.benefits, v]);
    setNewBenefit('');
  }
  function removeBenefit(b) {
    setF('benefits', form.benefits.filter(x => x !== b));
  }
  function toggleSoftSkill(s) {
    setF('soft_skills', form.soft_skills.includes(s)
      ? form.soft_skills.filter(x => x !== s)
      : [...form.soft_skills, s]);
  }
  function addSoftSkill(value) {
    const v = (value || '').trim();
    if (!v) return;
    if (form.soft_skills.includes(v)) return;
    setF('soft_skills', [...form.soft_skills, v]);
    setNewSoftSkill('');
  }

  async function onLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoBusy(true);
    try {
      const fileData = await fileToBase64(file);
      await api(`/kunden/${kunde.id}/logo`, {
        method: 'POST',
        body: { fileData, fileName: file.name, contentType: file.type || 'image/png' },
      });
      await reload();
    } catch (err) {
      alert(`Logo-Upload fehlgeschlagen: ${err.message}`);
    } finally {
      setLogoBusy(false);
    }
  }

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      // formdata_komplett bauen — bestehende Werte erhalten + alle UI-Felder zurückschreiben
      const newFormdata = {
        ...fd,
        benefits: form.benefits,
        benefits_zusatz: form.benefits_zusatz,
        unterschied: form.unterschied,
        mitarbeiter_gerne: form.mitarbeiter_gerne,
        unternehmenskultur: form.unternehmenskultur,
        mitarbeiter_anzahl: form.mitarbeiter_anzahl,
        ausbildung: form.ausbildung,
        soft_skills: form.soft_skills,
        soft_skills_zusatz: form.soft_skills_zusatz,
        berufserfahrung: form.berufserfahrung,
        kandidat_eigenschaften: form.kandidat_eigenschaften,
        reisebereitschaft: form.reisebereitschaft, // String-Variante
      };

      const tasks = [
        api(`/jobs/${job.id}`, {
          method: 'PATCH',
          body: {
            stelle: form.stelle,
            region: form.region || null,
            gehalt: form.gehalt || null,
            eingabe_methode: form.eingabe_methode || null,
            url: form.url || null,
            besonderheiten: form.besonderheiten || null,
            reisebereitschaft: form.reisebereitschaft !== 'keine',
            quereinsteiger: form.quereinsteiger,
            benefits: form.benefits.length ? form.benefits : null,
            formdata_komplett: newFormdata,
          },
        }),
      ];
      if ((kunde?.branche || '') !== form.branche) {
        tasks.push(api(`/kunden/${kunde.id}`, {
          method: 'PATCH',
          body: { branche: form.branche || null },
        }));
      }
      await Promise.all(tasks);
      await reload();
      setAiFields(new Set()); // KI-Badges entfernen, Werte sind jetzt persistent
      setMsg('Gespeichert.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const analyse = job.analyse_ergebnis || null;
  const hasAnalyse = analyse && (typeof analyse === 'object') && Object.keys(analyse).length > 0;

  return (
    <form onSubmit={onSave} className="stelle-form">
      {/* ───────── Logo-Header ───────── */}
      <div className={`stelle-header ${kunde?.logo_url ? 'has-logo' : 'no-logo'}`}>
        <button
          type="button"
          className={`stelle-logo ${kunde?.logo_url ? 'has-image' : ''}`}
          onClick={() => !logoBusy && logoInputRef.current?.click()}
          title={kunde?.logo_url ? 'Logo ersetzen' : 'Logo hochladen'}
        >
          {kunde?.logo_url
            ? <img src={kunde.logo_url} alt="" />
            : <span>{(kunde?.firmenname || '?').slice(0, 1).toUpperCase()}</span>}
          <span className="stelle-logo-edit">{logoBusy ? '…' : 'Ändern'}</span>
        </button>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          style={{ display: 'none' }}
          onChange={onLogoChange}
        />
        <div className="stelle-header-text">
          <div className="stelle-header-firma">{kunde?.firmenname || '—'}</div>
          <div className="stelle-header-meta">
            {form.branche && <span className="branche-tag">{form.branche}</span>}
            {!kunde?.logo_url && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>
                {logoBusy ? 'Lade hoch…' : 'Logo hochladen'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ───────── Stellendetails ───────── */}
      <fieldset className="formular-section">
        <legend>Stellendetails</legend>
        <div className="form-grid">
          <label className="field field-full">
            <span>Stellenbezeichnung *</span>
            <input value={form.stelle} onChange={e => setF('stelle', e.target.value)} required />
          </label>
          <label className="field">
            <span>Region / Ort</span>
            <input value={form.region} onChange={e => setF('region', e.target.value)} />
          </label>
          <label className="field">
            <span>Branche</span>
            <BrancheField value={form.branche || ''} onChange={v => setF('branche', v)} />
          </label>
          <label className="field">
            <span>Gehalt / Spanne</span>
            <input value={form.gehalt} onChange={e => setF('gehalt', e.target.value)} placeholder="z.B. 3.000–4.000 €" />
          </label>
          <label className="field">
            <span>Eingabe-Methode</span>
            <select value={form.eingabe_methode} onChange={e => setF('eingabe_methode', e.target.value)}>
              {EINGABE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field field-full">
            <span>Stellenanzeigen-URL</span>
            <input type="url" placeholder="https://…" value={form.url} onChange={e => setF('url', e.target.value)} />
          </label>
          <label className="field">
            <span>Reisebereitschaft</span>
            <select value={form.reisebereitschaft} onChange={e => setF('reisebereitschaft', e.target.value)}>
              {REISE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field-checkbox" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={form.quereinsteiger} onChange={e => setF('quereinsteiger', e.target.checked)} />
            <span>Quereinsteiger willkommen</span>
          </label>
          <label className="field field-full">
            <span>Besonderheiten der Stelle</span>
            <textarea rows={3} value={form.besonderheiten} onChange={e => setF('besonderheiten', e.target.value)} />
          </label>
        </div>
      </fieldset>

      {/* ───────── Über das Unternehmen ───────── */}
      <fieldset className="formular-section">
        <legend>Über das Unternehmen</legend>
        <div className="ai-suggest-bar">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={requestAiSuggestions}
            disabled={allSuggestibleFull || aiBusy}
            title={allSuggestibleFull ? 'Alle Felder sind bereits ausgefüllt' : ''}
          >
            {aiBusy ? 'KI denkt nach…' : '✨ Felder per KI vorschlagen lassen'}
          </button>
          {!allSuggestibleFull && !aiBusy && (
            <span className="ai-suggest-hint">{emptySuggestible.length} leere{emptySuggestible.length === 1 ? 's' : ''} Feld{emptySuggestible.length === 1 ? '' : 'er'} • Vorschlag basiert auf Stelle, Branche, Benefits und Website</span>
          )}
          {aiError && <span className="form-msg" style={{ color: 'var(--danger)' }}>{aiError}</span>}
        </div>
        <div className="form-grid">
          <label className="field field-full">
            <span>
              Was unterscheidet euch von anderen Arbeitgebern?
              {aiFields.has('unterschied') && <span className="ai-badge">✨ KI-Vorschlag</span>}
            </span>
            <textarea rows={3} value={form.unterschied} onChange={e => setFWithAiClear('unterschied', e.target.value)} />
          </label>
          <label className="field field-full">
            <span>
              Warum arbeiten Mitarbeiter gerne hier?
              {aiFields.has('mitarbeiter_gerne') && <span className="ai-badge">✨ KI-Vorschlag</span>}
            </span>
            <textarea rows={3} value={form.mitarbeiter_gerne} onChange={e => setFWithAiClear('mitarbeiter_gerne', e.target.value)} />
          </label>
          <label className="field field-full">
            <span>
              Unternehmenskultur
              {aiFields.has('unternehmenskultur') && <span className="ai-badge">✨ KI-Vorschlag</span>}
            </span>
            <textarea rows={2} value={form.unternehmenskultur} onChange={e => setFWithAiClear('unternehmenskultur', e.target.value)} />
          </label>
          <label className="field">
            <span>Mitarbeiterzahl</span>
            <select value={form.mitarbeiter_anzahl} onChange={e => setF('mitarbeiter_anzahl', e.target.value)}>
              {MITARBEITER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      {/* ───────── Benefits ───────── */}
      <fieldset className="formular-section">
        <legend>Benefits</legend>
        <div className="chips">
          {form.benefits.length === 0 && <span className="chips-empty">Noch keine Benefits hinzugefügt.</span>}
          {form.benefits.map(b => (
            <span key={b} className="chip">
              {b}
              <button type="button" className="chip-x" onClick={() => removeBenefit(b)} aria-label="Entfernen">×</button>
            </span>
          ))}
        </div>
        <div className="chip-add">
          <input
            type="text"
            placeholder="Benefit hinzufügen (z.B. Firmenwagen)"
            value={newBenefit}
            onChange={e => setNewBenefit(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBenefit(newBenefit); } }}
          />
          <button type="button" className="btn-ghost btn-sm" onClick={() => addBenefit(newBenefit)}>Hinzufügen</button>
        </div>
        <label className="field field-full" style={{ marginTop: 14 }}>
          <span>Weitere Benefits (Freitext)</span>
          <textarea rows={2} value={form.benefits_zusatz} onChange={e => setF('benefits_zusatz', e.target.value)} />
        </label>
      </fieldset>

      {/* ───────── Idealer Kandidat ───────── */}
      <fieldset className="formular-section">
        <legend>Idealer Kandidat</legend>
        <div className="form-grid">
          <label className="field field-full">
            <span>
              Ausbildung / Qualifikation
              {aiFields.has('ausbildung') && <span className="ai-badge">✨ KI-Vorschlag</span>}
            </span>
            <input value={form.ausbildung} onChange={e => setFWithAiClear('ausbildung', e.target.value)} />
          </label>
          <label className="field">
            <span>Berufserfahrung</span>
            <select value={form.berufserfahrung} onChange={e => setF('berufserfahrung', e.target.value)}>
              {ERFAHRUNG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className="field field-full">
            <span className="field-label">Soft Skills</span>
            <div className="chips" style={{ marginTop: 6 }}>
              {form.soft_skills.length === 0 && <span className="chips-empty">Keine Soft Skills ausgewählt.</span>}
              {form.soft_skills.map(s => (
                <span key={s} className="chip">
                  {s}
                  <button type="button" className="chip-x" onClick={() => toggleSoftSkill(s)} aria-label="Entfernen">×</button>
                </span>
              ))}
            </div>
            <div className="check-grid" style={{ marginTop: 10 }}>
              {SOFT_SKILL_OPTIONS.filter(s => !form.soft_skills.includes(s)).map(s => (
                <button key={s} type="button" className="check-suggest" onClick={() => toggleSoftSkill(s)}>
                  + {s}
                </button>
              ))}
            </div>
            <div className="chip-add" style={{ marginTop: 10 }}>
              <input
                type="text"
                placeholder="Eigenen Soft Skill hinzufügen"
                value={newSoftSkill}
                onChange={e => setNewSoftSkill(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSoftSkill(newSoftSkill); } }}
              />
              <button type="button" className="btn-ghost btn-sm" onClick={() => addSoftSkill(newSoftSkill)}>Hinzufügen</button>
            </div>
          </div>
          <label className="field field-full">
            <span>
              Welche Eigenschaften soll der ideale Kandidat mitbringen?
              {aiFields.has('kandidat_eigenschaften') && <span className="ai-badge">✨ KI-Vorschlag</span>}
            </span>
            <textarea rows={2} value={form.kandidat_eigenschaften} onChange={e => setFWithAiClear('kandidat_eigenschaften', e.target.value)} />
          </label>
        </div>
      </fieldset>

      {/* ───────── KI-Analyse (read-only, einklappbar) ───────── */}
      {hasAnalyse && (
        <fieldset className="formular-section analyse-section">
          <legend>
            <button type="button" className="legend-toggle" onClick={() => setShowAnalyse(s => !s)}>
              KI-Analyse <span className="legend-chev">{showAnalyse ? '▾' : '▸'}</span>
            </button>
          </legend>
          {showAnalyse && <AnalyseView analyse={analyse} />}
        </fieldset>
      )}

      <div className="form-actions stelle-actions">
        {msg && <span className="form-msg">{msg}</span>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Speichere…' : 'Änderungen speichern'}
        </button>
      </div>
    </form>
  );
}

function AnalyseView({ analyse }) {
  const score = typeof analyse.score === 'number' ? analyse.score
              : typeof analyse.gesamtpotenzial === 'number' ? analyse.gesamtpotenzial
              : null;
  const empfehlungen =
    Array.isArray(analyse.empfehlungen) ? analyse.empfehlungen
    : Array.isArray(analyse.recommendations) ? analyse.recommendations
    : null;

  return (
    <div className="analyse-body">
      {score !== null && (
        <div className="analyse-score">
          <div className="analyse-score-num">{score}<span>/100</span></div>
          <div className="analyse-score-label">Gesamtpotenzial</div>
        </div>
      )}
      {empfehlungen && empfehlungen.length > 0 && (
        <div className="analyse-empfehlungen">
          <div className="analyse-empfehlungen-title">Empfehlungen</div>
          <ul>
            {empfehlungen.map((e, i) => (
              <li key={i}>{typeof e === 'string' ? e : (e.text || e.titel || JSON.stringify(e))}</li>
            ))}
          </ul>
        </div>
      )}
      {/* Fallback: alles weitere als formatierter JSON-Block */}
      {!score && !empfehlungen && (
        <pre className="analyse-raw">{JSON.stringify(analyse, null, 2)}</pre>
      )}
    </div>
  );
}

/* ═════════════════════ Neukunden-Produkt-Tab ═════════════════════
   Ersetzt Stelleninfos bei projekttyp='neukundengewinnung'. Speichert alle
   Text-Felder in job.neukunden_daten (jsonb), damit das Schema kompakt bleibt.
   „stelle" wird auf `produkt` gespiegelt, damit bestehende Auswertungen
   (Projekte-Liste, Kanban-Karten) mit einer sinnvollen Bezeichnung arbeiten. */

function NeukundenProduktTab({ job, kunde, reload }) {
  const nk = job.neukunden_daten || {};
  const [form, setForm] = useState({
    produkt:       nk.produkt || job.stelle || '',
    kundenprofil:  nk.kundenprofil || '',
    zielgruppe:    nk.zielgruppe || '',
    vorteile:      Array.isArray(nk.vorteile) ? nk.vorteile.filter(Boolean) : [],
    unterschied:   nk.unterschied || '',
    preisrahmen:   nk.preisrahmen || '',
    einzugsgebiet: nk.einzugsgebiet || job.region || '',
    funnel_url:    nk.funnel_url || '',
  });
  const [newVorteil, setNewVorteil] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }
  function addVorteil() {
    const v = newVorteil.trim();
    if (!v) return;
    set('vorteile', [...form.vorteile, v]);
    setNewVorteil('');
  }
  function removeVorteil(i) {
    set('vorteile', form.vorteile.filter((_, idx) => idx !== i));
  }

  async function onSave(e) {
    e?.preventDefault();
    setBusy(true); setMsg('');
    try {
      const neukunden_daten = {
        produkt: form.produkt.trim(),
        kundenprofil: form.kundenprofil.trim(),
        zielgruppe: form.zielgruppe.trim(),
        vorteile: form.vorteile.filter(Boolean),
        unterschied: form.unterschied.trim(),
        preisrahmen: form.preisrahmen.trim(),
        einzugsgebiet: form.einzugsgebiet.trim(),
        funnel_url: form.funnel_url.trim(),
      };
      await api(`/jobs/${job.id}`, {
        method: 'PATCH',
        body: {
          neukunden_daten,
          // Sammelfelder für Kompatibilität mit Recruiting-Flows:
          stelle: neukunden_daten.produkt || 'Neukunden-Kampagne',
          region: neukunden_daten.einzugsgebiet || null,
          benefits: neukunden_daten.vorteile.length ? neukunden_daten.vorteile : null,
        },
      });
      setMsg('Gespeichert.');
      reload?.();
    } catch (err) { setMsg('Fehler: ' + err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={onSave} className="job-stelle-form">
      <div className="section-head">
        <div>
          <h2 className="section-title">Produkt &amp; Zielgruppe</h2>
          <p className="section-sub">Angebot, Zielgruppe und USP der Neukundenkampagne — Grundlage für Creatives und Ad-Copies.</p>
        </div>
        <button type="submit" className="btn-primary" disabled={busy || !form.produkt.trim()}>
          {busy ? 'Speichere…' : 'Speichern'}
        </button>
      </div>

      {msg && <div className="motiv-sub" style={{ marginBottom: 10 }}>{msg}</div>}

      <fieldset className="formular-section">
        <legend>Angebot</legend>
        <div className="stelle-grid">
          <label className="field field-full">
            <span>Produkt / Dienstleistung *</span>
            <input type="text" value={form.produkt} onChange={e => set('produkt', e.target.value)}
              placeholder="z. B. Photovoltaik-Komplettlösung" required />
          </label>
          <label className="field field-full">
            <span>Wofür Kunden gesucht werden</span>
            <textarea rows={2} value={form.kundenprofil} onChange={e => set('kundenprofil', e.target.value)}
              placeholder="z. B. Photovoltaik-Anlagen für Eigenheimbesitzer" />
          </label>
          <label className="field field-full">
            <span>Zielgruppe</span>
            <textarea rows={2} value={form.zielgruppe} onChange={e => set('zielgruppe', e.target.value)}
              placeholder="z. B. Hausbesitzer 35-65, ländlich, mit eigenem Dach" />
          </label>
          <label className="field">
            <span>Region / Einzugsgebiet</span>
            <input type="text" value={form.einzugsgebiet} onChange={e => set('einzugsgebiet', e.target.value)}
              placeholder="z. B. Bayern, Oberpfalz" />
          </label>
          <label className="field">
            <span>Preisrahmen / Angebot (optional)</span>
            <input type="text" value={form.preisrahmen} onChange={e => set('preisrahmen', e.target.value)}
              placeholder="z. B. ab 15.000 €" />
          </label>
        </div>
      </fieldset>

      <fieldset className="formular-section">
        <legend>Vorteile des Produkts</legend>
        <div className="benefits-list">
          {form.vorteile.map((v, i) => (
            <span key={i} className="benefit-chip">
              {v}
              <button type="button" className="benefit-chip-x" onClick={() => removeVorteil(i)} aria-label="Entfernen">×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input type="text" value={newVorteil} onChange={e => setNewVorteil(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addVorteil(); } }}
            placeholder='Neuer Vorteil, z. B. "Amortisation in 8 Jahren"' style={{ flex: 1 }} />
          <button type="button" className="btn-ghost btn-sm" onClick={addVorteil} disabled={!newVorteil.trim()}>
            + Hinzufügen
          </button>
        </div>
      </fieldset>

      <fieldset className="formular-section">
        <legend>USP / Unterschied zum Wettbewerb</legend>
        <label className="field field-full">
          <span>Was unterscheidet euch von der Konkurrenz?</span>
          <textarea rows={3} value={form.unterschied} onChange={e => set('unterschied', e.target.value)}
            placeholder="z. B. Regionaler Anbieter, keine Subunternehmen, 25 Jahre Erfahrung, eigenes Montageteam" />
        </label>
      </fieldset>

      <div style={{ marginTop: 14 }}>
        <button type="submit" className="btn-primary" disabled={busy || !form.produkt.trim()}>
          {busy ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
