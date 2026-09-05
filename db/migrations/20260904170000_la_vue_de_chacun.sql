-- =====================================================================================
--  Regalica Office — La vue de chacun.
--
--  POURQUOI : un cabinet n'est pas une seule paire d'yeux. L'expert (le chef
--  de cabinet) et le dirigeant voient tous les mandats ; un collaborateur ou
--  un assistant ne voit que les dossiers qui lui sont affectés — « je ne
--  franchis pas cette frontière non plus ». L'opérateur de plateforme (le
--  développeur) voit tout, et l'écran le dit.
--
--  Les rôles existent déjà (identity.memberships.role : dirigeant,
--  collaborateur, expert, assistant). Ce fichier n'en invente pas : il dit ce
--  que chacun voit, en un seul endroit que les lectures du cabinet appellent.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. Qui suis-je, ici ? -------------------------------------------------------------
create or replace function public.mon_acces(p_tenant uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'role', (select m.role from identity.memberships m
              where m.tenant_id = p_tenant and m.user_id = auth.uid()
              limit 1),
    'plateforme', app.is_platform());
$$;

revoke all on function public.mon_acces(uuid) from public, anon;
grant execute on function public.mon_acces(uuid) to authenticated;

-- --- 2. Les mandats que je vois --------------------------------------------------------
-- Tous, si je suis expert ou dirigeant du cabinet, ou opérateur de plateforme ;
-- sinon ceux qui me sont affectés aujourd'hui.
create or replace function app.mandats_visibles(p_cabinet uuid)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id = p_cabinet
     and (
       app.is_platform()
       or exists (select 1 from identity.memberships m
                   where m.tenant_id = p_cabinet and m.user_id = auth.uid()
                     and m.role in ('expert', 'dirigeant'))
       or exists (select 1 from collab.assignments a
                   where a.cabinet_tenant_id = p_cabinet
                     and a.client_tenant_id = e.pme_org_id
                     and a.collaborator_id = auth.uid()
                     and a.active)
     );
$$;

revoke all on function app.mandats_visibles(uuid) from public, anon;
grant execute on function app.mandats_visibles(uuid) to authenticated;
