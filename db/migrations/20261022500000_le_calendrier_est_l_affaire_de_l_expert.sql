-- Le calendrier du cabinet est l'affaire de l'expert (21 octobre 2026).
--
-- Campagne de validation du 21 octobre, ANO-012, suite de 20261022490000 :
-- après les reports d'échéance, le calendrier lui-même — quelles obligations
-- s'appliquent, avec quel rappel, et les obligations propres du cabinet. Un
-- collaborateur le consulte ; l'écran ne lui propose plus de le régler.
-- REJEU (R11) : `drop policy if exists`, `create or replace`.

begin;

-- Le calendrier lui-même — quelles obligations s'appliquent, avec quel
-- rappel, et les obligations propres du cabinet — est aussi la décision de
-- l'expert. Des politiques RESTRICTIVES s'ajoutent à celles des membres :
-- toutes doivent passer.
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['obligations_cabinet', 'obligations_propres'] loop
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on collab.%I', t || '_' || op || '_expert', t);
      if op = 'insert' then
        execute format(
          'create policy %I on collab.%I as restrictive for insert to authenticated
             with check (app.has_org_role(tenant_id, array[''expert'']))',
          t || '_' || op || '_expert', t);
      else
        execute format(
          'create policy %I on collab.%I as restrictive for %s to authenticated
             using (app.has_org_role(tenant_id, array[''expert'']))',
          t || '_' || op || '_expert', t, op);
      end if;
    end loop;
  end loop;
end $$;

create or replace function public.cabinet_obligation_definir(p_cabinet uuid, p_code text, p_exercice integer, p_secteur text, p_active boolean, p_rappel integer)
returns jsonb
language plpgsql
set search_path = ''
as $function$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'Seul l''expert du cabinet règle le calendrier.' using errcode = '42501';
  end if;
  insert into collab.obligations_cabinet (tenant_id, obligation_code, exercice, secteur, active, rappel_jours)
  values (p_cabinet, p_code, p_exercice, p_secteur, p_active, p_rappel)
  on conflict (tenant_id, obligation_code, exercice, secteur) do update
    set active = excluded.active, rappel_jours = excluded.rappel_jours,
        updated_by = auth.uid(), updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.obligation_reglee', 'collab', 'obligations_cabinet', p_cabinet,
          jsonb_build_object('code', p_code, 'exercice', p_exercice, 'secteur', p_secteur,
                             'active', p_active, 'rappel', p_rappel));
  return jsonb_build_object('active', p_active, 'rappelJours', p_rappel);
end $function$;

commit;
