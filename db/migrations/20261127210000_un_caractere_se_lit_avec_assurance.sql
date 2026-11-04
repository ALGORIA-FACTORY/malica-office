-- Un mot dont un caractère est lu sans assurance n'est pas un texte rendu.
--
-- ================================================================== POURQUOI
--
-- 4 novembre 2026, banc sans IA, algoria-032 (une photo) : « Souris optique sans fil »,
-- le mot « fil » sous une tache, lu « sans fi » — la ligne à 0,98, deux lectures qui
-- s'accordent. La confiance d'une ligne est la MOYENNE des probabilités de ses
-- caractères : un caractère lu à 0,69 s'y noie. Le second lecteur rend désormais la
-- probabilité de chaque caractère (`infra/ocr/service.py`, `_Caracteres`) ; chaque mot
-- garde celle de son caractère le moins sûr (`apps/api/src/malica/lecture/paddle.ts`).
--
-- ================================================================== CE QUI CHANGE
--
-- `lecture.confiance_du_caractere` : sous ce seuil, le caractère le moins sûr d'un mot le
-- rend incertain, et un texte qu'aucun calcul ne prouve (une désignation, un nom) qui le
-- porte n'est pas rendu (`packages/sudoku/src/entree.rs`, `Jeton::incertain`).
--
-- Une convention de lecture, datée et versionnée, comme `lecture.confiance_du_texte` :
-- elle se change par une ligne de référentiel, jamais dans le code.

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, 'lecture.confiance_du_caractere', null, 0.8::numeric,
       'Convention de lecture — sous ce seuil, le caractère le moins sûr d''un mot le rend incertain',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;
