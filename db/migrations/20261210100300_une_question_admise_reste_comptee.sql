-- Une question admise reste comptée : le quota du jour ne se compte plus sur le fil.
--
-- Revue de la PR #345 (10 novembre 2026), reproduite par épreuve : le quota du
-- jour se comptait sur les messages rangés au fil (`agents.conversation_messages`).
-- Deux défauts. Une question n'était comptée qu'une fois sa réponse rangée — des
-- questions admises et encore en cours ne pesaient rien. Et supprimer une
-- conversation emporte ses messages en cascade : qui atteignait le quota
-- supprimait ses fils et reprenait aussitôt des appels payants.
--
-- Le compte vit désormais dans son propre registre, `agents.assistant_questions`,
-- une ligne par question ADMISE, écrite par la porte au moment où elle admet.
-- Il ne se réécrit pas et ne dépend d'aucune conversation.
--
-- R6 : aucun client n'écrit ni ne lit ce registre. La porte
-- `assistant_debit_exiger` appartient au portier, qui n'y a que les deux droits
-- qu'elle exerce (lire, inscrire), sous une politique bornée à l'appelant. Le
-- réglage, que la politique réserve à la plateforme, lui arrive par une
-- fonction qui ne rend que ses deux bornes.

begin;

create table if not exists agents.assistant_questions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id),
  created_at  timestamptz not null default now()
);

comment on table agents.assistant_questions is
  'Une ligne par question admise par « Parler à Malica » : le compte du quota du jour, par personne. '
  'Écrite par la porte assistant_debit_exiger ; ne se réécrit pas ; indépendante des conversations.';

create index if not exists assistant_questions_par_personne_idx
  on agents.assistant_questions (user_id, created_at desc);

alter table agents.assistant_questions enable row level security;
revoke all on table agents.assistant_questions from public, anon, authenticated;
grant select, insert on table agents.assistant_questions to portier;

drop policy if exists assistant_questions_sel on agents.assistant_questions;
create policy assistant_questions_sel on agents.assistant_questions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists assistant_questions_ins on agents.assistant_questions;
create policy assistant_questions_ins on agents.assistant_questions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop trigger if exists assistant_questions_ne_se_reecrivent_pas on agents.assistant_questions;
create trigger assistant_questions_ne_se_reecrivent_pas
  before update or delete on agents.assistant_questions
  for each row execute function app.deny_mutation();

-- Les deux bornes en vigueur, et rien d'autre du réglage.
create or replace function app.assistant_debit_regle(out par_minute integer, out par_jour integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select d.par_minute, d.par_jour
    from plateforme.assistant_debits d
   order by d.decide_le desc, d.id desc
   limit 1
$function$;

revoke all on function app.assistant_debit_regle() from public, anon;
grant execute on function app.assistant_debit_regle() to authenticated;

create or replace function public.assistant_debit_exiger()
returns jsonb
language plpgsql
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
  select r.par_minute, r.par_jour into v_minute, v_jour from app.assistant_debit_regle() r;
  if v_minute is null then
    -- R4 : aucun repli implicite. Sans réglage, on le dit.
    raise exception 'refus.assistant.debit_absent' using errcode = '22023';
  end if;
  select count(*) into v_pose
    from agents.assistant_questions q
   where q.user_id = auth.uid()
     and q.created_at > now() - interval '1 day';
  if v_pose >= v_jour then
    raise exception 'refus.assistant.quota_du_jour' using errcode = '22023';
  end if;
  insert into agents.assistant_questions (user_id) values (auth.uid());
  return jsonb_build_object('parMinute', v_minute, 'parJour', v_jour, 'duJour', v_pose);
end
$function$;

alter function public.assistant_debit_exiger() owner to portier;
revoke all on function public.assistant_debit_exiger() from public, anon;
grant execute on function public.assistant_debit_exiger() to authenticated;

commit;
