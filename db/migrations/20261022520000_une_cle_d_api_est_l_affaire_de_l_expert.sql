-- Une clé d'API est l'affaire de l'expert (21 octobre 2026).
--
-- Campagne de validation, ANO-035 : un collaborateur du cabinet créait et
-- révoquait les clés d'API — des accès machine au nom de tout le cabinet.
-- Des politiques RESTRICTIVES s'ajoutent à celles des membres : créer,
-- modifier (révoquer) ou supprimer une clé exige le rôle d'expert. La
-- lecture de la liste reste aux membres.
-- REJEU (R11) : `drop policy if exists`.

begin;

drop policy if exists api_keys_insert_expert on identity.api_keys;
create policy api_keys_insert_expert on identity.api_keys as restrictive
  for insert to authenticated
  with check (app.has_org_role(tenant_id, array['expert']));

drop policy if exists api_keys_update_expert on identity.api_keys;
create policy api_keys_update_expert on identity.api_keys as restrictive
  for update to authenticated
  using (app.has_org_role(tenant_id, array['expert']));

drop policy if exists api_keys_delete_expert on identity.api_keys;
create policy api_keys_delete_expert on identity.api_keys as restrictive
  for delete to authenticated
  using (app.has_org_role(tenant_id, array['expert']));

commit;
