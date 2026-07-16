update talentone_jobs
set vorqualifizierung_felder = '[
  {"name":"Ausbildung","typ":"text"},
  {"name":"Alter","typ":"text"},
  {"name":"Aktuelle Situation","typ":"text"},
  {"name":"Motivation / Wechselgrund","typ":"text"},
  {"name":"Gehaltsvorstellung (brutto)","typ":"text"},
  {"name":"Erreichbarkeit","typ":"dropdown","optionen":["Jederzeit","Vormittags","Mittags","Nachmittags","Abends"]},
  {"name":"PLZ / Wohnort","typ":"text"},
  {"name":"Führerschein","typ":"dropdown","optionen":["Ja","Nein","Aktuell nicht"]},
  {"name":"Verfügbarkeit","typ":"text"}
]'::jsonb
where vorqualifizierung = true
  and (
    vorqualifizierung_felder is null
    or jsonb_typeof(vorqualifizierung_felder) <> 'array'
    or jsonb_array_length(vorqualifizierung_felder) = 0
  );
