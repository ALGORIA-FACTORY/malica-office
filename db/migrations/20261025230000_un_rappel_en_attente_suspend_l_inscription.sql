-- Un rappel en attente suspend l'inscription de la pièce (25 octobre 2026).
--
-- ================================================================ LE DÉFAUT
--
-- Audit du 25 octobre 2026. La PME demande le rappel d'une pièce transmise ;
-- avant que le cabinet ne tranche, elle répond « Oui » au montant, et la
-- pièce se comptabilise. Le cabinet clique ensuite « Accorder » :
-- `capture_piece_set_vis` refuse (« une piece comptabilisee reste dans la
-- societe »), et la demande reste en attente d'un accord devenu impossible.
--
-- Les deux gestes se contredisent : rappeler, c'est reprendre la pièce ;
-- l'inscrire, c'est l'engager. Tant que la demande de rappel attend, la pièce
-- ne s'inscrit pas — ni par la PME, ni par le cabinet. La demande se tranche
-- d'abord ; l'inscription vient après, quelle que soit la réponse.
--
-- ================================================================ OÙ
--
-- Un déclencheur sur `socle.ecritures`, et non un bloc de plus dans
-- `socle_ecriture_propose` et `socle_ecriture_book` : la règle tient pour
-- toute porte, présente ou future, qui propose ou inscrit l'écriture d'une
-- pièce. Seule l'écriture DE la pièce est concernée (nature « piece », hors
-- contre-passation) : un règlement ne l'engage pas.
--
-- Le refus est une CLÉ du dictionnaire (`refus.piece.rappelEnAttente`) :
-- l'écran la dit dans la langue de la personne.
--
-- `security definer` : la demande se lit quelle que soit la politique de
-- lecture de l'appelant — un refus qui dépendrait de ce que l'appelant voit
-- laisserait passer l'inscription en silence. La fonction ne lit que la
-- demande de la pièce de la ligne écrite, que l'appelant écrit déjà sous sa
-- propre RLS ; elle n'est exécutable par personne en direct.

create or replace function app.pas_d_inscription_sous_rappel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.piece_id is not null
     and new.nature = 'piece'
     and new.reverses_id is null
     and (tg_op = 'INSERT' or (old.status = 'proposee' and new.status = 'booked'))
     and (select d.fait from collab.demandes_sur_piece d
           where d.piece_id = new.piece_id and d.objet = 'rappel'
           order by d.created_at desc limit 1) = 'demandee' then
    raise exception 'refus.piece.rappelEnAttente' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.pas_d_inscription_sous_rappel() from public, anon, authenticated;

drop trigger if exists pas_d_inscription_sous_rappel on socle.ecritures;
create trigger pas_d_inscription_sous_rappel
  before insert or update of status on socle.ecritures
  for each row execute function app.pas_d_inscription_sous_rappel();

comment on function app.pas_d_inscription_sous_rappel() is
  'Une pièce dont le rappel est demandé ne se propose ni ne s''inscrit tant que '
  'le cabinet n''a pas tranché : rappeler et inscrire se contredisent.';
