-- La comptabilité paie son relevé ; sa facture naît au paiement (décisions du CEO du
-- 25 novembre 2026 : D7, D8 option A, D10, D11).
--
-- « Le compteur de la comptabilité ne tourne que si elle affecte un abonnement : on ne peut
-- pas prévoir son mois. » Elle ne paie donc pas d'avance ; mais, comme pour la PME, aucune
-- facture ne naît avant l'encaissement (une TVA sur une facture non encaissée est exclue).
--
-- 1. Le passage du 1er établit, pour le mois écoulé, un RELEVÉ (non fiscal) : ses lignes et
--    ses montants sont figés, son paiement est prêt (lien Malica → session du prestataire).
-- 2. Le relevé se règle en ligne, ou par virement du montant exact, inscrit dans la tour par
--    toute personne qui y a accès (D10). La facture naît alors, réglée, au montant du relevé.
-- 3. Impayé passé `releve_blocage_jours` (14 par défaut) : plus de nouvelle attribution.
--    Passé `releve_suspension_jours` (30) : les abonnements que la comptabilité paie sont
--    suspendus. Son paiement rouvre tout. Les deux délais se règlent dans la tour (D11).
-- 4. Un relevé payé deux fois (en ligne après un virement) : l'argent est gardé
--    (`paiements_en_double`), la tour le voit.
-- 5. Un paiement, un courriel : la facture réglée de la comptabilité est son reçu.
-- 6. Un solde créditeur que rien n'attend se rembourse : la tour l'inscrit (référence, motif),
--    il cesse de compter. La tour voit les soldes des licences et des comptabilités.

begin;

-- ---------------------------------------------------------------- les délais, en tour
alter table plateforme.reglages_abonnement
  add column releve_blocage_jours smallint not null default 14
    constraint reglages_releve_blocage_borne check (releve_blocage_jours between 1 and 90),
  add column releve_suspension_jours smallint not null default 30
    constraint reglages_releve_suspension_borne check (releve_suspension_jours between 1 and 180),
  add constraint reglages_releve_ordre check (releve_suspension_jours >= releve_blocage_jours);
comment on column plateforme.reglages_abonnement.releve_blocage_jours is
  'Jours après lesquels un relevé impayé ferme les nouvelles attributions de la comptabilité.';
comment on column plateforme.reglages_abonnement.releve_suspension_jours is
  'Jours après lesquels un relevé impayé suspend les abonnements que la comptabilité paie.';

-- ---------------------------------------------------------------- le relevé
create table facturation.releves_cabinet (
  id          uuid primary key default gen_random_uuid(),
  cabinet_id  uuid not null references identity.organizations(id),
  periode     date not null constraint releves_premier_du_mois check (extract(day from periode) = 1),
  etabli_le   date not null,
  abonnements integer not null check (abonnements >= 1),
  montant_ht  app.money_t not null check (montant_ht > 0),
  taux_tva    numeric(8,6) not null check (taux_tva >= 0),
  montant_tva app.money_t not null check (montant_tva >= 0),
  timbre      app.money_t not null check (timbre >= 0),
  montant_ttc app.money_t not null,
  devise      text not null references ref.devises(code),
  etabli_par  uuid,
  created_at  timestamptz not null default now(),
  constraint releves_ttc_coherent check (montant_ttc = montant_ht + montant_tva + timbre),
  constraint releves_un_par_mois unique (cabinet_id, periode)
);
comment on table facturation.releves_cabinet is
  'Le relevé du mois écoulé d''une comptabilité : non fiscal, figé, à payer. Sa facture naît au paiement.';
alter table facturation.releves_cabinet enable row level security;
revoke all on facturation.releves_cabinet from public, anon, authenticated;
create index releves_cabinet_non_regles_idx on facturation.releves_cabinet (etabli_le);
create trigger releves_ne_se_reecrivent_pas before update or delete on facturation.releves_cabinet
  for each row execute function app.deny_mutation();

create table facturation.releve_lignes (
  releve_id  uuid not null references facturation.releves_cabinet(id),
  ordinal    smallint not null check (ordinal >= 1),
  libelle    text not null check (length(btrim(libelle)) > 0),
  montant_ht app.money_t not null check (montant_ht > 0),
  licence_id uuid references facturation.licences(id),
  tenant_id  uuid references identity.organizations(id),
  primary key (releve_id, ordinal)
);
create index releve_lignes_tenant_idx on facturation.releve_lignes (tenant_id);
create index releve_lignes_licence_idx on facturation.releve_lignes (licence_id);
alter table facturation.releve_lignes enable row level security;
alter table facturation.releve_lignes force row level security;
revoke all on facturation.releve_lignes from public, anon, authenticated;
-- Les mêmes gardes que les lignes d'une facture : une ligne ne se lit que par
-- son relevé, et sa licence est bien celle de la société qu'elle nomme.
create policy releve_lignes_lire on facturation.releve_lignes for select to authenticated
  using ((select app.is_platform())
         or exists (select 1 from facturation.releves_cabinet r
                     where r.id = releve_lignes.releve_id
                       and r.cabinet_id in (select app.member_orgs())));
create policy releve_lignes_ins on facturation.releve_lignes for insert to authenticated
  with check ((select app.is_platform())
              and (licence_id is null or tenant_id is null
                   or exists (select 1 from facturation.licence_organisations lo
                               where lo.licence_id = releve_lignes.licence_id
                                 and lo.tenant_id = releve_lignes.tenant_id)));
-- Le relecteur de nuit n'en a pas besoin : il ne la lit ni ne l'écrit.
create policy service_hors_perimetre on facturation.releve_lignes as restrictive
  for select to authenticated using ((select app.service()) is null);
create trigger service_hors_perimetre
  before insert or update or delete on facturation.releve_lignes
  for each statement execute function app.service_hors_perimetre();
create trigger releve_lignes_ne_se_reecrivent_pas before update or delete on facturation.releve_lignes
  for each row execute function app.deny_mutation();

create table facturation.releve_factures (
  releve_id  uuid primary key references facturation.releves_cabinet(id),
  facture_id uuid not null unique references facturation.factures(id)
);
alter table facturation.releve_factures enable row level security;
revoke all on facturation.releve_factures from public, anon, authenticated;
-- La vue des paiements (lue sous l'identité de l'appelant) dit « remplacé » le paiement d'un
-- relevé déjà réglé : la comptabilité lit donc ses relevés et leur facture, et elle seule.
grant select on facturation.releves_cabinet, facturation.releve_factures to authenticated;
create policy releves_cabinet_lire on facturation.releves_cabinet for select to authenticated
  using ((select app.is_platform()) or cabinet_id in (select app.member_orgs()));
create policy releve_factures_lire on facturation.releve_factures for select to authenticated
  using ((select app.is_platform())
         or releve_id in (select r.id from facturation.releves_cabinet r));
create trigger releve_factures_ne_se_reecrivent_pas before update or delete on facturation.releve_factures
  for each row execute function app.deny_mutation();

-- Son paiement en ligne : un objet de plus, payé par la comptabilité.
alter table facturation.paiements_en_ligne
  add column releve_id uuid references facturation.releves_cabinet(id);
create index paiements_en_ligne_releve_idx on facturation.paiements_en_ligne (releve_id);
alter table facturation.paiements_en_ligne drop constraint paiements_en_ligne_objet_check;
alter table facturation.paiements_en_ligne add constraint paiements_en_ligne_objet_check
  check (objet = any (array['montee', 'recharge', 'annuel', 'facture', 'montee_demandee', 'releve']));
alter table facturation.paiements_en_ligne drop constraint paiements_objet_designe;
alter table facturation.paiements_en_ligne add constraint paiements_objet_designe
  check ((objet = 'montee') = (forfait_id is not null)
     and (objet = 'recharge') = (recharge_id is not null)
     and (objet = 'annuel') = (engagement_id is not null)
     and (objet = 'facture') = (facture_id is not null)
     and (objet = 'montee_demandee') = (montee_demandee_id is not null)
     and (objet = 'releve') = (releve_id is not null));
alter table facturation.paiements_en_ligne drop constraint paiements_un_payeur;
alter table facturation.paiements_en_ligne add constraint paiements_un_payeur
  check ((licence_id is not null and payeur_tenant_id is null)
      or (objet in ('facture', 'releve') and payeur_tenant_id is not null));

-- ---------------------------------------------------------------- dire aux experts
create function notif.emettre_aux_experts(p_cabinet uuid, p_code text, p_donnees jsonb,
                                          p_sujet_cle text, p_fenetre interval)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_expert uuid;
  v_n      integer := 0;
begin
  for v_expert in
    select m.user_id from identity.memberships m
     where m.tenant_id = p_cabinet and m.role = 'expert'
     order by m.created_at
  loop
    v_n := v_n + notif.emettre(p_cabinet, p_code, p_donnees, v_expert, p_sujet_cle, p_fenetre);
  end loop;
  return v_n;
end
$function$;
revoke all on function notif.emettre_aux_experts(uuid, text, jsonb, text, interval) from public, anon, authenticated;

-- Les délais réglés en tour ; sans réglage, aucune ligne : rien ne bloque.
create function facturation.delais_du_releve()
 returns table (blocage_jours smallint, suspension_jours smallint)
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select x.releve_blocage_jours, x.releve_suspension_jours
    from plateforme.reglages_abonnement x
   order by x.decide_le desc, x.id desc limit 1
$$;
revoke all on function facturation.delais_du_releve() from public, anon, authenticated;

-- ---------------------------------------------------------------- le retard d'un relevé
-- Le plus ancien relevé impayé de la comptabilité, et les jours où il la bloque puis suspend
-- ses clients. Sans réglage de la tour, aucun délai : rien ne bloque.
create function facturation.retard_du_releve(p_cabinet uuid)
 returns table (releve_id uuid, etabli_le date, bloque_le date, suspendu_le date)
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select r.id, r.etabli_le, r.etabli_le + g.blocage_jours, r.etabli_le + g.suspension_jours
    from facturation.releves_cabinet r
    cross join facturation.delais_du_releve() g
   where r.cabinet_id = p_cabinet
     and not exists (select 1 from facturation.releve_factures rf where rf.releve_id = r.id)
   order by r.etabli_le, r.periode
   limit 1
$$;
revoke all on function facturation.retard_du_releve(uuid) from public, anon, authenticated;

-- Ce que les avis d'un relevé disent : tous leurs jetons, et rien d'autre.
create function facturation.donnees_du_releve(p_releve uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select jsonb_build_object(
           'releve_id',   r.id,
           'paiement_id', (select p.id from facturation.paiements_en_ligne p
                            where p.releve_id = r.id order by p.cree_le desc limit 1),
           'periode',     to_char(r.periode, 'MM/YYYY'),
           'abonnements', r.abonnements::text,
           'ttc',         facturation.montant_en_texte(r.montant_ttc, r.devise),
           'devise',      r.devise,
           'bloque',      coalesce(to_char(r.etabli_le + g.blocage_jours, 'DD/MM/YYYY'), '—'),
           'suspension',  coalesce(to_char(r.etabli_le + g.suspension_jours, 'DD/MM/YYYY'), '—'))
    from facturation.releves_cabinet r
    left join facturation.delais_du_releve() g on true
   where r.id = p_releve
$$;
revoke all on function facturation.donnees_du_releve(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- établir le relevé
-- Ce que `emission_du_cabinet` calculait pour émettre, figé sans rien émettre.
drop function facturation.emettre_cabinet(uuid, date, integer);
drop function facturation.emission_du_cabinet(uuid, date, uuid, integer);

create function facturation.releve_etablir(p_cabinet uuid, p_periode date, p_acteur uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_ht       app.money_t;
  v_tva      app.money_t;
  v_nb       integer;
  v_id       uuid;
  v_pid      uuid;
  v_par      uuid;
  l          record;
  v_ordinal  smallint := 0;
begin
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;
  if exists (select 1 from facturation.releves_cabinet r
              where r.cabinet_id = p_cabinet and r.periode = p_periode)
     or exists (select 1 from facturation.factures f
                 where f.payeur_tenant_id = p_cabinet and f.periode = p_periode
                   and f.licence_id is null and f.avoir_de is null) then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.deja_emise', 'periode', (p_periode)::text)
      using errcode = 'unique_violation';
  end if;
  if not exists (select 1 from identity.organizations o where o.id = p_cabinet and o.kind = 'cabinet') then
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

  -- `v_nb` : les abonnements du relevé, pas les lignes de passage.
  select coalesce(sum(a.montant_ht), 0), count(distinct (a.licence_id, a.tenant_id)) into v_ht, v_nb
    from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode) a
   where a.montant_ht > 0;
  if v_nb = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text) using errcode = 'no_data_found';
  end if;
  v_tva := round(v_ht * v_taux, 3);

  insert into facturation.releves_cabinet
    (cabinet_id, periode, etabli_le, abonnements, montant_ht, taux_tva, montant_tva, timbre,
     montant_ttc, devise, etabli_par)
  values (p_cabinet, p_periode, current_date, v_nb, v_ht, v_taux, v_tva, v_timbre,
          v_ht + v_tva + v_timbre, v_emetteur.currency, p_acteur)
  returning id into v_id;

  -- Une ligne par société ET par offre : un passage (Basic → Solo) se lit, avec ses dates.
  for l in
    select * from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode) a
     where a.montant_ht > 0 order by a.organisation, a.licence_id, a.du
  loop
    v_ordinal := v_ordinal + 1;
    insert into facturation.releve_lignes (releve_id, ordinal, libelle, montant_ht, licence_id, tenant_id)
    values (v_id, v_ordinal,
            case when l.offre_avant is not null
                 then 'Passage ' || coalesce((ref.offre_a(l.offre_avant, l.du)).libelle, l.offre_avant)
                      || ' → ' || coalesce((ref.offre_a(l.offre_code, l.du)).libelle, l.offre_code)
                 else 'Abonnement ' || coalesce((ref.offre_a(l.offre_code, l.du)).libelle, l.offre_code)
            end
              || ' — ' || l.organisation
              || coalesce(' (' || l.reference || ')', '')
              || ' — du ' || to_char(l.du, 'DD/MM/YYYY') || ' au ' || to_char(l.au_exclu - 1, 'DD/MM/YYYY')
              || case when l.jours <> l.jours_du_mois
                      then ' (' || l.jours || '/' || l.jours_du_mois || ' jours)' else '' end,
            l.montant_ht, l.licence_id, l.tenant_id);
  end loop;

  -- Son paiement est prêt : le lien Malica du courriel ouvre une session neuve au clic.
  v_par := coalesce(p_acteur, (select m.user_id from identity.memberships m
                                where m.tenant_id = p_cabinet and m.role = 'expert'
                                order by m.created_at limit 1));
  insert into facturation.paiements_en_ligne
    (payeur_tenant_id, objet, releve_id, libelle, montant_ht, taux_tva, montant_tva, timbre,
     montant_ttc, devise, cree_par)
  values (p_cabinet, 'releve', v_id, 'Relevé ' || to_char(p_periode, 'MM/YYYY'), v_ht, v_taux,
          v_tva, v_timbre, v_ht + v_tva + v_timbre, v_emetteur.currency, v_par)
  returning id into v_pid;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, p_acteur, 'releve.etabli', 'facturation', 'releves_cabinet', v_id,
          jsonb_build_object('periode', p_periode, 'abonnements', v_nb,
                             'ttc', v_ht + v_tva + v_timbre));
  perform notif.emettre_aux_experts(p_cabinet, 'releve.cabinet', facturation.donnees_du_releve(v_id),
                                    'releve:' || v_id::text, interval '400 days');

  return jsonb_build_object('releve_id', v_id, 'paiement_id', v_pid, 'lignes', v_ordinal,
                            'abonnements', v_nb, 'ht', v_ht, 'ttc', v_ht + v_tva + v_timbre);
end
$function$;
revoke all on function facturation.releve_etablir(uuid, date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- la facture naît au paiement
-- Du relevé, à l'identique : ses lignes, ses montants. Numérotée et datée du jour où
-- l'argent est constaté ; réglée par lui. Rend null si le relevé a déjà sa facture.
create function facturation.facture_du_releve(p_releve uuid, p_jour date, p_encaisse_le date,
                                              p_moyen text, p_reference text, p_paiement uuid,
                                              p_acteur uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r        facturation.releves_cabinet;
  v_nom    text;
  v_legal  text;
  v_numero text;
  v_id     uuid;
  v_enc    uuid;
begin
  select x.* into r from facturation.releves_cabinet x where x.id = p_releve;
  if r.id is null then
    raise exception 'refus.introuvable.releve' using errcode = 'no_data_found';
  end if;
  -- Un paiement à la fois par relevé : en ligne et virement ne le facturent pas deux fois.
  perform pg_advisory_xact_lock(hashtextextended('releve:' || p_releve::text, 0));
  if exists (select 1 from facturation.releve_factures rf where rf.releve_id = p_releve) then
    return null;
  end if;
  select o.name, o.legal_id into v_nom, v_legal
    from identity.organizations o where o.id = r.cabinet_id;

  v_numero := facturation.numero_de_facture(p_jour);
  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations, sieges_payants,
     montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id)
  values
    (null, v_numero, r.periode, p_jour, p_jour, null, r.abonnements, 0,
     r.montant_ht, r.taux_tva, r.montant_tva, r.timbre, r.montant_ttc, r.devise,
     'cabinet', r.cabinet_id, null, v_nom, v_legal)
  returning id into v_id;
  insert into facturation.facture_lignes
    (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht, licence_id, tenant_id)
  select v_id, l.ordinal, l.libelle, 1, l.montant_ht, l.montant_ht, l.licence_id, l.tenant_id
    from facturation.releve_lignes l where l.releve_id = p_releve order by l.ordinal;
  insert into facturation.releve_factures (releve_id, facture_id) values (p_releve, v_id);

  insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le, saisi_par)
  values (v_id, r.montant_ttc, p_moyen, p_reference, p_encaisse_le, coalesce(auth.uid(), p_acteur))
  returning id into v_enc;
  if p_paiement is not null then
    insert into facturation.paiement_imputations (paiement_id, encaissement_id)
    values (p_paiement, v_enc);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (r.cabinet_id, coalesce(auth.uid(), p_acteur), 'facture.emise', 'facturation', 'factures', v_id,
          jsonb_build_object('numero', v_numero, 'periode', r.periode, 'releve', p_releve,
                             'ttc', r.montant_ttc, 'par', 'paiement', 'moyen', p_moyen));
  perform facturation.avertir_de_la_facture(v_id);
  return v_id;
end
$function$;
revoke all on function facturation.facture_du_releve(uuid, date, date, text, text, uuid, uuid) from public, anon, authenticated;

create function facturation.un_releve_paye_se_facture()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  p     facturation.paiements_en_ligne;
  v_ref text;
begin
  if new.etat <> 'paye' then
    return new;
  end if;
  select * into p from facturation.paiements_en_ligne where id = new.paiement_id;
  if p.objet <> 'releve'
     or not exists (select 1 from facturation.prestataires_paiement pp
                     where pp.code = new.prestataire and pp.fait_entrer_argent)
     or exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
    return new;
  end if;
  v_ref := coalesce(new.reference, p.id::text);
  if facturation.facture_du_releve(
       p.releve_id,
       greatest((now() at time zone plateforme.fuseau_de_la_plateforme())::date, new.le::date),
       new.le::date, facturation.moyen_encaissement_du_paiement(p.id),
       new.prestataire || ' ' || v_ref, p.id, p.cree_par) is null then
    -- Le relevé était déjà réglé (un virement inscrit entre-temps) : l'argent est gardé, la
    -- tour le voit et le rembourse.
    insert into facturation.paiements_en_double
      (paiement_id, payeur_tenant_id, prestataire, reference, montant, devise)
    values (p.id, p.payeur_tenant_id, new.prestataire, v_ref, p.montant_ttc, p.devise)
    on conflict (prestataire, reference) do nothing;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (p.payeur_tenant_id, p.cree_par, 'paiement.trop_percu', 'facturation',
            'paiements_en_ligne', p.id,
            jsonb_build_object('motif', 'releve_deja_regle', 'reference', v_ref,
                               'trop_percu', p.montant_ttc));
  end if;
  return new;
end
$function$;
revoke all on function facturation.un_releve_paye_se_facture() from public, anon, authenticated;
create trigger un_releve_paye_se_facture after insert on facturation.paiement_evenements
  for each row execute function facturation.un_releve_paye_se_facture();

-- ---------------------------------------------------------------- le virement, en tour (D10)
-- Toute personne de la tour l'inscrit, sans seconde validation ; le montant est exact.
create function plateforme.virement_encaisser(p_releve uuid, p_montant numeric, p_le date,
                                              p_reference text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r     facturation.releves_cabinet;
  v_id  uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  select x.* into r from facturation.releves_cabinet x where x.id = p_releve;
  if r.id is null then
    raise exception 'refus.introuvable.releve' using errcode = 'no_data_found';
  end if;
  if p_montant is distinct from r.montant_ttc then
    raise exception '%', app.refus_avec_valeurs(
        'refus.virement.montant_inexact', 'attendu',
        facturation.montant_en_texte(r.montant_ttc, r.devise) || ' ' || r.devise)
      using errcode = 'check_violation';
  end if;
  if p_le is null or p_le > current_date or p_le < r.periode then
    raise exception 'refus.virement.date' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_reference), '') = '' then
    raise exception 'refus.virement.reference' using errcode = 'check_violation';
  end if;
  v_id := facturation.facture_du_releve(p_releve, current_date, p_le, 'virement',
                                        btrim(p_reference), null, auth.uid());
  if v_id is null then
    raise exception 'refus.releve.deja_regle' using errcode = 'check_violation';
  end if;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (r.cabinet_id, auth.uid(), 'virement.encaisse', 'facturation', 'releves_cabinet', r.id,
          jsonb_build_object('montant', p_montant, 'le', p_le, 'reference', btrim(p_reference),
                             'facture_id', v_id));
  return (select jsonb_build_object('facture_id', f.id, 'numero', f.numero)
            from facturation.factures f where f.id = v_id);
end
$function$;
revoke all on function plateforme.virement_encaisser(uuid, numeric, date, text) from public, anon;
grant execute on function plateforme.virement_encaisser(uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------- lire les relevés
-- Les relevés d'une comptabilité, pour ses membres et pour la tour : l'état, les lignes, les
-- jours de blocage et de suspension, et où virer.
create function public.releves_du_cabinet(p_cabinet uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not (app.is_platform() or p_cabinet in (select app.member_orgs())) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'banque', (select case when coalesce(x.banque_rib, x.banque_iban) is null then null
                           else jsonb_build_object(
                             'titulaire', x.banque_titulaire, 'banque', x.banque_nom,
                             'rib', x.banque_rib, 'iban', x.banque_iban, 'bic', x.banque_bic) end
                 from plateforme.reglages_factures x
                where x.valide_des <= current_date
                order by x.valide_des desc, x.rang desc limit 1),
    'releves', coalesce((
      select jsonb_agg(jsonb_build_object(
               'releve_id', r.id, 'periode', r.periode, 'etabli_le', r.etabli_le,
               'abonnements', r.abonnements, 'montant_ht', r.montant_ht,
               'montant_tva', r.montant_tva, 'timbre', r.timbre, 'montant_ttc', r.montant_ttc,
               'devise', r.devise,
               'facture_id', rf.facture_id,
               'numero', (select f.numero from facturation.factures f where f.id = rf.facture_id),
               'paiement_id', case when rf.facture_id is null then
                 (select p.id from facturation.paiements_en_ligne p
                   where p.releve_id = r.id order by p.cree_le desc limit 1) end,
               'bloque_le', case when rf.facture_id is null then r.etabli_le + g.blocage_jours end,
               'suspendu_le', case when rf.facture_id is null then r.etabli_le + g.suspension_jours end,
               'lignes', (select jsonb_agg(jsonb_build_object('libelle', l.libelle,
                                                              'montant_ht', l.montant_ht)
                                           order by l.ordinal)
                            from facturation.releve_lignes l where l.releve_id = r.id))
             order by r.periode desc)
        from facturation.releves_cabinet r
        left join facturation.releve_factures rf on rf.releve_id = r.id
        left join facturation.delais_du_releve() g on true
       where r.cabinet_id = p_cabinet), '[]'::jsonb));
end
$function$;
revoke all on function public.releves_du_cabinet(uuid) from public, anon;
grant execute on function public.releves_du_cabinet(uuid) to authenticated;

-- La tour : les relevés qui attendent leur paiement, toutes comptabilités.
create function plateforme.releves_a_encaisser()
 returns table (releve_id uuid, cabinet_id uuid, cabinet text, periode date, etabli_le date,
                montant_ttc numeric, devise text, bloque_le date, suspendu_le date)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return query
    select r.id, r.cabinet_id, o.name::text, r.periode, r.etabli_le, r.montant_ttc::numeric,
           r.devise, r.etabli_le + g.blocage_jours, r.etabli_le + g.suspension_jours
      from facturation.releves_cabinet r
      join identity.organizations o on o.id = r.cabinet_id
      left join facturation.delais_du_releve() g on true
     where not exists (select 1 from facturation.releve_factures rf where rf.releve_id = r.id)
     order by r.etabli_le, o.name;
end
$function$;
revoke all on function plateforme.releves_a_encaisser() from public, anon;
grant execute on function plateforme.releves_a_encaisser() to authenticated;

-- ---------------------------------------------------------------- ce qui s'y branche
drop function plateforme.abonnement_regler(smallint, boolean, smallint, smallint, smallint, text);
create function plateforme.abonnement_regler(p_report_mois smallint, p_annuel_ouvert boolean, p_annuel_mois_offerts smallint, p_essai_jours smallint, p_renouvellement_delai_jours smallint, p_releve_blocage_jours smallint, p_releve_suspension_jours smallint, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       releve_blocage_jours, releve_suspension_jours, motif, decide_par)
    values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, p_essai_jours,
            p_renouvellement_delai_jours, p_releve_blocage_jours, p_releve_suspension_jours,
            p_motif, auth.uid())
    returning id into v_id;
  else
    insert into plateforme.reglages_abonnement
      (report_mois, annuel_ouvert, annuel_mois_offerts, essai_jours, renouvellement_delai_jours,
       releve_blocage_jours, releve_suspension_jours,
       lien_valide_minutes, alerte_lectures_part, motif, decide_par)
    values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, p_essai_jours,
            p_renouvellement_delai_jours, p_releve_blocage_jours, p_releve_suspension_jours,
            v_courant.lien_valide_minutes,
            v_courant.alerte_lectures_part, p_motif, auth.uid())
    returning id into v_id;
  end if;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_abonnement r where r.id = v_id);
end
$function$;
revoke all on function plateforme.abonnement_regler(smallint, boolean, smallint, smallint, smallint, smallint, smallint, text) from public, anon;
grant execute on function plateforme.abonnement_regler(smallint, boolean, smallint, smallint, smallint, smallint, smallint, text) to authenticated;

CREATE OR REPLACE FUNCTION public.abonnement_reglage()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select jsonb_build_object('report_mois', r.report_mois,
                               'annuel_ouvert', r.annuel_ouvert,
                               'annuel_mois_offerts', r.annuel_mois_offerts,
                               'essai_jours', r.essai_jours,
                               'renouvellement_delai_jours', r.renouvellement_delai_jours,
                               'releve_blocage_jours', r.releve_blocage_jours,
                               'releve_suspension_jours', r.releve_suspension_jours,
                               'lien_valide_minutes', r.lien_valide_minutes,
                               'alerte_lectures_part', r.alerte_lectures_part,
                               'motif', r.motif, 'decide_le', r.decide_le)
       from plateforme.reglages_abonnement r
      order by r.decide_le desc, r.id desc limit 1),
    jsonb_build_object('report_mois', 0, 'annuel_ouvert', false, 'annuel_mois_offerts', 0,
                       'essai_jours', 0, 'renouvellement_delai_jours', null,
                       'releve_blocage_jours', null, 'releve_suspension_jours', null,
                       'lien_valide_minutes', null, 'alerte_lectures_part', null,
                       'motif', null, 'decide_le', null))
$function$;

CREATE OR REPLACE FUNCTION public.acces_proposer(p_cabinet uuid, p_client uuid, p_offre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id    uuid;
  v_grille ref.offres;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert'
      using errcode = '42501';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '42501';
  end if;
  -- Un relevé resté impayé passé le délai de la tour : plus de nouvelle attribution (D11).
  if exists (select 1 from facturation.retard_du_releve(p_cabinet) x
              where x.bloque_le <= current_date) then
    raise exception 'refus.abonnement.releve_impaye' using errcode = 'check_violation';
  end if;
  -- La société s'est inscrite seule : son abonnement est le sien. Seule la comptabilité qui
  -- l'a invitée dans Malica peut lui en attribuer un (décision du 23 novembre 2026).
  if not facturation.comptabilite_a_invite(p_cabinet, p_client) then
    raise exception 'refus.abonnement.societe_inscrite_seule' using errcode = '42501';
  end if;
  if exists (select 1 from facturation.acces a
              where a.tenant_id = p_client and a.statut in ('propose', 'actif', 'suspendu')) then
    raise exception 'refus.abonnement.deja_propose'
      using errcode = 'check_violation';
  end if;
  -- Une société rattachée à une licence que la comptabilité paie déjà est
  -- couverte : un second abonnement la ferait payer deux fois.
  if exists (select 1 from facturation.licence_organisations lo
               join facturation.acces a on a.licence_id = lo.licence_id
              where lo.tenant_id = p_client and a.statut = 'actif' and a.canal = 'cabinet') then
    raise exception 'refus.abonnement.couvert_par_la_licence' using errcode = 'check_violation';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;
  insert into facturation.acces
    (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut, propose_le, propose_par)
  values
    (p_client, 'cabinet', p_cabinet, v_grille.code, v_grille.effective_from, 'propose',
     current_date, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_client, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('cabinet', p_cabinet, 'offre', v_grille.code));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('client', p_client, 'offre', v_grille.code,
                             'prix_mensuel_ht', v_grille.prix_mensuel_ht));
  perform notif.emettre(p_client, 'acces.propose', jsonb_build_object('acces_id', v_id, 'offre', v_grille.code,
                             'cabinet', (select name from identity.organizations where id = p_cabinet)));
  return v_id;
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
      -- La comptabilité qui paie cet abonnement n'a pas réglé son relevé dans le délai de la
      -- tour (D11) : l'abonnement est suspendu ; son paiement le rouvre.
      and not exists (select 1 from facturation.releves_cabinet r
                        cross join lateral facturation.retard_du_releve(r.cabinet_id) x
                        join facturation.payeurs_v pv
                          on pv.payeur_type = 'cabinet' and pv.payeur_tenant_id = r.cabinet_id
                         and pv.du <= current_date
                         and (pv.au_exclu is null or pv.au_exclu > current_date)
                        join facturation.licence_organisations lo on lo.licence_id = pv.licence_id
                       where lo.tenant_id = p_tenant and x.releve_id = r.id
                         and x.suspendu_le <= current_date)
  end;
$function$;

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
            WHEN ((p.objet = 'releve'::text) AND (EXISTS ( SELECT 1
               FROM facturation.releve_factures rf
              WHERE (rf.releve_id = p.releve_id)))) THEN 'remplace'::text
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

CREATE OR REPLACE FUNCTION fabrique.facturation_des_cabinets(p_jour date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reglage  plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('cabinets');
  v_dernier  date;
  v_premier  date;
  r          record;
  v_res      jsonb;
  v_cle      text;
  v_demandes integer := 0;
  v_deja     integer := 0;
  v_rien     integer := 0;
  v_releves  jsonb := '[]'::jsonb;
  v_erreurs  jsonb := '[]'::jsonb;
begin
  if not coalesce(v_reglage.actif, false) then
    return jsonb_build_object('etat', 'coupee');
  end if;
  if exists (select 1 from fabrique.facturations_du_jour x
              where x.jour = p_jour and x.decision_id = v_reglage.id) then
    return jsonb_build_object('etat', 'deja_passee', 'decision', v_reglage.id);
  end if;

  v_dernier := (date_trunc('month', p_jour) - interval '1 month')::date;
  v_premier := (date_trunc('month', p_jour) - make_interval(months => v_reglage.rattrapage_mois))::date;

  for r in
    select distinct pv.payeur_tenant_id as cabinet, m.periode::date as periode
      from generate_series(v_premier::timestamp, v_dernier::timestamp, interval '1 month') m(periode)
      join facturation.payeurs_v pv
        on pv.payeur_type = 'cabinet'
       and pv.du < (m.periode + interval '1 month')::date
       and (pv.au_exclu is null or pv.au_exclu > m.periode::date)
     order by 2, 1
  loop
    if exists (select 1 from facturation.releves_cabinet x
                where x.cabinet_id = r.cabinet and x.periode = r.periode)
       or exists (select 1 from facturation.factures x
                where x.payeur_tenant_id = r.cabinet and x.periode = r.periode
                  and x.licence_id is null and x.avoir_de is null) then
      v_deja := v_deja + 1;
      continue;
    end if;
    begin
      -- D8 : le mois écoulé se dit par un relevé, à payer ; la facture naît au paiement.
      v_res := facturation.releve_etablir(r.cabinet, r.periode, v_reglage.decide_par);
      v_demandes := v_demandes + 1;
      v_releves := v_releves || jsonb_build_object(
        'releve_id', v_res -> 'releve_id', 'paiement', v_res -> 'paiement_id',
        'periode', r.periode, 'cabinet', r.cabinet);
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
    (perimetre, jour, decision_id, emises, deja_emises, rien_a_facturer, erreurs, demandes, detail)
  values ('cabinets', p_jour, v_reglage.id, 0, v_deja, v_rien, jsonb_array_length(v_erreurs),
          v_demandes,
          jsonb_build_object('releves', v_releves, 'erreurs', v_erreurs,
                             'mois', jsonb_build_object('du', v_premier, 'au', v_dernier)));

  return jsonb_build_object(
    'etat', 'passee', 'decision', v_reglage.id,
    'emises', 0, 'demandes', v_demandes, 'deja_emises', v_deja, 'rien_a_facturer', v_rien,
    'erreurs', jsonb_array_length(v_erreurs), 'a_payer', v_releves, 'detail_erreurs', v_erreurs);
end
$function$;

CREATE OR REPLACE FUNCTION notif.prevenir_les_abonnements()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- La comptabilité et son relevé impayé (D11) : bloquée, bientôt suspendue, suspendue — le
  -- palier du jour, une fois, à chacun de ses experts.
  for r in
    select x.releve_id, v.cabinet_id, v.periode, v.abonnements, v.montant_ttc, v.devise,
           x.bloque_le, x.suspendu_le,
           (select p.id from facturation.paiements_en_ligne p
             where p.releve_id = v.id order by p.cree_le desc limit 1) as paiement_id
      from facturation.releves_cabinet v
      cross join lateral facturation.retard_du_releve(v.cabinet_id) x
     where x.releve_id = v.id and x.bloque_le <= current_date
  loop
    v_code := case
                when current_date >= r.suspendu_le then 'releve.suspendu'
                when v_ferme is not null and current_date >= r.suspendu_le - v_ferme
                  then 'releve.suspension_proche'
                else 'releve.bloque' end;
    v_cle := 'releve:' || r.releve_id::text || ':' || v_code;
    continue when exists (select 1 from notif.envois x where x.sujet_cle = v_cle and x.code = v_code);
    v_n := v_n + notif.emettre_aux_experts(r.cabinet_id, v_code,
      facturation.donnees_du_releve(r.releve_id), v_cle, interval '400 days');
  end loop;
  return v_n;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.avertir_de_la_facture(p_facture uuid, p_fenetre interval DEFAULT '24:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_reference text;
  f          facturation.factures;
  v_tenant   uuid;
  v_ttc      text;
  v_reglee   boolean;
  v_n        integer := 0;
begin
  select x.* into f from facturation.factures x where x.id = p_facture;
  if f.id is null or f.payeur_type not in ('titulaire', 'cabinet') then
    return 0;
  end if;
  v_ttc := facturation.montant_en_texte(f.montant_ttc, f.devise);

  -- La facture du mois d'une comptabilité : à chacun de ses experts, en application et par
  -- courriel. Une ligne par société et par offre ; on dit combien d'abonnements elle porte.
  if f.payeur_type = 'cabinet' then
    -- Née du paiement de son relevé (D8), elle est réglée : son avis est aussi le reçu.
    v_reglee := exists (select 1 from facturation.encours_v e
                         where e.facture_id = f.id and e.etat = 'payee');
    v_n := notif.emettre_aux_experts(
      f.payeur_tenant_id,
      case when v_reglee then 'facture.reglee.cabinet' else 'facture.emise.cabinet' end,
      jsonb_build_object(
        'facture_id',  f.id,
        'numero',      f.numero,
        'periode',     to_char(f.periode, 'MM/YYYY'),
        'abonnements', f.organisations::text,
        'ttc',         v_ttc,
        'devise',      f.devise,
        'echeance',    to_char(f.echeance_le, 'DD/MM/YYYY'),
        'reference',   coalesce((select string_agg(distinct e.reference, ', ' order by e.reference)
                                   from facturation.encaissements e where e.facture_id = f.id),
                                '—')),
      'facture:' || f.id::text,
      p_fenetre);
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

  -- Une facture née d'un paiement est aussi son reçu (comme Anthropic : un seul courriel) :
  -- elle dit la référence du paiement qui l'a réglée.
  v_reference := coalesce((select string_agg(distinct e.reference, ', ' order by e.reference)
                             from facturation.encaissements e where e.facture_id = f.id),
                           nullif(current_setting('malica.reference_du_paiement', true), ''),
                           '—');

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
        'devise',     f.devise,
        'reference',  v_reference),
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
      'echeance',   to_char(f.echeance_le, 'DD/MM/YYYY'),
      'reference',  v_reference),
    f.payeur_personne,
    'facture:' || f.id::text,
    p_fenetre);
end
$function$;

CREATE OR REPLACE FUNCTION facturation.avertir_du_paiement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p          facturation.paiements_en_ligne;
  v_tenant   uuid;
  v_exposant smallint;
begin
  if new.etat <> 'paye'
     or not exists (select 1 from facturation.prestataires_paiement pp
                     where pp.code = new.prestataire and pp.fait_entrer_argent) then
    return new;
  end if;
  select * into p from facturation.paiements_en_ligne where id = new.paiement_id;
  -- La PME dont le paiement a fait naître sa facture, réglée en entier : le courriel de la
  -- facture est son reçu. Un seul courriel par paiement.
  if (p.payeur_tenant_id is null and p.objet in ('montee_demandee', 'recharge')
      or p.objet = 'releve')
     and p.montant_ttc <= coalesce((select sum(en.montant)
                                      from facturation.paiement_imputations i
                                      join facturation.encaissements en on en.id = i.encaissement_id
                                     where i.paiement_id = p.id), 0) then
    return new;
  end if;
  v_tenant := coalesce(p.payeur_tenant_id,
                       facturation.societe_facturee(p.licence_id));
  select d.exposant into v_exposant from ref.devises d where d.code = p.devise;
  perform notif.emettre(
    v_tenant,
    -- La comptabilité qui paie la facture de ses clients : son bouton mène à SA facturation.
    case when p.payeur_tenant_id is not null then 'paiement.recu.cabinet' else 'paiement.recu' end,
    jsonb_build_object(
      'paiement_id', p.id,
      'objet',       p.libelle,
      'ttc',         to_char(p.montant_ttc, 'FM999G999G990'
                       || case when coalesce(v_exposant, 0) > 0
                               then 'D' || repeat('0', v_exposant) else '' end),
      'devise',      p.devise,
      'reference',   coalesce(new.reference, p.id::text),
      'le',          to_char(new.le, 'DD/MM/YYYY')),
    p.cree_par,
    'paiement:' || p.id::text);
  return new;
end
$function$;

-- ---------------------------------------------------------------- les avis
insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, effective_from, ton)
values
  ('releve.cabinet', 'app', 'fr', null, 'Votre relevé de {{periode}}',
   'Abonnements : {{abonnements}}. {{ttc}} {{devise}} TTC à régler, en ligne ou par virement. La facture naît au paiement.',
   'Payer', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('releve.cabinet', 'email', 'fr', 'Malica Office — votre relevé de {{periode}}', 'Votre relevé de {{periode}}',
   'Les abonnements de vos clients pour {{periode}} (abonnements : {{abonnements}}), et chaque passage d''offre du mois : {{ttc}} {{devise}} TTC. Réglez en ligne, en un clic depuis ce message, ou par virement du montant exact (coordonnées bancaires dans votre espace, rubrique Facturation). Votre facture naît au paiement, déjà réglée. Sans paiement avant le {{bloque}}, les nouvelles attributions seront fermées.',
   'Payer en ligne', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('releve.cabinet', 'app', 'en', null, 'Your statement for {{periode}}',
   'Subscriptions: {{abonnements}}. {{ttc}} {{devise}} incl. VAT to pay, online or by bank transfer. The invoice is issued on payment.',
   'Pay', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('releve.cabinet', 'email', 'en', 'Malica Office — your statement for {{periode}}', 'Your statement for {{periode}}',
   'Your clients'' subscriptions for {{periode}} (subscriptions: {{abonnements}}), and each plan change of the month: {{ttc}} {{devise}} incl. VAT. Pay online, in one click from this message, or by bank transfer of the exact amount (bank details in your space, under Billing). Your invoice is issued on payment, already settled. Without payment before {{bloque}}, new assignments will be closed.',
   'Pay online', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('releve.cabinet', 'app', 'ar', null, 'كشفكم لشهر {{periode}}',
   'الاشتراكات: {{abonnements}}. {{ttc}} {{devise}} شامل الأداء للدفع، عبر الإنترنت أو بتحويل بنكي. تصدر الفاتورة عند الدفع.',
   'الدفع', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('releve.cabinet', 'email', 'ar', 'Malica Office — كشفكم لشهر {{periode}}', 'كشفكم لشهر {{periode}}',
   'اشتراكات حرفائكم لشهر {{periode}} (الاشتراكات: {{abonnements}})، وكل تغيير عرض خلال الشهر: {{ttc}} {{devise}} شامل الأداء. ادفعوا عبر الإنترنت بنقرة واحدة من هذه الرسالة، أو بتحويل بنكي بالمبلغ نفسه (البيانات البنكية في فضائكم، قسم الفوترة). تصدر فاتورتكم عند الدفع، خالصة. دون دفع قبل {{bloque}}، تُغلق الإسنادات الجديدة.',
   'الدفع عبر الإنترنت', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'en_cours'),
  ('releve.bloque', 'app', 'fr', null, 'Relevé de {{periode}} impayé : attributions fermées',
   '{{ttc}} {{devise}} TTC restent à régler. Sans paiement avant le {{suspension}}, les abonnements de vos clients seront suspendus.',
   'Payer', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.bloque', 'email', 'fr', 'Malica Office — relevé de {{periode}} impayé', 'Les nouvelles attributions sont fermées',
   'Votre relevé de {{periode}} ({{ttc}} {{devise}} TTC) n''est pas réglé : vous ne pouvez plus attribuer de nouvel abonnement. Sans paiement avant le {{suspension}}, les abonnements que vous payez pour vos clients seront suspendus. Le paiement rouvre tout, aussitôt.',
   'Payer en ligne', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.bloque', 'app', 'en', null, 'Statement for {{periode}} unpaid: assignments closed',
   '{{ttc}} {{devise}} incl. VAT still to pay. Without payment before {{suspension}}, your clients'' subscriptions will be suspended.',
   'Pay', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.bloque', 'email', 'en', 'Malica Office — statement for {{periode}} unpaid', 'New assignments are closed',
   'Your statement for {{periode}} ({{ttc}} {{devise}} incl. VAT) is not paid: you can no longer assign a new subscription. Without payment before {{suspension}}, the subscriptions you pay for your clients will be suspended. Payment reopens everything at once.',
   'Pay online', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.bloque', 'app', 'ar', null, 'كشف {{periode}} غير مدفوع: الإسنادات مغلقة',
   '{{ttc}} {{devise}} شامل الأداء لم تُدفع بعد. دون دفع قبل {{suspension}}، تُعلَّق اشتراكات حرفائكم.',
   'الدفع', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.bloque', 'email', 'ar', 'Malica Office — كشف {{periode}} غير مدفوع', 'الإسنادات الجديدة مغلقة',
   'كشفكم لشهر {{periode}} ({{ttc}} {{devise}} شامل الأداء) لم يُدفع: لا يمكنكم إسناد اشتراك جديد. دون دفع قبل {{suspension}}، تُعلَّق الاشتراكات التي تدفعونها عن حرفائكم. الدفع يعيد فتح كل شيء فوراً.',
   'الدفع عبر الإنترنت', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.suspension_proche', 'app', 'fr', null, 'Suspension le {{suspension}}',
   'Relevé de {{periode}} : {{ttc}} {{devise}} TTC à régler avant cette date pour garder les abonnements de vos clients ouverts.',
   'Payer', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.suspension_proche', 'email', 'fr', 'Malica Office — suspension le {{suspension}}', 'Les abonnements de vos clients seront suspendus le {{suspension}}',
   'Votre relevé de {{periode}} ({{ttc}} {{devise}} TTC) n''est toujours pas réglé. Le {{suspension}}, les abonnements que vous payez pour vos clients seront suspendus : ils ne pourront plus utiliser Malica Office. Réglez avant cette date pour l''éviter.',
   'Payer en ligne', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.suspension_proche', 'app', 'en', null, 'Suspension on {{suspension}}',
   'Statement for {{periode}}: {{ttc}} {{devise}} incl. VAT to pay before that date to keep your clients'' subscriptions open.',
   'Pay', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.suspension_proche', 'email', 'en', 'Malica Office — suspension on {{suspension}}', 'Your clients'' subscriptions will be suspended on {{suspension}}',
   'Your statement for {{periode}} ({{ttc}} {{devise}} incl. VAT) is still not paid. On {{suspension}}, the subscriptions you pay for your clients will be suspended: they will no longer be able to use Malica Office. Pay before that date to avoid it.',
   'Pay online', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.suspension_proche', 'app', 'ar', null, 'التعليق يوم {{suspension}}',
   'كشف {{periode}}: {{ttc}} {{devise}} شامل الأداء تُدفع قبل هذا التاريخ لتبقى اشتراكات حرفائكم مفتوحة.',
   'الدفع', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.suspension_proche', 'email', 'ar', 'Malica Office — التعليق يوم {{suspension}}', 'ستُعلَّق اشتراكات حرفائكم يوم {{suspension}}',
   'كشفكم لشهر {{periode}} ({{ttc}} {{devise}} شامل الأداء) لم يُدفع بعد. يوم {{suspension}} تُعلَّق الاشتراكات التي تدفعونها عن حرفائكم: لن يتمكنوا من استعمال Malica Office. ادفعوا قبل هذا التاريخ لتفادي ذلك.',
   'الدفع عبر الإنترنت', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'alerte'),
  ('releve.suspendu', 'app', 'fr', null, 'Abonnements de vos clients suspendus',
   'Relevé de {{periode}} impayé : {{ttc}} {{devise}} TTC. Le paiement les rouvre aussitôt.',
   'Payer', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('releve.suspendu', 'email', 'fr', 'Malica Office — abonnements suspendus', 'Les abonnements de vos clients sont suspendus',
   'Votre relevé de {{periode}} ({{ttc}} {{devise}} TTC) n''a pas été réglé : les abonnements que vous payez pour vos clients sont suspendus. Rien n''est perdu. Le paiement du relevé les rouvre aussitôt.',
   'Payer en ligne', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('releve.suspendu', 'app', 'en', null, 'Your clients'' subscriptions are suspended',
   'Statement for {{periode}} unpaid: {{ttc}} {{devise}} incl. VAT. Payment reopens them at once.',
   'Pay', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('releve.suspendu', 'email', 'en', 'Malica Office — subscriptions suspended', 'Your clients'' subscriptions are suspended',
   'Your statement for {{periode}} ({{ttc}} {{devise}} incl. VAT) has not been paid: the subscriptions you pay for your clients are suspended. Nothing is lost. Paying the statement reopens them at once.',
   'Pay online', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('releve.suspendu', 'app', 'ar', null, 'اشتراكات حرفائكم معلَّقة',
   'كشف {{periode}} غير مدفوع: {{ttc}} {{devise}} شامل الأداء. الدفع يعيد فتحها فوراً.',
   'الدفع', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('releve.suspendu', 'email', 'ar', 'Malica Office — اشتراكات معلَّقة', 'اشتراكات حرفائكم معلَّقة',
   'كشفكم لشهر {{periode}} ({{ttc}} {{devise}} شامل الأداء) لم يُدفع: الاشتراكات التي تدفعونها عن حرفائكم معلَّقة. لم يضع شيء. دفع الكشف يعيد فتحها فوراً.',
   'الدفع عبر الإنترنت', '/cabinet/payer/{{paiement_id}}', date '2026-11-25', 'erreur'),
  ('facture.reglee.cabinet', 'app', 'fr', null, 'Facture {{numero}} réglée',
   'Relevé de {{periode}} : {{ttc}} {{devise}} TTC, réglés. Rien ne reste à payer.',
   null, null, date '2026-11-25', 'succes'),
  ('facture.reglee.cabinet', 'email', 'fr', 'Malica Office — facture {{numero}} réglée', 'Votre facture {{numero}} est réglée',
   'Votre relevé de {{periode}} est réglé : {{ttc}} {{devise}} TTC (abonnements : {{abonnements}}). Rien ne reste à payer. Référence du paiement : {{reference}}. La facture {{numero}} se télécharge en PDF dans votre espace, rubrique Facturation.',
   'Voir la facture', '/cabinet/facture/{{facture_id}}', date '2026-11-25', 'succes'),
  ('facture.reglee.cabinet', 'app', 'en', null, 'Invoice {{numero}} paid',
   'Statement for {{periode}}: {{ttc}} {{devise}} incl. VAT, paid. Nothing is left to pay.',
   null, null, date '2026-11-25', 'succes'),
  ('facture.reglee.cabinet', 'email', 'en', 'Malica Office — invoice {{numero}} paid', 'Your invoice {{numero}} is paid',
   'Your statement for {{periode}} is paid: {{ttc}} {{devise}} incl. VAT (subscriptions: {{abonnements}}). Nothing is left to pay. Payment reference: {{reference}}. Invoice {{numero}} can be downloaded as a PDF from your space, under Billing.',
   'View the invoice', '/cabinet/facture/{{facture_id}}', date '2026-11-25', 'succes'),
  ('facture.reglee.cabinet', 'app', 'ar', null, 'الفاتورة {{numero}} مدفوعة',
   'كشف {{periode}}: {{ttc}} {{devise}} شامل الأداء، مدفوعة. لم يبقَ شيء للدفع.',
   null, null, date '2026-11-25', 'succes'),
  ('facture.reglee.cabinet', 'email', 'ar', 'Malica Office — الفاتورة {{numero}} مدفوعة', 'فاتورتكم {{numero}} مدفوعة',
   'كشفكم لشهر {{periode}} مدفوع: {{ttc}} {{devise}} شامل الأداء (الاشتراكات: {{abonnements}}). لم يبقَ شيء للدفع. مرجع الدفع: {{reference}}. تُنزَّل الفاتورة {{numero}} بصيغة PDF من فضائكم، قسم الفوترة.',
   'عرض الفاتورة', '/cabinet/facture/{{facture_id}}', date '2026-11-25', 'succes');

insert into notif.diffusions (code, canal, gabarit, valid_from) values
  ('releve.cabinet', 'email', 'releve.cabinet', date '2026-11-25'),
  ('releve.bloque', 'email', 'releve.bloque', date '2026-11-25'),
  ('releve.suspension_proche', 'email', 'releve.suspension_proche', date '2026-11-25'),
  ('releve.suspendu', 'email', 'releve.suspendu', date '2026-11-25'),
  ('facture.reglee.cabinet', 'email', 'facture.reglee.cabinet', date '2026-11-25');

insert into notif.cartes_courriel (code, rang, genre, libelle_cle, valeur_cle) values
  ('releve.cabinet', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('releve.cabinet', 2, 'ligne', 'donnee.abonnements', 'valeur.abonnements'),
  ('releve.bloque', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('releve.bloque', 2, 'ligne', 'donnee.abonnements', 'valeur.abonnements'),
  ('releve.suspension_proche', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('releve.suspension_proche', 2, 'ligne', 'donnee.abonnements', 'valeur.abonnements'),
  ('releve.suspendu', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('releve.suspendu', 2, 'ligne', 'donnee.abonnements', 'valeur.abonnements'),
  ('facture.reglee.cabinet', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('facture.reglee.cabinet', 2, 'ligne', 'donnee.facture', 'valeur.numero'),
  ('facture.reglee.cabinet', 3, 'ligne', 'donnee.reference', 'valeur.reference');

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('apercu.releve.cabinet', 'fr', 'Relevé de {{periode}} : {{ttc}} {{devise}} TTC.', date '2026-11-25'),
  ('apercu.releve.cabinet', 'en', 'Statement for {{periode}}: {{ttc}} {{devise}} incl. VAT.', date '2026-11-25'),
  ('apercu.releve.cabinet', 'ar', 'كشف {{periode}}: {{ttc}} {{devise}} شامل الأداء.', date '2026-11-25'),
  ('apercu.releve.bloque', 'fr', 'Relevé impayé : les nouvelles attributions sont fermées.', date '2026-11-25'),
  ('apercu.releve.bloque', 'en', 'Unpaid statement: new assignments are closed.', date '2026-11-25'),
  ('apercu.releve.bloque', 'ar', 'كشف غير مدفوع: الإسنادات الجديدة مغلقة.', date '2026-11-25'),
  ('apercu.releve.suspension_proche', 'fr', 'Relevé impayé : suspension le {{suspension}}.', date '2026-11-25'),
  ('apercu.releve.suspension_proche', 'en', 'Unpaid statement: suspension on {{suspension}}.', date '2026-11-25'),
  ('apercu.releve.suspension_proche', 'ar', 'كشف غير مدفوع: التعليق يوم {{suspension}}.', date '2026-11-25'),
  ('apercu.releve.suspendu', 'fr', 'Relevé impayé : abonnements suspendus.', date '2026-11-25'),
  ('apercu.releve.suspendu', 'en', 'Unpaid statement: subscriptions suspended.', date '2026-11-25'),
  ('apercu.releve.suspendu', 'ar', 'كشف غير مدفوع: اشتراكات معلَّقة.', date '2026-11-25'),
  ('apercu.facture.reglee.cabinet', 'fr', 'Facture {{numero}} : {{ttc}} {{devise}} TTC, réglés.', date '2026-11-25'),
  ('apercu.facture.reglee.cabinet', 'en', 'Invoice {{numero}}: {{ttc}} {{devise}} incl. VAT, paid.', date '2026-11-25'),
  ('apercu.facture.reglee.cabinet', 'ar', 'الفاتورة {{numero}}: {{ttc}} {{devise}} شامل الأداء، مدفوعة.', date '2026-11-25');

-- ---------------------------------------------------------------- rembourser un solde
-- Un solde créditeur que rien n'attend (un relevé payé deux fois, un client parti) se
-- rembourse à la banque ou chez le prestataire ; la tour l'inscrit ici, et il cesse de
-- compter. Toute personne de la tour, avec la référence du remboursement et son motif.
create table facturation.remboursements (
  id           uuid primary key default gen_random_uuid(),
  paiement_id  uuid references facturation.paiements_en_ligne(id),
  double_id    uuid references facturation.paiements_en_double(id),
  montant      app.money_t not null check (montant > 0),
  devise       text not null references ref.devises(code),
  reference    text not null check (length(btrim(reference)) > 0),
  motif        text not null check (length(btrim(motif)) > 0),
  saisi_par    uuid not null,
  created_at   timestamptz not null default now(),
  constraint remboursements_une_source check ((paiement_id is not null) <> (double_id is not null))
);
create index remboursements_paiement_idx on facturation.remboursements (paiement_id);
create index remboursements_double_idx on facturation.remboursements (double_id);
alter table facturation.remboursements enable row level security;
revoke all on facturation.remboursements from public, anon, authenticated;
create trigger remboursements_ne_se_reecrivent_pas before update or delete on facturation.remboursements
  for each row execute function app.deny_mutation();

create function facturation.rembourse_sur(p_paiement uuid, p_double uuid)
 returns numeric
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select coalesce(sum(r.montant), 0)
    from facturation.remboursements r
   where (p_paiement is not null and r.paiement_id = p_paiement)
      or (p_double is not null and r.double_id = p_double)
$$;
revoke all on function facturation.rembourse_sur(uuid, uuid) from public, anon, authenticated;

-- D'où vient un solde : chaque paiement ou double paiement, et ce qu'il en reste (ni imputé
-- à une facture, ni remboursé). D'une licence, ou d'une comptabilité.
create function facturation.sources_de_solde(p_licence uuid, p_cabinet uuid)
 returns table (paiement_id uuid, double_id uuid, reste numeric, devise text, depuis timestamptz)
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select p.id, null::uuid,
         p.montant_ttc - coalesce(deja.montant, 0) - facturation.rembourse_sur(p.id, null),
         p.devise, p.cree_le
    from facturation.paiements_en_ligne p
    left join lateral (select sum(en.montant) as montant
                         from facturation.paiement_imputations i
                         join facturation.encaissements en on en.id = i.encaissement_id
                        where i.paiement_id = p.id) deja on true
   where p_licence is not null and p.licence_id = p_licence
     and p.objet <> 'facture'
     and p.montant_ttc > coalesce(deja.montant, 0) + facturation.rembourse_sur(p.id, null)
     and exists (select 1 from facturation.paiement_evenements e
                   join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                            and pp.fait_entrer_argent
                  where e.paiement_id = p.id and e.etat = 'paye')
  union all
  select null::uuid, x.id,
         x.montant - coalesce(deja.montant, 0) - facturation.rembourse_sur(null, x.id),
         x.devise, x.constate_le
    from facturation.paiements_en_double x
    left join lateral (select sum(en.montant) as montant
                         from facturation.double_imputations i
                         join facturation.encaissements en on en.id = i.encaissement_id
                        where i.double_id = x.id) deja on true
   where ((p_licence is not null and x.licence_id = p_licence)
       or (p_cabinet is not null and x.payeur_tenant_id = p_cabinet))
     and x.montant > coalesce(deja.montant, 0) + facturation.rembourse_sur(null, x.id)
$$;
revoke all on function facturation.sources_de_solde(uuid, uuid) from public, anon, authenticated;

create or replace function facturation.solde_crediteur(p_licence uuid)
 returns numeric
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select coalesce(sum(s.reste), 0) from facturation.sources_de_solde(p_licence, null) s
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
       and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id)
       -- Payer d'avance (25 novembre 2026) : une recharge qui a son paiement se facture à ce
       -- paiement, jamais sur une base ; seules celles d'avant (sans paiement) y restent.
       and not exists (select 1 from facturation.paiements_en_ligne pr where pr.recharge_id = x.id);
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
         and not exists (select 1 from facturation.paiements_en_ligne pr where pr.recharge_id = x.id)
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
                            where i.paiement_id = p.id) impute on true
        left join lateral (select coalesce(impute.montant, 0)
                                  + facturation.rembourse_sur(p.id, null) as montant) deja on true
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

    -- Puis l'argent reçu en double (un second lien payé, 8.3) : un solde créditeur, appliqué.
    for v_paiement in
      select x.id, x.montant - coalesce(deja.montant, 0) as reste, x.reference, x.prestataire,
             x.constate_le::date as le, facturation.moyen_encaissement_du_paiement(x.paiement_id) as moyen
        from facturation.paiements_en_double x
        left join lateral (select sum(en.montant) as montant
                             from facturation.double_imputations i
                             join facturation.encaissements en on en.id = i.encaissement_id
                            where i.double_id = x.id) impute on true
        left join lateral (select coalesce(impute.montant, 0)
                                  + facturation.rembourse_sur(null, x.id) as montant) deja on true
       where x.licence_id = p_licence
         and x.montant > coalesce(deja.montant, 0)
       order by x.constate_le, x.id
    loop
      v_impute := least(v_paiement.reste,
                        (select e.reste_du from facturation.encours_v e where e.facture_id = v_id));
      exit when v_impute <= 0;
      insert into facturation.encaissements
        (facture_id, montant, moyen, reference, encaisse_le, saisi_par)
      values (v_id, v_impute, v_paiement.moyen, v_paiement.prestataire || ' ' || v_paiement.reference,
              v_paiement.le, coalesce(auth.uid(), p_acteur))
      returning id into v_enc;
      insert into facturation.double_imputations (double_id, encaissement_id)
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

-- La tour voit l'argent qui attend, des licences comme des comptabilités.
drop function plateforme.soldes_crediteurs();
create function plateforme.soldes_crediteurs()
 returns table (licence_id uuid, cabinet_id uuid, societe text, titulaire text, solde numeric,
                devise text, doubles integer, depuis timestamptz)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return query
    select l.id, null::uuid, o.name::text, coalesce(pr.display_name, '')::text, s.solde,
           s.devise, s.doubles, s.depuis
      from facturation.licences l
      cross join lateral (select sum(x.reste) as solde, min(x.devise) as devise,
                                 count(x.double_id)::integer as doubles, min(x.depuis) as depuis
                            from facturation.sources_de_solde(l.id, null) x) s
      left join identity.organizations o on o.id = facturation.societe_facturee(l.id)
      left join identity.profiles pr on pr.user_id = l.titulaire
     where s.solde > 0
    union all
    select null::uuid, c.id, c.name::text, ''::text, s.solde, s.devise, s.doubles, s.depuis
      from identity.organizations c
      cross join lateral (select sum(x.reste) as solde, min(x.devise) as devise,
                                 count(x.double_id)::integer as doubles, min(x.depuis) as depuis
                            from facturation.sources_de_solde(null, c.id) x) s
     where c.id in (select d.payeur_tenant_id from facturation.paiements_en_double d
                     where d.payeur_tenant_id is not null)
       and s.solde > 0
     order by 5 desc;
end
$function$;
revoke all on function plateforme.soldes_crediteurs() from public, anon;
grant execute on function plateforme.soldes_crediteurs() to authenticated;

create function plateforme.solde_rembourser(p_licence uuid, p_cabinet uuid, p_reference text,
                                            p_motif text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  s        record;
  v_total  numeric := 0;
  v_devise text;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if (p_licence is null) = (p_cabinet is null)
     or coalesce(btrim(p_reference), '') = '' or coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.saisie.incomplete' using errcode = 'check_violation';
  end if;
  for s in select * from facturation.sources_de_solde(p_licence, p_cabinet) loop
    insert into facturation.remboursements
      (paiement_id, double_id, montant, devise, reference, motif, saisi_par)
    values (s.paiement_id, s.double_id, s.reste, s.devise, btrim(p_reference), btrim(p_motif),
            auth.uid());
    v_total := v_total + s.reste;
    v_devise := s.devise;
  end loop;
  if v_total = 0 then
    raise exception 'refus.solde.aucun' using errcode = 'check_violation';
  end if;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (coalesce(p_cabinet, facturation.societe_facturee(p_licence)), auth.uid(),
          'solde.rembourse', 'facturation', 'remboursements', coalesce(p_licence, p_cabinet),
          jsonb_build_object('montant', v_total, 'devise', v_devise,
                             'reference', btrim(p_reference), 'motif', btrim(p_motif)));
  -- Ce qui était dû se rechiffre sans le solde rendu.
  if p_licence is not null
     and exists (select 1 from facturation.demande_due_ouverte(p_licence)) then
    -- Au jour de la demande au plus tôt : ce qu'elle a chiffré ce jour-là se rechiffre.
    perform facturation.du_a_payer(
      p_licence,
      greatest((now() at time zone plateforme.fuseau_de_la_plateforme())::date,
               (select d.le from facturation.montees_demandees d
                  join facturation.demande_due_ouverte(p_licence) o on o.demande_id = d.id)),
      auth.uid());
  end if;
  return jsonb_build_object('montant', v_total, 'devise', v_devise);
end
$function$;
revoke all on function plateforme.solde_rembourser(uuid, uuid, text, text) from public, anon;
grant execute on function plateforme.solde_rembourser(uuid, uuid, text, text) to authenticated;

commit;
