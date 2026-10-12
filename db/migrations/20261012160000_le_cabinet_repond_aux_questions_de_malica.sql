-- Le cabinet répond aux questions de Malica, et l'on sait qui a répondu.
--
-- ================================================================= POURQUOI
--
-- 11 octobre 2026 : « aussi la réponse du comptable aux questions envoyées
-- par Malica ».
--
-- Quand une famille de charges s'écarte de son habitude, Malica pose la
-- question — « votre électricité fait trois fois le mois ordinaire ». Elle est
-- visible des deux côtés, parce que la question est `partage`, et
-- `charge_question_answer` n'autorisait que les MEMBRES du dossier :
-- `p_tenant not in (select app.member_orgs())`. L'expert voyait donc une
-- question qu'il ne pouvait pas trancher — et c'est pourtant lui qui sait si
-- une facture d'électricité de septembre est exceptionnelle ou douteuse.
--
-- ========================================= CE QUI N'EST PAS UN AFFAIBLISSEMENT
--
-- R6 réserve l'écriture aux membres. Elle le reste : la porte accepte
-- désormais aussi les dossiers SOUS MANDAT ACTIF, ce que `app.engaged_orgs()`
-- définit — un mandat daté, actif, porté par une adhésion au cabinet. Ce n'est
-- pas « tout le monde » : c'est la seconde autorité que le produit connaît
-- déjà, celle par laquelle le cabinet valide une écriture.
--
-- ================================================= ET ON SAIT QUI A RÉPONDU
--
-- Sans ce mot, la réponse arrive anonyme et change de sens : « exceptionnel »
-- écrit par le dirigeant est une déclaration ; écrit par l'expert, c'est un
-- avis professionnel. L'écran doit pouvoir les distinguer sans aller lire un
-- identifiant d'utilisateur.
--
-- Le côté se DÉDUIT de l'identité de l'appelant, il ne se déclare pas : un
-- appelant qui dirait lui-même « je suis le cabinet » se tromperait, ou
-- mentirait.
--
-- ===================================================== CE QUI NE CHANGE PAS
--
-- Le mécanisme est en AJOUT SEUL depuis le 26 août : chaque réponse est une
-- ligne de plus, numérotée par `seq`, et `courante` désigne la dernière. Une
-- réponse ne se réécrit donc pas, et l'avis du cabinet qui contredit celui du
-- dirigeant ne l'effacera pas — les deux restent lisibles, dans l'ordre.
--
-- Corps repris de `20260826142600`, dont il ne s'écarte qu'en deux points,
-- marqués dans le texte.

alter table collab.charge_questions
  add column if not exists answered_side text
    check (answered_side is null or answered_side in ('pme', 'cabinet'));

comment on column collab.charge_questions.answered_side is
  'Qui a répondu : le dossier lui-même ou son cabinet. Déduit de l''identité '
  'de l''appelant, jamais déclaré. « Exceptionnel » dit par le dirigeant est '
  'une déclaration ; dit par l''expert, c''est un avis professionnel — et sans '
  'ce mot, l''écran ne peut pas faire la différence.';

create or replace function public.charge_question_answer(
  p_tenant uuid, p_period text, p_famille text, p_observed numeric,
  p_baseline numeric, p_ratio numeric, p_threshold text, p_pack uuid, p_answer text)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_id uuid;
  v_seq integer;
  v_membre boolean;
  v_mandate boolean;
  v_side text;
begin
  -- PREMIER ÉCART : l'expert sous mandat actif peut trancher. Personne d'autre.
  v_membre := p_tenant in (select app.member_orgs());
  v_mandate := p_tenant in (select app.engaged_orgs());
  if not v_membre and not v_mandate then
    raise exception 'organisation non autorisee' using errcode = '42501';
  end if;
  if p_answer not in ('exceptionnel','a_verifier') then
    raise exception 'reponse invalide' using errcode = '22023';
  end if;

  -- SECOND ÉCART : le côté s'inscrit. Le membre d'abord — un expert qui serait
  -- AUSSI membre du dossier répond en tant que membre, parce que c'est le lien
  -- le plus fort des deux.
  v_side := case when v_membre then 'pme' else 'cabinet' end;

  select coalesce(max(seq), 0) + 1 into v_seq
    from collab.charge_questions
   where tenant_id = p_tenant and period = p_period and famille_code = p_famille;

  insert into collab.charge_questions (tenant_id, period, famille_code, observed, baseline,
    deviation_ratio, threshold_code, pack_version_id, answer, answered_by, answered_at, seq,
    answered_side)
  values (p_tenant, p_period, p_famille, p_observed, p_baseline, p_ratio, p_threshold,
          p_pack, p_answer, auth.uid(), now(), v_seq, v_side)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (p_tenant, auth.uid(), 'charge.question_answered', 'collab', 'charge_questions',
          v_id, p_pack,
          jsonb_build_object('period', p_period, 'famille_code', p_famille,
                             'answer', p_answer, 'observed', p_observed,
                             'baseline', p_baseline, 'deviation_ratio', p_ratio,
                             'seq', v_seq, 'side', v_side));

  return v_id;
end $$;

revoke all on function public.charge_question_answer(uuid, text, text, numeric, numeric, numeric, text, uuid, text)
  from public, anon;
grant execute on function public.charge_question_answer(uuid, text, text, numeric, numeric, numeric, text, uuid, text)
  to authenticated, service_role;

-- --- La vue ------------------------------------------------------------------------------
--
-- Une colonne que la vue ne montre pas n'existe pas pour l'application.
--
-- L'ordre des colonnes est celui de `20260826142600`, à la virgule près, et la
-- nouvelle est AJOUTÉE À LA FIN : `create or replace view` refuse de renommer,
-- de déplacer ou de retirer une colonne existante. Une première version de
-- cette migration a échoué exactement là — « ne peut pas supprimer les
-- colonnes d'une vue » — pour avoir recopié une définition plus ancienne.

create or replace view public.charge_questions_v
  with (security_invoker = true) as
  select q.id, q.tenant_id, q.period, q.famille_code, q.observed, q.baseline,
         q.deviation_ratio, q.threshold_code, q.pack_version_id, q.answer,
         q.answered_at, q.seq, q.vis, q.created_at,
         (q.seq = max(q.seq) over (partition by q.tenant_id, q.period, q.famille_code))
           as courante,
         q.answered_side
    from collab.charge_questions q;

revoke all on table public.charge_questions_v from public, anon, service_role;
grant select on table public.charge_questions_v to authenticated;
