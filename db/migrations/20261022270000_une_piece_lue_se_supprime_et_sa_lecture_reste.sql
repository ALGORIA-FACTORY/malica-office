-- Une pièce lue se supprime, et sa lecture reste comptée (20 octobre 2026).
--
-- Recette : « Supprimer cette pièce » échouait en erreur interne sur toute
-- pièce déjà LUE, même privée et jamais transmise. `facturation.lectures`
-- tenait la pièce par une clé étrangère sans action (RESTRICT) : la base
-- refusait de supprimer une pièce dont une lecture avait été comptée.
--
-- Une lecture est un fait de facturation, daté et en ajout seul : elle a eu
-- lieu, elle a été payée, et elle le reste quand la pièce disparaît. Elle n'a
-- donc pas à empêcher la suppression ni à disparaître avec elle. La clé
-- étrangère part ; l'identifiant de la pièce reste écrit, comme une trace.
-- L'insertion, elle, vérifie toujours que la pièce existe et appartient au
-- dossier (politique `facturation_lectures_ins`).
--
-- REJEU (R11) : `drop constraint if exists`.

begin;

alter table facturation.lectures drop constraint if exists lectures_piece_id_fkey;

comment on column facturation.lectures.piece_id is
  'La pièce lue. Trace, sans clé étrangère : la lecture reste comptée quand '
  'la pièce est supprimée (20 octobre 2026).';

commit;
