-- 021 — Perimetre de travail gouverne : 2 PME, 1 cabinet, mandats actifs.
-- Additive : ne modifie aucune migration anterieure. R7 : rien ne s'efface, on archive.

alter table identity.organizations
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text;

-- Journalisation avant archivage (audit append-only ; actor = compte proprietaire)
insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
select o.id,
       coalesce((select id from auth.users where email = 'w.barouni@algoria-factory.com'),
                o.created_by),
       'organization.archived', 'identity', 'organizations', o.id,
       jsonb_build_object('reason', 'tenant de test', 'name', o.name, 'kind', o.kind)
  from identity.organizations o
 where o.archived_at is null
   and (o.name like 'SMOKE%' or o.name = 'Atelier Sidi Bou SARL');

update identity.organizations
   set archived_at = now(),
       archived_reason = 'tenant de test',
       updated_at = now()
 where archived_at is null
   and (name like 'SMOKE%' or name = 'Atelier Sidi Bou SARL');

-- Vue de lecture : seules les organisations actives sont visibles de l'UI
create or replace view public.organizations_v
with (security_invoker = true) as
  select id, kind, name, legal_id, jurisdiction, currency, validation_mode,
         created_by, created_at, updated_at, archived_at, archived_reason
    from identity.organizations
   where archived_at is null;

grant select on public.organizations_v to authenticated;

-- Cabinet de travail + mandats vers les 2 PME actives
do $$
declare
  v_owner uuid;
  v_cab uuid;
  v_pme uuid;
  v_eng uuid;
  v_seq integer;
begin
  select id into v_owner from auth.users where email = 'w.barouni@algoria-factory.com';
  if v_owner is null then
    raise notice 'compte proprietaire absent — cabinet non cree';
    return;
  end if;

  select id into v_cab from identity.organizations
   where kind = 'cabinet' and name = 'ALGORIA CABINET' and archived_at is null;

  if v_cab is null then
    insert into identity.organizations (kind, name, jurisdiction, currency,
                                        validation_mode, created_by)
    values ('cabinet', 'ALGORIA CABINET', 'TN', 'TND', 'mandate', v_owner)
    returning id into v_cab;

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_cab, v_owner, 'organization.created', 'identity', 'organizations', v_cab,
            jsonb_build_object('kind', 'cabinet', 'role', 'expert'));
  end if;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v_cab, v_owner, 'expert')
  on conflict do nothing;

  if not exists (select 1 from identity.entities where tenant_id = v_cab) then
    insert into identity.entities (tenant_id, code, name, is_default)
    values (v_cab, 'SIEGE', 'Siège', true);
  end if;

  for v_pme in
    select o.id from identity.organizations o
     where o.kind = 'pme' and o.archived_at is null
       and exists (select 1 from identity.memberships m
                    where m.tenant_id = o.id and m.user_id = v_owner)
  loop
    select id into v_eng from identity.engagements
     where cabinet_org_id = v_cab and pme_org_id = v_pme;

    if v_eng is null then
      insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on, created_by)
      values (v_pme, v_cab, 'actif', current_date, v_owner)
      returning id into v_eng;
    else
      update identity.engagements set status = 'actif', ends_on = null, updated_at = now()
       where id = v_eng;
    end if;

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_pme, v_owner, 'engagement.status_changed', 'identity', 'engagements', v_eng,
            jsonb_build_object('status', 'actif', 'cabinet_org_id', v_cab));

    if not exists (select 1 from collab.assignments
                    where cabinet_tenant_id = v_cab and client_tenant_id = v_pme and active) then
      select coalesce(max(seq), 0) + 1 into v_seq from collab.assignments
       where cabinet_tenant_id = v_cab and client_tenant_id = v_pme;

      insert into collab.assignments (cabinet_tenant_id, client_tenant_id, collaborator_id,
                                      briefing, active, seq, decided_by)
      values (v_cab, v_pme, v_owner, 'Supervision courante — pièces citées et TVA de la période',
              true, v_seq, v_owner);
    end if;
  end loop;
end $$;