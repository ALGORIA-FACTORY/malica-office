-- Le journal des affectations du comptable interne est gardé (échecs de la CI de #372).
--
-- 1. RLS forcée : une table de tenant sans `force` est traversée par son propriétaire
--    (schema.test.ts). Le journal reste écrit par son déclencheur, qui appartient au
--    superutilisateur de migration.
-- 2. Le relecteur de nuit (compte de service) ne lit ni n'écrit ce journal : même garde
--    que les autres tables de tenant (`service_hors_perimetre`, 20261118100000).

alter table identity.affectations_comptable force row level security;

drop trigger if exists service_hors_perimetre on identity.affectations_comptable;
create trigger service_hors_perimetre before insert or update or delete on identity.affectations_comptable
  for each statement execute function app.service_hors_perimetre();

drop policy if exists service_hors_perimetre on identity.affectations_comptable;
create policy service_hors_perimetre on identity.affectations_comptable as restrictive for select
  to authenticated using ((select app.service()) is null);
