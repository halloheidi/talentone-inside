import { useEffect, useMemo, useRef, useState } from 'react';
import { useJob } from '../JobView.jsx';
import { api } from '../../lib/api.js';
import { fileToBase64 } from '../../lib/files.js';

const BRANCHE_OPTIONS = [
  { value: '', label: '— bitte wählen —' },
  { value: 'handwerk', label: 'Handwerk & Bau' },
  { value: 'pflege', label: 'Pflege & Soziales' },
  { value: 'einzelhandel', label: 'Einzelhandel' },
  { value: 'gastro', label: 'Gastronomie & Hotel' },
  { value: 'buero', label: 'Büro & Verwaltung' },
  { value: 'logistik', label: 'Logistik & Transport' },
];
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
            <select value={form.branche} onChange={e => setF('branche', e.target.value)}>
              {BRANCHE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
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
        <div className="form-grid">
          <label className="field field-full">
            <span>Was unterscheidet euch von anderen Arbeitgebern?</span>
            <textarea rows={3} value={form.unterschied} onChange={e => setF('unterschied', e.target.value)} />
          </label>
          <label className="field field-full">
            <span>Warum arbeiten Mitarbeiter gerne hier?</span>
            <textarea rows={3} value={form.mitarbeiter_gerne} onChange={e => setF('mitarbeiter_gerne', e.target.value)} />
          </label>
          <label className="field field-full">
            <span>Unternehmenskultur</span>
            <textarea rows={2} value={form.unternehmenskultur} onChange={e => setF('unternehmenskultur', e.target.value)} />
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
            <span>Ausbildung / Qualifikation</span>
            <input value={form.ausbildung} onChange={e => setF('ausbildung', e.target.value)} />
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
            <span>Welche Eigenschaften soll der ideale Kandidat mitbringen?</span>
            <textarea rows={2} value={form.kandidat_eigenschaften} onChange={e => setF('kandidat_eigenschaften', e.target.value)} />
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
