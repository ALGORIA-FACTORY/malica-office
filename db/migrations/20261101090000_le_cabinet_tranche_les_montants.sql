-- Le cabinet tranche les montants, comme il tranche le sens.
--
-- Relevé sur staging le 30 octobre 2026, aller-retour complet : le cabinet
-- force l'écriture d'une pièce mal lue (HT 1 663,000 ; TVA 306,610 ; TTC
-- 1 969,610). La fiche de la PME continuait d'afficher la LECTURE — « TVA
-- 5,460 · Droit de timbre 2,000 », « TVA que vous récupérez 5,460 » — et les
-- chiffres du mois (charges, TVA) la comptaient aussi. Deux chiffres pour la
-- même pièce, et celui que la PME voyait était faux.
--
-- Règle du dirigeant : le cabinet décide. Une fois la pièce prise en charge
-- (validée ou forcée), ses montants sont ceux de l'écriture du cabinet ;
-- avant, ceux de la lecture. La PME ne voit jamais l'écriture : elle en lit
-- les MONTANTS, rangés par nature (HT, TVA, droits, TTC).
--
-- Ce que ce fichier pose :
--   1. `app.ecriture_prise_en_charge_de(piece)` : l'écriture vivante prise en
--      charge par un cabinet, la même que lit `app.suivi_de_la_piece`.
--   2. `app.lignes_prises_en_charge(piece)` : ses lignes, chacune rangée par
--      le RÉFÉRENTIEL du pack de l'écriture — compte de TVA, compte de tiers
--      (`ref.account_mappings`), compte d'un droit (`ref.fiscal_charges`),
--      sinon base — avec son montant du côté de la pièce et son code de taxe.
--      Aucun numéro de compte n'est écrit ici ni dans le TypeScript (R4).
--   3. `app.montants_pris_en_charge(piece)` : ces lignes à la forme d'une
--      lecture (`lines`, `totals`, `other_charges` du contrat extract.v1),
--      pour la fiche et pour la TVA du mois.
--   4. `pieces_qui_comptent_v.source` : « cabinet » quand la pièce est prise
--      en charge, « lecture » sinon. Les chiffres du mois lisent l'un ou
--      l'autre, jamais les deux.
--   5. `app.suivi_de_la_piece` : le nom du comptable qui a pris la pièce en
--      charge se lit au cabinet, même quand le compte est AUSSI membre de la
--      société (« Forcée par · 30/10 00:22 », sans nom, relevé le même jour).
--
-- REJEU (R11) : `create or replace` partout ; aucune donnée de référence.

begin;

-- --- 1. L'écriture que le cabinet a prise en charge ------------------------------------------------

create or replace function app.ecriture_prise_en_charge_de(p_piece uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- La même règle de lecture que la pièce (R6), et la même écriture que le
  -- suivi : vivante, de nature « pièce », sur toutes les versions, prise en
  -- charge par un cabinet — la plus récente prise d'abord.
  select e.id
    from socle.ecritures e
    join socle.prises_en_charge pc on pc.ecriture_id = e.id
   where app.piece_lisible(p_piece)
     and e.piece_id in (select app.versions_de_la_piece(p_piece))
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   order by pc.prise_le desc
   limit 1
$$;

revoke all on function app.ecriture_prise_en_charge_de(uuid) from public, anon;
grant execute on function app.ecriture_prise_en_charge_de(uuid) to authenticated;

-- --- 2. Ses lignes, rangées par le référentiel ------------------------------------------------------
--
-- Le sens de la pièce (celui que le cabinet a établi) dit de quel côté se lit
-- un montant : au débit pour un achat, au crédit pour une vente ; le tiers,
-- de l'autre côté. Le code de taxe d'une ligne est le sien ; à défaut, celui
-- que le pack attache à son compte de TVA quand il n'y en a qu'un ; à défaut,
-- celui de la lecture quand elle n'en a lu qu'un. Une base sans code prend le
-- code unique des lignes de TVA de l'écriture. Rien n'est deviné au-delà :
-- un code qui ne se déduit pas reste nul, et la ligne le dit.

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
  devise          text
)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select x.id, x.pack_version_id, x.date_ecriture, x.devise
      from socle.ecritures x
     where x.id = app.ecriture_prise_en_charge_de(p_piece)
  ),
  k as (
    select p.document_kind from capture.pieces p where p.id = app.version_courante(p_piece)
  ),
  -- Le code de taxe que la lecture a lu, s'il n'y en a qu'un.
  lu as (
    select case when count(distinct l ->> 'tax_code') = 1 then min(l ->> 'tax_code') end as code
      from capture.extractions x
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(x.payload -> 'lines') = 'array' then x.payload -> 'lines'
             else '[]'::jsonb end) l
     where x.id = (select y.id from capture.extractions y
                    where y.piece_id = app.version_courante(p_piece)
                    order by y.created_at desc limit 1)
  ),
  rangees as (
    select l.ecriture_id, l.ordinal, l.account_code, l.libelle, l.tax_code as code_lu_sur_la_ligne,
           e.pack_version_id, e.date_ecriture, e.devise,
           case
             when exists (select 1 from ref.account_mappings m
                           where m.pack_version_id = e.pack_version_id
                             and m.document_kind = k.document_kind
                             and m.vat_account = l.account_code) then 'tva'
             when exists (select 1 from ref.account_mappings m
                           where m.pack_version_id = e.pack_version_id
                             and m.document_kind = k.document_kind
                             and m.counterparty_account = l.account_code) then 'tiers'
             when f.code is not null then 'droit'
             else 'base'
           end as nature,
           f.code as droit_code,
           (select min(m.tax_code) from ref.account_mappings m
             where m.pack_version_id = e.pack_version_id
               and m.document_kind = k.document_kind
               and m.vat_account = l.account_code
            having count(*) = 1) as code_du_compte,
           -- Le côté de la pièce : débit d'un achat, crédit d'une vente.
           case when k.document_kind = 'facture_vente' then l.credit - l.debit
                else l.debit - l.credit end as cote
      from e
      cross join k
      join socle.ecriture_lignes l on l.ecriture_id = e.id
      left join lateral (
        select c.code from ref.fiscal_charges c
         where c.pack_version_id = e.pack_version_id
           and c.document_kind = k.document_kind
           and c.account_code = l.account_code
           and c.valid_from <= e.date_ecriture
           and (c.valid_to is null or c.valid_to >= e.date_ecriture)
         order by c.code
         limit 1) f on true
  ),
  codees as (
    select r.*,
           case when r.nature = 'tva'
                then coalesce(r.code_lu_sur_la_ligne, r.code_du_compte, (select code from lu))
           end as code_tva
      from rangees r
  ),
  -- Le code unique des lignes de TVA de l'écriture, pour une base sans code.
  unique_tva as (
    select case when count(distinct code_tva) = 1 then min(code_tva) end as code
      from codees where nature = 'tva'
  )
  select c.ecriture_id, c.ordinal, c.nature, c.droit_code,
         case c.nature
           when 'tva' then c.code_tva
           when 'base' then coalesce(c.code_lu_sur_la_ligne, (select code from unique_tva),
                                     (select code from lu))
         end as tax_code,
         -- Le tiers se lit de l'autre côté : il porte le TTC, positif.
         case when c.nature = 'tiers' then -c.cote else c.cote end as montant,
         c.account_code, c.libelle, c.date_ecriture, c.pack_version_id, c.devise
    from codees c
   order by c.ordinal
$$;

revoke all on function app.lignes_prises_en_charge(uuid) from public, anon;
grant execute on function app.lignes_prises_en_charge(uuid) to authenticated;

comment on function app.lignes_prises_en_charge(uuid) is
  'Les lignes de l''écriture prise en charge d''une pièce, rangées par le référentiel du pack '
  '(TVA, tiers, droit, base), au montant lu du côté de la pièce. Usage interne : la PME n''en '
  'reçoit que des montants (Malica sans blocage, 1er novembre 2026).';

-- --- 3. À la forme d'une lecture ---------------------------------------------------------------------
--
-- `lines` : une ligne par code de taxe (base et TVA), comme une lecture ;
-- `other_charges` : un droit par code ; `totals` : HT, TVA et TTC, le TTC
-- étant la somme des trois natures du côté de la pièce. `null` quand la
-- pièce n'est pas prise en charge : on lit alors la lecture.

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
           coalesce(sum(montant) filter (where nature = 'droit'), 0) as droits
      from l
  ),
  par_code as (
    select tax_code,
           coalesce(sum(montant) filter (where nature = 'base'), 0) as ht,
           coalesce(sum(montant) filter (where nature = 'tva'), 0)  as tva
      from l
     where nature in ('base', 'tva')
     group by tax_code
  ),
  droits as (
    select droit_code, sum(montant) as montant
      from l where nature = 'droit'
     group by droit_code
  )
  select case when exists (select 1 from l) then jsonb_build_object(
    'ecriture_id', (select min(ecriture_id::text) from l),
    'date_ecriture', (select min(date_ecriture) from l),
    'currency', (select min(devise) from l),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
                         'label', coalesce(pc.tax_code, ''),
                         'tax_code', pc.tax_code,
                         'base_ht', pc.ht::text,
                         'vat_amount', pc.tva::text,
                         'ttc', (pc.ht + pc.tva)::text) order by pc.tax_code)
                         from par_code pc), '[]'::jsonb),
    'other_charges', coalesce((select jsonb_agg(jsonb_build_object(
                                 'code', d.droit_code, 'label', '', 'amount', d.montant::text)
                                 order by d.droit_code)
                                 from droits d where d.montant <> 0), '[]'::jsonb),
    'totals', (select jsonb_build_object('base_ht', t.ht::text, 'vat', t.tva::text,
                                         'ttc', (t.ht + t.tva + t.droits)::text) from t))
  end
$$;

revoke all on function app.montants_pris_en_charge(uuid) from public, anon;
grant execute on function app.montants_pris_en_charge(uuid) to authenticated;

comment on function app.montants_pris_en_charge(uuid) is
  'Les montants d''une pièce prise en charge, tirés de l''écriture du cabinet, à la forme d''une '
  'lecture extract.v1 (lines, other_charges, totals). Nul avant la prise en charge.';

-- --- 4. La pièce qui compte, et d'où viennent ses montants ----------------------------------------
--
-- Repris de `20261029120000`, plus une colonne EN FIN (une vue remplacée ne
-- réordonne pas ses colonnes) : `source`. Qui compte ne change pas ; ce qui
-- change, c'est d'où l'on tire ses chiffres.

create or replace view public.pieces_qui_comptent_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.vis, p.status, p.document_kind, p.transmise_le, p.created_at,
         case when app.ecriture_prise_en_charge_de(p.id) is not null
              then 'cabinet' else 'lecture' end as source
    from capture.pieces p
    join ref.document_types t on t.code = p.document_kind
   where t.porte_ecriture
     and p.vis <> 'personnel'::app.vis_t
     and p.doublon_de is null
     and p.status in ('proposee', 'confirmee', 'comptabilisee', 'supervisee')
     -- Une version précédente n'entre dans aucune déclaration : c'est la
     -- photo qui l'a remplacée qui compte.
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id);

comment on view public.pieces_qui_comptent_v is
  'La pièce qui entre dans les chiffres du mois (charges, TVA) : type qui porte écriture, dans la société, sans doublon, confirmée ou prise en charge. `source` : « cabinet » (prise en charge, ses montants viennent de l''écriture du cabinet) ou « lecture » (1er novembre 2026).';

-- --- 5. Le nom du comptable se lit au cabinet --------------------------------------------------------
--
-- Repris de `20261030090000`. La règle « le client lit Prise en charge, le
-- nom reste au cabinet » jugeait l'appelant par sa seule appartenance à la
-- société : un compte membre DES DEUX côtés lisait, à l'écran du cabinet,
-- « Forcée par · 30/10 00:22 ». Le nom se tait pour qui n'est que client.

create or replace function app.suivi_de_la_piece(p_piece uuid)
returns table (
  envoyee_le  timestamptz,
  vue_le      timestamptz,
  vue_par     text,
  corrigee_le timestamptz,
  prise_le    timestamptz,
  prise       text,
  prise_par   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_client boolean;
  v_ecriture uuid;
  v_cabinet  uuid;
begin
  if not app.piece_lisible(p_piece) then
    return;
  end if;
  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = app.version_courante(p_piece);
  -- Client SEULEMENT : membre de la société sans superviser son dossier.
  v_client := v_tenant in (select app.member_orgs())
              and not app.supervise_le_dossier(v_tenant);

  if v_vis = 'partage'::app.vis_t then
    envoyee_le := app.dernier_envoi(p_piece);
  end if;

  select v.vue_le, o.name into vue_le, vue_par
    from capture.vues v
    join identity.organizations o on o.id = v.cabinet_org_id
   where v.piece_id in (select app.versions_de_la_piece(p_piece))
   order by v.vue_le desc
   limit 1;

  corrigee_le := app.corrigee_par_le_client(p_piece);

  select e.id, pc.tenant_id, pc.prise_le, pc.par_nom
    into v_ecriture, v_cabinet, prise_le, prise_par
    from socle.ecritures e
    join socle.prises_en_charge pc on pc.ecriture_id = e.id
   where e.piece_id in (select app.versions_de_la_piece(p_piece))
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   order by pc.prise_le desc
   limit 1;
  if v_ecriture is not null then
    select x.origine into prise from app.ecriture_prise_en_charge(v_cabinet, v_ecriture) x;
  end if;
  -- Le client lit « Prise en charge » ; le nom du comptable reste au cabinet.
  if v_client then
    prise_par := null;
  end if;

  return next;
end
$$;

revoke all on function app.suivi_de_la_piece(uuid) from public, anon;
grant execute on function app.suivi_de_la_piece(uuid) to authenticated;

commit;
