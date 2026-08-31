-- Les tiers : le grand livre auxiliaire, que le référentiel réclamait sans l'avoir.
--
-- ========================================================== LE MANQUE
--
-- Quarante-cinq comptes du plan portent `is_collective` et `requires_auxiliary` —
-- 401 Fournisseurs, 411 Clients, 425 Personnel, 442 Associés, 453 Organismes
-- sociaux. Vingt rôles déclarent la nature de leur auxiliaire : client,
-- fournisseur, salarie, associe, compte_bancaire.
--
-- Le référentiel disait donc « ce compte exige un auxiliaire », et rien ne
-- pouvait en tenir un. Une facture fournisseur ne savait pas dire QUEL
-- fournisseur.
--
-- ========================================================== LE BON NIVEAU
--
-- Un tiers appartient au DOSSIER, jamais au cabinet. « DREAM OPTIC » est un
-- client de la PME A ; ses créances figurent dans les livres de la PME A, et la
-- PME B n'a rien à y voir. Rattacher les tiers au cabinet mélangerait les
-- balances auxiliaires de plusieurs entreprises et ferait tomber le mur de
-- visibilité.
--
-- Le cabinet les saisit pour le compte de son client — la RLS de mandat le lui
-- permet — mais il ne les possède pas.
--
-- ========================================================== POURQUOI PAS DES COMPTES
--
-- Ouvrir 4111 Dupont, 4112 Martin dans le plan général est l'erreur qui coûte
-- le plus cher : à trois cents clients la balance a trois cents lignes de
-- classe 4, et chaque nouveau client devient une modification du plan comptable.
-- Un tiers est un AUXILIAIRE du compte collectif, pas une subdivision de lui.

create schema if not exists tiers;
comment on schema tiers is
  'Le grand livre auxiliaire : clients, fournisseurs, salariés, associés, '
  'comptes bancaires, rattachés à leur compte collectif.';

grant usage on schema tiers to authenticated;
revoke all on schema tiers from public, anon;

create table if not exists tiers.auxiliaires (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.organizations(id) on delete cascade,
  entity_id          uuid references identity.entities(id) on delete set null,
  nature             text not null check (nature in
                       ('client', 'fournisseur', 'salarie', 'associe', 'compte_bancaire')),
  -- Le code auxiliaire, celui que la balance affiche à côté du collectif.
  code               text not null,
  raison_sociale     text not null,
  identifiant_fiscal text,
  -- Le compte collectif auquel il se rattache : 411, 401, 425, 442…
  compte_collectif   text not null,
  actif              boolean not null default true,
  note               text,
  cree_par           uuid not null default auth.uid(),
  cree_le            timestamptz not null default now(),
  unique (tenant_id, nature, code)
);

comment on table tiers.auxiliaires is
  'Un tiers est un auxiliaire de son compte collectif, jamais une subdivision '
  'du plan. Il appartient au dossier, pas au cabinet qui le saisit.';

-- ------------------------------------------------ la règle, tenue par la base
--
-- Un auxiliaire ne se rattache qu'à un compte COLLECTIF. Le rattacher à 606 ou
-- à 701 n'aurait aucun sens comptable, et l'écran ne doit pas être le seul à le
-- savoir.
create or replace function tiers.verifier_compte_collectif() returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_collectif boolean;
  v_libelle   text;
begin
  select a.is_collective, a.label into v_collectif, v_libelle
    from ref.accounts a where a.account_code = NEW.compte_collectif limit 1;

  -- Un cabinet peut avoir subdivisé un collectif : la subdivision hérite du
  -- caractère collectif de son parent.
  if v_collectif is null then
    select a.is_collective, c.label into v_collectif, v_libelle
      from parametrage.accounts c
      join ref.accounts a on a.account_code = c.parent_code
     where c.account_code = NEW.compte_collectif
       and c.tenant_id = NEW.tenant_id
     limit 1;
  end if;

  if v_collectif is null then
    raise exception 'Le compte % n''existe pas dans le plan.', NEW.compte_collectif
      using errcode = 'foreign_key_violation';
  end if;

  if not v_collectif then
    raise exception
      'Le compte % (%) n''est pas un compte collectif : un tiers ne peut s''y '
      'rattacher. Choisissez un compte de tiers — 401, 411, 425, 442…',
      NEW.compte_collectif, v_libelle
      using errcode = 'check_violation';
  end if;

  return NEW;
end $$;

drop trigger if exists trg_verifier_compte_collectif on tiers.auxiliaires;
create trigger trg_verifier_compte_collectif
  before insert or update on tiers.auxiliaires
  for each row execute function tiers.verifier_compte_collectif();

-- ------------------------------------------------------------------- la RLS
--
-- Par le helper. Le mandat ouvre la lecture au cabinet : c'est lui qui saisit.
select app.enable_tenant_rls('tiers', 'auxiliaires');

create index if not exists tiers_auxiliaires_tenant_idx
  on tiers.auxiliaires (tenant_id, nature, code);

create or replace view public.tiers_v with (security_invoker = true) as
select id, tenant_id, entity_id, nature, code, raison_sociale, identifiant_fiscal,
       compte_collectif, actif, note, cree_par, cree_le
  from tiers.auxiliaires;

revoke all on public.tiers_v from public, anon, service_role;
grant select, insert, update, delete on public.tiers_v to authenticated;

-- ------------------------------------- les comptes qui acceptent un auxiliaire
--
-- Servie à l'écran pour ne proposer que ce qui a un sens, et au lecteur pour
-- savoir où rattacher ce qu'il vient de lire.
create or replace view public.comptes_collectifs_v with (security_invoker = true) as
select account_code, label, account_class, requires_auxiliary
  from ref.accounts
 where is_collective
 order by account_code;

revoke all on public.comptes_collectifs_v from public, anon, service_role;
grant select on public.comptes_collectifs_v to authenticated;
