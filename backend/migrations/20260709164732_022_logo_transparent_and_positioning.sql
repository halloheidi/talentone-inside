ALTER TABLE talentone_kunden
  ADD COLUMN IF NOT EXISTS logo_transparent_url TEXT;

COMMENT ON COLUMN talentone_kunden.logo_transparent_url IS
  'Bereinigte PNG-Version des Logos mit transparentem Hintergrund (weiße Pixel entfernt). Wird für das Sharp-Overlay auf Creatives verwendet.';

ALTER TABLE talentone_creatives
  ADD COLUMN IF NOT EXISTS bild_ohne_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS logo_position JSONB;

COMMENT ON COLUMN talentone_creatives.bild_ohne_logo_url IS
  'Roh-Output der KI vor dem Logo-Overlay. Wird gebraucht, um Logo-Position nachträglich neu zu rendern.';

COMMENT ON COLUMN talentone_creatives.logo_position IS
  'Relative Logo-Position + Größe: {x: 0..1 (Zentrum), y: 0..1, width_pct: 0..1}. NULL = Default (oben rechts, 20% Bildbreite).';
