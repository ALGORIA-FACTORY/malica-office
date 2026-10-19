-- Une pièce se supprime, même quand un travail de lecture l'a touchée.
--
-- ================================================================ LE DÉFAUT
--
-- `20261020120000` pose deux décisions qui se contredisent :
--
--   1. `fabrique.travaux.piece_id` est `not null references capture.pieces(id)
--      ON DELETE CASCADE`. L'intention est claire : le travail part avec la
--      pièce qui en était le sujet.
--   2. `travaux` et `travail_faits` sont enregistrées en APPEND-ONLY
--      (`app.enable_tenant_rls(..., true)`), ce qui installe un déclencheur
--      `before update or delete` refusant toute mutation.
--
-- La cascade frappe donc le garde-fou de son propre auteur. Mesuré : toute
-- pièce qu'un travail a touchée devient INDESTRUCTIBLE, et `capture.supprimer`
-- rend 500. L'épreuve « Rien ne reste » le dit depuis six livraisons —
-- aucune n'avait été jugée par la CI, leurs exécutions s'étant annulées les
-- unes les autres.
--
-- ================================================================ LE CHOIX
--
-- Des deux décisions, la cascade est la plus SPÉCIFIQUE : elle nomme un cas,
-- l'append-only énonce une règle générale. Et le produit a besoin qu'une
-- photo prise par erreur puisse être retirée — c'est ce que l'épreuve exige.
--
-- Mais on ne jette pas l'append-only pour autant : il protège l'historique
-- d'une RÉÉCRITURE, et c'est une garantie qui vaut. La suppression d'un
-- travail dont la pièce n'existe plus n'est pas une réécriture : c'est la
-- disparition de son sujet.
--
-- D'où la discrimination posée ici, et elle est exacte plutôt qu'astucieuse :
-- PostgreSQL supprime la ligne PARENT avant de déclencher la cascade sur ses
-- enfants. Quand le déclencheur de l'enfant s'exécute, le parent est donc
-- DÉJÀ absent de la transaction. « Le parent n'existe plus » distingue donc
-- sans ambiguïté une cascade d'une suppression directe.
--
-- Ce qui reste refusé, et c'est tout ce que l'append-only promettait :
--   — toute MISE À JOUR, sans exception ;
--   — toute suppression DIRECTE, pièce (ou travail) toujours présent.
--
-- R7 : une correction est une nouvelle écriture, pas une réécriture.
-- R11 : cette migration ne réécrit pas `20261020120000` ; elle la corrige.

begin;

-- ---------------------------------------------------------------- travaux
create or replace function fabrique.travail_suit_sa_piece()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'fabrique.travaux ne se reecrit pas : ecrivez un fait, pas une correction'
      using errcode = 'restrict_violation';
  end if;

  -- DELETE. Le parent a-t-il deja disparu ? Si oui, nous sommes dans la
  -- cascade de `travaux_piece_id_fkey` et le travail n'a plus de sujet.
  if not exists (select 1 from capture.pieces p where p.id = old.piece_id) then
    return old;
  end if;

  raise exception 'un travail de lecture ne se supprime pas tant que sa piece existe'
    using errcode = 'restrict_violation';
end
$$;

drop trigger if exists fabrique_travaux_no_upd on fabrique.travaux;
drop trigger if exists fabrique_travaux_suit_sa_piece on fabrique.travaux;
create trigger fabrique_travaux_suit_sa_piece
  before update or delete on fabrique.travaux
  for each row execute function fabrique.travail_suit_sa_piece();

-- ----------------------------------------------------------- travail_faits
--
-- Son parent n'est pas la piece mais le travail, par `(tenant_id, travail_id)`
-- en cascade. Meme raisonnement, un cran plus bas : quand `travaux` s'en va,
-- ses faits n'ont plus de sujet.
create or replace function fabrique.fait_suit_son_travail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'fabrique.travail_faits ne se reecrit pas : un fait est un fait'
      using errcode = 'restrict_violation';
  end if;

  if not exists (
    select 1 from fabrique.travaux t
     where t.tenant_id = old.tenant_id and t.id = old.travail_id
  ) then
    return old;
  end if;

  raise exception 'un fait ne se supprime pas tant que son travail existe'
    using errcode = 'restrict_violation';
end
$$;

drop trigger if exists fabrique_travail_faits_no_upd on fabrique.travail_faits;
drop trigger if exists fabrique_travail_faits_suit_son_travail on fabrique.travail_faits;
create trigger fabrique_travail_faits_suit_son_travail
  before update or delete on fabrique.travail_faits
  for each row execute function fabrique.fait_suit_son_travail();

-- ------------------------------------------------------- la porte de lecture
--
-- La RLS reste FORCÉE et les politiques `_sel` / `_ins` posées par le helper
-- ne bougent pas. Une politique DELETE est necessaire malgre tout : sans
-- elle, la cascade ne VOIT aucune ligne a retirer et la contrainte echoue.
-- Elle porte la meme condition de locataire que les autres.
drop policy if exists fabrique_travaux_del on fabrique.travaux;
create policy fabrique_travaux_del on fabrique.travaux
  for delete to authenticated
  using (tenant_id in (select app.member_orgs()) or (select app.is_platform()));

drop policy if exists fabrique_travail_faits_del on fabrique.travail_faits;
create policy fabrique_travail_faits_del on fabrique.travail_faits
  for delete to authenticated
  using (tenant_id in (select app.member_orgs()) or (select app.is_platform()));

commit;
