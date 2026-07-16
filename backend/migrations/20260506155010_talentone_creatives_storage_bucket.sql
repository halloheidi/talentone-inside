-- Public-Bucket für TalentOne Inside Creatives.
-- Service-Role uploaded direkt (bypasst RLS), Frontend lädt nur über das Backend
-- → kein Bedarf für storage.objects Policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'talentone-creatives',
  'talentone-creatives',
  true,
  20971520,                                -- 20 MB
  array['image/png','image/jpeg','image/webp','video/mp4']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
