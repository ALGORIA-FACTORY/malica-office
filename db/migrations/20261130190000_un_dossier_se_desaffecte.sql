-- ======================================================================
--  Un dossier se désaffecte (5 novembre 2026).
--
--  Relevé sur staging : un dossier affecté à un collaborateur ne pouvait
--  plus redevenir « sans collaborateur ». `collab_assign` remplace une
--  affectation par une autre ; rien ne la retirait. Un collaborateur qui part
--  gardait ses dossiers, et la file du cabinet le disait responsable.
--
--  `collab_desaffecter` : le même contrôle que `collab_assign` (membre et
--  expert du cabinet), l'affectation active close, le journal d'audit.
--  L'historique reste : la ligne close n'est pas effacée (R7).
-- ======================================================================

begin;

create function public.collab_desaffecter(p_cabinet uuid, p_client uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_prev uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;

  update collab.assignments
     set active = false
   where cabinet_tenant_id = p_cabinet and client_tenant_id = p_client and active
  returning id, collaborator_id into v_id, v_prev;
  if v_id is null then
    raise exception 'refus.collab.aucune_affectation' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_cabinet, auth.uid(), 'client.desaffecte', 'collab', 'assignments', v_id,
          jsonb_build_object('client_tenant_id', p_client,
                             'previous_collaborator_id', v_prev));
  return v_id;
end
$$;

comment on function public.collab_desaffecter(uuid, uuid) is
  'Retire l''affectation active d''un dossier : il redevient sans collaborateur (5 novembre 2026).';

alter function public.collab_desaffecter(uuid, uuid) owner to portier;
revoke all on function public.collab_desaffecter(uuid, uuid) from public, anon;
grant execute on function public.collab_desaffecter(uuid, uuid) to authenticated;

commit;
