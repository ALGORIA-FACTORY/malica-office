-- Une photo reprise garde ses règlements (« Malica sans blocage », suite de
-- `20261029100000`).
--
-- Un règlement est un fait inscrit sur une pièce (`capture.paiements`, R7) :
-- il ne se déplace pas quand une nouvelle photo remplace la pièce. Il se LIT
-- donc par la chaîne des versions : la photo courante voit, compte et plafonne
-- les règlements de toutes ses versions précédentes. Le fait reste où il est
-- né, avec l'écriture de règlement qui le cite.

begin;

-- La dernière photo de la chaîne d'une pièce : elle-même si personne ne l'a
-- remplacée. Sous RLS (security invoker) : on ne suit que ce qu'on voit.
create or replace function app.version_courante(p_piece uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive suite(id, rang) as (
    select p_piece, 0
    union all
    select r.remplacee_par, s.rang + 1
      from capture.remplacements r join suite s on r.piece_id = s.id
  )
  select id from suite order by rang desc limit 1
$$;

revoke all on function app.version_courante(uuid) from public, anon;
grant execute on function app.version_courante(uuid) to authenticated;

-- Toutes les versions d'une pièce, la courante comprise, d'où qu'on parte.
create or replace function app.versions_de_la_piece(p_piece uuid)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive versions(id) as (
    select app.version_courante(p_piece)
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  )
  select id from versions
$$;

revoke all on function app.versions_de_la_piece(uuid) from public, anon;
grant execute on function app.versions_de_la_piece(uuid) to authenticated;

commit;
