// Qonto-Rechnungsweiterleitung: Lieferanten-Rechnungen aus den verbundenen Gmail-
// Postfächern dem richtigen Firmen-Rechnungseingang zuordnen und per Gmail-API
// weiterleiten. Empfänger steht oft NUR im PDF → Text extrahieren + matchen.
// Sicherheit: nie dieselbe (message_id, firma) zweimal forwarden; Schalter default aus.

import { supabase } from './supabase.js';
import { getSecret } from './settings-secrets.js';
import { istBeleg } from './gmail.js';
import {
  listKonten, ladeKontoRow, listMessageIds, getMessageForScan, getAttachment,
  ensureLabel, addLabel, sendRawMail, buildForwardRaw,
} from './gmail.js';

// Firmen-Stammdaten (Konstanten). namen = Alias-Schreibweisen; ustid/plz für
// stärkeres Matching (bei Bedarf ergänzen); domains = schwaches To-Signal.
export const FIRMEN = {
  nowagwirth: {
    label: 'Nowag & Wirth',
    namen: ['nowag & wirth', 'nowag und wirth', 'nowag&wirth', 'nowag + wirth', 'nowagwirth', 'n&w ', ' n & w '],
    ustid: [], plz: [], domains: ['nowagwirth.de', 'nowagwirth.com'],
  },
  halloheidi: {
    label: 'HalloHeidi',
    namen: ['halloheidi', 'hallo heidi', 'hallo-heidi'],
    ustid: [], plz: [], domains: ['halloheidi.de'],
  },
};
const QONTO_SECRET = { nowagwirth: 'qonto_inbox_nowagwirth', halloheidi: 'qonto_inbox_halloheidi' };
const MAHNUNG_RE = /\b(mahnung|zahlungserinnerung|zahlungsaufforderung|inkasso|letzte\s+mahnung)\b/i;

/* ───── Schalter ───── */
export async function getQontoFlag() {
  try {
    const { data } = await supabase.from('talentone_settings').select('wert').eq('schluessel', 'qonto_weiterleitung_aktiv').maybeSingle();
    return (data?.wert || '').toLowerCase() === 'true';
  } catch { return false; }
}
export async function setQontoFlag(aktiv, by) {
  await supabase.from('talentone_settings').upsert({ schluessel: 'qonto_weiterleitung_aktiv', wert: aktiv ? 'true' : 'false', updated_at: new Date().toISOString(), updated_by: by }, { onConflict: 'schluessel' });
}

async function extractPdfText(buffer) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const r = await pdfParse(buffer);
    return (r.text || '').trim();
  } catch { return ''; }
}

/** Firma aus PDF-Text (+ schwaches To-Domain-Signal) erkennen. */
export function erkenneFirma({ text, toDomain }) {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ');
  const strong = [];
  for (const [key, f] of Object.entries(FIRMEN)) {
    const nameHit = f.namen.some(n => t.includes(n.trim()) && n.trim().length >= 4) || f.namen.some(n => t.includes(n));
    const ustHit = f.ustid.length && f.ustid.some(u => t.includes(String(u).toLowerCase()));
    const adrHit = f.plz.length && f.plz.some(p => t.includes(String(p)));
    if (nameHit || ustHit || adrHit) strong.push({ key, via: nameHit ? 'name' : ustHit ? 'ustid' : 'adresse' });
  }
  const uniqueKeys = [...new Set(strong.map(s => s.key))];
  if (uniqueKeys.length === 1) return { firma: uniqueKeys[0], via: strong.find(s => s.key === uniqueKeys[0]).via };
  if (uniqueKeys.length >= 2) return { firma: null, via: 'mehrdeutig' };
  // keine starke Übereinstimmung → schwaches Domain-Signal
  const dom = Object.entries(FIRMEN).filter(([, f]) => f.domains.some(d => (toDomain || '').endsWith(d)));
  if (dom.length === 1) return { firma: dom[0][0], via: 'domain_schwach' };
  return { firma: null, via: 'keiner' };
}

async function ladeAbsenderRegeln() {
  const { data } = await supabase.from('talentone_qonto_absender_regeln').select('absender, firma');
  const map = {};
  for (const r of data || []) map[r.absender.toLowerCase()] = r.firma;
  return map;
}
function regelFirma(map, fromEmail) {
  const e = (fromEmail || '').toLowerCase();
  return map[e] || map[e.split('@')[1]] || null;
}

async function forwardAnQonto(konto, to, scan, pdfs) {
  const attachments = [];
  for (const p of pdfs) {
    const buf = await getAttachment(konto, scan.id, p.attachmentId);
    attachments.push({ filename: p.filename, contentBase64: buf.toString('base64') });
  }
  const raw = buildForwardRaw({
    from: konto.email, to, subject: scan.subject,
    text: `Automatische Weiterleitung an den Qonto-Rechnungseingang (TalentOne Inside).\n\nUrsprünglicher Absender: ${scan.from}\nPostfach: ${konto.email}`,
    attachments,
  });
  return sendRawMail(konto, raw);
}

async function upsertRow(row) {
  await supabase.from('talentone_qonto_weiterleitungen')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'message_id,konto,empfaenger_erkannt' });
}

/**
 * Scan beider Konten (letzte 7 Tage, Beleg + PDF). dryRunOverride=true erzwingt
 * reine Erkennung ohne Versand (Testlauf); sonst richtet sich der Versand nach dem Schalter.
 * @returns { geprueft, weitergeleitet, manuell, dry }
 */
export async function runQontoScan({ dryRunOverride = null } = {}) {
  const aktiv = await getQontoFlag();
  const dry = dryRunOverride != null ? dryRunOverride : !aktiv;
  const qontoAddr = { nowagwirth: await getSecret('qonto_inbox_nowagwirth'), halloheidi: await getSecret('qonto_inbox_halloheidi') };
  const regeln = await ladeAbsenderRegeln();
  const konten = (await listKonten()).filter(k => k.status === 'aktiv');
  let geprueft = 0, weitergeleitet = 0, manuell = 0;

  for (const kMeta of konten) {
    const konto = await ladeKontoRow(kMeta.id);
    let ids = [];
    try { ids = await listMessageIds(konto, 'in:inbox newer_than:7d has:attachment filename:pdf', 60); }
    catch (e) { console.warn('[qonto] list', kMeta.email, e.message); continue; }

    for (const id of ids) {
      let scan; try { scan = await getMessageForScan(konto, id); } catch { continue; }
      if (!scan.pdfs.length) continue;
      if (!istBeleg({ fromEmail: scan.fromEmail, subject: scan.subject, headers: scan.headers, snippet: scan.snippet }).bulk) continue;
      geprueft++;
      const regFirma = regelFirma(regeln, scan.fromEmail);

      // Jede PDF einzeln klassifizieren.
      const perPdf = [];
      let mahnung = MAHNUNG_RE.test(scan.subject || '');
      for (const p of scan.pdfs) {
        const buf = await getAttachment(konto, id, p.attachmentId).catch(() => null);
        const text = buf ? await extractPdfText(buf) : '';
        if (MAHNUNG_RE.test(text)) mahnung = true;
        if (!text) { perPdf.push({ p, firma: null, via: 'scan_ohne_text' }); continue; }
        let { firma, via } = erkenneFirma({ text, toDomain: scan.toDomain });
        if (!firma && regFirma) { firma = regFirma; via = 'absender_regel'; }
        perPdf.push({ p, firma, via });
      }

      const basis = { message_id: id, konto: konto.email, absender: scan.fromEmail, betreff: scan.subject };

      // Mahnung → nie automatisch forwarden, nur Hinweis in der Manuell-Liste.
      if (mahnung) {
        await upsertRowIfNew(basis, { empfaenger_erkannt: 'manuell', status: 'mahnung', erkannt_via: 'mahnung', pdf_namen: scan.pdfs.map(x => x.filename), hinweis: 'Mahnung/Zahlungserinnerung — nur zur Prüfung, keine Auto-Weiterleitung.' });
        manuell++;
        if (!dry) { try { const lid = await ensureLabel(konto, 'Qonto ⚠ manuell'); await addLabel(konto, id, lid); } catch {} }
        continue;
      }

      // Nach Firma gruppieren.
      for (const firmaKey of ['nowagwirth', 'halloheidi']) {
        const group = perPdf.filter(x => x.firma === firmaKey);
        if (!group.length) continue;
        const via = group[0].via;
        // Dedupe: bereits weitergeleitet → nie erneut.
        const { data: ex } = await supabase.from('talentone_qonto_weiterleitungen')
          .select('status').eq('message_id', id).eq('konto', konto.email).eq('empfaenger_erkannt', firmaKey).maybeSingle();
        if (ex?.status === 'weitergeleitet') continue;
        if (dry) {
          await upsertRow({ ...basis, empfaenger_erkannt: firmaKey, status: 'erkannt', erkannt_via: via, pdf_namen: group.map(g => g.p.filename), weitergeleitet_an: qontoAddr[firmaKey] || null, hinweis: qontoAddr[firmaKey] ? null : 'Qonto-Adresse noch nicht hinterlegt' });
        } else if (!qontoAddr[firmaKey]) {
          await upsertRow({ ...basis, empfaenger_erkannt: firmaKey, status: 'fehler', erkannt_via: via, pdf_namen: group.map(g => g.p.filename), hinweis: 'Qonto-Adresse fehlt' });
        } else {
          try {
            await forwardAnQonto(konto, qontoAddr[firmaKey], scan, group.map(g => g.p));
            const lid = await ensureLabel(konto, 'Qonto ✓'); await addLabel(konto, id, lid).catch(() => {});
            await upsertRow({ ...basis, empfaenger_erkannt: firmaKey, status: 'weitergeleitet', erkannt_via: via, pdf_namen: group.map(g => g.p.filename), weitergeleitet_an: qontoAddr[firmaKey] });
            weitergeleitet++;
          } catch (e) {
            await upsertRow({ ...basis, empfaenger_erkannt: firmaKey, status: 'fehler', erkannt_via: via, pdf_namen: group.map(g => g.p.filename), hinweis: e.message.slice(0, 200) });
          }
        }
      }

      // Nicht zuordenbare PDFs → manuell.
      const unklar = perPdf.filter(x => !x.firma);
      if (unklar.length) {
        await upsertRowIfNew(basis, { empfaenger_erkannt: 'manuell', status: 'manuell', erkannt_via: unklar[0].via, pdf_namen: unklar.map(g => g.p.filename), hinweis: null });
        manuell++;
        if (!dry) { try { const lid = await ensureLabel(konto, 'Qonto ⚠ manuell'); await addLabel(konto, id, lid); } catch {} }
      }
    }
  }
  return { geprueft, weitergeleitet, manuell, dry };
}

// Manuell-Zeilen nicht überschreiben, wenn sie schon weitergeleitet wurden.
async function upsertRowIfNew(basis, row) {
  const { data: ex } = await supabase.from('talentone_qonto_weiterleitungen')
    .select('status').eq('message_id', basis.message_id).eq('konto', basis.konto).eq('empfaenger_erkannt', row.empfaenger_erkannt).maybeSingle();
  if (ex?.status === 'weitergeleitet') return;
  await upsertRow({ ...basis, ...row });
}

/** Manuelle Zuordnung aus dem Dashboard: forwarden + Absender-Regel lernen. */
export async function zuordnenManuell({ rowId, firma, user }) {
  if (!['nowagwirth', 'halloheidi'].includes(firma)) throw new Error('Ungültige Firma.');
  const { data: row } = await supabase.from('talentone_qonto_weiterleitungen').select('*').eq('id', rowId).maybeSingle();
  if (!row) throw new Error('Eintrag nicht gefunden.');
  const to = await getSecret(QONTO_SECRET[firma]);
  if (!to) throw new Error(`Qonto-Adresse für ${firma} fehlt.`);
  const konto = await ladeKontoRow(row.konto);
  if (!konto) throw new Error('Konto nicht gefunden.');
  const scan = await getMessageForScan(konto, row.message_id);
  await forwardAnQonto(konto, to, scan, scan.pdfs);
  try { const lid = await ensureLabel(konto, 'Qonto ✓'); await addLabel(konto, row.message_id, lid); } catch {}
  // Absender-Regel merken (künftig automatisch).
  if (scan.fromEmail) {
    await supabase.from('talentone_qonto_absender_regeln')
      .upsert({ absender: scan.fromEmail.toLowerCase(), firma, erstellt_von: user }, { onConflict: 'absender' });
  }
  await supabase.from('talentone_qonto_weiterleitungen')
    .update({ empfaenger_erkannt: firma, status: 'weitergeleitet', weitergeleitet_an: to, erkannt_via: 'manuell_dashboard', updated_at: new Date().toISOString() })
    .eq('id', rowId);
  return { ok: true, firma, weitergeleitet_an: to };
}

/** Übersicht fürs Dashboard (letzte 7 Tage). */
export async function qontoUebersicht() {
  const seit = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supabase.from('talentone_qonto_weiterleitungen')
    .select('*').gte('created_at', seit).order('created_at', { ascending: false });
  const rows = data || [];
  return {
    weitergeleitet: rows.filter(r => r.status === 'weitergeleitet').length,
    manuell: rows.filter(r => r.status === 'manuell' || r.status === 'mahnung').map(r => ({ id: r.id, message_id: r.message_id, konto: r.konto, absender: r.absender, betreff: r.betreff, status: r.status, erkannt_via: r.erkannt_via, hinweis: r.hinweis, pdf_namen: r.pdf_namen })),
    erkannt_dry: rows.filter(r => r.status === 'erkannt'),
    alle: rows,
  };
}

/* ───── Scheduler (alle 30 Min) ───── */
let qontoTimer = null;
export function startQontoScheduler() {
  const run = () => runQontoScan().then(r => console.log(`[qonto] Scan: ${r.geprueft} geprüft, ${r.weitergeleitet} weitergeleitet, ${r.manuell} manuell${r.dry ? ' (DRY)' : ''}`)).catch(e => console.warn('[qonto] scan', e.message));
  setTimeout(run, 60 * 1000); // 1 Min nach Start
  qontoTimer = setInterval(run, 30 * 60 * 1000);
}
