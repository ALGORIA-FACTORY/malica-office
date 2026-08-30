-- Les droits qui manquaient.
--
-- Six vues publiques étaient inatteignables par un utilisateur authentifié :
-- la vue existait, le droit de la lire existait, mais la table sous-jacente
-- n'accordait rien. Comme ces vues sont en `security_invoker`, la lecture
-- s'arrêtait sur un 42501 — « droit refusé pour la table ... ».
--
-- Ce n'est pas une régression : rien n'a été retiré. Cinq tables de `ref` et
-- deux de `collab` n'ont simplement jamais reçu le traitement que leurs sœurs
-- ont reçu dans la migration du 25 août. Les écrans qui en dépendent — stocks,
-- charges, collaboration — ne pouvaient donc pas fonctionner.
--
-- Le défaut a été trouvé en exécutant chaque lecture des dépôts portés contre
-- le schéma réel (`apps/api/src/depots.test.ts`).

-- --------------------------------------------------------------- référentiel
--
-- Données de référence, sans tenant : la politique est « tout authentifié
-- lit », exactement comme pour `ref.immo_categories` et `ref.socle_params`.
--
-- On révoque de `public` et de `anon` — l'exposition réelle. On ne touche pas
-- à `service_role` : le durcir est une décision à part, et `ref_fiscal_charges_v`
-- est encore lue côté serveur par le flux de lecture des pièces.
do $$
declare
  t text;
begin
  foreach t in array array[
    'stock_categories', 'charge_familles', 'charge_famille_rules',
    'anomaly_thresholds', 'fiscal_charges'
  ] loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon', t);
    execute format('grant select on table ref.%I to authenticated', t);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'ref' and tablename = t and policyname = 'ref_' || t || '_sel'
    ) then
      execute format(
        'create policy %I on ref.%I for select to authenticated using (true)',
        'ref_' || t || '_sel', t);
    end if;
  end loop;
end $$;

-- -------------------------------------------------------------- collaboration
--
-- Ici les politiques existaient déjà — et sont restées lettre morte faute du
-- droit de table. Le mur reste tenu par elles : on n'accorde que ce qu'une
-- politique encadre déjà (sélection et écriture pour les affectations, dont la
-- fonction `collab_assign` n'est pas `security definer` et écrit donc sous
-- l'identité de l'appelant ; sélection et insertion pour les procès-verbaux).
grant select, insert, update on table collab.assignments to authenticated;
grant select, insert on table collab.pv_reunions to authenticated;
revoke all on table collab.assignments, collab.pv_reunions from public, anon;

-- ---------------------------------------------------- membres d'un cabinet
--
-- `cabinet_members_v` joignait `auth.users` pour l'adresse électronique. Lui
-- ouvrir cette table serait le pire des remèdes : `auth.users` ne porte aucune
-- RLS et contient `encrypted_password`. Un droit de lecture y donnerait à
-- chaque utilisateur l'annuaire complet de la plateforme.
--
-- L'adresse passe donc par une fonction qui ne rend rien d'autre, et seulement
-- pour un utilisateur qui partage une organisation avec l'appelant. Le mur
-- reste porté par la base (R6), pas par la vue qui l'interroge.
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

revoke all on function app.email_du_membre(uuid) from public, anon;
grant execute on function app.email_du_membre(uuid) to authenticated;

create or replace view public.cabinet_members_v with (security_invoker = true) as
select m.tenant_id,
       m.user_id,
       m.role,
       app.email_du_membre(m.user_id) as email
  from identity.memberships m
 where m.tenant_id in (select app.member_orgs());
