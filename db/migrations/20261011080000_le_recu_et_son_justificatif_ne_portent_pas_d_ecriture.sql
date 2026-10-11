-- Le reçu et son justificatif : deux types, et aucun ne porte d'écriture.
--
-- ================================================================= POURQUOI
--
-- Le parcours demandé le 10 octobre : après la lecture, Malica demande le
-- moyen de paiement, en prend la photo, et produit un reçu qui part chez le
-- comptable avec la pièce.
--
-- Deux documents naissent donc, et ils n'existent pas encore au référentiel.
--
-- ========================================== LE RISQUE, ET IL EST DE PREMIER ORDRE
--
-- Un PDF qui arrive chez le comptable et qui RESSEMBLE à une pièce
-- justificative sera tôt ou tard comptabilisé. La dépense serait alors comptée
-- deux fois : une fois par la facture, une fois par son reçu.
--
-- Le mécanisme qui l'empêche existe depuis le 2 septembre :
-- `ref.document_types.porte_ecriture`, et sa contrainte « un type qui porte
-- écriture est nécessairement transmissible ». Les deux types nés ici sont
-- donc `porte_ecriture = false` et `transmissible = true` : ils voyagent chez
-- le comptable, et aucune écriture ne peut s'y adosser.
--
-- C'est le point sur lequel je ne cède pas sans instruction explicite.
--
-- ===================================================== POURQUOI DEUX, ET PAS QUATRE
--
-- Un seul type de reçu, pas un pour la dépense et un pour la recette : c'est
-- la même machine, et le sens de la pièce d'origine dit déjà lequel des deux
-- il est. En faire deux les ferait diverger en six semaines.
--
-- Le justificatif de paiement est un type à part, et non une variante du
-- reçu : l'un est PRODUIT par Malica, l'autre est PHOTOGRAPHIÉ par la
-- personne. Ils n'ont ni la même origine, ni la même valeur de preuve, et les
-- confondre ferait croire qu'un reçu auto-produit prouve un paiement.
--
-- ===================================================================== R11
--
-- `ref.document_types` n'a pas de `valid_from` : c'est une table de types,
-- pas de valeurs datées. Aucune date du jour n'est écrite ici — `created_at`
-- est un horodatage technique, que R11 autorise nommément.

insert into ref.document_types
  (code, famille, libelle, fondement, porte_ecriture, transmissible, rang)
values
  ('recu_de_paiement', 'comptable', 'Reçu de paiement',
   'Pièce interne produite par Malica : elle récapitule une pièce et son règlement. '
   'Elle ne porte AUCUNE écriture — la dépense est déjà portée par la pièce d''origine, '
   'et comptabiliser le reçu la compterait deux fois.',
   false, true, 80),

  ('justificatif_paiement', 'comptable', 'Justificatif de paiement',
   'Photo du talon de chèque, du ticket de terminal, de la traite ou de l''avis de virement. '
   'Rattachée à la pièce qu''elle règle, elle prouve le règlement et ne porte aucune écriture '
   'par elle-même.',
   false, true, 81)
on conflict (code) do nothing;

comment on column ref.document_types.porte_ecriture is
  'Peut devenir une écriture comptable. FAUX pour le reçu de paiement et son '
  'justificatif : ils accompagnent une pièce qui, elle, porte déjà la dépense. '
  'Un document transmis au cabinet et comptabilisable une seconde fois est la '
  'façon la plus simple de compter une charge deux fois.';
