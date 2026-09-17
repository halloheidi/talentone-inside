-- Verschiebbare Textblöcke für Sharp-gerenderte Creatives (Layout-Vorlagen + Strikt).
-- text_positionen: je Block {x,y,scale} (x/y = 0..1, Top-Left-Anker; scale = Schriftgrad-Faktor)
--   für DIESES Creative (= genau ein Format). Leeres Objekt/NULL = Vorlagen-Defaults.
-- render_spec: alles, was zum verlustfreien Neu-Rendern der Textebene nötig ist
--   (kind='layout' → vorlage/foto_id/slots/freisteller; kind='strikt' → base_url/hook/text_stil/accent).
alter table talentone_creatives add column if not exists text_positionen jsonb;
alter table talentone_creatives add column if not exists render_spec jsonb;

comment on column talentone_creatives.text_positionen is
  'Verschobene Textblöcke: { blockKey: { x, y, scale } } (x/y 0..1 Top-Left, scale Schriftfaktor). Pro Format (= Creative-Row). Leer/NULL = Vorlagen-Default.';
comment on column talentone_creatives.render_spec is
  'Re-Render-Spezifikation der Textebene. kind=layout: { kind, vorlage, foto_id, freisteller, slots }. kind=strikt: { kind, base_url, hook, text_stil, accent }.';
