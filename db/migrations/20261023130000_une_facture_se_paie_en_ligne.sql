-- Une facture du mois se paie en ligne (23 octobre 2026).
--
-- Décisions de Wissem (« Oui » aux trois recommandations) :
--   1. le client paie le RESTE DÛ de la facture, en entier ;
--   2. le paiement s'inscrit sur la facture dès que le prestataire le
--      confirme — un encaissement, pas un acompte pour le mois suivant ;
--   3. une licence suspendue pour impayé reprend d'elle-même quand plus
--      aucune facture n'est en retard.
--
-- Périmètre : les factures dont le payeur est le titulaire de la licence. La
-- facture mensuelle d'un CABINET (une ligne par client, `licence_id` vide) se
-- paie autrement : elle n'est pas ouverte ici.
--
-- Rien ne se réécrit (R7). `public.paiement_inscrire` n'est pas reprise : un
-- déclencheur sur `facturation.paiement_evenements` porte la règle — avant
-- le lien, le montant doit être encore dû ; après « payé », l'encaissement et
-- la reprise.

-- --- 1. Le registre admet une facture ----------------------------------------

alter table facturation.paiements_en_ligne
  add column facture_id uuid references facturation.factures (id),
  drop constraint paiements_en_ligne_objet_check,
  add constraint paiements_en_ligne_objet_check
    check (objet in ('montee', 'recharge', 'annuel', 'facture')),
  drop constraint paiements_objet_designe,
  add constraint paiements_objet_designe check (
    (objet = 'montee' and forfait_id is not null and recharge_id is null
       and engagement_id is null and facture_id is null)
    or (objet = 'recharge' and recharge_id is not null and forfait_id is null
       and engagement_id is null and facture_id is null)
    or (objet = 'annuel' and engagement_id is not null and forfait_id is null
       and recharge_id is null and facture_id is null)
    or (objet = 'facture' and facture_id is not null and forfait_id is null
       and recharge_id is null and engagement_id is null)),
  -- Le paiement d'une facture porte son reste dû TTC, timbre compris ; le HT
  -- et la TVA sont ceux de la facture, pour mémoire.
  drop constraint paiements_ttc_coherent,
  add constraint paiements_ttc_coherent
    check (objet = 'facture' or montant_ttc = montant_ht + montant_tva),
  drop constraint paiements_en_ligne_montant_ht_check,
  add constraint paiements_en_ligne_montant_ht_check
    check (montant_ht > 0 or (objet = 'facture' and montant_ht >= 0)),
  add constraint paiements_facture_ttc_positif
    check (objet <> 'facture' or montant_ttc > 0);

create index paiements_en_ligne_facture_idx on facturation.paiements_en_ligne (facture_id)
  where facture_id is not null;

-- --- 2. Ce qu'une facture laisse à payer --------------------------------------

-- Le reste dû d'une facture que le titulaire paie lui-même. Refuse, par une
-- clé, ce qui ne se paie pas en ligne ici. Le droit suit le titulaire ACTUEL
-- de la licence : une licence transmise après l'émission reste payable par
-- celui qui la tient (c'est lui que l'impayé suspend), et `paiement_inscrire`
-- exige le même.
create or replace function facturation.reste_du_payable(p_facture uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select f.payeur_type, f.licence_id, e.etat, e.reste_du into v
    from facturation.factures f
    join facturation.encours_v e on e.facture_id = f.id
   where f.id = p_facture;
  if not found or v.payeur_type <> 'titulaire' or v.licence_id is null
     or not facturation.titulaire_de(v.licence_id) then
    raise exception 'facture introuvable' using errcode = '42501';
  end if;
  if v.etat not in ('a_echoir', 'en_retard', 'partielle') or v.reste_du <= 0 then
    raise exception 'paiement.facture_rien_a_regler' using errcode = 'check_violation';
  end if;
  return v.reste_du;
end
$$;

revoke all on function facturation.reste_du_payable(uuid) from public, anon, authenticated;

-- Préparer le paiement d'une facture : son reste dû, en entier. Un paiement
-- encore ouvert pour ce même montant est rendu tel quel.
create or replace function public.paiement_facture_preparer(p_facture uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f      facturation.factures;
  v_du   numeric;
  v_id   uuid;
begin
  -- Une préparation à la fois par facture : deux onglets liraient le même
  -- « aucun paiement ouvert » et en créeraient deux, payables tous les deux.
  perform 1 from facturation.factures where id = p_facture for update;
  v_du := facturation.reste_du_payable(p_facture);
  select * into f from facturation.factures where id = p_facture;
  if f.licence_id is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = f.licence_id
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(f.licence_id) then
    raise exception 'facture introuvable' using errcode = '42501';
  end if;

  select v.paiement_id into v_id
    from facturation.paiements_en_ligne p
    join facturation.paiements_en_ligne_v v on v.paiement_id = p.id
   where p.facture_id = p_facture and p.montant_ttc = v_du and v.etat <> 'paye'
   order by p.cree_le desc limit 1;
  if v_id is null then
    insert into facturation.paiements_en_ligne
      (licence_id, objet, facture_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
       devise, cree_par)
    values
      (f.licence_id, 'facture', f.id, f.numero, f.montant_ht, f.taux_tva, f.montant_tva, v_du,
       f.devise, auth.uid())
    returning id into v_id;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
end
$$;

revoke all on function public.paiement_facture_preparer(uuid) from public, anon;
grant execute on function public.paiement_facture_preparer(uuid) to authenticated;

-- Le montant d'un paiement de facture est-il encore celui qui est dû ? Un
-- encaissement saisi entre-temps l'a peut-être changé : on ne prend pas
-- d'argent sur un montant périmé. Vrai, sans rien dire, pour les autres objets.
create or replace function public.paiement_encore_du(p_paiement uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p facturation.paiements_en_ligne;
begin
  select * into p from facturation.paiements_en_ligne where id = p_paiement;
  if p.objet is distinct from 'facture' then
    return true;
  end if;
  if facturation.reste_du_payable(p.facture_id) <> p.montant_ttc then
    raise exception 'paiement.montant_perime' using errcode = 'check_violation';
  end if;
  return true;
end
$$;

revoke all on function public.paiement_encore_du(uuid) from public, anon;
grant execute on function public.paiement_encore_du(uuid) to authenticated;

-- --- 3. Le moyen d'encaissement d'un paiement : une lecture ------------------

-- Celui du moyen choisi au dernier lien, sinon celui du prestataire. Lu par la
-- facture du mois (les acomptes) et par l'encaissement d'une facture payée.
create or replace function facturation.moyen_encaissement_du_paiement(p_paiement uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(mp.moyen_encaissement, pp.moyen_encaissement_defaut)
    from facturation.paiement_evenements e
    join facturation.prestataires_paiement pp on pp.code = e.prestataire
    left join lateral (
      select x.moyen from facturation.paiement_evenements x
       where x.paiement_id = e.paiement_id and x.moyen is not null
       order by x.le desc, x.id desc limit 1
    ) choisi on true
    left join facturation.moyens_paiement mp on mp.code = choisi.moyen
   where e.paiement_id = p_paiement and e.etat = 'paye'
   order by e.le desc, e.id desc limit 1
$$;

revoke all on function facturation.moyen_encaissement_du_paiement(uuid) from public, anon, authenticated;

-- --- 4. Avant le lien, après le paiement --------------------------------------

create or replace function facturation.un_paiement_de_facture_avant_le_lien()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.etat = 'lien_cree' then
    perform public.paiement_encore_du(new.paiement_id);
  end if;
  return new;
end
$$;

-- Une fonction de déclencheur n'est appelée par personne : fermée à tous.
revoke all on function facturation.un_paiement_de_facture_avant_le_lien() from public, anon, authenticated;

create trigger un_paiement_de_facture_avant_le_lien
  before insert on facturation.paiement_evenements
  for each row execute function facturation.un_paiement_de_facture_avant_le_lien();

-- Payé chez un prestataire qui fait entrer de l'argent : l'encaissement sur la
-- facture, tout de suite, puis la reprise d'une licence suspendue pour impayé
-- si plus aucune facture n'est en retard.
create or replace function facturation.une_facture_payee_s_encaisse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p        facturation.paiements_en_ligne;
  v_enc    uuid;
  v_licence facturation.licences;
begin
  if new.etat <> 'paye' then
    return new;
  end if;
  select * into p from facturation.paiements_en_ligne where id = new.paiement_id;
  if p.objet <> 'facture'
     or not exists (select 1 from facturation.prestataires_paiement pp
                     where pp.code = new.prestataire and pp.fait_entrer_argent)
     or exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
    return new;
  end if;

  insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
  values (p.facture_id, p.montant_ttc, facturation.moyen_encaissement_du_paiement(p.id),
          new.prestataire || ' ' || coalesce(new.reference, p.id::text), new.le::date)
  returning id into v_enc;
  insert into facturation.paiement_imputations (paiement_id, encaissement_id)
  values (p.id, v_enc);

  select * into v_licence from facturation.licences where id = p.licence_id;
  if v_licence.statut = 'suspendue' and v_licence.motif_suspension = 'impaye'
     and not exists (select 1 from facturation.factures f
                       join facturation.encours_v e on e.facture_id = f.id
                      where f.licence_id = p.licence_id
                        and e.reste_du > 0
                        and e.etat in ('en_retard', 'partielle')
                        and f.echeance_le < current_date) then
    update facturation.licences
       set statut = 'active', suspendue_le = null, motif_suspension = null, updated_at = now()
     where id = p.licence_id;
    insert into plateforme.interventions (licence_id, acte, motif, valeur_text)
    values (p.licence_id, 'reprise',
            'Reprise automatique : plus aucune facture en retard après le paiement en ligne',
            p.libelle);
  end if;
  return new;
end
$$;

revoke all on function facturation.une_facture_payee_s_encaisse() from public, anon, authenticated;

create trigger une_facture_payee_s_encaisse
  after insert on facturation.paiement_evenements
  for each row execute function facturation.une_facture_payee_s_encaisse();

-- --- 5. Mes factures ----------------------------------------------------------

-- Les factures des licences dont l'appelant est le titulaire, et ce qu'il en
-- reste à payer (le même droit que `facturation.reste_du_payable`).
create or replace function public.mes_factures()
returns table (facture_id uuid, numero text, periode date, emise_le date, echeance_le date,
               montant_ttc numeric, reste_du numeric, devise text, etat text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.numero, f.periode, f.emise_le, f.echeance_le,
         f.montant_ttc, e.reste_du, f.devise, e.etat
    from facturation.factures f
    join facturation.encours_v e on e.facture_id = f.id
   where f.payeur_type = 'titulaire'
     and f.licence_id in (select l.id from facturation.licences l where l.titulaire = auth.uid())
   order by f.periode desc, f.numero desc
$$;

revoke all on function public.mes_factures() from public, anon;
grant execute on function public.mes_factures() to authenticated;

-- --- 6. La facture du mois n'impute plus un paiement de facture ---------------
--
-- Corps repris de 20261023110000 ; deux changements : le moyen d'encaissement
-- se lit par `facturation.moyen_encaissement_du_paiement` (au lieu d'une
-- jointure recopiée), et un paiement de facture, déjà inscrit sur ELLE, n'est
-- pas un acompte.

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
      'rien a facturer sur cette licence pour % : aucun payeur sur la periode (facturation.a_facturer)',
      p_periode
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
    'factures', v_faites);
end
$function$;
