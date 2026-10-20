-- Révoquer le mandat rend l'abonnement à la PME (20 octobre 2026).
--
-- Décision : à la révocation, l'abonnement attribué par le cabinet passe à la
-- PME, avertie ; le cabinet cesse de payer le jour même (prorata). L'accès du
-- cabinet se termine (`revocation_client`), une proposition en attente tombe,
-- et la PME reçoit `acces.repris` avec son offre. Rien d'autre ne change.
-- REJEU (R11) : `create or replace`.

begin;

CREATE OR REPLACE FUNCTION public.mandat_revoquer(p_tenant uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le dirigeant revoque le mandat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'Dites pourquoi : la comptabilité lira ce motif.' using errcode = '22023';
  end if;

  select e.id, e.cabinet_org_id
    into v
    from identity.engagements e
   where e.pme_org_id = p_tenant and e.status = 'actif'
   order by e.created_at desc
   limit 1
   for update;

  if v.id is null then
    raise exception 'Aucun mandat actif sur ce dossier.' using errcode = '22023';
  end if;

  update identity.engagements
     set status = 'termine', ends_on = current_date
   where id = v.id;

  -- L'abonnement attribué par ce cabinet passe à la PME, le jour même
  -- (décision du 20 octobre 2026) : l'accès se termine, la licence reste la
  -- sienne, le cabinet cesse d'être payeur. Une proposition en attente tombe.
  update facturation.acces a
     set statut = 'termine', effet_au = current_date, motif_fin = 'revocation_client'
   where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
     and a.statut in ('actif', 'suspendu');
  update facturation.acces a
     set statut = 'termine',
         licence_id = (select lo.licence_id from facturation.licence_organisations lo
                        where lo.tenant_id = p_tenant),
         effet_du = current_date, effet_au = current_date, motif_fin = 'revocation_client'
   where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
     and a.statut = 'propose';
  if found or exists (select 1 from facturation.acces a
                       where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
                         and a.effet_au = current_date and a.motif_fin = 'revocation_client') then
    -- La PME est avertie : son abonnement continue, à sa charge, au prix public.
    insert into collab.notifications (tenant_id, kind, payload)
    values (p_tenant, 'acces.repris',
            jsonb_build_object('cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                               'offre', (select f.offre_code from facturation.forfait_courant_v f
                                           join facturation.licence_organisations lo on lo.licence_id = f.licence_id
                                          where lo.tenant_id = p_tenant)));
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'engagement.revoque', 'identity', 'engagements', v.id,
          jsonb_build_object('cabinet_org_id', v.cabinet_org_id, 'motif', btrim(p_motif)));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_org_id, auth.uid(), 'engagement.revoque', 'identity', 'engagements', v.id,
          jsonb_build_object('pme_org_id', p_tenant, 'motif', btrim(p_motif)));

  insert into collab.notifications (tenant_id, kind, payload)
  values (p_tenant, 'mandat.revoque',
          jsonb_build_object('engagement_id', v.id, 'motif', btrim(p_motif),
                             'cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                             'client', (select name from identity.organizations where id = p_tenant)));

  -- Le cabinet aussi l'apprend, chez LUI : la notification du dossier client
  -- lui devient invisible à l'instant où le mandat se termine.
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.cabinet_org_id, 'mandat.revoque',
          jsonb_build_object('engagement_id', v.id, 'motif', btrim(p_motif),
                             'pme_org_id', p_tenant,
                             'cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                             'client', (select name from identity.organizations where id = p_tenant)));

  return jsonb_build_object('id', v.id, 'statut', 'termine', 'le', current_date);
end
$function$;

commit;
