-- Un coût de modèle n'est pas un montant comptable.
--
-- Le prix de l'œil inscrit, la passe de relevé s'est enfin journalisée — et
-- elle a journalisé ZÉRO. Mesuré le 4 octobre 2026 sur une lecture réelle :
--
--   qwen-vl-ocr-2025-11-20 · 2 180 jetons en entrée, 473 en sortie
--   coût réel     0,00022828 USD
--   coût inscrit  0.000
--
-- La cause n'est pas l'arrondi de la fonction seule : `agents.agent_runs.cost`
-- et les variables de `public.agents_run_log` portent `app.money_t`, qui vaut
-- `numeric(38,3)`. Trois décimales, parce qu'un dinar tunisien a mille
-- millimes — c'est la bonne définition pour un montant, et 85 colonnes en
-- dépendent. On n'y touche pas.
--
-- Mais un coût de modèle n'est pas un montant comptable. Il se compte en
-- millionièmes de dollar par jeton, et il s'additionne sur des milliers
-- d'appels. À trois décimales il faut 7 143 jetons d'entrée pour qu'un relevé
-- atteigne 0,001 : chaque appel s'inscrit à zéro, et la SOMME de zéros reste
-- zéro. Dix mille lectures coûteraient près de 2,30 USD sans qu'aucune ligne
-- ne le montre, et `agents.budgets` ne pourrait border qu'une dépense qu'il
-- croit nulle.
--
-- D'où un type à part, qui dit ce qu'il mesure. Huit décimales : le coût exact
-- d'un appel y entre sans arrondi visible, et la somme reste juste.
--
-- Les prix unitaires, eux, restent en `app.money_t` : 0,07 USD par million de
-- jetons s'écrit sans perte à trois décimales.

create domain app.cout_modele_t as numeric(38, 8);

comment on domain app.cout_modele_t is
  'Coût d''un appel de modèle. Huit décimales, parce qu''il se compte en '
  'millionièmes de dollar et s''additionne sur des milliers d''appels — '
  'contrairement à app.money_t, qui mesure un montant comptable en millimes.';

-- `public.agent_runs_v` expose la table aux lectures applicatives et dépend de
-- la colonne : PostgreSQL refuse d'en changer le type tant qu'elle existe. On
-- la repose à l'identique juste après — `security_invoker` compris, sans quoi
-- la vue lirait avec les droits de son propriétaire et contournerait la RLS.
drop view public.agent_runs_v;

alter table agents.agent_runs
  alter column cost type app.cout_modele_t;

create view public.agent_runs_v with (security_invoker = true) as
  select id, tenant_id, piece_id, agent, model, sovereign, cost,
         latency_ms, tokens_in, tokens_out, status, error, created_by, created_at
    from agents.agent_runs;

grant select on public.agent_runs_v to authenticated;

-- La fonction, à l'identique, sauf le type des variables de calcul et la
-- précision de l'arrondi. `create or replace` conserve les droits accordés.
create or replace function public.agents_run_log(
  p_tenant uuid, p_agent text, p_model text, p_role text, p_status text,
  p_latency_ms integer, p_tokens_in integer default null, p_tokens_out integer default null,
  p_piece uuid default null, p_error text default null)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_in app.money_t := 0;
  v_out app.money_t := 0;
  v_cost app.cout_modele_t := 0;
  v_sov boolean := false;
  v_id uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'organisation non autorisee' using errcode = '42501';
  end if;

  select price_in_per_mtok, price_out_per_mtok, sovereign
    into v_in, v_out, v_sov
    from agents.model_pricing
   where model = p_model and role = p_role
     and effective_from <= current_date
     and (effective_to is null or effective_to >= current_date)
   order by effective_from desc
   limit 1;

  if v_in is null then
    raise exception 'aucun tarif en vigueur pour le modele % (role %)', p_model, p_role
      using errcode = 'check_violation';
  end if;

  v_cost := round(
    (coalesce(p_tokens_in, 0)::numeric / 1000000) * v_in
  + (coalesce(p_tokens_out, 0)::numeric / 1000000) * v_out, 8);

  insert into agents.agent_runs (tenant_id, piece_id, agent, model, sovereign, cost,
                                latency_ms, tokens_in, tokens_out, status, error)
  values (p_tenant, p_piece, p_agent, p_model, v_sov, v_cost,
          greatest(coalesce(p_latency_ms, 0), 0), p_tokens_in, p_tokens_out,
          p_status, p_error)
  returning id into v_id;

  return v_id;
end $function$;
