-- La preuve PARTIELLE d'une facture : son noyau (HT, TVA par taux, TTC hors timbre) se prouve
-- même quand un autre montant de la pièce est faux ou illisible.
--
-- ================================================================== POURQUOI
--
-- 10 novembre 2026, une facture manuscrite sur le staging (pièce ca4ab8f3) : le net à payer
-- « 17851,000 » a été relevé « 17851,200 ». Le HT (15 000,000), la TVA à 19 % (2 850,000) et
-- le TTC (17 850,000) tenaient ensemble ; les deux variantes de la grille exigent le net à
-- payer ou un TTC timbre compris, et rien n'était prouvé.
--
-- Décision du dirigeant (10 novembre 2026) : quand le noyau ferme avec un taux du référentiel,
-- ces montants sont retenus ; le reste est signalé, et la pièce reste « à vérifier ».
--
-- ================================================================== CE QUI CHANGE
--
-- 1. `ref.grille_preuves.partielle` : une preuve peut dire, EN BASE, qu'elle ne prouve qu'une
--    partie de la pièce. Une variante dont une preuve est partielle ne rend jamais la pièce
--    « prouvée » (l'adaptateur le lit ici ; aucun nom de variante n'est écrit dans le code, R4).
-- 2. La preuve M05, variante « noyau », dans chaque grille facture : TTC hors timbre = HT + TVA
--    par taux (+ FODEC), sans le net à payer. Même expression que la preuve d'essai du moteur
--    (packages/sudoku/tests/le_noyau_de_la_facture.rs).
--
-- R4 : aucun taux ici, le barème vient du pack. R10 : défaut livré (`defaut_a_valider`), que
-- l'expertise corrige. REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

alter table ref.grille_preuves
  add column if not exists partielle boolean not null default false;

comment on column ref.grille_preuves.partielle is
  'Vrai : la preuve ne couvre qu''une partie de la pièce. Une variante qui en porte une, '
  'même fermée, ne rend jamais la pièce prouvée : ses champs sortent prouvés, la pièce reste '
  'à vérifier.';

insert into ref.grille_preuves (grille_id, code, regle, genre, expression, statut, variante, partielle)
select g.id, 'M05', 'Total TTC hors timbre = total HT + TVA par taux (+ FODEC), sans le net à payer',
       'arithmetique',
       '{"op": "somme", "role": "ttc", "total": "total_ttc", "parties": ["total_ht", "montant_tva_par_taux", "montant_fodec?"]}'::jsonb,
       'defaut_a_valider', 'noyau', true
  from ref.grilles g
 where g.code = 'facture'
   and not exists (select 1 from ref.grille_preuves x where x.grille_id = g.id and x.code = 'M05');

-- La vue rend la colonne : ajoutée À LA FIN, `create or replace view` refuse tout autre changement.
create or replace view public.ref_grille_preuves_v with (security_invoker = true) as
  select id, grille_id, code, regle, genre, expression, statut, variante, partielle
    from ref.grille_preuves;

do $$
declare n integer;
begin
  select count(*) into n
    from ref.grilles g
    join ref.grille_preuves p on p.grille_id = g.id and p.code = 'M05'
   where g.code = 'facture' and p.variante = 'noyau' and p.partielle;
  if n <> (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : % preuve(s) du noyau, 1 par grille attendue', n;
  end if;
end $$;

commit;
