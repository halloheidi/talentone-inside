import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getBrand } from '../lib/branding.js';

const BASE = import.meta.env.VITE_API_BASE || '/api';
async function publicApi(path, options = {}) {
  const res = await fetch(`${BASE}/public${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

function BrandHeader({ agentur, logo_url, firmenname }) {
  const brand = getBrand(agentur);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
      <div className="public-brand">
        {brand.key === 'nowagwirth'
          ? <img src={brand.logoUrl} alt={brand.name} style={{ height: 26 }} />
          : <span><span>Talent</span><span className="brand-accent">One</span></span>}
      </div>
      {logo_url && <img src={logo_url} alt={firmenname || ''} style={{ height: 40, maxWidth: 160, objectFit: 'contain' }} />}
    </div>
  );
}

export default function PublicAngebot() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [optionen, setOptionen] = useState(new Set()); // indices der angekreuzten optionalen Positionen
  const [name, setName] = useState('');
  const [funktion, setFunktion] = useState('');
  const [verbindlich, setVerbindlich] = useState(false);
  const [agb, setAgb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [rueckfrageOffen, setRueckfrageOffen] = useState(false);
  const [rueckfrage, setRueckfrage] = useState('');
  const [rueckfrageDone, setRueckfrageDone] = useState(false);

  useEffect(() => {
    publicApi(`/angebot/${token}`).then(setInfo).catch(e => setLoadError(e.message));
  }, [token]);

  const pflicht = useMemo(() => (info?.positionen || []).filter(p => !p.optional), [info]);
  const opts = useMemo(() => (info?.positionen || []).filter(p => p.optional), [info]);

  const summe = useMemo(() => {
    let setup = 0, monatlich = 0;
    for (const p of (info?.positionen || [])) {
      if (p.optional && !optionen.has(p.index)) continue;
      const zeile = (Number(p.einzelpreis_netto) || 0) * (Number(p.menge) || 1);
      if (p.periodisch) monatlich += zeile; else setup += zeile;
    }
    return { setup, monatlich };
  }, [info, optionen]);

  async function annehmen(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Bitte Ihren Namen eingeben.'); return; }
    if (!verbindlich) { setError('Bitte die verbindliche Annahme bestätigen.'); return; }
    if (!agb) { setError('Bitte die AGB/AVV bestätigen.'); return; }
    setBusy(true);
    try {
      await publicApi(`/angebot/${token}/akzeptieren`, { method: 'POST', body: { name: name.trim(), funktion: funktion.trim(), agb_ok: true, optionen: [...optionen] } });
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function sendeRueckfrage(e) {
    e.preventDefault();
    if (!rueckfrage.trim()) return;
    setBusy(true); setError('');
    try {
      await publicApi(`/angebot/${token}/rueckfrage`, { method: 'POST', body: { text: rueckfrage.trim() } });
      setRueckfrageDone(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (loadError) return <div className="public-page"><div className="public-card"><h1 className="public-title">Hoppla.</h1><p className="public-sub">{loadError}</p></div></div>;
  if (!info) return <div className="public-page"><div className="public-card">Lade…</div></div>;

  const bereitsAngenommen = !!info.angenommen_am || done;

  return (
    <div className="public-page">
      <div className="public-card" style={{ maxWidth: 720 }}>
        <BrandHeader agentur={info.agentur} logo_url={info.logo_url} firmenname={info.firmenname} />

        {info.abgelaufen && !bereitsAngenommen && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>Dieses Angebot ist abgelaufen. Bitte melden Sie sich bei uns für ein aktualisiertes Angebot.</div>
        )}

        {done && (
          <div className="alert" style={{ marginBottom: 16, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#065f46' }}>
            <strong>Vielen Dank — Angebot angenommen.</strong> Sie erhalten in Kürze eine Bestätigung per E-Mail. Wir melden uns zur Abstimmung des Kickoffs.
          </div>
        )}
        {!done && info.angenommen_am && (
          <div className="alert" style={{ marginBottom: 16, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#065f46' }}>
            Dieses Angebot wurde bereits angenommen{info.angenommen_von ? ` von ${info.angenommen_von}` : ''}.
          </div>
        )}

        <h1 className="public-title" style={{ marginBottom: 6 }}>Ihr Angebot</h1>
        {info.gueltig_bis && <p className="public-sub" style={{ marginTop: 0 }}>Gültig bis {new Date(info.gueltig_bis).toLocaleDateString('de-DE')}</p>}

        {info.einleitung && <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, marginTop: 14 }}>{info.einleitung}</p>}
        {info.leistungsbeschreibung && (
          <div style={{ marginTop: 10 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>Leistungsumfang</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#333', margin: 0 }}>{info.leistungsbeschreibung}</p>
          </div>
        )}

        {/* Positionen */}
        <div style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Leistungen</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {pflicht.map(p => (
              <div key={p.index} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid #eee' }}>
                <div><strong>{p.titel}</strong>{p.beschreibung ? <div style={{ fontSize: 12.5, color: '#666' }}>{p.beschreibung}</div> : null}</div>
                <div style={{ whiteSpace: 'nowrap' }}>{eur.format(p.einzelpreis_netto * p.menge)}{p.periodisch ? ' / Monat' : ''}</div>
              </div>
            ))}
          </div>

          {opts.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 13.5, margin: '0 0 6px', color: '#555' }}>Optional zubuchbar</h4>
              <div style={{ display: 'grid', gap: 6 }}>
                {opts.map(p => (
                  <label key={p.index} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 10px', border: '1px solid', borderColor: optionen.has(p.index) ? 'var(--accent, #0a7)' : '#e5e5e5', borderRadius: 8, cursor: bereitsAngenommen ? 'default' : 'pointer' }}>
                    <span style={{ display: 'flex', gap: 8 }}>
                      <input type="checkbox" disabled={bereitsAngenommen || info.abgelaufen} checked={optionen.has(p.index)}
                        onChange={e => setOptionen(prev => { const n = new Set(prev); e.target.checked ? n.add(p.index) : n.delete(p.index); return n; })} />
                      <span><strong>{p.titel}</strong>{p.beschreibung ? <div style={{ fontSize: 12.5, color: '#666' }}>{p.beschreibung}</div> : null}</span>
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>{eur.format(p.einzelpreis_netto * p.menge)}{p.periodisch ? ' / Monat' : ''}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 18, marginTop: 12, fontSize: 14 }}>
            {summe.setup > 0 && <span>Einmalig: <strong>{eur.format(summe.setup)}</strong> netto</span>}
            {summe.monatlich > 0 && <span>Monatlich: <strong>{eur.format(summe.monatlich)}</strong> netto</span>}
          </div>
        </div>

        {/* Vertrag */}
        {(info.vertrag?.vertragsmodell || info.vertrag?.garantie) && (
          <div style={{ marginTop: 16, padding: 12, background: '#f7f7f5', borderRadius: 10, fontSize: 13.5 }}>
            {info.vertrag.vertragsmodell && <div><strong>Modell:</strong> {info.vertrag.vertragsmodell === 'abo' ? 'Abo' : 'Kampagne'}{info.vertrag.laufzeit_wert ? ` · Laufzeit ${info.vertrag.laufzeit_wert} ${info.vertrag.laufzeit_einheit || ''}` : ''}</div>}
            {info.vertrag.garantie && <div style={{ marginTop: 4 }}><strong>Garantie:</strong> {info.vertrag.garantie}</div>}
          </div>
        )}
        {info.zahlungsbedingungen && <p style={{ fontSize: 12.5, color: '#666', marginTop: 10 }}><strong>Zahlungsbedingungen:</strong> {info.zahlungsbedingungen}</p>}

        {info.hat_pdf && (
          <p style={{ marginTop: 12 }}><a href={`${BASE}/public/angebot/${token}/pdf`} target="_blank" rel="noreferrer">📄 Angebot als PDF herunterladen</a></p>
        )}

        {/* Annahme */}
        {!bereitsAngenommen && !info.abgelaufen && (
          <form onSubmit={annehmen} style={{ marginTop: 20, borderTop: '1px solid #eee', paddingTop: 16, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input className="input" placeholder="Ihr Name" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <input className="input" placeholder="Funktion (optional)" value={funktion} onChange={e => setFunktion(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
            </div>
            <label style={{ display: 'flex', gap: 8, fontSize: 13.5 }}><input type="checkbox" checked={verbindlich} onChange={e => setVerbindlich(e.target.checked)} /> Ich nehme das Angebot verbindlich an.</label>
            <label style={{ display: 'flex', gap: 8, fontSize: 13.5 }}>
              <input type="checkbox" checked={agb} onChange={e => setAgb(e.target.checked)} />
              Ich akzeptiere die {info.avv_url ? <a href={info.avv_url} target="_blank" rel="noreferrer">AGB / AVV</a> : 'AGB / AVV'}.
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary" disabled={busy} type="submit">{busy ? 'Sende…' : 'Angebot annehmen'}</button>
              <button className="btn-ghost" type="button" onClick={() => setRueckfrageOffen(o => !o)}>Rückfrage stellen</button>
            </div>
          </form>
        )}

        {rueckfrageOffen && !rueckfrageDone && (
          <form onSubmit={sendeRueckfrage} style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            <textarea className="input" rows={3} placeholder="Ihre Rückfrage…" value={rueckfrage} onChange={e => setRueckfrage(e.target.value)} />
            <div><button className="btn-primary" disabled={busy} type="submit">Rückfrage senden</button></div>
          </form>
        )}
        {rueckfrageDone && <div className="alert" style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>Danke — Ihre Rückfrage ist bei uns eingegangen. Wir melden uns.</div>}
      </div>
    </div>
  );
}
