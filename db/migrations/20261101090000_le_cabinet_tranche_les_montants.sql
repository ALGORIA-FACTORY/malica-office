-- Le cabinet tranche les montants, comme il tranche le sens.
--
-- Relevé sur staging le 30 octobre 2026, aller-retour complet : le cabinet
-- force l'écriture d'une pièce mal lue (HT 1 663,000 ; TVA 306,610 ; TTC
-- 1 969,610). La fiche de la PME continuait d'afficher la LECTURE — « TVA
-- 5,460 · Droit de timbre 2,000 », « TVA que vous récupérez 5,460 » — et les
-- chiffres du mois (charges, TVA) la comptaient aussi. Deux chiffres pour la
-- même pièce, et celui que la PME voyait était faux.
--
-- Règle du dirigeant : le cabinet décide. Une fois la pièce FORCÉE (le
-- cabinet a saisi ou changé les lignes), ses montants sont ceux de l'écriture
-- du cabinet ; avant, ceux de la lecture. La PME ne voit jamais l'écriture :
-- elle en lit les MONTANTS, rangés par nature (HT, TVA, droits, TTC).
--
-- VALIDÉE, la pièce garde sa lecture (Codex sur #140) : valider inscrit la
-- proposition du Socle, tirée de la lecture sans rien y changer — la lecture
-- EST la décision du cabinet, et elle seule porte le code de taxe de chaque
-- taux. L'écriture validée fond les bases de deux taux en une ligne, et une
-- facture exonérée n'y a pas de ligne de TVA : relue, elle perdrait ses codes.
--
-- Ce que ce fichier pose :
--   1. `app.ecriture_prise_en_charge_de(piece)` : l'écriture vivante prise en
--      charge par un cabinet, la même que lit `app.suivi_de_la_piece`.
--   2. `app.nature_des_comptes(...)` : ce qu'est un compte pour une pièce —
--      TVA, droit, tiers (contrepartie, trésorerie comprise), base (charge
--      ou produit) ou autre (une retenue, un compte d'attente). Par PRÉFIXE
--      (la hiérarchie du plan : 43666 est un 4366, 4011 un 401), depuis les
--      comptes que le DOSSIER, puis le CABINET, ont arrêtés pour chaque rôle,
--      puis le défaut du pack (R10, `ref.compte_du_role`). La classe d'un
--      compte vient de `ref.account_classes`. Aucun numéro écrit ici (R4).
--   3. `app.lignes_prises_en_charge(piece)` : les lignes de l'écriture, ainsi
--      rangées, au montant lu du côté de la pièce. Usage interne.
--   4. `app.montants_pris_en_charge(piece)` : ces lignes à la forme d'une
--      lecture (`lines`, `totals`, `other_charges` du contrat extract.v1),
--      et si l'écriture SE LIT comme une facture : aucune contrepartie du
--      côté de la pièce, HT + TVA + droits = total des contreparties. Sinon
--      la pièce garde sa lecture, et le cabinet le voit — jamais un chiffre
--      faux publié.
--   5. `app.charges_prises_en_charge(piece)` : ses charges, rangées par
--      famille, sans compte.
--   6. `pieces_qui_comptent_v.source` : « cabinet » quand la pièce est
--      forcée et que son écriture se lit, « lecture » sinon — par une
--      jointure, pas une fonction par ligne.
--   7. `app.suivi_de_la_piece` : le nom du comptable qui a pris la pièce en
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
  -- La même règle de lecture que la pièce (R6) : vivante, de nature « pièce »,
  -- sur toutes les versions, prise en charge par un cabinet — la plus récente
  -- prise d'abord.
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

-- --- 2. Ce qu'est un compte, pour une pièce -----------------------------------------------------------
--
-- Un rôle se résout comme `ref.compte_du_role` : le dossier, puis le cabinet,
-- puis le pack (son périmètre quand il en porte un : la banque est « 53 »).
-- La TVA : les comptes de TVA du pack et les rôles qui y sont liés. Un droit :
-- le compte du droit au pack, et le rôle qui y est lié. Le tiers : la
-- contrepartie du pack et tout rôle de tiers ou de trésorerie — un achat payé
-- comptant a la caisse pour contrepartie. La base : une charge ou un produit,
-- et une IMMOBILISATION acquise — un rôle que les schémas d'écriture du
-- journal de ce sens portent au montant HT sans être une charge ni un produit
-- (`ref.entry_template_lines`) : elle est HT, jamais une charge du mois, et
-- marquée pour que la déclaration puisse en isoler la TVA. Le reste est
-- « autre » : ni HT, ni charge.

create or replace function app.nature_des_comptes(
  p_cabinet uuid,
  p_dossier uuid,
  p_pack    uuid,
  p_kind    text,
  p_date    date,
  p_comptes text[])
returns table (account_code text, nature text, droit_code text, immobilisation boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with roles as (
    select r.code, r.famille, b.account_code as compte_livre,
           coalesce(d.account_code, c.account_code, b.perimetre, b.account_code) as prefixe
      from ref.account_roles r
      left join ref.role_bindings b
             on b.pack_version_id = p_pack and b.role_code = r.code
      left join parametrage.role_bindings c
             on c.portee = 'cabinet' and c.portee_id = p_cabinet and c.role_code = r.code
      left join parametrage.role_bindings d
             on d.portee = 'dossier' and d.portee_id = p_dossier and d.role_code = r.code
  ),
  droits as (
    select f.code, f.account_code
      from ref.fiscal_charges f
     where f.pack_version_id = p_pack and f.document_kind = p_kind
       and f.valid_from <= p_date and (f.valid_to is null or f.valid_to >= p_date)
  ),
  prefixes as (
    select m.vat_account as prefixe, 'tva' as nature, null::text as droit_code, 1 as rang
      from ref.account_mappings m
     where m.pack_version_id = p_pack and m.document_kind = p_kind
    union
    select ro.prefixe, 'tva', null, 1
      from roles ro
     where ro.compte_livre in (select m.vat_account from ref.account_mappings m
                                where m.pack_version_id = p_pack)
    union
    select dr.account_code, 'droit', dr.code, 2 from droits dr
    union
    select ro.prefixe, 'droit', dr.code, 2
      from droits dr join roles ro on ro.compte_livre = dr.account_code
    union
    select m.counterparty_account, 'tiers', null, 3
      from ref.account_mappings m
     where m.pack_version_id = p_pack and m.document_kind = p_kind
    union
    select ro.prefixe, 'tiers', null, 3
      from roles ro
     where ro.famille in ('tiers', 'tresorerie') and ro.prefixe is not null
    union
    select ro.prefixe, 'immobilisation', null, 4
      from roles ro
     where ro.prefixe is not null
       and ro.famille not in ('charge', 'produit')
       and ro.code in (
         select l.role_code
           from ref.entry_template_lines l
           join ref.entry_templates e on e.code = l.template_code
          where l.grandeur = 'montant_ht'
            and e.journal_code in (select m.journal_code from ref.account_mappings m
                                    where m.pack_version_id = p_pack
                                      and m.document_kind = p_kind))
  )
  select a.compte,
         case when t.nature = 'immobilisation' then 'base'
              else coalesce(t.nature,
                            case when cl.nature in ('charge', 'produit') then 'base'
                                 else 'autre' end) end,
         t.droit_code,
         coalesce(t.nature = 'immobilisation', false)
    from unnest(p_comptes) as a(compte)
    left join lateral (
      select x.nature, x.droit_code
        from prefixes x
       where x.prefixe is not null and a.compte like x.prefixe || '%'
       order by x.rang, length(x.prefixe) desc
       limit 1) t on true
    left join lateral (
      select k.nature
        from ref.account_classes k
       where k.pack_version_id = p_pack and a.compte like k.prefix || '%'
         and k.valid_from <= p_date and (k.valid_to is null or k.valid_to >= p_date)
       order by length(k.prefix) desc
       limit 1) cl on true
$$;

revoke all on function app.nature_des_comptes(uuid, uuid, uuid, text, date, text[]) from public, anon;
grant execute on function app.nature_des_comptes(uuid, uuid, uuid, text, date, text[]) to authenticated;

comment on function app.nature_des_comptes(uuid, uuid, uuid, text, date, text[]) is
  'Ce qu''est chaque compte pour une pièce de ce sens : tva, droit, tiers, base ou autre — par '
  'préfixe, depuis les comptes du dossier, puis du cabinet, puis du pack (1er novembre 2026).';

-- --- 3. Les lignes de l'écriture, rangées ---------------------------------------------------------
--
-- Le côté de la pièce : débit d'un achat, crédit d'une vente ; une
-- contrepartie (tiers, autre) se lit de l'autre côté. Le code de taxe d'une
-- ligne est le sien — le comptable le pose, il n'est jamais deviné ; une base
-- sans code prend le code unique des lignes de TVA de la MÊME écriture.

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
  with e as (
    select x.id, x.pack_version_id, x.date_ecriture, x.devise, x.tenant_id as dossier,
           pc.tenant_id as cabinet
      from socle.ecritures x
      join socle.prises_en_charge pc on pc.ecriture_id = x.id
     where x.id = app.ecriture_prise_en_charge_de(p_piece)
       -- FORCÉE seulement : le cabinet a saisi ou changé les lignes. Validée,
       -- l'écriture est la proposition du Socle tirée de la lecture, telle
       -- quelle ; la lecture, codée taux par taux, EST la décision du cabinet.
       and exists (select 1 from app.ecriture_prise_en_charge(pc.tenant_id, x.id) o
                    where o.origine = 'forcee')
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

-- Interne : la PME n'en reçoit que des montants, par les fonctions qui suivent.
revoke all on function app.lignes_prises_en_charge(uuid) from public, anon, authenticated;

comment on function app.lignes_prises_en_charge(uuid) is
  'Les lignes de l''écriture prise en charge d''une pièce, rangées par nature, au montant lu du '
  'côté de la pièce. Interne : jamais servie à un client (1er novembre 2026).';

-- --- 4. À la forme d'une lecture, si l'écriture se lit comme une facture --------------------------

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
    -- `immobilisation` : toute la base de ce taux est une immobilisation
    -- acquise, et sa TVA peut s'en déclarer à part.
    select tax_code,
           coalesce(sum(montant) filter (where nature = 'base'), 0) as ht,
           coalesce(sum(montant) filter (where nature = 'tva'), 0)  as tva,
           coalesce(bool_and(immobilisation) filter (where nature = 'base'), false)
             as immobilisation
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
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
                           'label', pc.tax_code,
                           'tax_code', pc.tax_code,
                           'base_ht', pc.ht::text,
                           'vat_amount', pc.tva::text,
                           'ttc', (pc.ht + pc.tva)::text,
                           'immobilisation', pc.immobilisation) order by pc.tax_code)
                           from par_code pc), '[]'::jsonb),
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

comment on function app.montants_pris_en_charge(uuid) is
  'Les montants d''une pièce prise en charge, tirés de l''écriture du cabinet, à la forme d''une '
  'lecture extract.v1, quand l''écriture se lit comme une facture (`lisible`). Nul tant que la pièce n''est pas forcée : validée, elle garde sa lecture.';

-- --- 5. Ses charges, sans compte -------------------------------------------------------------------

create or replace function app.charges_prises_en_charge(p_piece uuid)
returns table (ordinal smallint, montant numeric, famille_code text, famille_source text,
               date_ecriture date)
language sql
stable
security definer
set search_path = ''
as $$
  select l.ordinal, l.montant, r.famille_code, r.famille_source, l.date_ecriture
    from app.lignes_prises_en_charge(p_piece) l
    cross join lateral public.charge_famille_resolve(
      l.pack_version_id, l.account_code, l.libelle, l.date_ecriture) r
   -- Une immobilisation acquise est HT, jamais une charge du mois.
   where l.nature = 'base' and not l.immobilisation
   order by l.ordinal
$$;

revoke all on function app.charges_prises_en_charge(uuid) from public, anon;
grant execute on function app.charges_prises_en_charge(uuid) to authenticated;

-- --- 6. La pièce qui compte, et d'où viennent ses montants ----------------------------------------
--
-- Les pièces prises en charge des dossiers de l'appelant, en UNE passe : les
-- prises du cabinet, leurs écritures vivantes, la version courante de leur
-- pièce. La vue s'y joint ; aucune fonction n'est appelée par pièce.

create index if not exists prises_en_charge_client_idx
  on socle.prises_en_charge (client_tenant_id);

create or replace function app.pieces_prises_en_charge()
returns table (piece_id uuid, ecriture_id uuid, lisible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with vivantes as (
    select distinct on (c.courante) c.courante, e.id
      from socle.prises_en_charge pc
      join socle.ecritures e on e.id = pc.ecriture_id
      cross join lateral (select app.version_courante(e.piece_id) as courante) c
     where pc.client_tenant_id in (select app.member_orgs() union select app.engaged_orgs())
       and e.nature = 'piece'
       and app.ecriture_vivante(e.id)
     order by c.courante, pc.prise_le desc
  )
  select v.courante, v.id,
         coalesce((app.montants_pris_en_charge(v.courante) ->> 'lisible')::boolean, false)
    from vivantes v
$$;

revoke all on function app.pieces_prises_en_charge() from public, anon;
grant execute on function app.pieces_prises_en_charge() to authenticated;

-- Repris de `20261029120000`, plus une colonne EN FIN (une vue remplacée ne
-- réordonne pas ses colonnes) : `source`. Qui compte ne change pas.
create or replace view public.pieces_qui_comptent_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.vis, p.status, p.document_kind, p.transmise_le, p.created_at,
         case when pe.lisible then 'cabinet' else 'lecture' end as source
    from capture.pieces p
    join ref.document_types t on t.code = p.document_kind
    left join app.pieces_prises_en_charge() pe on pe.piece_id = p.id
   where t.porte_ecriture
     and p.vis <> 'personnel'::app.vis_t
     and p.doublon_de is null
     and p.status in ('proposee', 'confirmee', 'comptabilisee', 'supervisee')
     -- Une version précédente n'entre dans aucune déclaration : c'est la
     -- photo qui l'a remplacée qui compte.
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id);

comment on view public.pieces_qui_comptent_v is
  'La pièce qui entre dans les chiffres du mois (charges, TVA) : type qui porte écriture, dans la société, sans doublon, confirmée ou prise en charge. `source` : « cabinet » (forcée, son écriture se lit comme une facture) ou « lecture » (1er novembre 2026).';

-- --- 7. Le nom du comptable se lit au cabinet --------------------------------------------------------
--
-- Repris de `20261030090000`. La règle « le client lit Prise en charge, le
-- nom reste au cabinet » jugeait l'appelant par sa seule appartenance à la
-- société : un compte membre DES DEUX côtés lisait, à l'écran du cabinet,
-- « Forcée par · 30/10 00:22 ». Le nom se tait pour qui n'est que client.
-- L'écriture prise en charge est celle de `app.ecriture_prise_en_charge_de`.

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

  v_ecriture := app.ecriture_prise_en_charge_de(p_piece);
  if v_ecriture is not null then
    select pc.tenant_id, pc.prise_le, pc.par_nom
      into v_cabinet, prise_le, prise_par
      from socle.prises_en_charge pc
     where pc.ecriture_id = v_ecriture
     order by pc.prise_le desc
     limit 1;
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
