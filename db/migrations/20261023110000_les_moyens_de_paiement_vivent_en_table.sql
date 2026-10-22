-- Les moyens de paiement en ligne vivent en table (22 octobre 2026).
--
-- Demandé par Wissem : « sans hardcoding, sans doublons, sans résidus, et tout
-- dans les tables », avec une page de choix du moyen de paiement et leurs
-- logos (Visa, Mastercard, ClicToPay, D17).
--
-- Avant : les prestataires (`aucun`, `simulateur`, `clictopay`) étaient écrits
-- dans trois CHECK, dans l'émission de la facture (« <> 'simulateur' »), dans
-- l'inscription d'un paiement, et dans deux unions TypeScript ; la devise
-- ISO « 788 » et l'unité « millime » dans le module ClicToPay ; le moyen
-- d'encaissement « carte » dans l'émission. Tout cela devient des LIGNES :
--
--   ref.devises                       code ISO 4217, code numérique, exposant
--   facturation.prestataires_paiement ce que chaque prestataire ouvre et fait
--   facturation.moyens_paiement       Visa, Mastercard, D17 — logo et rang
--   facturation.moyens_paiement_etats actif ou non, daté et motivé (R7)
--   facturation.moyens_par_prestataire quel prestataire accepte quel moyen
--
-- Les noms se traduisent dans `ref.labels` (`moyen_en_ligne`,
-- `prestataire_paiement`). Le code ne garde que l'ADAPTATEUR d'un prestataire
-- (parler à son API), désigné par la colonne `adaptateur`.
--
-- D17 (La Poste tunisienne) est inscrit, INACTIF : ClicToPay ne traite que les
-- cartes ; D17 demande une intégration avec La Poste, à contractualiser. Il ne
-- s'active qu'avec un moyen d'encaissement désigné (la base y veille).

-- --- 1. Les devises -----------------------------------------------------------

create table ref.devises (
  code          text primary key check (code ~ '^[A-Z]{3}$'),
  iso_numerique text not null unique check (iso_numerique ~ '^[0-9]{3}$'),
  -- Le nombre de décimales de l'unité : 3 pour le dinar (le millime).
  exposant      smallint not null check (exposant between 0 and 4)
);

comment on table ref.devises is
  'ISO 4217 : le code numérique qu''un prestataire de paiement attend, et le nombre '
  'de décimales de la plus petite unité.';

insert into ref.devises (code, iso_numerique, exposant) values
  ('TND', '788', 3),
  ('XOF', '952', 0),
  ('EUR', '978', 2);

alter table ref.devises enable row level security;
alter table ref.devises force row level security;
revoke all on table ref.devises from public, anon;
grant select on table ref.devises to authenticated;
create policy ref_devises_sel on ref.devises for select to authenticated using (true);

-- --- 2. Les prestataires ------------------------------------------------------

create table facturation.prestataires_paiement (
  code                     text primary key check (code ~ '^[a-z0-9_]+$'),
  -- Le module de l'API qui parle à ce prestataire ; null : rien à appeler.
  adaptateur               text check (adaptateur ~ '^[a-z0-9_]+$'),
  ouvre_le_paiement        boolean not null,
  -- Un prestataire qui ne fait entrer aucun argent (le simulateur) : ses
  -- « payés » ne s'imputent jamais sur une facture.
  fait_entrer_argent       boolean not null,
  exige_url_api            boolean not null,
  -- La langue de la page du prestataire.
  langue                   text check (langue in ('fr', 'en', 'ar')),
  logo                     text check (logo ~ '^/[a-z0-9/_.-]+$'),
  -- Le moyen d'encaissement inscrit sur la facture quand le paiement ne dit
  -- pas le sien (paiements d'avant le choix du moyen).
  moyen_encaissement_defaut text,
  rang                     smallint not null unique,
  constraint prestataire_ouvert_a_un_adaptateur check (not ouvre_le_paiement or adaptateur is not null),
  constraint prestataire_qui_encaisse_dit_comment
    check (not fait_entrer_argent or moyen_encaissement_defaut is not null)
);

comment on table facturation.prestataires_paiement is
  'Les prestataires de paiement en ligne et ce qu''ils font. Les secrets restent '
  'dans l''environnement du serveur.';

insert into facturation.prestataires_paiement
  (code, adaptateur, ouvre_le_paiement, fait_entrer_argent, exige_url_api, langue, logo,
   moyen_encaissement_defaut, rang) values
  ('aucun',      null,         false, false, false, null, null,                       null,    0),
  ('simulateur', 'simulateur', true,  false, false, null, null,                       null,    1),
  ('clictopay',  'clictopay',  true,  true,  true,  'fr', '/paiement/clictopay.webp', 'carte', 2);

-- --- 3. Les moyens ------------------------------------------------------------

create table facturation.moyens_paiement (
  code               text primary key check (code ~ '^[a-z0-9_]+$'),
  logo               text not null check (logo ~ '^/[a-z0-9/_.-]+$'),
  -- Ce que la facture inscrit à l'encaissement (`facturation.encaissements.moyen`).
  moyen_encaissement text,
  rang               smallint not null unique
);

create table facturation.moyens_paiement_etats (
  id         uuid primary key default gen_random_uuid(),
  moyen      text not null references facturation.moyens_paiement (code),
  actif      boolean not null,
  motif      text not null check (length(btrim(motif)) > 0),
  decide_par uuid,
  decide_le  timestamptz not null default now()
);

create index moyens_paiement_etats_idx on facturation.moyens_paiement_etats (moyen, decide_le desc);

create table facturation.moyens_par_prestataire (
  prestataire text not null references facturation.prestataires_paiement (code),
  moyen       text not null references facturation.moyens_paiement (code),
  primary key (prestataire, moyen)
);

comment on table facturation.moyens_paiement is
  'Les moyens de paiement en ligne montrés au client, leur logo et leur rang.';
comment on table facturation.moyens_paiement_etats is
  'Actif ou non, daté et motivé. La dernière décision vaut ; rien ne se réécrit.';

-- Un moyen ne s'active qu'avec un moyen d'encaissement : sinon la facture ne
-- saurait pas l'inscrire.
create or replace function facturation.moyen_actif_dit_comment_il_encaisse()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actif and not exists (select 1 from facturation.moyens_paiement m
                                where m.code = new.moyen and m.moyen_encaissement is not null) then
    raise exception 'un moyen de paiement s''active avec son moyen d''encaissement'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger moyen_actif_dit_comment_il_encaisse
  before insert on facturation.moyens_paiement_etats
  for each row execute function facturation.moyen_actif_dit_comment_il_encaisse();

insert into facturation.moyens_paiement (code, logo, moyen_encaissement, rang) values
  ('visa',       '/paiement/visa.webp',       'carte', 1),
  ('mastercard', '/paiement/mastercard.svg',  'carte', 2),
  ('d17',        '/paiement/d17.webp',        null,    3);

insert into facturation.moyens_paiement_etats (moyen, actif, motif) values
  ('visa',       true,  'Accepté par ClicToPay (décision du 22 octobre 2026)'),
  ('mastercard', true,  'Accepté par ClicToPay (décision du 22 octobre 2026)'),
  ('d17',        false, 'Intégration La Poste (D17) à contractualiser');

insert into facturation.moyens_par_prestataire (prestataire, moyen) values
  ('clictopay',  'visa'),
  ('clictopay',  'mastercard'),
  ('simulateur', 'visa'),
  ('simulateur', 'mastercard');

-- L'état en vigueur de chaque moyen.
create or replace view facturation.moyens_paiement_v with (security_invoker = true) as
select m.code, m.logo, m.rang, m.moyen_encaissement,
       coalesce(e.actif, false) as actif
  from facturation.moyens_paiement m
  left join lateral (
    select x.actif from facturation.moyens_paiement_etats x
     where x.moyen = m.code order by x.decide_le desc, x.id desc limit 1
  ) e on true;

do $$
declare t text;
begin
  foreach t in array array['prestataires_paiement', 'moyens_paiement', 'moyens_paiement_etats',
                           'moyens_par_prestataire'] loop
    execute format('alter table facturation.%I enable row level security', t);
    execute format('revoke all on table facturation.%I from public, anon', t);
    execute format('grant select on table facturation.%I to authenticated', t);
    -- Un référentiel : lisible par toute personne connectée, sans secret.
    execute format('create policy %I on facturation.%I for select to authenticated using (true)',
                   t || '_lire', t);
  end loop;
end $$;

create trigger moyens_paiement_etats_ne_se_reecrivent_pas
  before update or delete on facturation.moyens_paiement_etats
  for each row execute function app.deny_mutation();

grant select on facturation.moyens_paiement_v to authenticated;

-- --- 4. Les noms, traduits ----------------------------------------------------

insert into ref.labels (ns, key, locale, value) values
  ('moyen_en_ligne', 'visa', 'fr', 'Visa'),
  ('moyen_en_ligne', 'visa', 'en', 'Visa'),
  ('moyen_en_ligne', 'visa', 'ar', 'فيزا'),
  ('moyen_en_ligne', 'mastercard', 'fr', 'Mastercard'),
  ('moyen_en_ligne', 'mastercard', 'en', 'Mastercard'),
  ('moyen_en_ligne', 'mastercard', 'ar', 'ماستركارد'),
  ('moyen_en_ligne', 'd17', 'fr', 'D17 — La Poste tunisienne'),
  ('moyen_en_ligne', 'd17', 'en', 'D17 — Tunisian Post'),
  ('moyen_en_ligne', 'd17', 'ar', 'D17 — البريد التونسي'),
  ('prestataire_paiement', 'aucun', 'fr', 'Aucun (fermé)'),
  ('prestataire_paiement', 'aucun', 'en', 'None (closed)'),
  ('prestataire_paiement', 'aucun', 'ar', 'لا شيء (مغلق)'),
  ('prestataire_paiement', 'simulateur', 'fr', 'Simulateur (aucun argent n''entre)'),
  ('prestataire_paiement', 'simulateur', 'en', 'Simulator (no money comes in)'),
  ('prestataire_paiement', 'simulateur', 'ar', 'محاكي (لا يدخل أي مال)'),
  ('prestataire_paiement', 'clictopay', 'fr', 'ClicToPay'),
  ('prestataire_paiement', 'clictopay', 'en', 'ClicToPay'),
  ('prestataire_paiement', 'clictopay', 'ar', 'ClicToPay');

-- --- 5. Les CHECK en dur deviennent des clés étrangères -----------------------

alter table facturation.paiement_evenements
  drop constraint paiement_evenements_prestataire_check,
  add constraint paiement_evenements_prestataire_fk
    foreign key (prestataire) references facturation.prestataires_paiement (code),
  -- Le moyen choisi par le client, porté par l'événement « lien créé ».
  add column moyen text references facturation.moyens_paiement (code);

alter table plateforme.reglages_paiement
  drop constraint reglages_paiement_prestataire_check,
  drop constraint reglages_paiement_retour_si_ouvert,
  drop constraint reglages_paiement_api_si_clictopay,
  add constraint reglages_paiement_prestataire_fk
    foreign key (prestataire) references facturation.prestataires_paiement (code);

-- Les deux règles d'adresse se lisent désormais sur le prestataire.
create or replace function plateforme.reglage_paiement_coherent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p facturation.prestataires_paiement;
begin
  select * into p from facturation.prestataires_paiement where code = new.prestataire;
  if p.ouvre_le_paiement and (new.url_retour is null or new.url_retour !~ '^https?://') then
    raise exception 'un paiement ouvert a une adresse de retour' using errcode = 'check_violation';
  end if;
  if p.exige_url_api and (new.url_api is null or new.url_api !~ '^https://') then
    raise exception 'ce prestataire demande l''adresse https de son API'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger reglage_paiement_coherent
  before insert on plateforme.reglages_paiement
  for each row execute function plateforme.reglage_paiement_coherent();

-- Sans réglage : le prestataire qui n'ouvre rien, lu dans la table.
create or replace function public.paiement_reglage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('prestataire', r.prestataire, 'url_api', r.url_api,
                               'url_retour', r.url_retour, 'decide_le', r.decide_le)
       from plateforme.reglages_paiement r
      order by r.decide_le desc, r.id desc limit 1),
    (select jsonb_build_object('prestataire', p.code, 'url_api', null, 'url_retour', null,
                               'decide_le', null)
       from facturation.prestataires_paiement p
      where not p.ouvre_le_paiement
      order by p.rang limit 1))
$$;

revoke all on function public.paiement_reglage() from public, anon;
grant execute on function public.paiement_reglage() to authenticated;

-- --- 6. Inscrire un paiement : le moyen choisi, et le simulateur lu en table --

-- Un moyen est admis s'il est actif et que ce prestataire l'accepte. Une seule
-- règle, lue par l'API avant de demander un lien et redite à l'inscription.
create or replace function facturation.moyen_admis(p_moyen text, p_prestataire text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from facturation.moyens_paiement_v m
      join facturation.moyens_par_prestataire mp
        on mp.moyen = m.code and mp.prestataire = p_prestataire
     where m.code = p_moyen and m.actif)
$$;

-- Ce qu'il faut au prestataire pour ce moyen et cette devise : le code ISO
-- numérique et l'exposant. Refuse, par une clé, un moyen qui n'est pas admis.
create or replace function public.paiement_moyen_admis(
  p_moyen text, p_prestataire text, p_devise text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not facturation.moyen_admis(p_moyen, p_prestataire) then
    raise exception 'paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  select jsonb_build_object('iso_numerique', d.iso_numerique, 'exposant', d.exposant) into v
    from ref.devises d where d.code = p_devise;
  if v is null then
    raise exception 'devise inconnue de ref.devises : %', p_devise using errcode = 'no_data_found';
  end if;
  return v;
end
$$;

revoke all on function public.paiement_moyen_admis(text, text, text) from public, anon;
grant execute on function public.paiement_moyen_admis(text, text, text) to authenticated;

drop function public.paiement_inscrire(uuid, text, text, text, text, jsonb);

create or replace function public.paiement_inscrire(
  p_paiement uuid, p_etat text, p_prestataire text,
  p_reference text default null, p_lien text default null, p_detail jsonb default '{}'::jsonb,
  p_moyen text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_presta  facturation.prestataires_paiement;
begin
  select p.licence_id into v_licence from facturation.paiements_en_ligne p where p.id = p_paiement;
  if v_licence is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(v_licence) then
    raise exception 'paiement introuvable' using errcode = '42501';
  end if;
  select * into v_presta from facturation.prestataires_paiement where code = p_prestataire;
  if not found or not v_presta.ouvre_le_paiement then
    raise exception 'prestataire de paiement inconnu' using errcode = 'check_violation';
  end if;
  -- Un prestataire qui ne fait entrer aucun argent n'est admis que si l'API l'a
  -- déclaré pour la transaction, ce qu'elle ne fait que si la tour l'a ouvert.
  if not v_presta.fait_entrer_argent
     and coalesce(current_setting('malica.paiement_simulateur', true), '') <> 'oui' then
    raise exception 'le simulateur de paiement n''est pas ouvert ici' using errcode = '42501';
  end if;
  -- Le lien se crée pour un moyen choisi, actif, que ce prestataire accepte.
  if p_etat = 'lien_cree' and not facturation.moyen_admis(p_moyen, p_prestataire) then
    raise exception 'paiement.moyen_indisponible' using errcode = 'check_violation';
  end if;
  if p_etat = 'paye' and exists (select 1 from facturation.paiement_evenements e
                                  where e.paiement_id = p_paiement and e.etat = 'paye') then
    -- Déjà constaté : on ne le compte pas deux fois, on le rend.
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
  end if;

  insert into facturation.paiement_evenements
    (paiement_id, etat, prestataire, reference, lien, detail, moyen)
  values (p_paiement, p_etat, p_prestataire, p_reference, p_lien, coalesce(p_detail, '{}'::jsonb),
          case when p_etat = 'lien_cree' then p_moyen end);

  if p_etat = 'paye' then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select lo.tenant_id, auth.uid(), 'paiement.recu', 'facturation', 'paiements_en_ligne', p_paiement,
           jsonb_build_object('prestataire', p_prestataire, 'reference', p_reference)
      from facturation.licence_organisations lo
     where lo.licence_id = v_licence
     order by lo.tenant_id limit 1;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
end
$$;

revoke all on function public.paiement_inscrire(uuid, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.paiement_inscrire(uuid, text, text, text, text, jsonb, text) to authenticated;

-- --- 7. La facture du mois : le prestataire et le moyen lus en table ----------
--
-- Corps repris de 20261022400000 ; deux changements : l'acompte s'impute si son
-- prestataire fait entrer de l'argent (au lieu de « <> 'simulateur' »), et
-- l'encaissement porte le moyen choisi (au lieu de « carte » écrit en dur).


CREATE OR REPLACE FUNCTION facturation.emettre(p_licence uuid, p_periode date, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c          record;
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_sieges   smallint;
  l          record;
  v_tva      app.money_t;
  v_nom      text;
  v_legal    text;
  v_numero   text;
  v_id       uuid;
  v_faites   jsonb := '[]'::jsonb;
  v_premiere uuid;
  v_premier  text;
  v_ttc      app.money_t := 0;
  v_ht       app.money_t;
  v_recharge record;
  v_ordinal  smallint;
  v_paiement record;
  v_enc      uuid;
  v_annuel   facturation.engagements_annuels;
  v_debut    facturation.engagements_annuels;
  v_mois     app.money_t;
  v_couvert  boolean := false;
  v_par_cabinet boolean := false;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'une periode est un premier du mois' using errcode = 'check_violation';
  end if;

  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'licence introuvable' using errcode = 'no_data_found';
  end if;

  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'aucun emetteur designe (facturation.emetteurs)'
      using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  if v_pack is null then
    raise exception 'aucun pack de juridiction en vigueur pour l''emetteur (ref.jurisdiction_packs)'
      using errcode = 'no_data_found';
  end if;

  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack
     and r.code = 'TVA19'
     and r.valid_from <= current_date
     and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack
     and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date
     and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  if v_taux is null then
    raise exception 'aucun taux de TVA en vigueur (ref.tva_rates, code TVA19)'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'aucun droit de timbre en vigueur (ref.socle_params, code facture.droit_de_timbre)'
      using errcode = 'no_data_found';
  end if;

  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;

  for l in
    select * from facturation.a_facturer(p_licence, p_periode)
     order by payeur_type
  loop
    -- La part d'un CABINET ne se facture plus licence par licence : elle
    -- entre dans la facture mensuelle unique du cabinet
    -- (`facturation.emettre_cabinet`, 20 octobre 2026), un seul timbre.
    if l.payeur_type = 'cabinet' then
      v_par_cabinet := true;
      continue;
    end if;
    if l.payeur_type = 'cabinet' then
      select o.name, o.legal_id into v_nom, v_legal
        from identity.organizations o where o.id = l.payeur_tenant_id;
    else
      select p.display_name, null::text into v_nom, v_legal
        from identity.profiles p where p.user_id = l.payeur_personne;
    end if;

    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        'le destinataire % n''a pas de nom (identity.organizations.name ou identity.profiles.display_name)',
        coalesce(l.payeur_tenant_id, l.payeur_personne)
        using errcode = 'no_data_found';
    end if;

    -- L'ANNÉE (20261022190000). La part de l'offre d'un mois couvert est
    -- payée par l'engagement : il ne reste au mois que les places et sociétés
    -- en plus. Le mois où l'année commence porte sa ligne, une fois.
    v_mois   := l.montant_ht;
    v_annuel := null;
    v_debut  := null;
    if l.payeur_type = 'titulaire' then
      v_annuel := facturation.annuel_de(p_licence, p_periode);
      if v_annuel.id is not null then
        v_mois := greatest(0, l.montant_ht
                              - round(v_annuel.prix_mensuel_ht * l.jours / l.jours_du_mois, 3))::app.money_t;
      end if;
      select e.* into v_debut from facturation.engagements_annuels e
       where e.licence_id = p_licence and e.du = p_periode
         and not exists (select 1 from facturation.facture_annuels fa where fa.engagement_id = e.id)
       order by e.souscrit_le limit 1;
    end if;

    v_ht := v_mois;
    if l.payeur_type = 'titulaire' then
      select (v_mois + coalesce(v_debut.montant_ht, 0) + coalesce(sum(x.prix_ht), 0))::app.money_t into v_ht
        from facturation.recharges x
       where x.licence_id = p_licence
         and x.achetee_le < (p_periode + interval '1 month')::date
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
    end if;

    -- Un mois couvert par l'année, sans rien d'autre : aucune facture. Une
    -- facture à zéro ne porterait qu'un timbre, sans opération.
    if l.payeur_type = 'titulaire' and v_annuel.id is not null and v_ht = 0 then
      v_couvert := true;
      continue;
    end if;

    v_tva    := round(v_ht * v_taux, 3);
    v_numero := 'ALG-' || to_char(p_periode, 'YYYYMM') || '-'
                || lpad(nextval('facturation.numero_facture_seq')::text, 5, '0');

    insert into facturation.factures
      (licence_id, numero, periode, emise_le, echeance_le, offre_code,
       organisations, sieges_payants, montant_ht, taux_tva, montant_tva,
       timbre, montant_ttc, devise,
       payeur_type, payeur_tenant_id, payeur_personne,
       destinataire_nom, destinataire_legal_id, reference_abonne)
    values
      (p_licence, v_numero, p_periode, current_date,
       current_date + p_jours_echeance, l.offre_code,
       c.organisations, v_sieges, v_ht, v_taux, v_tva, v_timbre,
       v_ht + v_tva + v_timbre, v_emetteur.currency,
       l.payeur_type, l.payeur_tenant_id, l.payeur_personne,
       v_nom, v_legal, l.acces_reference)
    returning id into v_id;

    v_ordinal := 0;
    if v_annuel.id is null then
      v_ordinal := 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, 1,
              'Abonnement ' || l.offre_code || ' — '
              || to_char(p_periode, 'TMMonth YYYY')
              || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
              1, l.montant_ht, l.montant_ht);
    elsif v_mois > 0 then
      v_ordinal := 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, 1,
              'Places et sociétés en plus — ' || to_char(p_periode, 'TMMonth YYYY')
              || ' (l''offre est couverte par l''abonnement annuel)',
              1, v_mois, v_mois);
    end if;

    if v_debut.id is not null then
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal,
              'Abonnement annuel ' || v_debut.offre_code || ' — du '
              || to_char(v_debut.du, 'DD/MM/YYYY') || ' au ' || to_char(v_debut.au, 'DD/MM/YYYY')
              || ' (12 mois, ' || v_debut.mois_offerts || ' offerts)',
              1, v_debut.montant_ht, v_debut.montant_ht);
      insert into facturation.facture_annuels (facture_id, engagement_id) values (v_id, v_debut.id);
    end if;

    if l.payeur_type = 'titulaire' then
      for v_recharge in
        select x.id, x.lectures, x.prix_ht, x.achetee_le, x.origine
          from facturation.recharges x
         where x.licence_id = p_licence
           and x.achetee_le < (p_periode + interval '1 month')::date
           and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id)
         order by x.achetee_le, x.id
      loop
        v_ordinal := v_ordinal + 1;
        insert into facturation.facture_lignes
          (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
        values (v_id, v_ordinal,
                'Recharge ' || v_recharge.lectures || ' lectures'
                  || case when v_recharge.origine = 'automatique' then ' (automatique)' else '' end
                  || ' — ' || to_char(v_recharge.achetee_le, 'DD/MM/YYYY'),
                1, v_recharge.prix_ht, v_recharge.prix_ht);
        insert into facturation.facture_recharges (facture_id, recharge_id) values (v_id, v_recharge.id);
      end loop;

      for v_paiement in
        select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le,
               coalesce(mp.moyen_encaissement, pp.moyen_encaissement_defaut) as moyen
          from facturation.paiements_en_ligne p
          join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
          -- Seul un prestataire qui fait entrer de l'argent s'impute (la table le dit).
          join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                   and pp.fait_entrer_argent
          left join lateral (
            select x.moyen from facturation.paiement_evenements x
             where x.paiement_id = p.id and x.moyen is not null
             order by x.le desc, x.id desc limit 1
          ) choisi on true
          left join facturation.moyens_paiement mp on mp.code = choisi.moyen
         where p.licence_id = p_licence
           and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id)
         order by e.le, p.id
      loop
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_id, v_paiement.montant_ttc, v_paiement.moyen,
                v_paiement.prestataire || ' ' || coalesce(v_paiement.reference, v_paiement.id::text),
                v_paiement.le)
        returning id into v_enc;
        insert into facturation.paiement_imputations (paiement_id, encaissement_id)
        values (v_paiement.id, v_enc);
      end loop;
    end if;

    if v_premiere is null then
      v_premiere := v_id;
      v_premier  := v_numero;
    end if;
    v_ttc    := v_ttc + v_ht + v_tva + v_timbre;
    v_faites := v_faites || jsonb_build_object(
                  'facture_id', v_id, 'numero', v_numero,
                  'payeur_type', l.payeur_type,
                  'payeur', coalesce(l.payeur_tenant_id, l.payeur_personne),
                  'destinataire', v_nom,
                  'offre_code', l.offre_code,
                  'jours', l.jours, 'jours_du_mois', l.jours_du_mois,
                  'ht', v_ht,
                  'ttc', v_ht + v_tva + v_timbre);
  end loop;

  if jsonb_array_length(v_faites) = 0 then
    if v_couvert then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', 'annuel');
    end if;
    if v_par_cabinet then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', 'cabinet');
    end if;
    raise exception
      'rien a facturer sur cette licence pour % : aucun payeur sur la periode (facturation.a_facturer)',
      p_periode
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
    'factures', v_faites);
end
$function$;
