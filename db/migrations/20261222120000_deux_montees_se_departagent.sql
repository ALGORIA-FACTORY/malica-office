-- Deux montées d'une même transaction se départagent (recette du 13 novembre
-- 2026 : `la-montee-pendant-l-annee`, test 3).
--
-- `facturation.annuel_de` retient la montée en vigueur par
-- `order by le desc, created_at desc limit 1`, et `annuel_monter` comme les deux
-- émissions (`emission_de_la_licence`, `emission_du_titulaire`) s'appuient sur
-- le même couple. `created_at` valait `now()`, figé pendant toute la
-- transaction : deux montées du même jour passées dans la même transaction
-- portaient le même instant, et la ligne retenue dépendait de l'ordre physique
-- de la table — le prix couvert par l'année se lisait tantôt Team, tantôt
-- Premium, et la facture du mois portait ou non 15 € de « places et sociétés en
-- plus » selon l'âge de la base.
--
-- Un instant par montée : `clock_timestamp()`. Aucune fonction n'est réécrite,
-- les quatre lectures deviennent déterministes d'un seul geste. Un défaut de
-- colonne est du schéma (R11) ; les montées déjà inscrites ne bougent pas.
alter table facturation.engagement_montees
  alter column created_at set default clock_timestamp();
