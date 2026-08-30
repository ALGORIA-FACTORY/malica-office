create table if not exists agents.model_pricing (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  role text not null check (role in ('reasoner','chat','vision','cache')),
  price_in_per_mtok app.money_t not null,
  price_out_per_mtok app.money_t not null,
  currency text not null default 'USD',
  sovereign boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (provider, model, role, effective_from)
);

grant select on agents.model_pricing to authenticated;
grant all on agents.model_pricing to service_role;
alter table agents.model_pricing enable row level security;
create policy model_pricing_sel on agents.model_pricing for select to authenticated using (true);

insert into agents.model_pricing (provider, model, role, price_in_per_mtok, price_out_per_mtok, sovereign, effective_from)
values
  ('deepseek','deepseek-reasoner','reasoner',0.560,1.680,false,'2026-01-01'),
  ('deepseek','deepseek-chat','chat',0.270,1.100,false,'2026-01-01'),
  ('deepseek','deepseek-chat','cache',0.070,1.100,false,'2026-01-01'),
  ('lovable','google/gemini-2.5-flash','vision',0.300,2.500,false,'2026-01-01')
on conflict do nothing;

create or replace view public.agents_model_pricing_v with (security_invoker = true) as
  select id, provider, model, role, price_in_per_mtok, price_out_per_mtok, currency,
         sovereign, effective_from, effective_to
    from agents.model_pricing;
grant select on public.agents_model_pricing_v to authenticated;

create or replace view public.agent_runs_v with (security_invoker = true) as
  select id, tenant_id, piece_id, agent, model, sovereign, cost, latency_ms,
         tokens_in, tokens_out, status, error, created_by, created_at
    from agents.agent_runs;
grant select on public.agent_runs_v to authenticated;

create or replace function public.agents_run_log(
  p_tenant uuid,
  p_agent text,
  p_model text,
  p_role text,
  p_status text,
  p_latency_ms integer,
  p_tokens_in integer default null,
  p_tokens_out integer default null,
  p_piece uuid default null,
  p_error text default null
) returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_in app.money_t := 0;
  v_out app.money_t := 0;
  v_cost app.money_t := 0;
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
  + (coalesce(p_tokens_out, 0)::numeric / 1000000) * v_out, 3);

  insert into agents.agent_runs (tenant_id, piece_id, agent, model, sovereign, cost,
                                latency_ms, tokens_in, tokens_out, status, error)
  values (p_tenant, p_piece, p_agent, p_model, v_sov, v_cost,
          greatest(coalesce(p_latency_ms, 0), 0), p_tokens_in, p_tokens_out,
          p_status, p_error)
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.agents_run_log(uuid, text, text, text, text, integer, integer, integer, uuid, text) to authenticated;