-- Les réglages comptables : un jugement les suit, la lecture se borne, et les
-- codes ne portent plus de compte (revue indépendante de #154, 31 octobre 2026).
--
-- 1. LES CODES D'OPTION ne portent plus de numéro de compte : le compte vient
--    du pack (`ref.fiscal_charges`, `ref.immo_categories`), jamais du code.
--      fodec.traitement   par_article_4374_cout → par_article_au_cout
--                         achat_6652            → charge_non_recuperable
--      comptes_immo.plan  nc01_2282_43662       → selon_categorie
--    Les décisions déjà prises sous l'ancien code sont GARDÉES : la table est
--    en ajout seul, une décision équivalente sous le nouveau code s'ajoute,
--    datée de la même façon et une microseconde après, pour l'emporter.
-- 2. CE QUI EST APPLIQUÉ se dit juste :
--      immobilisation.traitement = actif_amorti : la réserve le dit, mais
--        l'écriture proposée reste au compte du paramétrage ; l'inscription
--        à l'actif n'est pas encore appliquée → `applique = false` ;
--      fodec.traitement = par_facture : le Socle ne calcule pas le FODEC, il
--        lit le montant imprimé ; au niveau de la facture ou de l'article, il
--        l'incorpore au coût de la même façon → `applique = true`.
-- 3. UN NOMBRE EST POSITIF : un seuil nul ou négatif est refusé.
-- 4. UNE RÉSOLUTION, PAS DEUX COPIES : les défauts du pack (`app.reglages_du_pack`)
--    et les décisions en vigueur (`app.decisions_en_vigueur`, pour la porte
--    générique comme pour la règle de change) ont chacun une fonction ; les
--    deux résolveurs s'en servent.
-- 5. UN JUGEMENT SUIT LES RÉGLAGES QU'IL A LUS : le contrôle d'immobilisation
--    garde le pack, le jour et les valeurs lues (`preuves.reglages`) ;
--    `app.reglages_du_jugement_a_jour` dit si la même question rend encore la
--    même réponse. Sinon, le jugement est périmé et se rejuge.
-- 6. LA LECTURE SE BORNE : une décision pour un dossier ne se lit que par le
--    dossier lui-même et par le cabinet qui le tient AUJOURD'HUI, et qui le
--    supervise (`app.engaged_orgs`) — ni par un collaborateur non affecté, ni
--    par un ancien cabinet. De même pour `parametrage.regles_de_change`.
-- 7. LE SEUIL D'UN DOSSIER NON ASSUJETTI se compare TTC (la TVA est alors un
--    coût) : INCERTAIN, à confirmer par un expert-comptable. Les mots le disent.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

-- --- 1. Les codes d'option ------------------------------------------------------------------------

create temporary table renommage (reglage text, ancien text, nouveau text) on commit drop;
insert into renommage values
  ('fodec.traitement', 'par_article_4374_cout', 'par_article_au_cout'),
  ('fodec.traitement', 'achat_6652', 'charge_non_recuperable'),
  ('comptes_immo.plan', 'nc01_2282_43662', 'selon_categorie');

update ref.reglages_comptables_options o
   set code = r.nouveau
  from renommage r
 where o.reglage = r.reglage and o.code = r.ancien;

update ref.socle_params s
   set value_text = r.nouveau
  from renommage r
 where s.code = r.reglage and s.value_text = r.ancien;

delete from ref.labels l
 using renommage r
 where l.ns = 'reglage_comptable_option' and l.key = r.reglage || ':' || r.ancien;

-- Les décisions prises sous l'ancien code, redites sous le nouveau.
insert into parametrage.reglages_comptables
  (tenant_id, portee, portee_id, pack_version_id, code, valeur, valid_from, motif, decide_par,
   decide_le)
select d.tenant_id, d.portee, d.portee_id, d.pack_version_id, d.code, r.nouveau, d.valid_from,
       coalesce(d.motif || ' — ', '') || 'code d''option renommé (' || r.ancien || ')',
       d.decide_par, d.decide_le + interval '1 microsecond'
  from parametrage.reglages_comptables d
  join renommage r on r.reglage = d.code and r.ancien = d.valeur;

-- --- 2. Ce qui est appliqué -----------------------------------------------------------------------

update ref.reglages_comptables_options set applique = false
 where reglage = 'immobilisation.traitement' and code = 'actif_amorti';
update ref.reglages_comptables_options set applique = true
 where reglage = 'fodec.traitement' and code = 'par_facture';

-- Les mots : aucun numéro de compte dans une option ; le seuil dit sa base.
delete from ref.labels
 where (ns = 'reglage_comptable_option'
        and key in ('timbre.bareme:bareme_date', 'comptes_immo.plan:extension_info'))
    or (ns = 'reglage_comptable' and key = 'immobilisation.seuil');

insert into ref.labels (ns, key, locale, value) values
  ('reglage_comptable_option', 'fodec.traitement:par_article_au_cout', 'fr',
   'FODEC par famille de produits, dans la base TVA ; vente au compte du pack, achat incorporé au coût'),
  ('reglage_comptable_option', 'fodec.traitement:par_article_au_cout', 'en',
   'FODEC by product family, in the VAT base; sale to the pack account, purchase included in cost'),
  ('reglage_comptable_option', 'fodec.traitement:par_article_au_cout', 'ar',
   'المعلوم حسب عائلة المنتجات، في أساس الأداء؛ البيع في حساب الحزمة، والشراء مدمج في الكلفة'),
  ('reglage_comptable_option', 'fodec.traitement:charge_non_recuperable', 'fr',
   'Comme l''option 1, mais achat au compte des taxes non récupérables du pack'),
  ('reglage_comptable_option', 'fodec.traitement:charge_non_recuperable', 'en',
   'As option 1, but purchase to the pack''s non-recoverable taxes account'),
  ('reglage_comptable_option', 'fodec.traitement:charge_non_recuperable', 'ar',
   'مثل الخيار 1، لكن الشراء في حساب الأداءات غير القابلة للاسترجاع في الحزمة'),
  ('reglage_comptable_option', 'comptes_immo.plan:selon_categorie', 'fr',
   'Compte selon la catégorie d''immobilisation du pack, TVA au compte des immobilisations'),
  ('reglage_comptable_option', 'comptes_immo.plan:selon_categorie', 'en',
   'Account by the pack''s fixed-asset category, VAT to the fixed-asset VAT account'),
  ('reglage_comptable_option', 'comptes_immo.plan:selon_categorie', 'ar',
   'الحساب حسب صنف الأصل الثابت في الحزمة، والأداء في حساب الأداء على الأصول الثابتة'),
  ('reglage_comptable_option', 'comptes_immo.plan:extension_info', 'fr',
   'Créer une extension « matériel informatique » sous le compte de la catégorie'),
  ('reglage_comptable_option', 'comptes_immo.plan:extension_info', 'en',
   'Create an "IT equipment" extension under the category account'),
  ('reglage_comptable_option', 'comptes_immo.plan:extension_info', 'ar',
   'إحداث تفريع «معدات إعلامية» تحت حساب الصنف'),
  ('reglage_comptable_option', 'timbre.bareme:bareme_date', 'fr',
   'Barème daté en base (standard et grandes surfaces), aux comptes du pack'),
  ('reglage_comptable_option', 'timbre.bareme:bareme_date', 'en',
   'Dated scale in the database (standard and large retailers), to the pack accounts'),
  ('reglage_comptable_option', 'timbre.bareme:bareme_date', 'ar',
   'جدول مؤرخ في القاعدة (عادي ومساحات كبرى)، في حسابات الحزمة'),
  ('reglage_comptable', 'immobilisation.seuil', 'fr',
   'Seuil d''immobilisation (HT ; TTC pour un dossier non assujetti)'),
  ('reglage_comptable', 'immobilisation.seuil', 'en',
   'Capitalisation threshold (excl. VAT; incl. VAT for a non-registered file)'),
  ('reglage_comptable', 'immobilisation.seuil', 'ar',
   'عتبة التثبيت (دون أداء؛ بكامل الأداء لملف غير خاضع)');

update ref.labels set value = value ||
  ' Pour un dossier non assujetti, le seuil se compare TTC, la TVA étant un coût : INCERTAIN.'
 where ns = 'reglage_sujet_incertain' and key = 'immobilisation' and locale = 'fr';
update ref.labels set value = value ||
  ' For a file not registered for VAT, the threshold is compared including VAT, VAT being a cost: UNCERTAIN.'
 where ns = 'reglage_sujet_incertain' and key = 'immobilisation' and locale = 'en';
update ref.labels set value = value ||
  ' لملف غير خاضع للأداء، تُقارن العتبة بكامل الأداء لأن الأداء كلفة: غير مؤكد.'
 where ns = 'reglage_sujet_incertain' and key = 'immobilisation' and locale = 'ar';

-- --- 3. Un nombre est positif ---------------------------------------------------------------------

create or replace function app.valeur_de_reglage_valide(p_code text, p_valeur text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case r.nature
      when 'option' then exists (select 1 from ref.reglages_comptables_options o
                                  where o.reglage = r.code and o.code = p_valeur)
      when 'nombre' then coalesce(p_valeur ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
                                  and p_valeur::numeric > 0, false)
      else false
    end
      from ref.reglages_comptables r
     where r.code = p_code and r.porte = 'reglages_comptables'), false)
$$;

-- --- 4. Les défauts du pack, les décisions en vigueur ---------------------------------------------

-- Les défauts des réglages de la porte générique au jour dit. Une donnée du
-- référentiel, lisible de tous ; le relevé d'essai la lit aussi.
create or replace function app.reglages_du_pack(p_pack uuid, p_jour date)
returns table (code text, valeur text, reference text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (s.code) s.code,
         coalesce(s.value_text, trim_scale(s.value_num)::text), s.legal_reference
    from ref.socle_params s
    join ref.reglages_comptables g on g.code = s.code and g.porte = 'reglages_comptables'
   where s.pack_version_id = p_pack
     and s.valid_from <= p_jour and (s.valid_to is null or s.valid_to >= p_jour)
   order by s.code, s.valid_from desc
$$;

revoke all on function app.reglages_du_pack(uuid, date) from public, anon;
grant execute on function app.reglages_du_pack(uuid, date) to authenticated;

-- La dernière décision VALIDE de chaque code, pour le dossier et pour le
-- cabinet qui le tient aujourd'hui (ou le cabinet lui-même), d'une porte. Une
-- décision dont la valeur a quitté le référentiel, ou nulle, ne décide rien.
-- Interne : les résolveurs vérifient les droits avant de l'appeler.
create or replace function app.decisions_en_vigueur(
  p_dossier uuid, p_pack uuid, p_jour date, p_porte text)
returns table (portee text, code text, valeur text, decide_le timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with toutes as (
    select r.tenant_id, r.portee, r.portee_id, r.code, r.valeur, r.valid_from, r.decide_le
      from parametrage.reglages_comptables r
     where p_porte = 'reglages_comptables' and r.pack_version_id = p_pack
    union all
    select r.tenant_id, r.portee, r.portee_id, r.code, r.valeur, r.valid_from, r.decide_le
      from parametrage.regles_de_change r
     where p_porte = 'regles_de_change' and r.pack_version_id = p_pack
  ),
  dernieres as (
    select distinct on (t.portee, t.code) t.portee, t.code, t.valeur, t.decide_le
      from toutes t
     where t.valid_from <= p_jour
       and t.tenant_id = app.cabinet_du_parametrage(p_dossier)
       and ((t.portee = 'dossier' and t.portee_id = p_dossier)
            or (t.portee = 'cabinet' and t.portee_id = t.tenant_id))
     order by t.portee, t.code, t.valid_from desc, t.decide_le desc
  )
  select d.portee, d.code, d.valeur, d.decide_le
    from dernieres d
   where d.valeur is not null
     and case p_porte
           when 'reglages_comptables' then app.valeur_de_reglage_valide(d.code, d.valeur)
           else app.valeur_de_change_valide(d.code, d.valeur)
         end
$$;

revoke all on function app.decisions_en_vigueur(uuid, uuid, date, text) from public, anon;

create or replace function app.regle_de_change(p_dossier uuid, p_pack uuid, p_jour date)
returns table (code text, valeur text, origine text, decide_le timestamptz, reference text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_dossier is null
     or not (p_dossier in (select app.member_orgs() union select app.engaged_orgs())
             or app.is_platform()) then
    raise exception 'refus.change.regle.droits' using errcode = '42501';
  end if;
  return query
    with pack as (
      select distinct on (s.code) s.code,
             coalesce(s.value_text, s.value_num::integer::text) as valeur, s.legal_reference
        from ref.socle_params s
       where s.pack_version_id = p_pack and s.code like 'change.%'
         and s.valid_from <= p_jour and (s.valid_to is null or s.valid_to >= p_jour)
       order by s.code, s.valid_from desc
    ),
    valides as (
      select * from app.decisions_en_vigueur(p_dossier, p_pack, p_jour, 'regles_de_change')
    )
    select p.code,
           coalesce(d.valeur, c.valeur, p.valeur),
           case when d.valeur is not null then 'dossier'
                when c.valeur is not null then 'cabinet'
                else 'pack' end,
           coalesce(d.decide_le, c.decide_le),
           p.legal_reference
      from pack p
      left join valides d on d.portee = 'dossier' and d.code = p.code
      left join valides c on c.portee = 'cabinet' and c.code = p.code
     order by p.code;
end
$$;

-- Les réglages de la porte générique, résolus, SANS contrôle de droits :
-- interne, pour le résolveur et pour la péremption d'un jugement.
create or replace function app.reglages_resolus(p_dossier uuid, p_pack uuid, p_jour date)
returns table (sujet text, code text, valeur text, origine text, decide_le timestamptz,
               reference text)
language sql
stable
security definer
set search_path = ''
as $$
  with valides as (
    select * from app.decisions_en_vigueur(p_dossier, p_pack, p_jour, 'reglages_comptables')
  )
  select g.sujet, p.code,
         coalesce(d.valeur, c.valeur, p.valeur),
         case when d.valeur is not null then 'dossier'
              when c.valeur is not null then 'cabinet'
              else 'pack' end,
         coalesce(d.decide_le, c.decide_le),
         p.reference
    from app.reglages_du_pack(p_pack, p_jour) p
    join ref.reglages_comptables g on g.code = p.code
    left join valides d on d.portee = 'dossier' and d.code = p.code
    left join valides c on c.portee = 'cabinet' and c.code = p.code
$$;

revoke all on function app.reglages_resolus(uuid, uuid, date) from public, anon;

create or replace function app.reglage_comptable(p_dossier uuid, p_pack uuid, p_jour date)
returns table (sujet text, code text, valeur text, origine text, decide_le timestamptz,
               reference text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Le dossier lui-même, le cabinet lui-même, ou le cabinet qui tient le
  -- dossier aujourd'hui et le supervise (`app.engaged_orgs`) : ni un
  -- collaborateur non affecté, ni un ancien cabinet.
  if p_dossier is null
     or not (p_dossier in (select app.member_orgs() union select app.engaged_orgs())
             or app.is_platform()) then
    raise exception 'refus.reglage_comptable.droits' using errcode = '42501';
  end if;
  return query
    select u.sujet, u.code, u.valeur, u.origine, u.decide_le, u.reference
      from (select r.sujet, r.code, r.valeur, r.origine, r.decide_le, r.reference
              from app.reglages_resolus(p_dossier, p_pack, p_jour) r
            union all
            select g.sujet, x.code, x.valeur, x.origine, x.decide_le, x.reference
              from app.regle_de_change(p_dossier, p_pack, p_jour) x
              join ref.reglages_comptables g on g.code = x.code and g.porte = 'regles_de_change') u
     order by u.sujet, u.code;
end
$$;

-- --- 5. Un jugement suit les réglages qu'il a lus ------------------------------------------------

create or replace function app.reglages_du_jugement_a_jour(p_dossier uuid, p_controles jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(
           (select jsonb_object_agg(r.code, r.valeur)
              from app.reglages_resolus(p_dossier, (c -> 'preuves' -> 'reglages' ->> 'pack')::uuid,
                                        (c -> 'preuves' -> 'reglages' ->> 'jour')::date) r
             where c -> 'preuves' -> 'reglages' -> 'valeurs' ? r.code)
           is not distinct from (c -> 'preuves' -> 'reglages' -> 'valeurs')), true)
    from jsonb_array_elements(case when jsonb_typeof(p_controles) = 'array'
                                   then p_controles else '[]'::jsonb end) c
   where jsonb_typeof(c -> 'preuves' -> 'reglages') = 'object'
$$;

revoke all on function app.reglages_du_jugement_a_jour(uuid, jsonb) from public, anon;
grant execute on function app.reglages_du_jugement_a_jour(uuid, jsonb) to authenticated;

-- --- 6. La lecture se borne -----------------------------------------------------------------------

drop policy reglages_comptables_sel on parametrage.reglages_comptables;
create policy reglages_comptables_sel on parametrage.reglages_comptables
  for select to authenticated
  using ((portee = 'cabinet' and tenant_id in (select app.member_orgs()))
         or (portee = 'dossier'
             and (portee_id in (select app.member_orgs())
                  or (portee_id in (select app.engaged_orgs())
                      and tenant_id in (select app.member_orgs()))))
         or (select app.is_platform()));

drop policy regles_de_change_sel on parametrage.regles_de_change;
create policy regles_de_change_sel on parametrage.regles_de_change
  for select to authenticated
  using ((portee = 'cabinet' and tenant_id in (select app.member_orgs()))
         or (portee = 'dossier'
             and (portee_id in (select app.member_orgs())
                  or (portee_id in (select app.engaged_orgs())
                      and tenant_id in (select app.member_orgs()))))
         or (select app.is_platform()));

commit;
