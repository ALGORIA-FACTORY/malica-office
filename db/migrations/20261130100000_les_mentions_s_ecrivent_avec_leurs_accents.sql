-- ======================================================================
--  Les mentions obligatoires s'écrivent avec leurs accents (staging,
--  5 novembre 2026).
--
--  Le contrôle « Mentions obligatoires » d'une pièce cite `ref.mentions.label`
--  tel quel. Le semis du pack TN 2026.1 (20260824132104) l'avait écrit sans
--  accents : l'expert lisait « Identifiant fiscal de l'emetteur », « Numero
--  sequentiel ininterrompu ». Les libellés traduits (`ref.labels`, fr/en/ar)
--  étaient justes ; seul ce libellé de référence est repris.
--
--  Texte seul : ni code, ni caractère obligatoire, ni référence légale ne
--  change. Littéraux (R11) : le même référentiel, quel que soit le jour.
-- ======================================================================

begin;

update ref.mentions m
   set label = v.juste
  from (values
    ('IDENT_FISCAL_EMETTEUR', 'Identifiant fiscal de l''emetteur',       'Identifiant fiscal de l''émetteur'),
    ('NUMERO_SEQUENTIEL',     'Numero sequentiel ininterrompu',          'Numéro séquentiel ininterrompu'),
    ('DESIGNATION',           'Designation des biens ou services',       'Désignation des biens ou services'),
    ('TAUX_TVA',              'Taux de TVA applique',                    'Taux de TVA appliqué'),
    ('MENTION_EXONERATION',   'Mention d''exoneration ou de suspension', 'Mention d''exonération ou de suspension'),
    ('RETENUE_SOURCE',        'Retenue a la source appliquee',           'Retenue à la source appliquée')
  ) as v(code, ancien, juste)
 where m.code = v.code
   and m.label = v.ancien;

commit;
