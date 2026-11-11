-- « Parler à Malica » a un débit : tant de questions par minute, tant par jour, par personne.
--
-- Relevé le 10 novembre 2026 : aucune limite ne protégeait /malica (seul /auth
-- en avait une). Une personne — ou un script sous son compte — pouvait poser
-- des questions en rafale, chacune payante, jusqu'au plafond du mois.
--
-- R4 : les deux bornes vivent ici, versionnées, réglables depuis la tour sans
-- déploiement. La dernière décision vaut ; rien ne se réécrit. Les valeurs
-- livrées sont un DÉFAUT (R10) : dix questions par minute, deux cents par jour.
-- Le quota par offre (« tant de questions selon le forfait ») est un arbitrage
-- commercial : il se posera par-dessus, quand le dirigeant l'aura tranché.
--
-- Deux mécanismes, parce qu'ils ne voient pas la même chose :
--   — la rafale (par minute) se compte au serveur d'application, en mémoire :
--     des appels simultanés ne sont pas encore rangés en base ;
--   — le quota du jour se compte ici, sur les questions rangées au fil.
-- `assistant_debit_exiger` rend les bornes au serveur et refuse au-delà du jour.
--
-- R11 : le défaut est daté en littéral.

begin;

create table if not exists plateforme.assistant_debits (
  id          uuid primary key default gen_random_uuid(),
  par_minute  integer not null check (par_minute between 1 and 600),
  par_jour    integer not null check (par_jour between 1 and 100000),
  motif       text not null check (length(btrim(motif)) > 0),
  decide_par  uuid references auth.users (id),
  decide_le   timestamptz not null default now()
);

comment on table plateforme.assistant_debits is
  'Le débit de « Parler à Malica », par personne : questions par minute (rafale) et par jour. '
  'La dernière décision vaut ; rien ne se réécrit.';

create index if not exists assistant_debits_recent_idx
  on plateforme.assistant_debits (decide_le desc);

alter table plateforme.assistant_debits enable row level security;
revoke all on table plateforme.assistant_debits from public, anon;
grant select on table plateforme.assistant_debits to authenticated;

drop policy if exists assistant_debits_lire on plateforme.assistant_debits;
create policy assistant_debits_lire on plateforme.assistant_debits
  for select to authenticated using ((select app.is_platform()));

drop trigger if exists assistant_debits_ne_se_reecrivent_pas on plateforme.assistant_debits;
create trigger assistant_debits_ne_se_reecrivent_pas
  before update or delete on plateforme.assistant_debits
  for each row execute function app.deny_mutation();

insert into plateforme.assistant_debits (par_minute, par_jour, motif, decide_le)
select 10, 200,
       'Défaut livré : dix questions par minute et deux cents par jour, par personne.',
       timestamptz '2026-11-10 10:02:00+00'
 where not exists (select 1 from plateforme.assistant_debits);

create or replace function public.assistant_debit_exiger()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_minute integer;
  v_jour   integer;
  v_pose   integer;
begin
  if auth.uid() is null then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  select d.par_minute, d.par_jour into v_minute, v_jour
    from plateforme.assistant_debits d
   order by d.decide_le desc, d.id desc
   limit 1;
  if v_minute is null then
    -- R4 : aucun repli implicite. Sans réglage, on le dit.
    raise exception 'refus.assistant.debit_absent' using errcode = '22023';
  end if;
  select count(*) into v_pose
    from agents.conversation_messages m
    join agents.conversations c on c.id = m.conversation_id
   where c.created_by = auth.uid()
     and m.role = 'user'
     and m.created_at > now() - interval '1 day';
  if v_pose >= v_jour then
    raise exception 'refus.assistant.quota_du_jour' using errcode = '22023';
  end if;
  return jsonb_build_object('parMinute', v_minute, 'parJour', v_jour, 'duJour', v_pose);
end
$function$;

-- Elle ne fait que LIRE : ce n'est pas une porte, elle reste au propriétaire du
-- schéma (comme `conseil_budget_exiger`), qui lit le réglage que la politique
-- réserve à la plateforme.
revoke all on function public.assistant_debit_exiger() from public, anon;
grant execute on function public.assistant_debit_exiger() to authenticated;

commit;
