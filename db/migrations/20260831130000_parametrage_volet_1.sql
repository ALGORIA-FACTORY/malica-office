-- Volet 1 — le paramétrage du cabinet, et la résolution qui le rend vivant.
--
-- ========================================================== CE QUI MANQUAIT
--
-- Le paquet apporte `tenant_role_bindings` : une surcharge de liaison rôle →
-- compte, par cabinet ou par dossier. C'est exactement la couche que R10 exige
-- et dont je constatais l'absence hier.
--
-- Elle arrivait cependant hors doctrine, et sur trois points :
--
--   — dans `public`, sans schéma métier ;
--   — SANS RLS. Une table qui porte `tenant_id` et vit hors du mur de
--     visibilité est le seul défaut qui ne se rattrape pas : un cabinet lisant
--     le paramétrage d'un autre y lit son plan de comptes, donc sa structure ;
--   — sans index menant par `tenant_id`, alors que chaque lecture le filtrera.
--
-- Et surtout : **rien ne résolvait**. La surcharge existait, personne ne la
-- consultait. Une couche de paramétrage que le moteur n'interroge pas est une
-- table, pas un paramétrage.
--
-- ========================================================== L'ORDRE DE RÉSOLUTION
--
--   1. ce que le DOSSIER a arrêté     (le plus précis gagne)
--   2. ce que le CABINET a arrêté
--   3. le défaut livré par le pack     (ref.role_bindings)
--
-- Trois niveaux, pas deux : un cabinet fixe sa règle maison, et un dossier
-- particulier peut s'en écarter — une filiale sous un autre régime, un client
-- repris d'un autre cabinet avec son historique.
--
-- La fonction REFUSE plutôt que de deviner. Un rôle sans liaison à aucun des
-- trois niveaux lève une exception : c'est R4, et c'est la seule réponse
-- acceptable quand la question est « sur quel compte j'écris ».

create schema if not exists parametrage;
comment on schema parametrage is
  'Volet 1 du paramétrage : ce que le cabinet et ses dossiers arrêtent, '
  'au-dessus des défauts livrés par le pack de juridiction.';

-- ------------------------------------------------ 1. la table, sous doctrine
create table if not exists parametrage.role_bindings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  portee       text not null check (portee in ('cabinet', 'dossier')),
  portee_id    uuid not null,
  role_code    text not null references ref.account_roles(code),
  account_code text not null,
  -- Qui a décidé, quand, et pourquoi. R10 exige qu'on puisse répondre à « qui a
  -- arrêté ce compte » sans lire un historique.
  motif        text,
  decide_par   uuid not null default auth.uid(),
  decide_le    timestamptz not null default now(),
  unique (portee, portee_id, role_code)
);

comment on table parametrage.role_bindings is
  'Surcharge de la liaison rôle -> compte, arrêtée par l''expert. '
  'Résolution : dossier, puis cabinet, puis le défaut du pack.';

-- La reprise de l'ancienne table, si elle porte déjà des décisions.
do $$
begin
  if to_regclass('public.tenant_role_bindings') is not null then
    insert into parametrage.role_bindings (tenant_id, portee, portee_id, role_code, account_code)
    select tenant_id, portee, portee_id, role_code, account_code
      from public.tenant_role_bindings
    on conflict (portee, portee_id, role_code) do nothing;
    drop table public.tenant_role_bindings;
  end if;
end $$;

-- Le contrôle de classe du paquet vaut ici aussi : un rôle « état » ne se relie
-- pas à un compte de produit, quel que soit le cabinet qui le demande.
drop trigger if exists trg_classe_role_parametrage on parametrage.role_bindings;
create trigger trg_classe_role_parametrage
  before insert or update on parametrage.role_bindings
  for each row execute function ref.verifier_classe_role();

-- ------------------------------------------------------------- 2. la RLS
--
-- Par le helper, comme les 41 autres : ni politique écrite à la main, ni
-- exception. Le cabinet écrit son paramétrage, le mandat le laisse lire.
select app.enable_tenant_rls('parametrage', 'role_bindings');

-- Menant par tenant_id : chaque lecture le filtre.
create index if not exists parametrage_role_bindings_tenant_idx
  on parametrage.role_bindings (tenant_id, portee, portee_id);

-- --------------------------------------------------- 3. la vue publique
create or replace view public.parametrage_role_bindings_v
  with (security_invoker = true) as
select id, tenant_id, portee, portee_id, role_code, account_code,
       motif, decide_par, decide_le
  from parametrage.role_bindings;

revoke all on public.parametrage_role_bindings_v from public, anon, service_role;
grant select, insert, update, delete on public.parametrage_role_bindings_v to authenticated;

-- ------------------------------------------------- 4. la résolution
--
-- `stable` et non `volatile` : le planificateur peut la hisser. `security
-- definer` avec chemin figé, parce qu'elle lit `ref.role_bindings`, que
-- l'appelant n'a pas à connaître.
create or replace function ref.compte_du_role(
  p_tenant    uuid,
  p_dossier   uuid,
  p_role      text,
  p_pack      uuid
) returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_compte text;
begin
  -- 1. le dossier
  select account_code into v_compte
    from parametrage.role_bindings
   where portee = 'dossier' and portee_id = p_dossier and role_code = p_role;
  if v_compte is not null then return v_compte; end if;

  -- 2. le cabinet
  select account_code into v_compte
    from parametrage.role_bindings
   where portee = 'cabinet' and portee_id = p_tenant and role_code = p_role;
  if v_compte is not null then return v_compte; end if;

  -- 3. le défaut livré
  select account_code into v_compte
    from ref.role_bindings
   where pack_version_id = p_pack and role_code = p_role;
  if v_compte is not null then return v_compte; end if;

  raise exception
    'Aucun compte n''est relié au rôle « % » : ni pour ce dossier, ni pour ce '
    'cabinet, ni dans le pack. Le paramétrage doit trancher avant d''écrire.',
    p_role
    using errcode = 'no_data_found';
end $$;

revoke all on function ref.compte_du_role(uuid, uuid, text, uuid) from public, anon;
grant execute on function ref.compte_du_role(uuid, uuid, text, uuid) to authenticated;

comment on function ref.compte_du_role(uuid, uuid, text, uuid) is
  'Résout un rôle comptable en compte : dossier, puis cabinet, puis pack. '
  'Lève plutôt que de deviner — R4.';
