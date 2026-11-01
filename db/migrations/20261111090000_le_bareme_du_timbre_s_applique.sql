-- Le barème daté du droit de timbre s'applique (réglage `timbre.bareme`,
-- option `bareme_date`, défaut du pack décidé par le CEO le 31 octobre 2026).
--
-- ================================================================== POURQUOI
--
-- L'option était ENREGISTRÉE, pas appliquée : le Socle comparait tout timbre
-- imprimé au droit standard (`ref.fiscal_charges`, DROIT_TIMBRE), et une
-- facture de grande surface de 75 D qui imprime « 1,500 » — le tarif de son
-- émetteur — était bloquée (`FISCAL_CHARGE_MISMATCH`). Désormais, sous
-- `bareme_date`, le droit attendu se lit dans le barème DATÉ, à la date de la
-- pièce, selon la catégorie de l'émetteur :
--
--   * le droit standard : `ref.fiscal_charges` (déjà daté, lu à la date de la
--     pièce depuis la demande n° 87) ;
--   * les tranches d'une autre catégorie : `ref.baremes_des_droits` (les
--     grandes surfaces, LF 2026) ; hors de ses tranches, le droit standard ;
--   * la catégorie de l'émetteur : celle que le cabinet donne au tiers, dans
--     les tiers du dossier (`tiers.auxiliaires.categorie_de_bareme`, par la
--     porte `public.tiers_classer`), reconnu par son matricule fiscal.
--
-- Un émetteur que personne n'a classé : un timbre au droit standard passe (la
-- règle générale) ; un timbre au tarif d'une autre catégorie passe AVEC la
-- réserve « catégorie de l'émetteur à préciser » — Malica ne devine pas qui
-- est une grande surface ; un timbre qui n'est d'aucune catégorie bloque.
-- `fixe_1d` garde la comparaison au seul droit standard.
--
-- ============================================================== LES CATÉGORIES
--
-- `ref.categories_de_bareme` nomme les catégories d'émetteur, et laquelle est
-- au droit standard : le code n'écrit ni « standard » ni « grandes surfaces ».
-- Les tranches existantes s'y rattachent par une clé étrangère.
--
-- ================================================================== INCERTAIN
--
-- Rien n'est ajouté au barème : les montants (1,500 de 50 à 100 D ; 2,000
-- au-delà) et leur date (01/01/2026) sont ceux de `20261108090000`, que
-- `ref.fiscal_parameters` (TIMBRE_FACTURE_GS_50_100, TIMBRE_FACTURE_GS_SUP_100)
-- cite déjà : CDET art. 117-I-6 bis, ajouté par l'art. 20 de la LF n° 2025-17
-- du 12/12/2025, extrait « يتراوح مبلغها من 50 دينار إلى 100 دينار — 1,500 دينار ».
-- Restent INCERTAINS, à confirmer par un expert-comptable au JORT, et le
-- drapeau `unite_incertaine` reste levé :
--   * l'assiette des tranches — le Socle compare le TTC imprimé ;
--   * la borne de 100 D — le Socle la range dans la première tranche (« de 50
--     à 100 ») ; au-delà de 100 D, la seconde (« يفوق مبلغها 100 ») ;
--   * la facture d'une grande surface sous 50 D — le Socle lui applique le
--     droit standard (CDET art. 117-I-6, la règle générale) ;
--   * la date d'entrée en vigueur — la date de constat des éditions 2026
--     (`ref.fiscal_parameters`), pas une date lue au JORT ;
--   * ce qui fait, en droit, une « grande surface commerciale » — le cabinet
--     le tranche en classant le tiers ; aucun critère n'est écrit ici.
--
-- REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

-- --- 1. Les catégories d'émetteur d'un barème ------------------------------------------------------

create table ref.categories_de_bareme (
  code     text primary key check (code ~ '^[a-z][a-z_]*$'),
  ordre    smallint not null unique check (ordre > 0),
  -- La catégorie au droit standard (`ref.fiscal_charges.fixed_amount`) : une seule.
  standard boolean not null
);

create unique index categories_de_bareme_un_standard on ref.categories_de_bareme (standard)
  where standard;

comment on table ref.categories_de_bareme is
  'Les catégories d''émetteur d''un droit hors TVA tarifé par barème (le timbre). La catégorie '
  '« standard » paie le droit de ref.fiscal_charges ; les autres, leurs tranches de '
  'ref.baremes_des_droits. Le cabinet classe un tiers (tiers.auxiliaires.categorie_de_bareme).';

insert into ref.categories_de_bareme (code, ordre, standard) values
  ('standard', 1, true),
  ('grandes_surfaces', 2, false);

alter table ref.categories_de_bareme enable row level security;
alter table ref.categories_de_bareme force row level security;
revoke all on table ref.categories_de_bareme from public, anon;
grant select on table ref.categories_de_bareme to authenticated;
create policy ref_categories_de_bareme_sel on ref.categories_de_bareme
  for select to authenticated using (true);

alter table ref.baremes_des_droits
  add constraint baremes_des_droits_categorie_fkey
  foreign key (categorie) references ref.categories_de_bareme (code);

insert into ref.labels (ns, key, locale, value) values
  ('bareme_categorie', 'standard', 'fr', 'Standard'),
  ('bareme_categorie', 'standard', 'en', 'Standard'),
  ('bareme_categorie', 'standard', 'ar', 'عادي');

-- --- 2. La catégorie d'un tiers, que le cabinet donne ------------------------------------------------

alter table tiers.auxiliaires
  add column categorie_de_bareme text references ref.categories_de_bareme (code);

comment on column tiers.auxiliaires.categorie_de_bareme is
  'La catégorie de l''émetteur au barème d''un droit (le timbre), donnée par le cabinet ; nulle : '
  'non classé. La proposition d''une pièce la lit par le matricule fiscal de l''émetteur.';

create or replace view public.tiers_v with (security_invoker = true) as
select id, tenant_id, entity_id, nature, code, raison_sociale, identifiant_fiscal,
       compte_collectif, actif, note, cree_par, cree_le, categorie_de_bareme
  from tiers.auxiliaires;

-- La porte : une catégorie du référentiel, ou nulle pour rendre le tiers « non classé ».
create function public.tiers_classer(p_id uuid, p_categorie text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_categorie is not null
     and not exists (select 1 from ref.categories_de_bareme c where c.code = p_categorie) then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  update tiers.auxiliaires set categorie_de_bareme = p_categorie where id = p_id;
  if not found then
    raise exception 'refus.introuvable' using errcode = '42501';
  end if;
end
$$;

alter function public.tiers_classer(uuid, text) owner to portier;
revoke all on function public.tiers_classer(uuid, text) from public, anon;
grant execute on function public.tiers_classer(uuid, text) to authenticated;

-- --- 3. L'option est appliquée --------------------------------------------------------------------

update ref.reglages_comptables_options set applique = true
 where reglage = 'timbre.bareme' and code = 'bareme_date';

update ref.labels set value =
  'Unité exacte et assiette du barème grandes surfaces à confirmer au JORT (Malica compare le TTC '
  'imprimé ; une facture de grande surface sous 50 D paie le droit standard). Ce qui fait une '
  'grande surface : le cabinet classe le tiers. Exonérations (export, État) citées sans article : '
  'INCERTAIN.'
 where ns = 'reglage_sujet_incertain' and key = 'timbre' and locale = 'fr';
update ref.labels set value =
  'Exact unit and base of the large-retailer scale to be confirmed in the Official Journal (Malica '
  'compares the printed total incl. VAT; a large-retailer invoice under 50 D pays the standard '
  'duty). What makes a large retailer: the firm classifies the third party. Exemptions (exports, '
  'State) cited without an article: UNCERTAIN.'
 where ns = 'reglage_sujet_incertain' and key = 'timbre' and locale = 'en';
update ref.labels set value =
  'الوحدة الدقيقة وأساس جدول المساحات الكبرى للتأكيد في الرائد الرسمي (تقارن مليكة المبلغ الجملي '
  'المطبوع بكامل الأداءات؛ وفاتورة المساحة الكبرى دون 50 د تخضع للمعلوم العادي). ما يجعل من المورد '
  'مساحة كبرى: يصنّفه المكتب في الحرفاء والمزودين. الإعفاءات (التصدير، الدولة) مذكورة دون فصل: غير مؤكد.'
 where ns = 'reglage_sujet_incertain' and key = 'timbre' and locale = 'ar';

commit;
