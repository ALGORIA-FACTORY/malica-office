-- Le cabinet ouvre ses propres comptes, au-dessus du plan livré.
--
-- ========================================================== POURQUOI
--
-- Rebrancher un rôle sur un autre compte ne suffit pas : encore faut-il que le
-- compte existe. Un cabinet qui suit trois clients du bâtiment voudra distinguer
-- ses achats de matériaux par chantier ; NC 01 ne descend pas là, et ce n'est
-- pas son rôle.
--
-- `ref.accounts` est GLOBAL — un pack de juridiction, partagé par tous. Y laisser
-- un cabinet écrire donnerait à chacun le plan de tous. Les comptes ouverts par
-- un cabinet vivent donc à côté, sous RLS, et le plan qu'il voit est la réunion
-- des deux.
--
-- ========================================================== LES QUATRE RÈGLES
--
-- Elles sont tenues par un déclencheur, pas par un écran. Un écran se contourne.
--
--   1. On ne masque pas un compte livré. Rouvrir « 4367 » chez soi ferait
--      diverger deux plans sous le même numéro.
--   2. Un compte se rattache à un parent qui existe — livré, ou ouvert par le
--      même cabinet.
--   3. Un compte PROLONGE son parent : « 6011 » sous « 601 ». C'est la
--      convention de toute nomenclature à niveaux, et sans elle un plan cesse
--      d'être lisible par classe.
--   4. La classe se DÉDUIT du parent. La demander à l'utilisateur, c'est lui
--      offrir de se contredire.

create table if not exists parametrage.accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  account_code  text not null,
  label         text not null,
  parent_code   text not null,
  account_class text not null,
  normal_side   text check (normal_side in ('debit', 'credit')),
  motif         text,
  ouvert_par    uuid not null default auth.uid(),
  ouvert_le     timestamptz not null default now(),
  unique (tenant_id, account_code)
);

comment on table parametrage.accounts is
  'Comptes ouverts par un cabinet, au-dessus du plan livré par le pack. '
  'Jamais visibles par un autre cabinet : la RLS le tient.';

create or replace function parametrage.verifier_compte_cabinet() returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_classe text;
begin
  -- 1. ne pas masquer un compte livré
  if exists (select 1 from ref.accounts a where a.account_code = NEW.account_code) then
    raise exception
      'Le compte % existe déjà dans le plan livré : ouvrez une subdivision (%1, %2…) '
      'plutôt qu''un doublon.', NEW.account_code, NEW.account_code, NEW.account_code
      using errcode = 'unique_violation';
  end if;

  -- 2. le parent existe, livré ou ouvert par ce cabinet
  select a.account_class into v_classe
    from ref.accounts a where a.account_code = NEW.parent_code limit 1;
  if v_classe is null then
    select c.account_class into v_classe
      from parametrage.accounts c
     where c.account_code = NEW.parent_code and c.tenant_id = NEW.tenant_id
     limit 1;
  end if;
  if v_classe is null then
    raise exception
      'Le compte de rattachement % n''existe pas : ni dans le plan livré, ni parmi '
      'vos comptes.', NEW.parent_code
      using errcode = 'foreign_key_violation';
  end if;

  -- 3. un compte prolonge son parent
  if position(NEW.parent_code in NEW.account_code) <> 1
     or length(NEW.account_code) <= length(NEW.parent_code) then
    raise exception
      'Le compte % doit prolonger son rattachement % : « %1 », « %2 », et ainsi de suite.',
      NEW.account_code, NEW.parent_code, NEW.parent_code, NEW.parent_code
      using errcode = 'check_violation';
  end if;

  -- 4. la classe se déduit
  NEW.account_class := v_classe;
  return NEW;
end $$;

drop trigger if exists trg_verifier_compte_cabinet on parametrage.accounts;
create trigger trg_verifier_compte_cabinet
  before insert or update on parametrage.accounts
  for each row execute function parametrage.verifier_compte_cabinet();

select app.enable_tenant_rls('parametrage', 'accounts');

create index if not exists parametrage_accounts_tenant_idx
  on parametrage.accounts (tenant_id, account_code);

-- ------------------------------------------------ le plan tel que le cabinet le voit
--
-- La réunion du livré et du sien. `origine` est la colonne qui compte : elle dit
-- ce qui se modifie et ce qui ne se modifie pas, et c'est elle que l'écran
-- affiche à côté de chaque ligne.
create or replace view public.plan_comptable_v with (security_invoker = true) as
select null::uuid    as tenant_id,
       a.account_code,
       a.label,
       a.parent_code,
       a.account_class,
       a.normal_side,
       case when a.is_official then 'officiel' else 'extension' end as origine,
       a.is_official,
       a.source_ref
  from ref.accounts a
union all
select c.tenant_id,
       c.account_code,
       c.label,
       c.parent_code,
       c.account_class,
       c.normal_side,
       'cabinet' as origine,
       false      as is_official,
       c.motif    as source_ref
  from parametrage.accounts c;

revoke all on public.plan_comptable_v from public, anon, service_role;
grant select on public.plan_comptable_v to authenticated;

-- ------------------------------ le contrôle de classe accepte les comptes du cabinet
--
-- La fonction du paquet ne connaissait que `ref.accounts`. Sur la table de
-- paramétrage, un cabinet doit pouvoir relier un rôle à un compte qu'il a
-- ouvert — mais SEULEMENT là : la table du pack, elle, reste fermée à tout ce
-- qui n'est pas livré.
create or replace function ref.verifier_classe_role() returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  cls int;
  adm int[];
  lib text;
begin
  select a.account_class::int into cls
    from ref.accounts a where a.account_code = NEW.account_code limit 1;

  if cls is null and TG_TABLE_SCHEMA = 'parametrage' then
    select c.account_class::int into cls
      from parametrage.accounts c
     where c.account_code = NEW.account_code and c.tenant_id = NEW.tenant_id
     limit 1;
  end if;

  if cls is null then
    raise exception 'Liaison impossible : le compte % n''existe pas dans le plan comptable.',
      NEW.account_code using errcode = 'foreign_key_violation';
  end if;

  select r.classes_admises, r.libelle into adm, lib
    from ref.account_roles r where r.code = NEW.role_code;

  if not (cls = any(adm)) then
    raise exception
      'Le rôle « % » (%) n''admet que la ou les classes % : le compte % est en classe %.',
      lib, NEW.role_code, adm, NEW.account_code, cls
      using errcode = 'check_violation';
  end if;
  return NEW;
end $$;

-- ------------------------------------- la résolution voit aussi les comptes du cabinet
comment on function ref.compte_du_role(uuid, uuid, text, uuid) is
  'Résout un rôle comptable en compte : dossier, puis cabinet, puis pack. '
  'Le compte rendu peut être livré ou ouvert par le cabinet. Lève plutôt que '
  'de deviner — R4.';
