-- Un opérateur ne s'obtient plus par une adresse (20 octobre 2026).
--
-- FAILLE CORRIGÉE. La migration 20261022210000 faisait opérateur de la
-- plateforme le PREMIER compte créé avec une adresse « attendue ». Or ce
-- produit ne vérifie pas les adresses : n'importe qui pouvait s'inscrire avec
-- lab@ ou operateur@algoria-factory.com avant leur propriétaire et recevoir
-- la tour — grille, paiement, émetteur des factures.
--
-- Le déclencheur disparaît. Les droits déjà accordés à des comptes existants
-- restent ; les attentes non honorées sont closes. Un opérateur se nomme
-- désormais seulement pour un compte qui EXISTE, par migration, comme avant.
--
-- REJEU (R11) : `drop … if exists`, mise à jour idempotente.

begin;

drop trigger if exists operateur_attendu on auth.users;
drop function if exists app.honorer_operateur_attendu();

delete from app.operateurs_attendus where honore_le is null;

comment on table app.operateurs_attendus is
  'Trace des opérateurs nommés par adresse (octobre 2026). N''accorde plus '
  'rien : le déclencheur a été retiré, un compte non vérifié ne pouvant pas '
  'prouver qu''il possède l''adresse.';

commit;
