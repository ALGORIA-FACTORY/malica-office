-- Effacer une pièce délie son journal de coût — sans le réécrire.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 4 octobre 2026. Le commanditaire demande d'effacer une pièce d'essai. La
-- route du produit répond « erreur interne », et le journal du serveur dit :
--
--   R7 : UPDATE interdit sur agents.agent_runs
--        — une correction est une ecriture nouvelle
--
-- `agents.agent_runs.piece_id` référence la pièce en `on delete set null` : la
-- suppression de la pièce ne supprime pas la ligne de coût — c'est voulu, la
-- dépense a eu lieu — elle en détache seulement le pointeur. Mais détacher,
-- c'est un UPDATE, et le garde R7 les refuse tous.
--
-- Conséquence : TOUTE pièce lue par un modèle était indestructible. La route
-- d'effacement existait, le test l'exerçait, et elle ne pouvait pas marcher dès
-- que l'œil avait travaillé.
--
-- ===================================================================== LA RÈGLE
--
-- Le garde s'appelle `deny_mutation_hors_effacement_de_piece` : la porte était
-- prévue, elle ne couvrait que le DELETE. On l'ouvre à un UPDATE, et à un seul :
--
--   — la transaction porte le drapeau que `capture_piece_supprimer` ne pose
--     qu'après avoir vérifié que la pièce n'est engagée nulle part ;
--   — le drapeau nomme CETTE pièce ;
--   — la ligne ne change QUE son `piece_id`, et seulement pour le mettre à
--     NULL. Tout le reste — le coût, la latence, les jetons, le modèle, le
--     moment — est comparé champ à champ et doit être identique.
--
-- La dernière condition est ce qui distingue cette porte d'une brèche : on ne
-- peut pas s'en servir pour corriger un coût en douce. Le journal garde ce
-- qu'il a écrit ; il perd seulement le droit de dire à quelle pièce il se
-- rapportait, puisqu'elle n'existe plus.

create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Premier passage autorisé : la cascade d'une suppression de pièce que
  -- `capture_piece_supprimer` a validée, et pour CETTE pièce précisément.
  if tg_op = 'DELETE'
     and coalesce(current_setting('malica.piece_effacable', true), '') = old.piece_id::text
  then
    return old;
  end if;

  -- Second passage : le détachement d'un journal que la suppression ne doit
  -- pas emporter. Rien d'autre que `piece_id` ne bouge, et il ne peut que
  -- devenir NULL.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('malica.piece_effacable', true), '') = old.piece_id::text
     and new.piece_id is null
     and (to_jsonb(new) - 'piece_id') = (to_jsonb(old) - 'piece_id')
  then
    return new;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function app.deny_mutation_hors_effacement_de_piece() is
  'Immuabilité R7, levée pour la cascade d''une pièce non engagée : sa '
  'suppression, et le seul détachement du pointeur des journaux qui la citent.';
