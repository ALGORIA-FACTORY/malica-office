-- ======================================================================
--  La facture part chaque jour (décision du dirigeant, 4 novembre 2026,
--  « option 1 »).
--
--  POURQUOI. `facturation.emettre` et `facturation.emettre_cabinet` existent
--  depuis octobre, mais rien ne les appelle : seules les épreuves émettaient.
--  Un client commence n'importe quel jour ; la facture reste MENSUELLE, par
--  payeur, au prorata des jours (`facturation.a_facturer`), et part dès que
--  son mois est clos. Le robot passe donc chaque jour, dans le processus de
--  l'API (`facturation/demarrer-la-facturation.ts`), et n'émet que ce qui
--  manque : une facture par payeur et par mois, jamais deux.
--
--  CE QUI CHANGE, ET CE QUI NE CHANGE PAS.
--    * La tour ouvre ou coupe l'émission automatique : daté, motivé, en ajout
--      seul (R7), comme la passe de nuit. Livrée COUPÉE.
--    * Le corps des quatre fonctions de facturation est DÉPLACÉ (R12 : aucun
--      corps recopié) dans des fonctions internes qu'aucun client n'exécute :
--      `lignes_a_facturer`, `lignes_a_facturer_cabinet`,
--      `emission_de_la_licence`, `emission_du_cabinet`. Les fonctions
--      publiques gardent leur signature, leurs droits et leur garde
--      (`app.is_platform()`, ou le titulaire et le cabinet pour la lecture) :
--      elles ne font plus que garder, puis appeler. Pour une personne, rien
--      ne change ; un refus reste le même refus.
--    * Le robot ne passe PAS par une identité de service. `app.is_platform()`
--      ouvre toute la tour : y faire entrer un compte de service lui
--      donnerait la grille, l'émetteur, les licences, et la RLS de toutes les
--      tables de plateforme. Il appelle une seule fonction,
--      `fabrique.facturation_du_jour`, exécutable par le rôle de connexion de
--      l'API seul (comme `fabrique.passe_de_nuit_*`), qui appelle les corps
--      internes. Son acteur, au journal, est l'opérateur dont la décision
--      d'ouvrir est en vigueur : c'est lui qui l'a autorisé, nommément.
--
--  IDEMPOTENCE. Un mois déjà facturé à ce payeur est sauté AVANT l'appel —
--  sans quoi le numéro de facture serait tiré puis perdu à chaque passage
--  (`nextval` ne se rend pas au rollback). L'index unique
--  `factures_une_par_payeur_et_periode` reste le dernier mot. Un passage par
--  jour et par décision de la tour : redire « ouverte » relance le jour.
--
--  RATTRAPAGE. Chaque passage examine les `rattrapage_mois` derniers mois
--  clos (au moins le précédent), bornés par la naissance de chaque payeur.
--  La valeur est un réglage de la tour, daté et motivé (R10), livrée à 1 :
--  facturer d'office des mois anciens est un arbitrage commercial, pas un
--  défaut technique (10-ce-qui-reste-ouvert.md).
--
--  LE JOUR. Celui de la plateforme : le fuseau de l'organisation émettrice,
--  sinon celui de sa juridiction ; aucun des deux lève une erreur, jamais
--  une heure UTC devinée (R4). La date d'émission des factures suit ce même
--  fuseau : à 00:30 à Tunis le 1er novembre, la facture d'octobre est datée
--  du 1er novembre, pas du 31 octobre UTC.
--
--  REJEU (R11) : la décision initiale est datée d'un littéral.
-- ======================================================================

-- ------------------------------------------------------- 1. L'interrupteur de la tour

create table plateforme.reglages_facturation_auto (
  id              uuid primary key default gen_random_uuid(),
  actif           boolean not null,
  rattrapage_mois integer not null check (rattrapage_mois >= 1),
  motif           text not null check (length(btrim(motif)) > 0),
  decide_par      uuid,
  decide_le       timestamptz not null default now(),
  -- Départage deux décisions de même instant (`now()` est figé par
  -- transaction) : la plus tardive vaut — forme de 20261023180000.
  rang            bigint generated always as identity,
  constraint reglages_facturation_auto_ouverte_par_quelqu_un check (not actif or decide_par is not null)
);

comment on table plateforme.reglages_facturation_auto is
  'L''émission automatique des factures mensuelles : ouverte ou coupée, et combien de mois clos '
  'chaque passage examine (au moins le précédent). La dernière décision de la tour vaut ; une '
  'décision ouverte nomme qui l''a prise, et c''est cette personne que le journal des factures '
  'émises nomme comme acteur.';

alter table plateforme.reglages_facturation_auto enable row level security;
alter table plateforme.reglages_facturation_auto force row level security;
revoke all on table plateforme.reglages_facturation_auto from public, anon;
grant select on table plateforme.reglages_facturation_auto to authenticated;
create policy reglages_facturation_auto_lire on plateforme.reglages_facturation_auto
  for select to authenticated using ((select app.is_platform()));
create trigger reglages_facturation_auto_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_facturation_auto
  for each row execute function app.deny_mutation();

insert into plateforme.reglages_facturation_auto (actif, rattrapage_mois, motif, decide_par, decide_le)
values (false, 1,
        'Émission automatique décidée par le dirigeant le 4 novembre 2026 (option 1 : chaque jour). '
        'Livrée coupée ; à ouvrir d''abord sur le staging. Rattrapage d''un mois : INCERTAIN, '
        'facturer d''office des mois plus anciens reste à trancher.',
        null, timestamptz '2026-11-04 00:00:00+00');

/* La décision en vigueur. Lue par les fonctions de l'émission seulement. */
create function plateforme.facturation_auto_en_vigueur()
returns plateforme.reglages_facturation_auto
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from plateforme.reglages_facturation_auto r
   order by r.decide_le desc, r.rang desc
   limit 1
$$;

revoke all on function plateforme.facturation_auto_en_vigueur() from public, anon, authenticated;

/* L'émission automatique est-elle ouverte, ici et maintenant ? */
create function plateforme.facturation_auto_ouverte()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((plateforme.facturation_auto_en_vigueur()).actif, false)
$$;

-- Le travailleur de l'API la lit à chaque tic, avant tout le reste.
grant usage on schema plateforme to malica_api;
revoke all on function plateforme.facturation_auto_ouverte() from public, anon, authenticated;
grant execute on function plateforme.facturation_auto_ouverte() to malica_api;

/* La tour ouvre ou coupe l'émission : daté, motivé, en ajout seul. */
create function plateforme.facturation_auto_regler(
  p_actif boolean, p_rattrapage_mois integer, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_actif is null or p_rattrapage_mois is null
     or p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_rattrapage_mois < 1 then
    raise exception 'refus.facturation_auto.rattrapage_hors_bornes' using errcode = '22023';
  end if;
  insert into plateforme.reglages_facturation_auto (actif, rattrapage_mois, motif, decide_par)
  values (p_actif, p_rattrapage_mois, btrim(p_motif), auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' - 'rang' from plateforme.reglages_facturation_auto r
           where r.id = v_id);
end
$$;

revoke all on function plateforme.facturation_auto_regler(boolean, integer, text) from public, anon;
grant execute on function plateforme.facturation_auto_regler(boolean, integer, text) to authenticated;

-- ------------------------------------------------------------ 2. Le jour de la plateforme

/*
 * Le fuseau de la plateforme : celui de l'organisation émettrice en vigueur,
 * sinon celui de sa juridiction. Sans émetteur, `refus.referentiel.manquant` ;
 * sans fuseau, `refus.fuseau.dossier_non_defini` — jamais UTC par défaut.
 */
create function plateforme.fuseau_de_la_plateforme()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trouve boolean;
  v_fuseau text;
begin
  select true, coalesce(o.fuseau, c.fuseau) into v_trouve, v_fuseau
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
    left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if v_trouve is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;
  return app.fuseau_defini(v_fuseau);
end
$$;

revoke all on function plateforme.fuseau_de_la_plateforme() from public, anon, authenticated;
grant execute on function plateforme.fuseau_de_la_plateforme() to malica_api;

-- --------------------------------------- 3. Les corps, déplacés hors de portée des clients
--
-- Repris de leur définition EN VIGUEUR (`pg_get_functiondef` d'une base
-- migrée : 20261020110000, 20261022400000, 20261110090200). Seuls changent :
-- le nom, la garde retirée (elle reste dans la fonction publique), l'appel
-- de `a_facturer*` devenu celui du corps interne, et, pour le cabinet,
-- l'acteur du journal reçu en argument au lieu d'`auth.uid()`.

CREATE FUNCTION facturation.lignes_a_facturer(p_licence uuid, p_periode date)
 RETURNS TABLE(payeur_type text, payeur_tenant_id uuid, payeur_personne uuid, offre_code text, acces_reference text, jours integer, jours_du_mois integer, montant_ht app.money_t)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
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

CREATE FUNCTION facturation.lignes_a_facturer_cabinet(p_cabinet uuid, p_periode date)
 RETURNS TABLE(licence_id uuid, tenant_id uuid, organisation text, reference text, offre_code text, jours integer, jours_du_mois integer, montant_ht app.money_t)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
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

CREATE FUNCTION facturation.emission_de_la_licence(p_licence uuid, p_periode date, p_jours_echeance integer DEFAULT 15)
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
    select * from facturation.lignes_a_facturer(p_licence, p_periode)
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

CREATE FUNCTION facturation.emission_du_cabinet(p_cabinet uuid, p_periode date, p_acteur uuid, p_jours_echeance integer DEFAULT 15)
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
    from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode) a
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
    select * from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode) a
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
  values (p_cabinet, p_acteur, 'facture.emise', 'facturation', 'factures', v_id,
          jsonb_build_object('numero', v_numero, 'periode', p_periode, 'lignes', v_nb,
                             'ttc', v_ht + v_tva + v_timbre));
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_cabinet, 'facture.emise',
          jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'ttc', v_ht + v_tva + v_timbre));

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'lignes', v_nb,
                            'ht', v_ht, 'ttc', v_ht + v_tva + v_timbre);
end
$function$;

-- Aucun client n'exécute un corps interne : seuls les appellent les fonctions
-- publiques (gardées) et le passage du jour (rôle de l'API).
revoke all on function facturation.lignes_a_facturer(uuid, date) from public, anon, authenticated;
revoke all on function facturation.lignes_a_facturer_cabinet(uuid, date) from public, anon, authenticated;
revoke all on function facturation.emission_de_la_licence(uuid, date, integer)
  from public, anon, authenticated;
revoke all on function facturation.emission_du_cabinet(uuid, date, uuid, integer)
  from public, anon, authenticated;

-- ------------------------------------------------- 4. Les fonctions publiques : garder, appeler
--
-- Même signature, même `security definer`, même propriétaire et mêmes droits
-- (`create or replace` les garde) ; la garde est celle d'avant, mot pour mot.

create or replace function facturation.a_facturer(p_licence uuid, p_periode date)
returns table(payeur_type text, payeur_tenant_id uuid, payeur_personne uuid, offre_code text,
              acces_reference text, jours integer, jours_du_mois integer, montant_ht app.money_t)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.is_platform()
          or exists (select 1 from facturation.licences l
                      where l.id = p_licence and l.titulaire = auth.uid())
          or exists (select 1 from facturation.acces a
                      where a.licence_id = p_licence
                        and a.cabinet_tenant_id in (select app.member_orgs()))) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  return query select * from facturation.lignes_a_facturer(p_licence, p_periode);
end
$$;

create or replace function facturation.a_facturer_cabinet(p_cabinet uuid, p_periode date)
returns table(licence_id uuid, tenant_id uuid, organisation text, reference text, offre_code text,
              jours integer, jours_du_mois integer, montant_ht app.money_t)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.is_platform() or p_cabinet in (select app.member_orgs())) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  return query select * from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode);
end
$$;

create or replace function facturation.emettre(
  p_licence uuid, p_periode date, p_jours_echeance integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return facturation.emission_de_la_licence(p_licence, p_periode, p_jours_echeance);
end
$$;

create or replace function facturation.emettre_cabinet(
  p_cabinet uuid, p_periode date, p_jours_echeance integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return facturation.emission_du_cabinet(p_cabinet, p_periode, auth.uid(), p_jours_echeance);
end
$$;

-- -------------------------------------------------------------- 5. Les passages, observés

create table fabrique.facturations_du_jour (
  id              uuid primary key default gen_random_uuid(),
  jour            date not null,
  decision_id     uuid not null references plateforme.reglages_facturation_auto (id),
  emises          integer not null check (emises >= 0),
  deja_emises     integer not null check (deja_emises >= 0),
  rien_a_facturer integer not null check (rien_a_facturer >= 0),
  erreurs         integer not null check (erreurs >= 0),
  detail          jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  passee_le       timestamptz not null default now(),
  rang            bigint generated always as identity
);
-- Un passage par jour et par décision de la tour : redire « ouverte » relance le jour.
create unique index facturations_du_jour_une_par_decision_ux
  on fabrique.facturations_du_jour (jour, decision_id);
create index facturations_du_jour_decision_idx on fabrique.facturations_du_jour (decision_id);

comment on table fabrique.facturations_du_jour is
  'Un passage de l''émission automatique : le jour de la plateforme, la décision de la tour sous '
  'laquelle il a tourné, et ses compteurs — factures émises, mois déjà facturés, rien à facturer '
  '(dont les mois couverts par l''année ou par le cabinet), erreurs. Le détail porte les factures '
  'émises et, pour chaque erreur, le payeur, le mois et la clé du refus.';

alter table fabrique.facturations_du_jour enable row level security;
alter table fabrique.facturations_du_jour force row level security;
revoke all on table fabrique.facturations_du_jour from public, anon;
grant select on table fabrique.facturations_du_jour to authenticated;
create policy facturations_du_jour_lire on fabrique.facturations_du_jour
  for select to authenticated using ((select app.is_platform()));
create trigger facturations_du_jour_ne_se_reecrivent_pas
  before update or delete on fabrique.facturations_du_jour
  for each row execute function app.deny_mutation();

-- ---------------------------------------------------------- 6. Le passage du jour : l'API seule

/*
 * La clé du verrou consultatif du travailleur : un seul passage à la fois,
 * même si deux API tournent. Distincte de celle que le passage prend
 * lui-même en base (`pg_advisory_xact_lock`), sans quoi la connexion qui
 * tient le verrou de session et celle qui travaille s'attendraient.
 */
create function fabrique.facturation_du_jour_verrou()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select hashtext('fabrique.facturation_du_jour')::bigint
$$;

revoke all on function fabrique.facturation_du_jour_verrou() from public, anon;
grant execute on function fabrique.facturation_du_jour_verrou() to malica_api;

/*
 * Le passage du jour `p_jour` (le jour de la plateforme, que l'API lit en
 * base). Coupée par la tour : rien ne s'écrit, `{"etat": "coupee"}`. Déjà
 * passé ce jour sous la même décision : `{"etat": "deja_passee"}`, rien de
 * neuf. Sinon, pour chacun des `rattrapage_mois` derniers mois clos :
 *   - chaque licence dont le titulaire paie une part ce mois-là ;
 *   - chaque cabinet qui paie une part ce mois-là ;
 * un mois déjà facturé à ce payeur est compté `deja_emises` sans appel ; le
 * reste appelle le corps interne, une sous-transaction par appel — un refus
 * n'arrête pas les autres : `rien_a_facturer` (rien, ou couvert par l'année
 * ou par le cabinet), sinon `erreurs` avec la clé du refus.
 * Chaque facture émise s'inscrit au journal, l'opérateur qui a ouvert
 * l'émission pour acteur.
 */
create function fabrique.facturation_du_jour(p_jour date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reglage  plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur();
  v_dernier  date;
  v_premier  date;
  r          record;
  f          jsonb;
  v_res      jsonb;
  v_cle      text;
  v_emises   integer := 0;
  v_deja     integer := 0;
  v_rien     integer := 0;
  v_factures jsonb := '[]'::jsonb;
  v_erreurs  jsonb := '[]'::jsonb;
  v_bilan    jsonb;
begin
  if p_jour is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  -- Deux appels concurrents ne se croisent pas : le second attend, puis voit
  -- que le jour est passé.
  perform pg_advisory_xact_lock(hashtext('fabrique.facturation_du_jour.emission')::bigint);
  if not plateforme.facturation_auto_ouverte() then
    return jsonb_build_object('etat', 'coupee', 'jour', p_jour);
  end if;
  if exists (select 1 from fabrique.facturations_du_jour x
              where x.jour = p_jour and x.decision_id = v_reglage.id) then
    return jsonb_build_object('etat', 'deja_passee', 'jour', p_jour, 'decision', v_reglage.id);
  end if;

  -- La date d'émission des factures (`current_date` des corps) est celle de
  -- la plateforme, pour la fin de cette transaction.
  perform set_config('TimeZone', plateforme.fuseau_de_la_plateforme(), true);

  v_dernier := (date_trunc('month', p_jour) - interval '1 month')::date;
  v_premier := (date_trunc('month', p_jour) - make_interval(months => v_reglage.rattrapage_mois))::date;

  -- Les licences : leur titulaire paie une part ce mois-là.
  for r in
    select distinct pv.licence_id, m.periode::date as periode
      from generate_series(v_premier::timestamp, v_dernier::timestamp, interval '1 month') m(periode)
      join facturation.payeurs_v pv
        on pv.payeur_type = 'titulaire'
       and pv.du < (m.periode + interval '1 month')::date
       and (pv.au_exclu is null or pv.au_exclu > m.periode::date)
     order by 2, 1
  loop
    if exists (select 1 from facturation.factures x
                where x.licence_id = r.licence_id and x.periode = r.periode
                  and x.payeur_type = 'titulaire' and x.avoir_de is null) then
      v_deja := v_deja + 1;
      continue;
    end if;
    begin
      v_res := facturation.emission_de_la_licence(r.licence_id, r.periode);
      if jsonb_array_length(v_res -> 'factures') = 0 then
        v_rien := v_rien + 1;
      end if;
      for f in select * from jsonb_array_elements(v_res -> 'factures') loop
        insert into audit.event_log
          (tenant_id, actor, action, object_schema, object_table, object_id, payload)
        select coalesce(x.payeur_tenant_id,
                        (select lo.tenant_id from facturation.licence_organisations lo
                          where lo.licence_id = r.licence_id order by lo.tenant_id limit 1)),
               v_reglage.decide_par, 'facture.emise', 'facturation', 'factures', x.id,
               jsonb_build_object('numero', x.numero, 'periode', x.periode, 'ttc', x.montant_ttc,
                                  'par', 'facturation_automatique', 'decision', v_reglage.id)
          from facturation.factures x where x.id = (f ->> 'facture_id')::uuid;
        v_emises := v_emises + 1;
        v_factures := v_factures || jsonb_build_object(
          'facture_id', f -> 'facture_id', 'numero', f -> 'numero', 'periode', r.periode,
          'licence', r.licence_id);
      end loop;
    exception
      when unique_violation then
        v_deja := v_deja + 1;
      when others then
        v_cle := split_part(sqlerrm, '?', 1);
        if v_cle = 'refus.facturation.rien_a_facturer' then
          v_rien := v_rien + 1;
        else
          v_erreurs := v_erreurs || jsonb_build_object(
            'licence', r.licence_id, 'periode', r.periode, 'cle', left(v_cle, 200),
            'etat', sqlstate);
        end if;
    end;
  end loop;

  -- Les cabinets : leur facture mensuelle unique, une ligne par client.
  for r in
    select distinct pv.payeur_tenant_id as cabinet, m.periode::date as periode
      from generate_series(v_premier::timestamp, v_dernier::timestamp, interval '1 month') m(periode)
      join facturation.payeurs_v pv
        on pv.payeur_type = 'cabinet'
       and pv.du < (m.periode + interval '1 month')::date
       and (pv.au_exclu is null or pv.au_exclu > m.periode::date)
     order by 2, 1
  loop
    if exists (select 1 from facturation.factures x
                where x.payeur_tenant_id = r.cabinet and x.periode = r.periode
                  and x.licence_id is null and x.avoir_de is null) then
      v_deja := v_deja + 1;
      continue;
    end if;
    begin
      v_res := facturation.emission_du_cabinet(r.cabinet, r.periode, v_reglage.decide_par);
      v_emises := v_emises + 1;
      v_factures := v_factures || jsonb_build_object(
        'facture_id', v_res -> 'facture_id', 'numero', v_res -> 'numero', 'periode', r.periode,
        'cabinet', r.cabinet);
    exception
      when unique_violation then
        v_deja := v_deja + 1;
      when others then
        v_cle := split_part(sqlerrm, '?', 1);
        if v_cle = 'refus.facturation.rien_a_facturer' then
          v_rien := v_rien + 1;
        else
          v_erreurs := v_erreurs || jsonb_build_object(
            'cabinet', r.cabinet, 'periode', r.periode, 'cle', left(v_cle, 200),
            'etat', sqlstate);
        end if;
    end;
  end loop;

  insert into fabrique.facturations_du_jour
    (jour, decision_id, emises, deja_emises, rien_a_facturer, erreurs, detail)
  values (p_jour, v_reglage.id, v_emises, v_deja, v_rien, jsonb_array_length(v_erreurs),
          jsonb_build_object('factures', v_factures, 'erreurs', v_erreurs,
                             'mois', jsonb_build_object('du', v_premier, 'au', v_dernier)));

  v_bilan := jsonb_build_object(
    'etat', 'passee', 'jour', p_jour, 'decision', v_reglage.id,
    'emises', v_emises, 'deja_emises', v_deja, 'rien_a_facturer', v_rien,
    'erreurs', jsonb_array_length(v_erreurs),
    'factures', v_factures, 'detail_erreurs', v_erreurs);
  return v_bilan;
end
$$;

revoke all on function fabrique.facturation_du_jour(date) from public, anon, authenticated;
grant execute on function fabrique.facturation_du_jour(date) to malica_api;

-- -------------------------------------------------------------------- 7. Ce que la tour lit

/*
 * Pour la plateforme seule : la décision en vigueur (et qui l'a prise :
 * adresse et nom), et le dernier passage avec ses compteurs.
 */
create function plateforme.facturation_auto_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reglage plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur();
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
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
                                 'rien_a_facturer', x.rien_a_facturer, 'erreurs', x.erreurs,
                                 'detail_erreurs', coalesce(x.detail -> 'erreurs', '[]'::jsonb))
         from fabrique.facturations_du_jour x
        order by x.passee_le desc, x.rang desc limit 1));
end
$$;

revoke all on function plateforme.facturation_auto_etat() from public, anon;
grant execute on function plateforme.facturation_auto_etat() to authenticated;
