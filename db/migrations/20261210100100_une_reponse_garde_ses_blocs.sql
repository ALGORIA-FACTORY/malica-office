-- Une réponse de Malica garde ses blocs : un fil rouvert les remontre à l'identique.
--
-- La bulle de Malica sait désormais dessiner, sous son texte, des blocs
-- composés par le serveur — un chiffre clé avec son détail, un tableau. Leurs
-- valeurs viennent d'un moteur ou de la base (R3), jamais du modèle, qui ne fait
-- que désigner ce qu'il montre (outil `afficher_visuel`).
--
-- Comme les sources et les propositions (`20261209090000`), les blocs sont
-- rangés avec la réponse : un bloc montré le 10 novembre garde ses chiffres et
-- sa période du 10 novembre, même si le dossier a changé depuis.
--
-- R6 : la porte reste la seule écriture. Elle gagne un paramètre ; l'ancienne
-- signature est retirée (sans quoi deux portes feraient la même chose, R12), la
-- nouvelle appartient au portier, fermée à public et anon.
--
-- La consigne — une seule pour les deux moteurs — dit quand montrer un visuel.
-- Version nouvelle, qui reprend la dernière publiée ; datée en littéral (R11).

begin;

alter table agents.conversation_messages
  add column if not exists blocs jsonb;

drop function if exists public.conversation_repondre(uuid, text, text, text, text, integer, integer, integer, jsonb, jsonb);

create or replace function public.conversation_repondre(
  p_conversation uuid, p_question text, p_reponse text, p_raisonnement text, p_model text,
  p_tokens_in integer, p_tokens_out integer, p_latency_ms integer,
  p_sources jsonb default null, p_propositions jsonb default null, p_blocs jsonb default null
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (select 1 from agents.conversations c
                  where c.id = p_conversation and c.created_by = auth.uid()) then
    raise exception 'refus.introuvable.conversation' using errcode = '42501';
  end if;
  insert into agents.conversation_messages (conversation_id, role, contenu)
  values (p_conversation, 'user', p_question);
  insert into agents.conversation_messages (conversation_id, role, contenu, raisonnement, model,
                                            tokens_in, tokens_out, latency_ms, sources, propositions,
                                            blocs)
  values (p_conversation, 'assistant', p_reponse, p_raisonnement, p_model, p_tokens_in,
          p_tokens_out, p_latency_ms,
          case when jsonb_typeof(p_sources) = 'array' and jsonb_array_length(p_sources) > 0
               then p_sources end,
          case when jsonb_typeof(p_propositions) = 'array' and jsonb_array_length(p_propositions) > 0
               then p_propositions end,
          case when jsonb_typeof(p_blocs) = 'array' and jsonb_array_length(p_blocs) > 0
               then p_blocs end);
end
$function$;

alter function public.conversation_repondre(uuid, text, text, text, text, integer, integer, integer, jsonb, jsonb, jsonb)
  owner to portier;
revoke all on function public.conversation_repondre(uuid, text, text, text, text, integer, integer, integer, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.conversation_repondre(uuid, text, text, text, text, integer, integer, integer, jsonb, jsonb, jsonb)
  to authenticated;

insert into plateforme.assistant_consignes (texte, motif, decide_le)
select k.texte || E'\n\n' || $section$MONTRER UN VISUEL
Certains résultats d'outils te disent qu'un visuel est disponible pour une source. Quand la question porte sur un chiffre, une situation ou une liste que ce visuel montre, appelle afficher_visuel avec la clé de cette source : la personne voit alors, sous ta réponse, le chiffre clé ou le tableau, composé par l'application à partir des mêmes données. Un seul visuel par idée. Tu ne recopies pas alors ses lignes une à une dans ton texte : tu dis en une ou deux phrases ce qu'elles veulent dire pour la personne, ce qui mérite son attention, et ce qu'elle peut faire ensuite. Pour une question simple ou une règle de droit, pas de visuel : du texte. Tu n'annonces pas l'outil et tu ne décris pas le visuel (« voici un tableau ») : il se voit.$section$,
       'Ajout de la section « MONTRER UN VISUEL » (outil afficher_visuel) : la bulle de Malica montre des blocs '
       || 'composés par le serveur, pour les deux moteurs (lot I).',
       greatest(timestamptz '2026-11-10 10:01:00+00', k.decide_le + interval '1 second')
  from (select c.texte, c.decide_le
          from plateforme.assistant_consignes c
         order by c.decide_le desc, c.id desc
         limit 1) k
 where not exists (
   select 1 from plateforme.assistant_consignes c
    where c.motif like 'Ajout de la section « MONTRER UN VISUEL »%');

commit;
