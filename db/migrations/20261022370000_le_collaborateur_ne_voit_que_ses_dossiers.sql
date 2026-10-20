-- Le collaborateur ne voit que ses dossiers (20 octobre 2026).
--
-- Recette de la comptabilité : la file d'un collaborateur sans affectation
-- était vide, mais il ouvrait une pièce non affectée par son adresse. La file
-- filtrait ; la base, non : `app.engaged_orgs()` rendait TOUS les dossiers
-- mandatés du cabinet à tout membre du cabinet.
--
-- Désormais : l'expert-comptable voit tous les dossiers mandatés de son
-- cabinet ; tout autre membre (collaborateur, assistant) ne voit que les
-- dossiers qui lui sont AFFECTÉS (`collab.assignments`, actif). Toutes les
-- politiques qui lisent `app.engaged_orgs()` suivent d'un coup.
--
-- Index : la recherche se fait par (collaborateur, cabinet, client).
-- REJEU (R11) : `create or replace`, `create index if not exists`.

begin;

create index if not exists assignments_collaborateur_idx
  on collab.assignments (collaborator_id, cabinet_tenant_id, client_tenant_id)
  where active;

create or replace function app.engaged_orgs()
returns setof uuid
language sql
stable security definer
set search_path = ''
as $function$
  select e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id in (select app.member_orgs())
     and e.status = 'actif'
     and e.starts_on <= current_date
     and (e.ends_on is null or e.ends_on >= current_date)
     and (
       app.has_org_role(e.cabinet_org_id, array['expert'])
       or exists (select 1 from collab.assignments a
                   where a.cabinet_tenant_id = e.cabinet_org_id
                     and a.client_tenant_id = e.pme_org_id
                     and a.collaborator_id = auth.uid()
                     and a.active)
     )
$function$;

commit;
