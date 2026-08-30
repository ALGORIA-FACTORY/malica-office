-- Les quatre dernières politiques à appel nu — celles écrites à la main.
--
-- Le rejeu du helper n'a corrigé que ce que le helper avait produit. Quatre
-- politiques de `identity` sont antérieures et rédigées à la main ; elles
-- portaient le même défaut. Je les ai lues avant d'y toucher, une par une :
-- toutes en SELECT, toutes `to authenticated`, toutes sans `with check`, toutes
-- terminées par `or app.is_platform()`.
--
-- La transformation est mécanique et conserve la sémantique — un appel enveloppé
-- rend la même valeur, il est simplement évalué une fois au lieu d'une fois par
-- ligne. Aucun prédicat n'est ajouté, retiré ni réordonné.
--
-- `memberships_sel` gagne une enveloppe de plus, sur `auth.uid()` : c'est le même
-- défaut, à la même place, pour la même raison. La règle automatisée ne vise que
-- `app.*` ; s'arrêter à ce que le test attrape aurait laissé le reste.

-- --------------------------------------------------------------- engagements
drop policy if exists engagements_sel on identity.engagements;
create policy engagements_sel on identity.engagements
  for select to authenticated
  using (
    pme_org_id in (select app.member_orgs())
    or cabinet_org_id in (select app.member_orgs())
    or (select app.is_platform())
  );

-- --------------------------------------------------------------- invitations
drop policy if exists invitations_sel on identity.invitations;
create policy invitations_sel on identity.invitations
  for select to authenticated
  using (
    tenant_id in (select app.member_orgs())
    or (select app.is_platform())
  );

-- -------------------------------------------------------------- rattachements
drop policy if exists memberships_sel on identity.memberships;
create policy memberships_sel on identity.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or tenant_id in (select app.member_orgs())
    or (select app.is_platform())
  );

-- ------------------------------------------------------------- organisations
drop policy if exists organizations_sel on identity.organizations;
create policy organizations_sel on identity.organizations
  for select to authenticated
  using (
    id in (select app.member_orgs())
    or id in (select app.engaged_orgs())
    or (select app.is_platform())
  );
