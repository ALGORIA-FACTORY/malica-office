-- Le cabinet tient aussi les tiers du dossier (ANO-CAB-014, 21 octobre 2026).
--
-- Même famille qu'ANO-008 (20261022490000) : l'expert du cabinet engagé sur
-- la société ne pouvait créer ni fournisseur, ni client, ni salarié — les
-- politiques d'écriture de `tiers.auxiliaires` ne s'ouvraient qu'aux membres
-- de la société. La table n'a pas de colonne `vis` : un auxiliaire est une
-- donnée du dossier, lisible de la société comme du cabinet.
-- La suppression reste à la société.
-- REJEU (R11) : `drop policy if exists`.

begin;

drop policy if exists tiers_auxiliaires_ins_cabinet on tiers.auxiliaires;
create policy tiers_auxiliaires_ins_cabinet on tiers.auxiliaires for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs_as_expert()));

drop policy if exists tiers_auxiliaires_upd_cabinet on tiers.auxiliaires;
create policy tiers_auxiliaires_upd_cabinet on tiers.auxiliaires for update to authenticated
  using (tenant_id in (select app.engaged_orgs_as_expert()))
  with check (tenant_id in (select app.engaged_orgs_as_expert()));

commit;
