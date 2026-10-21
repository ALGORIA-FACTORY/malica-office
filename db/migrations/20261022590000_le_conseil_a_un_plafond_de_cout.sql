-- Le conseil a un plafond de coût (ANO-029, campagne du 21 octobre 2026).
--
-- Les lectures sont bornées par le forfait (`lecture_verdict`). Le conseil
-- de Malica — questions, réponses au cabinet, corpus — ne l'était par rien :
-- `agents.budgets` existait, mais rien ne le lisait. Un dossier pouvait
-- interroger le modèle sans fin, à nos frais.
--
-- La règle : un plafond en dollars par organisation et par mois, réglé par la
-- tour (daté, motivé, jamais réécrit), que le plafond propre d'une
-- organisation (`agents.budgets.monthly_cost_cap`, s'il est posé) peut
-- abaisser. Avant chaque appel payant du conseil, la base dit si la dépense
-- du mois le permet ; sinon elle refuse, lisiblement.
--
-- Le coût s'additionne depuis `agents.agent_runs` (tous organes confondus,
-- lectures comprises : c'est la facture réelle du fournisseur). La valeur
-- initiale est volontairement large ; la tour la règle.
-- REJEU (R11) : `if not exists`, `create or replace`.

begin;

create table if not exists plateforme.reglages_ia (
  id                         uuid primary key default gen_random_uuid(),
  plafond_usd_par_org_mois   numeric(12,4) not null check (plafond_usd_par_org_mois >= 0),
  motif                      text not null check (length(btrim(motif)) > 0),
  decide_par                 uuid,
  decide_le                  timestamptz not null default now()
);

comment on table plateforme.reglages_ia is
  'Ce que la tour règle des appels aux modèles : le plafond de dépense par '
  'organisation et par mois (dollars). La dernière décision vaut.';

alter table plateforme.reglages_ia enable row level security;
revoke all on table plateforme.reglages_ia from public, anon;
grant select on table plateforme.reglages_ia to authenticated;

drop policy if exists reglages_ia_lire on plateforme.reglages_ia;
create policy reglages_ia_lire on plateforme.reglages_ia
  for select to authenticated using ((select app.is_platform()));

drop trigger if exists reglages_ia_ne_se_reecrivent_pas on plateforme.reglages_ia;
create trigger reglages_ia_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_ia
  for each row execute function app.deny_mutation();

insert into plateforme.reglages_ia (plafond_usd_par_org_mois, motif, decide_le)
select 10, 'Valeur initiale posée par la migration (ANO-029) : à régler par la tour.',
       timestamptz '2026-10-21 12:00:00+01'
 where not exists (select 1 from plateforme.reglages_ia);

create or replace function plateforme.ia_regler(p_plafond numeric, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_ia (plafond_usd_par_org_mois, motif, decide_par)
  values (p_plafond, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_ia r where r.id = v_id);
end
$$;

revoke all on function plateforme.ia_regler(numeric, text) from public, anon;
grant execute on function plateforme.ia_regler(numeric, text) to authenticated;

-- Le plafond d'une organisation : le réglage de la tour, abaissé par le sien.
create or replace function app.plafond_ia_de(p_tenant uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select least(
    coalesce((select r.plafond_usd_par_org_mois from plateforme.reglages_ia r
               order by r.decide_le desc, r.id desc limit 1), 0),
    coalesce(nullif((select b.monthly_cost_cap from agents.budgets b where b.tenant_id = p_tenant), 0),
             'Infinity'::numeric))
$$;

create or replace function app.depense_ia_du_mois(p_tenant uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.cost), 0)
    from agents.agent_runs r
   where r.tenant_id = p_tenant
     and r.created_at >= date_trunc('month', now())
$$;

-- Internes : seule `conseil_budget_exiger` (qui vérifie l'accès) les appelle.
revoke all on function app.plafond_ia_de(uuid) from public, anon, authenticated;
revoke all on function app.depense_ia_du_mois(uuid) from public, anon, authenticated;

-- Avant un appel payant du conseil : passe, ou refuse en disant pourquoi.
create or replace function public.conseil_budget_exiger(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plafond numeric := app.plafond_ia_de(p_tenant);
  v_depense numeric := app.depense_ia_du_mois(p_tenant);
begin
  if p_tenant not in (select app.member_orgs())
     and p_tenant not in (select app.engaged_orgs())
     and not app.is_platform() then
    raise exception 'organisation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_depense >= v_plafond then
    raise exception 'Le conseil de Malica a atteint son plafond du mois pour ce dossier ; il reprend le mois prochain.'
      using errcode = '22023', hint = 'ia.plafond_atteint';
  end if;
  return jsonb_build_object('depense', v_depense, 'plafond', v_plafond);
end
$$;

revoke all on function public.conseil_budget_exiger(uuid) from public, anon;
grant execute on function public.conseil_budget_exiger(uuid) to authenticated;

commit;
