-- La TVA du mois ne lit que ses pièces (12 novembre 2026).
--
-- ========================================================== LE CONSTAT
--
-- L'épreuve de charge (`la-tva-du-mois-tient-la-charge.test.ts`) passait sur
-- une base neuve et échouait sur une base où d'autres dossiers avaient déjà
-- travaillé. Rejouée six fois de suite sur la même base, la lecture du mois
-- (200 pièces, 40 forcées) montait de 1,5 à 3,7 s côté PME
-- (`office.extraitsTransmis`) et de 1,1 à 3,4 s côté cabinet
-- (`office.bookedExtracts`), quand la sélection nue restait vers 0,45 s : le
-- coût suivait la BASE, pas les pièces lues.
--
-- Les plans (EXPLAIN ANALYZE sous l'identité du dirigeant et de l'expert, et
-- `pg_stat_xact_user_functions`) en donnent deux causes :
--
--   1. `app.extraits_de_la_tva` lisait les articles par
--      `a.piece_id in (select … from jsonb_array_elements(p_entrees))`.
--      PostgreSQL en faisait une semi-jointure par fusion : il parcourait
--      TOUS les articles de la base, et la politique de `capture.piece_articles`
--      appelait `app.piece_lisible` sur chacun avant de les écarter — 1 200
--      appels pour 400 articles utiles sur la troisième passe (« Rows Removed
--      by Filter: 800 »), 1,3 s sur les 2,1 s de la porte.
--   2. `app.ecriture_prise_en_charge_de` cherchait l'écriture par
--      `e.piece_id in (select app.versions_de_la_piece(p))`. Une fonction qui
--      rend un ensemble est estimée à 1 000 lignes : PostgreSQL parcourait
--      toutes les prises en charge de la base et appelait
--      `app.ecriture_vivante` sur chacune — 9 640 appels pour 80 recherches.
--      Chaque pièce forcée la paie, dans la vue des pièces qui comptent, dans
--      la porte et dans « Vos charges ».
--
-- Et une troisième, qui double le coût par pièce forcée sans dépendre de la
-- base : dans `app.lignes_rangees`, `x.id = app.ecriture_prise_en_charge_de(p)`
-- passait, par l'égalité de la jointure, aux deux tables — la recherche
-- s'évaluait deux fois.
--
-- ========================================================== CE QUE CE FICHIER CHANGE
--
--   1. `app.versions_de_la_piece` est estimée à 2 lignes (`rows 2`) : une
--      pièce a sa version, au plus quelques reprises. Les jointures sur ses
--      versions passent par l'index des écritures (`ecritures_piece_idx`),
--      ici et partout où elle sert. Un `create or replace` de la fonction
--      sans `rows` la ramènerait à 1 000 : le redire alors.
--   2. `app.lignes_rangees` évalue l'écriture prise en charge une fois.
--   3. `app.extraits_de_la_tva` lit la liste des pièces en un tableau et
--      filtre `= any` : l'index de chaque table, les seules pièces demandées.
--
-- Aucun résultat ne change : mêmes lignes, mêmes politiques, mêmes fonctions
-- appelées sur les mêmes pièces — seulement moins de lignes étrangères lues.

begin;

-- --- 1. Les versions d'une pièce : une ou deux, pas mille ---------------------------------------

alter function app.versions_de_la_piece(uuid) rows 2;

-- --- 2. Une écriture prise en charge se range en une lecture de l'écriture ---------------------
--
-- Repris de `20261103090000`, la ligne `where x.id = ...` seule changée.

create or replace function app.lignes_rangees(p_piece uuid, p_origine text)
returns table (
  ecriture_id     uuid,
  ordinal         smallint,
  nature          text,
  droit_code      text,
  tax_code        text,
  montant         numeric,
  account_code    text,
  libelle         text,
  date_ecriture   date,
  pack_version_id uuid,
  devise          text,
  immobilisation  boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select x.id, x.pack_version_id, x.date_ecriture, x.devise, x.tenant_id as dossier,
           pc.tenant_id as cabinet
      from socle.ecritures x
      join socle.prises_en_charge pc on pc.ecriture_id = x.id
     -- Une fois : écrite nue, l'égalité passait aux deux tables de la
     -- jointure et la fonction s'évaluait deux fois.
     where x.id = (select app.ecriture_prise_en_charge_de(p_piece))
       and exists (select 1 from app.ecriture_prise_en_charge(pc.tenant_id, x.id) o
                    where p_origine is null or o.origine = p_origine)
     order by pc.prise_le desc
     limit 1
  ),
  k as (
    select p.document_kind from capture.pieces p where p.id = app.version_courante(p_piece)
  ),
  natures as (
    select n.*
      from e cross join k
      cross join lateral app.nature_des_comptes(
        e.cabinet, e.dossier, e.pack_version_id, k.document_kind, e.date_ecriture,
        array(select distinct l.account_code from socle.ecriture_lignes l
               where l.ecriture_id = e.id)) n
  ),
  rangees as (
    select l.ecriture_id, l.ordinal, l.account_code, l.libelle, l.tax_code,
           e.pack_version_id, e.date_ecriture, e.devise, n.nature, n.droit_code,
           n.immobilisation,
           case when k.document_kind = 'facture_vente' then l.credit - l.debit
                else l.debit - l.credit end as cote
      from e
      cross join k
      join socle.ecriture_lignes l on l.ecriture_id = e.id
      join natures n on n.account_code = l.account_code
  ),
  unique_tva as (
    select case when count(*) = count(r.tax_code) and count(distinct r.tax_code) = 1
                then min(r.tax_code) end as code
      from rangees r where r.nature = 'tva'
  )
  select r.ecriture_id, r.ordinal, r.nature, r.droit_code,
         case r.nature
           when 'tva' then r.tax_code
           when 'base' then coalesce(r.tax_code, (select code from unique_tva))
         end,
         case when r.nature in ('tiers', 'autre') then -r.cote else r.cote end,
         r.account_code, r.libelle, r.date_ecriture, r.pack_version_id, r.devise,
         r.immobilisation
    from rangees r
   order by r.ordinal
$$;

-- --- 3. La porte de la TVA lit les articles de SES pièces --------------------------------------
--
-- Repris de `20261103090000`, la sélection des pièces seule changée.

create or replace function app.extraits_de_la_tva(p_entrees jsonb)
returns table (piece_id uuid, payload jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entree   jsonb;
  v_piece    uuid;
  v_payload  jsonb;
  v_montants jsonb;
  v_immo     jsonb;
  v_attr     boolean;
  v_exposant integer;
  v_dossier  uuid;
  v_kind     text;
  v_cree     date;
  v_unique   text;
  v_cache    jsonb := '{}'::jsonb;
  v_cle      record;
  v_prises   jsonb;
  v_articles jsonb;
  v_ids      uuid[];
begin
  -- Les pièces demandées, en un tableau : la liste se lit par l'index de
  -- chaque table (`= any`), jamais par une semi-jointure que PostgreSQL
  -- résolvait en parcourant TOUS les articles de la base, RLS comprise.
  v_ids := array(select (e ->> 'piece_id')::uuid
                   from jsonb_array_elements(coalesce(p_entrees, '[]'::jsonb)) e);

  -- Les pièces prises en charge, en une passe sur les dossiers des pièces.
  select coalesce(jsonb_object_agg(x.piece_id, x.ecriture_id), '{}'::jsonb) into v_prises
    from app.prises_des_dossiers(array(
           select distinct p.tenant_id from public.pieces_v p
            where p.id = any (v_ids))) x;

  -- Les articles projetés de toutes les pièces, lus en UNE requête : lus
  -- pièce par pièce, la vue coûtait 5 ms chacune (revue de #145).
  select coalesce(jsonb_object_agg(x.piece_id, x.articles), '{}'::jsonb) into v_articles
    from (select a.piece_id,
                 jsonb_agg(jsonb_build_object(
                   'ordinal', a.ordinal, 'famille', a.famille_code, 'total', a.total_ht,
                   'pack', a.pack_version_id, 'jour', a.document_date)) as articles
            from public.piece_articles_v a
           where a.piece_id = any (v_ids)
           group by a.piece_id) x;

  for v_entree in select e from jsonb_array_elements(coalesce(p_entrees, '[]'::jsonb)) e loop
    v_piece := (v_entree ->> 'piece_id')::uuid;
    v_payload := v_entree -> 'payload';
    piece_id := v_piece;

    if not app.piece_lisible(v_piece) then
      payload := null;
      return next;
      continue;
    end if;

    v_immo := null;
    v_attr := null;
    if v_prises ? app.version_courante(v_piece)::text then
      v_montants := app.montants_pris_en_charge(v_piece);
      if coalesce((v_montants ->> 'lisible')::boolean, false) then
        payload := coalesce(v_payload, '{}'::jsonb) || jsonb_build_object(
          'lines', v_montants -> 'lines',
          'other_charges', v_montants -> 'other_charges',
          'totals', v_montants -> 'totals',
          'document_date', v_montants -> 'date_ecriture',
          'currency', v_montants -> 'currency',
          'document_kind', v_montants -> 'document_kind');
        return next;
        continue;
      end if;
    end if;

    if v_payload is null or jsonb_typeof(v_payload -> 'lines') is distinct from 'array' then
      payload := v_payload;
      return next;
      continue;
    end if;
    select d.exposant into v_exposant from ref.devises d where d.code = v_payload ->> 'currency';

    if v_prises ? app.version_courante(v_piece)::text then
      -- Prise en charge : les comptes de l'écriture décident.
      select r.immo, r.attribuable into v_immo, v_attr
        from app.immobilisations_prises(v_piece, v_payload) r;
    else
      -- Aucune écriture prise en charge : les articles lus décident.
      select p.tenant_id, coalesce(v_payload ->> 'document_kind', p.document_kind),
             p.created_at::date
        into v_dossier, v_kind, v_cree
        from public.pieces_v p where p.id = app.version_courante(v_piece);
      select case when count(distinct e ->> 'tax_code') = 1 then min(e ->> 'tax_code') end
        into v_unique
        from jsonb_array_elements(v_payload -> 'lines') e;
      for v_cle in
        select distinct (a ->> 'pack')::uuid as pack_version_id,
               coalesce((a ->> 'jour')::date, v_cree) as jour
          from jsonb_array_elements(coalesce(v_articles -> v_piece::text, '[]'::jsonb)) a
         where a ->> 'pack' is not null
      loop
        if not v_cache ? (v_cle.pack_version_id::text || '|' || v_kind || '|' || v_cle.jour) then
          v_cache := v_cache || jsonb_build_object(
            v_cle.pack_version_id::text || '|' || v_kind || '|' || v_cle.jour,
            to_jsonb(app.familles_immobilisees(v_dossier, v_cle.pack_version_id, v_kind,
                                               v_cle.jour)));
        end if;
      end loop;
      with lus as (
        -- Les articles lus non vides, dans l'ordre de leur projection.
        select t.e, row_number() over (order by t.n) as rang
          from jsonb_array_elements(case when jsonb_typeof(v_payload -> 'articles') = 'array'
                                         then v_payload -> 'articles' else '[]'::jsonb end)
               with ordinality t(e, n)
         where coalesce(btrim(t.e ->> 'designation'), '') <> ''
      ),
      immos as (
        select coalesce(l.e ->> 'tax_code', v_unique) as code, (a ->> 'total')::numeric as total
          from jsonb_array_elements(coalesce(v_articles -> v_piece::text, '[]'::jsonb)) a
          left join lus l on l.rang = (a ->> 'ordinal')::bigint
         where coalesce(v_cache -> ((a ->> 'pack') || '|' || v_kind || '|'
                                    || coalesce((a ->> 'jour')::date, v_cree)), '[]'::jsonb)
               ? (a ->> 'famille')
      )
      select coalesce((select jsonb_object_agg(x.code, x.total::text)
                         from (select im.code, sum(im.total) as total from immos im
                                where im.code is not null group by im.code) x), '{}'::jsonb),
             not exists (select 1 from immos im where im.total is null or im.code is null)
        into v_immo, v_attr;
    end if;

    payload := v_payload || jsonb_build_object(
      'lines', app.lignes_par_nature(v_payload -> 'lines', v_immo, v_attr, v_exposant));
    return next;
  end loop;
end
$$;

commit;
