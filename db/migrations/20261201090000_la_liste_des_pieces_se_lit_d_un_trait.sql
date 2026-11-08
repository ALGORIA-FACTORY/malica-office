-- ======================================================================
--  La liste des pièces se lit d'un trait (7 novembre 2026).
--
--  Recette d'un propriétaire de nombreuses sociétés : « le chargement est
--  trop lent ». Mesuré sur la base de la CI : 10 000 pièces sur 150 sociétés
--  ne se lisaient pas en trente secondes (délai de la requête atteint).
--
--  La cause : chaque ligne de `capture.listAvecLecture` appelait
--  `app.circuit_de_la_piece` et `app.suivi_de_la_piece`, deux fonctions
--  plpgsql qui, pour UNE pièce, relisent la version courante, la lisibilité,
--  les droits de la personne sur la société, le prénom de l'auteur, puis
--  cherchent son circuit, ses vues, ses précisions, son écriture. Relevé sur
--  1 000 pièces : 1,9 s pour le circuit, 1,6 s pour le suivi, dont 0,4 s
--  pour relire mille fois le même droit sur la même société.
--
--  Or une pièce qui n'a JAMAIS bougé — ni remplacée, ni passée de main en
--  main, ni vue, ni précisée, ni renvoyée, ni écrite — a un circuit et un
--  suivi qui se déduisent de la seule ligne de la pièce et de deux faits
--  par société (membre ? droit de recevoir ?). C'est le cas de la plupart.
--
--  Ces deux fonctions donnent à la liste, en UNE lecture par appel :
--    - les pièces qui ont un historique : elles gardent les deux fonctions,
--      telles quelles ;
--    - le prénom des auteurs : une lecture par personne, pas par pièce.
--  La liste calcule le reste (`apps/api/src/depots/capture.ts`). Le résultat
--  est le même, pièce par pièce ; un test le prouve contre les deux
--  fonctions sur toutes les pièces de la base de test.
--
--  Les deux sont bornées aux sociétés dont l'appelant est membre ou que son
--  cabinet tient : elles ne rendent que des identifiants (et des prénoms de
--  membres), jamais une pièce.
-- ======================================================================

begin;

create or replace function app.pieces_avec_historique(p_tenants uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with pieces as (
    select p.id
      from capture.pieces p
     where p.tenant_id = any(p_tenants)
       and (p.tenant_id in (select app.member_orgs())
            or p.tenant_id in (select app.engaged_orgs()))
  )
  select r.piece_id from capture.remplacements r where r.piece_id in (select id from pieces)
  union
  select r.remplacee_par from capture.remplacements r where r.remplacee_par in (select id from pieces)
  union
  select c.piece_id from capture.circuit c where c.piece_id in (select id from pieces)
  union
  select v.piece_id from capture.vues v where v.piece_id in (select id from pieces)
  union
  select q.piece_id from capture.precisions q where q.piece_id in (select id from pieces)
  union
  select e.object_id from audit.event_log e
   where e.object_table = 'pieces' and e.action = 'piece.renvoyee'
     and e.object_id in (select id from pieces)
  union
  select e.piece_id from socle.ecritures e where e.piece_id in (select id from pieces)
$$;

comment on function app.pieces_avec_historique(uuid[]) is
  'Les pièces des sociétés données qui ont un historique (remplacement, circuit, vue, précision, renvoi, écriture) : celles dont la liste relit le circuit et le suivi par app.circuit_de_la_piece et app.suivi_de_la_piece. Bornée aux sociétés dont l''appelant est membre ou que son cabinet tient.';

create or replace function app.prenoms_des_auteurs(p_tenants uuid[])
returns table(user_id uuid, prenom text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.created_by, app.prenom_au_moment(a.created_by)
    from (select distinct p.created_by
            from capture.pieces p
           where p.tenant_id = any(p_tenants)
             and p.tenant_id in (select app.member_orgs())
             and p.created_by is not null) a
$$;

comment on function app.prenoms_des_auteurs(uuid[]) is
  'Le prénom de chaque auteur de pièce des sociétés données dont l''appelant est membre — ce que app.circuit_de_la_piece rend en « auteur », lu une fois par personne.';

revoke all on function app.pieces_avec_historique(uuid[]) from public, anon;
revoke all on function app.prenoms_des_auteurs(uuid[]) from public, anon;
grant execute on function app.pieces_avec_historique(uuid[]) to authenticated;
grant execute on function app.prenoms_des_auteurs(uuid[]) to authenticated;

commit;
