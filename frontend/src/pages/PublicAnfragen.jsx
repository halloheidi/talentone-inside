import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { t } from '../lib/anrede.js';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const STATUS_OPTIONS = [
  { value: 'neu',          label: '🆕 Neu' },
  { value: 'kontaktiert',  label: '📞 Kontaktiert' },
  { value: 'termin',       label: '📅 Termin vereinbart' },
  { value: 'gewonnen',     label: '✅ Gewonnen' },
  { value: 'verloren',     label: '❌ Verloren' },
];

const BRAND = {
  talentone:  { name: 'TalentOne',    primary: '#0a0a0a', accent: '#d4ff00', accentInk: '#0a0a0a' },
  nowagwirth: { name: 'Nowag & Wirth', primary: '#0a0a0a', accent: '#980000', accentInk: '#ffffff' },
};

export default function PublicAnfragen() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/public/anfragen/${token}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error || 'Fehler'); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message));
  }, [token]);

  if (error) return <div style={{ padding: 32, textAlign: 'center' }}>{error}</div>;
  if (!data) return <div style={{ padding: 32, textAlign: 'center' }}>Lade Anfragen…</div>;

  const brand = BRAND[data.kunde?.agentur] || BRAND.talentone;

  async function saveAnfrage(id, patch) {
    setData(prev => ({ ...prev, anfragen: prev.anfragen.map(a => a.id === id ? { ...a, ...patch } : a) }));
    if (selected?.id === id) setSelected(prev => ({ ...prev, ...patch }));
    try {
      await fetch(`${API_BASE}/public/anfragen/${token}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (err) { alert('Speichern fehlgeschlagen: ' + err.message); }
  }

  const anfragen = data.anfragen || [];

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0', color: '#0a0a0a', fontFamily: '-apple-system, sans-serif' }}>
      <header style={{ background: brand.primary, color: '#fff', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{brand.name}</div>
        {data.kunde?.logo_url && <img src={data.kunde.logo_url} alt="" height={40} style={{ background: '#fff', borderRadius: 8, padding: '4px 8px' }} />}
        <div style={{ marginLeft: 'auto' }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Anfragen</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{data.job?.produkt || data.job?.stelle}</div>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>{t(data.kunde, 'Deine', 'Ihre')} Anfragen ({anfragen.length})</h1>
        <p style={{ color: '#5a5955', marginBottom: 20 }}>
          {t(data.kunde,
            'Alle Anfragen aus deiner Neukunden-Kampagne. Klick auf eine Zeile für Details.',
            'Alle Anfragen aus Ihrer Neukunden-Kampagne. Klicken Sie auf eine Zeile für Details.')}
        </p>

        {anfragen.length === 0 ? (
          <div style={{ padding: 40, background: '#fff', borderRadius: 12, textAlign: 'center', color: '#9a9994' }}>
            Noch keine Anfragen eingegangen.
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead style={{ background: '#fafaf8', borderBottom: '1px solid #ececea' }}>
                  <tr>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955' }}>Datum</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955' }}>Name</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955' }}>E-Mail</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955' }}>Telefon</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955' }}>Status</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, letterSpacing: 0.05, textTransform: 'uppercase', color: '#5a5955' }}>Notizen</th>
                  </tr>
                </thead>
                <tbody>
                  {anfragen.map(a => (
                    <tr key={a.id} onClick={() => setSelected(a)} style={{ borderBottom: '1px solid #ececea', cursor: 'pointer', opacity: a.status === 'verloren' ? 0.55 : 1 }}>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#5a5955', whiteSpace: 'nowrap' }}>
                        {new Date(a.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 600 }}>{a.name || '—'}</td>
                      <td style={{ padding: '12px 14px' }}>{a.email ? <a href={`mailto:${a.email}`} onClick={e => e.stopPropagation()}>{a.email}</a> : '—'}</td>
                      <td style={{ padding: '12px 14px' }}>{a.telefon ? <a href={`tel:${a.telefon}`} onClick={e => e.stopPropagation()}>{a.telefon}</a> : '—'}</td>
                      <td style={{ padding: '12px 14px' }} onClick={e => e.stopPropagation()}>
                        <select value={a.status} onChange={e => saveAnfrage(a.id, { status: e.target.value })}
                          style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, background: '#fff' }}>
                          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '12px 14px', maxWidth: 240 }} onClick={e => e.stopPropagation()}>
                        <textarea rows={2} defaultValue={a.notizen || ''}
                          onBlur={e => e.target.value !== (a.notizen || '') && saveAnfrage(a.id, { notizen: e.target.value || null })}
                          placeholder="Notiz…"
                          style={{ width: '100%', padding: '4px 6px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: 420, maxWidth: '100%', height: '100%', overflowY: 'auto', padding: 24 }}>
            <button onClick={() => setSelected(null)} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', float: 'right' }}>×</button>
            <h2 style={{ marginTop: 0 }}>{selected.name || 'Anfrage'}</h2>
            <div style={{ fontSize: 12, color: '#9a9994', marginBottom: 16 }}>
              Eingegangen {new Date(selected.created_at).toLocaleString('de-DE')}
            </div>

            <div style={{ display: 'grid', gap: 10, marginBottom: 20, fontSize: 14 }}>
              {selected.email && <div><strong>E-Mail:</strong> <a href={`mailto:${selected.email}`}>{selected.email}</a></div>}
              {selected.telefon && <div><strong>Telefon:</strong> <a href={`tel:${selected.telefon}`}>{selected.telefon}</a></div>}
            </div>

            {selected.daten && Object.keys(selected.daten).length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.08, textTransform: 'uppercase', color: '#5a5955', marginBottom: 8 }}>Weitere Angaben</div>
                <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  {Object.entries(selected.daten).map(([k, v]) => (
                    <div key={k}><strong>{k}:</strong> {String(v)}</div>
                  ))}
                </div>
              </div>
            )}

            <label style={{ display: 'block', marginBottom: 8, fontSize: 12, fontWeight: 600, color: '#5a5955', letterSpacing: 0.05, textTransform: 'uppercase' }}>Status</label>
            <select value={selected.status} onChange={e => saveAnfrage(selected.id, { status: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, marginBottom: 16 }}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <label style={{ display: 'block', marginBottom: 8, fontSize: 12, fontWeight: 600, color: '#5a5955', letterSpacing: 0.05, textTransform: 'uppercase' }}>Notizen</label>
            <textarea rows={6} defaultValue={selected.notizen || ''}
              onBlur={e => e.target.value !== (selected.notizen || '') && saveAnfrage(selected.id, { notizen: e.target.value || null })}
              placeholder="Notizen zum Kontakt, nächste Schritte, …"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
        </div>
      )}
    </div>
  );
}
