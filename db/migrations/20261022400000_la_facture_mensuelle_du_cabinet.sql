-- La facture mensuelle détaillée du cabinet (20 octobre 2026).
--
-- Décision : le cabinet reçoit UNE facture par mois, une ligne par société
-- cliente (offre, référence, prorata de jours), un seul timbre. Jusqu'ici
-- `facturation.emettre` faisait une facture par licence et par payeur — un
-- timbre par client pour le cabinet.
--
--   • `factures.licence_id` et `offre_code` deviennent facultatifs pour la
--     seule facture consolidée d'un cabinet (contrainte nommée) ;
--   • `facture_lignes` porte la licence et la société de chaque ligne ;
--   • une facture consolidée par cabinet et par mois (index unique partiel) ;
--   • `emettre` ne facture plus la part d'un cabinet ; `emettre_cabinet` la
--     regroupe.
--
-- REJEU (R11) : `if not exists`, `create or replace`.

begin;

alter table facturation.factures alter column licence_id drop not null;
alter table facturation.factures alter column offre_code drop not null;
alter table facturation.factures drop constraint if exists factures_consolidee_du_cabinet;
alter table facturation.factures add constraint factures_consolidee_du_cabinet check (
  (licence_id is not null and offre_code is not null)
  or (licence_id is null and payeur_type = 'cabinet')
);
create unique index if not exists factures_une_consolidee_par_cabinet_et_mois
  on facturation.factures (payeur_tenant_id, periode)
  where licence_id is null and avoir_de is null;

alter table facturation.facture_lignes
  add column if not exists licence_id uuid references facturation.licences(id) on delete restrict;
alter table facturation.facture_lignes
  add column if not exists tenant_id uuid references identity.organizations(id) on delete restrict;
create index if not exists facture_lignes_licence_idx
  on facturation.facture_lignes (licence_id) where licence_id is not null;
create index if not exists facture_lignes_tenant_idx
  on facturation.facture_lignes (tenant_id) where tenant_id is not null;

-- La ligne d'une facture du cabinet nomme un dossier ET sa licence : la garde
-- d'insertion les LIE. Une clé étrangère dit « cette licence existe », jamais
-- « cette licence est celle de ce dossier » (schema.test, tables de comptage).
drop policy if exists facturation_facture_lignes_ins on facturation.facture_lignes;
create policy facturation_facture_lignes_ins on facturation.facture_lignes
  for insert to authenticated
  with check (
    (select app.is_platform())
    and (licence_id is null or tenant_id is null
         or exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = facture_lignes.licence_id
                       and lo.tenant_id = facture_lignes.tenant_id))
  );

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
        select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le
          from facturation.paiements_en_ligne p
          join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
                                              and e.prestataire <> 'simulateur'
         where p.licence_id = p_licence
           and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id)
         order by e.le, p.id
      loop
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_id, v_paiement.montant_ttc, 'carte',
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

-- La facture mensuelle du cabinet : une ligne par société cliente, un timbre.
create or replace function facturation.emettre_cabinet(
  p_cabinet uuid, p_periode date, p_jours_echeance integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'une periode est un premier du mois' using errcode = 'check_violation';
  end if;
  if exists (select 1 from facturation.factures f
              where f.payeur_tenant_id = p_cabinet and f.periode = p_periode
                and f.licence_id is null and f.avoir_de is null) then
    raise exception 'la facture de ce cabinet pour % existe deja', p_periode
      using errcode = 'unique_violation';
  end if;

  select o.name, o.legal_id into v_nom, v_legal
    from identity.organizations o where o.id = p_cabinet and o.kind = 'cabinet';
  if v_nom is null then
    raise exception 'cabinet introuvable' using errcode = 'no_data_found';
  end if;

  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'aucun emetteur designe (facturation.emetteurs)' using errcode = 'no_data_found';
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
    raise exception 'taux de TVA ou droit de timbre absent du referentiel' using errcode = 'no_data_found';
  end if;

  select coalesce(sum(a.montant_ht), 0), count(*) into v_ht, v_nb
    from facturation.a_facturer_cabinet(p_cabinet, p_periode) a
   where a.montant_ht > 0;
  if v_nb = 0 then
    raise exception 'rien a facturer a ce cabinet pour %', p_periode using errcode = 'no_data_found';
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

revoke all on function facturation.emettre_cabinet(uuid, date, integer) from public;
grant execute on function facturation.emettre_cabinet(uuid, date, integer) to authenticated;

commit;
