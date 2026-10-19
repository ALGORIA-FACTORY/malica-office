-- La fabrique rejoint le garde qui existait déjà.
--
-- ============================================================== CE QUI PRÉCÈDE
--
-- `20261020160000` a corrigé le bon défaut — une pièce lue par un travail de
-- fabrique était devenue indestructible — mais avec un mécanisme INVENTÉ :
-- deux fonctions propres à `fabrique`, qui déduisaient la cascade de l'absence
-- du parent, et deux politiques DELETE.
--
-- Or le dépôt porte ce garde depuis le 3 septembre, pour exactement le même
-- conflit : `app.deny_mutation_hors_effacement_de_piece()`, posé par
-- `20260903150000` sur les cinq tables de `capture` qui dépendent d'une pièce.
-- Son en-tête dit le même problème dans les mêmes termes : « une photo ratée,
-- lue par erreur, restait à vie dans le coffre ».
--
-- Il est meilleur que le mien sur deux points, et c'est pourquoi on l'adopte :
--
--   1. Il n'autorise pas N'IMPORTE QUELLE cascade. Il n'autorise que celle que
--      `public.capture_piece_supprimer` a validée, pour CETTE pièce, après
--      avoir vérifié qu'elle n'est engagée nulle part — ni écriture, ni
--      proposition, ni immobilisation, ni stock, ni fiche, ni transmission.
--      Ma déduction « le parent a disparu » aurait laissé passer la cascade
--      d'une pièce ENGAGÉE si une autre voie venait un jour à l'effacer.
--   2. Il rend le message de `app.deny_mutation` à la lettre, donc les
--      épreuves qui gardent l'immuabilité de la fabrique continuent de
--      juger ce qu'elles jugeaient.
--
-- ============================================================== TRAVAIL_FAITS
--
-- `travaux` porte `piece_id` : le garde existant s'y applique tel quel.
-- `travail_faits` ne le porte pas — son parent est le travail, par
-- `(tenant_id, travail_id)` en cascade. Il lui faut donc un garde jumeau, qui
-- exige LES DEUX conditions : le drapeau de suppression validée est posé, ET
-- son travail n'existe plus. Hors de cette cascade, l'une des deux manque.
--
-- Son message est celui de `app.deny_mutation`, mot pour mot.
--
-- ============================================================== LES POLITIQUES
--
-- Les deux politiques DELETE de `20261020160000` sont retirées : elles ne
-- servaient à rien. `capture_piece_supprimer` est `security definer` et son
-- propriétaire n'est pas soumis à la RLS — c'est déjà ainsi que les cinq
-- tables de `capture` se laissent effacer sans politique DELETE. R9.

begin;

-- ------------------------------------------------- travaux : le garde existant
drop trigger if exists fabrique_travaux_suit_sa_piece on fabrique.travaux;
drop trigger if exists fabrique_travaux_no_upd        on fabrique.travaux;
create trigger fabrique_travaux_no_upd
  before update or delete on fabrique.travaux
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

-- ------------------------------------------- travail_faits : le garde jumeau
create or replace function app.deny_mutation_hors_effacement_de_travail()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Les deux conditions, et pas une seule : le drapeau que
  -- `capture_piece_supprimer` a posé après contrôle, ET la disparition du
  -- travail dont ce fait dépend. Hors de cette cascade, l'une des deux manque.
  if tg_op = 'DELETE'
     and coalesce(current_setting('malica.piece_effacable', true), '') <> ''
     and not exists (
       select 1 from fabrique.travaux t
        where t.tenant_id = old.tenant_id and t.id = old.travail_id)
  then
    return old;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function app.deny_mutation_hors_effacement_de_travail() is
  'Immuabilite R7, levee uniquement pour la cascade d''un travail dont la piece s''efface.';

drop trigger if exists fabrique_travail_faits_suit_son_travail on fabrique.travail_faits;
drop trigger if exists fabrique_travail_faits_no_upd           on fabrique.travail_faits;
create trigger fabrique_travail_faits_no_upd
  before update or delete on fabrique.travail_faits
  for each row execute function app.deny_mutation_hors_effacement_de_travail();

-- --------------------------------------------------- ce que j'avais invente
-- `schema.test.ts (d bis)` dit pourquoi, et il le disait avant moi :
-- « malica.piece_effacable est un réglage de session : n'importe quel
-- utilisateur peut le poser. Il ne sert de clé à personne PARCE QUE les tables
-- du garde d'effacement n'ont aucune politique DELETE ni UPDATE. »
-- Mes deux politiques auraient fait de ce réglage une clé posable par tous.
drop policy if exists fabrique_travaux_del       on fabrique.travaux;
drop policy if exists fabrique_travail_faits_del on fabrique.travail_faits;

-- L'autre moitié de cette sûreté : le DROIT, pas seulement la politique.
-- `enable_tenant_rls` accorde `delete` et `update` à `authenticated` même en
-- ajout seul — seule l'absence de politique les arrêtait. Sur une table du
-- garde permissif, cela ne suffit plus : c'est la ceinture, et on la met.
-- `capture.pieces` l'avait déjà fait, dans la même migration qui a posé le
-- garde (`revoke delete on capture.pieces from authenticated`).
-- Une table en ajout seul n'a besoin ni de l'un ni de l'autre.
revoke delete, update on fabrique.travaux       from authenticated;
revoke delete, update on fabrique.travail_faits from authenticated;
drop function if exists fabrique.travail_suit_sa_piece();
drop function if exists fabrique.fait_suit_son_travail();

commit;
