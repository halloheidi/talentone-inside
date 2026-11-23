-- 124: funnels.pixel_id aus dem Perspective-Abgleich (20.11.2026) befüllen + Herkunft.
-- pixel_id_quelle:
--   'gelesen'    = Pixel direkt aus dem Perspective-Funnel-HTML ausgelesen.
--   'angenommen' = Classic/unlesbarer Perspective-Funnel → Fallback-Pixel angenommen.
--   NULL         = unbekannt (u. a. Onepage: Pixel steckt im Onepage-Builder, nicht auslesbar).
-- Onepage-Funnels bleiben bei pixel_id = NULL und werden in der Kachel als
-- „Pixel im Onepage-Builder prüfen" markiert. Interne Tool-Funnels bleiben unangetastet.
alter table talentone_funnels add column if not exists pixel_id_quelle text;

-- ── Gelesen: Pixel real aus dem Funnel-HTML ausgelesen ───────────────────────
-- Handwerker-Fallback (682693863186780) feuerte in diesen HTML-Funnels.
update talentone_funnels set pixel_id = '682693863186780', pixel_id_quelle = 'gelesen'
 where perspective_funnel_id in (
   '6aed9c57faf34582f07eb0bf',  -- K & S – Anlagenmechaniker SHK
   '6af4c270025ddd4b5f0f832d',  -- ABS – CNC-Programmierer
   '6a5e568805fc7d04132009ef',  -- Klimapartner – Kältetechnik
   '6af72fbae2a46b9732934f6b',  -- Lewerenz – Monteur SHK
   '6aa416b604872174bad9a086',  -- Schüßler – Monteur Fenster
   '6afcbe248df097e04e00aa7c',  -- Tüpker – Tischler
   '6a845df64b729b9871a98e7e',  -- Wilhelm – Maler
   '6a8487b5878fd7f2f2f9a97c'   -- WohnWin – Fenstermonteur
 );
-- Peters-Kfz feuert den STALE KFZ-Pixel (real ausgelesen) — bewusst so festgehalten.
update talentone_funnels set pixel_id = '867043814427952', pixel_id_quelle = 'gelesen'
 where perspective_funnel_id = '6ace200e482ac27aecc92292';  -- Peters-Kfz – Kfz-Mechaniker
-- Sonnberg (Demo/Draft): im Funnel KEIN Facebook-Pixel.
update talentone_funnels set pixel_id = null, pixel_id_quelle = 'gelesen'
 where perspective_funnel_id = '6a74a6500d636c0130195cff';  -- Sonnberg – Elektroniker (Demo)
-- VReSH: DB-perspective_funnel_id ist stale; die Zeile trägt sie dennoch eindeutig.
-- Am 20.11. auf den SHK-Pixel korrigiert.
update talentone_funnels set pixel_id = '497600425380244', pixel_id_quelle = 'gelesen'
 where perspective_funnel_id = '68f8ea42021d3d003cf934db';  -- VReSH energie

-- ── Angenommen: Classic/unlesbare Perspective-Funnels → Handwerker-Fallback ───
update talentone_funnels set pixel_id = '682693863186780', pixel_id_quelle = 'angenommen'
 where funnel_typ = 'perspective' and perspective_funnel_id in (
   '69e210a394d1544d6036d0d7',  -- Bizjak – Autohelfer
   '69cba996f3b1f2233b9091b2',  -- AST – Servicetechniker
   '68ef7753600f46003c73aca1',  -- AZMET – Pflasterer/Bauhelfer
   '6a02f6c5d5a37ed0bdd34ad1',  -- DOST – Elektroniker
   '691c391611ce4a003cded394',  -- DSL – Servicetechniker
   '6a7d9f328b6d7b5b15b573b6',  -- Klöckner – Anlagenmechaniker SHK
   '689dd357d96520003c496668',  -- Knaak – Fenstermonteur
   '682f2f3a3858fb003b5adfe1',  -- HHPI – Triebfahrzeugführer
   '688761f41c0712003b87d416',  -- Höptner – Asphaltbauer
   '6a719ee00145da67076bd407',  -- Kries – Kundendiensttechniker SHK
   '6a9ee8315d288a215f555a22',  -- Kries – Kundendiensttechniker SHK (2)
   '6ac761e93a2f7197b8d9005c',  -- MOLLI – Gärtner
   '6a16c95646e526209a8e95ab',  -- Rosenberger – Kernbohr/Säge
   '68fb7290ffebfb003ce4e2bf'   -- Schüßler – Monteur Fenster (stale Zweitfunnel)
 );
