-- Une pièce non lue ne part pas au cabinet.
--
-- ==================================================================== POURQUOI
--
-- 3 novembre 2026, sur le staging. Le commanditaire photographie une facture
-- (Centre de formation Horizon). Elle n'est pas lue — la lecture ne part que
-- sur « Lire la pièce » — et elle est pourtant chez le cabinet. Sur sa fiche,
-- plus de « Supprimer » (une pièce transmise ne revient que par accord du
-- cabinet) : il reste « Lire la pièce » et « Reprendre la photo ».
--
-- Le 7 octobre, le produit avait déjà tranché que transmettre AVANT de savoir
-- était le défaut (`lib/visibilite-a-la-capture.ts`) : la capture repartait en
-- privé, et l'envoi devenait une réponse donnée à la fin de la lecture. Mais
-- seule la fin de la capture tenait la règle (elle n'envoie que les pièces
-- lues). Ni la base, ni le Socle, ni le lot de la Bibliothèque ne la tenaient :
-- `piece_envoyer` passait toute pièce de la société, lue ou non.
--
-- Décision du commanditaire, le 3 novembre : interdire, et corriger.
--
-- ===================================================================== LA RÈGLE
--
-- Une pièce passe chez le comptable (`vis` vers `partage`) seulement si elle a
-- été lue, c'est-à-dire si elle n'est plus `capturee`. Tenue par un déclencheur,
-- comme le droit d'envoyer et la licence active : toute porte qui transmet
-- (`piece_envoyer`, le lot, `capture_piece_set_vis`) passe par lui.
--
-- Trois exceptions, les mêmes que celles du droit d'envoyer :
--   - le remplacement d'une photo déjà partie (`app.remplacement_en_cours`) :
--     la nouvelle hérite du partage, ce n'est pas une nouvelle transmission,
--     et elle se lit ensuite chez le cabinet comme avant ;
--   - une pièce qui en accompagne une autre (reçu, justificatif) : elle ne se
--     lit jamais (`lecture_verdict`), elle suit sa pièce ;
--   - un geste qui n'est fait par personne (une reprise de données) : la règle
--     porte sur les gestes des personnes et de l'API, comme sa voisine.
--
-- Les pièces déjà parties non lues restent où elles sont : la règle porte sur
-- le geste d'envoyer, pas sur le passé (R7). Leur fiche le dit, et leur
-- lecture reste possible des deux côtés.

create or replace function app.une_piece_non_lue_ne_part_pas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vis = 'partage'::app.vis_t
     and old.vis is distinct from new.vis
     and new.status = 'capturee'
     and not app.remplacement_en_cours(new.id)
     and new.source_piece_id is null
     and not app.piece_accompagne(new.id)
     and (auth.uid() is not null or app.api_tenant() is not null) then
    raise exception 'refus.envoi.pas_lue' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.une_piece_non_lue_ne_part_pas() from public, anon, authenticated;

drop trigger if exists une_piece_non_lue_ne_part_pas on capture.pieces;
create trigger une_piece_non_lue_ne_part_pas
  before update of vis on capture.pieces
  for each row execute function app.une_piece_non_lue_ne_part_pas();
