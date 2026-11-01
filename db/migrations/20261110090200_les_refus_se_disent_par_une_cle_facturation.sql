-- Les refus se disent par une clé : facturation et plateforme (audit d'intégrité, 1er novembre 2026).
--
-- Ces fonctions levaient leur refus en français brut — « piece introuvable ou
-- non autorisee », « seul le proprietaire principal donne une place » — et la
-- frontière de l'API (`refus.ts`) le rendait tel quel : un utilisateur qui lit
-- l'arabe ou l'anglais le lisait en français. Elles lèvent désormais une CLÉ
-- du dictionnaire (`@malica/socle/messages`, en fr, en et ar), que l'écran dit
-- dans la langue de la personne ; les valeurs citées suivent la clé, encodées
-- par `app.refus_avec_valeurs` (migration 20261110090000).
--
-- Chaque fonction est recréée depuis sa définition EN VIGUEUR
-- (`pg_get_functiondef` d'une base migrée), seul le message changeant : même
-- corps, même `security definer`, même `set search_path`. `create or replace`
-- garde le propriétaire (le portier, lot 6) et les droits. Avant et après,
-- `prosecdef`, `proowner`, `proconfig` et les droits de chaque fonction ont
-- été relevés : identiques. Les messages restants que la frontière rend tels
-- quels sont tenus à zéro par `la-base-tient-son-integrite.test.ts`.

begin;

CREATE OR REPLACE FUNCTION billing.next_invoice_number(p_tenant uuid, p_year smallint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prefix text;
  v_next   integer;
begin
  if not exists (select 1 from app.member_orgs() m where m = p_tenant) then
    raise exception 'refus.geste.non_permis' using errcode = 'insufficient_privilege';
  end if;

  insert into billing.invoice_sequences (tenant_id, year, last_number)
  values (p_tenant, p_year, 0)
  on conflict (tenant_id, year) do nothing;

  update billing.invoice_sequences s
     set last_number = s.last_number + 1
   where s.tenant_id = p_tenant and s.year = p_year
  returning s.prefix, s.last_number into v_prefix, v_next;

  return v_prefix || '-' || p_year::text || '-' || lpad(v_next::text, 6, '0');
end
$function$;

CREATE OR REPLACE FUNCTION facturation.a_facturer(p_licence uuid, p_periode date)
 RETURNS TABLE(payeur_type text, payeur_tenant_id uuid, payeur_personne uuid, offre_code text, acces_reference text, jours integer, jours_du_mois integer, montant_ht app.money_t)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (app.is_platform()
          or exists (select 1 from facturation.licences l
                      where l.id = p_licence and l.titulaire = auth.uid())
          or exists (select 1 from facturation.acces a
                      where a.licence_id = p_licence
                        and a.cabinet_tenant_id in (select app.member_orgs()))) then
    raise exception
      'refus.geste.non_permis'
      using errcode = '42501';
  end if;

  return query
  with mois as (
    select p_periode                                     as du,
           (p_periode + interval '1 month')::date         as au_exclu,
           ((p_periode + interval '1 month')::date - p_periode)::int as jours
  ),
  lignes as (
    select pv.payeur_type                        as payeur_type,
           pv.payeur_tenant_id                   as payeur_tenant_id,
           pv.payeur_personne                    as payeur_personne,
           pv.part_offre_code                    as part_offre_code,
           pv.acces_reference                    as acces_reference,
           pv.part_ht                            as part_ht,
           m.jours                               as jours_du_mois,
           greatest(pv.du, m.du)                 as seg_du,
           least(coalesce(pv.au_exclu, m.au_exclu), m.au_exclu) as seg_au_exclu
      from facturation.payeurs_v pv
      cross join mois m
     where pv.licence_id = p_licence
       and pv.du < m.au_exclu
       and (pv.au_exclu is null or pv.au_exclu > m.du)
  )
  select
    l.payeur_type,
    l.payeur_tenant_id,
    l.payeur_personne,
    (array_agg(l.part_offre_code order by l.seg_du desc))[1],
    (array_agg(l.acces_reference order by l.seg_du desc))[1],
    sum(l.seg_au_exclu - l.seg_du)::int,
    max(l.jours_du_mois)::int,
    round(sum(l.part_ht * (l.seg_au_exclu - l.seg_du) / l.jours_du_mois), 3)::app.money_t
  from lignes l
  group by l.payeur_type, l.payeur_tenant_id, l.payeur_personne;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.a_facturer_cabinet(p_cabinet uuid, p_periode date)
 RETURNS TABLE(licence_id uuid, tenant_id uuid, organisation text, reference text, offre_code text, jours integer, jours_du_mois integer, montant_ht app.money_t)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (app.is_platform() or p_cabinet in (select app.member_orgs())) then
    raise exception 'refus.geste.non_permis'
      using errcode = '42501';
  end if;

  return query
  with mois as (
    select p_periode                                     as du,
           (p_periode + interval '1 month')::date         as au_exclu,
           ((p_periode + interval '1 month')::date - p_periode)::int as jours
  ),
  lignes as (
    select pv.licence_id                         as licence_id,
           a.tenant_id                           as tenant_id,
           pv.acces_reference                    as reference,
           pv.part_offre_code                    as part_offre_code,
           pv.part_ht                            as part_ht,
           m.jours                               as jours_du_mois,
           greatest(pv.du, m.du)                 as seg_du,
           least(coalesce(pv.au_exclu, m.au_exclu), m.au_exclu) as seg_au_exclu
      from facturation.payeurs_v pv
      join facturation.acces a on a.id = pv.acces_id
      cross join mois m
     where pv.payeur_type = 'cabinet'
       and pv.payeur_tenant_id = p_cabinet
       and pv.du < m.au_exclu
       and (pv.au_exclu is null or pv.au_exclu > m.du)
  )
  select
    l.licence_id,
    l.tenant_id,
    o.name,
    (array_agg(l.reference order by l.seg_du desc))[1],
    (array_agg(l.part_offre_code order by l.seg_du desc))[1],
    sum(l.seg_au_exclu - l.seg_du)::int,
    max(l.jours_du_mois)::int,
    round(sum(l.part_ht * (l.seg_au_exclu - l.seg_du) / l.jours_du_mois), 3)::app.money_t
  from lignes l
  join identity.organizations o on o.id = l.tenant_id
  group by l.licence_id, l.tenant_id, o.name;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.acces_fige()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.canal is distinct from old.canal
     or new.cabinet_tenant_id is distinct from old.cabinet_tenant_id
     or new.offre_code is distinct from old.offre_code
     or new.offre_depuis is distinct from old.offre_depuis
     or new.propose_le is distinct from old.propose_le
     or new.propose_par is distinct from old.propose_par
     or new.episode is distinct from old.episode
     or new.reference is distinct from old.reference
  then
    raise exception 'refus.acces.fige'
      using errcode = 'check_violation';
  end if;

  if old.statut = 'termine' then
    raise exception 'refus.acces.termine'
      using errcode = 'check_violation';
  end if;
  if old.effet_du is not null and new.effet_du is distinct from old.effet_du then
    raise exception 'refus.acces.activation_figee'
      using errcode = 'check_violation';
  end if;
  if old.licence_id is not null and new.licence_id is distinct from old.licence_id then
    raise exception 'refus.acces.licence_figee'
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.acces_legitime()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind   text;
  v_regle  ref.offres_par_canal;
begin
  if new.canal = 'cabinet' then
    select o.kind into v_kind
      from identity.organizations o where o.id = new.cabinet_tenant_id;
    if v_kind is distinct from 'cabinet' then
      raise exception 'refus.acces.pour_un_autre'
        using errcode = 'check_violation';
    end if;

    -- Le mandat existe, et il est le même objet que partout ailleurs dans le
    -- dépôt : `identity.engagements`. Un cabinet n'ouvre pas un accès chez une
    -- société dont il n'est pas l'expert.
    if not exists (
      select 1 from identity.engagements e
       where e.cabinet_org_id = new.cabinet_tenant_id
         and e.pme_org_id = new.tenant_id
         and e.status in ('propose','actif')
    ) then
      raise exception
        'refus.mandat.hors_cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  v_regle := ref.canal_offre_a(new.canal, new.offre_code, new.propose_le);
  if v_regle.canal is null then
    raise exception '%', app.refus_avec_valeurs('refus.offre.canal_sans_regle', 'canal', (new.canal)::text, 'offre', (new.offre_code)::text, 'date', (new.propose_le)::text)
      using errcode = 'no_data_found';
  end if;
  if new.canal = 'cabinet' and not v_regle.cabinet_peut_ouvrir then
    raise exception '%', app.refus_avec_valeurs('refus.offre.pas_par_un_cabinet', 'offre', (new.offre_code)::text)
      using errcode = 'check_violation';
  end if;
  if new.canal = 'direct' and not (v_regle.libre_service or v_regle.commande_speciale) then
    raise exception '%', app.refus_avec_valeurs('refus.offre.pas_en_direct', 'offre', (new.offre_code)::text)
      using errcode = 'check_violation';
  end if;

  if (ref.offre_a(new.offre_code, new.offre_depuis)).code is null then
    raise exception 'refus.offre.hors_grille'
      using errcode = 'no_data_found';
  end if;

  -- Le lien, nommé : l'organisation de l'accès doit être CELLE de la licence.
  if new.licence_id is not null and not exists (
    select 1 from facturation.licence_organisations lo
     where lo.licence_id = new.licence_id and lo.tenant_id = new.tenant_id
  ) then
    raise exception 'refus.licence.organisation_non_rattachee'
      using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

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
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;

  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;

  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  if v_pack is null then
    raise exception 'refus.referentiel.manquant'
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
    raise exception 'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'refus.referentiel.manquant'
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
        '%', app.refus_avec_valeurs('refus.facturation.destinataire_sans_nom', 'destinataire', (coalesce(l.payeur_tenant_id, l.payeur_personne))::text)
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
               facturation.moyen_encaissement_du_paiement(p.id) as moyen
          from facturation.paiements_en_ligne p
          join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
          -- Seul un prestataire qui fait entrer de l'argent s'impute (la table le dit).
          join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                   and pp.fait_entrer_argent
         where p.licence_id = p_licence
           -- Le paiement d'une facture s'est inscrit sur ELLE, à la confirmation.
           and p.objet <> 'facture'
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
      '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text)
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
    'factures', v_faites);
end
$function$;

CREATE OR REPLACE FUNCTION facturation.emettre_cabinet(p_cabinet uuid, p_periode date, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_ht       app.money_t;
  v_tva      app.money_t;
  v_nb       integer;
  v_nom      text;
  v_legal    text;
  v_numero   text;
  v_id       uuid;
  l          record;
  v_ordinal  smallint := 0;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;
  if exists (select 1 from facturation.factures f
              where f.payeur_tenant_id = p_cabinet and f.periode = p_periode
                and f.licence_id is null and f.avoir_de is null) then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.deja_emise', 'periode', (p_periode)::text)
      using errcode = 'unique_violation';
  end if;

  select o.name, o.legal_id into v_nom, v_legal
    from identity.organizations o where o.id = p_cabinet and o.kind = 'cabinet';
  if v_nom is null then
    raise exception 'refus.introuvable.cabinet' using errcode = 'no_data_found';
  end if;

  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;
  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack and r.code = 'TVA19'
     and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;
  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;
  if v_taux is null or v_timbre is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;

  select coalesce(sum(a.montant_ht), 0), count(*) into v_ht, v_nb
    from facturation.a_facturer_cabinet(p_cabinet, p_periode) a
   where a.montant_ht > 0;
  if v_nb = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text) using errcode = 'no_data_found';
  end if;

  v_tva    := round(v_ht * v_taux, 3);
  v_numero := 'ALG-' || to_char(p_periode, 'YYYYMM') || '-'
              || lpad(nextval('facturation.numero_facture_seq')::text, 5, '0');

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations, sieges_payants,
     montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id)
  values
    (null, v_numero, p_periode, current_date, current_date + p_jours_echeance, null, v_nb, 0,
     v_ht, v_taux, v_tva, v_timbre, v_ht + v_tva + v_timbre, v_emetteur.currency,
     'cabinet', p_cabinet, null, v_nom, v_legal)
  returning id into v_id;

  for l in
    select * from facturation.a_facturer_cabinet(p_cabinet, p_periode) a
     where a.montant_ht > 0 order by a.organisation, a.licence_id
  loop
    v_ordinal := v_ordinal + 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht, licence_id, tenant_id)
    values (v_id, v_ordinal,
            'Abonnement ' || l.offre_code || ' — ' || l.organisation
              || coalesce(' (' || l.reference || ')', '') || ' — '
              || to_char(p_periode, 'TMMonth YYYY')
              || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
            1, l.montant_ht, l.montant_ht, l.licence_id, l.tenant_id);
  end loop;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'facture.emise', 'facturation', 'factures', v_id,
          jsonb_build_object('numero', v_numero, 'periode', p_periode, 'lignes', v_nb,
                             'ttc', v_ht + v_tva + v_timbre));
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_cabinet, 'facture.emise',
          jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'ttc', v_ht + v_tva + v_timbre));

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'lignes', v_nb,
                            'ht', v_ht, 'ttc', v_ht + v_tva + v_timbre);
end
$function$;

CREATE OR REPLACE FUNCTION facturation.facture_nomme_son_payeur()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_titulaire uuid;
  v_nom       text;
begin
  -- `facturation.emettre` nomme toujours le payeur : une ligne déjà nommée
  -- sort d'ici intacte, et c'est ce qui garde les deux factures du partage.
  if new.payeur_type is not null then
    return new;
  end if;

  select l.titulaire into v_titulaire
    from facturation.licences l
   where l.id = new.licence_id;
  if v_titulaire is null then
    raise exception
      '%', app.refus_avec_valeurs('refus.facturation.payeur_introuvable', 'licence', (new.licence_id)::text)
      using errcode = 'no_data_found';
  end if;

  new.payeur_type      := 'titulaire';
  new.payeur_personne  := v_titulaire;
  new.payeur_tenant_id := null;

  if new.destinataire_nom is null then
    select p.display_name into v_nom
      from identity.profiles p
     where p.user_id = v_titulaire
       and length(btrim(coalesce(p.display_name, ''))) > 0;
  end if;

  -- Et PAS de second recours sur le nom de l'organisation servie. Il avait ete
  -- ecrit, il est retire : le payeur deduit ici est une PERSONNE, et une
  -- facture adressee a une personne qui porterait le nom d'une societe est une
  -- mention legale fausse. R4 : on refuse la valeur plausible. Le payeur, lui,
  -- se deduit sans rien inventer — sur le canal direct il EST le titulaire,
  -- c'est un fait du modele.
  new.destinataire_nom := coalesce(new.destinataire_nom, v_nom);
  if new.destinataire_nom is null then
    raise exception
      '%', app.refus_avec_valeurs('refus.facturation.destinataire_sans_nom', 'destinataire', (v_titulaire)::text)
      using errcode = 'no_data_found';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.fiscalite_en_vigueur(p_le date DEFAULT CURRENT_DATE)
 RETURNS TABLE(taux numeric, timbre numeric, devise text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emetteur record;
  v_pack     uuid;
begin
  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= p_le
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= p_le
     and (p.effective_to is null or p.effective_to >= p_le)
   order by p.effective_from desc limit 1;

  select r.rate into taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack and r.code = 'TVA19'
     and r.valid_from <= p_le and (r.valid_to is null or r.valid_to >= p_le)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= p_le and (sp.valid_to is null or sp.valid_to >= p_le)
   order by sp.valid_from desc limit 1;

  -- Pas de repli (R4) : un montant calculé sous un taux supposé serait faux.
  if taux is null then
    raise exception 'refus.referentiel.manquant'
      using errcode = 'no_data_found';
  end if;
  devise := v_emetteur.currency;
  return next;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.forfait_fige()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.licence_id is distinct from old.licence_id
     or new.offre_code is distinct from old.offre_code
     or new.offre_depuis is distinct from old.offre_depuis
     or new.canal is distinct from old.canal
     or new.effet_du is distinct from old.effet_du
     or new.motif is distinct from old.motif
     or new.decide_par is distinct from old.decide_par
     or new.effet_au is null
  then
    raise exception
      'refus.forfait.periode_figee'
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.forfait_sans_trou()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_lignes   bigint;
  v_ouvertes bigint;
  v_fin      date;
begin
  select count(*), count(*) filter (where h.effet_au is null), max(h.effet_au)
    into v_lignes, v_ouvertes, v_fin
    from facturation.forfait_historique h
   where h.licence_id = new.licence_id;

  if v_lignes = 0 then
    return new;                       -- la première période d'une licence
  end if;
  if v_ouvertes > 0 then
    raise exception
      'refus.forfait.periode_ouverte'
      using errcode = 'check_violation';
  end if;
  if new.effet_du <> v_fin then
    raise exception
      '%', app.refus_avec_valeurs('refus.forfait.sans_trou', 'fin', (v_fin)::text, 'debut', (new.effet_du)::text)
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.licence_naitre(p_tenant uuid, p_titulaire uuid, p_offre text DEFAULT NULL::text, p_le date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_kind    text;
  v_offre   text;
begin
  -- D'ABORD la nature de la société, ENSUITE la porte. Dans l'autre ordre,
  -- un cabinet — dont le créateur est `expert`, jamais `dirigeant` — butait
  -- sur la porte au lieu d'être ignoré, et `create_organization` refusait
  -- d'ouvrir le moindre cabinet. Relevé par les épreuves, pas par la relecture.
  select o.kind into v_kind from identity.organizations o where o.id = p_tenant;
  if v_kind is distinct from 'pme' then
    return null;   -- un cabinet n'est pas abonné : il ouvre des accès.
  end if;

  -- La porte : le dirigeant de la société, ou la plateforme. Sans session
  -- (le rattrapage d'une migration), c'est la migration qui décide.
  if auth.uid() is not null
     and not (app.is_platform() or app.has_org_role(p_tenant, array['dirigeant'])) then
    raise exception 'refus.reserve.dirigeant_ou_plateforme'
      using errcode = '42501';
  end if;

  -- Idempotente : une société ne porte qu'une licence, et la sienne se rend.
  select lo.licence_id into v_licence
    from facturation.licence_organisations lo where lo.tenant_id = p_tenant;
  if v_licence is not null then
    return v_licence;
  end if;

  v_offre := p_offre;
  if v_offre is null then
    select c.offre_code into v_offre
      from ref.offres_par_canal c
     where c.canal = 'direct' and c.par_defaut and c.effective_from <= p_le
     order by c.effective_from desc
     limit 1;
    -- Aucun repli : sans offre de naissance en vigueur, on ne l'invente pas.
    if v_offre is null then
      raise exception '%', app.refus_avec_valeurs('refus.offre.naissance_absente', 'date', (p_le)::text)
        using errcode = '22023';
    end if;
  end if;

  -- Le déclencheur `licences_ouvre_historique` ouvre la première période ;
  -- `rattachement_legitime` vérifie que le titulaire dirige la société.
  insert into facturation.licences (titulaire, offre_code, offre_depuis, origine)
  values (p_titulaire, v_offre, p_le, 'direct')
  returning id into v_licence;

  insert into facturation.licence_organisations (licence_id, tenant_id)
  values (v_licence, p_tenant);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, coalesce(auth.uid(), p_titulaire), 'licence.nee', 'facturation',
          'licences', v_licence, jsonb_build_object('offre', v_offre, 'depuis', p_le));

  return v_licence;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.moyen_actif_dit_comment_il_encaisse()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.actif and not exists (select 1 from facturation.moyens_paiement m
                                where m.code = new.moyen and m.moyen_encaissement is not null) then
    raise exception 'refus.paiement.encaissement_requis'
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.naissance_immuable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.origine is distinct from old.origine
     or new.origine_cabinet is distinct from old.origine_cabinet
     or new.offre_code is distinct from old.offre_code
     or new.offre_depuis is distinct from old.offre_depuis
     or (new.titulaire is distinct from old.titulaire
         and coalesce(current_setting('facturation.transmission', true), '') <> old.id::text)
  then
    raise exception
      'refus.licence.naissance_figee'
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.periode_se_ferme_seulement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'refus.facturation.periode_non_supprimable'
      using errcode = 'check_violation';
  end if;
  if old.effet_au is not null then
    raise exception 'refus.facturation.periode_fermee'
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.place_disponible()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence   uuid;
  v_titulaire uuid;
  v_max       smallint;
begin
  -- Un membre de cabinet (`expert`) n'est pas un siège du client : il entre
  -- par le mandat, pas par le forfait de la PME.
  if new.role = 'expert' then
    return new;
  end if;

  v_licence := facturation.licence_de(new.tenant_id);

  -- Une organisation sans licence est une organisation en cours de création,
  -- ou un cabinet : son créateur y entre, la licence naît juste après
  -- (`20261022100000`).
  if v_licence is null then
    return new;
  end if;

  -- Le propriétaire principal est dans le prix de l'offre.
  select l.titulaire into v_titulaire from facturation.licences l where l.id = v_licence;
  if new.user_id = v_titulaire then
    return new;
  end if;

  -- La personne déjà présente ailleurs dans le groupe n'occupe pas une place
  -- de plus : on ne compte que les personnes nouvelles.
  if exists (
    select 1
    from facturation.licence_organisations lo
    join identity.memberships m on m.tenant_id = lo.tenant_id
    where lo.licence_id = v_licence
      and m.user_id = new.user_id
      and m.role in ('dirigeant', 'collaborateur', 'assistant')
  ) then
    return new;
  end if;

  select sieges_max into v_max from facturation.droits_v where licence_id = v_licence;

  -- `sieges_max` vide : sans plafond (20261022090000).
  if v_max is not null and facturation.places_occupees(v_licence) >= v_max then
    raise exception
      '%', app.refus_avec_valeurs('refus.place.offre_pleine', 'places', (v_max)::text)
      using errcode = 'check_violation',
            hint = 'Passer à l''offre supérieure, ou libérer une place.';
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.place_offrir(p_tenant uuid, p_email text, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_max     smallint;
  v_inclus  smallint;
begin
  -- La porte nommée d'abord (le contrat de `schema.test.ts`), puis la règle du
  -- 19 octobre : parmi les dirigeants, seul le titulaire donne une place.
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;

  v_licence := facturation.licence_de(p_tenant);

  if v_licence is not null then
    -- Une place à la fois : deux invitations simultanées liraient le même
    -- compte de places et passeraient toutes les deux.
    perform 1 from facturation.licences l where l.id = v_licence for update;
    if not exists (select 1 from facturation.licences l
                    where l.id = v_licence and l.titulaire = auth.uid()) then
      raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
    end if;
    select sieges_max, sieges_inclus into v_max, v_inclus
      from facturation.droits_v where licence_id = v_licence;
    if v_max is not null and facturation.places_occupees(v_licence) >= v_max then
      raise exception '%', app.refus_avec_valeurs('refus.place.offre_pleine', 'places', (v_max)::text)
        using errcode = 'check_violation',
              hint = 'Passer à l''offre supérieure, ou libérer une place.';
    end if;
    -- Depuis l'application Android, une place qui serait facturée ne s'offre
    -- pas. Une invitation déjà en attente pour cette adresse est rendue telle
    -- quelle plus bas : elle n'engage rien de plus.
    if coalesce(current_setting('malica.client_coque', true), '') = 'oui'
       and not exists (select 1 from identity.invitations i
                        where i.tenant_id = p_tenant and lower(i.email) = lower(btrim(p_email))
                          and i.accepted_at is null and i.revoked_at is null
                          and i.expires_at > now())
       and facturation.places_engagees(v_licence) >= coalesce(v_inclus, 0) then
      raise exception 'refus.place.incluses_prises' using errcode = 'check_violation';
    end if;
  end if;

  return public.cabinet_inviter(p_tenant, p_email, p_role);
end
$function$;

CREATE OR REPLACE FUNCTION facturation.rattachement_legitime()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_titulaire uuid;
  v_droits    record;
begin
  select titulaire into v_titulaire
    from facturation.licences where id = new.licence_id;

  if not exists (
    select 1 from identity.memberships m
     where m.tenant_id = new.tenant_id
       and m.user_id = v_titulaire
       and m.role = 'dirigeant'
  ) and not exists (
    select 1 from facturation.acces a
     where a.licence_id = new.licence_id
       and a.tenant_id = new.tenant_id
       and a.statut in ('actif','suspendu')
  ) then
    raise exception
      'refus.licence.rattachement_illegitime'
      using errcode = 'check_violation';
  end if;

  select organisations, organisations_max into v_droits
    from facturation.droits_v where licence_id = new.licence_id;
  if v_droits.organisations >= v_droits.organisations_max then
    raise exception 'refus.licence.organisation_de_plus'
      using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.recharge_inscrire(p_licence uuid, p_code text, p_origine text, p_par uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_palier ref.recharges;
  v_id     uuid;
begin
  v_palier := ref.recharge_a(p_code, current_date);
  if v_palier.code is null then
    raise exception 'refus.recharge.palier_inconnu' using errcode = 'check_violation';
  end if;

  insert into facturation.recharges
    (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
  values
    (p_licence, v_palier.code, v_palier.lectures, v_palier.prix_ht, current_date,
     case when v_palier.validite_mois is null then 'infinity'::date
          else (current_date + make_interval(months => v_palier.validite_mois))::date end, p_origine, p_par)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, p_par, 'recharge.achetee', 'facturation', 'recharges', v_id,
         jsonb_build_object('palier', v_palier.code, 'origine', p_origine,
                            'lectures', v_palier.lectures, 'prix_ht', v_palier.prix_ht)
    from facturation.licence_organisations lo
   where lo.licence_id = p_licence
   order by lo.tenant_id
   limit 1;

  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.reference_abonne(p_tenant uuid, p_episode integer, p_cabinet uuid, p_a date)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f        ref.reference_abonne;
  v_numero integer;
  v_marque text;
begin
  select * into f from ref.reference_abonne r
   where r.code = 'abonnement' and r.effective_from <= p_a
   order by r.effective_from desc limit 1;
  if f.code is null then
    raise exception
      '%', app.refus_avec_valeurs('refus.facturation.format_de_reference', 'date', (p_a)::text)
      using errcode = 'no_data_found';
  end if;

  select a.numero into v_numero
    from facturation.abonnes a where a.tenant_id = p_tenant;
  if v_numero is null then
    raise exception
      'refus.facturation.sans_numero_d_abonne'
      using errcode = 'no_data_found';
  end if;

  if p_cabinet is null then
    -- La marque d'un abonné sans cabinet. La quatrième place répond toujours à
    -- « qui sert cet abonné » ; en direct, c'est ALGORIA.
    v_marque := f.marque_directe;
  else
    select facturation.trigramme(o.name) into v_marque
      from identity.organizations o where o.id = p_cabinet;
    if v_marque is null then
      raise exception 'refus.introuvable.cabinet' using errcode = 'no_data_found';
    end if;
  end if;

  return f.prefixe || f.separateur || lpad(v_numero::text, f.largeur_numero, '0')
      || f.separateur || lpad(p_episode::text, f.largeur_episode, '0')
      || f.separateur || v_marque;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.reste_du_payable(p_facture uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  select f.payeur_type, f.licence_id, f.payeur_tenant_id, e.etat, e.reste_du into v
    from facturation.factures f
    join facturation.encours_v e on e.facture_id = f.id
   where f.id = p_facture;
  if not found
     or not facturation.peut_payer(
          case when v.payeur_type = 'titulaire' then v.licence_id end,
          case when v.payeur_type = 'cabinet' then v.payeur_tenant_id end) then
    raise exception 'refus.introuvable.facture' using errcode = '42501';
  end if;
  if v.etat not in ('a_echoir', 'en_retard', 'partielle') or v.reste_du <= 0 then
    raise exception 'paiement.facture_rien_a_regler' using errcode = 'check_violation';
  end if;
  return v.reste_du;
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.abonnement_regler(p_report_mois smallint, p_annuel_ouvert boolean, p_annuel_mois_offerts smallint, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_abonnement
    (report_mois, annuel_ouvert, annuel_mois_offerts, motif, decide_par)
  values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_abonnement r where r.id = v_id);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.accorder_lectures(p_licence uuid, p_nombre integer, p_motif text, p_du date DEFAULT NULL::date, p_au date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_nombre <= 0 then
    raise exception 'refus.lecture.supplement_positif'
      using errcode = 'check_violation';
  end if;

  insert into plateforme.interventions
    (licence_id, acte, motif, valeur, effet_du, effet_au)
  values (p_licence, 'supplement_lectures', p_motif, p_nombre,
          coalesce(p_du, date_trunc('month', current_date)::date),
          p_au);

  return jsonb_build_object('licence_id', p_licence, 'lectures_accordees', p_nombre);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.calendrier_lire(p_juridiction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'regle', (select jsonb_build_object('joursRepos', c.jours_repos,
                                        'reportJourOuvrable', c.report_jour_ouvrable,
                                        'source', c.source)
                from ref.calendrier_juridiction c where c.jurisdiction = p_juridiction),
    'joursFeries', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', f.id, 'mois', f.mois, 'jour', f.jour, 'le', f.le,
                       'libelle', f.libelle, 'source', f.source)
                       order by coalesce(f.le, make_date(2000, f.mois, f.jour)) nulls last, f.libelle),
                     '[]'::jsonb)
                      from ref.jours_feries f
                     where f.jurisdiction = p_juridiction and f.valid_to is null
                       and (f.le is null or f.le >= date_trunc('year', current_date)::date)),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', r.id, 'code', r.obligation_code,
                   'libelle', (select o.libelle from ref.fiscal_obligations o
                                where o.jurisdiction = r.jurisdiction and o.code = r.obligation_code
                                order by o.valid_from desc limit 1),
                   'periode', r.periode, 'nouvelleDate', r.nouvelle_date,
                   'motif', r.motif, 'source', r.source)
                   order by r.nouvelle_date desc), '[]'::jsonb)
                  from ref.reports_echeance r
                 where r.jurisdiction = p_juridiction and r.retire_le is null),
    'obligations', (select coalesce(jsonb_agg(distinct jsonb_build_object(
                       'code', o.code, 'libelle', o.libelle, 'periodicite', o.periodicite)), '[]'::jsonb)
                      from ref.fiscal_obligations o
                     where o.jurisdiction = p_juridiction and o.echeance_jour is not null
                       and o.periodicite in ('mensuelle', 'trimestrielle', 'annuelle')
                       and (o.valid_to is null or o.valid_to > current_date)));
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.emetteur_designer(p_organisation uuid, p_valide_des date, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  p_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if p_motif is null then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  if p_valide_des is null or p_valide_des < current_date then
    raise exception 'refus.facturation.emetteur_futur'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from identity.organizations o
                  where o.id = p_organisation and o.archived_at is null) then
    raise exception 'refus.introuvable.organisation' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from facturation.emetteurs e
              where e.organisation_id = p_organisation and e.valide_des = p_valide_des) then
    raise exception 'refus.facturation.emetteur_deja'
      using errcode = 'check_violation';
  end if;

  insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
  values (p_organisation, p_valide_des, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_organisation, auth.uid(), 'emetteur.designe', 'facturation', 'emetteurs', v_id,
          jsonb_build_object('valide_des', p_valide_des, 'motif', p_motif));

  return jsonb_build_object('emetteur_id', v_id, 'organisation_id', p_organisation,
                            'valide_des', p_valide_des);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.emetteur_en_vigueur()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('organisation_id', o.id, 'nom', o.name, 'matricule', o.legal_id,
                              'juridiction', o.jurisdiction, 'devise', o.currency,
                              'valide_des', e.valide_des)
      from facturation.emetteurs e
      join identity.organizations o on o.id = e.organisation_id
     where e.valide_des <= current_date
     order by e.valide_des desc limit 1);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.grille_en_vigueur(p_le date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'effective_from', p_le,
    'offres', (
      select coalesce(jsonb_agg(to_jsonb(g) - 'id' - 'created_at' - 'effective_from' order by g.rang), '[]')
        from (select distinct on (o.code) o.* from ref.offres o
               where o.effective_from <= p_le order by o.code, o.effective_from desc) g),
    'recharges', (
      select coalesce(jsonb_agg(to_jsonb(g) - 'created_at' - 'effective_from' order by g.rang), '[]')
        from (select distinct on (r.code) r.* from ref.recharges r
               where r.effective_from <= p_le order by r.code, r.effective_from desc) g));
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.grille_publier(p_effective_from date, p_offres jsonb, p_recharges jsonb, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_trous jsonb;
  v_id    uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'detail', t.detail)), '[]')
    into v_trous
    from plateforme.grille_trous(p_effective_from, p_offres, p_recharges) t;
  if jsonb_array_length(v_trous) > 0 then
    raise exception '%', app.refus_avec_valeurs('refus.grille.trous', 'trous', (v_trous)::text) using errcode = 'check_violation';
  end if;

  insert into ref.offres
    (code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max,
     prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max,
     prix_organisation_sup, rang, recharges_permises, effective_from)
  select e ->> 'code', e ->> 'libelle', (e ->> 'prix_mensuel_ht')::numeric,
         (e ->> 'lectures_par_organisation')::int, (e ->> 'sieges_inclus')::int,
         (e ->> 'sieges_max')::int, coalesce((e ->> 'prix_siege_sup')::numeric, 0),
         coalesce((e ->> 'lectures_par_siege_sup')::int, 0),
         coalesce((e ->> 'organisations_incluses')::int, 1), (e ->> 'organisations_max')::int,
         coalesce((e ->> 'prix_organisation_sup')::numeric, 0), (e ->> 'rang')::int,
         coalesce((e ->> 'recharges_permises')::boolean, true), p_effective_from
    from jsonb_array_elements(p_offres) e;

  insert into ref.recharges (code, libelle, prix_ht, lectures, validite_mois, rang, effective_from)
  select e ->> 'code', e ->> 'libelle', (e ->> 'prix_ht')::numeric, (e ->> 'lectures')::int,
         (e ->> 'validite_mois')::int, (e ->> 'rang')::int, p_effective_from
    from jsonb_array_elements(coalesce(p_recharges, '[]'::jsonb)) e;

  insert into plateforme.grilles_publiees (effective_from, offres, recharges, motif, publie_par)
  values (p_effective_from, p_offres, coalesce(p_recharges, '[]'::jsonb), p_motif, auth.uid())
  returning id into v_id;

  return jsonb_build_object('grille_id', v_id, 'effective_from', p_effective_from,
                            'offres', jsonb_array_length(p_offres),
                            'recharges', jsonb_array_length(coalesce(p_recharges, '[]'::jsonb)));
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.grille_trous(p_effective_from date, p_offres jsonb, p_recharges jsonb)
 RETURNS TABLE(code text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o       record;
  r       record;
  -- L'offre et le palier précédents, rang après rang (vides au premier).
  p_code  text;
  p_prix  numeric;
  p_lect  integer;
  p_siege integer;
  p_rech  boolean;
  v_marge numeric := 0;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  if p_effective_from is null or p_effective_from <= current_date then
    code := 'date_passee';
    detail := 'une grille se publie pour demain ou plus tard';
    return next;
  end if;

  if jsonb_typeof(p_offres) is distinct from 'array' or jsonb_array_length(p_offres) = 0 then
    code := 'offres_absentes'; detail := 'la grille ne porte aucune offre'; return next;
    return;
  end if;

  -- Une offre connue ne disparaît pas de la grille.
  for o in
    select distinct x.code from ref.offres x
     where not exists (select 1 from jsonb_array_elements(p_offres) e where e ->> 'code' = x.code)
  loop
    code := 'offre_manquante'; detail := o.code; return next;
  end loop;

  for o in
    select e ->> 'rang' as rang, count(*) as n
      from jsonb_array_elements(p_offres) e group by 1 having count(*) > 1
  loop
    code := 'rang_double'; detail := o.rang; return next;
  end loop;

  -- Rang après rang : plus cher, plus de lectures, pas moins de personnes, et
  -- une lecture qui revient moins cher.
  p_code := null;
  for o in
    select e ->> 'code' as code,
           (e ->> 'rang')::int as rang,
           (e ->> 'prix_mensuel_ht')::numeric as prix,
           ((e ->> 'lectures_par_organisation')::int
             * coalesce((e ->> 'organisations_incluses')::int, 1)) as lectures,
           (e ->> 'sieges_inclus')::int as sieges,
           (e ->> 'sieges_max')::int as sieges_max,
           coalesce((e ->> 'recharges_permises')::boolean, true) as recharges
      from jsonb_array_elements(p_offres) e
     order by (e ->> 'rang')::int
  loop
    if o.prix is null or o.lectures is null or o.lectures <= 0 or o.sieges is null then
      code := 'offre_incomplete'; detail := o.code; return next;
      continue;
    end if;
    if o.sieges_max is not null and o.sieges_max < o.sieges then
      code := 'places_incoherentes'; detail := o.code; return next;
    end if;
    if p_code is not null then
      if o.prix <= p_prix then
        code := 'prix_non_croissant'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.lectures <= p_lect then
        code := 'lectures_non_croissantes'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.sieges < p_siege then
        code := 'personnes_decroissantes'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.prix / o.lectures > p_prix / p_lect then
        code := 'monter_coute_plus_a_la_lecture'; detail := p_code || ' -> ' || o.code;
        return next;
      end if;
      -- Ce que coûte une lecture de plus en montant : une recharge ne doit
      -- jamais faire mieux, sur une offre qui admet les recharges.
      if p_rech and o.lectures > p_lect then
        v_marge := greatest(v_marge, (o.prix - p_prix) / (o.lectures - p_lect));
      end if;
    end if;
    p_code := o.code; p_prix := o.prix; p_lect := o.lectures;
    p_siege := o.sieges; p_rech := o.recharges;
  end loop;

  -- Les recharges : plus chères et plus grosses rang après rang, la plus
  -- grosse la plus avantageuse, et aucune moins chère que de monter.
  if jsonb_typeof(p_recharges) = 'array' then
    p_code := null;
    for r in
      select e ->> 'code' as code,
             (e ->> 'rang')::int as rang,
             (e ->> 'prix_ht')::numeric as prix,
             (e ->> 'lectures')::int as lectures
        from jsonb_array_elements(p_recharges) e
       order by (e ->> 'rang')::int
    loop
      if r.prix is null or r.prix <= 0 or r.lectures is null or r.lectures <= 0 then
        code := 'recharge_incomplete'; detail := r.code; return next;
        continue;
      end if;
      if r.prix / r.lectures < v_marge then
        code := 'recharge_brule_l_offre_suivante'; detail := r.code; return next;
      end if;
      if p_code is not null then
        if r.prix <= p_prix or r.lectures <= p_lect then
          code := 'paliers_non_croissants'; detail := p_code || ' -> ' || r.code; return next;
        end if;
        if r.prix / r.lectures > p_prix / p_lect then
          code := 'gros_palier_moins_avantageux'; detail := p_code || ' -> ' || r.code;
          return next;
        end if;
      end if;
      p_code := r.code; p_prix := r.prix; p_lect := r.lectures;
    end loop;
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.ia_regler(p_plafond numeric, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_ia (plafond_usd_par_org_mois, motif, decide_par)
  values (p_plafond, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_ia r where r.id = v_id);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.jour_ferie_poser(p_juridiction text, p_mois smallint, p_jour smallint, p_le date, p_libelle text, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if coalesce(btrim(p_source), '') = '' then
    raise exception 'refus.jour_ferie.source' using errcode = 'check_violation';
  end if;
  insert into ref.jours_feries (jurisdiction, mois, jour, le, libelle, source)
  values (p_juridiction,
          case when p_le is null then p_mois end,
          case when p_le is null then p_jour end,
          p_le, btrim(p_libelle), btrim(p_source))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.jour_ferie_retirer(p_id uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  update ref.jours_feries
     set valid_to = greatest(current_date, valid_from + 1),
         retire_par = auth.uid(), motif_retrait = btrim(p_motif)
   where id = p_id and valid_to is null;
  if not found then
    raise exception 'refus.introuvable.jour_ferie' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.organisations_chercher(p_texte text)
 RETURNS TABLE(organisation_id uuid, nom text, matricule text, juridiction text, devise text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, o.legal_id, o.jurisdiction, o.currency
      from identity.organizations o
     where o.archived_at is null
       and (coalesce(btrim(p_texte), '') = ''
            or o.name ilike '%' || btrim(p_texte) || '%'
            or o.legal_id ilike '%' || btrim(p_texte) || '%')
     order by o.name
     limit 20;
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.paiement_regler(p_prestataire text, p_url_api text, p_url_retour text, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_paiement (prestataire, url_api, url_retour, motif, decide_par)
  values (p_prestataire, nullif(btrim(p_url_api), ''),
          nullif(rtrim(btrim(p_url_retour), '/'), ''), p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_paiement r where r.id = v_id);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.reglage_paiement_coherent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  p facturation.prestataires_paiement;
begin
  select * into p from facturation.prestataires_paiement where code = new.prestataire;
  if p.ouvre_le_paiement and (new.url_retour is null or new.url_retour !~ '^https?://') then
    raise exception 'refus.paiement.adresse_de_retour' using errcode = 'check_violation';
  end if;
  if p.exige_url_api and (new.url_api is null or new.url_api !~ '^https://') then
    raise exception 'refus.paiement.adresse_https'
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.relances_regler(p_actives boolean, p_suspension_automatique boolean, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_relances (actives, suspension_automatique, motif, decide_par)
  values (p_actives, p_suspension_automatique, p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_relances r where r.id = v_id);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.report_publier(p_juridiction text, p_code text, p_periode text, p_date date, p_motif text, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'refus.report.date_requise' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_motif), '') = '' or coalesce(btrim(p_source), '') = '' then
    raise exception 'refus.report.source_et_motif' using errcode = 'check_violation';
  end if;
  if coalesce(p_periode, '') !~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-T[1-4])?$' then
    raise exception 'refus.report.periode_illisible' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from ref.fiscal_obligations o
                  where o.jurisdiction = p_juridiction and o.code = p_code) then
    raise exception 'refus.report.obligation_hors_pack' using errcode = 'check_violation';
  end if;
  update ref.reports_echeance
     set retire_le = now(), retire_par = auth.uid(), motif_retrait = 'remplace par un nouveau report'
   where jurisdiction = p_juridiction and obligation_code = p_code and periode = p_periode
     and retire_le is null;
  insert into ref.reports_echeance (jurisdiction, obligation_code, periode, nouvelle_date, motif, source)
  values (p_juridiction, p_code, p_periode, p_date, btrim(p_motif), btrim(p_source))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.report_retirer(p_id uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  update ref.reports_echeance
     set retire_le = now(), retire_par = auth.uid(), motif_retrait = btrim(p_motif)
   where id = p_id and retire_le is null;
  if not found then
    raise exception 'refus.introuvable.report' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.reprendre(p_licence uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_statut   text;
  v_attente  integer;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  select statut into v_statut from facturation.licences where id = p_licence;
  if v_statut is distinct from 'suspendue' then
    return jsonb_build_object('licence_id', p_licence, 'change', false,
                              'statut', v_statut);
  end if;

  update facturation.licences
     set statut = 'active', suspendue_le = null,
         motif_suspension = null, updated_at = now()
   where id = p_licence;

  select count(*) into v_attente
    from capture.pieces p
    join facturation.licence_organisations lo on lo.tenant_id = p.tenant_id
   where lo.licence_id = p_licence
     and p.status = 'capturee'
     and p.vis <> 'personnel'::app.vis_t;

  insert into plateforme.interventions (licence_id, acte, motif, valeur)
  values (p_licence, 'reprise', p_motif, v_attente);

  return jsonb_build_object('licence_id', p_licence, 'change', true,
                            'statut', 'active', 'pieces_en_attente', v_attente);
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.servir_requisition(p_requisition uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r        record;
  v_inv    jsonb;
  v_compte integer;
begin
  select * into r from plateforme.requisitions where id = p_requisition;
  if r.id is null then
    raise exception 'refus.introuvable.requisition' using errcode = 'no_data_found';
  end if;
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if r.approuve_par is null then
    raise exception 'refus.requisition.seconde_signature'
      using errcode = 'check_violation';
  end if;
  if now() > r.close_le then
    raise exception '%', app.refus_avec_valeurs('refus.requisition.expiree', 'date', (r.close_le)::text) using errcode = 'check_violation';
  end if;

  select jsonb_agg(jsonb_build_object(
           'piece_id',      p.id,
           'empreinte',     p.sha256,            -- vérifiable sans nous
           'type',          p.document_kind,
           -- La date de la pièce ne vit pas sur la pièce : elle est portée
           -- par ses lignes (`capture.piece_articles.document_date`), parce
           -- qu'une facture à cheval sur deux périodes en a plusieurs. On
           -- rend la plus ancienne, qui est celle que l'administration
           -- utilisera pour rattacher la pièce à un exercice.
           'date_piece',    (select min(a.document_date)
                               from capture.piece_articles a
                              where a.piece_id = p.id),
           'deposee_le',    p.created_at,
           'deposee_par',   p.created_by,
           'pages',         p.page_count,
           'octets_type',   p.content_type,
           'etat',          p.status,
           'transmise_le',  p.transmise_le,
           'etablissement', p.entity_id
         ) order by p.created_at),
         count(*)
    into v_inv, v_compte
    from capture.pieces p
   where p.tenant_id = r.tenant_id
     -- L'espace privé d'une personne n'entre pas dans l'inventaire d'une
     -- société. Une réquisition visant la société ne vise pas les papiers
     -- personnels de son comptable.
     and p.vis <> 'personnel'::app.vis_t;

  -- La remise est elle-même un fait, inscrit dans le journal du CLIENT :
  -- il doit pouvoir constater, dix ans après, ce qui a été remis et à qui.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (r.tenant_id, auth.uid(), 'requisition.servie', 'plateforme',
          'requisitions', p_requisition,
          jsonb_build_object('autorite', r.autorite, 'reference', r.reference,
                             'portee', r.portee, 'pieces', v_compte));

  return jsonb_build_object(
    'requisition',  p_requisition,
    'autorite',     r.autorite,
    'reference',    r.reference,
    'portee',       r.portee,
    'servie_le',    now(),
    'pieces',       v_compte,
    'contenu_inclus', (r.portee = 'pieces'),
    'inventaire',   coalesce(v_inv, '[]'::jsonb));
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.suspendre(p_licence uuid, p_motif text, p_avant text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_statut text;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  select statut into v_statut from facturation.licences where id = p_licence;
  if v_statut is null then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;
  if v_statut = 'suspendue' then
    return jsonb_build_object('licence_id', p_licence, 'change', false,
                              'statut', 'suspendue');
  end if;
  if v_statut = 'resiliee' then
    raise exception 'refus.licence.resiliee' using errcode = 'check_violation';
  end if;

  update facturation.licences
     set statut = 'suspendue', suspendue_le = now(),
         motif_suspension = 'impaye', updated_at = now()
   where id = p_licence;

  insert into plateforme.interventions (licence_id, acte, motif, avant)
  values (p_licence, 'suspension', p_motif, p_avant);

  return jsonb_build_object('licence_id', p_licence, 'change', true,
                            'statut', 'suspendue');
end
$function$;

commit;
