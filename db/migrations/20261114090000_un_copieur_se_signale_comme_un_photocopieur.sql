-- Un copieur se signale comme un photocopieur (1er novembre 2026).
--
-- ================================================================= LE DÉFAUT
--
-- Recette, cas 071 du jeu synthétique : l'achat d'un photocopieur de
-- 10 200 TND partait en charge (605, la nature « petit équipement » de
-- l'article), sans la réserve « immobilisation à trancher ». La désignation
-- imprimée (« Photocopieur multifonction A3 ») est reconnue par
-- `ref.biens_immobilisables` et porte la réserve ; son synonyme courant,
-- « Copieur multifonction A3 », ne l'était pas : `photocopieu…` exige le
-- préfixe. Un copieur partait donc en charge en silence, quel que soit son
-- montant (épreuve : `les-reglages-comptables-du-cabinet.test.ts`).
--
-- ================================================================== LA RÈGLE
--
-- Le même bien, le même signal : « copieur(s) », « copieuse(s) », mot borné,
-- dans la famille des photocopieurs (INFORMATIQUE). Rien d'autre n'est
-- ajouté : « multifonction » seul désigne aussi une imprimante, que le
-- référentiel range en petit équipement — ce n'est pas clairement un bien
-- immobilisable, et un mot ne se devine pas.
--
-- INCERTAIN (à confirmer par un expert-comptable), comme toute la liste
-- (20261107090000) : elle signale, elle ne décide pas.
--
-- REJEU (R11) : `valid_from` pris sur `effective_from` du pack ; aucune date
-- du jour ; `on conflict do nothing` sur la clé.

begin;

insert into ref.biens_immobilisables
  (pack_version_id, motif, famille, langue, incertain, source, valid_from)
select p.id, '(?<!\p{L})copieu(r|rs|se|ses)(?!\p{L})', 'INFORMATIQUE', 'fr', true,
       'Liste INCERTAINE complétée le 1er novembre 2026 (recette, cas 071 : un copieur partait '
       'en charge sans réserve) : elle signale, elle ne décide pas. À confirmer par un '
       'expert-comptable au regard de la norme comptable tunisienne des immobilisations '
       'corporelles.',
       p.effective_from
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
on conflict do nothing;

commit;
