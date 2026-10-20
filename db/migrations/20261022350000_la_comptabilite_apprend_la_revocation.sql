-- La comptabilité apprend la révocation chez elle (20 octobre 2026).
--
-- Recette : à la révocation d'un mandat par la PME, AUCUNE notification
-- n'apparaissait chez le cabinet. Elle était inscrite au dossier du client,
-- que le cabinet ne voit plus dès que le mandat se termine.
--
-- `mandat_revoquer` inscrit désormais la même notification dans le tenant du
-- cabinet. Corps repris de la base vivante ; seul cet ajout change.
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
