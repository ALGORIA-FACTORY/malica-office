-- La TVA déductible sur IMMOBILISATIONS se déclare à part (3 novembre 2026).
--
-- ========================================================== LE CONSTAT
--
-- #140 range au plan les lignes d'une écriture forcée : une immobilisation
-- acquise (un compte que les schémas d'écriture portent au montant HT sans
-- être une charge) est HT, jamais une charge du mois, et `montants_pris_en_
-- charge` la MARQUAIT (`immobilisation`) pour que la déclaration en isole la
-- TVA. Mais le contrat extract.v1 ne connaissait pas la marque : zod la
-- retirait, et la TVA du mois ne pouvait pas la montrer à part.
--
-- Trois autres défauts, trouvés en route :
--   1. une facture MÊLÉE (une immobilisation et des charges au même taux)
--      perdait la marque : `bool_and` la mettait à faux pour tout le taux ;
--   2. `office.bookedExtracts` — la TVA du cabinet, la synthèse du dossier,
--      le PV — lisait la LECTURE d'une pièce forcée, quand la PME lisait déjà
--      les montants du cabinet (#140) : deux TVA pour la même pièce, et celle
--      du cabinet ne recoupait pas son propre journal ;
--   3. la marque ne servait qu'au forçage : une lecture validée, ou une
--      lecture dont les articles vont à un compte d'immobilisation, n'avaient
--      aucune nature — et « Vos charges » comptait ces articles comme des
--      charges du mois, quand une immobilisation forcée n'y entrait plus.
--
-- ========================================================== LA RÈGLE
--
-- La déclaration est une DONNÉE : ses lignes, leur sens (collectée,
-- déductible), la nature de ce qu'elles taxent, leurs dates d'effet et leurs
-- libellés (fr, en, ar par `ref.labels`). Aucun code de ligne n'est écrit en
-- TypeScript : le moteur du Socle remplit les lignes qu'on lui donne.
--
-- La nature d'une ligne d'extrait se lit, dans cet ordre :
--   - FORCÉE : sur les comptes de l'écriture du cabinet (#140) ;
--   - VALIDÉE : la pièce garde sa lecture (#140), et sa nature vient des
--     comptes de base de l'écriture validée — toutes en immobilisation, ou
--     aucune ; mêlées, on ne sait pas les rapporter aux lignes lues ;
--   - SINON : sur les articles lus, par la famille que le référentiel leur
--     donne (`charge_famille_resolve`) et le compte de cette famille, rangé
--     par le plan (`app.nature_des_comptes`) — jamais par un mot écrit ici.
--
-- Une facture mêlée se partage, au même taux, par ce que les lignes de
-- l'écriture ou les articles chiffrés attribuent à l'immobilisation : la base
-- attribuée, et sa TVA au prorata de la base, arrondie au pair à l'exposant de
-- la devise — l'arrondi du Socle (`domain/decimal.ts`) ; le reste à l'autre
-- nature. Ce qui ne s'attribue pas (un article d'immobilisation sans montant
-- ou sans taux, des bases qui dépassent la ligne) reste sur la nature PAR
-- DÉFAUT du référentiel, marqué `nature_attribuee: false` : la TVA du mois le
-- compte et le dit, jamais en silence.
--
-- INCERTAIN (à confirmer par un expert-comptable) :
--   - les lignes exactes du formulaire de déclaration mensuelle en vigueur. Le
--     plan NC 01 distingue 43662 « TVA sur immobilisations » et 43666 « TVA
--     sur autres biens et services » (`20260831120100_plan_officiel_nc01`) ;
--     le formulaire DGI n'a pas pu être consulté le 30 octobre 2026. Les
--     lignes livrées ici sont un défaut (R10), marquées `incertain` ;
--   - le partage de la TVA d'une facture mêlée au prorata des bases (égal à
--     taux × base au millime près) ;
--   - le défaut « autres biens et services » quand la nature ne s'attribue pas.
--
-- REJEU (R11) : dates d'effet prises sur `effective_from` du pack, aucun
-- `current_date` dans une donnée de référence ; `create or replace` partout.

begin;

-- --- 1. Les natures de ce qu'une TVA déductible taxe -------------------------------------------------

create table ref.tva_natures (
  code           text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  -- La nature d'une base que le plan range en immobilisation acquise
  -- (`app.nature_des_comptes`), ou de toute autre base.
  immobilisation boolean not null,
  -- La nature qui reçoit une TVA dont la nature n'a pas pu être attribuée.
  par_defaut     boolean not null,
  ordinal        smallint not null,
  description    text not null
);

create unique index tva_natures_une_par_sorte on ref.tva_natures (immobilisation);
create unique index tva_natures_un_seul_defaut on ref.tva_natures (par_defaut) where par_defaut;

comment on table ref.tva_natures is
  'Ce qu''une TVA déductible taxe : une immobilisation acquise, ou un autre bien ou service. '
  'La nature par défaut reçoit ce qui ne s''attribue pas (3 novembre 2026).';

insert into ref.tva_natures (code, immobilisation, par_defaut, ordinal, description) values
  ('IMMOBILISATIONS', true,  false, 1, 'Biens acquis portés en immobilisation (classe 2 du plan NC 01).'),
  ('BIENS_SERVICES',  false, true,  2, 'Autres biens et services.');

alter table ref.tva_natures enable row level security;
alter table ref.tva_natures force row level security;
revoke all on table ref.tva_natures from public, anon;
grant select on table ref.tva_natures to authenticated;
create policy ref_tva_natures_sel on ref.tva_natures for select to authenticated using (true);

-- --- 2. Les lignes de la déclaration -------------------------------------------------------------------

create table ref.tva_declaration_lignes (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  code            text not null check (code ~ '^[A-Z][A-Z0-9_]*$'),
  sens            text not null check (sens in ('collectee', 'deductible')),
  -- Nulle : la ligne reçoit toutes les natures de son sens.
  nature          text references ref.tva_natures (code),
  ordinal         smallint not null,
  -- Le libellé français ; ses traductions sont dans `ref.labels`
  -- (espace `tva_declaration_ligne`).
  label           text not null,
  -- D'où vient la ligne, daté.
  reference       text not null,
  -- R10 : un défaut livré que l'expert-comptable doit confirmer.
  incertain       boolean not null,
  valid_from      date not null,
  valid_to        date,
  check (valid_to is null or valid_to >= valid_from),
  unique (pack_version_id, code, valid_from)
);

-- Une seule ligne par sens et par nature à une date d'effet donnée.
create unique index tva_declaration_lignes_une_par_nature
  on ref.tva_declaration_lignes (pack_version_id, sens, coalesce(nature, ''), valid_from);

comment on table ref.tva_declaration_lignes is
  'Les lignes de la déclaration de TVA d''un pack, datées : le moteur du Socle range chaque '
  'seau (sens, nature) sur la sienne (3 novembre 2026).';

insert into ref.tva_declaration_lignes
  (pack_version_id, code, sens, nature, ordinal, label, reference, incertain, valid_from)
select p.id, v.code, v.sens, v.nature, v.ordinal, v.label, v.reference, true, p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   ('TVA_COLLECTEE', 'collectee', null::text, 10, 'TVA collectée',
    'Code de la TVA, art. 18 (déclaration mensuelle). Libellé du formulaire DGI : INCERTAIN, non consulté le 30/10/2026.'),
   ('TVA_DEDUCTIBLE_IMMOBILISATIONS', 'deductible', 'IMMOBILISATIONS', 20,
    'TVA déductible sur immobilisations',
    'Plan NC 01, compte 43662 « TVA sur immobilisations » (ref.accounts, 20260831120100). Ligne du formulaire DGI : INCERTAIN, non consultée le 30/10/2026.'),
   ('TVA_DEDUCTIBLE_BIENS_SERVICES', 'deductible', 'BIENS_SERVICES', 30,
    'TVA déductible sur autres biens et services',
    'Plan NC 01, compte 43666 « TVA sur autres biens et services » (ref.accounts, 20260831120100). Ligne du formulaire DGI : INCERTAIN, non consultée le 30/10/2026.')
 ) as v(code, sens, nature, ordinal, label, reference)
 where p.jurisdiction = 'TN';

insert into ref.labels (ns, key, locale, value) values
  ('tva_declaration_ligne', 'TVA_COLLECTEE', 'fr', 'TVA collectée'),
  ('tva_declaration_ligne', 'TVA_COLLECTEE', 'en', 'Output VAT'),
  ('tva_declaration_ligne', 'TVA_COLLECTEE', 'ar', 'الأداء على القيمة المضافة المستوجب'),
  ('tva_declaration_ligne', 'TVA_DEDUCTIBLE_IMMOBILISATIONS', 'fr', 'TVA déductible sur immobilisations'),
  ('tva_declaration_ligne', 'TVA_DEDUCTIBLE_IMMOBILISATIONS', 'en', 'Input VAT on fixed assets'),
  ('tva_declaration_ligne', 'TVA_DEDUCTIBLE_IMMOBILISATIONS', 'ar', 'الأداء على القيمة المضافة القابل للطرح على الأصول الثابتة'),
  ('tva_declaration_ligne', 'TVA_DEDUCTIBLE_BIENS_SERVICES', 'fr', 'TVA déductible sur autres biens et services'),
  ('tva_declaration_ligne', 'TVA_DEDUCTIBLE_BIENS_SERVICES', 'en', 'Input VAT on other goods and services'),
  ('tva_declaration_ligne', 'TVA_DEDUCTIBLE_BIENS_SERVICES', 'ar', 'الأداء على القيمة المضافة القابل للطرح على السلع والخدمات الأخرى');

alter table ref.tva_declaration_lignes enable row level security;
alter table ref.tva_declaration_lignes force row level security;
revoke all on table ref.tva_declaration_lignes from public, anon;
grant select on table ref.tva_declaration_lignes to authenticated;
create policy ref_tva_declaration_lignes_sel on ref.tva_declaration_lignes
  for select to authenticated using (true);

-- --- 3. L'arrondi au pair, celui du Socle ------------------------------------------------------------
--
-- `round()` de PostgreSQL arrondit la moitié en s'éloignant de zéro ; le Socle
-- arrondit au pair (`Decimal.ROUND_HALF_EVEN`). Un partage de TVA calculé ici
-- doit tomber au millime que le Socle aurait trouvé.

create or replace function app.arrondi_au_pair(p_x numeric, p_exposant integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  with s as (select p_x * power(10::numeric, p_exposant) as v)
  select round(
           case when abs(s.v - trunc(s.v)) = 0.5
                then trunc(s.v) + case when mod(trunc(s.v), 2) = 0 then 0 else sign(s.v) end
                else round(s.v) end
           / power(10::numeric, p_exposant),
           p_exposant)
    from s
$$;

revoke all on function app.arrondi_au_pair(numeric, integer) from public, anon;
grant execute on function app.arrondi_au_pair(numeric, integer) to authenticated;

-- --- 4. Les lignes d'un extrait, rangées par nature -----------------------------------------------------
--
-- `p_immo` : la base attribuée à l'immobilisation, par code de taxe. Une ligne
-- dont toute la base l'est prend la nature d'immobilisation ; aucune, l'autre ;
-- une partie, elle se partage en deux. Ce qui ne s'attribue pas prend la
-- nature par défaut, marqué. Une ligne qui ne se lit pas (montant absent ou
-- non décimal) laisse l'extrait tel quel : le contrat le refusera, nommé.

create or replace function app.lignes_par_nature(
  p_lines       jsonb,
  p_immo        jsonb,
  p_attribuable boolean,
  p_exposant    integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_immo   text;
  v_autre  text;
  v_defaut text;
  v_out    jsonb := '[]'::jsonb;
  l        jsonb;
  v_base   numeric;
  v_tva    numeric;
  v_part   numeric;
  v_tva_im numeric;
  v_meme   integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return p_lines;
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
              where jsonb_typeof(e) <> 'object'
                 or e ->> 'tax_code' is null
                 or coalesce(e ->> 'base_ht', '') !~ '^-?[0-9]+(\.[0-9]+)?$'
                 or coalesce(e ->> 'vat_amount', '') !~ '^-?[0-9]+(\.[0-9]+)?$') then
    return p_lines;
  end if;

  select n.code into v_immo from ref.tva_natures n where n.immobilisation;
  select n.code into v_autre from ref.tva_natures n where not n.immobilisation;
  select n.code into v_defaut from ref.tva_natures n where n.par_defaut;
  if v_immo is null or v_autre is null or v_defaut is null then
    -- R4, corollaire : aucun repli implicite. Le référentiel est incomplet.
    raise exception 'ref.tva_natures incomplet : une nature d''immobilisation, une autre, et un défaut sont requis'
      using errcode = 'P0001';
  end if;

  for l in select e from jsonb_array_elements(p_lines) e loop
    v_base := (l ->> 'base_ht')::numeric;
    v_tva  := (l ->> 'vat_amount')::numeric;
    v_part := coalesce((p_immo ->> (l ->> 'tax_code'))::numeric, 0);
    select count(*) into v_meme from jsonb_array_elements(p_lines) e
     where e ->> 'tax_code' = l ->> 'tax_code';

    if not coalesce(p_attribuable, false) or p_exposant is null
       or v_part < 0 or v_part > greatest(v_base, 0)
       or (v_part > 0 and v_part < v_base and v_meme > 1) then
      v_out := v_out || jsonb_build_array(
        l || jsonb_build_object('nature', v_defaut, 'nature_attribuee', false));
    elsif v_part = 0 then
      v_out := v_out || jsonb_build_array(
        l || jsonb_build_object('nature', v_autre, 'nature_attribuee', true));
    elsif v_part = v_base then
      v_out := v_out || jsonb_build_array(
        l || jsonb_build_object('nature', v_immo, 'nature_attribuee', true));
    else
      v_tva_im := app.arrondi_au_pair(v_tva * v_part / v_base, p_exposant);
      v_out := v_out || jsonb_build_array(
        l || jsonb_build_object(
          'base_ht', v_part::text,
          'vat_amount', v_tva_im::text,
          'ttc', (v_part + v_tva_im)::text,
          'nature', v_immo, 'nature_attribuee', true),
        l || jsonb_build_object(
          'base_ht', (v_base - v_part)::text,
          'vat_amount', (v_tva - v_tva_im)::text,
          'ttc', (v_base - v_part + v_tva - v_tva_im)::text,
          'nature', v_autre, 'nature_attribuee', true));
    end if;
  end loop;
  return v_out;
end
$$;

revoke all on function app.lignes_par_nature(jsonb, jsonb, boolean, integer) from public, anon;
grant execute on function app.lignes_par_nature(jsonb, jsonb, boolean, integer) to authenticated;

-- --- 5. Les lignes rangées d'une écriture prise en charge, forcée OU validée -------------------------
--
-- Le corps de `app.lignes_prises_en_charge` (20261101090000), l'origine en
-- paramètre : la nature d'une pièce VALIDÉE se lit sur les comptes de son
-- écriture, comme celle d'une pièce forcée. `lignes_prises_en_charge` en
-- devient l'appel pour « forcée » — une règle, un endroit.

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
     where x.id = app.ecriture_prise_en_charge_de(p_piece)
       and exists (select 1 from app.ecriture_prise_en_charge(pc.tenant_id, x.id) o
                    where o.origine = p_origine)
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

revoke all on function app.lignes_rangees(uuid, text) from public, anon, authenticated;

comment on function app.lignes_rangees(uuid, text) is
  'Les lignes de l''écriture prise en charge d''une pièce, de cette origine (forcee, validee), '
  'rangées par nature, au montant lu du côté de la pièce. Interne (3 novembre 2026).';

create or replace function app.lignes_prises_en_charge(p_piece uuid)
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
  -- FORCÉE seulement : le cabinet a saisi ou changé les lignes. Validée,
  -- l'écriture est la proposition du Socle tirée de la lecture, telle quelle ;
  -- la lecture, codée taux par taux, EST la décision du cabinet.
  select * from app.lignes_rangees(p_piece, 'forcee')
$$;

revoke all on function app.lignes_prises_en_charge(uuid) from public, anon, authenticated;

-- --- 6. Les montants pris en charge : une ligne par taux ET par nature ---------------------------------
--
-- Repris de `20261101090000`. Les lignes ne portent plus la marque
-- `immobilisation` (que le contrat retirait) mais leur NATURE, et une facture
-- mêlée se partage : la base attribuée à l'immobilisation, par taux, est la
-- somme des lignes de base que le plan range en immobilisation.

create or replace function app.montants_pris_en_charge(p_piece uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with l as (select * from app.lignes_prises_en_charge(p_piece)),
  t as (
    select coalesce(sum(montant) filter (where nature = 'base'), 0)  as ht,
           coalesce(sum(montant) filter (where nature = 'tva'), 0)   as tva,
           coalesce(sum(montant) filter (where nature = 'droit'), 0) as droits,
           coalesce(sum(montant) filter (where nature in ('tiers', 'autre')), 0) as contreparties,
           count(*) filter (where nature in ('tiers', 'autre') and montant < 0) as a_rebours
      from l
  ),
  par_code as (
    select tax_code,
           coalesce(sum(montant) filter (where nature = 'base'), 0) as ht,
           coalesce(sum(montant) filter (where nature = 'tva'), 0)  as tva,
           coalesce(sum(montant) filter (where nature = 'base' and immobilisation), 0) as ht_immo
      from l
     where nature in ('base', 'tva')
     group by tax_code
  ),
  droits as (
    select droit_code, sum(montant) as montant
      from l where nature = 'droit'
     group by droit_code
  ),
  lisible as (
    -- Une facture : aucune contrepartie du côté de la pièce, des totaux
    -- positifs, et HT + TVA + droits = ce que doivent les contreparties.
    select t.a_rebours = 0 and t.ht >= 0 and t.tva >= 0 and t.droits >= 0
           and t.ht + t.tva + t.droits > 0
           and t.ht + t.tva + t.droits = t.contreparties as ok
      from t
  )
  select case when exists (select 1 from l) then
    jsonb_build_object(
      'ecriture_id', (select min(ecriture_id::text) from l),
      'lisible', (select ok from lisible),
      'document_kind', (select p.document_kind from capture.pieces p
                         where p.id = app.version_courante(p_piece)),
      'date_ecriture', (select min(date_ecriture) from l),
      'currency', (select min(devise) from l))
    || case when (select ok from lisible) then jsonb_build_object(
      'lines', app.lignes_par_nature(
                 coalesce((select jsonb_agg(jsonb_build_object(
                             'label', pc.tax_code,
                             'tax_code', pc.tax_code,
                             'base_ht', pc.ht::text,
                             'vat_amount', pc.tva::text,
                             'ttc', (pc.ht + pc.tva)::text) order by pc.tax_code)
                             from par_code pc), '[]'::jsonb),
                 coalesce((select jsonb_object_agg(pc.tax_code, pc.ht_immo::text)
                             from par_code pc where pc.ht_immo <> 0), '{}'::jsonb),
                 true,
                 (select d.exposant::integer from ref.devises d
                   where d.code = (select min(devise) from l))),
      'other_charges', coalesce((select jsonb_agg(jsonb_build_object(
                                   'code', d.droit_code, 'label', d.droit_code,
                                   'amount', d.montant::text) order by d.droit_code)
                                   from droits d where d.montant <> 0), '[]'::jsonb),
      'totals', (select jsonb_build_object('base_ht', t.ht::text, 'vat', t.tva::text,
                                           'ttc', (t.ht + t.tva + t.droits)::text) from t))
    else '{}'::jsonb end
  end
$$;

revoke all on function app.montants_pris_en_charge(uuid) from public, anon;
grant execute on function app.montants_pris_en_charge(uuid) to authenticated;

-- --- 7. Ce que l'écriture VALIDÉE dit de la nature -----------------------------------------------------
--
-- Aucune ligne : la pièce n'est pas validée. Toutes les bases en
-- immobilisation : chaque ligne lue l'est entière. Aucune : aucune ne l'est.
-- Mêlées : l'écriture validée fond les bases (une ligne de charge pour tous
-- les taux), et rien ne dit quelle part de quelle ligne lue est
-- l'immobilisation — la nature ne s'attribue pas.
--
-- `app.validee_en_immobilisation` en est la question booléenne : une pièce
-- validée dont TOUTES les bases sont des immobilisations n'a aucune charge du
-- mois (« Vos charges » lit ses articles lus : ils n'y entrent pas).

create or replace function app.validee_en_immobilisation(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(r.immobilisation), false)
    from app.lignes_rangees(p_piece, 'validee') r
   where r.nature = 'base'
$$;

revoke all on function app.validee_en_immobilisation(uuid) from public, anon;
grant execute on function app.validee_en_immobilisation(uuid) to authenticated;

create or replace function app.immobilisations_validees(p_piece uuid, p_payload jsonb)
returns table (immo jsonb, attribuable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select r.immobilisation from app.lignes_rangees(p_piece, 'validee') r where r.nature = 'base'
  ),
  lues as (
    select e ->> 'tax_code' as code, e ->> 'base_ht' as base
      from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'lines') = 'array'
                                     then p_payload -> 'lines' else '[]'::jsonb end) e
  )
  select case when bool_and(b.immobilisation)
              then coalesce((select jsonb_object_agg(x.code, x.base)
                               from (select lu.code, sum(lu.base::numeric)::text as base
                                       from lues lu
                                      where lu.code is not null
                                        and lu.base ~ '^-?[0-9]+(\.[0-9]+)?$'
                                      group by lu.code) x), '{}'::jsonb)
              else '{}'::jsonb end,
         bool_and(b.immobilisation) or not bool_or(b.immobilisation)
    from b
  having count(*) > 0
$$;

revoke all on function app.immobilisations_validees(uuid, jsonb) from public, anon, authenticated;

-- --- 8. Ce que la LECTURE dit de la nature --------------------------------------------------------------
--
-- Chaque article lu prend la famille que le référentiel lui donne, au compte
-- d'imputation du pack (la même résolution que `piece_articles_v`), et la
-- famille son compte ; le plan dit si ce compte est une immobilisation. Un
-- article d'immobilisation sans montant, ou sans taux quand la pièce en porte
-- plusieurs, rend la pièce inattribuable.

-- Une famille d'articles est-elle une immobilisation, pour ce dossier, ce sens
-- et ce jour ? Son compte (`ref.charge_familles.main_account`), rangé par le
-- plan. La seule règle : la TVA (ci-dessous) et « Vos charges »
-- (`charges.articles`) la lisent toutes deux.

create or replace function app.famille_immobilisee(
  p_dossier uuid,
  p_pack    uuid,
  p_kind    text,
  p_jour    date,
  p_famille text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select n.immobilisation
      from ref.charge_familles f
      cross join lateral app.nature_des_comptes(
        null, p_dossier, p_pack, p_kind, p_jour, array[f.main_account]) n
     where f.pack_version_id = p_pack and f.code = p_famille and f.main_account is not null
       and f.valid_from <= p_jour and (f.valid_to is null or f.valid_to >= p_jour)
     order by f.valid_from desc
     limit 1), false)
$$;

revoke all on function app.famille_immobilisee(uuid, uuid, text, date, text) from public, anon;
grant execute on function app.famille_immobilisee(uuid, uuid, text, date, text) to authenticated;

create or replace function app.immobilisations_lues(p_piece uuid, p_payload jsonb)
returns table (immo jsonb, attribuable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (
    select app.pack_de_la_piece(p_piece) as pack,
           p.tenant_id as dossier,
           coalesce(p_payload ->> 'document_kind', p.document_kind) as kind,
           coalesce(case when p_payload ->> 'document_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                         then (p_payload ->> 'document_date')::date end,
                    p.created_at::date) as jour
      from capture.pieces p
     where p.id = app.version_courante(p_piece)
  ),
  codes as (
    select distinct e ->> 'tax_code' as code
      from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'lines') = 'array'
                                     then p_payload -> 'lines' else '[]'::jsonb end) e
     where e ->> 'tax_code' is not null
  ),
  imputation as (
    select m.main_account
      from ctx join ref.account_mappings m
        on m.pack_version_id = ctx.pack and m.document_kind = ctx.kind
     order by m.main_account
     limit 1
  ),
  articles as (
    select a.value ->> 'designation' as designation,
           case when a.value ->> 'total_ht' ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (a.value ->> 'total_ht')::numeric end as total,
           coalesce(a.value ->> 'tax_code',
                    case when (select count(*) from codes) = 1
                         then (select c.code from codes c) end) as code
      from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'articles') = 'array'
                                     then p_payload -> 'articles' else '[]'::jsonb end) a
  ),
  immos as (
    select ar.code, ar.total
      from articles ar
      cross join ctx
      left join imputation i on true
      cross join lateral public.charge_famille_resolve(ctx.pack, i.main_account, ar.designation,
                                                       ctx.jour) r
     where app.famille_immobilisee(ctx.dossier, ctx.pack, ctx.kind, ctx.jour, r.famille_code)
  )
  select coalesce((select jsonb_object_agg(x.code, x.total::text)
                     from (select im.code, sum(im.total) as total from immos im
                            where im.code is not null group by im.code) x), '{}'::jsonb),
         not exists (select 1 from immos im where im.total is null or im.code is null)
$$;

revoke all on function app.immobilisations_lues(uuid, jsonb) from public, anon, authenticated;

-- --- 9. L'extrait qui compte dans la TVA -----------------------------------------------------------------
--
-- Une seule porte pour la TVA de la PME (`extraitsTransmis`) ET celle du
-- cabinet (`bookedExtracts`) : forcée et lisible, les montants du cabinet ;
-- sinon la lecture. Dans les deux cas, chaque ligne porte sa nature.

create or replace function app.extrait_de_la_tva(p_piece uuid, p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_montants jsonb;
  v_immo     jsonb;
  v_attr     boolean;
  v_exposant integer;
begin
  if not app.piece_lisible(p_piece) then
    return null;
  end if;
  v_montants := app.montants_pris_en_charge(p_piece);
  if coalesce((v_montants ->> 'lisible')::boolean, false) then
    return coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'lines', v_montants -> 'lines',
      'other_charges', v_montants -> 'other_charges',
      'totals', v_montants -> 'totals',
      'document_date', v_montants -> 'date_ecriture',
      'currency', v_montants -> 'currency',
      'document_kind', v_montants -> 'document_kind');
  end if;
  if p_payload is null or jsonb_typeof(p_payload -> 'lines') is distinct from 'array' then
    return p_payload;
  end if;
  select d.exposant into v_exposant from ref.devises d where d.code = p_payload ->> 'currency';
  select v.immo, v.attribuable into v_immo, v_attr
    from app.immobilisations_validees(p_piece, p_payload) v;
  if not found then
    select r.immo, r.attribuable into v_immo, v_attr
      from app.immobilisations_lues(p_piece, p_payload) r;
  end if;
  return p_payload || jsonb_build_object(
    'lines', app.lignes_par_nature(p_payload -> 'lines', v_immo, v_attr, v_exposant));
end
$$;

revoke all on function app.extrait_de_la_tva(uuid, jsonb) from public, anon;
grant execute on function app.extrait_de_la_tva(uuid, jsonb) to authenticated;

comment on function app.extrait_de_la_tva(uuid, jsonb) is
  'L''extrait d''une pièce tel qu''il compte dans la TVA : les montants du cabinet si elle est '
  'forcée et que son écriture se lit, sa lecture sinon ; chaque ligne porte sa nature '
  '(ref.tva_natures), attribuée ou par défaut (3 novembre 2026).';

commit;
