import express from 'express';
import cors from 'cors';
import { requireAuth } from './auth.js';
import kundenRouter from './routes/kunden.js';
import jobsRouter from './routes/jobs.js';
import creativesRouter from './routes/creatives.js';

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://inside.talent-one.de,http://localhost:5173')
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

app.use('/api/kunden', requireAuth, kundenRouter);
app.use('/api/jobs', requireAuth, jobsRouter);
app.use('/api/creatives', requireAuth, creativesRouter);

app.use((err, req, res, _next) => {
  console.error('[Inside] Fehler:', err.message);
  res.status(500).json({ error: err.message || 'Interner Fehler' });
});

app.listen(PORT, () => {
  console.log(`✅ TalentOne Inside Backend läuft auf Port ${PORT}`);
});
