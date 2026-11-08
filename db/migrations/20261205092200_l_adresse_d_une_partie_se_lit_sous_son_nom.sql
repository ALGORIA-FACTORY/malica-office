-- L'adresse d'une partie se lit sous son nom, dans son bloc.
--
-- ================================================================== POURQUOI
--
-- 5 novembre 2026, banc sans IA : `adresse_emetteur` et `adresse_client` ne s'étaient
-- jamais lues — 240 cellules muettes. Le repère « Adresse » ne s'imprime presque jamais :
-- l'adresse est la ligne qui suit la raison sociale, dans le bloc de la partie.
--
-- ================================================================== CE QUI CHANGE
--
-- La preuve `parties` gagne `adresse_emetteur` et `adresse_client` : sous le nom que la
-- preuve a placé, la ligne alignée sur son bord gauche, faite de mots, rendue seulement
-- entière (la ligne d'après s'ouvre sur un libellé, ou le bloc s'arrête). Statut
-- `conforme` : rien ne la prouve, elle est citée (`packages/sudoku/src/entete.rs`).
--
-- R10 : défaut livré. REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_preuves p
   set expression = p.expression
                    || jsonb_build_object('adresse_emetteur', 'adresse_emetteur')
                    || jsonb_build_object('adresse_client', 'adresse_client')
 where p.expression ->> 'op' = 'parties'
   and not p.expression ? 'adresse_emetteur'
   and exists (select 1 from ref.grille_champs c
                where c.grille_id = p.grille_id and c.code = 'adresse_emetteur')
   and exists (select 1 from ref.grille_champs c
                where c.grille_id = p.grille_id and c.code = 'adresse_client');

commit;
