-- Le journal de coût rejoint le garde qui a une porte.
--
-- La migration précédente a ouvert, dans
-- `app.deny_mutation_hors_effacement_de_piece`, le détachement d'un pointeur
-- vers une pièce effacée. Elle ne suffisait pas : `agents.agent_runs` ne porte
-- pas ce garde-là. Il porte `app.deny_mutation`, le garde STRICT, qui refuse
-- toute mutation sans exception.
--
-- `20260903150000` avait déplacé cinq tables de `capture` vers le garde à
-- porte, et laissé les autres au strict — « rien de ce qui touche aux
-- écritures, aux lettrages, au coffre ou au journal d'audit n'est concerné ».
-- Le journal des appels de modèles est passé entre les deux : il n'est ni une
-- écriture comptable, ni une table de capture, et il référence pourtant une
-- pièce en `on delete set null`.
--
-- Résultat, constaté le 4 octobre 2026 : toute pièce lue par un modèle était
-- indestructible, et la route d'effacement rendait « erreur interne ».
--
-- Ce que ce changement N'AUTORISE PAS : rien d'autre. Le garde à porte vérifie
-- que la transaction porte le drapeau de `capture_piece_supprimer`, que le
-- drapeau nomme cette pièce, que `piece_id` devient NULL, et que TOUT LE RESTE
-- de la ligne est identique champ à champ. Un coût ne peut pas être corrigé
-- par ce chemin.

drop trigger if exists agents_agent_runs_no_upd on agents.agent_runs;

create trigger agents_agent_runs_no_upd
  before delete or update on agents.agent_runs
  for each row execute function app.deny_mutation_hors_effacement_de_piece();
