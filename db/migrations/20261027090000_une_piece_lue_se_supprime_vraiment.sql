-- Une pièce lue, pas encore envoyée, se supprime vraiment.
--
-- ================================================================== POURQUOI
--
-- 27 octobre 2026, Wissem sur staging : « la suppression n'a aucun effet ».
-- Reproduit (`une-piece-lue-se-supprime.test.ts`) :
--
--   R7 : DELETE interdit sur fabrique.executions
--
-- Une lecture laisse des traces liées à la pièce, que l'effacement validé par
-- `capture_piece_supprimer` emporte ou détache :
--
--   fabrique.executions  ON DELETE CASCADE   garde STRICT `app.deny_mutation`
--   fabrique.exemples    ON DELETE CASCADE   garde STRICT `app.deny_mutation`
--   agents.agent_runs    ON DELETE SET NULL  garde sans passage pour le SET NULL
--   fabrique.derives     ON DELETE SET NULL  garde STRICT `app.deny_mutation`
--
-- La première suffisait à rendre indestructible toute pièce lue par une
-- recette ; la troisième, toute pièce lue par le modèle. L'erreur s'affichait
-- en haut de la fiche, loin du bouton : « aucun effet ».
--
-- ================================================================== CE QUI CHANGE
--
-- Ces quatre tables rejoignent le garde qui existe pour ce cas exact,
-- `app.deny_mutation_hors_effacement_de_piece()`. Il gagne un sixième
-- passage, aussi étroit que les autres : le SET NULL de `piece_id` d'une
-- trace qui survit à la pièce, pour la pièce dont l'effacement est validé, et
-- aucune autre colonne ne bouge. Hors de cet effacement, l'immuabilité R7 est
-- intacte — l'épreuve le redit.
--
-- `fabrique.exemples` part avec sa pièce, comme la cascade le dit. Un exemple
-- cité par une version de recette ou une évaluation reste protégé par leurs
-- gardes stricts : sa pièce ne s'efface pas, et c'est voulu (la provenance
-- d'une recette promue ne disparaît pas en silence).

create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_effacable text := coalesce(current_setting('malica.piece_effacable', true), '');
  v_paiements text;
begin
  -- Premier passage : la cascade d'une suppression de pièce que
  -- `capture_piece_supprimer` a validée, et pour CETTE pièce précisément.
  if tg_op = 'DELETE' and v_effacable = old.piece_id::text then
    -- Un paiement qui part avec la pièce note son identifiant : ses
    -- justificatifs, supprimés ensuite par cascade, s'y reconnaîtront.
    if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
      perform set_config(
        'malica.paiements_effacables',
        coalesce(current_setting('malica.paiements_effacables', true), '')
          || ',' || old.id::text,
        true);
    end if;
    return old;
  end if;

  if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
    -- Second passage : le SET NULL d'un justificatif qui disparaît. La pièce
    -- effacée est celle que le paiement citait, la colonne part vers NULL, et
    -- AUCUNE autre colonne ne bouge.
    if tg_op = 'UPDATE'
       and old.justificatif_piece_id is not null
       and v_effacable = old.justificatif_piece_id::text
       and new.justificatif_piece_id is null
       and to_jsonb(new) - 'justificatif_piece_id'
         = to_jsonb(old) - 'justificatif_piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture'
        and tg_table_name in ('paiement_justificatifs', 'recu_paiements') then
    -- Troisième passage : la ligne de preuve d'un paiement qui part avec sa
    -- facture. Son `piece_id` est le talon, pas la pièce effacée.
    -- Cinquième passage (25 octobre 2026), même règle : le lien d'un reçu
    -- vers un paiement qui part avec sa facture. Le reçu, lui, reste.
    v_paiements := coalesce(current_setting('malica.paiements_effacables', true), '');
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and (',' || v_paiements || ',') like ('%,' || old.paiement_id::text || ',%')
    then
      return old;
    end if;
  elsif (tg_table_schema, tg_table_name) in (('agents', 'agent_runs'), ('fabrique', 'derives')) then
    -- Sixième passage (27 octobre 2026) : le SET NULL d'une trace qui survit
    -- à la pièce — l'appel au modèle qui l'a lue, le dérivé d'une recette.
    -- La pièce effacée est celle que la ligne citait, la colonne part vers
    -- NULL, et AUCUNE autre colonne ne bouge.
    if tg_op = 'UPDATE'
       and v_effacable <> ''
       and old.piece_id is not null
       and v_effacable = old.piece_id::text
       and new.piece_id is null
       and to_jsonb(new) - 'piece_id' = to_jsonb(old) - 'piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'rattachements' then
    -- Quatrième passage : le registre des rattachements a DEUX bouts. La pièce
    -- effacée peut être la pièce liée ; le premier passage n'a lu que l'autre.
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and v_effacable = old.piece_liee_id::text
    then
      return old;
    end if;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;$fn$;

drop trigger if exists fabrique_executions_no_upd on fabrique.executions;
create trigger fabrique_executions_no_upd
  before update or delete on fabrique.executions
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists fabrique_exemples_no_upd on fabrique.exemples;
create trigger fabrique_exemples_no_upd
  before update or delete on fabrique.exemples
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists fabrique_derives_no_upd on fabrique.derives;
create trigger fabrique_derives_no_upd
  before update or delete on fabrique.derives
  for each row execute function app.deny_mutation_hors_effacement_de_piece();
