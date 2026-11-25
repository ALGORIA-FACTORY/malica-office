-- Aucune facture avant l'encaissement (décisions du CEO, 25 novembre 2026 : D6, D7, D12, R-01).
--
-- « Receipt et facture au paiement réel, sinon je paie la TVA sur des factures non
-- encaissées. » Comme Anthropic : la facture du renouvellement est un reçu, émis après le
-- paiement. Côté titulaire (PME), désormais :
--
-- 1. `emission_du_titulaire` n'émet que dans le geste qui encaisse (`une_montee_payee_s_ouvre`)
--    ou qui le chiffre (`facture_jouee`, joué puis défait). Ailleurs elle rend `au_paiement`.
-- 2. Ce qui est dû (l'échéance anniversaire, un changement qui coûte) devient une DEMANDE à
--    payer (`du_a_payer`) : le passage quotidien et les changements la posent, une seule
--    ouverte par licence, avec la date depuis laquelle c'est dû (`due_depuis`). Le
--    titulaire reçoit un avis avec le lien de paiement Malica (une session Flouci neuve au
--    clic, jamais un lien Flouci brut).
-- 3. Au paiement, les factures naissent et se règlent : le paiement se répartit sur toutes
--    celles qu'il émet (une échéance en retard, puis le jour) ; un paiement peut donc porter
--    plusieurs encaissements (`paiement_imputations` : la clé passe à l'encaissement).
-- 4. Non payé dans le délai réglé en tour (`renouvellement_delai_jours`, 14 par défaut) :
--    le dossier est fermé (`app.licence_active`), sans facture ni dette. Le paiement le rouvre.
--    Avis : fermeture proche (`abonnement.preavis_fermeture_jours`), puis fermeture.
-- 5. R-01 : les factures du titulaire suivent la LICENCE, pas la personne. Une transmission
--    ne refacture plus une période déjà payée (lectures et contrainte d'exclusion).
--
-- 6. R-04 : une recharge payée a sa facture au paiement (nature `recharge`), réglée, au
--    millime du paiement (timbre compris), même quand un cabinet paie la licence. Une recharge
--    achetée pendant qu'une échéance est due la rechiffre ; déjà portée par une base, son
--    paiement à part est remplacé.
-- 7. 1.6 : l'année ne se paie plus d'avance à la souscription ; elle se paie à son début, avec
--    le renouvellement, et sa facture vaut ce paiement.
-- 8. Un acompte d'avant D7 encore libre compte dans ce qui est dû : il couvre tout, la facture
--    naît réglée ; une part seulement, la tour le voit (`refus.facturation.acompte_a_rapprocher`).
-- 9. 8.3 : un second lien payé pour un même paiement se trace en trop-perçu à rembourser.
-- 10. La tour compte, côté PME, des demandes à payer (`facturations_du_jour.demandes`).
--
-- La facture émise à la main par la plateforme (`facturation.emettre`) et la facture du
-- cabinet ne changent pas ici (lot B : relevé du cabinet, facture au paiement).

begin;

-- ---------------------------------------------------------------- le réglage du délai
alter table plateforme.reglages_abonnement
  add column renouvellement_delai_jours smallint not null default 14
    constraint reglages_abonnement_renouvellement_delai_borne
      check (renouvellement_delai_jours between 1 and 90);

drop function plateforme.abonnement_regler(smallint, boolean, smallint, smallint, text);
create function plateforme.abonnement_regler(p_report_mois smallint, p_annuel_ouvert boolean,
  p_annuel_mois_offerts smallint, p_essai_jours smallint, p_renouvellement_delai_jours smallint,
  p_motif text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id      uuid;
  v_courant plateforme.reglages_abonnement;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  select r.* into v_courant
    from plateforme.reglages_abonnement r order by r.decide_le desc, r.id desc limit 1;
  if v_courant.id is null then
    -- Le premier réglage : ce que la tour ne règle pas ici prend le défaut de la table.
    insert into plateforme.reglages_abonnement
      (report_mois, annuel_ouvert, annuel_mois_offerts, essai_jours, renouvellement_delai_jours,
       motif, decide_par)
    values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, p_essai_jours,
            p_renouvellement_delai_jours, p_motif, auth.uid())
    returning id into v_id;
  else
    insert into plateforme.reglages_abonnement
      (report_mois, annuel_ouvert, annuel_mois_offerts, essai_jours, renouvellement_delai_jours,
       lien_valide_minutes, alerte_lectures_part, motif, decide_par)
    values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, p_essai_jours,
            p_renouvellement_delai_jours, v_courant.lien_valide_minutes,
            v_courant.alerte_lectures_part, p_motif, auth.uid())
    returning id into v_id;
  end if;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_abonnement r where r.id = v_id);
end
$function$;
revoke all on function plateforme.abonnement_regler(smallint, boolean, smallint, smallint, smallint, text)
  from public, anon;
grant execute on function plateforme.abonnement_regler(smallint, boolean, smallint, smallint, smallint, text)
  to authenticated;

create or replace function public.abonnement_reglage()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(
    (select jsonb_build_object('report_mois', r.report_mois,
                               'annuel_ouvert', r.annuel_ouvert,
                               'annuel_mois_offerts', r.annuel_mois_offerts,
                               'essai_jours', r.essai_jours,
                               'renouvellement_delai_jours', r.renouvellement_delai_jours,
                               'lien_valide_minutes', r.lien_valide_minutes,
                               'alerte_lectures_part', r.alerte_lectures_part,
                               'motif', r.motif, 'decide_le', r.decide_le)
       from plateforme.reglages_abonnement r
      order by r.decide_le desc, r.id desc limit 1),
    jsonb_build_object('report_mois', 0, 'annuel_ouvert', false, 'annuel_mois_offerts', 0,
                       'essai_jours', 0, 'renouvellement_delai_jours', null,
                       'lien_valide_minutes', null, 'alerte_lectures_part', null,
                       'motif', null, 'decide_le', null))
$function$;

-- ---------------------------------------------------------------- la demande due
alter table facturation.montees_demandees add column due_depuis date;
comment on column facturation.montees_demandees.due_depuis is
  'Ce qui est dû depuis ce jour (D7) : posé par `du_a_payer`, null pour un geste du titulaire.';
create index montees_demandees_dues_idx on facturation.montees_demandees (licence_id, cree_le desc)
  where due_depuis is not null;

-- Un paiement se répartit sur plusieurs factures : la clé passe à l'encaissement.
alter table facturation.paiement_imputations drop constraint paiement_imputations_pkey;
alter table facturation.paiement_imputations
  drop constraint paiement_imputations_encaissement_id_key,
  add constraint paiement_imputations_pkey primary key (encaissement_id);
create index paiement_imputations_paiement_idx on facturation.paiement_imputations (paiement_id);

-- R-01 : un jour de base se paie une fois PAR LICENCE, quel que soit son titulaire.
alter table facturation.factures drop constraint factures_un_jour_de_base_une_fois;
alter table facturation.factures add constraint factures_un_jour_de_base_une_fois
  exclude using gist (
    licence_id with =, payeur_type with =,
    (coalesce(payeur_tenant_id, case when payeur_type = 'titulaire' then licence_id
                                     else payeur_personne end)) with =,
    daterange(couvre_du, couvre_au, '[)') with &&)
  where (licence_id is not null and nature = 'base' and avoir_de is null and statut <> 'annulee');

-- La demande due encore ouverte d'une licence (la dernière, ni payée ni remplacée), et le
-- jour où son dossier ferme s'il n'est pas payé.
create function facturation.demande_due_ouverte(p_licence uuid)
 returns table (demande_id uuid, due_depuis date, ferme_le date, paiement_id uuid,
                montant_ttc numeric, devise text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select d.id, d.due_depuis,
         d.due_depuis + (public.abonnement_reglage() ->> 'renouvellement_delai_jours')::integer,
         p.id, p.montant_ttc, p.devise
    from facturation.montees_demandees d
    join facturation.paiements_en_ligne p on p.montee_demandee_id = d.id
    join facturation.paiements_en_ligne_v v on v.paiement_id = p.id
   where d.licence_id = p_licence and d.due_depuis is not null
     and v.etat in ('a_payer', 'lien_cree', 'non_abouti', 'refuse')
   order by d.cree_le desc
   limit 1
$function$;
revoke all on function facturation.demande_due_ouverte(uuid) from public, anon, authenticated;

-- Le libellé d'une demande d'abonnement : un seul, pour l'essai, la montée et le dû.
create function facturation.libelle_d_abonnement(p_offre text, p_du date, p_au date)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select 'Abonnement ' || coalesce((ref.offre_a(p_offre, p_du)).libelle, p_offre)
         || ' — du ' || to_char(p_du, 'DD/MM/YYYY') || ' au ' || to_char(p_au, 'DD/MM/YYYY')
$function$;
revoke all on function facturation.libelle_d_abonnement(text, date, date) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION facturation.tarif_couvert_le(p_licence uuid, p_jour date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select sum(f.part_mensuelle_ht)
                     from facturation.factures f
                     where f.licence_id = p_licence and f.payeur_type = 'titulaire'
                      and f.ancre is not null
                      and f.avoir_de is null and f.statut <> 'annulee'
                      and f.couvre_du <= p_jour and f.couvre_au > p_jour), 0)
         + coalesce((facturation.annuel_de(p_licence, p_jour)).prix_mensuel_ht, 0)
$function$;

CREATE OR REPLACE FUNCTION facturation.periode_payee_d_avance(p_licence uuid, p_jour date, OUT tarif_ht numeric, OUT fin date)
 RETURNS record
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select sum(f.part_mensuelle_ht), max(f.couvre_au)
    from facturation.factures f
   where f.licence_id = p_licence and f.payeur_type = 'titulaire'
     and f.ancre is not null
     and f.avoir_de is null and f.statut <> 'annulee'
     and f.couvre_du <= p_jour and f.couvre_au > p_jour
$function$;

CREATE OR REPLACE FUNCTION facturation.facturation_du_titulaire(p_licence uuid, p_jour date, p_rattrapage integer, p_acteur uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_titulaire uuid;
  v_fin       date;
  v_ancre     date;
  v_s         date;
  v_plancher  date;
  v_premiere  boolean := false;
  v_tarif     numeric;
  v_couvert   numeric;
  e           record;
  p           record;
  v_res       jsonb;
  v_factures  jsonb := '[]'::jsonb;
begin
  -- Une descente programmée prend effet le jour de son échéance, AVANT que la période
  -- suivante ne se facture : la base de cette période est au prix de la nouvelle offre.
  perform facturation.descentes_dues_appliquer(p_licence, p_jour);
  select l.titulaire into v_titulaire from facturation.licences l
   where l.id = p_licence and l.statut <> 'resiliee';
  if v_titulaire is null then
    return jsonb_build_object('factures', v_factures, 'couverte', false);
  end if;

  -- 1. Les échéances.
  -- Une facture de recharge (R-04) ne couvre aucune période : elle ne compte pas ici.
  select x.couvre_au, x.ancre into v_fin, v_ancre
    from facturation.factures x
   where x.licence_id = p_licence and x.payeur_type = 'titulaire'
     and x.nature <> 'recharge'
     and x.avoir_de is null and x.statut <> 'annulee'
   order by x.couvre_au desc, x.ancre nulls last
   limit 1;

  if v_fin is not null and v_fin <= p_jour
     and exists (select 1 from facturation.part_du_titulaire_le(p_licence, v_fin)) then
    v_s     := v_fin;
    v_ancre := coalesce(v_ancre, facturation.debut_de_la_suite(p_licence, v_fin));
  elsif v_fin is null or v_fin <= p_jour then
    v_ancre    := facturation.debut_de_la_suite(p_licence, p_jour);
    v_s        := v_ancre;
    v_premiere := true;
  end if;

  if v_s is not null then
    -- La fenêtre recule d'ÉCHÉANCES, depuis la période en cours, sur l'ancre
    -- d'origine : reculer de mois civils ramène un 30 mars au 28 février et
    -- sauterait [31 janv., 28 févr.) (revue de #228).
    v_plancher := (facturation.echeance_de(v_ancre, p_jour)).debut;
    for i in 2 .. p_rattrapage loop
      exit when v_plancher <= v_ancre;
      v_plancher := (facturation.echeance_de(v_ancre, v_plancher - 1)).debut;
    end loop;
    if v_s < v_plancher then
      v_s := v_plancher;
      v_premiere := false;
    end if;
    while v_s <= p_jour loop
      select * into p from facturation.part_du_titulaire_le(p_licence, v_s);
      exit when p.part_ht is null;
      select * into e from facturation.echeance_de(v_ancre, v_s);
      v_res := facturation.emission_du_titulaire(
                 p_licence,
                 case when v_premiere and p.base_par_un_cabinet then 'complement' else 'base' end,
                 v_s, e.fin, e.debut, v_ancre, p.part_ht, not p.base_par_un_cabinet,
                 p.offre_code, p.reference, p_jour, p_acteur);
      if v_res ? 'facture_id' then
        v_factures := v_factures || v_res;
      end if;
      v_premiere := false;
      v_s := e.fin;
    end loop;
  end if;

  -- 2. Le complément du jour. Le jour est couvert par une facture de la
  -- suite, ou par l'année (un mois qu'elle paie seule n'a pas de facture).
  select x.ancre into v_ancre
    from facturation.factures x
   where x.licence_id = p_licence and x.payeur_type = 'titulaire'
     and x.ancre is not null
     and x.avoir_de is null and x.statut <> 'annulee'
     and x.couvre_du <= p_jour
   order by x.couvre_au desc
   limit 1;
  if v_ancre is null
     or not (exists (select 1 from facturation.factures x
                      where x.licence_id = p_licence and x.payeur_type = 'titulaire'
                        and x.ancre is not null
                        and x.avoir_de is null and x.statut <> 'annulee'
                        and x.couvre_du <= p_jour and x.couvre_au > p_jour)
             or (facturation.annuel_de(p_licence, p_jour)).id is not null) then
    return jsonb_build_object('factures', v_factures, 'couverte', false);
  end if;

  select * into p from facturation.part_du_titulaire_le(p_licence, p_jour);
  v_tarif   := coalesce(p.part_ht, 0);
  v_couvert := facturation.tarif_couvert_le(p_licence, p_jour);
  if v_tarif > v_couvert then
    select * into e from facturation.echeance_de(v_ancre, p_jour);
    v_res := facturation.emission_du_titulaire(
               p_licence, 'complement', p_jour, e.fin, e.debut, v_ancre, v_tarif - v_couvert,
               not p.base_par_un_cabinet, p.offre_code, p.reference, p_jour, p_acteur);
    if v_res ? 'facture_id' then
      v_factures := v_factures || v_res;
    end if;
  end if;
  return jsonb_build_object('factures', v_factures, 'couverte', true);
end
$function$;

-- Le libellé d'une ligne de recharge, dit une fois : la facture de base qui la porte et la
-- facture de recharge née de son paiement (R-04) écrivent la même ligne.
create function facturation.libelle_de_recharge(p_lectures integer, p_origine text, p_le date)
 returns text
 language sql
 immutable
 set search_path to ''
as $$
  select 'Recharge ' || p_lectures || ' lectures'
         || case when p_origine = 'automatique' then ' (automatique)' else '' end
         || ' — ' || to_char(p_le, 'DD/MM/YYYY')
$$;

CREATE OR REPLACE FUNCTION facturation.emission_du_titulaire(p_licence uuid, p_nature text, p_du date, p_au date, p_periode_du date, p_ancre date, p_tarif_mensuel numeric, p_inclut_la_base boolean, p_offre text, p_reference text, p_jour date, p_acteur uuid, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c          record;
  f          record;
  v_jours    integer := p_au - p_du;
  v_jdp      integer := p_au - p_periode_du;
  v_nom      text;
  v_part     numeric := p_tarif_mensuel;
  v_abo      numeric := round(p_tarif_mensuel * (p_au - p_du) / (p_au - p_periode_du), 3);
  v_par_an   numeric := 0;
  v_annuel   facturation.engagements_annuels;
  v_debut    facturation.engagements_annuels;
  v_recharge record;
  v_montee   record;
  v_paiement record;
  v_impute   numeric;
  v_ht       numeric;
  v_tva      numeric;
  v_numero   text;
  v_id       uuid;
  v_enc      uuid;
  v_ordinal  smallint := 0;
  v_dates    text := 'du ' || to_char(p_du, 'DD/MM/YYYY') || ' au '
                     || to_char(p_au - 1, 'DD/MM/YYYY')
                     || case when p_au - p_du <> p_au - p_periode_du
                             then ' (' || (p_au - p_du) || '/' || (p_au - p_periode_du) || ' jours)'
                             else '' end;
begin
  -- D7 (25 novembre 2026) : aucune facture du titulaire avant l'encaissement. Elle ne naît
  -- que dans le geste qui encaisse (`une_montee_payee_s_ouvre`) ou qui la chiffre
  -- (`facture_jouee`, défait) ; ailleurs, ce qui est dû devient une demande à payer.
  if coalesce(current_setting('malica.paye_d_abord_le', true), '') = '' then
    return jsonb_build_object('au_paiement', true);
  end if;
  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from facturation.factures x
              where x.licence_id = p_licence and x.payeur_type = 'titulaire'
                and x.nature = p_nature
                and x.couvre_du = p_du and x.avoir_de is null)
     or (p_nature = 'base' and exists (
           select 1 from facturation.factures x
            where x.licence_id = p_licence and x.payeur_type = 'titulaire'
              and x.nature = 'base'
              and x.avoir_de is null and x.statut <> 'annulee'
              and daterange(x.couvre_du, x.couvre_au, '[)') && daterange(p_du, p_au, '[)'))) then
    return jsonb_build_object('deja', true);
  end if;
  -- Une licence sans société n'est pas encore servie : rien à facturer.
  if coalesce(c.organisations, 0) < 1 then
    return jsonb_build_object('rien', true);
  end if;

  select p.display_name into v_nom from identity.profiles p where p.user_id = c.titulaire;
  if v_nom is null or length(btrim(v_nom)) = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.destinataire_sans_nom',
                                                'destinataire', (c.titulaire)::text)
      using errcode = 'no_data_found';
  end if;

  select * into f from facturation.fiscalite_en_vigueur(p_jour);
  if f.timbre is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;

  if p_nature = 'base' then
    -- L'ANNÉE (20261022190000) : l'offre des jours couverts est payée par
    -- l'engagement ; il ne reste que les places et sociétés en plus.
    v_annuel := facturation.annuel_de(p_licence, p_du);
    if v_annuel.id is not null then
      v_part := greatest(0, p_tarif_mensuel - v_annuel.prix_mensuel_ht);
    end if;
    -- Jour par jour : une montée pendant l'année change le prix couvert (7.5).
    select coalesce(round(sum((facturation.annuel_de(p_licence, j::date)).prix_mensuel_ht) / v_jdp, 3), 0)
      into v_par_an
      from generate_series(p_du, p_au - 1, interval '1 day') j;
    v_abo := greatest(0, v_abo - v_par_an);
    select e.* into v_debut from facturation.engagements_annuels e
     where e.licence_id = p_licence and e.du < p_au
       and not exists (select 1 from facturation.facture_annuels fa where fa.engagement_id = e.id)
     order by e.souscrit_le limit 1;
    select (v_abo + coalesce(v_debut.montant_ht, 0) + coalesce(sum(x.prix_ht), 0)) into v_ht
      from facturation.recharges x
     where x.licence_id = p_licence and x.achetee_le <= p_jour
       and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
    v_ht := v_ht + facturation.annuel_montees_a_facturer(p_licence, p_jour + 1);
  else
    v_ht := v_abo;
  end if;

  -- Rien à payer (l'année couvre tout, ou un écart qui s'arrondit à zéro) :
  -- aucune facture, qui ne porterait qu'un timbre.
  if v_ht <= 0 then
    return jsonb_build_object('couvert', case when v_annuel.id is not null then 'annuel' end);
  end if;

  v_tva    := round(v_ht * f.taux, 3);
  v_numero := facturation.numero_de_facture(p_jour);

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations,
     sieges_payants, montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id,
     reference_abonne, nature, couvre_du, couvre_au, ancre, part_mensuelle_ht, inclut_la_base)
  values
    (p_licence, v_numero, date_trunc('month', p_du)::date, p_jour, p_jour + p_jours_echeance,
     p_offre, c.organisations, greatest(0, c.sieges_occupes - c.sieges_inclus), v_ht, f.taux,
     v_tva, f.timbre, v_ht + v_tva + f.timbre, f.devise,
     'titulaire', null, c.titulaire, v_nom, null,
     p_reference, p_nature, p_du, p_au, p_ancre, v_part, p_inclut_la_base)
  returning id into v_id;

  if p_nature = 'complement' then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            'Complément d''abonnement ' || coalesce((ref.offre_a(p_offre, p_du)).libelle, p_offre)
              || ' (offre, places ou sociétés en plus) — ' || v_dates,
            1, v_abo, v_abo);
  elsif v_annuel.id is null and v_par_an = 0 then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1, 'Abonnement ' || coalesce((ref.offre_a(p_offre, p_du)).libelle, p_offre) || ' — ' || v_dates, 1, v_abo, v_abo);
  elsif v_abo > 0 then
    v_ordinal := 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            case when v_annuel.id is not null
                 then 'Places et sociétés en plus — ' || v_dates
                      || ' (l''offre est couverte par l''abonnement annuel)'
                 else 'Abonnement ' || coalesce((ref.offre_a(p_offre, p_du)).libelle, p_offre) || ' — ' || v_dates
                      || ' (hors jours couverts par l''abonnement annuel)' end,
            1, v_abo, v_abo);
  end if;

  if p_nature = 'base' then
    if v_debut.id is not null then
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal,
              'Abonnement annuel ' || coalesce((ref.offre_a(v_debut.offre_code, v_debut.du)).libelle, v_debut.offre_code) || ' — du '
                || to_char(v_debut.du, 'DD/MM/YYYY') || ' au ' || to_char(v_debut.au, 'DD/MM/YYYY')
                || ' (12 mois, ' || v_debut.mois_offerts || ' offerts)',
              1, v_debut.montant_ht, v_debut.montant_ht);
      insert into facturation.facture_annuels (facture_id, engagement_id) values (v_id, v_debut.id);
    end if;

    for v_montee in
      select m.id, m.libelle, m.montant_ht
        from facturation.engagement_montees m
       where m.licence_id = p_licence and m.le <= p_jour
         and not exists (select 1 from facturation.facture_engagement_montees fm
                          where fm.montee_id = m.id)
       order by m.le, m.created_at
    loop
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal, v_montee.libelle, 1, v_montee.montant_ht, v_montee.montant_ht);
      insert into facturation.facture_engagement_montees (facture_id, montee_id)
      values (v_id, v_montee.id);
    end loop;

    for v_recharge in
      select x.id, x.lectures, x.prix_ht, x.achetee_le, x.origine
        from facturation.recharges x
       where x.licence_id = p_licence and x.achetee_le <= p_jour
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id)
       order by x.achetee_le, x.id
    loop
      v_ordinal := v_ordinal + 1;
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
      values (v_id, v_ordinal,
              facturation.libelle_de_recharge(v_recharge.lectures, v_recharge.origine,
                                              v_recharge.achetee_le),
              1, v_recharge.prix_ht, v_recharge.prix_ht);
      insert into facturation.facture_recharges (facture_id, recharge_id) values (v_id, v_recharge.id);
    end loop;

    -- Les acomptes payés en ligne (montée d'avant, recharge, année) s'imputent
    -- ici ; le paiement d'une facture s'est inscrit sur ELLE, à la confirmation.
    -- Un paiement se répartit (25 novembre 2026) : la facture prend ce qui lui reste dû, le
    -- reste du paiement va à la facture suivante du même geste (`une_montee_payee_s_ouvre`).
    for v_paiement in
      select p.id, p.montant_ttc - coalesce(deja.montant, 0) as reste, e.reference, e.prestataire,
             e.le::date as le, facturation.moyen_encaissement_du_paiement(p.id) as moyen
        from facturation.paiements_en_ligne p
        join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
        join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                 and pp.fait_entrer_argent
        left join lateral (select sum(en.montant) as montant
                             from facturation.paiement_imputations i
                             join facturation.encaissements en on en.id = i.encaissement_id
                            where i.paiement_id = p.id) deja on true
       where p.licence_id = p_licence
         and p.objet <> 'facture'
         and p.montant_ttc > coalesce(deja.montant, 0)
       order by e.le, p.id
    loop
      v_impute := least(v_paiement.reste,
                        (select e.reste_du from facturation.encours_v e where e.facture_id = v_id));
      exit when v_impute <= 0;
      insert into facturation.encaissements
        (facture_id, montant, moyen, reference, encaisse_le, saisi_par)
      values (v_id, v_impute, v_paiement.moyen,
              v_paiement.prestataire || ' ' || coalesce(v_paiement.reference, v_paiement.id::text),
              v_paiement.le, coalesce(auth.uid(), p_acteur))
      returning id into v_enc;
      insert into facturation.paiement_imputations (paiement_id, encaissement_id)
      values (v_paiement.id, v_enc);
    end loop;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, p_acteur, 'facture.emise', 'facturation', 'factures', v_id,
         jsonb_build_object('numero', v_numero, 'nature', p_nature, 'du', p_du, 'au', p_au,
                            'ttc', v_ht + v_tva + f.timbre, 'par', 'facturation_automatique')
    from (select facturation.societe_facturee(p_licence) as tenant_id) lo;
  perform facturation.avertir_de_la_facture(v_id);

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'nature', p_nature,
                            'du', p_du, 'au', p_au, 'ht', v_ht, 'ttc', v_ht + v_tva + f.timbre);
end
$function$;

CREATE OR REPLACE FUNCTION facturation.facture_jouee(p_licence uuid, p_offre text, p_tenant uuid, p_jour date, p_clore_essai boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reglage plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('pme');
  v_det     text;
  v_avant   uuid[];
  r         jsonb;
begin
  -- Les factures qui existaient avant le jeu : seule compte celle que le jeu émet.
  select coalesce(array_agg(x.id), '{}') into v_avant
    from facturation.factures x where x.licence_id = p_licence;
  begin
    -- En essai, le jeu clôt d'abord l'essai ce jour-là : la facture jouée est la première
    -- base, de ce jour à la même date le mois suivant.
    if p_clore_essai then
      perform facturation.essai_clore(p_licence, p_jour, 'paiement');
    end if;
    -- Le jeu chiffre ce que le paiement émettra : il se place dans le geste qui encaisse.
    perform set_config('malica.paye_d_abord_le', p_jour::text, true);
    if p_offre is distinct from (select c.offre_code from facturation.forfait_courant_v c
                                  where c.licence_id = p_licence) then
      perform public.forfait_changer(p_offre, p_tenant, p_jour);
    end if;
    perform facturation.facturation_du_titulaire(p_licence, p_jour, v_reglage.rattrapage_mois,
                                                 v_reglage.decide_par);
    -- TOUT ce que le jeu émet est dû ensemble (une échéance en retard et le jour) : la
    -- somme, du premier jour couvert au dernier. Le paiement émettra les mêmes factures.
    select case when count(*) > 0 then jsonb_build_object(
             'ht', sum(x.montant_ht), 'tva', sum(x.montant_tva), 'timbre', sum(x.timbre),
             'ttc', sum(x.montant_ttc), 'devise', min(x.devise),
             'du', greatest(min(x.couvre_du), p_jour), 'au', max(x.couvre_au) - 1,
             'debut', min(x.couvre_du),   -- la période couverte, telle que la facture la dira
             'jours', max(x.couvre_au) - greatest(min(x.couvre_du), p_jour),
             'jours_periode', max(x.couvre_au) - min(x.couvre_du),
             'factures', count(*)) end
      into r
      from facturation.factures x
     where x.licence_id = p_licence and x.payeur_type = 'titulaire'
       and x.ancre is not null and x.avoir_de is null and x.statut <> 'annulee'
       and not (x.id = any (v_avant));   -- émises par CE jeu, pas avant lui
    if r is null then
      r := jsonb_build_object('rien', true,
                              'au', (facturation.periode_payee_d_avance(p_licence, p_jour)).fin - 1);
    end if;
    raise exception using errcode = 'MLM03', detail = r::text;
  exception when sqlstate 'MLM03' then
    get stacked diagnostics v_det = pg_exception_detail;
  end;
  return v_det::jsonb;
end
$function$;

revoke all on function facturation.facture_jouee(uuid, text, uuid, date, boolean)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION facturation.montee_a_regler(p_licence uuid, p_offre text, p_tenant uuid, p_jour date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_licence is null or not facturation.titulaire_de(p_licence) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  return facturation.facture_jouee(p_licence, p_offre, p_tenant, p_jour, true);
end
$function$;
drop function facturation.montee_demandee_ouvrir(uuid, uuid, text, numeric, numeric, numeric, numeric, text, text);

CREATE OR REPLACE FUNCTION facturation.montee_demandee_ouvrir(p_licence uuid, p_tenant uuid, p_offre text, p_ht numeric, p_tva numeric, p_timbre numeric, p_ttc numeric, p_devise text, p_libelle text, p_par uuid, p_due_depuis date, p_le date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- La demande payée d'abord, et son paiement à régler : un seul chemin pour la montée, le
-- passage de l'essai à l'abonnement, et ce qui est dû (`du_a_payer`, D7, 25 novembre 2026).
declare
  v_le     date;
  f        record;
  v_dem    uuid;
  v_id     uuid;
begin
  -- Le jour du devis : celui que le passage chiffre, sinon celui de la plateforme.
  v_le := coalesce(p_le, (now() at time zone plateforme.fuseau_de_la_plateforme())::date);

  -- La même demande, encore à payer : on la rend telle quelle.
  select p.id into v_id
    from facturation.montees_demandees d
    join facturation.paiements_en_ligne p on p.montee_demandee_id = d.id
    join facturation.paiements_en_ligne_v v on v.paiement_id = p.id
   where d.licence_id = p_licence and d.offre_code = p_offre and d.le = v_le
     and p.montant_ttc = p_ttc
     and d.due_depuis is not distinct from p_due_depuis
     and v.etat in ('a_payer', 'lien_cree', 'non_abouti', 'refuse')
   order by d.cree_le desc limit 1;
  if v_id is not null then
    return jsonb_build_object('change', false, 'deja', true, 'paiement',
      (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id));
  end if;

  select * into f from facturation.fiscalite_en_vigueur(v_le);

  insert into facturation.montees_demandees
    (licence_id, par_societe, offre_code, le, demande_par, due_depuis)
  values (p_licence, p_tenant, p_offre, v_le, p_par, p_due_depuis)
  returning id into v_dem;

  insert into facturation.paiements_en_ligne
    (licence_id, objet, montee_demandee_id, libelle, montant_ht, taux_tva, montant_tva, timbre,
     montant_ttc, devise, cree_par)
  values
    (p_licence, 'montee_demandee', v_dem, p_libelle, p_ht, f.taux, p_tva, p_timbre, p_ttc,
     coalesce(p_devise, f.devise), p_par)
  returning id into v_id;

  return jsonb_build_object('change', false, 'paiement',
    (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id));
end
$function$;

revoke all on function facturation.montee_demandee_ouvrir(uuid, uuid, text, numeric, numeric, numeric, numeric, text, text, uuid, date, date)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.forfait_demander(p_offre text, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
  v_auto    boolean := plateforme.facturation_auto_ouverte('pme');
  v_annee   boolean;
  v_devis   jsonb;
  v_sim     jsonb;
  v_ht      numeric;
  v_tva     numeric;
  v_timbre  numeric;
  v_ttc     numeric;
  v_devise  text;
  v_libelle text;
  v_programmee jsonb;
begin
  select c.offre_code into v_courant
    from facturation.forfait_courant_v c where c.licence_id = v_licence;

  -- EN ESSAI (25 novembre 2026) : passer à l'abonnement se paie d'abord, quelle que soit
  -- l'offre — la même ou une autre. Le montant est la première base, jouée puis défaite par
  -- la fonction même qui l'émettra au paiement ; l'essai se clôt au paiement, pas avant.
  if facturation.essai_ouvert(v_licence) then
    if not v_auto
       or not exists (select 1 from facturation.emetteurs em where em.valide_des <= current_date) then
      raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
    end if;
    v_sim := facturation.montee_a_regler(v_licence, p_offre, p_tenant,
                                         (now() at time zone plateforme.fuseau_de_la_plateforme())::date);
    if coalesce((v_sim ->> 'rien')::boolean, false) then
      raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
    end if;
    return facturation.montee_demandee_ouvrir(
      v_licence, p_tenant, p_offre, (v_sim ->> 'ht')::numeric, (v_sim ->> 'tva')::numeric,
      (v_sim ->> 'timbre')::numeric, (v_sim ->> 'ttc')::numeric, v_sim ->> 'devise',
      facturation.libelle_d_abonnement(p_offre, (v_sim ->> 'du')::date, (v_sim ->> 'au')::date),
      auth.uid(), null, null);
  end if;

  -- Une descente ne se paie pas. Sous la facturation d'avance, elle attend la fin de la
  -- période payée : le client garde jusque-là ce qu'il a payé (CGV, art. 8). Sinon, elle
  -- garde son chemin. `forfait_changer` dit ses refus.
  if v_licence is null or v_courant is null
     or (ref.offre_a(p_offre, current_date)).rang is null
     or (ref.offre_a(p_offre, current_date)).rang <= (ref.offre_a(v_courant, current_date)).rang then
    if v_licence is not null and v_courant is not null
       and (ref.offre_a(p_offre, current_date)).rang is not null then
      v_programmee := facturation.descente_programmer(v_licence, p_offre, p_tenant);
      if v_programmee is not null then
        return jsonb_build_object('change', false, 'paiement', null, 'descente', v_programmee);
      end if;
    end if;
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', public.paiement_montee_preparer(p_tenant));
  end if;

  -- Une montée annule la descente qui attendait l'échéance : le client a changé d'avis.
  perform facturation.descente_annuler_pour(v_licence, 'montee');

  -- Rien que la société paie elle-même (sa comptabilité la prend entièrement en charge) :
  -- l'offre s'ouvre tout de suite. `mes_offres` rend le prix qu'elle paie, nul sinon.
  if (select m.prix_mensuel_ht from public.mes_offres(p_tenant) m where m.code = p_offre) is null then
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', null);
  end if;

  -- Aucun paiement possible : aucune montée gratuite (20261231150000).
  if not exists (select 1 from facturation.emetteurs em where em.valide_des <= current_date) then
    raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
  end if;

  -- Les refus du changement (la porte, l'empêchement) se disent AVANT de faire payer.
  v_annee := exists (select 1 from facturation.engagements_annuels e
                      where e.licence_id = v_licence and e.au >= current_date);
  if v_annee then
    -- Pendant l'année, le montant est celui que le chemin de l'année calcule (l'écart des
    -- jours au mois et celui de l'année, les montées remplacées non réglées) : il est JOUÉ,
    -- puis défait. Sur ce chemin, rien ne s'émet ni ne se numérote — seulement l'historique,
    -- la montée de l'engagement et l'acompte, tous défaits.
    begin
      perform public.forfait_changer(p_offre, p_tenant);
      v_sim := public.paiement_montee_preparer(p_tenant);
      raise exception using errcode = 'MLM02', detail = coalesce(v_sim::text, 'null');
    exception when sqlstate 'MLM02' then
      get stacked diagnostics v_libelle = pg_exception_detail;
      v_sim := nullif(v_libelle, 'null')::jsonb;
    end;
    if v_sim is null then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
    end if;
    v_ht := (v_sim ->> 'montant_ht')::numeric;
    v_tva := (v_sim ->> 'montant_tva')::numeric;
    v_ttc := (v_sim ->> 'montant_ttc')::numeric;
    v_timbre := v_ttc - v_ht - v_tva;
    v_devise := v_sim ->> 'devise';
    v_libelle := v_sim ->> 'libelle';
  elsif v_auto then
    -- SOUS LA FACTURATION D'AVANCE : le montant est la facture que la montée émettra, JOUÉE
    -- puis défaite par la fonction même qui l'émettra (`montee_a_regler`). Un seul calcul,
    -- pour tous les cas : complément au-dessus de ce qui est payé, offre gardée, comptabilité
    -- qui paie une part, aucune facture d'avance encore. Rien d'émis : rien n'est dû, la
    -- période payée couvre déjà l'offre demandée — elle s'ouvre (recette Flouci du
    -- 24 novembre 2026, point 1 : « Basic → Solo » sous un Premium payé était refusé).
    v_sim := facturation.montee_a_regler(v_licence, p_offre, p_tenant,
                                         (now() at time zone plateforme.fuseau_de_la_plateforme())::date);
    if coalesce((v_sim ->> 'rien')::boolean, false) then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
    end if;
    v_ht := (v_sim ->> 'ht')::numeric;
    v_tva := (v_sim ->> 'tva')::numeric;
    v_timbre := (v_sim ->> 'timbre')::numeric;
    v_ttc := (v_sim ->> 'ttc')::numeric;
    v_devise := v_sim ->> 'devise';
    v_libelle := 'Passage ' || initcap(v_courant) || ' → ' || initcap(p_offre)
      || ' — du ' || to_char((v_sim ->> 'du')::date, 'DD/MM/YYYY')
      || ' au ' || to_char((v_sim ->> 'au')::date, 'DD/MM/YYYY');
  else
    begin
      perform public.forfait_changer(p_offre, p_tenant);
      raise exception using errcode = 'MLM01';
    exception when sqlstate 'MLM01' then
      null;
    end;
    -- Au mois (périmètre coupé) : le devis, qui suit la formule de la préparation du
    -- paiement (R3). Rien ne se chiffre que si rien n'est dû : l'offre s'ouvre.
    v_devis := public.montee_devis(p_offre, p_tenant);
    if (v_devis ->> 'a_regler_ttc') is null then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
    end if;
    v_ht := (v_devis ->> 'a_regler_ht')::numeric;
    v_tva := (v_devis ->> 'a_regler_tva')::numeric;
    v_timbre := coalesce((v_devis ->> 'timbre')::numeric, 0);
    v_ttc := v_ht + v_tva + v_timbre;
    v_devise := v_devis ->> 'devise';
    v_libelle := 'Passage ' || initcap(v_courant) || ' → ' || initcap(p_offre)
      || ' — ' || (v_devis ->> 'jours_restants') || '/' || (v_devis ->> 'jours_du_mois') || ' jours';
  end if;

  return facturation.montee_demandee_ouvrir(v_licence, p_tenant, p_offre, v_ht, v_tva, v_timbre,
                                            v_ttc, v_devise, v_libelle, auth.uid(), null, null);
end
$function$;

-- ---------------------------------------------------------------- ce qui est dû devient une demande
-- Ce qui est dû au jour, chiffré par la fonction même qui émettra au paiement, devient UNE
-- demande à payer. Rien n'est facturé ici. La demande ouverte du même montant se rend telle
-- quelle ; un montant changé la remplace, en gardant le jour depuis lequel c'est dû (le délai
-- de fermeture ne repart pas à chaque changement).
create function facturation.du_a_payer(p_licence uuid, p_jour date, p_acteur uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  l        facturation.licences;
  v_offre  text;
  v_tenant uuid;
  v_sim    jsonb;
  o        record;
  v_res    jsonb;
  v_pid    uuid;
  v_credit numeric;
begin
  if not plateforme.facturation_auto_ouverte('pme') then
    return null;
  end if;
  select x.* into l from facturation.licences x where x.id = p_licence and x.statut <> 'resiliee';
  if l.id is null or l.titulaire is null then
    return null;
  end if;
  -- Une descente échue s'applique au jour même, avant le chiffrage (son refus se dit, T6).
  perform facturation.descentes_dues_appliquer(p_licence, p_jour);
  select c.offre_code into v_offre from facturation.forfait_courant_v c where c.licence_id = p_licence;
  v_tenant := facturation.societe_facturee(p_licence);
  v_sim := facturation.facture_jouee(p_licence, v_offre, v_tenant, p_jour, false);
  if v_sim is null or coalesce((v_sim ->> 'rien')::boolean, false) then
    return null;
  end if;

  -- L'argent déjà encaissé, pas encore imputé (un acompte d'avant D7), ne se redemande pas.
  v_credit := facturation.acomptes_disponibles(p_licence);
  if v_credit >= (v_sim ->> 'ttc')::numeric then
    perform set_config('malica.paye_d_abord_le', p_jour::text, true);
    v_res := facturation.facturation_du_titulaire(
               p_licence, p_jour, (plateforme.facturation_auto_en_vigueur('pme')).rattrapage_mois,
               p_acteur);
    perform set_config('malica.paye_d_abord_le', '', true);
    return jsonb_build_object('par_acompte', true, 'factures', v_res);
  elsif v_credit > 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.acompte_a_rapprocher',
                                                'acompte', v_credit::text,
                                                'du', v_sim ->> 'ttc')
      using errcode = 'check_violation';
  end if;

  select * into o from facturation.demande_due_ouverte(p_licence);
  if o.demande_id is not null and o.montant_ttc = (v_sim ->> 'ttc')::numeric then
    return jsonb_build_object('change', false, 'deja', true, 'paiement',
      (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = o.paiement_id));
  end if;

  v_res := facturation.montee_demandee_ouvrir(
    p_licence, v_tenant, v_offre, (v_sim ->> 'ht')::numeric, (v_sim ->> 'tva')::numeric,
    (v_sim ->> 'timbre')::numeric, (v_sim ->> 'ttc')::numeric, v_sim ->> 'devise',
    facturation.libelle_d_abonnement(v_offre, (v_sim ->> 'debut')::date, (v_sim ->> 'au')::date),
    l.titulaire, coalesce(o.due_depuis, p_jour), p_jour);

  -- La même demande, déjà posée ce jour : rien de neuf, ni avis ni journal.
  if coalesce((v_res ->> 'deja')::boolean, false) then
    return v_res;
  end if;
  v_pid := (v_res -> 'paiement' ->> 'paiement_id')::uuid;
  select * into o from facturation.demande_due_ouverte(p_licence);
  perform notif.emettre(v_tenant, 'abonnement.a_payer',
    jsonb_build_object('paiement_id', v_pid,
                       'ttc', to_char((v_sim ->> 'ttc')::numeric, 'FM999999990.000'),
                       'devise', v_sim ->> 'devise',
                       'offre', coalesce((ref.offre_a(v_offre, p_jour)).libelle, v_offre),
                       'echeance_longue', to_char(o.ferme_le - 1, 'DD/MM/YYYY')),
    l.titulaire, 'a_payer:' || v_pid::text, interval '400 days');
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_tenant, p_acteur, 'abonnement.a_payer', 'facturation', 'paiements_en_ligne', v_pid,
          jsonb_build_object('ttc', v_sim -> 'ttc', 'du', v_sim -> 'du', 'au', v_sim -> 'au',
                             'due_depuis', o.due_depuis));
  return v_res;
end
$function$;
revoke all on function facturation.du_a_payer(uuid, date, uuid) from public, anon, authenticated;
-- Le passage du jour compte, côté PME, des demandes à payer, pas des factures (D7) : un compteur
-- à lui, lu par la tour. « Déjà » compte une demande ouverte que le passage retrouve inchangée.
alter table fabrique.facturations_du_jour
  add column demandes integer not null default 0 check (demandes >= 0);
comment on column fabrique.facturations_du_jour.demandes is
  'Demandes à payer ouvertes par ce passage (périmètre PME, D7) ; 0 côté cabinets.';

CREATE OR REPLACE FUNCTION fabrique.facturation_des_pme(p_jour date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reglage  plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('pme');
  v_depuis   date;
  r          record;
  v_res      jsonb;
  v_cle      text;
  v_emises   integer := 0;
  v_deja     integer := 0;
  v_rien     integer := 0;
  v_demandes integer := 0;
  v_factures jsonb := '[]'::jsonb;
  v_erreurs  jsonb := '[]'::jsonb;
begin
  if not coalesce(v_reglage.actif, false) then
    return jsonb_build_object('etat', 'coupee');
  end if;
  if exists (select 1 from fabrique.facturations_du_jour x
              where x.jour = p_jour and x.decision_id = v_reglage.id) then
    return jsonb_build_object('etat', 'deja_passee', 'decision', v_reglage.id);
  end if;

  v_depuis := (p_jour - make_interval(months => v_reglage.rattrapage_mois))::date;
  for r in
    select distinct pv.licence_id
      from facturation.payeurs_v pv
      join facturation.licences l on l.id = pv.licence_id and l.statut <> 'resiliee'
     where pv.payeur_type = 'titulaire'
       and pv.du <= p_jour
       and (pv.au_exclu is null or pv.au_exclu > v_depuis)
     order by 1
  loop
    begin
      -- D7 (25 novembre 2026) : le passage n'émet plus de facture au titulaire. Ce qui est dû
      -- devient une demande à payer ; la facture naît au paiement.
      v_res := facturation.du_a_payer(r.licence_id, p_jour, v_reglage.decide_par);
      if v_res is null then
        v_rien := v_rien + 1;
      elsif coalesce((v_res ->> 'deja')::boolean, false) then
        v_deja := v_deja + 1;
      elsif coalesce((v_res ->> 'par_acompte')::boolean, false) then
        v_emises := v_emises + 1;   -- réglée par un acompte d'avant D7 : la facture est née.
      else
        v_demandes := v_demandes + 1;
        v_factures := v_factures || jsonb_build_object(
          'licence', r.licence_id, 'paiement', v_res -> 'paiement' -> 'paiement_id');
      end if;
    exception
      when unique_violation or exclusion_violation then
        v_deja := v_deja + 1;
      when others then
        v_cle := split_part(sqlerrm, '?', 1);
        v_erreurs := v_erreurs || jsonb_build_object(
          'licence', r.licence_id, 'periode', p_jour, 'cle', left(v_cle, 200), 'etat', sqlstate);
    end;
  end loop;

  insert into fabrique.facturations_du_jour
    (perimetre, jour, decision_id, emises, deja_emises, rien_a_facturer, erreurs, demandes, detail)
  values ('pme', p_jour, v_reglage.id, v_emises, v_deja, v_rien, jsonb_array_length(v_erreurs),
          v_demandes,
          jsonb_build_object('demandes', v_factures, 'erreurs', v_erreurs, 'depuis', v_depuis));

  return jsonb_build_object(
    'etat', 'passee', 'decision', v_reglage.id,
    'emises', v_emises, 'deja_emises', v_deja, 'rien_a_facturer', v_rien,
    'demandes', v_demandes, 'a_payer', v_factures,
    'erreurs', jsonb_array_length(v_erreurs), 'detail_erreurs', v_erreurs);
end
$function$;

-- La tour lit le nouveau compteur avec les autres.
CREATE OR REPLACE FUNCTION plateforme.facturation_auto_etat_du_perimetre(p_perimetre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reglage plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur(p_perimetre);
begin
  return jsonb_build_object(
    'reglage',
      case when v_reglage.id is null then null else
        jsonb_build_object(
          'actif', v_reglage.actif, 'rattrapage_mois', v_reglage.rattrapage_mois,
          'motif', v_reglage.motif, 'decide_le', v_reglage.decide_le,
          'decide_par_email', (select u.email::text from auth.users u where u.id = v_reglage.decide_par),
          'decide_par_nom', (select p.display_name::text from identity.profiles p
                              where p.user_id = v_reglage.decide_par))
      end,
    'dernier',
      (select jsonb_build_object('jour', x.jour, 'passee_le', x.passee_le,
                                 'emises', x.emises, 'deja_emises', x.deja_emises,
                                 'demandes', x.demandes,
                                 'rien_a_facturer', x.rien_a_facturer, 'erreurs', x.erreurs,
                                 'detail_erreurs', coalesce(x.detail -> 'erreurs', '[]'::jsonb))
         from fabrique.facturations_du_jour x
        where x.perimetre = p_perimetre
        order by x.passee_le desc, x.rang desc limit 1));
end
$function$;

CREATE OR REPLACE FUNCTION facturation.facturer_sur_le_champ(p_licence uuid, p_jour date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reglage plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('pme');
  v_jour    date;
begin
  if p_licence is null or not coalesce(v_reglage.actif, false) then
    return null;
  end if;
  begin
    v_jour := (now() at time zone plateforme.fuseau_de_la_plateforme())::date;
    if p_jour is not null and p_jour > v_jour then
      return null;
    end if;
    -- D7 : un changement ne facture pas ; ce qu'il rend dû devient une demande à payer.
    return facturation.du_a_payer(p_licence, v_jour, v_reglage.decide_par);
  exception when others then
    raise warning 'facturation.facturer_sur_le_champ(%) : %', p_licence, sqlerrm;
    return null;
  end;
end
$function$;

CREATE OR REPLACE FUNCTION public.paiement_montee_preparer(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence  uuid;
  r          record;
  v_prec     record;
  v_ecart    numeric;
  v_jours    int;
  v_restants int;
  v_ht       numeric;
  f          record;
  v_id       uuid;
  v_annee    facturation.engagement_montees;
begin
  -- T8 : la licence du titulaire, sans hasard ; titulaire de plusieurs, il dit laquelle.
  v_licence := facturation.ma_licence(p_tenant);
  -- La porte, nommée (`schema.test.ts`) : dirigeant d'une société de la
  -- licence, ET son propriétaire principal.
  if v_licence is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(v_licence) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;

  -- La montée en cours d'abord, puis celle que le forfait en cours garde.
  for r in
    select h.id, h.rang, h.offre_code, h.offre_depuis, h.effet_du, h.ecart_titulaire_ht
      from facturation.forfait_historique c
      join facturation.forfait_historique h
        on h.id = c.id or (h.id = c.garde_forfait_id and c.garde_jusqu_au > current_date)
     where c.licence_id = v_licence and c.effet_au is null and h.motif = 'montee'
     order by (h.id = c.id) desc
  loop
    -- Déjà préparé : on le rend tel quel.
    -- Une montée payée d'abord (`forfait_demander`) l'est par sa demande : elle ne se
    -- repaie pas quand un changement suivant la relit.
    select p.id into v_id from facturation.paiements_en_ligne p
     where p.forfait_id = r.id
        or p.montee_demandee_id = (select o.montee_id from facturation.montees_ouvertes o
                                    where o.forfait_id = r.id);
    if v_id is not null then
      return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
    end if;

    -- Une montée pendant l'année, ou avant qu'elle commence (7.5) : l'écart
    -- de l'année se règle le jour même, quel que soit le périmètre.
    select m.* into v_annee from facturation.engagement_montees m where m.forfait_id = r.id;

    if plateforme.facturation_auto_ouverte('pme') and v_annee.id is null then
      -- D7 : ce que la montée rend dû est une demande à payer ; la facture naîtra au paiement.
      perform facturation.facturer_sur_le_champ(v_licence, r.effet_du);
      select d.paiement_id into v_id from facturation.demande_due_ouverte(v_licence) d;
      if v_id is not null then
        return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
      end if;
      continue;   -- rien de dû pour elle (déjà couvert, ou le passage réessaiera).
    end if;

    select h.offre_code, h.offre_depuis into v_prec
      from facturation.forfait_historique h
     where h.licence_id = v_licence and h.effet_au = r.effet_du and h.rang < r.rang
     order by h.rang desc limit 1;
    if v_prec.offre_code is null then
      continue;
    end if;
    v_ecart := coalesce(
      r.ecart_titulaire_ht,
      (ref.offre_a(r.offre_code, r.offre_depuis)).prix_mensuel_ht
        - (ref.offre_a(v_prec.offre_code, v_prec.offre_depuis)).prix_mensuel_ht);
    -- La seule formule du prorata, la même que celle du devis (`montee_devis`).
    select p.ht, p.restants, p.jours into v_ht, v_restants, v_jours
      from facturation.montee_prorata(v_ecart, r.effet_du) p;
    if v_annee.id is not null then
      -- Les jours d'avant l'année restent au mois (sauf périmètre ouvert, où
      -- le complément du jour les porte) ; ceux de l'année, par l'écart annuel.
      v_ht := case when r.effet_du < (select e.du from facturation.engagements_annuels e
                                         where e.id = v_annee.engagement_id)
                    and not plateforme.facturation_auto_ouverte('pme')
                   then coalesce(v_ht, 0) else 0 end
              -- L'écart de cette montée, et ceux des montées de la même année
              -- qu'elle remplace sans qu'ils aient été réglés ni facturés : un
              -- acompte remplacé ne se paie plus, son écart passe ici, une fois.
              + (select sum(m.montant_ht)
                   from facturation.engagement_montees m
                  where m.engagement_id = v_annee.engagement_id
                    and (m.le, m.created_at) <= (v_annee.le, v_annee.created_at)
                    and not exists (select 1 from facturation.facture_engagement_montees fm
                                     where fm.montee_id = m.id)
                    and not exists (select 1 from facturation.paiements_en_ligne p
                                      join facturation.paiement_evenements ev
                                        on ev.paiement_id = p.id and ev.etat = 'paye'
                                     where p.forfait_id = m.forfait_id
                                        or p.montee_demandee_id = (
                                             select o.montee_id from facturation.montees_ouvertes o
                                              where o.forfait_id = m.forfait_id)));
    end if;
    if v_ht is null or v_ht <= 0 then
      continue;
    end if;

    -- Sans émetteur désigné, ALGORIA ne facture pas encore : rien ne se prépare,
    -- et on ne suppose aucune TVA (R4). L'offre reste ouverte ; la tour désigne
    -- l'émetteur, et le paiement suivra la facture.
    if not exists (select 1 from facturation.emetteurs e where e.valide_des <= r.effet_du) then
      return null;
    end if;

    select * into f from facturation.fiscalite_en_vigueur(r.effet_du);

    insert into facturation.paiements_en_ligne
      (licence_id, objet, forfait_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
       devise, cree_par)
    values
      (v_licence, 'montee', r.id,
       coalesce(v_annee.libelle,
                'Passage ' || initcap(v_prec.offre_code) || ' → ' || initcap(r.offre_code)
                  || ' — ' || v_restants || '/' || v_jours || ' jours'),
       v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
    returning id into v_id;

    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
  end loop;

  return null;   -- rien à payer maintenant : aucune montée due.
end
$function$;

CREATE OR REPLACE FUNCTION facturation.une_montee_payee_s_ouvre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d         facturation.montees_demandees;
  p         facturation.paiements_en_ligne;
  v_rendu   text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_ouvert  uuid;
  v_facture uuid;
  v_enc     uuid;
  v_jour    date;
  v_restant numeric;
  v_part    numeric;
  v_f       record;
  v_avant   uuid[];
  v_reglage plateforme.reglages_facturation_auto;
begin
  if new.etat <> 'paye' then
    return new;
  end if;
  -- Un « payé » du simulateur ne fait entrer aucun argent : il n'ouvre rien, comme il
  -- ne règle aucune facture (audit du 23 novembre 2026, B3).
  if not exists (select 1 from facturation.prestataires_paiement pp
                  where pp.code = new.prestataire and pp.fait_entrer_argent) then
    return new;
  end if;
  select x.* into p from facturation.paiements_en_ligne x
   where x.id = new.paiement_id and x.objet = 'montee_demandee';
  if p.id is null then
    return new;
  end if;
  select m.* into d from facturation.montees_demandees m where m.id = p.montee_demandee_id;
  if exists (select 1 from facturation.montees_ouvertes o where o.montee_id = d.id) then
    return new;
  end if;

  perform set_config('request.jwt.claim.sub', d.demande_par::text, true);
  begin
    -- Le paiement qui met fin à un essai l'arrête au jour de la demande (25 novembre 2026).
    perform facturation.essai_clore(d.licence_id, d.le, 'paiement');
    -- Une demande de changement ouvre son offre ; une demande DUE (renouvellement, complément,
    -- D7) règle ce qui est dû sans rien changer : une descente faite entre-temps reste faite.
    if d.due_depuis is null
       and d.offre_code is distinct from (select c.offre_code from facturation.forfait_courant_v c
                                           where c.licence_id = d.licence_id) then
      perform public.forfait_changer(d.offre_code, d.par_societe, d.le);
    end if;
    select c.id into v_ouvert from facturation.forfait_courant_v c where c.licence_id = d.licence_id;
    insert into facturation.montees_ouvertes (montee_id, forfait_id) values (d.id, v_ouvert);

    if plateforme.facturation_auto_ouverte('pme')
       and exists (select 1 from facturation.prestataires_paiement pp
                    where pp.code = new.prestataire and pp.fait_entrer_argent)
       and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
      -- La facture se tire par la fonction même que le devis a jouée : celle qui couvre le
      -- jour porte le paiement. Une erreur d'émission remonte au bloc ci-dessous (le refus
      -- s'écrit, la tour le voit) au lieu d'être avalée en avertissement.
      -- Le jour de la demande au plus tôt : ce qu'elle a chiffré ce jour-là naît au paiement.
      v_jour := greatest((now() at time zone plateforme.fuseau_de_la_plateforme())::date, d.le);
      v_reglage := plateforme.facturation_auto_en_vigueur('pme');
      select coalesce(array_agg(x.id), '{}') into v_avant
        from facturation.factures x where x.licence_id = d.licence_id;
      -- La facture qui naît de ce paiement naît réglée : son avis le dit (20261231270000).
      perform set_config('malica.paye_d_abord_le', v_jour::text, true);
      perform facturation.facturation_du_titulaire(d.licence_id, v_jour, v_reglage.rattrapage_mois,
                                                   v_reglage.decide_par);
      perform set_config('malica.paye_d_abord_le', '', true);
      -- CE paiement se répartit sur les factures qu'il vient d'émettre, dans l'ordre des jours
      -- (une échéance en retard, puis le jour) ; l'émission d'une base en a peut-être déjà
      -- pris sa part. Les factures suivent la licence, pas la personne (R-01).
      v_restant := p.montant_ttc - coalesce((select sum(en.montant)
                                               from facturation.paiement_imputations i
                                               join facturation.encaissements en on en.id = i.encaissement_id
                                              where i.paiement_id = p.id), 0);
      for v_f in
        select f.id, e.reste_du
          from facturation.factures f
          join facturation.encours_v e on e.facture_id = f.id
         where f.licence_id = d.licence_id and f.payeur_type = 'titulaire'
           and f.avoir_de is null and f.statut <> 'annulee'
           and not (f.id = any (v_avant))
         order by f.couvre_du, f.nature
      loop
        v_facture := v_f.id;
        exit when v_restant <= 0;
        continue when v_f.reste_du <= 0;
        v_part := least(v_restant, v_f.reste_du);
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_f.id, v_part, facturation.moyen_encaissement_du_paiement(p.id),
                new.prestataire || ' ' || coalesce(new.reference, p.id::text), new.le::date)
        returning id into v_enc;
        insert into facturation.paiement_imputations (paiement_id, encaissement_id)
        values (p.id, v_enc);
        v_restant := v_restant - v_part;
      end loop;
      -- Payé plus que ce qui est dû (le dû a changé entre la demande et le paiement) : la
      -- différence est due au client, la tour la voit au journal.
      if v_restant > 0 then
        insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
        values (d.par_societe, d.demande_par, 'paiement.trop_percu', 'facturation',
                'paiements_en_ligne', p.id,
                jsonb_build_object('facture_id', v_facture, 'encaisse', p.montant_ttc,
                                   'trop_percu', v_restant,
                                   'devise', p.devise, 'prestataire', new.prestataire,
                                   'reference', new.reference));
      end if;
    end if;
  exception when others then
    -- Le paiement n'est jamais rejeté : le refus s'écrit, la tour rembourse.
    insert into facturation.montees_ouvertes (montee_id, refus) values (d.id, sqlerrm);
  end;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION app.licence_active(p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    -- Seuls ceux qui voient le dossier apprennent s'il est suspendu : un
    -- membre de la société, un membre d'un cabinet qui la tient sous mandat
    -- actif, un opérateur de la plateforme. Les autres sont refusés, quel que
    -- soit l'état — la réponse ne dit donc rien d'un dossier étranger (R6).
    -- Sans personne derrière l'appel (une tâche du serveur, une migration),
    -- il n'y a rien à cacher à qui que ce soit.
    when not (auth.uid() is null and app.api_tenant() is null
              or app.is_platform()
              or p_tenant in (select app.member_orgs())
              or exists (select 1 from identity.engagements e
                          where e.pme_org_id = p_tenant and e.status = 'actif'
                            and e.cabinet_org_id in (select app.member_orgs())))
      then app.refuser_lecture_de_licence()
    else coalesce(
      (select c.statut from facturation.licence_organisations lo
         join facturation.consommation_v c on c.licence_id = lo.licence_id
        where lo.tenant_id = p_tenant),
      'active') = 'active'
      -- Un essai terminé sans paiement ferme le dossier (25 novembre 2026) : seul le
      -- paiement le rouvre.
      and not exists (select 1 from facturation.licence_organisations lo
                        join facturation.essais e on e.licence_id = lo.licence_id
                       where lo.tenant_id = p_tenant and e.converti_le is null
                         and e.fin <= current_date)
      -- Ce qui est dû et pas payé dans le délai réglé en tour ferme le dossier (D12) ; le
      -- paiement le rouvre.
      and not exists (select 1 from facturation.licence_organisations lo
                        cross join lateral facturation.demande_due_ouverte(lo.licence_id) d
                       where lo.tenant_id = p_tenant
                         and d.ferme_le <= current_date)
  end;
$function$;

-- ---------------------------------------------------------------- ce que l'écran lit
-- Ce qui est dû par la société et pas encore payé : l'écran le dit, et le dossier fermé ne
-- montre plus que la page de paiement.
create function public.mon_echeance(p_tenant uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
           'etat', case when d.ferme_le <= current_date then 'ferme' else 'a_payer' end,
           'due_depuis', d.due_depuis,
           'dernier_jour', d.ferme_le - 1,
           'jours_restants', greatest(d.ferme_le - current_date, 0),
           'paiement_id', d.paiement_id,
           'montant_ttc', d.montant_ttc,
           'devise', d.devise,
           'titulaire', l.titulaire = auth.uid())
    from facturation.licence_organisations lo
    join facturation.licences l on l.id = lo.licence_id
    cross join lateral facturation.demande_due_ouverte(lo.licence_id) d
   where lo.tenant_id = p_tenant
     and (p_tenant in (select app.member_orgs()) or app.is_platform())
$function$;
revoke all on function public.mon_echeance(uuid) from public, anon;
grant execute on function public.mon_echeance(uuid) to authenticated;

-- ---------------------------------------------------------------- les avis
insert into ref.socle_params (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, 'abonnement.preavis_fermeture_jours', 3, 'Politique d''abonnement ALGORIA',
       date '2026-11-25'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and p.effective_from <= date '2026-11-25'
   and (p.effective_to is null or p.effective_to >= date '2026-11-25')
on conflict do nothing;

-- Les avis de l'abonnement, une fois chacun : la fin d'essai (proche, puis fin) et, pour ce
-- qui est dû, la fermeture (proche, puis fermé). Remplace `notif.prevenir_les_essais`.
drop function notif.prevenir_les_essais();
create function notif.prevenir_les_abonnements()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r         record;
  v_essai   integer;
  v_ferme   integer;
  v_code    text;
  v_cle     text;
  v_n       integer := 0;
begin
  select sp.value_num::integer into v_essai from ref.socle_params sp
   where sp.code = 'essai.preavis_jours'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;
  select sp.value_num::integer into v_ferme from ref.socle_params sp
   where sp.code = 'abonnement.preavis_fermeture_jours'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  for r in
    select 'essai' as genre, e.licence_id, e.fin as ferme_le, null::uuid as paiement_id,
           null::numeric as montant_ttc, null::text as devise, l.titulaire,
           facturation.societe_facturee(e.licence_id) as tenant, v_essai as preavis
      from facturation.essais e
      join facturation.licences l on l.id = e.licence_id
     where e.converti_le is null
    union all
    select 'du', l.id, d.ferme_le, d.paiement_id, d.montant_ttc, d.devise, l.titulaire,
           facturation.societe_facturee(l.id), v_ferme
      from facturation.licences l
      cross join lateral facturation.demande_due_ouverte(l.id) d
     where l.statut <> 'resiliee'
  loop
    continue when current_date < r.ferme_le
              and (r.preavis is null or current_date < r.ferme_le - r.preavis);
    v_code := case
                when r.genre = 'essai' and current_date >= r.ferme_le then 'essai.termine'
                when r.genre = 'essai' then 'essai.fin_proche'
                when current_date >= r.ferme_le then 'abonnement.ferme'
                else 'abonnement.fermeture_proche' end;
    v_cle := case when r.genre = 'essai' then 'essai:' || r.licence_id::text
                  else 'du:' || r.paiement_id::text end || ':' || v_code;
    -- Une fois par avis : l'avis déjà posé ne se repose pas.
    continue when exists (select 1 from notif.envois x where x.sujet_cle = v_cle and x.code = v_code);
    perform notif.emettre(r.tenant, v_code,
      jsonb_build_object('fin', to_char(r.ferme_le - 1, 'DD/MM/YYYY'),
                         'echeance_longue', to_char(r.ferme_le - 1, 'DD/MM/YYYY'),
                         'paiement_id', r.paiement_id,
                         'ttc', to_char(r.montant_ttc, 'FM999999990.000'),
                         'devise', r.devise),
      r.titulaire, v_cle, interval '400 days');
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$function$;
revoke all on function notif.prevenir_les_abonnements() from public, anon, authenticated;
grant execute on function notif.prevenir_les_abonnements() to malica_api;

insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, effective_from, ton)
values
  ('abonnement.a_payer', 'app', 'fr', null, 'Votre abonnement est à renouveler',
   '{{ttc}} {{devise}} TTC à régler avant le {{echeance_longue}}. La facture naît au paiement.',
   'Payer', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('abonnement.a_payer', 'app', 'en', null, 'Your subscription is due for renewal',
   '{{ttc}} {{devise}} incl. VAT to pay by {{echeance_longue}}. The invoice is issued on payment.',
   'Pay', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('abonnement.a_payer', 'app', 'ar', null, 'حان موعد تجديد اشتراككم',
   '{{ttc}} {{devise}} شامل الأداء تُدفع قبل {{echeance_longue}}. تصدر الفاتورة عند الدفع.',
   'الدفع', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('abonnement.a_payer', 'email', 'fr', 'Malica Office — votre abonnement est à renouveler',
   'Votre abonnement {{offre}} est à renouveler',
   'Réglez {{ttc}} {{devise}} TTC avant le {{echeance_longue}} pour continuer sans interruption. Un clic ouvre le paiement en ligne ; votre facture naît au paiement, déjà réglée.',
   'Payer en ligne', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('abonnement.a_payer', 'email', 'en', 'Malica Office — your subscription is due for renewal',
   'Your {{offre}} subscription is due for renewal',
   'Pay {{ttc}} {{devise}} incl. VAT by {{echeance_longue}} to keep going without interruption. One click opens online payment; your invoice is issued on payment, already settled.',
   'Pay online', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('abonnement.a_payer', 'email', 'ar', 'Malica Office — حان موعد تجديد اشتراككم',
   'حان موعد تجديد اشتراككم {{offre}}',
   'ادفعوا {{ttc}} {{devise}} شامل الأداء قبل {{echeance_longue}} لتواصلوا دون انقطاع. نقرة واحدة تفتح الدفع عبر الإنترنت؛ تصدر فاتورتكم عند الدفع، خالصة.',
   'الدفع عبر الإنترنت', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('abonnement.fermeture_proche', 'app', 'fr', null, 'Votre dossier ferme bientôt',
   'Sans paiement, votre dossier ferme après le {{echeance_longue}}. Un clic pour régler {{ttc}} {{devise}} TTC.',
   'Payer', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('abonnement.fermeture_proche', 'app', 'en', null, 'Your file closes soon',
   'Without payment, your file closes after {{echeance_longue}}. One click to pay {{ttc}} {{devise}} incl. VAT.',
   'Pay', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('abonnement.fermeture_proche', 'app', 'ar', null, 'يُغلق ملفكم قريبًا',
   'دون دفع، يُغلق ملفكم بعد {{echeance_longue}}. نقرة واحدة لدفع {{ttc}} {{devise}} شامل الأداء.',
   'الدفع', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('abonnement.fermeture_proche', 'email', 'fr', 'Malica Office — votre dossier ferme bientôt',
   'Votre dossier ferme bientôt',
   'Votre renouvellement n''est pas encore réglé : sans paiement, votre dossier ferme après le {{echeance_longue}}. Vos données restent conservées. Un clic ouvre le paiement en ligne de {{ttc}} {{devise}} TTC.',
   'Payer en ligne', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('abonnement.fermeture_proche', 'email', 'en', 'Malica Office — your file closes soon',
   'Your file closes soon',
   'Your renewal is not paid yet: without payment, your file closes after {{echeance_longue}}. Your data is kept. One click opens online payment of {{ttc}} {{devise}} incl. VAT.',
   'Pay online', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('abonnement.fermeture_proche', 'email', 'ar', 'Malica Office — يُغلق ملفكم قريبًا',
   'يُغلق ملفكم قريبًا',
   'لم يُدفع تجديدكم بعد: دون دفع، يُغلق ملفكم بعد {{echeance_longue}}. بياناتكم محفوظة. نقرة واحدة تفتح الدفع عبر الإنترنت لمبلغ {{ttc}} {{devise}} شامل الأداء.',
   'الدفع عبر الإنترنت', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('abonnement.ferme', 'app', 'fr', null, 'Votre dossier est fermé',
   'Votre renouvellement n''a pas été réglé. Vos données sont conservées : un paiement rouvre votre dossier.',
   'Payer', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('abonnement.ferme', 'app', 'en', null, 'Your file is closed',
   'Your renewal was not paid. Your data is kept: a payment reopens your file.',
   'Pay', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('abonnement.ferme', 'app', 'ar', null, 'أُغلق ملفكم',
   'لم يُدفع تجديدكم. بياناتكم محفوظة: الدفع يعيد فتح ملفكم.',
   'الدفع', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('abonnement.ferme', 'email', 'fr', 'Malica Office — votre dossier est fermé',
   'Votre dossier est fermé',
   'Votre renouvellement n''a pas été réglé à temps : votre dossier est fermé. Vos données et vos pièces sont conservées, et aucune facture ni dette n''a été créée. Un paiement de {{ttc}} {{devise}} TTC rouvre votre dossier.',
   'Payer et rouvrir', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('abonnement.ferme', 'email', 'en', 'Malica Office — your file is closed',
   'Your file is closed',
   'Your renewal was not paid in time: your file is closed. Your data and documents are kept, and no invoice or debt was created. A payment of {{ttc}} {{devise}} incl. VAT reopens your file.',
   'Pay and reopen', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('abonnement.ferme', 'email', 'ar', 'Malica Office — أُغلق ملفكم',
   'أُغلق ملفكم',
   'لم يُدفع تجديدكم في الوقت: أُغلق ملفكم. بياناتكم ووثائقكم محفوظة، ولم تُنشأ أي فاتورة أو دين. دفع {{ttc}} {{devise}} شامل الأداء يعيد فتح ملفكم.',
   'الدفع وإعادة الفتح', '/pme/payer/{{paiement_id}}', date '2026-11-25', 'erreur');

insert into notif.diffusions (code, canal, gabarit, valid_from) values
  ('abonnement.a_payer', 'email', 'abonnement.a_payer', date '2026-11-25'),
  ('abonnement.fermeture_proche', 'email', 'abonnement.fermeture_proche', date '2026-11-25'),
  ('abonnement.ferme', 'email', 'abonnement.ferme', date '2026-11-25');

insert into notif.cartes_courriel (code, rang, genre, libelle_cle, valeur_cle) values
  ('abonnement.a_payer', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('abonnement.a_payer', 2, 'ligne', 'donnee.echeance', 'valeur.echeanceLongue'),
  ('abonnement.fermeture_proche', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('abonnement.fermeture_proche', 2, 'ligne', 'donnee.echeance', 'valeur.echeanceLongue'),
  ('abonnement.ferme', 1, 'montant', 'unite.factureTtc', 'valeur.ttc');

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('apercu.abonnement.a_payer', 'fr', 'Un clic pour renouveler : {{ttc}} {{devise}} TTC.', date '2026-11-25'),
  ('apercu.abonnement.a_payer', 'en', 'One click to renew: {{ttc}} {{devise}} incl. VAT.', date '2026-11-25'),
  ('apercu.abonnement.a_payer', 'ar', 'نقرة واحدة للتجديد: {{ttc}} {{devise}} شامل الأداء.', date '2026-11-25'),
  ('apercu.abonnement.fermeture_proche', 'fr', 'Sans paiement, votre dossier ferme après le {{echeance_longue}}.', date '2026-11-25'),
  ('apercu.abonnement.fermeture_proche', 'en', 'Without payment, your file closes after {{echeance_longue}}.', date '2026-11-25'),
  ('apercu.abonnement.fermeture_proche', 'ar', 'دون دفع، يُغلق ملفكم بعد {{echeance_longue}}.', date '2026-11-25'),
  ('apercu.abonnement.ferme', 'fr', 'Vos données sont conservées : un paiement rouvre votre dossier.', date '2026-11-25'),
  ('apercu.abonnement.ferme', 'en', 'Your data is kept: a payment reopens your file.', date '2026-11-25'),
  ('apercu.abonnement.ferme', 'ar', 'بياناتكم محفوظة: الدفع يعيد فتح ملفكم.', date '2026-11-25')
on conflict do nothing;

-- ================================================================ R-04 : la recharge payée
-- Une recharge payée en ligne a sa facture au paiement, réglée, quel que soit le payeur de
-- l'abonnement : la PME paie sa consommation, même quand un cabinet paie sa licence (D1 bis).
-- Avant : l'argent attendait la prochaine facture de base du titulaire, qui n'existe pas
-- quand un cabinet paie tout — de l'argent encaissé sans facture (revue du 25 novembre, R-04).
-- La facture vaut le paiement, au millime : ses montants SONT ceux du paiement.
alter table facturation.factures drop constraint factures_nature;
alter table facturation.factures add constraint factures_nature
  check (nature = any (array['base', 'complement', 'recharge']));
alter table facturation.factures drop constraint factures_anniversaire_coherent;
alter table facturation.factures add constraint factures_anniversaire_coherent
  check ((ancre is null) = (part_mensuelle_ht is null)
         and (nature in ('base', 'recharge') or ancre is not null)
         and (nature <> 'recharge' or ancre is null)
         and (ancre is null
              or (licence_id is not null and payeur_type = 'titulaire' and ancre <= couvre_du
                  and periode = (date_trunc('month', couvre_du::timestamptz))::date)));

-- Le paiement d'une recharge porte le timbre, comme toute facture : elle naîtra à ce montant.
CREATE OR REPLACE FUNCTION public.paiement_recharge_preparer(p_recharge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r     record;
  v_ttc jsonb;
  v_id  uuid;
begin
  select x.* into r from facturation.recharges x where x.id = p_recharge;
  if r.id is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = r.licence_id
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(r.licence_id) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  if r.prix_ht <= 0 then
    return null;   -- offerte par la plateforme : rien à payer.
  end if;
  if not exists (select 1 from facturation.emetteurs e where e.valide_des <= r.achetee_le) then
    return null;   -- pas encore d'émetteur : la facture du mois portera la recharge.
  end if;

  select p.id into v_id from facturation.paiements_en_ligne p where p.recharge_id = r.id;
  if v_id is null then
    v_ttc := public.prix_ttc(r.prix_ht, r.achetee_le);
    insert into facturation.paiements_en_ligne
      (licence_id, objet, recharge_id, libelle, montant_ht, taux_tva, montant_tva, timbre,
       montant_ttc, devise, cree_par)
    values
      (r.licence_id, 'recharge', r.id,
       facturation.libelle_de_recharge(r.lectures, r.origine, r.achetee_le),
       r.prix_ht, (v_ttc ->> 'taux')::numeric, (v_ttc ->> 'tva')::numeric,
       (v_ttc ->> 'timbre')::numeric, (v_ttc ->> 'ttc')::numeric, v_ttc ->> 'devise', auth.uid())
    returning id into v_id;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
end
$function$;

-- La facture d'une recharge payée : née réglée, le jour de l'encaissement. Rien si la
-- recharge est déjà portée par une facture (une base émise avant ce paiement) : l'argent
-- reste alors un acompte, imputé à la facture suivante comme avant.
create function facturation.facture_de_recharge(p_paiement uuid, p_jour date, p_reference text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  p      facturation.paiements_en_ligne;
  r      facturation.recharges;
  c      record;
  v_id   uuid;
  v_enc  uuid;
begin
  select x.* into p from facturation.paiements_en_ligne x
   where x.id = p_paiement and x.objet = 'recharge';
  select x.* into r from facturation.recharges x where x.id = p.recharge_id;
  if r.id is null
     or exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = r.id) then
    return null;
  end if;
  select * into c from facturation.consommation_v where licence_id = p.licence_id;

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations,
     sieges_payants, montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     nature, couvre_du, couvre_au, inclut_la_base)
  values
    (p.licence_id, facturation.numero_de_facture(p_jour), date_trunc('month', p_jour)::date,
     p_jour, p_jour,
     (select h.offre_code from facturation.forfait_courant_v h where h.licence_id = p.licence_id),
     coalesce(c.organisations, 0), greatest(0, coalesce(c.sieges_occupes - c.sieges_inclus, 0)),
     p.montant_ht, p.taux_tva, p.montant_tva, p.timbre, p.montant_ttc, p.devise,
     'recharge', p_jour, p_jour + 1, false)
  returning id into v_id;

  insert into facturation.facture_lignes
    (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
  values (v_id, 1, facturation.libelle_de_recharge(r.lectures, r.origine, r.achetee_le),
          1, p.montant_ht, p.montant_ht);
  insert into facturation.facture_recharges (facture_id, recharge_id) values (v_id, r.id);

  insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
  values (v_id, p.montant_ttc, facturation.moyen_encaissement_du_paiement(p.id), p_reference,
          p_jour)
  returning id into v_enc;
  insert into facturation.paiement_imputations (paiement_id, encaissement_id)
  values (p.id, v_enc);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, r.achetee_par, 'facture.emise', 'facturation', 'factures', v_id,
         jsonb_build_object('nature', 'recharge', 'ttc', p.montant_ttc, 'par', 'paiement')
    from (select facturation.societe_facturee(p.licence_id) as tenant_id) lo;
  perform facturation.avertir_de_la_facture(v_id);

  -- Une demande due déjà ouverte comptait peut-être cette recharge : elle se rechiffre, pour
  -- ne pas la faire payer deux fois.
  if (facturation.demande_due_ouverte(p.licence_id)).demande_id is not null then
    perform facturation.du_a_payer(p.licence_id, p_jour, r.achetee_par);
  end if;
  return v_id;
end
$function$;
revoke all on function facturation.facture_de_recharge(uuid, date, text) from public, anon, authenticated;

create function facturation.une_recharge_payee_se_facture()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.etat = 'paye'
     and exists (select 1 from facturation.paiements_en_ligne x
                  where x.id = new.paiement_id and x.objet = 'recharge')
     and exists (select 1 from facturation.prestataires_paiement pp
                  where pp.code = new.prestataire and pp.fait_entrer_argent) then
    perform facturation.facture_de_recharge(
      new.paiement_id,
      greatest((now() at time zone plateforme.fuseau_de_la_plateforme())::date, new.le::date),
      new.prestataire || ' ' || coalesce(new.reference, new.paiement_id::text));
  end if;
  return new;
end
$function$;
revoke all on function facturation.une_recharge_payee_se_facture() from public, anon, authenticated;
create trigger une_recharge_payee_se_facture after insert on facturation.paiement_evenements
  for each row execute function facturation.une_recharge_payee_se_facture();

-- Une recharge achetée (ou automatique) pendant qu'une échéance est due change ce qui est dû :
-- la demande se rechiffre, pour que la facture née au paiement vaille ce paiement.
create function facturation.une_recharge_rechiffre_le_du()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if (facturation.demande_due_ouverte(new.licence_id)).demande_id is not null then
    perform facturation.du_a_payer(
      new.licence_id, (now() at time zone plateforme.fuseau_de_la_plateforme())::date,
      new.achetee_par);
  end if;
  return new;
end
$function$;
revoke all on function facturation.une_recharge_rechiffre_le_du() from public, anon, authenticated;
create trigger une_recharge_rechiffre_le_du after insert on facturation.recharges
  for each row execute function facturation.une_recharge_rechiffre_le_du();

-- ================================================================ 1.6 : l'année
-- L'année se paie à son début, avec le renouvellement : la demande due de ce jour-là porte
-- sa ligne, et la facture naît de ce paiement, au même montant (D7). Plus d'acompte payé à
-- la souscription, qui faisait une facture différente du paiement et laissait un reste dû.
CREATE OR REPLACE FUNCTION public.annuel_souscrire(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_etat     jsonb := public.mon_annuel(p_tenant);
  v_licence  uuid;
  v_prop     jsonb;
  v_id       uuid;
begin
  -- T8 : la licence du titulaire, sans hasard ; titulaire de plusieurs, il dit laquelle (21000).
  v_licence := facturation.ma_licence(p_tenant);
  if v_licence is null
     or not facturation.titulaire_de(v_licence)
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant'])) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  if v_etat -> 'en_cours' <> 'null'::jsonb then
    raise exception '%', app.refus_avec_valeurs('refus.annuel.ferme', 'motif', 'deja_engage') using errcode = 'check_violation';
  end if;
  if v_etat ->> 'ferme' is not null then
    raise exception '%', app.refus_avec_valeurs('refus.annuel.ferme', 'motif', (v_etat ->> 'ferme')::text) using errcode = 'check_violation';
  end if;

  v_prop := v_etat -> 'proposition';
  insert into facturation.engagements_annuels
    (licence_id, offre_code, du, au, prix_mensuel_ht, mois_offerts, montant_ht, souscrit_par)
  values
    (v_licence, v_prop ->> 'offre', (v_prop ->> 'du')::date, (v_prop ->> 'au')::date,
     (v_prop ->> 'prix_mensuel_ht')::numeric, (v_prop ->> 'mois_offerts')::smallint,
     (v_prop ->> 'montant_ht')::numeric, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, auth.uid(), 'abonnement.annuel', 'facturation', 'engagements_annuels', v_id, v_prop
    from (select facturation.societe_facturee(v_licence) as tenant_id) lo;

  return jsonb_build_object('engagement', v_id, 'du', v_prop ->> 'du');
end
$function$;

-- ================================================================ les acomptes d'avant
-- L'argent déjà encaissé et pas encore imputé (un acompte d'avant D7) compte dans ce qui est
-- dû : on ne fait jamais payer deux fois. Il couvre tout : la facture naît tout de suite,
-- réglée par lui. Il en couvre une part : le cas se rapproche à la main (la tour le voit dans
-- les erreurs du passage), plutôt qu'une demande au mauvais montant.
create function facturation.acomptes_disponibles(p_licence uuid)
 returns numeric
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select coalesce(sum(p.montant_ttc - coalesce(deja.montant, 0)), 0)
    from facturation.paiements_en_ligne p
    left join lateral (select sum(en.montant) as montant
                         from facturation.paiement_imputations i
                         join facturation.encaissements en on en.id = i.encaissement_id
                        where i.paiement_id = p.id) deja on true
   where p.licence_id = p_licence
     and p.objet <> 'facture'
     and p.montant_ttc > coalesce(deja.montant, 0)
     and exists (select 1 from facturation.paiement_evenements e
                   join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                            and pp.fait_entrer_argent
                  where e.paiement_id = p.id and e.etat = 'paye')
$$;
revoke all on function facturation.acomptes_disponibles(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- l'avis de la facture
CREATE OR REPLACE FUNCTION facturation.avertir_de_la_facture(p_facture uuid, p_fenetre interval DEFAULT '24:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  f          facturation.factures;
  v_tenant   uuid;
  v_exposant smallint;
  v_ttc      text;
  v_reglee   boolean;
  v_expert   uuid;
  v_n        integer := 0;
begin
  select x.* into f from facturation.factures x where x.id = p_facture;
  if f.id is null or f.payeur_type not in ('titulaire', 'cabinet') then
    return 0;
  end if;
  select d.exposant into v_exposant from ref.devises d where d.code = f.devise;
  v_ttc := to_char(f.montant_ttc, 'FM999G999G990'
                     || case when coalesce(v_exposant, 0) > 0
                             then 'D' || repeat('0', v_exposant) else '' end);

  -- La facture du mois d'une comptabilité : à chacun de ses experts, en application et par
  -- courriel. Une ligne par société et par offre ; on dit combien d'abonnements elle porte.
  if f.payeur_type = 'cabinet' then
    for v_expert in
      select m.user_id from identity.memberships m
       where m.tenant_id = f.payeur_tenant_id and m.role = 'expert'
       order by m.created_at
    loop
      v_n := v_n + notif.emettre(
        f.payeur_tenant_id,
        'facture.emise.cabinet',
        jsonb_build_object(
          'facture_id',  f.id,
          'numero',      f.numero,
          'periode',     to_char(f.periode, 'MM/YYYY'),
          'abonnements', f.organisations::text,
          'ttc',         v_ttc,
          'devise',      f.devise,
          'echeance',    to_char(f.echeance_le, 'DD/MM/YYYY')),
        v_expert,
        'facture:' || f.id::text,
        p_fenetre);
    end loop;
    return v_n;
  end if;

  select lo.tenant_id into v_tenant
    from (select facturation.societe_facturee(f.licence_id) as tenant_id) lo;

  -- Réglée : payée d'abord (une montée, 20261231240000 : la facture naît réglée par le paiement
  -- qui l'a fait émettre), ou déjà entièrement encaissée (un renvoi). Elle le dit, au lieu de
  -- « à régler avant ».
  v_reglee := (coalesce(current_setting('malica.paye_d_abord_le', true), '') = f.emise_le::text
               and f.couvre_du <= f.emise_le and f.couvre_au > f.emise_le)
              or exists (select 1 from facturation.encours_v e
                          where e.facture_id = f.id and e.etat = 'payee');

  -- La facture d'une recharge (R-04) naît toujours réglée, de son paiement : son avis dit la
  -- recharge, pas un abonnement.
  if f.nature = 'recharge' then
    return notif.emettre(
      v_tenant,
      'facture.recharge.pme',
      jsonb_build_object(
        'facture_id', f.id,
        'numero',     f.numero,
        'lectures',   (select r.lectures::text from facturation.facture_recharges fr
                         join facturation.recharges r on r.id = fr.recharge_id
                        where fr.facture_id = f.id limit 1),
        'ttc',        v_ttc,
        'devise',     f.devise),
      f.payeur_personne,
      'facture:' || f.id::text,
      p_fenetre);
  end if;

  -- Les jetons de ses gabarits (app et courriel, fr/en/ar) : tous, et rien d'autre.
  return notif.emettre(
    v_tenant,
    case when v_reglee then 'facture.reglee.pme' else 'facture.emise.pme' end,
    jsonb_build_object(
      'facture_id', f.id,
      'numero',     f.numero,
      'offre',      coalesce((ref.offre_a(f.offre_code, f.couvre_du)).libelle, f.offre_code),
      'periode',    to_char(f.periode, 'MM/YYYY'),
      'du',         to_char(f.couvre_du, 'DD/MM/YYYY'),
      'au',         to_char(f.couvre_au - 1, 'DD/MM/YYYY'),
      'ttc',        v_ttc,
      'devise',     f.devise,
      'echeance',   to_char(f.echeance_le, 'DD/MM/YYYY')),
    f.payeur_personne,
    'facture:' || f.id::text,
    p_fenetre);
end
$function$;

-- Le renvoi d'une facture par la tour : les avis de facture de la PME, quel que soit leur état
-- (à régler, réglée, recharge) ; la clé du sujet dit laquelle.
CREATE OR REPLACE FUNCTION plateforme.facture_renvoyer(p_facture uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- La fenêtre du doublon : celle du moteur (`notif.poster`), dite une fois ici.
  v_fenetre interval := interval '24 hours';
  f         record;
  v_cle     text := 'facture:' || p_facture::text;
  v_avant   uuid[];
  v_envoi   record;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  p_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if p_motif is null then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  select x.id, x.numero, x.payeur_type, x.payeur_personne, x.licence_id into f
    from facturation.factures x where x.id = p_facture;
  if f.id is null then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;
  if f.payeur_type <> 'titulaire' then
    raise exception 'refus.facturation.renvoi_pme_seulement' using errcode = 'check_violation';
  end if;

  -- Déjà décidé dans la fenêtre (parti, ou en attente du travailleur) : rien de plus.
  if exists (select 1 from notif.envois_v e
              where e.destinataire = f.payeur_personne and e.code like 'facture.%.pme'
                and e.canal = 'email' and e.sujet_cle = v_cle
                and e.decision = 'a_remettre' and e.etat <> 'refuse'
                and e.cree_le > now() - v_fenetre) then
    return jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'deja', true);
  end if;

  -- Les envois d'avant : celui que ce renvoi pose est le seul qui n'y est pas (dans une même
  -- transaction, `cree_le` ne les départage pas).
  select coalesce(array_agg(e.id), '{}') into v_avant
    from notif.envois e
   where e.destinataire = f.payeur_personne and e.code like 'facture.%.pme'
     and e.canal = 'email' and e.sujet_cle = v_cle;

  perform facturation.avertir_de_la_facture(f.id, v_fenetre);

  select e.decision, e.motif_abandon into v_envoi
    from notif.envois e
   where e.destinataire = f.payeur_personne and e.code like 'facture.%.pme'
     and e.canal = 'email' and e.sujet_cle = v_cle
     and e.id <> all (v_avant)
   limit 1;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  select lo.tenant_id, auth.uid(), 'facture.renvoyee', 'facturation', 'factures', f.id,
         jsonb_build_object('numero', f.numero, 'motif', p_motif,
                            'decision', v_envoi.decision, 'abandon', v_envoi.motif_abandon)
    from (select facturation.societe_facturee(f.licence_id) as tenant_id) lo;

  return jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'deja', false,
                            'poste', coalesce(v_envoi.decision = 'a_remettre', false),
                            'abandon', v_envoi.motif_abandon);
end
$function$;

-- ---------------------------------------------------------------- l'avis de la recharge
insert into notif.gabarits (code, canal, locale, sujet, titre, corps, action_libelle, action_route,
                            effective_from, ton) values
  ('facture.recharge.pme', 'app', 'fr', null,
   'Recharge réglée : facture {{numero}}',
   '{{lectures}} lectures, {{ttc}} {{devise}} TTC, réglées en ligne.',
   null, null, date '2026-11-25', 'succes'),
  ('facture.recharge.pme', 'app', 'en', null,
   'Top-up paid: invoice {{numero}}',
   '{{lectures}} readings, {{ttc}} {{devise}} incl. VAT, paid online.',
   null, null, date '2026-11-25', 'succes'),
  ('facture.recharge.pme', 'app', 'ar', null,
   'شحن مدفوع: الفاتورة {{numero}}',
   '{{lectures}} من القراءات، {{ttc}} {{devise}} شامل الأداء، دُفعت عبر الإنترنت.',
   null, null, date '2026-11-25', 'succes'),
  ('facture.recharge.pme', 'email', 'fr', 'Malica Office — facture {{numero}} réglée',
   'Votre recharge est réglée',
   'Votre recharge de {{lectures}} lectures : {{ttc}} {{devise}} TTC, réglés en ligne. Les '
   'lectures sont à vous. Rien ne reste à payer. La facture {{numero}} se télécharge en PDF dans '
   'vos réglages, rubrique Abonnement.',
   'Télécharger la facture', '/pme/reglages?page=abonnement', date '2026-11-25', 'succes'),
  ('facture.recharge.pme', 'email', 'en', 'Malica Office — invoice {{numero}} paid',
   'Your top-up is paid',
   'Your top-up of {{lectures}} readings: {{ttc}} {{devise}} incl. VAT, paid online. The '
   'readings are yours. Nothing is left to pay. Invoice {{numero}} can be downloaded as a PDF '
   'from your settings, under Subscription.',
   'Download the invoice', '/pme/reglages?page=abonnement', date '2026-11-25', 'succes'),
  ('facture.recharge.pme', 'email', 'ar', 'Malica Office — الفاتورة {{numero}} مدفوعة',
   'شحنكم مدفوع',
   'شحنكم: {{lectures}} من القراءات، {{ttc}} {{devise}} شامل الأداء، دُفعت عبر الإنترنت. القراءات '
   'لكم. لم يبقَ شيء للدفع. تُنزَّل الفاتورة {{numero}} بصيغة PDF من إعداداتكم، قسم الاشتراك.',
   'تنزيل الفاتورة', '/pme/reglages?page=abonnement', date '2026-11-25', 'succes');

insert into notif.diffusions (code, canal, gabarit, valid_from) values
  ('facture.recharge.pme', 'email', 'facture.recharge.pme', date '2026-11-25');

insert into notif.cartes_courriel (code, rang, genre, libelle_cle, valeur_cle) values
  ('facture.recharge.pme', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('facture.recharge.pme', 2, 'ligne',   'donnee.facture',   'valeur.numero'),
  ('facture.recharge.pme', 3, 'ligne',   'donnee.etat',      'valeur.reglee');

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('apercu.facture.recharge.pme', 'fr', '{{lectures}} lectures, {{ttc}} {{devise}} TTC, réglées.',
   date '2026-11-25'),
  ('apercu.facture.recharge.pme', 'en', '{{lectures}} readings, {{ttc}} {{devise}} incl. VAT, paid.',
   date '2026-11-25'),
  ('apercu.facture.recharge.pme', 'ar', '{{lectures}} من القراءات، {{ttc}} {{devise}} شامل الأداء، مدفوعة.',
   date '2026-11-25');


-- ================================================================ les paiements qui doublent
-- Une recharge déjà portée par une facture de base ne se paie plus à part : son paiement est
-- remplacé (l'API refuse d'en ouvrir le lien), au lieu d'un argent encaissé deux fois.
create or replace view facturation.paiements_en_ligne_v with (security_invoker = true) as
 SELECT p.id AS paiement_id,
    p.licence_id,
    p.objet,
    p.libelle,
    p.montant_ht,
    p.montant_tva,
    p.montant_ttc,
    p.devise,
    p.cree_le,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM facturation.paiement_evenements e
              WHERE ((e.paiement_id = p.id) AND (e.etat = 'paye'::text)))) THEN 'paye'::text
            WHEN ((p.objet = 'montee'::text) AND (NOT (EXISTS ( SELECT 1
               FROM facturation.forfait_historique c
              WHERE ((c.licence_id = p.licence_id) AND (c.effet_au IS NULL) AND ((c.id = p.forfait_id) OR ((c.garde_forfait_id = p.forfait_id) AND (c.garde_jusqu_au > CURRENT_DATE)))))))) THEN 'remplace'::text
            WHEN ((p.objet = 'montee_demandee'::text) AND (EXISTS ( SELECT 1
               FROM (facturation.montees_demandees d_1
                 JOIN facturation.montees_demandees s ON (((s.licence_id = d_1.licence_id) AND (s.cree_le > d_1.cree_le))))
              WHERE (d_1.id = p.montee_demandee_id)))) THEN 'remplace'::text
            WHEN ((p.objet = 'recharge'::text) AND (EXISTS ( SELECT 1
               FROM facturation.facture_recharges fr
              WHERE (fr.recharge_id = p.recharge_id)))) THEN 'remplace'::text
            WHEN ((d.etat = 'lien_cree'::text) AND (d.le < (now() - make_interval(mins => ((abonnement_reglage() ->> 'lien_valide_minutes'::text))::integer)))) THEN 'non_abouti'::text
            ELSE COALESCE(d.etat, 'a_payer'::text)
        END AS etat,
    d.prestataire,
    d.reference,
    d.lien,
    (EXISTS ( SELECT 1
           FROM facturation.paiement_imputations i
          WHERE (i.paiement_id = p.id))) AS impute,
    p.payeur_tenant_id
   FROM (facturation.paiements_en_ligne p
     LEFT JOIN LATERAL ( SELECT e.etat,
            e.prestataire,
            e.reference,
            e.lien,
            e.le
           FROM facturation.paiement_evenements e
          WHERE (e.paiement_id = p.id)
          ORDER BY e.le DESC, e.id DESC
         LIMIT 1) d ON (true));

-- 8.3 : un second lien payé pour un même paiement se trace en trop-perçu.
CREATE OR REPLACE FUNCTION public.paiement_inscrire(p_paiement uuid, p_etat text, p_prestataire text, p_reference text DEFAULT NULL::text, p_lien text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb, p_moyen text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid;
  v_payeur  uuid;
  v_presta  facturation.prestataires_paiement;
  v_attendu numeric;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  select * into v_presta from facturation.prestataires_paiement where code = p_prestataire;
  if not found or not v_presta.ouvre_le_paiement then
    raise exception 'refus.paiement.prestataire_inconnu' using errcode = 'check_violation';
  end if;
  -- Un prestataire qui ne fait entrer aucun argent n'est admis que si l'API l'a
  -- déclaré pour la transaction, ce qu'elle ne fait que si la tour l'a ouvert.
  if not v_presta.fait_entrer_argent
     and coalesce(current_setting('malica.paiement_simulateur', true), '') <> 'oui' then
    raise exception 'refus.paiement.simulateur_ferme' using errcode = '42501';
  end if;
  -- Le lien se crée pour un moyen choisi, actif, que ce prestataire accepte, et
  -- vers sa propre page.
  if p_etat = 'lien_cree' then
    -- Pas de page de paiement sans les CGV acceptées pour CE paiement (CGV, art. 2 :
    -- « le client les accepte en cochant la case prévue avant de payer »).
    if not exists (select 1 from facturation.acceptations_cgv a where a.paiement_id = p_paiement) then
      raise exception 'refus.cgv.non_acceptees' using errcode = 'check_violation';
    end if;
    if not facturation.moyen_admis(p_moyen, p_prestataire) then
      raise exception 'refus.paiement.moyen_indisponible' using errcode = 'check_violation';
    end if;
    if p_reference is null or p_lien is null then
      raise exception 'refus.saisie.mal_formee' using errcode = '22023';
    end if;
    if v_presta.fait_entrer_argent and not exists (
         select 1 from facturation.hotes_par_prestataire h
          where h.prestataire = p_prestataire and h.usage = 'page'
            and h.hote = facturation.hote_de(p_lien)) then
      raise exception 'refus.paiement.hote_non_autorise' using errcode = 'check_violation';
    end if;
  end if;
  -- « Payé » ou « refusé » se constate sur une référence que CE prestataire a
  -- rendue pour CE paiement — quel que soit le prestataire en vigueur aujourd'hui :
  -- un changement de réglage ne rend pas orphelin un lien déjà payé. Un simulateur
  -- ouvert après coup ne solde donc pas un lien parti chez un prestataire réel.
  if p_etat in ('paye', 'refuse') and not exists (
       select 1 from facturation.paiement_evenements e
        where e.paiement_id = p_paiement and e.etat = 'lien_cree'
          and e.prestataire = p_prestataire
          and e.reference is not distinct from p_reference) then
    raise exception 'refus.paiement.prestataire_du_lien' using errcode = 'check_violation';
  end if;
  if p_etat = 'paye' and exists (select 1 from facturation.paiement_evenements e
                                  where e.paiement_id = p_paiement and e.etat = 'paye') then
    -- Déjà constaté : on ne le compte pas deux fois, on le rend. Mais un SECOND lien payé
    -- (une autre référence, de l'argent réel) a débité le client deux fois : il se trace en
    -- trop-perçu à rembourser, jamais en silence (revue du 25 novembre 2026, 8.3).
    if v_presta.fait_entrer_argent
       and not exists (select 1 from facturation.paiement_evenements e
                        where e.paiement_id = p_paiement and e.etat = 'paye'
                          and e.reference is not distinct from p_reference)
       and not exists (select 1 from audit.event_log a
                        where a.action = 'paiement.trop_percu' and a.object_id = p_paiement
                          and a.payload ->> 'reference' is not distinct from p_reference) then
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      select coalesce(v_payeur, lo.tenant_id), auth.uid(), 'paiement.trop_percu', 'facturation',
             'paiements_en_ligne', p_paiement,
             jsonb_build_object('motif', 'double_paiement', 'prestataire', p_prestataire,
                                'reference', p_reference,
                                'unites_encaissees', p_detail ->> 'unites_encaissees')
        from (select 1) un
        left join lateral (
          select facturation.societe_facturee(v_licence) as tenant_id) lo on true
       where coalesce(v_payeur, lo.tenant_id) is not null;
    end if;
    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
  end if;
  -- Un argent réel se constate au montant du paiement, en unités de sa devise
  -- (le millime du dinar), tel que le prestataire dit l'avoir encaissé.
  if p_etat = 'paye' and v_presta.fait_entrer_argent then
    select p.montant_ttc * power(10::numeric, d.exposant) into v_attendu
      from facturation.paiements_en_ligne p
      join ref.devises d on d.code = p.devise
     where p.id = p_paiement;
    if coalesce(p_detail ->> 'unites_encaissees', '') !~ '^[0-9]+$'
       or (p_detail ->> 'unites_encaissees')::numeric <> v_attendu then
      raise exception 'refus.paiement.montant_different' using errcode = 'check_violation';
    end if;
  end if;

  insert into facturation.paiement_evenements
    (paiement_id, etat, prestataire, reference, lien, detail, moyen)
  values (p_paiement, p_etat, p_prestataire, p_reference, p_lien, coalesce(p_detail, '{}'::jsonb),
          case when p_etat = 'lien_cree' then p_moyen end);

  if p_etat = 'paye' then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select coalesce(v_payeur, lo.tenant_id), auth.uid(), 'paiement.recu', 'facturation',
           'paiements_en_ligne', p_paiement,
           jsonb_build_object('prestataire', p_prestataire, 'reference', p_reference)
      from (select 1) un
      left join lateral (
        select facturation.societe_facturee(v_licence) as tenant_id) lo on true
     where coalesce(v_payeur, lo.tenant_id) is not null;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
end
$function$;

commit;
