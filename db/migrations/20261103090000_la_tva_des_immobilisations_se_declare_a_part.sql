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
--   - FORCÉE, et l'écriture se lit comme une facture : sur les comptes de
--     l'écriture du cabinet (#140) ;
--   - PRISE EN CHARGE autrement (validée, ou forcée sans se lire comme une
--     facture — un avoir) : la pièce garde sa lecture (#140), et sa nature
--     vient des comptes de base de l'écriture — toutes en immobilisation, ou
--     aucune ; mêlées, on ne sait pas les rapporter aux lignes lues. Une fois
--     l'écriture prise, ses comptes décident, jamais les familles d'articles ;
--   - SINON : sur les articles projetés (`piece_articles_v`, la seule
--     résolution des familles), par le compte de leur famille rangé au plan
--     (`app.nature_des_comptes`) — jamais par un mot écrit ici. « Vos
--     charges » suit la même règle.
--
-- La base attribuée à l'immobilisation l'est PAR CODE DE TAXE, et se répartit
-- entre les lignes de ce code au prorata de leurs bases, arrondie au pair à
-- l'exposant de la devise — l'arrondi du Socle (`domain/decimal.ts`) — la
-- dernière ligne prenant le reste : aucun millime perdu. Une ligne partagée
-- garde sa TVA au prorata, le reste à l'autre nature. Un avoir s'attribue
-- comme une facture (même signe, part au plus égale à la base). Ce qui ne
-- s'attribue pas (un article d'immobilisation sans montant ou sans taux, une
-- part qui dépasse la base, des signes contraires) reste sur la nature PAR
-- DÉFAUT du référentiel, marqué `nature_attribuee: false` : la TVA du mois le
-- compte et le dit, jamais en silence.
--
-- Revue indépendante de #145 (30 octobre 2026) : cette version répartit par
-- code (une facture d'immobilisation à deux lignes au même taux tombait par
-- défaut), accepte les avoirs, laisse l'écriture décider de « Vos charges »,
-- lit les pièces en une passe (la porte appelée par ligne coûtait 4,5 s pour
-- 200 pièces), et refuse les familles d'un dossier étranger.
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
-- `p_immo` : la base attribuée à l'immobilisation, PAR CODE DE TAXE. Elle se
-- répartit entre les lignes de ce code au prorata de leurs bases, arrondie au
-- pair à l'exposant de la devise ; la dernière ligne reçoit le reste, pour
-- qu'aucun millime ne se perde. Une ligne dont toute la base est attribuée
-- prend la nature d'immobilisation ; aucune, l'autre ; une partie, elle se
-- partage en deux (sa TVA au prorata, le reste à l'autre nature).
--
-- Un avoir s'attribue comme une facture : la part et la base ont le même
-- signe, et la part ne dépasse pas la base en valeur absolue. Ce qui ne
-- s'attribue pas (signes contraires, part trop grande, ligne de signe opposé
-- au code) prend la nature par défaut, marqué, pour TOUT le code. Une ligne
-- qui ne se lit pas (montant absent ou non décimal) laisse l'extrait tel
-- quel : le contrat le refusera, nommé.

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

  return (
    with l as (
      select t.e, t.ord, t.e ->> 'tax_code' as code,
             (t.e ->> 'base_ht')::numeric as base, (t.e ->> 'vat_amount')::numeric as tva
        from jsonb_array_elements(p_lines) with ordinality t(e, ord)
    ),
    c as (
      select l.*,
             sum(l.base) over (partition by l.code) as base_c,
             coalesce((p_immo ->> l.code)::numeric, 0) as part_c,
             row_number() over (partition by l.code order by l.ord desc) = 1 as dernier
        from l
    ),
    brute as (
      -- La part de chaque ligne au prorata ; la dernière du code prend le reste.
      select c.*,
             case when not c.dernier and c.base_c <> 0 and p_exposant is not null
                  then app.arrondi_au_pair(c.part_c * c.base / c.base_c, p_exposant) end as p_raw
        from c
    ),
    parts as (
      select b.*,
             case when b.dernier
                  then b.part_c - coalesce(sum(b.p_raw) over (partition by b.code), 0)
                  else coalesce(b.p_raw, 0) end as part
        from brute b
    ),
    codes as (
      select p.code,
             coalesce(p_attribuable, false) and p_exposant is not null
             and (min(p.part_c) = 0
                  or (min(p.base_c) <> 0
                      and sign(min(p.part_c)) = sign(min(p.base_c))
                      and abs(min(p.part_c)) <= abs(min(p.base_c))
                      and bool_and(p.part = 0
                                   or (sign(p.part) = sign(p.base)
                                       and abs(p.part) <= abs(p.base))))) as ok
        from parts p
       group by p.code
    ),
    sorties as (
      select p.ord, x.rang, x.ligne
        from parts p
        join codes k on k.code = p.code
        cross join lateral (
          select 1 as rang,
                 case
                   when not k.ok then
                     p.e || jsonb_build_object('nature', v_defaut, 'nature_attribuee', false)
                   when p.part = 0 then
                     p.e || jsonb_build_object('nature', v_autre, 'nature_attribuee', true)
                   when p.part = p.base then
                     p.e || jsonb_build_object('nature', v_immo, 'nature_attribuee', true)
                   else
                     p.e || jsonb_build_object(
                       'base_ht', p.part::text,
                       'vat_amount', app.arrondi_au_pair(p.tva * p.part / p.base, p_exposant)::text,
                       'ttc', (p.part + app.arrondi_au_pair(p.tva * p.part / p.base, p_exposant))::text,
                       'nature', v_immo, 'nature_attribuee', true)
                 end as ligne
          union all
          select 2,
                 p.e || jsonb_build_object(
                   'base_ht', (p.base - p.part)::text,
                   'vat_amount', (p.tva - app.arrondi_au_pair(p.tva * p.part / p.base, p_exposant))::text,
                   'ttc', (p.base - p.part + p.tva
                           - app.arrondi_au_pair(p.tva * p.part / p.base, p_exposant))::text,
                   'nature', v_autre, 'nature_attribuee', true)
           where k.ok and p.part <> 0 and p.part <> p.base
        ) x
    )
    select coalesce(jsonb_agg(s.ligne order by s.ord, s.rang), '[]'::jsonb) from sorties s
  );
end
$$;

revoke all on function app.lignes_par_nature(jsonb, jsonb, boolean, integer) from public, anon;
grant execute on function app.lignes_par_nature(jsonb, jsonb, boolean, integer) to authenticated;

-- --- 5. Les lignes rangées d'une écriture prise en charge, forcée OU validée -------------------------
--
-- Le corps de `app.lignes_prises_en_charge` (20261101090000), l'origine en
-- paramètre (nulle : forcée ou validée) : une fois l'écriture prise en charge,
-- ce sont SES comptes qui disent la nature, qu'elle soit forcée ou validée.
-- `lignes_prises_en_charge` en devient l'appel pour « forcée » — une règle,
-- un endroit.

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

-- --- 6 bis. Les pièces prises en charge de dossiers donnés, en une passe -------------------------------
--
-- Revue de #145 : demander à chaque pièce si une écriture la prend en charge
-- (`app.ecriture_prise_en_charge_de`) coûtait 1,7 ms par pièce, même pour
-- celles qu'aucun cabinet n'a touchées. On part des PRISES (index par dossier
-- client) : le coût suit les pièces prises en charge, pas toutes les pièces.
-- `app.pieces_prises_en_charge` (20261101090000) en devient l'appel pour tous
-- les dossiers de l'appelant — une règle, un endroit. Les dossiers demandés
-- sont restreints à ceux de l'appelant (membre, ou cabinet engagé).

create or replace function app.prises_des_dossiers(p_dossiers uuid[])
returns table (piece_id uuid, ecriture_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (c.courante) c.courante, e.id
    from socle.prises_en_charge pc
    join socle.ecritures e on e.id = pc.ecriture_id
    cross join lateral (select app.version_courante(e.piece_id) as courante) c
   where pc.client_tenant_id = any (p_dossiers)
     and pc.client_tenant_id in (select app.member_orgs() union select app.engaged_orgs())
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   order by c.courante, pc.prise_le desc
$$;

revoke all on function app.prises_des_dossiers(uuid[]) from public, anon;
grant execute on function app.prises_des_dossiers(uuid[]) to authenticated;

create or replace function app.pieces_prises_en_charge()
returns table (piece_id uuid, ecriture_id uuid, lisible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select v.piece_id, v.ecriture_id,
         coalesce((app.montants_pris_en_charge(v.piece_id) ->> 'lisible')::boolean, false)
    from app.prises_des_dossiers(array(select app.member_orgs() union select app.engaged_orgs())) v
$$;

revoke all on function app.pieces_prises_en_charge() from public, anon;
grant execute on function app.pieces_prises_en_charge() to authenticated;

-- --- 7. Ce que l'écriture PRISE EN CHARGE dit de la nature ----------------------------------------------
--
-- Une fois la pièce prise en charge — validée, ou forcée sans que son
-- écriture se lise comme une facture (elle garde alors sa lecture) —, ce sont
-- les comptes de l'écriture qui décident, jamais les familles des articles.
-- Toutes les bases en immobilisation : chaque ligne lue l'est entière. Aucune :
-- aucune ne l'est. Mêlées : l'écriture ne dit pas quelle part de quelle ligne
-- lue est l'immobilisation (la validée fond les bases en une ligne de charge)
-- — la nature ne s'attribue pas. Aucune ligne de base : pas de prise en charge.

create or replace function app.immobilisations_prises(p_piece uuid, p_payload jsonb)
returns table (immo jsonb, attribuable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select r.immobilisation from app.lignes_rangees(p_piece, null) r where r.nature = 'base'
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

revoke all on function app.immobilisations_prises(uuid, jsonb) from public, anon;
grant execute on function app.immobilisations_prises(uuid, jsonb) to authenticated;

-- La question booléenne, pour « Vos charges » : une pièce prise en charge dont
-- TOUTES les bases sont des immobilisations n'a aucune charge du mois.

create or replace function app.prise_en_immobilisation(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(r.immobilisation), false)
    from app.lignes_rangees(p_piece, null) r
   where r.nature = 'base'
$$;

revoke all on function app.prise_en_immobilisation(uuid) from public, anon;
grant execute on function app.prise_en_immobilisation(uuid) to authenticated;

-- --- 8. Ce que la LECTURE dit de la nature, tant qu'aucune écriture n'est prise -------------------------
--
-- Les familles d'articles qui sont des immobilisations, pour un dossier, un
-- pack, un sens et un jour : le compte de chaque famille
-- (`ref.charge_familles.main_account`) rangé par le plan, en UN appel de
-- `app.nature_des_comptes` pour toutes les familles. Le dossier doit être un
-- de ceux de l'appelant (membre ou cabinet engagé) : la fonction ne renseigne
-- pas sur le paramétrage d'un dossier étranger.

create or replace function app.familles_immobilisees(
  p_dossier uuid,
  p_pack    uuid,
  p_kind    text,
  p_jour    date)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_dossier is null
     or p_dossier not in (select app.member_orgs() union select app.engaged_orgs()) then
    raise exception 'dossier hors de portée' using errcode = '42501';
  end if;
  return (
    with f as (
      select f.code, f.main_account
        from ref.charge_familles f
       where f.pack_version_id = p_pack and f.main_account is not null
         and f.valid_from <= p_jour and (f.valid_to is null or f.valid_to >= p_jour)
    )
    select coalesce(array_agg(distinct f.code order by f.code), '{}')
      from f
      join app.nature_des_comptes(null, p_dossier, p_pack, p_kind, p_jour,
                                  array(select distinct x.main_account from f x)) n
        on n.account_code = f.main_account and n.immobilisation
  );
end
$$;

revoke all on function app.familles_immobilisees(uuid, uuid, text, date) from public, anon;
grant execute on function app.familles_immobilisees(uuid, uuid, text, date) to authenticated;

-- Parmi des articles lus d'un dossier, ceux qui ne sont PAS des charges du
-- mois : ceux d'une famille d'immobilisation, sur une pièce qu'aucune écriture
-- n'a prise en charge ; et tous ceux d'une pièce prise en charge dont
-- l'écriture ne porte que des immobilisations. L'appelant passe les articles
-- qu'il a déjà lus (`[{id, piece_id, pack, famille, kind, jour}]`, sa propre
-- requête sous sa RLS) : la vue des pièces n'est pas relue (revue de #145).
-- Ensembliste : une résolution des familles par (pack, sens, jour), une
-- question à l'écriture par pièce prise en charge — jamais par article.

create or replace function app.articles_immobilises(p_tenant uuid, p_articles jsonb)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  with a as (
    select (e ->> 'id')::uuid as id, (e ->> 'piece_id')::uuid as piece_id,
           (e ->> 'pack')::uuid as pack_version_id, e ->> 'famille' as famille_code,
           e ->> 'kind' as document_kind, (e ->> 'jour')::date as jour
      from jsonb_array_elements(coalesce(p_articles, '[]'::jsonb)) e
  ),
  prises as (
    select x.piece_id from app.prises_des_dossiers(array[p_tenant]) x
  ),
  cles as (
    select distinct a.pack_version_id, a.document_kind, a.jour
      from a
     where a.pack_version_id is not null
       and a.piece_id not in (select p.piece_id from prises p)
  ),
  immo as (
    select c.pack_version_id, c.document_kind, c.jour, f.code
      from cles c
      cross join lateral unnest(app.familles_immobilisees(p_tenant, c.pack_version_id,
                                                           c.document_kind, c.jour)) f(code)
  ),
  prises_en_immobilisation as (
    select p.piece_id from prises p
     where p.piece_id in (select a.piece_id from a)
       and app.prise_en_immobilisation(p.piece_id)
  )
  select a.id from a
   where (a.piece_id not in (select p.piece_id from prises p) and exists (
            select 1 from immo i
             where i.pack_version_id = a.pack_version_id and i.document_kind = a.document_kind
               and i.jour = a.jour and i.code = a.famille_code))
      or a.piece_id in (select p.piece_id from prises_en_immobilisation p)
$$;

revoke all on function app.articles_immobilises(uuid, jsonb) from public, anon;
grant execute on function app.articles_immobilises(uuid, jsonb) to authenticated;

-- --- 9. Les extraits qui comptent dans la TVA ---------------------------------------------------------
--
-- Une seule porte pour la TVA de la PME (`extraitsTransmis`) ET celle du
-- cabinet (`bookedExtracts`), ENSEMBLISTE : elle reçoit les pièces choisies
-- (`[{piece_id, payload}]`) et rend leur extrait, chaque ligne avec sa nature.
--   - forcée et lisible : les montants du cabinet ;
--   - prise en charge autrement : la lecture, natures des comptes de l'écriture ;
--   - sinon : la lecture, natures des familles de ses articles projetés
--     (`piece_articles_v`, la seule résolution des familles), au taux de
--     l'article lu au même rang ; les familles d'immobilisation se résolvent
--     une fois par (dossier, pack, sens, jour) pour toutes les pièces.
-- Sous la RLS de l'appelant (security invoker) : une pièce qu'il ne lit pas
-- rend un extrait nul.

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
begin
  -- Les pièces prises en charge, en une passe sur les dossiers des pièces.
  select coalesce(jsonb_object_agg(x.piece_id, x.ecriture_id), '{}'::jsonb) into v_prises
    from app.prises_des_dossiers(array(
           select distinct p.tenant_id from public.pieces_v p
            where p.id in (select (e ->> 'piece_id')::uuid
                             from jsonb_array_elements(coalesce(p_entrees, '[]'::jsonb)) e))) x;

  -- Les articles projetés de toutes les pièces, lus en UNE requête : lus
  -- pièce par pièce, la vue coûtait 5 ms chacune (revue de #145).
  select coalesce(jsonb_object_agg(x.piece_id, x.articles), '{}'::jsonb) into v_articles
    from (select a.piece_id,
                 jsonb_agg(jsonb_build_object(
                   'ordinal', a.ordinal, 'famille', a.famille_code, 'total', a.total_ht,
                   'pack', a.pack_version_id, 'jour', a.document_date)) as articles
            from public.piece_articles_v a
           where a.piece_id in (select (e ->> 'piece_id')::uuid
                                  from jsonb_array_elements(coalesce(p_entrees, '[]'::jsonb)) e)
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

revoke all on function app.extraits_de_la_tva(jsonb) from public, anon;
grant execute on function app.extraits_de_la_tva(jsonb) to authenticated;

comment on function app.extraits_de_la_tva(jsonb) is
  'Les extraits de pièces tels qu''ils comptent dans la TVA : les montants du cabinet si la pièce '
  'est forcée et que son écriture se lit, sa lecture sinon ; chaque ligne porte sa nature '
  '(ref.tva_natures), attribuée ou par défaut (3 novembre 2026).';

commit;
