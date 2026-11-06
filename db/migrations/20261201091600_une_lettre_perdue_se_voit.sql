-- Une lettre que la lecture a perdue se voit : le mot n'est pas un texte rendu.
--
-- ================================================================== POURQUOI
--
-- 5 novembre 2026, banc sans IA, algoria-029 (une photo) : « Clavier AZERTY USB » lu
-- « Claver AZERTY USB ». Chaque caractère émis est sûr (aucun sous 0,8), et « claver » est
-- un mot français : ni la confiance ni le lexique ne le voient. Le décodeur CTC lit l'image
-- tranche par tranche ; entre le v et le e, le blanc l'a emporté, et le i y avait 0,33. Le
-- second lecteur rend désormais, après chaque caractère, la plus forte probabilité d'une
-- AUTRE lettre dans ces tranches blanches (`infra/ocr/service.py`, `_Caracteres`) ; chaque
-- mot garde la plus forte entre ses caractères (`paddle.ts`, `plusForts`).
--
-- ================================================================== CE QUI CHANGE
--
-- `lecture.manque_du_caractere` : au-dessus de ce seuil, une lettre a pu se perdre dans le
-- mot ; un texte qu'aucun calcul ne prouve (une désignation, un nom) qui le porte n'est pas
-- rendu (`packages/sudoku/src/entree.rs`, `Jeton::incertain`). 0,15 : sur les 200
-- désignations justes d'images du banc, le plus fort manque est 0,034 ; « Claver » est à
-- 0,325. Zéro : rien ne se lit au manque.
--
-- Une convention de lecture, datée et versionnée : elle se change par une ligne de
-- référentiel, jamais dans le code.

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, 'lecture.manque_du_caractere', null, 0.15::numeric,
       'Convention de lecture — au-dessus de ce seuil, une lettre a pu se perdre dans le mot',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;
