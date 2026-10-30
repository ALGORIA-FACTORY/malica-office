-- « Doublon probable » se calcule quand on le lit, plus quand une lecture aboutit.
--
-- Codex sur #140 : le verdict était posé UNE fois, dans le jugement de la
-- seconde pièce, avec ce que la base connaissait à ce moment-là. Une première
-- pièce dont la lecture échoue, puis aboutit APRÈS celle de la seconde,
-- n'était signalée nulle part : la seconde n'avait rien trouvé, la première
-- écartait la seconde (arrivée après elle). Le verdict gardé ne se refaisait
-- jamais.
--
-- Ce que ce fichier pose :
--   1. La clé de doublon de chaque jugement, normalisée par le jugement lui-
--      même (`cleDeDoublon`, apps/api/src/scan/controles.ts) et rangée dans
--      trois colonnes : le numéro (sans lui, rien n'est jamais signalé), les
--      sept chiffres du matricule de l'émetteur, et « nom · date · total ».
--      Un index sur (dossier, numéro) : aucune lecture de JSON.
--   2. `app.doublon_probable_de(piece, numero, mf, lu)` : la RÈGLE, une fois.
--      Une pièce répète une pièce ARRIVÉE AVANT elle, du même dossier, ni
--      retirée ni remplacée (une pièce supprimée n'est plus là), visible de
--      qui lit, dont le DERNIER jugement porte le même numéro et :
--        — le même matricule ;
--        — ou, quand l'une des deux n'a pas de matricule, le même nom, la
--          même date et le même total.
--      Le jugement d'une pièce l'appelle avec la clé qu'il vient de calculer.
--   3. `app.doublon_probable(piece)` : la même règle, avec la clé du dernier
--      jugement de la pièce — ce que lisent la file du cabinet et l'en-tête de
--      la pièce, au moment où ils sont lus. L'ordre des lectures n'y fait rien.
--
-- Les jugements antérieurs n'ont pas de clé : leur pièce est signalée au
-- prochain jugement (`capture.analyser`).
--
-- REJEU (R11) : `if not exists` et `create or replace` partout.

begin;

-- --- 1. La clé, rangée --------------------------------------------------------------------------------

alter table capture.analyses
  add column if not exists doublon_numero text,
  add column if not exists doublon_mf     text,
  add column if not exists doublon_lu     text;

comment on column capture.analyses.doublon_numero is
  'Le numéro de la pièce normalisé (lettres et chiffres, en capitales). Nul : la pièce n''est jamais un doublon probable.';
comment on column capture.analyses.doublon_mf is
  'Les sept chiffres du matricule de l''émetteur, ou nul.';
comment on column capture.analyses.doublon_lu is
  'Le nom de l''émetteur normalisé, la date et le total, « nom|date|ttc » ; nul s''il en manque un.';

create index if not exists analyses_doublon_idx
  on capture.analyses (tenant_id, doublon_numero)
  where doublon_numero is not null;

-- --- 2. La règle, une fois ------------------------------------------------------------------------

create or replace function app.doublon_probable_de(
  p_piece uuid, p_numero text, p_mf text, p_lu text)
returns uuid
language sql
stable
set search_path = ''
as $$
  -- Invocateur : les pièces comparées sont celles que l'appelant voit.
  select q.id
    from public.pieces_v elle
    join capture.analyses a on a.tenant_id = elle.tenant_id and a.doublon_numero = p_numero
    join public.pieces_v q on q.id = a.piece_id
   where elle.id = p_piece
     and p_numero is not null
     and (q.created_at, q.id) < (elle.created_at, elle.id)
     and q.archivee_le is null and q.remplacee_par is null
     -- Le DERNIER jugement de l'autre pièce : une relecture le remplace.
     and not exists (select 1 from capture.analyses b
                      where b.piece_id = a.piece_id
                        and (b.created_at, b.id) > (a.created_at, a.id))
     and ((p_mf is not null and a.doublon_mf = p_mf)
          or (p_lu is not null and a.doublon_lu = p_lu
              and (p_mf is null or a.doublon_mf is null)))
   order by q.created_at, q.id
   limit 1
$$;

revoke all on function app.doublon_probable_de(uuid, text, text, text) from public, anon;
grant execute on function app.doublon_probable_de(uuid, text, text, text) to authenticated;

comment on function app.doublon_probable_de(uuid, text, text, text) is
  'La pièce arrivée avant celle-ci qu''elle répète, pour une clé de doublon donnée, ou nul (1er novembre 2026).';

-- --- 3. Au moment où on le lit ------------------------------------------------------------------

create or replace function app.doublon_probable(p_piece uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select app.doublon_probable_de(p_piece, a.doublon_numero, a.doublon_mf, a.doublon_lu)
    from capture.analyses a
   where a.piece_id = p_piece
   order by a.created_at desc, a.id desc
   limit 1
$$;

revoke all on function app.doublon_probable(uuid) from public, anon;
grant execute on function app.doublon_probable(uuid) to authenticated;

comment on function app.doublon_probable(uuid) is
  'La pièce arrivée avant celle-ci qu''elle répète, selon leurs derniers jugements, au moment de la lecture ; nul sinon (1er novembre 2026).';

commit;
