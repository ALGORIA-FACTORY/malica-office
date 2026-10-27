-- Une conversation avec Malica se supprime, même quand une réponse a
-- déclenché un contrôle.
--
-- ================================================================== POURQUOI
--
-- Audit du 27 octobre 2026 (`une-conversation-se-supprime.test.ts`). Effacer
-- un fil emporte ses messages ; les contrôles déclenchés par une réponse sont
-- conservés, détachés du message (`ON DELETE SET NULL`) — « ils survivent à
-- l'effacement d'une conversation », dit `20260901190000`. Mais la même
-- migration leur a posé le garde STRICT `app.deny_mutation`, qui refuse ce
-- détachement : « R7 : UPDATE interdit sur agents.reponse_controles », et le
-- fil restait. L'écran ne disait rien.
--
-- ================================================================== CE QUI CHANGE
--
-- Un garde qui laisse passer le détachement, et lui seul : `message_id` part
-- vers NULL, aucune autre colonne ne bouge, et le message cité n'existe plus.
-- Hors de cette cascade, l'une des conditions manque et R7 tient, avec le
-- message de `app.deny_mutation` mot pour mot.

create or replace function app.deny_mutation_hors_detachement_de_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.message_id is not null
     and new.message_id is null
     and to_jsonb(new) - 'message_id' = to_jsonb(old) - 'message_id'
     and not exists (select 1 from agents.conversation_messages m where m.id = old.message_id)
  then
    return new;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end
$$;

revoke all on function app.deny_mutation_hors_detachement_de_message() from public, anon;

drop trigger if exists reponse_controles_no_upd on agents.reponse_controles;
create trigger reponse_controles_no_upd
  before update or delete on agents.reponse_controles
  for each row execute function app.deny_mutation_hors_detachement_de_message();
