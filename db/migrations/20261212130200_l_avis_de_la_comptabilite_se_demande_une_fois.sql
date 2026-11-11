-- « Demander l'avis de ma comptabilité » : le bouton de la conversation devient réel.
--
-- Sous la réponse de Malica, l'écran de la société montrait « Demander l'avis
-- de <comptabilité> — la demande n'est pas encore ouverte depuis cet écran ».
-- Décision du dirigeant, 11 novembre 2026 (point M-6) : le brouillon à valider
-- est un avis demandé à la comptabilité, par la file de relecture qui existe.
--
-- Ce qui manquait pour l'ouvrir : un état « déjà envoyé ». Un bouton rangé
-- avec la réponse se remontre à chaque réouverture du fil et pouvait poser
-- deux fois la même question dans la file. L'état est la ligne elle-même :
-- `arbitrage_creer`, appelé avec le canal « avis », rend l'arbitrage qui
-- existe déjà pour cette question au lieu d'en écrire un second.
--
-- La fonction garde sa signature, son propriétaire et ses droits : seule la
-- branche « avis » est ajoutée, le reste du corps est celui de
-- `20261110090100`.

begin;

CREATE OR REPLACE FUNCTION public.arbitrage_creer(p_tenant uuid, p_conversation uuid, p_question text, p_reponse text, p_sources jsonb, p_certitude numeric, p_doute text, p_canal text, p_theme text, p_langue text, p_statut text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cabinet   uuid;
  v_message   uuid;
  v_demandeur text;
  v_id        uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;
  if p_statut not in ('en_attente', 'repondue') then
    raise exception 'refus.arbitrage.etat_initial' using errcode = 'check_violation';
  end if;

  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
   where e.pme_org_id = p_tenant and e.status = 'actif'
     and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
   order by e.starts_on desc
   limit 1;
  if v_cabinet is null then
    raise exception 'refus.conseil.sans_cabinet' using errcode = 'no_data_found';
  end if;

  select m.id into v_message
    from agents.conversation_messages m
   where m.conversation_id = p_conversation and m.role = 'user' and m.contenu = p_question
   order by m.created_at desc, m.id desc
   limit 1;

  /*
   * L'AVIS DEMANDÉ PAR LA PERSONNE (canal « avis ») ne se pose qu'une fois par
   * question. Si la réponse est déjà chez la comptabilité — parce que Malica
   * l'y a envoyée, ou parce que le bouton a déjà été pressé —, on rend la
   * ligne qui existe et rien n'est écrit : ni doublon dans la file, ni
   * seconde notification.
   */
  if coalesce(nullif(btrim(p_canal), ''), 'conversation') = 'avis' then
    select a.id into v_id
      from agents.arbitrages a
     where a.tenant_id = p_tenant
       and a.conversation_id = p_conversation
       -- La réponse que l'assistant envoie d'elle-même est posée avant que le
       -- fil range la question : sa ligne ne porte pas de message. On la
       -- reconnaît donc à la question, dans ce fil.
       and btrim(a.question) = btrim(p_question)
       and (a.message_id is null or a.message_id is not distinct from v_message)
     order by a.created_at desc, a.id desc
     limit 1;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'cabinetId', v_cabinet, 'deja', true);
    end if;
  end if;

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
end $function$;

commit;
