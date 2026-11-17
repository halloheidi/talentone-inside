// Zentrale Konstanten für das Reel-Modul (siehe docs/reel-modul-spec.md §8).
// Render-/Audio-Werte stammen aus der Wilhelm-Produktion (17.11.2026) und gelten ab R2.

// --- Render / Clip / Audio (R2, aber hier zentral abgelegt) ---
export const CLIP_HEAD_TRIM_S = 0.4;   // Standbild-Anlauf vorne abschneiden
export const CLIP_PAD_S = 1.4;         // Clip-Dauer = Satzdauer + Pad
export const CLIP_MIN_S = 4;           // Mindest-Cliplänge
export const VOICE_GAIN_DB = 3.5;      // Stimme anheben
export const MUSIC_GAIN_DB = -17.5;    // Musik absenken
export const TARGET_LUFS = -17;        // Mix-Zielpegel
export const CLIP_TIMEOUT_MIN = 8;     // Timeout je Clip-Generierung (Retry danach)
export const ENDCARD_S = 6.5;          // Endkarten-Dauer

// --- Format ---
export const IMG_BREITE = 1024;        // OpenAI-Bild Hochformat 2:3
export const IMG_HOEHE = 1536;
export const VIDEO_BREITE = 1080;      // Ziel 9:16
export const VIDEO_HOEHE = 1920;

// --- Skript ---
export const SATZ_ANZAHL = 9;          // 9 Sätze + fester Schlusssatz
export const SCHLUSS_DU = 'Link in der Anzeige. Eine Minute, fertig.';
export const SCHLUSS_SIE = 'Link in der Anzeige. Dauert keine Minute.';

// --- Auswahl-Enums (Backend-Whitelists; keine DB-Constraints) ---
export const STILE = ['foto', 'illustration', '3d'];
export const ANREDEN = ['du', 'sie'];
export const REEL_STATI = ['entwurf', 'skript_ok', 'bilder_ok', 'rendert', 'fertig', 'fehler'];

// Preset-Stimmen je Anrede (ElevenLabs, R2). voice_id wird in R2 aus .env.local/Settings gezogen.
export const STIMME_PRO_ANREDE = { du: 'dylan', sie: 'harrison' };

// Stilblock für den Master-Prompt (nur dieser Block ändert sich je Stil).
export const STIL_BLOCK = {
  foto: 'Fotorealistisch, wie mit einem iPhone aufgenommen, natürliches Licht, Reportage-Optik, keine Werbeästhetik.',
  illustration: 'Flache, moderne Vektor-Illustration, klare Formen, wenige Farben, Firmenfarben als Akzent, gleicher Zeichenstil in allen Bildern.',
  '3d': 'Hochwertiger 3D-Animationslook wie ein Pixar-Film, weiches Licht, freundliche Proportionen, gleicher Charakter in allen Bildern.',
};

// Einziger Settings-Wert (talentone_settings); Keys selbst liegen in .env.local.
export const SETTING_CREDIT_WARNSCHWELLE = 'reel_credit_warnschwelle';
export const CREDIT_WARNSCHWELLE_DEFAULT = 200;

// Musik-Pool (Bucket), Auswahl im UI; 0 Credits.
export const MUSIK_BUCKET = 'talentone-reel-musik';
export const MUSIK_ORDNER = ['handwerk', 'buero', 'neutral'];
