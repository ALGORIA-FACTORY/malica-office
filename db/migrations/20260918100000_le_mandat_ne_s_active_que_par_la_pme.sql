-- Un mandat ne s'active que par la PME.
--
-- Le mandat actif est la frontière cabinet ↔ PME : c'est lui qui ouvre au
-- cabinet les pièces partagées de la PME (app.engaged_orgs). Les politiques du
-- 24 août laissaient un expert du CABINET insérer ou mettre à jour un mandat
-- dans n'importe quel état : muni du matricule fiscal d'une PME (imprimé sur
-- chacune de ses factures), il obtenait son identifiant par mandat_proposer,
-- s'écrivait un mandat « actif » par identite.creerMandat (exposé par /rpc), et
-- lisait — y compris après que la PME l'avait terminé. Prouvé le 18 septembre
-- 2026 par apps/api/src/mandat-consentement.test.ts : une pièce partagée lue
-- sans accord, puis relue après terminaison.
--
-- Désormais, côté cabinet, un mandat peut naître proposé, être suspendu ou
-- terminé — jamais écrit actif. La PME (son dirigeant) garde tous ses droits ;
-- les fonctions sous définisseur (mandat_repondre, où la PME dit oui) ne passent
-- pas par ces politiques. Aucune colonne ni aucune donnée ne change.

drop policy if exists engagements_ins on identity.engagements;
create policy engagements_ins on identity.engagements for insert to authenticated
  with check (
    app.has_org_role(pme_org_id, array['dirigeant'])
    or (app.has_org_role(cabinet_org_id, array['expert']) and status <> 'actif')
  );

drop policy if exists engagements_upd on identity.engagements;
create policy engagements_upd on identity.engagements for update to authenticated
  using (app.has_org_role(pme_org_id, array['dirigeant'])
      or app.has_org_role(cabinet_org_id, array['expert']))
  with check (
    app.has_org_role(pme_org_id, array['dirigeant'])
    or (app.has_org_role(cabinet_org_id, array['expert']) and status <> 'actif')
  );
