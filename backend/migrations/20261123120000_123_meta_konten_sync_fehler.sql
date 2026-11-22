-- 123: Pro-Konto-Sync-Fehler am Werbekonto festhalten.
-- Hintergrund: Verliert der System-User den Zugriff auf ein Werbekonto (Freigabe
-- entzogen / nie zugewiesen), schlägt der konto-weise Graph-Call fehl (403 /
-- Permissions-Code). account_status bleibt dann auf dem alten, erfolgreichen Wert
-- stehen ("stale"), sodass "account_status null" solche Konten NICHT erkennt.
-- Darum den letzten Konto-Sync-Fehler persistieren → Status "Freigabe fehlt"
-- und der Wächter "Konten ohne erfolgreichen Sync".
-- letzter_sync_fehler = NULL ⇢ letzter Lauf für dieses Konto war erfolgreich.
alter table talentone_meta_konten add column if not exists letzter_sync_fehler text;
alter table talentone_meta_konten add column if not exists letzter_sync_am timestamptz;
