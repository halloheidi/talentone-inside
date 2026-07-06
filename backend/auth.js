import { supabase } from './supabase.js';
import { isAdminEmail } from './team.js';

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

// Middleware: setzt requireAuth voraus und prüft zusätzlich Admin-Rolle
// (Whitelist über team.js). Für Preisverwaltung, Katalog-CRUD etc.
export function requireAdmin(req, res, next) {
  const email = req.user?.email;
  if (!email || !isAdminEmail(email)) {
    return res.status(403).json({ error: 'Admin-Rechte erforderlich.' });
  }
  next();
}
