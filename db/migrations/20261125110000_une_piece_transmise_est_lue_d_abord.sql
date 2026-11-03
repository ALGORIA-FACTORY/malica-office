-- Une pièce transmise est lue d'abord : la règle du 3 novembre, complétée.
--
-- ==================================================================== POURQUOI
--
-- `20261118160000` a fermé l'envoi d'une pièce non lue. Sa relecture
-- indépendante (le commit est arrivé sur `main` sans revue de PR) a relevé
-- deux trous, corrigés ici :
--
-- 1. LE PLAFOND. Au plafond du forfait, la lecture est refusée
--    (`plafond_atteint`) et la pièce ne pouvait plus partir : le cabinet ne
--    pouvait plus la saisir lui-même. « La capture ne s'arrête jamais, même
--    plafond atteint » : une pièce dont la dernière lecture demandée a été
--    refusée pour le plafond part, non lue, et le cabinet la saisit. Le motif
--    est celui que la base a inscrit (`lecture.refusee`), le même que la liste
--    lit (`REFUS_DE_LECTURE`) et que le Socle juge (`gestesDuCircuit`).
--
-- 2. L'ORDRE. PostgreSQL déclenche par ordre alphabétique : le refus « lisez-la
--    d'abord » passait avant celui de la licence. Licence suspendue, la lecture
--    est refusée elle aussi : la personne tournait en rond. Le nouveau nom passe
--    après `une_piece_transmise_exige_une_licence_active`, donc la licence parle
--    la première.
--
-- Ce qui reste hors de la règle, et pourquoi : une pièce qui NAÎT chez le
-- cabinet (`capture_piece_register` avec `partage`). Aucune capture de
-- l'application ne le fait — elle naît privée depuis le 7 octobre
-- (`lib/visibilite-a-la-capture.ts`) — mais les intégrations du cabinet et les
-- jeux de données (`outils/jeu-de-donnees.mjs`, `db/dev/jeu_dessai.mjs`) y
-- déposent des pièces que le cabinet lit lui-même. La règle porte sur le
-- geste d'ENVOYER une pièce de la société, pas sur la naissance.
--
-- Le reste ne change pas : le remplacement d'une photo déjà partie hérite du
-- partage ; un geste sans personne (une reprise de données) n'est pas jugé.

drop trigger if exists une_piece_non_lue_ne_part_pas on capture.pieces;
drop function if exists app.une_piece_non_lue_ne_part_pas();

create or replace function app.une_piece_transmise_est_lue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vis = 'partage'::app.vis_t
     and old.vis is distinct from new.vis
     and new.status = 'capturee'
     and new.source_piece_id is null
     and not app.remplacement_en_cours(new.id)
     and not app.piece_accompagne(new.id)
     and (auth.uid() is not null or app.api_tenant() is not null)
     -- Au plafond, la pièce part non lue : le cabinet la saisit.
     and (select e.payload ->> 'motif'
            from audit.event_log e
           where e.object_table = 'pieces' and e.object_id = new.id
             and e.action = 'lecture.refusee'
           order by e.at desc
           limit 1) is distinct from 'plafond_atteint'
  then
    raise exception 'refus.envoi.pas_lue' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.une_piece_transmise_est_lue() from public, anon, authenticated;

drop trigger if exists une_piece_transmise_lue_d_abord on capture.pieces;
create trigger une_piece_transmise_lue_d_abord
  before update of vis on capture.pieces
  for each row execute function app.une_piece_transmise_est_lue();
