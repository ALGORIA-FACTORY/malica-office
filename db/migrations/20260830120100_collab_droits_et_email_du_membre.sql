-- Le même trou, ailleurs : collaboration et adresses des membres.
--
-- L'inventaire des vues `security_invoker` dont une table de base refuse la
-- lecture à `authenticated` rend huit lignes. Cinq sont dans `ref` et font
-- l'objet de la migration précédente. Voici les trois autres — et il n'y en a
-- pas d'ailleurs : `identity`, `capture`, `socle`, `immo`, `stocks`, `banque`
-- et `audit` sont intacts.

-- ------------------------------------------------------------- collaboration
--
-- Ici les politiques existaient déjà, et sont restées lettre morte faute du
-- droit de table : `assignments_sel_cabinet`, `assignments_ins_cabinet`,
-- `assignments_upd_cabinet`, `pv_sel_cabinet`, `pv_ins_cabinet`. On n'accorde
-- donc que ce qu'une politique encadre déjà — pas une opération de plus.
--
-- L'écriture compte autant que la lecture : `public.collab_assign` n'est pas
-- `security definer` et insère sous l'identité de l'appelant.
revoke all on table collab.assignments, collab.pv_reunions from public, anon, service_role;
grant select, insert, update on table collab.assignments to authenticated;
grant select, insert on table collab.pv_reunions to authenticated;

-- ---------------------------------------------------- membres d'un cabinet
--
-- `cabinet_members_v` joint `auth.users` pour l'adresse électronique. Accorder
-- la lecture de cette table serait le pire des remèdes : elle ne porte aucune
-- RLS et contient `encrypted_password`. Chaque utilisateur y gagnerait
-- l'annuaire complet de la plateforme.
--
-- L'adresse passe donc par une fonction qui ne rend rien d'autre, et seulement
-- pour un utilisateur partageant une organisation avec l'appelant. Le mur reste
-- porté par la base (R6), pas par la vue qui l'interroge.
create or replace function app.email_du_membre(p_user uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.email::text
    from auth.users u
   where u.id = p_user
     and exists (
       select 1
         from identity.memberships m
        where m.user_id = p_user
          and m.tenant_id in (select app.member_orgs())
     )
$$;

revoke all on function app.email_du_membre(uuid) from public, anon, service_role;
grant execute on function app.email_du_membre(uuid) to authenticated;

create or replace view public.cabinet_members_v with (security_invoker = true) as
select m.tenant_id,
       m.user_id,
       m.role,
       app.email_du_membre(m.user_id) as email
  from identity.memberships m
 where m.tenant_id in (select app.member_orgs());
