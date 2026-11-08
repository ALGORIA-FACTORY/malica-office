-- Un texte qu'aucun calcul ne prouve se lit avec assurance, ou il n'est pas rendu.
--
-- Les chiffres d'une ligne d'articles sont prouvés : q × p = m, et la somme des m ferme
-- le total. Sa désignation ne l'est par rien. Banc sans IA du 4 novembre 2026 : toutes
-- les désignations dont un mot était lu par l'OCR à moins de 0,9 étaient fausses
-- (« كاء قاعة اجتاعات، ف يوم » pour « كراء قاعة اجتماعات، نصف يوم », 7 sur 7), et
-- toutes les justes dépassaient 0,95. Sous le seuil, le moteur tait la désignation ;
-- la ligne et ses chiffres restent.
--
-- Une convention de lecture (comme `lecture.confiance_reserve`), datée et versionnée :
-- elle se change par une ligne de référentiel, jamais dans le code.

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, 'lecture.confiance_du_texte', null, 0.9::numeric,
       'Convention de lecture — sous ce seuil, un texte qu''aucun calcul ne prouve n''est pas rendu',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;
