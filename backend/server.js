import express from 'express';
import cors from 'cors';
import { requireAuth } from './auth.js';
import { isAdminEmail } from './team.js';
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
import projekteRouter from './routes/projekte.js';
import analyseFunnelRouter from './routes/analyse-funnel.js';
import offerCatalogRouter from './routes/offer-catalog.js';
import easybillCustomersRouter from './routes/easybill-customers.js';
import offersRouter from './routes/offers.js';
import invoicesRouter from './routes/invoices.js';
import easybillWebhookRouter from './routes/easybill-webhook.js';
import { startEasybillCustomerSyncScheduler } from './easybill-sync.js';
import { startOfferSyncScheduler } from './offer-sync.js';
import { startInvoiceSyncScheduler } from './invoice-sync.js';

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
// easybill-Webhook MUSS vor express.json() gemountet werden — der Handler
// braucht den Raw-Body für die HMAC-Signatur-Verifikation.
app.use('/api/webhooks/easybill', easybillWebhookRouter);

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
app.use('/api/projekte', requireAuth, projekteRouter);
app.use('/api/analyse-funnel', requireAuth, analyseFunnelRouter);
app.use('/api/offer-catalog', requireAuth, offerCatalogRouter);
app.use('/api/easybill-customers', requireAuth, easybillCustomersRouter);
app.use('/api/offers', requireAuth, offersRouter);
app.use('/api/invoices', requireAuth, invoicesRouter);
app.use('/api', requireAuth, exportsRouter); // mountet /api/jobs/:id/export/...

// Wer bin ich? Wird vom Frontend genutzt, um Admin-only-Menüs auszublenden.
app.get('/api/me', requireAuth, (req, res) => {
  const email = req.user?.email || null;
  res.json({
    email,
    is_admin: !!(email && isAdminEmail(email)),
  });
});

app.use((err, req, res, _next) => {
  console.error('[Inside] Fehler:', err.message);
  res.status(500).json({ error: err.message || 'Interner Fehler' });
});

app.listen(PORT, () => {
  console.log(`✅ TalentOne Inside Backend läuft auf Port ${PORT}`);
  startEasybillCustomerSyncScheduler();
  startOfferSyncScheduler();
  startInvoiceSyncScheduler();
});
