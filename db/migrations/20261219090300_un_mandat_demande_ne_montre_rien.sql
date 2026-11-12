-- Une comptabilité qui a seulement DEMANDÉ un mandat ne voit rien de la
-- société (recette du 11 novembre 2026, 3.3).
--
-- CE QUI ÉTAIT FAUX. `clients_du_cabinet_etat` rendait, pour un mandat
-- seulement PROPOSÉ, ce que seul un mandat accepté autorise : la présence du
-- dirigeant et son nom (« a rejoint »), l'invitation en cours — fût-elle d'une
-- autre comptabilité —, l'adresse, la licence et ses places. Désormais un
-- mandat proposé ne rend que ce que la comptabilité a elle-même posé (son
-- abonnement proposé) ; le reste est vide, et l'écran dit « mandat demandé ·
-- en attente de la société ».
--
-- REJEU (R11) : `create or replace`, même signature. Rien n'est daté.

begin;

-- --- 3.3 Un mandat demandé ne montre rien de la société --------------------------------
create or replace function public.clients_du_cabinet_etat(p_cabinet uuid)
returns table (tenant_id uuid, adresse text, dirigeant_present boolean, invitation_email text,
               invitation_envoyee timestamptz, invitation_expiree boolean, acces_id uuid,
               acces_statut text, acces_offre text, descente_offre text, licence_id uuid,
               titulaire_nom text, forfait_offre text, organisations integer,
               organisations_incluses integer, sieges_occupes integer, sieges_inclus integer,
               places_en_attente integer)
language sql
stable
security definer
set search_path = ''
as $$
  -- `m` : le mandat est accepté. Sans lui, rien de la société ne sort — ni
  -- son dirigeant, ni ses invitations, ni sa licence. Seul reste ce que la
  -- comptabilité a posé elle-même (son abonnement proposé).
  select o.id,
         case when m then o.adresse end,
         m and exists (select 1 from identity.memberships ms
                        where ms.tenant_id = o.id and ms.role = 'dirigeant'),
         case when m then inv.email end,
         case when m then inv.created_at end,
         case when m then inv.expires_at <= now() end,
         a.id, a.statut, a.offre_code,
         case when m then (select d.offre_code from facturation.acces_descentes d
                            where d.tenant_id = o.id and d.statut = 'propose') end,
         case when m then lo.licence_id end,
         case when m then coalesce(nullif(trim(p.display_name), ''), u.email::text) end,
         case when m then dv.offre_code end,
         case when m then dv.organisations::int end,
         case when m then dv.organisations_incluses::int end,
         case when m then dv.sieges_occupes::int end,
         case when m then dv.sieges_inclus::int end,
         case when m then (select count(*)::int from identity.invitations i
                            where i.tenant_id = o.id and i.role <> 'dirigeant'
                              and i.accepted_at is null and i.revoked_at is null
                              and i.expires_at > now())
              else 0 end
    from identity.engagements e
    cross join lateral (select e.status = 'actif' as m) mm(m)
    join identity.organizations o on o.id = e.pme_org_id and o.archived_at is null
    left join lateral (
      select i.email, i.created_at, i.expires_at
        from identity.invitations i
       where i.tenant_id = o.id and i.accepted_at is null and i.revoked_at is null
         and i.role = 'dirigeant'
       order by i.created_at desc limit 1
    ) inv on true
    left join lateral (
      select x.id, x.statut, x.offre_code
        from facturation.acces x
       where x.tenant_id = o.id and x.cabinet_tenant_id = p_cabinet and x.statut <> 'termine'
       limit 1
    ) a on true
    left join facturation.licence_organisations lo on lo.tenant_id = o.id
    left join facturation.licences l on l.id = lo.licence_id
    left join identity.profiles p on p.user_id = l.titulaire
    left join auth.users u on u.id = l.titulaire
    left join facturation.droits_v dv on dv.licence_id = lo.licence_id
   where e.cabinet_org_id = p_cabinet
     and e.status in ('propose', 'actif')
     and app.has_org_role(p_cabinet, array['expert', 'collaborateur', 'assistant'])
     and e.pme_org_id in (select app.mandats_visibles(p_cabinet))
$$;

commit;
