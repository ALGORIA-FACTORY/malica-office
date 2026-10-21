-- Le client écrit ses questions ; seul le serveur écrit les réponses
-- (21 octobre 2026).
--
-- 20261022440000 a réservé au serveur toute écriture d'`agents.conversation_messages`
-- (ANO-002 : un client pouvait inscrire une « réponse de Malica » inventée).
-- C'était trop large : la question est le geste du client, et une question
-- relue par le cabinet attend sa réponse sans que le serveur l'écrive. Le
-- déclencheur ne garde donc que les messages qui ne sont PAS des questions :
-- la réponse (`assistant`) et tout rôle futur.
-- REJEU (R11) : `create or replace`, `drop trigger if exists`.

begin;

create or replace function app.exiger_origine_serveur_sauf_question()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.role = 'user' then
    return new;
  end if;
  if coalesce(current_setting('request.jwt.claim.sub', true), '') <> ''
     and coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'reserve au serveur : %.%', tg_table_schema, tg_table_name
      using errcode = '42501';
  end if;
  return new;
end $function$;
revoke all on function app.exiger_origine_serveur_sauf_question() from public, anon;

drop trigger if exists conversation_messages_origine_serveur on agents.conversation_messages;
create trigger conversation_messages_origine_serveur before insert on agents.conversation_messages
for each row execute function app.exiger_origine_serveur_sauf_question();

-- L'arbitrage du conseil écrit la réponse décidée par le cabinet dans le fil
-- du client : corps repris de la base vivante, seule la marque d'origine
-- s'ajoute autour de l'insertion.
CREATE OR REPLACE FUNCTION public.arbitrage_decider(p_id uuid, p_decision text, p_reponse text, p_article text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_a agents.arbitrages%rowtype;
  v_reponse text := nullif(btrim(p_reponse), '');
  v_article text := nullif(btrim(p_article), '');
  v_origine text;
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
    -- La réponse arbitrée est écrite par la BASE, au nom du cabinet qui vient
    -- de décider : la marque d'origine est posée le temps de cette ligne,
    -- puis rendue (20261022440000 réserve ces écritures au serveur).
    v_origine := coalesce(current_setting('malica.origine', true), '');
    perform set_config('malica.origine', 'serveur', true);
    insert into agents.conversation_messages (conversation_id, role, contenu)
    values (v_a.conversation_id, 'assistant', p_message);
    perform set_config('malica.origine', v_origine, true);
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
end $function$;

commit;
