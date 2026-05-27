import express from 'express';
import cors from 'cors';
import { requireAuth } from './auth.js';
import kundenRouter from './routes/kunden.js';
import jobsRouter from './routes/jobs.js';
import creativesRouter from './routes/creatives.js';
import adcopiesRouter from './routes/adcopies.js';
import funnelsRouter from './routes/funnels.js';
import exportsRouter from './routes/exports.js';
import publicRouter from './routes/public.js';
import webhooksRouter from './routes/webhooks.js';
import bewerbungenRouter from './routes/bewerbungen.js';
import zahlungenRouter from './routes/zahlungen.js';
import zahlungenWebhookRouter from './routes/zahlungen-webhook.js';

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://inside.talent-one.de,https://recruiting.nowagwirth.com,http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`Origin nicht erlaubt: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '20mb' })); // PDFs als base64 → bis ~15 MB Datei

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'TalentOne Inside Backend' });
});

// Public — KEIN Login (Kunde lädt Logo/Fotos via Token-Link hoch).
app.use('/api/public', publicRouter);
app.use('/api/webhooks', webhooksRouter);

// Geschützt — nur eingeloggte Mitarbeiter.
app.use('/api/kunden', requireAuth, kundenRouter);
app.use('/api/jobs', requireAuth, jobsRouter);
app.use('/api/creatives', requireAuth, creativesRouter);
app.use('/api/adcopies', requireAuth, adcopiesRouter);
app.use('/api/funnels', requireAuth, funnelsRouter);
app.use('/api/bewerbungen', requireAuth, bewerbungenRouter);
// PayPal Webhook — KEIN Auth (PayPal ruft direkt auf, Signatur-Verifikation im Handler).
// Muss VOR dem auth-geschützten zahlungenRouter mit gleicher Basis-URL gemountet werden.
app.use('/api/zahlungen/webhook', zahlungenWebhookRouter);
app.use('/api/zahlungen', requireAuth, zahlungenRouter);
app.use('/api', requireAuth, exportsRouter); // mountet /api/jobs/:id/export/...

app.use((err, req, res, _next) => {
  console.error('[Inside] Fehler:', err.message);
  res.status(500).json({ error: err.message || 'Interner Fehler' });
});

app.listen(PORT, () => {
  console.log(`✅ TalentOne Inside Backend läuft auf Port ${PORT}`);
});
