-- Le prix d'une ligne peut s'imprimer TTC : la grille facture le déclare.
--
-- ================================================================== POURQUOI
--
-- 2 novembre 2026, une photo de facture MyTek : la colonne des prix est
-- « PU TTC » (32,000), celle des montants est HT (26,891), au taux de la ligne
-- (19 %). La preuve des lignes (L01) ne connaissait qu'un prix unitaire HT :
-- 1 × 32,000 ≠ 26,891, aucune ligne ne fermait, et les quantités restaient
-- « non indiquées ». La pièce n'est pas une exception : le commerce de détail
-- tunisien imprime souvent ses prix TTC.
--
-- ================================================================== CE QUI CHANGE
--
-- 1. Le concept « prix unitaire TTC » (`ref.concepts`), à côté du prix HT.
-- 2. Le champ `prix_unitaire_ttc` dans chaque grille facture, ses repères
--    (« PU TTC »…), facultatif.
-- 3. La preuve L01 nomme ce champ (`prix_ttc`) : le moteur ferme alors aussi
--    une rangée par q × PU TTC ÷ (1 + taux) = montant HT, le taux étant l'un
--    du barème de la grille (`packages/sudoku/src/lignes.rs`). Sans la clé,
--    rien ne change.
--
-- R4 : aucun taux ici, le barème vient du pack. R10 : défauts livrés
-- (`defaut_a_valider`), que l'expertise corrige. REJEU (R11) : aucune horloge
-- n'écrit dans `ref`.

begin;

insert into ref.concepts (pack_version_id, code, libelle, expert, porte_sur_une_partie, statut,
                          valid_from, valid_to)
select k.pack_version_id, 'prix_unitaire_ttc', 'Prix unitaire toutes taxes comprises', k.expert,
       k.porte_sur_une_partie, 'defaut_a_valider', k.valid_from, k.valid_to
  from ref.concepts k
 where k.code = 'prix_unitaire_ht'
   and not exists (select 1 from ref.concepts x
                    where x.pack_version_id = k.pack_version_id and x.code = 'prix_unitaire_ttc');

insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut, concept_id, role)
select c.grille_id, c.parcelle, 'prix_unitaire_ttc', 'Prix unitaire toutes taxes comprises',
       c.type, 'non', null,
       array['PU TTC', 'P.U. TTC', 'P.U TTC', 'Prix unitaire TTC', 'Prix TTC']::text[],
       '{}'::text[], null, c.groupe, 'pratique', 'pratique', 'defaut_a_valider', k.id, c.role
  from ref.grille_champs c
  join ref.grilles g on g.id = c.grille_id and g.code = 'facture'
  join ref.concepts k on k.pack_version_id = g.pack_version_id and k.code = 'prix_unitaire_ttc'
 where c.code = 'prix_unitaire_ht'
   and not exists (select 1 from ref.grille_champs x
                    where x.grille_id = c.grille_id and x.code = 'prix_unitaire_ttc');

update ref.grille_preuves p
   set expression = p.expression || '{"prix_ttc": "prix_unitaire_ttc?"}'::jsonb
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'facture'
   and p.expression ->> 'op' = 'lignes'
   and not (p.expression ? 'prix_ttc');

do $$
declare n integer;
begin
  select count(*) into n
    from ref.grilles g
    join ref.grille_champs c on c.grille_id = g.id and c.code = 'prix_unitaire_ttc'
    join ref.grille_preuves p on p.grille_id = g.id and p.expression ->> 'op' = 'lignes'
                              and p.expression ->> 'prix_ttc' = 'prix_unitaire_ttc?'
   where g.code = 'facture';
  if n <> (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : % grille(s) avec le prix TTC déclaré, 1 par grille attendu', n;
  end if;
end $$;

commit;
