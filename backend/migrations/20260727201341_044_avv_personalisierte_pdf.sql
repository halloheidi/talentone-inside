-- Adressfelder am Kunden (fuer personalisierte AVV-PDF; leer -> nur Firmenname).
alter table talentone_kunden
  add column if not exists strasse text,
  add column if not exists plz text,
  add column if not exists ort text,
  add column if not exists avv_pdf_meta jsonb;

-- Konkret angezeigte/akzeptierte PDF-Fassung am Annahme-Protokoll.
alter table talentone_avv_annahmen
  add column if not exists pdf_url text;

comment on column talentone_kunden.avv_pdf_meta is 'Cache der personalisierten AVV-PDF: {hash,url,path,version_id,generated_at}. Bei Kundendaten-/AVV-Versionsaenderung neu erzeugt.';
comment on column talentone_avv_annahmen.pdf_url is 'URL der konkret angezeigten/akzeptierten personalisierten PDF-Fassung. NULL bei Alt-Annahmen -> generische Master-Version bleibt gueltig.';
