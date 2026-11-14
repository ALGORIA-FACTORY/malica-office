-- ======================================================================
--  Le comptable interne ouvre l'espace de la comptabilité sur SA société
--  (décision du dirigeant du 12 novembre 2026, point 7 : même espace que la
--  comptabilité externe, sur la seule société qu'il tient).
--
--  Une société tenue en interne n'a pas de mandat : aucune ligne
--  `identity.engagements` ne la rattache à une comptabilité. Par convention
--  (`app.export_mandats`), la comptabilité ET le client sont alors la société
--  elle-même. Cette migration donne à ces lectures une ligne « mandat » pour la
--  société, et à elle seule, quand la personne qui lit en est le comptable
--  interne (`app.dossiers_du_comptable_interne`, déjà borné au droit
--  `livres.tenir`). Rien de nouveau n'est accordé : la ligne ne s'ouvre qu'à
--  qui tient déjà les livres, et ne nomme jamais une autre société.
--
--  1. `app.mandats_du_cabinet(p_cabinet)` : les mandats du cabinet (vue
--     `engagements_v`, sous RLS d'appelant) plus, pour un comptable interne, la
--     société elle-même, en vigueur.
--  2. `app.mandats_visibles(p_cabinet)` reçoit la même ligne : c'est la vue de
--     chacun sur les dossiers d'un cabinet, lue par la file et les comptages.
--
--  Aucune table écrite, aucune politique modifiée (R6, R7). Les dates de
--  validité ne sont pas dans une donnée de référence : ce sont des fonctions.
-- ======================================================================

-- 1. Les mandats du cabinet, comptable interne compris ----------------------

create function app.mandats_du_cabinet(p_cabinet uuid)
returns table (
  cabinet_org_id uuid,
  pme_org_id uuid,
  status text,
  starts_on date,
  ends_on date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.cabinet_org_id, e.pme_org_id, e.status::text, e.starts_on, e.ends_on
    from public.engagements_v e
   where e.cabinet_org_id = p_cabinet
  union all
  -- Le comptable interne : sa société est son propre « mandat », en vigueur,
  -- sans date. Une seule ligne, celle de la société qu'il tient.
  select x, x, 'actif'::text, null::date, null::date
    from app.dossiers_du_comptable_interne() x
   where x = p_cabinet
$$;

revoke all on function app.mandats_du_cabinet(uuid) from public, anon;
grant execute on function app.mandats_du_cabinet(uuid) to authenticated;

-- 2. La vue de chacun sur les dossiers du cabinet ---------------------------
-- Même corps qu'avant, plus la société du comptable interne.

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
     )
  union all
  select x
    from app.dossiers_du_comptable_interne() x
   where x = p_cabinet
$$;

revoke all on function app.mandats_visibles(uuid) from public, anon;
grant execute on function app.mandats_visibles(uuid) to authenticated;
