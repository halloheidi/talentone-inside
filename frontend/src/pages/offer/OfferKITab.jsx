import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

function euroStr(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '';
}
function parseEuro(str) {
  if (str === '' || str == null) return null;
  if (typeof str === 'number') return Math.round(str * 100) / 100;
  const cleaned = String(str).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Entwurf-Positionen → editierbare Zeilen mit stabilem key.
function toEditLines(positionen) {
  return (positionen || []).map((p, i) => ({
    key: `pos-${i}-${Math.random().toString(36).slice(2, 7)}`,
    titel: p.titel || '',
    beschreibung: p.beschreibung || '',
    menge: Number(p.menge) || 1,
    einheit: p.einheit || 'Stk.',
    einzelpreis_netto: p.einzelpreis_netto == null ? null : Number(p.einzelpreis_netto),
    kategorie: p.kategorie === 'monthly' ? 'monthly' : 'setup',
  }));
}

/**
 * "Individuell mit KI" — vollständige Fläche: Kontext → Generierung → Editor →
 * Speichern. Nutzt dieselben Backend-Endpunkte wie der Baukasten (POST /offers,
 * create-easybill), ergänzt um die /offers/ki/*-Routen. Rein additiv.
 */
export default function OfferKITab({ brand, customer, alsoInTool }) {
  const navigate = useNavigate();
  const kundeId = customer?.tool_kunde_id || null;

  // Kontext
  const [kontext, setKontext] = useState(null);
  const [blockAn, setBlockAn] = useState({ kundenakte: true, stellen: true, altprojekte: true, vertrag: true, stimmen: true, bilder: true });
  const [closeLeadId, setCloseLeadId] = useState(null);
  const [closeEintraege, setCloseEintraege] = useState([]); // { id, type, date, title, excerpt, _an }
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeGeladen, setCloseGeladen] = useState(false);
  const [leadQuery, setLeadQuery] = useState('');
  const [leadTreffer, setLeadTreffer] = useState([]);
  const [freitext, setFreitext] = useState('');
  const [bausteine, setBausteine] = useState([]);
  const [bausteinAn, setBausteinAn] = useState(new Set());

  // Generierung / Entwurf
  const [generating, setGenerating] = useState(false);
  const [versionen, setVersionen] = useState([]); // [{ entwurf, label }]
  const [versionIdx, setVersionIdx] = useState(-1);
  const [refining, setRefining] = useState(false);
  const [anweisung, setAnweisung] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Editor-Felder
  const [einleitung, setEinleitung] = useState('');
  const [leistung, setLeistung] = useState('');
  const [zahlung, setZahlung] = useState('');
  const [gueltigBis, setGueltigBis] = useState('');
  const [offenePunkte, setOffenePunkte] = useState([]);
  const [positionen, setPositionen] = useState([]);
  const [vertragsmodell, setVertragsmodell] = useState('');
  const [laufzeitWert, setLaufzeitWert] = useState('');
  const [laufzeitEinheit, setLaufzeitEinheit] = useState('monate');
  const [garantieArt, setGarantieArt] = useState('keine'); // keine | hire | applications
  const [garantieFrist, setGarantieFrist] = useState(30);
  const [garantieZiel, setGarantieZiel] = useState(1);
  const [garantiePosition, setGarantiePosition] = useState('');

  const hatEntwurf = versionIdx >= 0;

  // Kontext + Bausteine laden
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const pRes = await api(`/offer-catalog/products?brand=${brand}`);
        if (!cancel) setBausteine(pRes.products || []);
      } catch (e) { if (!cancel) setError(e.message); }
    })();
    if (kundeId) {
      (async () => {
        try {
          const res = await api(`/offers/ki/kunde-kontext?kunde_id=${encodeURIComponent(kundeId)}`);
          if (cancel) return;
          setKontext(res);
          setCloseLeadId(res.close_lead_id || null);
        } catch (e) { if (!cancel) setError(e.message); }
      })();
    }
    return () => { cancel = true; };
  }, [brand, kundeId]);

  async function closeLaden(leadId = null) {
    setCloseBusy(true); setError('');
    try {
      const q = leadId ? `lead_id=${encodeURIComponent(leadId)}` : `kunde_id=${encodeURIComponent(kundeId)}`;
      const res = await api(`/offers/ki/close-kontext?${q}`);
      setCloseLeadId(res.lead_id || leadId || closeLeadId);
      setCloseEintraege((res.eintraege || []).map(e => ({ ...e, _an: true })));
      setCloseGeladen(true);
    } catch (e) { setError(e.message); }
    finally { setCloseBusy(false); }
  }

  async function leadSuchen() {
    if (!leadQuery.trim()) return;
    try {
      const res = await api(`/offers/ki/lead-suche?q=${encodeURIComponent(leadQuery.trim())}`);
      setLeadTreffer(res.leads || []);
    } catch (e) { setError(e.message); }
  }

  // Entwurf in die Editor-Felder spiegeln.
  function entwurfUebernehmen(entwurf) {
    setEinleitung(entwurf.einleitung || '');
    setLeistung(entwurf.leistungsbeschreibung || '');
    setZahlung(entwurf.zahlungsbedingungen || '');
    setGueltigBis(entwurf.gueltig_bis || '');
    setOffenePunkte(Array.isArray(entwurf.offene_punkte) ? entwurf.offene_punkte : []);
    setPositionen(toEditLines(entwurf.positionen));
    const v = entwurf.vertrag || {};
    setVertragsmodell(v.vertragsmodell || '');
    setLaufzeitWert(v.laufzeit_wert != null ? String(v.laufzeit_wert) : '');
    setLaufzeitEinheit(v.laufzeit_einheit || 'monate');
    setGarantieArt(v.garantie_art === 'hire' ? 'hire' : v.garantie_art === 'applications' ? 'applications' : 'keine');
    setGarantieZiel(v.garantie_ziel != null ? Number(v.garantie_ziel) : 1);
    setGarantiePosition(v.garantie_position || '');
  }

  function pushVersion(entwurf, label) {
    setVersionen(prev => {
      const next = [...prev.slice(0, versionIdx + 1), { entwurf, label }];
      setVersionIdx(next.length - 1);
      return next;
    });
    entwurfUebernehmen(entwurf);
  }

  function versionWechseln(idx) {
    const v = versionen[idx];
    if (!v) return;
    setVersionIdx(idx);
    entwurfUebernehmen(v.entwurf);
  }

  // Den (gefilterten) Kontext für die Generierung zusammenstellen.
  function kontextFuerKI() {
    if (!kontext) return {};
    const k = {};
    if (blockAn.kundenakte) k.kunde = kontext.kunde;
    else k.kunde = { anrede_form: kontext.kunde?.anrede_form, firmenname: kontext.kunde?.firmenname };
    if (blockAn.stellen) k.stellen = kontext.stellen || [];
    if (blockAn.altprojekte) k.altprojekte = kontext.altprojekte || [];
    if (blockAn.vertrag) k.vertrag = kontext.vertrag || null;
    if (blockAn.stimmen) k.mitarbeiterstimmen_anzahl = kontext.mitarbeiterstimmen_anzahl || 0;
    if (blockAn.bilder) k.referenzbilder_anzahl = kontext.referenzbilder_anzahl || 0;
    return k;
  }

  async function generieren() {
    setGenerating(true); setError('');
    try {
      const gewaehlteBausteine = bausteine.filter(b => bausteinAn.has(b.id))
        .map(b => ({ title: b.title, unit_price: b.unit_price, category: b.category, description: b.description }));
      const body = {
        brand,
        kontext: kontextFuerKI(),
        close_eintraege: closeEintraege.filter(e => e._an).map(e => ({ id: e.id, type: e.type, date: e.date, title: e.title, excerpt: e.excerpt })),
        freitext,
        bausteine: gewaehlteBausteine,
      };
      const res = await api('/offers/ki/generate', { method: 'POST', body });
      pushVersion(res.entwurf, `Erstentwurf · ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) { setError(e.message); }
    finally { setGenerating(false); }
  }

  async function nachschaerfen() {
    if (!anweisung.trim()) return;
    setRefining(true); setError('');
    try {
      const body = { brand, kontext: kontextFuerKI(), entwurf: aktuellerEntwurf(), anweisung };
      const res = await api('/offers/ki/refine', { method: 'POST', body });
      pushVersion(res.entwurf, `Nachgeschärft: „${anweisung.slice(0, 40)}${anweisung.length > 40 ? '…' : ''}"`);
      setAnweisung('');
    } catch (e) { setError(e.message); }
    finally { setRefining(false); }
  }

  // Den aktuellen (ggf. im Editor veränderten) Stand als Entwurf-Objekt.
  function aktuellerEntwurf() {
    return {
      einleitung, leistungsbeschreibung: leistung, zahlungsbedingungen: zahlung,
      gueltig_bis: gueltigBis || null, offene_punkte: offenePunkte,
      positionen: positionen.map(p => ({
        titel: p.titel, beschreibung: p.beschreibung, menge: p.menge, einheit: p.einheit,
        einzelpreis_netto: p.einzelpreis_netto, kategorie: p.kategorie,
      })),
      vertrag: {
        vertragsmodell: vertragsmodell || null,
        laufzeit_wert: laufzeitWert ? Number(laufzeitWert) : null,
        laufzeit_einheit: laufzeitEinheit || null,
        garantie_art: garantieArt === 'keine' ? null : garantieArt,
        garantie_ziel: garantieArt === 'applications' ? Number(garantieZiel) : null,
        garantie_position: garantiePosition || null,
      },
    };
  }

  const summe = useMemo(() => {
    let setup = 0, monthly = 0;
    for (const p of positionen) {
      const preis = Number(p.einzelpreis_netto) || 0;
      const zeile = preis * (Number(p.menge) || 1);
      if (p.kategorie === 'monthly') monthly += zeile; else setup += zeile;
    }
    return { setup, monthly };
  }, [positionen]);

  function setPos(key, patch) {
    setPositionen(prev => prev.map(p => (p.key === key ? { ...p, ...patch } : p)));
  }
  function posEntfernen(key) {
    setPositionen(prev => prev.filter(p => p.key !== key));
  }
  function posHinzufuegen() {
    setPositionen(prev => [...prev, {
      key: `pos-neu-${Date.now()}`, titel: '', beschreibung: '', menge: 1, einheit: 'Stk.', einzelpreis_netto: 0, kategorie: 'setup',
    }]);
  }

  const preisLuecke = positionen.some(p => p.einzelpreis_netto == null || !Number.isFinite(Number(p.einzelpreis_netto)));

  function guaranteeFelder() {
    const type = garantieArt === 'keine' ? 'none' : garantieArt;
    return {
      guarantee_type: type,
      guarantee_period_days: type === 'none' ? 0 : (Number(garantieFrist) || 30),
      guarantee_applications_count: type === 'applications' ? (Number(garantieZiel) || 1) : null,
      guarantee_note: garantiePosition || '',
    };
  }

  function buildPayload() {
    return {
      brand,
      erstellt_via: 'ki',
      easybill_customer_id: String(customer.easybill_id),
      customer_snapshot: {
        company_name: customer.company_name, first_name: customer.first_name,
        last_name: customer.last_name, email: customer.email,
        street: customer.street, zip_code: customer.zip_code, city: customer.city,
        country: customer.country, number: customer.number, phone_1: customer.phone_1,
      },
      customer_id: customer.tool_kunde_id || null,
      also_in_tool: alsoInTool && !customer.tool_kunde_id,
      close_lead_id: closeLeadId || null,
      positionen_snapshot: positionen.map(p => ({
        product_id: null, custom: true,
        category: p.kategorie === 'monthly' ? 'monthly' : 'setup',
        title: p.titel, description: p.beschreibung,
        unit_price: Number(p.einzelpreis_netto) || 0,
        quantity: Math.max(1, Math.floor(Number(p.menge) || 1)),
      })),
      // KI-spezifische Felder
      einleitung, leistungsbeschreibung: leistung,
      zahlungsbedingungen: zahlung || null,
      gueltig_bis: gueltigBis || null,
      offene_punkte: offenePunkte,
      vertragsmodell: vertragsmodell || null,
      laufzeit_wert: laufzeitWert ? Number(laufzeitWert) : null,
      laufzeit_einheit: laufzeitEinheit || null,
      ...guaranteeFelder(),
      ki_kontext: {
        freitext,
        kundenakte: kontext || null,
        close_eintraege: closeEintraege.filter(e => e._an).map(e => e.id),
        bausteine: bausteine.filter(b => bausteinAn.has(b.id)).map(b => ({ id: b.id, title: b.title })),
      },
      ki_versionen: versionen.map(v => v.entwurf),
    };
  }

  function validierung() {
    if (!positionen.length) return 'Mindestens eine Position ist erforderlich.';
    if (positionen.some(p => !p.titel.trim())) return 'Jede Position braucht eine Bezeichnung.';
    if (preisLuecke) return 'Bitte alle Preise ausfüllen — es sind noch offene Punkte vorhanden.';
    return null;
  }

  async function speichern(mitEasybill) {
    const v = validierung();
    if (v) { setError(v); return; }
    setSaving(true); setError('');
    let draftId = null;
    try {
      const draftRes = await api('/offers', { method: 'POST', body: buildPayload() });
      draftId = draftRes.offer.id;
      if (draftRes.kunde_warnung) window.alert(`⚠️ ${draftRes.kunde_warnung}\n\nDas Angebot wurde gespeichert.`);
      if (!mitEasybill) { navigate(`/angebote?draft=${draftId}`); return; }
      let easyRes;
      try {
        easyRes = await api(`/offers/${draftId}/create-easybill`, { method: 'POST' });
      } catch (err) {
        if (err.status === 409 && err.body?.warning === 'guarantee_bewerbungen') {
          const ok = window.confirm(`⚠️ ${err.body.message}\n\nGefunden:\n„${err.body.sample || ''}"\n\nTrotzdem erzeugen?`);
          if (!ok) throw new Error('Erzeugung abgebrochen — bitte Garantie-Text korrigieren.');
          easyRes = await api(`/offers/${draftId}/create-easybill`, { method: 'POST', body: { confirm_guarantee_warning: true } });
        } else { throw err; }
      }
      navigate(`/angebote?created=${easyRes.offer.id}`);
    } catch (err) {
      setError(draftId
        ? `easybill-Erzeugung fehlgeschlagen: ${err.message} — Der Entwurf wurde gespeichert und ist in der Angebotsliste.`
        : err.message);
    } finally { setSaving(false); }
  }

  const checkbox = (label, val, on) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={val} onChange={e => on(e.target.checked)} />{label}
    </label>
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {error && <div className="alert alert-error">{error}</div>}

      {/* ── Kontext-Panel ── */}
      <section>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Kontext fürs Angebot</h3>
        {!kundeId && (
          <div className="alert" style={{ background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', fontSize: 13 }}>
            Kein interner Kunde verknüpft — Kundenakte und Close-Kontext stehen nicht automatisch zur Verfügung. Du kannst trotzdem über den Freitext generieren.
          </div>
        )}
        {kontext && (
          <div className="card" style={{ padding: 14, display: 'grid', gap: 8, background: 'var(--gray-50)' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{kontext.kunde?.firmenname}{kontext.kunde?.branche ? ` · ${kontext.kunde.branche}` : ''}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
              {checkbox('Kundenakte (Firma, Ansprechpartner)', blockAn.kundenakte, v => setBlockAn(s => ({ ...s, kundenakte: v })))}
              {checkbox(`Stellen (${kontext.stellen?.length || 0})`, blockAn.stellen, v => setBlockAn(s => ({ ...s, stellen: v })))}
              {checkbox(`Altprojekte/Historie (${kontext.altprojekte?.length || 0})`, blockAn.altprojekte, v => setBlockAn(s => ({ ...s, altprojekte: v })))}
              {checkbox('Bisheriger Vertrag', blockAn.vertrag, v => setBlockAn(s => ({ ...s, vertrag: v })))}
              {checkbox(`Mitarbeiterstimmen (${kontext.mitarbeiterstimmen_anzahl || 0})`, blockAn.stimmen, v => setBlockAn(s => ({ ...s, stimmen: v })))}
              {checkbox(`Referenzbilder (${kontext.referenzbilder_anzahl || 0})`, blockAn.bilder, v => setBlockAn(s => ({ ...s, bilder: v })))}
            </div>
          </div>
        )}
      </section>

      {/* ── Close-Kontext ── */}
      {kundeId && (
        <section>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Close — Gesprächskontext (letzte 90 Tage)</h3>
          {closeLeadId ? (
            <>
              {!closeGeladen && (
                <button className="btn-ghost" disabled={closeBusy} onClick={() => closeLaden()}>
                  {closeBusy ? 'Lade…' : 'Aus Close laden'}
                </button>
              )}
              {closeGeladen && closeEintraege.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Keine Einträge in den letzten 90 Tagen.</div>}
              {closeEintraege.length > 0 && (
                <div className="card" style={{ padding: 10, display: 'grid', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                  {closeEintraege.map((e, i) => (
                    <label key={e.id || i} style={{ display: 'flex', gap: 8, fontSize: 12.5, cursor: 'pointer', alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={e._an} onChange={ev => setCloseEintraege(prev => prev.map((x, j) => (j === i ? { ...x, _an: ev.target.checked } : x)))} style={{ marginTop: 3 }} />
                      <span>
                        <span style={{ fontWeight: 600 }}>{e.title}</span>{e.date ? <span style={{ color: 'var(--ink-3)' }}> · {e.date}</span> : null}
                        {e.excerpt ? <div style={{ color: 'var(--ink-2)', marginTop: 2 }}>{e.excerpt}</div> : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Kein Close-Lead verknüpft. Firmenname suchen und verknüpfen:</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="Firmenname…" value={leadQuery} onChange={e => setLeadQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && leadSuchen()} />
                <button className="btn-ghost" onClick={leadSuchen}>Suchen</button>
              </div>
              {leadTreffer.map(l => (
                <button key={l.id} className="btn-ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { setCloseLeadId(l.id); closeLaden(l.id); setLeadTreffer([]); }}>
                  {l.name}{l.status ? ` · ${l.status}` : ''}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Freitext ── */}
      <section>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Was soll das Angebot enthalten?</h3>
        <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--ink-3)' }}>Stichworte reichen, z.B. „2 Stellen, Abo 6 Monate ohne Garantie, 1.490 netto pro Monat, Fotograf vor Ort, Start Mitte November".</p>
        <textarea className="input" rows={4} value={freitext} onChange={e => setFreitext(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
      </section>

      {/* ── Bausteine als Zutaten ── */}
      {bausteine.length > 0 && (
        <section>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Bausteine als Zutaten (Preise sind verbindlich)</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
            {bausteine.map(b => (
              <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={bausteinAn.has(b.id)} onChange={e => setBausteinAn(prev => { const n = new Set(prev); e.target.checked ? n.add(b.id) : n.delete(b.id); return n; })} />
                {b.title} <span style={{ color: 'var(--ink-3)' }}>({eur.format(Number(b.unit_price) || 0)})</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <div>
        <button className="btn-primary" disabled={generating} onClick={generieren}>
          {generating ? 'Generiere…' : hatEntwurf ? 'Neu generieren' : 'Angebot generieren'}
        </button>
      </div>

      {/* ── Editor ── */}
      {hatEntwurf && (
        <div className="card" style={{ padding: 18, display: 'grid', gap: 16 }}>
          {offenePunkte.length > 0 && (
            <div className="alert alert-error" style={{ display: 'grid', gap: 4 }}>
              <strong>Offene Punkte</strong>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{offenePunkte.map((o, i) => <li key={i}>{o}</li>)}</ul>
            </div>
          )}

          {versionen.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span style={{ color: 'var(--ink-3)' }}>Version:</span>
              {versionen.map((v, i) => (
                <button key={i} className={i === versionIdx ? 'btn-primary' : 'btn-ghost'} style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => versionWechseln(i)}>{i + 1}</button>
              ))}
              <span style={{ color: 'var(--ink-3)' }}>{versionen[versionIdx]?.label}</span>
            </div>
          )}

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Einleitung</span>
            <textarea className="input" rows={4} value={einleitung} onChange={e => setEinleitung(e.target.value)} style={{ resize: 'vertical' }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Leistungsbeschreibung</span>
            <textarea className="input" rows={5} value={leistung} onChange={e => setLeistung(e.target.value)} style={{ resize: 'vertical' }} />
          </label>

          {/* Positionen */}
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Positionen</span>
            <div style={{ display: 'grid', gap: 8 }}>
              {positionen.map(p => (
                <div key={p.key} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 120px 120px 32px', gap: 8, alignItems: 'start', padding: 8, border: '1px solid var(--gray-200)', borderRadius: 8 }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <input className="input" placeholder="Bezeichnung" value={p.titel} onChange={e => setPos(p.key, { titel: e.target.value })} />
                    <textarea className="input" rows={2} placeholder="Beschreibung" value={p.beschreibung} onChange={e => setPos(p.key, { beschreibung: e.target.value })} style={{ resize: 'vertical', fontSize: 12 }} />
                  </div>
                  <input className="input" type="number" min={1} value={p.menge} onChange={e => setPos(p.key, { menge: Number(e.target.value) || 1 })} title="Menge" />
                  <input className="input" placeholder="€ netto" value={p.einzelpreis_netto == null ? '' : euroStr(p.einzelpreis_netto)}
                    onChange={e => setPos(p.key, { einzelpreis_netto: parseEuro(e.target.value) })}
                    style={p.einzelpreis_netto == null ? { borderColor: '#f87171', background: '#fef2f2' } : undefined} />
                  <select className="input" value={p.kategorie} onChange={e => setPos(p.key, { kategorie: e.target.value })}>
                    <option value="setup">einmalig</option>
                    <option value="monthly">monatlich</option>
                  </select>
                  <button className="btn-ghost" style={{ padding: '4px 6px' }} onClick={() => posEntfernen(p.key)} title="Entfernen">✕</button>
                </div>
              ))}
            </div>
            <div>
              <button className="btn-ghost" onClick={posHinzufuegen}>+ Position</button>
            </div>
            <div style={{ display: 'flex', gap: 18, justifyContent: 'flex-end', fontSize: 13 }}>
              <span>Einmalig netto: <strong>{eur.format(summe.setup)}</strong></span>
              <span>Monatlich netto: <strong>{eur.format(summe.monthly)}</strong></span>
              <span style={{ color: 'var(--ink-3)' }}>Monat 1 brutto: {eur.format((summe.setup + summe.monthly) * 1.19)}</span>
            </div>
          </div>

          {/* Vertrag */}
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Vertrag</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Modell
                <select className="input" value={vertragsmodell} onChange={e => setVertragsmodell(e.target.value)}>
                  <option value="">—</option>
                  <option value="kampagne">Kampagne</option>
                  <option value="abo">Abo</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Laufzeit
                <input className="input" type="number" min={0} style={{ width: 90 }} value={laufzeitWert} onChange={e => setLaufzeitWert(e.target.value)} />
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Einheit
                <select className="input" value={laufzeitEinheit} onChange={e => setLaufzeitEinheit(e.target.value)}>
                  <option value="tage">Tage</option>
                  <option value="monate">Monate</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Garantie
                <select className="input" value={garantieArt} onChange={e => setGarantieArt(e.target.value)}>
                  <option value="keine">keine</option>
                  <option value="hire">bis zur Einstellung</option>
                  <option value="applications">Bewerbungsanzahl</option>
                </select>
              </label>
              {garantieArt !== 'keine' && (
                <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Frist (Tage)
                  <input className="input" type="number" min={1} style={{ width: 90 }} value={garantieFrist} onChange={e => setGarantieFrist(Number(e.target.value) || 30)} />
                </label>
              )}
              {garantieArt === 'applications' && (
                <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Ziel (Bewerbungen)
                  <input className="input" type="number" min={1} style={{ width: 110 }} value={garantieZiel} onChange={e => setGarantieZiel(Number(e.target.value) || 1)} />
                </label>
              )}
            </div>
            {garantieArt !== 'keine' && (
              <textarea className="input" rows={2} placeholder="Garantie-Formulierung (optional)" value={garantiePosition} onChange={e => setGarantiePosition(e.target.value)} style={{ resize: 'vertical', fontSize: 12 }} />
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>Gültig bis
              <input className="input" type="date" value={gueltigBis || ''} onChange={e => setGueltigBis(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, flex: 1, minWidth: 220 }}>Zahlungsbedingungen (optional, sonst Standard)
              <input className="input" value={zahlung} onChange={e => setZahlung(e.target.value)} />
            </label>
          </div>

          {/* Nachschärfen */}
          <div style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--gray-200)', paddingTop: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Nachschärfen</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" placeholder='z.B. „Garantie raus, Laufzeit 40 Tage, Preis 10 % runter"' value={anweisung} onChange={e => setAnweisung(e.target.value)} onKeyDown={e => e.key === 'Enter' && nachschaerfen()} style={{ flex: 1 }} />
              <button className="btn-ghost" disabled={refining || !anweisung.trim()} onClick={nachschaerfen}>{refining ? 'Überarbeite…' : 'Anwenden'}</button>
            </div>
          </div>

          {/* Speichern */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--gray-200)', paddingTop: 12 }}>
            <button className="btn-ghost" disabled={saving} onClick={() => speichern(false)}>Als Entwurf speichern</button>
            <button className="btn-primary" disabled={saving} onClick={() => speichern(true)}>Speichern &amp; easybill erzeugen</button>
          </div>
        </div>
      )}
    </div>
  );
}
