-- La tour règle le paiement et l'émetteur, sans passer par le serveur
-- (demandé le 19 octobre 2026 : « tout doit être paramétrable »).
--
-- Jusqu'ici, le prestataire de paiement se choisissait dans l'environnement
-- de l'API, et l'émetteur des factures ne pouvait se désigner que par une
-- requête à la main. Les deux deviennent des réglages de la tour, datés et
-- motivés, qu'on ne réécrit pas : la dernière décision vaut (R7).
--
-- Ce qui reste hors de la base, et doit y rester : les SECRETS du compte
-- marchand (identifiant et mot de passe de l'API ClicToPay). Ils vivent dans
-- l'environnement du serveur ; la tour voit seulement s'ils sont posés.

-- --- 1. Le réglage du paiement -----------------------------------------------

create table plateforme.reglages_paiement (
  id           uuid primary key default gen_random_uuid(),
  prestataire  text not null check (prestataire in ('aucun', 'simulateur', 'clictopay')),
  url_api      text,
  url_retour   text,
  motif        text not null check (length(btrim(motif)) > 0),
  decide_par   uuid not null,
  decide_le    timestamptz not null default now(),
  constraint reglages_paiement_retour_si_ouvert
    check (prestataire = 'aucun' or (url_retour is not null and url_retour ~ '^https?://')),
  constraint reglages_paiement_api_si_clictopay
    check (prestataire <> 'clictopay' or (url_api is not null and url_api ~ '^https://'))
);

comment on table plateforme.reglages_paiement is
  'Le prestataire de paiement en ligne choisi par la tour, et ses adresses. La '
  'dernière décision vaut. Aucun secret ici : ils restent dans l''environnement.';

alter table plateforme.reglages_paiement enable row level security;
revoke all on table plateforme.reglages_paiement from public, anon;
grant select on table plateforme.reglages_paiement to authenticated;

create policy reglages_paiement_lire on plateforme.reglages_paiement
  for select to authenticated using ((select app.is_platform()));

create trigger reglages_paiement_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_paiement
  for each row execute function app.deny_mutation();

create or replace function plateforme.paiement_regler(
  p_prestataire text, p_url_api text, p_url_retour text, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  insert into plateforme.reglages_paiement (prestataire, url_api, url_retour, motif, decide_par)
  values (p_prestataire, nullif(btrim(p_url_api), ''),
          nullif(rtrim(btrim(p_url_retour), '/'), ''), p_motif, auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_paiement r where r.id = v_id);
end
$$;

revoke all on function plateforme.paiement_regler(text, text, text, text) from public, anon;
grant execute on function plateforme.paiement_regler(text, text, text, text) to authenticated;

-- Ce que l'API lit à chaque paiement : le prestataire et ses adresses, rien
-- d'autre. Lisible par toute personne connectée — un client doit pouvoir
-- savoir si le paiement en ligne est ouvert — et sans aucun secret.
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
    jsonb_build_object('prestataire', 'aucun', 'url_api', null, 'url_retour', null,
                       'decide_le', null))
$$;

revoke all on function public.paiement_reglage() from public, anon;
grant execute on function public.paiement_reglage() to authenticated;

-- --- 2. L'émetteur, désigné par la tour --------------------------------------

create or replace function plateforme.emetteur_designer(p_organisation uuid, p_valide_des date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if p_valide_des is null or p_valide_des < current_date then
    raise exception 'un emetteur se designe pour aujourd''hui ou plus tard'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from identity.organizations o
                  where o.id = p_organisation and o.archived_at is null) then
    raise exception 'organisation inconnue' using errcode = 'no_data_found';
  end if;
  insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
  values (p_organisation, p_valide_des, auth.uid())
  returning id into v_id;
  return jsonb_build_object('emetteur_id', v_id, 'organisation_id', p_organisation,
                            'valide_des', p_valide_des);
end
$$;

revoke all on function plateforme.emetteur_designer(uuid, date) from public, anon;
grant execute on function plateforme.emetteur_designer(uuid, date) to authenticated;

-- L'émetteur en vigueur, et les organisations parmi lesquelles le choisir.
create or replace function plateforme.emetteur_en_vigueur()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
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
$$;

revoke all on function plateforme.emetteur_en_vigueur() from public, anon;
grant execute on function plateforme.emetteur_en_vigueur() to authenticated;

create or replace function plateforme.organisations_chercher(p_texte text)
returns table (organisation_id uuid, nom text, matricule text, juridiction text, devise text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
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
$$;

revoke all on function plateforme.organisations_chercher(text) from public, anon;
grant execute on function plateforme.organisations_chercher(text) to authenticated;

-- --- 3. Le simulateur ne fait entrer aucun argent ---------------------------------
--
-- Le simulateur peut désormais s'ouvrir partout depuis la tour : ses « payés »
-- ne doivent donc JAMAIS devenir un encaissement. Corps vivant de
-- `facturation.emettre` (20261022150000), à cette seule condition près.
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

  -- R4 : l'émetteur est une donnée, pas une hypothèse. Sa devise est celle de
  -- la facture ; sa juridiction désigne le pack dont on lit le taux et le
  -- timbre.
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

  -- Pas de valeur de repli. R4 jusqu'au bout : une facture émise sous un taux
  -- supposé serait fausse sans que personne ne le voie.
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

  -- Une ligne par payeur. `order by payeur_type` fixe l'ordre — `cabinet`
  -- avant `titulaire` — pour que `facture_id` désigne toujours la même facture
  -- d'une exécution à l'autre.
  for l in
    select * from facturation.a_facturer(p_licence, p_periode)
     order by payeur_type
  loop
    if l.payeur_type = 'cabinet' then
      select o.name, o.legal_id into v_nom, v_legal
        from identity.organizations o where o.id = l.payeur_tenant_id;
    else
      select p.display_name, null::text into v_nom, v_legal
        from identity.profiles p where p.user_id = l.payeur_personne;
    end if;

    -- Pas de repli (R4) : une facture sans destinataire nommé n'est pas une
    -- facture. On refuse, et on dit où le nom manque.
    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        'le destinataire % n''a pas de nom (identity.organizations.name ou identity.profiles.display_name)',
        coalesce(l.payeur_tenant_id, l.payeur_personne)
        using errcode = 'no_data_found';
    end if;

    -- Les recharges vont sur la facture du titulaire : celles achetées jusqu'à
    -- la fin de la période et pas encore facturées (20261022120000).
    v_ht := l.montant_ht;
    if l.payeur_type = 'titulaire' then
      select (l.montant_ht + coalesce(sum(x.prix_ht), 0))::app.money_t into v_ht
        from facturation.recharges x
       where x.licence_id = p_licence
         and x.achetee_le < (p_periode + interval '1 month')::date
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
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

    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            'Abonnement ' || l.offre_code || ' — '
            || to_char(p_periode, 'TMMonth YYYY')
            || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
            1, l.montant_ht, l.montant_ht);

    if l.payeur_type = 'titulaire' then
      v_ordinal := 1;
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

      -- Les paiements en ligne déjà reçus (montée, recharge) sont des acomptes :
      -- ils s'imputent ici, une fois, comme encaissements par carte
      -- (20261022150000).
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
