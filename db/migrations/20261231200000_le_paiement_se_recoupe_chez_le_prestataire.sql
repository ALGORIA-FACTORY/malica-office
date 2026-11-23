-- Le paiement se recoupe chez le prestataire (audit de sécurité du 23 novembre 2026).
--
-- Quatre auditeurs indépendants, avant l'ouverture de Flouci en production, ont
-- prouvé par l'exécution :
--
--   B1  un « SUCCESS » de 1 millime soldait une facture de 7,030 : ni le montant
--       encaissé, ni la référence du lien n'étaient recoupés ;
--   B2  un paiement réellement débité pouvait ne jamais être constaté : seul le
--       DERNIER lien était interrogé, et seulement chez le prestataire en vigueur ;
--   B3  un « payé » du simulateur ouvrait une montée payante sans argent ;
--   B5  l'adresse de l'API d'un prestataire acceptait tout hôte en https : les clés
--       marchandes partaient où la tour l'écrivait.
--
-- La base tient désormais :
--
--   1. Les HÔTES qu'un prestataire a le droit d'utiliser, par usage (son API, sa
--      page de paiement). Ajouter un hôte est une migration relue, jamais un geste
--      de la tour.
--   2. Un « payé » ou un « refusé » ne se constate que sur une référence que CE
--      prestataire a rendue pour CE paiement (un `lien_cree`), quel que soit le
--      prestataire en vigueur aujourd'hui. Pour un prestataire qui fait entrer de
--      l'argent, le « payé » porte le montant encaissé, en unités de la devise, et
--      il doit être celui du paiement : sinon la base refuse.
--   3. La montée ne s'ouvre que sur un argent réellement entré.
--   4. Un encaissement en ligne qui dépasse le reste dû s'inscrit pour ce qu'il est
--      (l'argent est entré), et laisse au journal un trop-perçu à rembourser.
--   5. Deux portes pour l'API : verrouiller un paiement le temps de le traiter, et
--      lire les liens encore ouverts avec ce qu'il faut pour interroger leur
--      prestataire ; une troisième inscrit au journal une réponse incohérente.

begin;

-- --- 1. Les hôtes autorisés -------------------------------------------------

create table facturation.hotes_par_prestataire (
  prestataire text not null references facturation.prestataires_paiement (code),
  usage       text not null check (usage in ('api', 'page')),
  hote        text not null check (hote ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  primary key (prestataire, usage, hote)
);

comment on table facturation.hotes_par_prestataire is
  'Les hôtes qu''un prestataire de paiement a le droit d''utiliser : son API (où partent les '
  'clés marchandes) et sa page de paiement (où le client est envoyé). Sans ligne, aucun.';

alter table facturation.hotes_par_prestataire enable row level security;
revoke all on table facturation.hotes_par_prestataire from public, anon;
grant select on table facturation.hotes_par_prestataire to authenticated;
create policy hotes_par_prestataire_lire on facturation.hotes_par_prestataire
  for select to authenticated using (true);

-- Flouci : docs.flouci.com (relue le 23 novembre 2026). La même API sert le bac à
-- sable et la production ; la page de paiement est servie par checkout.flouci.com,
-- et d'anciens liens par flouci.com.
-- ClicToPay (SMT) : test.clictopay.com est l'hôte de recette déjà utilisé ici ;
-- ipay.clictopay.com est l'hôte de production publié par la SMT — à confirmer sur
-- le contrat marchand avant l'ouverture.
insert into facturation.hotes_par_prestataire (prestataire, usage, hote) values
  ('flouci', 'api', 'developers.flouci.com'),
  ('flouci', 'page', 'checkout.flouci.com'),
  ('flouci', 'page', 'flouci.com'),
  ('clictopay', 'api', 'test.clictopay.com'),
  ('clictopay', 'api', 'ipay.clictopay.com'),
  ('clictopay', 'page', 'test.clictopay.com'),
  ('clictopay', 'page', 'ipay.clictopay.com');

-- L'hôte d'une adresse, en minuscules, sans port ni identifiants.
create or replace function facturation.hote_de(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(substring(p_url from '^https://(?:[^/@]*@)?([^/:?#]+)'))
$$;

-- Le réglage de la tour : l'adresse de l'API est en https ET sur un hôte de ce
-- prestataire ; l'adresse de retour est en https.
create or replace function plateforme.reglage_paiement_coherent()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  p facturation.prestataires_paiement;
begin
  select * into p from facturation.prestataires_paiement where code = new.prestataire;
  if p.ouvre_le_paiement and (new.url_retour is null or new.url_retour !~ '^https://') then
    raise exception 'refus.paiement.adresse_de_retour' using errcode = 'check_violation';
  end if;
  if p.exige_url_api and (new.url_api is null or new.url_api !~ '^https://') then
    raise exception 'refus.paiement.adresse_https' using errcode = 'check_violation';
  end if;
  if p.exige_url_api and not exists (
       select 1 from facturation.hotes_par_prestataire h
        where h.prestataire = new.prestataire and h.usage = 'api'
          and h.hote = facturation.hote_de(new.url_api)) then
    raise exception 'refus.paiement.hote_non_autorise' using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

-- --- 2. Constater sur une référence de ce paiement, au bon montant ----------

create or replace function public.paiement_inscrire(
  p_paiement uuid, p_etat text, p_prestataire text, p_reference text default null::text,
  p_lien text default null::text, p_detail jsonb default '{}'::jsonb, p_moyen text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
    -- Déjà constaté : on ne le compte pas deux fois, on le rend.
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
        select x.tenant_id from facturation.licence_organisations x
         where x.licence_id = v_licence order by x.tenant_id limit 1) lo on true
     where coalesce(v_payeur, lo.tenant_id) is not null;
  end if;

  return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = p_paiement);
end
$function$;

-- --- 3. La montée ne s'ouvre que sur un argent réellement entré -------------
--
-- La définition en vigueur est celle de 20261231160000 ; seule la garde change.

create or replace function facturation.une_montee_payee_s_ouvre()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  d         facturation.montees_demandees;
  p         facturation.paiements_en_ligne;
  v_rendu   text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_ouvert  uuid;
  v_facture uuid;
  v_enc     uuid;
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
    perform public.forfait_changer(d.offre_code, d.par_societe, d.le);
    select c.id into v_ouvert from facturation.forfait_courant_v c where c.licence_id = d.licence_id;
    insert into facturation.montees_ouvertes (montee_id, forfait_id) values (d.id, v_ouvert);

    if plateforme.facturation_auto_ouverte('pme')
       and exists (select 1 from facturation.prestataires_paiement pp
                    where pp.code = new.prestataire and pp.fait_entrer_argent)
       and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
      perform facturation.facturer_sur_le_champ(d.licence_id, d.le);
      select x.id into v_facture
        from facturation.factures x
       where x.licence_id = d.licence_id and x.payeur_type = 'titulaire'
         and x.payeur_personne = d.demande_par and x.nature = 'complement'
         and x.couvre_du >= d.le and x.avoir_de is null and x.statut <> 'annulee'
       order by x.created_at desc
       limit 1;
      if v_facture is not null then
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_facture, p.montant_ttc, facturation.moyen_encaissement_du_paiement(p.id),
                new.prestataire || ' ' || coalesce(new.reference, p.id::text), new.le::date)
        returning id into v_enc;
        insert into facturation.paiement_imputations (paiement_id, encaissement_id)
        values (p.id, v_enc);
      end if;
    end if;
  exception when others then
    -- Le paiement n'est jamais rejeté : le refus s'écrit, la tour rembourse.
    insert into facturation.montees_ouvertes (montee_id, refus) values (d.id, sqlerrm);
  end;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
  return new;
end
$$;
revoke all on function facturation.une_montee_payee_s_ouvre() from public, anon, authenticated;

-- --- 4. Le trop-perçu se dit ------------------------------------------------

create or replace function facturation.une_facture_payee_s_encaisse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p       facturation.paiements_en_ligne;
  v_enc   uuid;
  v_lic   uuid;
  v_reste numeric;
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

  select e.reste_du into v_reste from facturation.encours_v e where e.facture_id = p.facture_id;

  -- L'argent est entré : il s'inscrit pour ce qu'il est.
  insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
  values (p.facture_id, p.montant_ttc, facturation.moyen_encaissement_du_paiement(p.id),
          new.prestataire || ' ' || coalesce(new.reference, p.id::text), new.le::date)
  returning id into v_enc;
  insert into facturation.paiement_imputations (paiement_id, encaissement_id)
  values (p.id, v_enc);

  -- Plus que le reste dû (un encaissement saisi pendant que la page de carte était
  -- ouverte) : la différence est due au client, et la tour la voit au journal.
  if v_reste is not null and p.montant_ttc > v_reste then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select coalesce(p.payeur_tenant_id, lo.tenant_id), auth.uid(), 'paiement.trop_percu',
           'facturation', 'paiements_en_ligne', p.id,
           jsonb_build_object('facture_id', p.facture_id, 'encaisse', p.montant_ttc,
                              'reste_du_avant', greatest(v_reste, 0),
                              'trop_percu', p.montant_ttc - greatest(v_reste, 0),
                              'devise', p.devise, 'prestataire', new.prestataire,
                              'reference', new.reference)
      from (select 1) un
      left join lateral (
        select x.tenant_id from facturation.licence_organisations x
         where x.licence_id = p.licence_id order by x.tenant_id limit 1) lo on true
     where coalesce(p.payeur_tenant_id, lo.tenant_id) is not null;
  end if;

  -- Les licences que la facture couvre : la sienne, ou celles de ses lignes.
  for v_lic in
    select f.licence_id from facturation.factures f
     where f.id = p.facture_id and f.licence_id is not null
    union
    select fl.licence_id from facturation.facture_lignes fl
     where fl.facture_id = p.facture_id and fl.licence_id is not null
  loop
    if exists (select 1 from facturation.licences l
                where l.id = v_lic and l.statut = 'suspendue' and l.motif_suspension = 'impaye')
       and not facturation.licence_a_un_retard(v_lic) then
      update facturation.licences
         set statut = 'active', suspendue_le = null, motif_suspension = null, updated_at = now()
       where id = v_lic;
      insert into plateforme.interventions (licence_id, acte, motif, valeur_text)
      values (v_lic, 'reprise',
              'Reprise automatique : plus aucune facture en retard après le paiement en ligne',
              p.libelle);
    end if;
  end loop;
  return new;
end
$$;
revoke all on function facturation.une_facture_payee_s_encaisse() from public, anon, authenticated;

-- --- 5. Les portes de l'API -------------------------------------------------

-- Verrouiller un paiement le temps de le traiter : deux onglets, deux vérifications
-- concurrentes, un double clic passent l'un après l'autre. N'écrit rien.
create or replace function public.paiement_verrouiller(p_paiement uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_licence uuid;
  v_payeur  uuid;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement
     for update;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
end
$$;
revoke all on function public.paiement_verrouiller(uuid) from public, anon;
grant execute on function public.paiement_verrouiller(uuid) to authenticated;

-- Les liens d'un paiement que personne n'a encore conclus (ni payé, ni refusé sur
-- leur référence), du plus récent au plus ancien, avec ce qu'il faut pour
-- interroger LEUR prestataire : son adaptateur, la dernière adresse d'API que la
-- tour lui a donnée, sa langue, et les unités attendues. Aucun secret.
create or replace function public.paiement_liens_ouverts(p_paiement uuid)
returns table (
  prestataire text, reference text, dernier boolean, adaptateur text, url_api text,
  langue text, unites_attendues numeric, exposant integer)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_licence uuid;
  v_payeur  uuid;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  return query
  with dernier as (
    select e.id from facturation.paiement_evenements e
     where e.paiement_id = p_paiement
     order by e.le desc, e.id desc limit 1)
  select e.prestataire, e.reference, e.id = (select id from dernier),
         pp.adaptateur,
         (select r.url_api from plateforme.reglages_paiement r
           where r.prestataire = e.prestataire and r.url_api is not null
           order by r.decide_le desc, r.id desc limit 1),
         pp.langue,
         p.montant_ttc * power(10::numeric, d.exposant),
         d.exposant::integer
    from facturation.paiement_evenements e
    join facturation.paiements_en_ligne p on p.id = e.paiement_id
    join ref.devises d on d.code = p.devise
    join facturation.prestataires_paiement pp on pp.code = e.prestataire
   where e.paiement_id = p_paiement and e.etat = 'lien_cree' and e.reference is not null
     and not exists (select 1 from facturation.paiement_evenements f
                      where f.paiement_id = e.paiement_id and f.etat in ('paye', 'refuse')
                        and f.prestataire = e.prestataire and f.reference = e.reference)
   order by e.le desc, e.id desc;
end
$$;
revoke all on function public.paiement_liens_ouverts(uuid) from public, anon;
grant execute on function public.paiement_liens_ouverts(uuid) to authenticated;

-- Une réponse de prestataire incohérente (montant ou référence qui ne sont pas
-- ceux du paiement) : rien ne se solde, et la tour la lit au journal.
create or replace function public.paiement_signaler_anomalie(
  p_paiement uuid, p_prestataire text, p_reference text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_licence uuid;
  v_payeur  uuid;
begin
  select p.licence_id, p.payeur_tenant_id into v_licence, v_payeur
    from facturation.paiements_en_ligne p where p.id = p_paiement;
  if not found or not facturation.peut_payer(v_licence, v_payeur) then
    raise exception 'refus.introuvable.paiement' using errcode = '42501';
  end if;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select coalesce(v_payeur, lo.tenant_id), auth.uid(), 'paiement.anomalie', 'facturation',
         'paiements_en_ligne', p_paiement,
         jsonb_build_object('prestataire', p_prestataire, 'reference', p_reference,
                            'detail', coalesce(p_detail, '{}'::jsonb))
    from (select 1) un
    left join lateral (
      select x.tenant_id from facturation.licence_organisations x
       where x.licence_id = v_licence order by x.tenant_id limit 1) lo on true
   where coalesce(v_payeur, lo.tenant_id) is not null;
end
$$;
revoke all on function public.paiement_signaler_anomalie(uuid, text, text, jsonb) from public, anon;
grant execute on function public.paiement_signaler_anomalie(uuid, text, text, jsonb) to authenticated;

-- --- 6. La notification du prestataire -------------------------------------
--
-- Flouci notifie le serveur quand un paiement atteint un état final. La
-- notification n'a pas d'identité : le serveur, après avoir vérifié sa
-- signature, demande à la base QUI relire ce paiement — la personne qui l'a
-- créé — et le vérifie sous SON identité, par le chemin ordinaire (verrou,
-- recoupement chez le prestataire, « payé une fois »). La base ne rend cette
-- personne que pour un paiement encore à constater qui porte un lien de ce
-- prestataire sous cette référence : un identifiant deviné ne suffit pas.
-- Réservée au rôle de connexion de l'API.
create or replace function public.paiement_payeur_a_relire(
  p_paiement uuid, p_prestataire text, p_reference text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select p.cree_par
    from facturation.paiements_en_ligne p
   where p.id = p_paiement
     and exists (select 1 from facturation.paiement_evenements e
                  where e.paiement_id = p.id and e.etat = 'lien_cree'
                    and e.prestataire = p_prestataire and e.reference = p_reference)
     and not exists (select 1 from facturation.paiement_evenements e
                      where e.paiement_id = p.id and e.etat = 'paye')
$$;
revoke all on function public.paiement_payeur_a_relire(uuid, text, text) from public, anon, authenticated;
grant execute on function public.paiement_payeur_a_relire(uuid, text, text) to malica_api;

commit;
