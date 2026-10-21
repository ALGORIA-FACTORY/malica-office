-- L'affectation et la lecture se gardent en base (21 octobre 2026).
--
-- Campagne de validation du 21 octobre 2026, deux critiques :
--
--   ANO-001 — un collaborateur s'auto-affectait n'importe quel dossier mandaté
--   du cabinet : `public.collab_assign` (security invoker) et la politique
--   d'insertion de `collab.assignments` ne vérifiaient que l'appartenance au
--   cabinet. Or `app.engaged_orgs()` (0.2.43) donne la LECTURE d'un dossier dès
--   qu'une affectation active existe : la règle « un collaborateur ne voit que
--   ses dossiers » se défaisait d'un appel. Affecter est désormais un geste de
--   l'expert, en fonction ET en politique.
--
--   ANO-002 — une PME écrivait elle-même une lecture inventée (extraction,
--   citations, jetons), décomptait son quota hors lecture, journalisait des
--   appels de modèle et des messages « de Malica ». L'API ne sert plus ces
--   méthodes au client (`rpc.ts`, RESERVEES_AU_SERVEUR) ; la base double la
--   garde : sous une identité d'utilisateur, ces écritures exigent la marque
--   `malica.origine = 'serveur'`, posée par le seul serveur, locale à la
--   transaction. Les connexions d'administration (migrations, outils, tests
--   d'intégration sans identité) ne portent pas de claim et ne sont pas
--   concernées.
--
-- REJEU (R11) : `create or replace`, `drop … if exists`.

begin;

-- 1. Affecter est un geste de l'expert ----------------------------------------------
create or replace function public.collab_assign(
  p_cabinet uuid, p_client uuid, p_user uuid, p_briefing text default null
) returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_seq integer;
  v_prev uuid;
  v_id uuid;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet non autorise' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'seul l''expert du cabinet affecte un dossier' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.memberships m
                  where m.tenant_id = p_cabinet and m.user_id = p_user) then
    raise exception 'le collaborateur n''est pas membre du cabinet'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'aucun mandat actif avec ce client' using errcode = 'check_violation';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from collab.assignments
   where cabinet_tenant_id = p_cabinet and client_tenant_id = p_client;

  update collab.assignments
     set active = false
   where cabinet_tenant_id = p_cabinet and client_tenant_id = p_client and active
  returning collaborator_id into v_prev;

  insert into collab.assignments (cabinet_tenant_id, client_tenant_id, collaborator_id,
                                  briefing, active, seq, decided_by)
  values (p_cabinet, p_client, p_user, p_briefing, true, v_seq, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_cabinet, auth.uid(), 'client.affecte', 'collab', 'assignments', v_id,
          jsonb_build_object('client_tenant_id', p_client, 'collaborator_id', p_user,
                             'previous_collaborator_id', v_prev, 'briefing', p_briefing,
                             'seq', v_seq));

  return v_id;
end $function$;

-- La politique tient la même règle : une insertion ou une mise à jour directe
-- ne contourne pas la fonction.
drop policy if exists assignments_ins_cabinet on collab.assignments;
create policy assignments_ins_cabinet on collab.assignments
  for insert to authenticated
  with check (cabinet_tenant_id in (select app.member_orgs())
              and app.has_org_role(cabinet_tenant_id, array['expert']));
drop policy if exists assignments_upd_cabinet on collab.assignments;
create policy assignments_upd_cabinet on collab.assignments
  for update to authenticated
  using (cabinet_tenant_id in (select app.member_orgs())
         and app.has_org_role(cabinet_tenant_id, array['expert']))
  with check (cabinet_tenant_id in (select app.member_orgs())
              and app.has_org_role(cabinet_tenant_id, array['expert']));

-- 2. La lecture s'écrit côté serveur -------------------------------------------------
create or replace function app.exiger_origine_serveur()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  -- Sous l'identité d'un utilisateur (claim `sub` posé par l'API), seule une
  -- transaction ouverte par le serveur pour sa propre chaîne peut écrire ici.
  if coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
     and coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'reserve au serveur : %.%', tg_table_schema, tg_table_name
      using errcode = '42501';
  end if;
  return new;
end $function$;
revoke all on function app.exiger_origine_serveur() from public, anon;

drop trigger if exists extractions_origine_serveur on capture.extractions;
create trigger extractions_origine_serveur before insert on capture.extractions
  for each row execute function app.exiger_origine_serveur();
drop trigger if exists citations_origine_serveur on capture.citations;
create trigger citations_origine_serveur before insert on capture.citations
  for each row execute function app.exiger_origine_serveur();
drop trigger if exists token_plan_origine_serveur on capture.token_plan;
create trigger token_plan_origine_serveur before insert on capture.token_plan
  for each row execute function app.exiger_origine_serveur();
drop trigger if exists lectures_origine_serveur on facturation.lectures;
create trigger lectures_origine_serveur before insert on facturation.lectures
  for each row execute function app.exiger_origine_serveur();
drop trigger if exists agent_runs_origine_serveur on agents.agent_runs;
create trigger agent_runs_origine_serveur before insert on agents.agent_runs
  for each row execute function app.exiger_origine_serveur();
drop trigger if exists conversation_messages_origine_serveur on agents.conversation_messages;
create trigger conversation_messages_origine_serveur before insert on agents.conversation_messages
  for each row execute function app.exiger_origine_serveur();
drop trigger if exists executions_origine_serveur on fabrique.executions;
create trigger executions_origine_serveur before insert on fabrique.executions
  for each row execute function app.exiger_origine_serveur();

commit;
