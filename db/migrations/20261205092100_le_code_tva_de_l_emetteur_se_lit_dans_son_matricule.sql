-- Le code TVA, la catégorie et l'établissement de l'émetteur se lisent dans son matricule.
--
-- ================================================================== POURQUOI
--
-- 5 novembre 2026, banc sans IA : le champ `code_tva_categorie_etablissement` (« A/M/000 »)
-- ne s'était jamais lu — 120 cellules muettes. Il ne s'imprime presque jamais seul : il
-- est la fin du matricule fiscal de l'émetteur (« 2815004Q/A/M/000 »), que la preuve des
-- parties établit.
--
-- ================================================================== CE QUI CHANGE
--
-- La preuve `parties` gagne `groupes_emetteur` : le champ qui reçoit les groupes qui
-- suivent la lettre de contrôle du matricule de l'émetteur, au même statut que lui, cités
-- sur les mêmes jetons (`packages/sudoku/src/entete.rs`). Le noyau se mesure par la règle
-- de la lettre (`ref.identifiant_controles`) ; aucun groupe n'est écrit dans le moteur.
--
-- R10 : défaut livré. REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_preuves p
   set expression = p.expression || '{"groupes_emetteur": "code_tva_categorie_etablissement"}'::jsonb
 where p.expression ->> 'op' = 'parties'
   and not p.expression ? 'groupes_emetteur'
   and exists (select 1 from ref.grille_champs c
                where c.grille_id = p.grille_id and c.code = 'code_tva_categorie_etablissement');

do $$
begin
  if exists (select 1 from ref.grille_preuves p
              where p.expression ->> 'op' = 'parties'
                and exists (select 1 from ref.grille_champs c
                             where c.grille_id = p.grille_id
                               and c.code = 'code_tva_categorie_etablissement')
                and not p.expression ? 'groupes_emetteur') then
    raise exception 'une preuve des parties ignore le code TVA de l''émetteur';
  end if;
end $$;

commit;
