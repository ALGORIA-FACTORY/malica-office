-- L'exonération PARTIELLE se prouve par les lignes.
--
-- ================================================================== POURQUOI
--
-- Staging, 2 novembre 2026 : 50/14 (agence de voyages, fictive) n'est pas prouvée.
-- Deux billets d'avion à 0 % (« Le transport aérien international est exonéré de
-- TVA ») et des frais de service à 19 % : Total HT 3 370,000, « TVA 19 % (base
-- 80,000) » 15,200, timbre 1,000, TTC 3 386,200. L'OCR a tout lu. Mais P03 exige
-- Σ bases par taux = total HT, et la seule base taxée (80,000) n'en est qu'une
-- part : aucune affectation ne ferme. L'exonération (`exoneration`) n'admet que
-- ZÉRO instance.
--
-- ================================================================== CE QUI CHANGE
--
-- `groupe_taux` gagne une clé facultative, `exoneration_partielle` (booléen), qui
-- n'a de sens qu'avec `exoneration` (la mention). Le moteur admet alors, la
-- mention lue, des instances dont CHAQUE base est imprimée, en lectures fortes,
-- et dont la somme est une part stricte du total HT. Le reste, exonéré, n'est
-- imprimé nulle part : la pièce n'est prouvée que si les lignes l'établissent
-- (lues sans cellule déduite ni remise globale ; Σ montants = total HT ;
-- Σ montants par taux = base imprimée de ce taux). Sinon elle est rendue à la
-- chaîne. Contrat : `docs/sudoku/contrat-du-moteur.md`, §2.
--
-- R10 : défaut livré (`defaut_a_valider`), comme la preuve qu'il complète.
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_preuves p
   set expression = p.expression || '{"exoneration_partielle": true}'::jsonb
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'facture' and p.code = 'P03'
   and p.expression ->> 'op' = 'groupe_taux'
   and p.expression ? 'exoneration';

do $$
declare n integer;
begin
  select count(*) into n from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where g.code = 'facture' and p.code = 'P03' and (p.expression -> 'exoneration_partielle') = 'true'::jsonb;
  if n <> (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : % preuve(s) P03 à exonération partielle, 1 par grille attendue', n;
  end if;
end $$;

commit;
