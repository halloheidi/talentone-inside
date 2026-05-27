import { supabase } from './supabase.js';

// Middleware: prüft Supabase Access Token im Authorization Header
// Frontend schickt: Authorization: Bearer <access_token>
export async function requireAuth(req, res, next) {
  if (!supabase) return res.status(500).json({ error: 'Supabase nicht konfiguriert.' });

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt.' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Ungültiger Token.' });
  }

  req.user = data.user;
  next();
}
