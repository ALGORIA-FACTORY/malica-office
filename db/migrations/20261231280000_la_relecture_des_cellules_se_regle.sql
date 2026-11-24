-- La relecture des cellules se règle (24 novembre 2026).
--
-- POURQUOI. Le banc sans IA relit, une à une, les cellules d'un tableau quand les
-- totaux de la pièce sont prouvés et que ses lignes ne le sont pas
-- (`apps/api/src/malica/lecture/relecture.ts`, `POST /relire` du service OCR). La
-- production ne le faisait pas : `relireDesCellules` n'était importé que par le banc.
-- Les lignes que le banc prouvait ainsi restaient, sur une vraie pièce, « lues, non
-- vérifiées », et partaient à la relecture de nuit par un autre lecteur, payant.
--
-- CE QUI CHANGE. La lecture d'une image relue par PaddleOCR relit ces cellules aussi,
-- AVANT le Sudoku d'abord et avant que le plan de jetons soit fixé : une valeur citée
-- se relit toujours dans le plan persisté (R2). La relecture n'est retenue que si la
-- pièce reste prouvée, que ses lignes le deviennent, et qu'aucun total prouvé ne
-- change (`sudoku.ts`, `relireLesCellules`). Sinon le plan reste celui du relevé.
--
-- LE RÉGLAGE. `lecture.relecture_cellules` : `active` (défaut livré, R10) ou `coupee`.
-- Le cabinet la coupe sans déploiement, comme la relecture de nuit. Ce n'est pas une
-- règle fiscale : la référence le dit.

insert into ref.reglages_comptables (code, sujet, ordre, nature, porte, applique) values
  ('lecture.relecture_cellules', 'lecture', 4, 'option', 'reglages_comptables', true);

insert into ref.reglages_comptables_options (reglage, code, ordre, applique) values
  ('lecture.relecture_cellules', 'active', 1, true),
  ('lecture.relecture_cellules', 'coupee', 2, true);

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, 'lecture.relecture_cellules', 'active', null,
       'Défaut livré par Malica (pas une règle fiscale). Les cellules d''un tableau que '
       'l''arithmétique contredit sont relues seules par le lecteur de la pièce ; la relecture '
       'n''est retenue que si elle prouve les lignes sans changer un total prouvé.',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1';

insert into ref.labels (ns, key, locale, value) values
  ('reglage_comptable', 'lecture.relecture_cellules', 'fr', 'Relecture des cellules'),
  ('reglage_comptable', 'lecture.relecture_cellules', 'en', 'Cell re-reading'),
  ('reglage_comptable', 'lecture.relecture_cellules', 'ar', 'إعادة قراءة الخانات'),
  ('reglage_comptable_option', 'lecture.relecture_cellules:active', 'fr', 'Active'),
  ('reglage_comptable_option', 'lecture.relecture_cellules:active', 'en', 'On'),
  ('reglage_comptable_option', 'lecture.relecture_cellules:active', 'ar', 'مفعّلة'),
  ('reglage_comptable_option', 'lecture.relecture_cellules:coupee', 'fr', 'Coupée'),
  ('reglage_comptable_option', 'lecture.relecture_cellules:coupee', 'en', 'Off'),
  ('reglage_comptable_option', 'lecture.relecture_cellules:coupee', 'ar', 'موقوفة');
