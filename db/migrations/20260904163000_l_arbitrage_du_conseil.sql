-- ============================================================================
-- L'arbitrage du conseil — ce que Malica n'ose pas envoyer seule.
-- ============================================================================
--
-- CE QUI SE PASSAIT AVANT
--
-- Un dirigeant posait une question de droit à Malica, et elle répondait —
-- citée, contrôlée, mais seule. Son comptable n'en savait rien, et n'avait
-- aucun moyen de reprendre une réponse avant qu'elle ne soit lue. Une réponse
-- juste à 60 % partait avec la même assurance qu'une réponse juste à 95 %.
--
-- CE QUE CETTE MIGRATION POSE
--
-- Un seuil, une table, deux gestes.
--
-- Le SEUIL est au cabinet : au-dessus de sa certitude déclarée, Malica
-- répond seule et le cabinet est informé ; en dessous, elle retient sa réponse
-- et la remet à l'expert. Ce n'est pas une constante (R4) : c'est une colonne
-- de `collab.reglages_cabinet`, avec un défaut livré et surchargeable (R10).
--
-- La TABLE `agents.arbitrages` garde chaque question de conseil posée par un
-- client mandaté : la réponse proposée, ses sources, la certitude, le doute
-- — et ce que le cabinet en a fait. Elle appartient au DOSSIER (tenant_id =
-- la PME) : le cabinet la lit par son mandat, comme il lit les pièces.
--
-- Les deux GESTES sont des fonctions `security definer` gardées par le
-- mandat, parce que la RLS du helper ne suffit pas ici : c'est le cabinet
-- qui décide, et il n'est pas membre du dossier ; c'est le client qui pose la
-- question, et il ne doit pas pouvoir approuver lui-même ce que Malica lui
-- destine. Aucune politique d'écriture directe ne reste donc sur la table.
--
-- ============================================================ POURQUOI PAS R7
--
-- Un arbitrage change d'état : en attente, puis approuvé, corrigé ou écarté.
-- Ce n'est pas un fait comptable ; c'est une décision qui s'inscrit sur la
-- ligne même. Le journal d'audit, lui, garde chaque décision datée.
--
-- Idempotent.
-- ============================================================================

-- --- 1. Le seuil de certitude du conseil ------------------------------------------------
alter table collab.reglages_cabinet
  add column if not exists seuil_certitude_conseil numeric(3,2) not null default 0.80;
alter table collab.reglages_cabinet
  drop constraint if exists reglages_cabinet_seuil_conseil_borne;
alter table collab.reglages_cabinet
  add constraint reglages_cabinet_seuil_conseil_borne
  check (seuil_certitude_conseil between 0 and 1);

comment on column collab.reglages_cabinet.seuil_certitude_conseil is
  'Au-dessus, Malica répond seule à une question de conseil et met le cabinet en copie ; en dessous, elle lui remet la réponse.';

-- La vue se recompose sur TOUTES les colonnes de la table, dans leur ordre.
-- Plusieurs migrations du même jour ajoutent chacune une colonne à ces
-- réglages ; une vue écrite avec une liste figée ne survivrait pas à leur
-- ordre d''exécution — `create or replace view` refuse de retirer ou de
-- renommer une colonne. On lit donc le catalogue, et la vue suit la table.
do $$
declare
  v_colonnes text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_colonnes
    from information_schema.columns
   where table_schema = 'collab' and table_name = 'reglages_cabinet';
  execute 'drop view if exists public.reglages_cabinet_v';
  execute 'create view public.reglages_cabinet_v with (security_invoker = true) as select '
          || v_colonnes || ' from collab.reglages_cabinet';
  execute 'grant select on public.reglages_cabinet_v to authenticated';
end $$;

create or replace function public.cabinet_reglages_lire(p_tenant uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'seuilConfianceLot', r.seuil_confiance_lot,
           'seuilConfianceRevue', r.seuil_confiance_revue,
           'doubleValidationAuDela', r.double_validation_au_dela,
           'propositionsProactives', r.propositions_proactives,
           'capaciteDossiers', r.capacite_dossiers_par_collaborateur,
           'ton', r.ton_restitutions,
           'seuilCertitudeConseil', r.seuil_certitude_conseil,
           'regle', true)
    into v
    from collab.reglages_cabinet r where r.tenant_id = p_tenant;
  if v is not null then return v; end if;

  -- Les défauts, tels que le schéma les déclare.
  select jsonb_build_object(
           'seuilConfianceLot', (select column_default::numeric from information_schema.columns
                                  where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                    and column_name = 'seuil_confiance_lot'),
           'seuilConfianceRevue', (select column_default::numeric from information_schema.columns
                                    where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                      and column_name = 'seuil_confiance_revue'),
           'doubleValidationAuDela', null,
           'propositionsProactives', true,
           'capaciteDossiers', (select column_default::integer from information_schema.columns
                                 where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                   and column_name = 'capacite_dossiers_par_collaborateur'),
           'ton', (select split_part(column_default, '''', 2) from information_schema.columns
                    where table_schema = 'collab' and table_name = 'reglages_cabinet'
                      and column_name = 'ton_restitutions'),
           'seuilCertitudeConseil', (select column_default::numeric from information_schema.columns
                                      where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                        and column_name = 'seuil_certitude_conseil'),
           'regle', false)
    into v;
  return v;
end $$;

drop function if exists public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer, text);
create or replace function public.cabinet_reglages_definir(
  p_tenant uuid,
  p_seuil_lot numeric,
  p_seuil_revue numeric,
  p_double_validation numeric,
  p_proactives boolean,
  p_capacite integer,
  p_ton text,
  p_seuil_conseil numeric
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into collab.reglages_cabinet
    (tenant_id, seuil_confiance_lot, seuil_confiance_revue, double_validation_au_dela,
     propositions_proactives, capacite_dossiers_par_collaborateur, ton_restitutions,
     seuil_certitude_conseil)
  values (p_tenant, p_seuil_lot, p_seuil_revue, p_double_validation, p_proactives, p_capacite, p_ton,
          p_seuil_conseil)
  on conflict (tenant_id) do update
    set seuil_confiance_lot = excluded.seuil_confiance_lot,
        seuil_confiance_revue = excluded.seuil_confiance_revue,
        double_validation_au_dela = excluded.double_validation_au_dela,
        propositions_proactives = excluded.propositions_proactives,
        capacite_dossiers_par_collaborateur = excluded.capacite_dossiers_par_collaborateur,
        ton_restitutions = excluded.ton_restitutions,
        seuil_certitude_conseil = excluded.seuil_certitude_conseil,
        updated_by = auth.uid(),
        updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'cabinet.reglages', 'collab', 'reglages_cabinet', p_tenant,
          jsonb_build_object('seuil_lot', p_seuil_lot, 'seuil_revue', p_seuil_revue,
                             'double_validation', p_double_validation, 'proactives', p_proactives,
                             'capacite', p_capacite, 'ton', p_ton,
                             'seuil_conseil', p_seuil_conseil));

  return public.cabinet_reglages_lire(p_tenant);
end $$;

revoke all on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer, text, numeric) from public, anon;
grant execute on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer, text, numeric) to authenticated;

-- --- 2. La table des arbitrages ----------------------------------------------------------
create table if not exists agents.arbitrages (
  id                uuid primary key default gen_random_uuid(),
  -- Le dossier : la PME qui a posé la question. C'est elle que la RLS cloisonne.
  tenant_id         uuid not null references identity.organizations(id) on delete cascade,
  -- Le cabinet mandaté au moment de la question. Il ne change pas si le mandat change.
  cabinet_tenant_id uuid not null references identity.organizations(id) on delete cascade,
  conversation_id   uuid references agents.conversations(id) on delete set null,
  -- La question, telle qu'elle a été rangée dans le fil.
  message_id        uuid references agents.conversation_messages(id) on delete set null,
  -- Qui a demandé : l'adresse de la personne, figée ici. Le cabinet n'est pas
  -- membre du dossier et ne pourrait pas la retrouver autrement.
  demandeur         text,
  question          text not null check (length(btrim(question)) > 0),
  reponse_proposee  text not null,
  -- Les articles sur lesquels la réponse s'appuie : [{corpus, numero, validFrom, validTo, langue}].
  sources           jsonb not null default '[]'::jsonb,
  certitude         numeric(3,2) not null check (certitude between 0 and 1),
  doute             text,
  canal             text not null default 'conversation',
  -- Le sujet, en quelques mots, posé par le modèle à la création : ce qui
  -- permet de voir revenir les mêmes questions sans relire chaque fil.
  theme             text,
  -- La langue dans laquelle le client a écrit : la réponse du cabinet lui
  -- parvient dans cette langue-là, pas dans celle de l'expert.
  langue            text not null default 'fr',
  -- en_attente : remise au cabinet · repondue : envoyée seule, cabinet en copie ·
  -- approuvee · corrigee · ecartee : la décision du cabinet.
  statut            text not null default 'en_attente',
  reponse_cabinet   text,
  article_cabinet   text,
  decide_par        uuid,
  decide_le         timestamptz,
  created_at        timestamptz not null default now(),
  constraint arbitrages_statut_check
    check (statut in ('en_attente', 'repondue', 'approuvee', 'corrigee', 'ecartee')),
  constraint arbitrages_correction_portee
    check (statut <> 'corrigee' or reponse_cabinet is not null)
);

create index if not exists arbitrages_tenant_idx
  on agents.arbitrages (tenant_id, created_at desc);
create index if not exists arbitrages_cabinet_idx
  on agents.arbitrages (cabinet_tenant_id, statut, created_at desc);

comment on table agents.arbitrages is
  'Les questions de conseil des clients mandatés : la réponse que Malica propose, et ce que le cabinet en décide.';

-- La lecture par le helper : membres du dossier et cabinet mandaté. Les
-- écritures, elles, passent toutes par les deux fonctions ci-dessous — on
-- retire donc les politiques d''écriture que le helper pose par défaut.
select app.enable_tenant_rls('agents', 'arbitrages', false, false);
drop policy if exists agents_arbitrages_ins on agents.arbitrages;
drop policy if exists agents_arbitrages_upd on agents.arbitrages;
drop policy if exists agents_arbitrages_del on agents.arbitrages;
revoke insert, update, delete on agents.arbitrages from authenticated;

create or replace view public.arbitrages_v with (security_invoker = true) as
select a.id, a.tenant_id, o.name as client, a.cabinet_tenant_id, a.conversation_id, a.message_id,
       a.demandeur, a.question, a.reponse_proposee, a.sources, a.certitude, a.doute, a.canal,
       a.theme, a.langue, a.statut, a.reponse_cabinet, a.article_cabinet, a.decide_par,
       a.decide_le, a.created_at
  from agents.arbitrages a
  left join identity.organizations o on o.id = a.tenant_id;
grant select on public.arbitrages_v to authenticated;

-- --- 3. Ce que Malica doit savoir avant de répondre à un client ------------------------
-- Le cabinet mandaté sur ce dossier, son seuil, et si l''appelant est membre du
-- dossier (un client) ou seulement mandaté (le cabinet lui-même, qui n''a pas à
-- s''arbitrer). Le seuil du cabinet n''est pas lisible par le client : la
-- fonction le lit pour lui, et ne rend rien d''autre.
create or replace function public.conseil_contexte(p_pme uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cabinet uuid;
  v_nom     text;
  v_seuil   numeric;
begin
  if not (p_pme in (select app.member_orgs()) or p_pme in (select app.engaged_orgs())) then
    raise exception 'dossier introuvable ou non autorise' using errcode = '42501';
  end if;

  select e.cabinet_org_id, o.name
    into v_cabinet, v_nom
    from identity.engagements e
    join identity.organizations o on o.id = e.cabinet_org_id
   where e.pme_org_id = p_pme and e.status = 'actif'
     and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
     and o.archived_at is null
   order by e.starts_on desc
   limit 1;

  if v_cabinet is not null then
    select r.seuil_certitude_conseil into v_seuil
      from collab.reglages_cabinet r where r.tenant_id = v_cabinet;
    if v_seuil is null then
      select column_default::numeric into v_seuil
        from information_schema.columns
       where table_schema = 'collab' and table_name = 'reglages_cabinet'
         and column_name = 'seuil_certitude_conseil';
    end if;
  end if;

  return jsonb_build_object(
    'cabinetId', v_cabinet,
    'cabinetNom', v_nom,
    'seuil', v_seuil,
    'appelantMembre', p_pme in (select app.member_orgs()));
end $$;

revoke all on function public.conseil_contexte(uuid) from public, anon;
grant execute on function public.conseil_contexte(uuid) to authenticated;

-- --- 4. Poser un arbitrage ---------------------------------------------------------------
-- Appelé par le serveur web APRÈS que le fil a rangé la question : la ligne
-- retrouve le message de la question dans la conversation. Le cabinet est
-- celui du mandat en cours ; sans mandat, il n''y a rien à arbitrer et la
-- fonction le dit.
create or replace function public.arbitrage_creer(
  p_tenant uuid,
  p_conversation uuid,
  p_question text,
  p_reponse text,
  p_sources jsonb,
  p_certitude numeric,
  p_doute text,
  p_canal text,
  p_theme text,
  p_langue text,
  p_statut text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cabinet   uuid;
  v_message   uuid;
  v_demandeur text;
  v_id        uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'dossier introuvable ou non autorise' using errcode = '42501';
  end if;
  if p_statut not in ('en_attente', 'repondue') then
    raise exception 'un arbitrage naît en attente ou déjà répondu' using errcode = 'check_violation';
  end if;

  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
   where e.pme_org_id = p_tenant and e.status = 'actif'
     and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
   order by e.starts_on desc
   limit 1;
  if v_cabinet is null then
    raise exception 'conseil.sans_cabinet' using errcode = 'no_data_found';
  end if;

  select m.id into v_message
    from agents.conversation_messages m
   where m.conversation_id = p_conversation and m.role = 'user' and m.contenu = p_question
   order by m.created_at desc, m.id desc
   limit 1;

  select u.email::text into v_demandeur from auth.users u where u.id = auth.uid();

  insert into agents.arbitrages
    (tenant_id, cabinet_tenant_id, conversation_id, message_id, demandeur, question,
     reponse_proposee, sources, certitude, doute, canal, theme, langue, statut)
  values
    (p_tenant, v_cabinet, p_conversation, v_message, v_demandeur, btrim(p_question),
     p_reponse, coalesce(p_sources, '[]'::jsonb), p_certitude, nullif(btrim(p_doute), ''),
     coalesce(nullif(btrim(p_canal), ''), 'conversation'), nullif(btrim(p_theme), ''),
     coalesce(nullif(btrim(p_langue), ''), 'fr'), p_statut)
  returning id into v_id;

  -- Le cabinet lit les notifications de ses dossiers : c''est là qu''on la pose.
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_tenant,
          case when p_statut = 'en_attente' then 'conseil.arbitrage' else 'conseil.repondu' end,
          jsonb_build_object('arbitrage_id', v_id, 'conversation_id', p_conversation,
                             'certitude', p_certitude, 'theme', p_theme));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(),
          case when p_statut = 'en_attente' then 'conseil.retenu' else 'conseil.repondu' end,
          'agents', 'arbitrages', v_id,
          jsonb_build_object('cabinet', v_cabinet, 'certitude', p_certitude, 'theme', p_theme,
                             'sources', coalesce(p_sources, '[]'::jsonb)));

  return jsonb_build_object('id', v_id, 'cabinetId', v_cabinet);
end $$;

revoke all on function public.arbitrage_creer(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.arbitrage_creer(uuid, uuid, text, text, jsonb, numeric, text, text, text, text, text) to authenticated;

-- --- 5. Décider ---------------------------------------------------------------------------
-- Le geste du cabinet, et lui seul : approuver, corriger, écarter. Le message
-- que le client lira arrive composé par l''appelant, dans la langue du client
-- — la base ne porte aucun texte destiné à une personne. Nul, rien ne part :
-- c''est le cas d''une réponse déjà envoyée que le cabinet approuve après coup.
create or replace function public.arbitrage_decider(
  p_id uuid,
  p_decision text,
  p_reponse text,
  p_article text,
  p_message text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a agents.arbitrages%rowtype;
  v_reponse text := nullif(btrim(p_reponse), '');
  v_article text := nullif(btrim(p_article), '');
begin
  select * into v_a from agents.arbitrages where id = p_id;
  if not found then
    raise exception 'arbitrage introuvable' using errcode = 'no_data_found';
  end if;
  if v_a.cabinet_tenant_id not in (select app.member_orgs()) then
    raise exception 'arbitrage introuvable ou non autorise' using errcode = '42501';
  end if;
  if p_decision not in ('approuvee', 'corrigee', 'ecartee') then
    raise exception 'décision inconnue' using errcode = 'check_violation';
  end if;
  if v_a.statut not in ('en_attente', 'repondue') then
    raise exception 'arbitrage.deja_decide' using errcode = 'check_violation';
  end if;
  if v_a.statut = 'repondue' and p_decision = 'ecartee' then
    raise exception 'une réponse déjà envoyée ne s''écarte pas' using errcode = 'check_violation';
  end if;
  if p_decision = 'corrigee' and v_reponse is null then
    raise exception 'conseil.reponse_vide' using errcode = 'check_violation';
  end if;

  update agents.arbitrages
     set statut = p_decision,
         reponse_cabinet = case when p_decision = 'corrigee' then v_reponse else null end,
         article_cabinet = case when p_decision = 'corrigee' then v_article else null end,
         decide_par = auth.uid(),
         decide_le = now()
   where id = p_id;

  -- Le message part dans le fil du client, s''il existe encore. Il est signé
  -- Malica dans le fil — c''est elle qui parle au client — mais le journal
  -- d''audit dit qui a décidé.
  if p_message is not null and length(btrim(p_message)) > 0
     and v_a.conversation_id is not null
     and exists (select 1 from agents.conversations c where c.id = v_a.conversation_id) then
    insert into agents.conversation_messages (conversation_id, role, contenu)
    values (v_a.conversation_id, 'assistant', p_message);
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_a.tenant_id, 'conseil.decide',
          jsonb_build_object('arbitrage_id', p_id, 'decision', p_decision,
                             'conversation_id', v_a.conversation_id, 'theme', v_a.theme));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_a.tenant_id, auth.uid(),
          case p_decision when 'approuvee' then 'conseil.approuve'
                          when 'corrigee' then 'conseil.corrige'
                          else 'conseil.ecarte' end,
          'agents', 'arbitrages', p_id,
          jsonb_build_object('cabinet', v_a.cabinet_tenant_id, 'depuis', v_a.statut,
                             'article', v_article, 'certitude', v_a.certitude));

  return (select to_jsonb(v) from public.arbitrages_v v where v.id = p_id);
end $$;

revoke all on function public.arbitrage_decider(uuid, text, text, text, text) from public, anon;
grant execute on function public.arbitrage_decider(uuid, text, text, text, text) to authenticated;
