-- L'avoir se prouve aussi par son taux.
--
-- Banc sans IA du 4 novembre 2026 : trois avoirs sur quatre restaient « ambigus ». Leur
-- seule preuve exécutée, P03 (HT + TVA (+ FODEC) = TTC), admet plusieurs affectations des
-- montants de la page. La TVA d'un avoir à un seul taux, sans FODEC, vaut HT × ce taux :
-- la partie P03b la vérifie. Un avoir à plusieurs taux, ou dont le FODEC entre dans la
-- base (la grille de l'avoir ne déclare pas la charge FODEC, donc pas son assiette), ne
-- ferme pas : il reste ambigu ou muet, jamais faux. Mesuré : a127 prouvé juste (3 champs),
-- a126 reste prouvé.
--
-- R10 : défaut livré (`defaut_a_valider`). REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

insert into ref.grille_preuves (grille_id, code, regle, genre, expression, statut, variante)
select g.id, 'P03b', 'Partie de P03 : TVA = HT × taux du barème (tolérance d''arrondi au millime)',
       'arithmetique', '{"op": "taux", "montant": "montant_tva", "base": "total_ht", "bareme": "tva"}'::jsonb,
       'defaut_a_valider', null
  from ref.grilles g
 where g.code = 'avoir'
   and not exists (select 1 from ref.grille_preuves p where p.grille_id = g.id and p.code = 'P03b');

commit;
