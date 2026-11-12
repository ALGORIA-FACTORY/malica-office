-- ======================================================================
--  L'expert invité ne lit que les invitations qui le nomment (revue CI de #369).
--
--  La politique de lecture `invitations_sel_expert_invite`, ajoutée par
--  20261221110000, ne se cadrait ni sur le tenant ni sur une fonction du
--  tenant : `schema.test.ts` (« aucune politique de table de tenant n'est
--  inconditionnelle ») la signale à juste titre. Elle se cadre désormais sur
--  les SOCIÉTÉS qui ont invité l'adresse de la personne, par une fonction
--  `security definer` qui ne rend que ces identifiants.
--
--  La clause `with check` de la politique de mise à jour appelait
--  `app.mon_email()` sans enveloppe : elle est réécrite en `(select …)`.
--
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

create function app.tenants_invites_comptable()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.tenant_id
    from identity.invitations i
   where i.role = 'expert'
     and lower(i.email) = lower(coalesce((select app.mon_email()), ''))
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;
revoke all on function app.tenants_invites_comptable() from public;
grant execute on function app.tenants_invites_comptable() to authenticated;

drop policy invitations_sel_expert_invite on identity.invitations;
create policy invitations_sel_expert_invite on identity.invitations
  for select to authenticated
  using (tenant_id in (select app.tenants_invites_comptable()));

drop policy invitations_upd_expert_invite on identity.invitations;
create policy invitations_upd_expert_invite on identity.invitations
  for update to authenticated
  using (role = 'expert' and app.invitation_expert_ouverte(tenant_id))
  with check (role = 'expert'
              and lower(email) = lower(coalesce((select app.mon_email()), '')));
