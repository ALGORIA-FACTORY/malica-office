-- ======================================================================
--  La file juge les doublons d'un coup (5 novembre 2026).
--
--  Relevé sur staging : la file du cabinet (91 pièces) répondait en 3,7 s.
--  Mesuré en base (18 pièces, EXPLAIN ANALYZE) : un tiers du temps allait
--  à `app.doublon_probable`, appelée une fois par ligne. Chaque appel est une
--  instruction de plus, et chaque instruction réévalue les fonctions des
--  politiques d'accès de `pieces_v` (`app.member_orgs()`, `engaged_orgs()`…),
--  de 0,5 à 1,8 ms chacune : environ 25 ms par pièce, pour un jugement qui
--  n'en coûte qu'un.
--
--  `app.doublons_des_cles` porte la règle — elle seule — et juge N pièces en
--  UNE instruction : les politiques s'évaluent une fois. Les deux fonctions
--  d'avant la reprennent, pour une pièce ; `app.doublons_probables` la
--  reprend pour la file. La règle est mot pour mot celle de
--  20261101100000_le_doublon_se_juge_a_la_lecture (invocateur : les pièces
--  comparées sont celles que l'appelant voit).
-- ======================================================================

begin;

create function app.doublons_des_cles(
  p_pieces uuid[], p_numeros text[], p_mfs text[], p_lus text[])
returns table (piece_id uuid, doublon_de uuid)
language sql
stable
set search_path = ''
as $$
  select k.piece, d.id
    from unnest(p_pieces, p_numeros, p_mfs, p_lus) as k(piece, numero, mf, lu)
    left join lateral (
      -- Invocateur : les pièces comparées sont celles que l'appelant voit.
      select q.id
        from public.pieces_v elle
        join capture.analyses a on a.tenant_id = elle.tenant_id and a.doublon_numero = k.numero
        join public.pieces_v q on q.id = a.piece_id
       where elle.id = k.piece
         and k.numero is not null
         and (q.created_at, q.id) < (elle.created_at, elle.id)
         and q.archivee_le is null and q.remplacee_par is null
         -- Le DERNIER jugement de l'autre pièce : une relecture le remplace.
         and not exists (select 1 from capture.analyses b
                          where b.piece_id = a.piece_id
                            and (b.created_at, b.id) > (a.created_at, a.id))
         and ((k.mf is not null and a.doublon_mf = k.mf)
              or (k.lu is not null and a.doublon_lu = k.lu
                  and (k.mf is null or a.doublon_mf is null)))
       order by q.created_at, q.id
       limit 1
    ) d on true
$$;

comment on function app.doublons_des_cles(uuid[], text[], text[], text[]) is
  'Le doublon probable de chaque pièce, pour ses clés (numéro, matricule, émetteur lu), en une '
  'instruction : la règle du doublon, une fois.';

-- Les dernières clés lues de chaque pièce, jugées d'un coup.
create function app.doublons_probables(p_pieces uuid[])
returns table (piece_id uuid, doublon_de uuid)
language sql
stable
set search_path = ''
as $$
  select d.piece_id, d.doublon_de
    from (select array_agg(c.piece_id) as pieces, array_agg(c.doublon_numero) as numeros,
                 array_agg(c.doublon_mf) as mfs, array_agg(c.doublon_lu) as lus
            from (select distinct on (a.piece_id) a.piece_id, a.doublon_numero, a.doublon_mf,
                         a.doublon_lu
                    from capture.analyses a
                   where a.piece_id = any(p_pieces)
                   order by a.piece_id, a.created_at desc, a.id desc) c) k
    cross join lateral app.doublons_des_cles(k.pieces, k.numeros, k.mfs, k.lus) d
$$;

comment on function app.doublons_probables(uuid[]) is
  'Le doublon probable de chaque pièce, sur son dernier jugement, en une instruction (la file).';

create or replace function app.doublon_probable_de(p_piece uuid, p_numero text, p_mf text, p_lu text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select d.doublon_de
    from app.doublons_des_cles(array[p_piece], array[p_numero], array[p_mf], array[p_lu]) d
$$;

create or replace function app.doublon_probable(p_piece uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select d.doublon_de from app.doublons_probables(array[p_piece]) d
$$;

revoke all on function app.doublons_des_cles(uuid[], text[], text[], text[]) from public, anon;
revoke all on function app.doublons_probables(uuid[]) from public, anon;
grant execute on function app.doublons_des_cles(uuid[], text[], text[], text[]) to authenticated;
grant execute on function app.doublons_probables(uuid[]) to authenticated;

commit;
