-- Changer de comptabilité en un seul geste (recette du 11 novembre 2026, 3.2).
--
-- CE QUI ÉTAIT FAUX. Accepter le mandat d'une nouvelle comptabilité
-- était refusé (`refus.mandat.un_seul_actif`) tant que l'ancienne était
-- mandatée : il fallait révoquer d'abord, et la société restait sans
-- comptabilité entre les deux gestes. Règle D2 du 16 octobre 2026 : passage
-- simultané, sans trou.
--
--   `mandat_repondre` reçoit le motif. Quand un autre mandat est actif,
--   accepter met fin à l'ancien PAR LA MÊME PORTE que la révocation
--   (`mandat_revoquer` : réservée au dirigeant, motif exigé, abonnement rendu
--   à la société, l'ancienne prévenue avec le motif, les deux journaux), puis
--   active le nouveau, dans la même transaction : l'ancien finit le jour où le
--   nouveau commence. Le déclencheur `un_mandat_actif_a_la_fois` reste la
--   garde de l'invariant. `mandats_proposes_lire` dit, pour chaque
--   proposition, quelle comptabilité elle remplacerait.
--
-- REJEU (R11) : `drop function if exists` puis `create`, `create or replace`.
-- Aucune donnée de référence n'est écrite.

begin;

-- --- 3.2 Accepter, et quitter l'ancienne dans le même geste ----------------------------
drop function if exists public.mandat_repondre(uuid, boolean);

create or replace function public.mandat_repondre(p_engagement uuid, p_accepte boolean,
                                                  p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_status text;
  v_cabinet text;
  v_pme text;
  v_quitte jsonb;
begin
  select id, pme_org_id, cabinet_org_id, status into v
    from identity.engagements where id = p_engagement;
  if v.id is null or v.pme_org_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.mandat' using errcode = '42501';
  end if;
  if v.status <> 'propose' then
    raise exception 'refus.mandat.deja_repondu' using errcode = '22023';
  end if;

  -- Le passage simultané : l'ancien mandat se termine par la porte de la
  -- révocation, qui exige le dirigeant et le motif, et prévient l'ancienne.
  if p_accepte and exists (select 1 from identity.engagements o
                            where o.pme_org_id = v.pme_org_id and o.status = 'actif'
                              and o.id <> v.id) then
    v_quitte := public.mandat_revoquer(v.pme_org_id, p_motif);
  end if;

  v_status := case when p_accepte then 'actif' else 'termine' end;
  update identity.engagements
     set status = v_status,
         starts_on = case when p_accepte then current_date else starts_on end,
         ends_on = case when p_accepte then null else current_date end
   where id = p_engagement;

  select name into v_cabinet from identity.organizations where id = v.cabinet_org_id;
  select name into v_pme from identity.organizations where id = v.pme_org_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.pme_org_id, auth.uid(),
          case when p_accepte then 'engagement.accepte' else 'engagement.refuse' end,
          'identity', 'engagements', p_engagement,
          jsonb_build_object('cabinet_org_id', v.cabinet_org_id));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_org_id, auth.uid(),
          case when p_accepte then 'engagement.accepte' else 'engagement.refuse' end,
          'identity', 'engagements', p_engagement,
          jsonb_build_object('pme_org_id', v.pme_org_id));
  -- Le cabinet lit les notifications de ses mandats : celle-ci lui dit la réponse.
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.pme_org_id,
          case when p_accepte then 'mandat.accepte' else 'mandat.refuse' end,
          jsonb_build_object('engagement_id', p_engagement, 'cabinet', v_cabinet, 'client', v_pme));

  return jsonb_build_object('id', p_engagement, 'status', v_status,
                            'quitte', v_quitte ->> 'id');
end $$;
revoke all on function public.mandat_repondre(uuid, boolean, text) from public;
grant execute on function public.mandat_repondre(uuid, boolean, text) to authenticated;

-- Chaque proposition dit la comptabilité qu'elle remplacerait : le bouton
-- devient « Accepter et quitter [ancienne] ».
create or replace function public.mandats_proposes_lire(p_pme uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_pme not in (select app.member_orgs()) then
      (select null::jsonb where false)
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id,
               'cabinetTenantId', e.cabinet_org_id,
               'cabinet', c.name,
               'proposeLe', e.created_at,
               'remplace', (select a.name
                              from identity.engagements x
                              join identity.organizations a on a.id = x.cabinet_org_id
                             where x.pme_org_id = p_pme and x.status = 'actif'
                               and x.id <> e.id
                             limit 1))
             order by e.created_at desc)
        from identity.engagements e
        join identity.organizations c on c.id = e.cabinet_org_id
       where e.pme_org_id = p_pme and e.status = 'propose'), '[]'::jsonb)
  end;
$$;

commit;
