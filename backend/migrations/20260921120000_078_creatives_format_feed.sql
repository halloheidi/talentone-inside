-- Drittes Ausgabeformat: 4:5 (1080×1350, Metas empfohlenes Mobile-Feed-Format).
-- format-Key 'feed' neben 'quadrat' (1:1) und 'story' (9:16).
alter table talentone_creatives drop constraint if exists talentone_creatives_format_check;
alter table talentone_creatives add constraint talentone_creatives_format_check
  check (format = any (array['quadrat'::text, 'story'::text, 'feed'::text]));
