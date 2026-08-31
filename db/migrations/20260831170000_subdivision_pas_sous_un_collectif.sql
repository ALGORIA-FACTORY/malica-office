-- On ne subdivise pas un compte collectif : on lui attache des tiers.
--
-- 401 Fournisseurs, 411 Clients, 425 Personnel, 442 Associés — quarante-cinq
-- comptes attendent des AUXILIAIRES, pas des subdivisions. Ouvrir 4111 Dupont
-- et 4112 Martin dans le plan général est l'erreur qui coûte le plus cher : à
-- trois cents clients la balance a trois cents lignes de classe 4, et chaque
-- nouveau client devient une modification du plan comptable.
--
-- L'écran le dira, mais l'écran ne suffit pas : la règle est ici.
--
-- Ce qui reste permis, et qui n'est pas la même chose : subdiviser un compte de
-- charge ou de produit — 6011 Achats chantier A sous 601 — ou un compte de
-- tiers NON collectif. La norme laisse ces découpages ouverts, et un cabinet a
-- de bonnes raisons de les vouloir.

create or replace function parametrage.verifier_compte_cabinet() returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_classe    text;
  v_collectif boolean;
  v_libelle   text;
begin
  -- 1. ne pas masquer un compte livré
  if exists (select 1 from ref.accounts a where a.account_code = NEW.account_code) then
    raise exception
      'Le compte % existe déjà dans le plan livré : ouvrez une subdivision (%1, %2…) '
      'plutôt qu''un doublon.', NEW.account_code, NEW.account_code, NEW.account_code
      using errcode = 'unique_violation';
  end if;

  -- 2. le parent existe, livré ou ouvert par ce cabinet
  select a.account_class, a.is_collective, a.label
    into v_classe, v_collectif, v_libelle
    from ref.accounts a where a.account_code = NEW.parent_code limit 1;

  if v_classe is null then
    select c.account_class, false, c.label into v_classe, v_collectif, v_libelle
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

  -- 3. un compte collectif prend des tiers, pas des subdivisions
  if v_collectif then
    raise exception
      'Le compte % (%) est un compte collectif : il reçoit des TIERS, pas des '
      'sous-comptes. Un client ou un fournisseur s''enregistre dans l''onglet '
      'Tiers, et le plan reste lisible.',
      NEW.parent_code, v_libelle
      using errcode = 'check_violation';
  end if;

  -- 4. un compte prolonge son parent
  if position(NEW.parent_code in NEW.account_code) <> 1
     or length(NEW.account_code) <= length(NEW.parent_code) then
    raise exception
      'Le compte % doit prolonger son rattachement % : « %1 », « %2 », et ainsi de suite.',
      NEW.account_code, NEW.parent_code, NEW.parent_code, NEW.parent_code
      using errcode = 'check_violation';
  end if;

  -- 5. la classe se déduit
  NEW.account_class := v_classe;
  return NEW;
end $$;

-- Le caractère collectif rejoint la vue : l'écran doit pouvoir le dire AVANT
-- que l'expert ne tente, plutôt que de le refuser après.
create or replace view public.plan_comptable_v with (security_invoker = true) as
select null::uuid    as tenant_id,
       a.account_code,
       a.label,
       a.parent_code,
       a.account_class,
       a.normal_side,
       case when a.is_official then 'officiel' else 'extension' end as origine,
       a.is_official,
       a.source_ref,
       a.is_collective,
       a.requires_auxiliary
  from ref.accounts a
union all
select c.tenant_id,
       c.account_code,
       c.label,
       c.parent_code,
       c.account_class,
       c.normal_side,
       'cabinet' as origine,
       false     as is_official,
       c.motif   as source_ref,
       false     as is_collective,
       false     as requires_auxiliary
  from parametrage.accounts c;

revoke all on public.plan_comptable_v from public, anon, service_role;
grant select on public.plan_comptable_v to authenticated;
