-- Zeitstempel des letzten Logo-Uploads. Basis fuer das "Logo aktualisieren"-
-- Banner im Creatives-Tab (Vergleich mit creative.created_at) und fuer die
-- Erkennung, welche Creatives noch die alte Logo-Fassung tragen.
alter table talentone_kunden
  add column if not exists logo_uploaded_at timestamptz;

-- Bestandskunden: sinnvoller Startwert, damit das Banner nicht sofort faelschlich
-- bei allen alten Creatives anschlaegt. Wir nehmen den Zeitpunkt des juengsten
-- Logo-Eintrags aus dem Referenzbilder-Log (typ='logo'), sonst NULL (kein Banner
-- bis zum naechsten echten Upload).
update talentone_kunden k
set logo_uploaded_at = sub.ts
from (
  select kunde_id, max(created_at) as ts
  from talentone_referenzbilder
  where typ = 'logo'
  group by kunde_id
) sub
where sub.kunde_id = k.id
  and k.logo_url is not null
  and k.logo_uploaded_at is null;
