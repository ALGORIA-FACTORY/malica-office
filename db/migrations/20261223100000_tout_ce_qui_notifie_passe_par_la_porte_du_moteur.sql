-- Tout ce qui notifie passe par la porte du moteur.
--
-- Suite de 20261223090000. Vingt-cinq fonctions écrivaient chacune dans
-- `collab.notifications`, sans retenue ni destinataire : elles appellent
-- désormais `notif.emettre`, qui décide UNE fois qui reçoit (la règle de lecture
-- de l'ancien fil, rejouée par personne), écrit une ligne par destinataire, et
-- pose le courriel ou le push que la table `notif.diffusions` prévoit.
--
-- Le corps de chaque fonction est celui qui était vivant en base ; seul change
-- l'appel qui notifie. Le propriétaire, les droits et l'appelant sont inchangés
-- (`create or replace` les conserve).
--
-- Trois autres changent de nature, parce que l'ancien fil se réécrivait :
--   - « lue » et « tranchée » deviennent des faits de plus dans `notif.suites` ;
--   - la relance d'impayé passe par la même porte que le reste ;
--   - `app.notifier_les_receveurs` adresse à chaque receveur du circuit.
--
-- Cette migration ne retire rien : la suivante reprend l'ancien fil et le retire.

begin;

-- app.annulation_contre_passe_le_reglement
CREATE OR REPLACE FUNCTION app.annulation_contre_passe_le_reglement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_original socle.ecritures%rowtype;
 v_reversal uuid;
begin
 if new.annule_paiement_id is null then return new; end if;
 if not exists (select 1 from capture.paiements p where p.id = new.annule_paiement_id
                  and p.tenant_id = new.tenant_id and p.piece_id = new.piece_id
                  and p.devise = new.devise and p.montant_mineur is not distinct from new.montant_mineur
                  and p.annule_paiement_id is null) then
   raise exception 'refus.ecriture.annulation_du_reglement' using errcode = '22023';
 end if;
 perform 1 from capture.pieces where id = new.piece_id for update;
 for v_original in
   select e.* from socle.ecritures e
    where e.paiement_id = new.annule_paiement_id and e.nature = 'reglement'
      and app.ecriture_vivante(e.id)
 loop
   insert into socle.ecritures
     (tenant_id, entity_id, piece_id, vis, journal, date_ecriture, devise, libelle,
      pack_version_id, status, reverses_id, nature, paiement_id, reversal_reason_id)
   values (v_original.tenant_id, v_original.entity_id, v_original.piece_id,
           v_original.vis, v_original.journal, current_date, v_original.devise,
           'Annulation du règlement — ' || v_original.libelle, v_original.pack_version_id,
           'proposee', v_original.id, 'reglement', new.annule_paiement_id,
           (select id from ref.rejet_motifs where code = 'reglement_annule'))
   returning id into v_reversal;
   insert into socle.ecriture_lignes
     (tenant_id, ecriture_id, ordinal, account_code, libelle, debit, credit, tax_code)
   select tenant_id, v_reversal, ordinal, account_code,
          'Annulation — ' || libelle, credit, debit, tax_code
     from socle.ecriture_lignes where ecriture_id = v_original.id;
   -- Revue du 24 octobre 2026 (décision de Wissem Barouni) : quand une
   -- comptabilité tient le dossier, c'est son expert qui inscrit. La
   -- contre-passation reste PROPOSÉE dans sa file ; la PME ne touche pas au
   -- grand livre qu'elle a confié. Une PME autonome tient seule ses comptes :
   -- elle inscrit, par le même chemin que toute écriture.
   if not exists (select 1 from identity.engagements g
                   where g.pme_org_id = new.tenant_id and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on)) then
     perform public.socle_ecriture_book(v_reversal);
   else
     -- La file du cabinet l'apprend : l'annulation attend son geste.
     perform notif.emettre(new.tenant_id, 'ecriture.proposed', jsonb_build_object('piece_id', new.piece_id, 'ecriture_id', v_reversal,
                                'motif', 'reglement_annule'));
   end if;
   insert into audit.event_log
     (tenant_id, actor, action, object_schema, object_table, object_id, payload)
   values (new.tenant_id, auth.uid(), 'reglement.contre_passe', 'socle', 'ecritures',
           v_reversal, jsonb_build_object('original', v_original.id,
             'paiement', new.annule_paiement_id, 'motif', new.annulation_motif_id));
 end loop;
 return new;
end $function$;

-- app.consigner_le_changement_de_comptabilite
CREATE OR REPLACE FUNCTION app.consigner_le_changement_de_comptabilite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_avant   record;
  v_payload jsonb;
  -- La personne qui fait le geste ; à défaut (une reprise d'administration),
  -- celle qui a créé le mandat. Sans personne, il n'y a pas de geste à consigner.
  v_acteur  uuid := coalesce(auth.uid(), new.created_by);
begin
  if new.status <> 'actif' or old.status = 'actif' or v_acteur is null then
    return null;
  end if;
  select * into v_avant from app.comptabilite_precedente(new.pme_org_id, new.cabinet_org_id);
  if v_avant.cabinet is null then
    return null;
  end if;

  v_payload := jsonb_build_object(
    'jour', current_date,
    'pme_org_id', new.pme_org_id,
    'client', (select o.name from identity.organizations o where o.id = new.pme_org_id),
    'precedente_org_id', v_avant.cabinet,
    'precedente', (select o.name from identity.organizations o where o.id = v_avant.cabinet),
    'precedente_jusqu_au', v_avant.fin,
    'nouvelle_org_id', new.cabinet_org_id,
    'nouvelle', (select o.name from identity.organizations o where o.id = new.cabinet_org_id));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  select t, v_acteur, 'mandat.changement_de_comptabilite', 'identity', 'engagements', new.id,
         v_payload
    from unnest(array[new.pme_org_id, v_avant.cabinet, new.cabinet_org_id]) t;

  -- L'ancienne l'apprend chez elle ; la nouvelle reçoit le modèle de lettre.
  perform notif.emettre(v_avant.cabinet, 'mandat.succede', v_payload);
  perform notif.emettre(new.cabinet_org_id, 'mandat.lettre_au_confrere', v_payload);
  return null;
end
$function$;

-- facturation.emission_du_cabinet
CREATE OR REPLACE FUNCTION facturation.emission_du_cabinet(p_cabinet uuid, p_periode date, p_acteur uuid, p_jours_echeance integer DEFAULT 15)
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
  perform notif.emettre(p_cabinet, 'facture.emise', jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'ttc', v_ht + v_tva + v_timbre));

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'lignes', v_nb,
                            'ht', v_ht, 'ttc', v_ht + v_tva + v_timbre);
end
$function$;

-- public.acces_arreter
create or replace function public.acces_arreter(p_acces uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v facturation.acces;
  v_courante text;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.canal <> 'cabinet'
     or not app.has_org_role(v.cabinet_tenant_id, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v.statut not in ('propose', 'actif', 'suspendu') then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  update facturation.acces_descentes
     set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
   where tenant_id = v.tenant_id and statut = 'propose';
  if v.statut = 'propose' then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'retrait_cabinet'
     where id = v.id;
    return jsonb_build_object('acces_id', v.id, 'effet', 'retiree');
  end if;
  update facturation.acces
     set statut = 'termine', effet_au = current_date, motif_fin = 'retrait_cabinet'
   where id = v.id;
  -- L'alerte dit l'offre que le client garde, pas celle que la comptabilité couvrait : monté en
  -- Premium à sa charge, il continue en Premium (recette du 13 novembre, B6).
  select f.offre_code into v_courante
    from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'acces.arrete', 'facturation', 'acces', v.id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'offre', coalesce(v_courante, v.offre_code),
                             'offre_couverte', v.offre_code));
  perform notif.emettre(v.tenant_id, 'acces.arrete', jsonb_build_object('acces_id', v.id, 'offre', coalesce(v_courante, v.offre_code),
                             'offre_couverte', v.offre_code,
                             'cabinet', (select name from identity.organizations where id = v.cabinet_tenant_id)));
  return jsonb_build_object('acces_id', v.id, 'effet', 'rendu_au_dirigeant');
end
$$;

-- public.acces_changer_offre
create or replace function public.acces_changer_offre(p_acces uuid, p_offre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        facturation.acces;
  v_grille ref.offres;
  v_regle  ref.offres_par_canal;
  v_id     uuid;
  v_rang_a smallint;
  v_rang_o smallint;
  v_forfait text;
  v_nom    text;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.canal <> 'cabinet'
     or not app.has_org_role(v.cabinet_tenant_id, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v.statut not in ('propose', 'actif') then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;
  v_regle := ref.canal_offre_a('cabinet', v_grille.code, current_date);
  if v_regle.canal is null or not v_regle.cabinet_peut_ouvrir then
    raise exception '%', app.refus_avec_valeurs('refus.offre.pas_par_un_cabinet', 'offre', v_grille.code)
      using errcode = 'check_violation';
  end if;
  if v_grille.code = v.offre_code then
    return jsonb_build_object('acces_id', v.id, 'effet', 'inchange');
  end if;
  v_nom := (select name from identity.organizations where id = v.cabinet_tenant_id);

  -- Le dirigeant n'a pas encore rejoint (A2) : la proposition change, rien ne se facture.
  if v.statut = 'propose' then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'changement_offre', licence_id = null
     where id = v.id;
    insert into facturation.acces
      (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
       propose_le, propose_par)
    values
      (v.tenant_id, 'cabinet', v.cabinet_tenant_id, v_grille.code, v_grille.effective_from,
       'propose', current_date, auth.uid())
    returning id into v_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.cabinet_tenant_id, auth.uid(), 'acces.offre_changee', 'facturation', 'acces', v_id,
            jsonb_build_object('client', v.tenant_id, 'avant', v.offre_code, 'offre', v_grille.code));
    return jsonb_build_object('acces_id', v_id, 'effet', 'proposition');
  end if;

  v_rang_a := (ref.offre_a(v.offre_code, current_date)).rang;
  v_rang_o := v_grille.rang;

  -- Le client est monté à sa charge au-dessus de ce que la comptabilité paie : elle peut
  -- prendre en charge l'offre qu'il a déjà (recette du 13 novembre, B7). Le même chemin que
  -- toute montée : ce que le client a réglé d'avance court jusqu'à son terme (la garde), puis
  -- la comptabilité paie l'offre entière ; aucun jour ne se paie deux fois.
  if v_rang_o > v_rang_a then
    -- Montée : sur-le-champ, le dirigeant est prévenu.
    update facturation.acces_descentes
       set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
     where tenant_id = v.tenant_id and statut = 'propose';
    v_id := facturation.acces_relayer(v.id, v_grille.code);
    select f.offre_code into v_forfait
      from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
    if v_rang_o > coalesce((ref.offre_a(v_forfait, current_date)).rang, 0) then
      perform facturation.forfait_poser(v.licence_id, v_grille.code, current_date);
    end if;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'acces.monte', 'facturation', 'acces', v_id,
            jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                               'offre', v_grille.code));
    perform notif.emettre(v.tenant_id, 'acces.monte', jsonb_build_object('acces_id', v_id, 'offre', v_grille.code, 'cabinet', v_nom));
    return jsonb_build_object('acces_id', v_id, 'effet', 'immediat');
  end if;

  -- Descente : elle attend l'accord du dirigeant. Elle doit tenir dans ce
  -- que la société utilise déjà (sociétés, places), si le forfait la suit.
  select f.offre_code into v_forfait
    from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
  if v_forfait = v.offre_code then
    perform facturation.descente_possible(v.licence_id, v_grille.code);
  end if;
  update facturation.acces_descentes
     set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
   where tenant_id = v.tenant_id and statut = 'propose';
  insert into facturation.acces_descentes (acces_id, tenant_id, offre_code, propose_par)
  values (v.id, v.tenant_id, v_grille.code, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'acces.descente_demandee', 'facturation', 'acces_descentes', v_id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                             'offre', v_grille.code));
  perform notif.emettre(v.tenant_id, 'acces.descente_demandee', jsonb_build_object('descente_id', v_id, 'offre', v_grille.code, 'cabinet', v_nom));
  return jsonb_build_object('acces_id', v.id, 'descente_id', v_id, 'effet', 'accord_attendu');
end
$function$;

-- public.acces_descente_repondre
CREATE OR REPLACE FUNCTION public.acces_descente_repondre(p_descente uuid, p_accepte boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d        facturation.acces_descentes;
  v        facturation.acces;
  v_id     uuid;
  v_forfait text;
begin
  select * into d from facturation.acces_descentes where id = p_descente for update;
  if d.id is null or d.statut <> 'propose' then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  if not app.has_org_role(d.tenant_id, array['dirigeant']) then
    raise exception 'refus.reserve.dirigeant' using errcode = '42501';
  end if;
  select * into v from facturation.acces where id = d.acces_id for update;
  if v.statut <> 'actif' then
    update facturation.acces_descentes
       set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
     where id = d.id;
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  update facturation.acces_descentes
     set statut = case when p_accepte then 'acceptee' else 'refusee' end,
         repondu_le = current_date, repondu_par = auth.uid()
   where id = d.id;
  if p_accepte then
    v_id := facturation.acces_relayer(v.id, d.offre_code);
    -- Le forfait suit la comptabilité, sauf si le dirigeant avait monté à sa charge.
    select f.offre_code into v_forfait
      from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
    if v_forfait = v.offre_code then
      perform facturation.descente_possible(v.licence_id, d.offre_code);
      perform facturation.forfait_poser(v.licence_id, d.offre_code, current_date);
    end if;
  end if;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (d.tenant_id, auth.uid(),
          case when p_accepte then 'acces.descente_acceptee' else 'acces.descente_refusee' end,
          'facturation', 'acces_descentes', d.id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'offre', d.offre_code));
  perform notif.emettre(v.cabinet_tenant_id, case when p_accepte then 'acces.descente_acceptee' else 'acces.descente_refusee' end, jsonb_build_object('pme_org_id', d.tenant_id, 'offre', d.offre_code,
                             'client', (select name from identity.organizations where id = d.tenant_id)));
  return jsonb_build_object('descente_id', d.id,
                            'statut', case when p_accepte then 'acceptee' else 'refusee' end);
end
$function$;

-- public.acces_proposer
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

-- public.acces_repondre
CREATE OR REPLACE FUNCTION public.acces_repondre(p_acces uuid, p_accepte boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        facturation.acces;
  v_lic    uuid;
  v_rang_c smallint;
  v_rang_o smallint;
  v_offre  text;
  v_fr     record;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.statut <> 'propose' then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  if not app.has_org_role(v.tenant_id, array['dirigeant']) then
    raise exception 'refus.reserve.dirigeant'
      using errcode = '42501';
  end if;
  select lo.licence_id into v_lic
    from facturation.licence_organisations lo where lo.tenant_id = v.tenant_id;
  if v_lic is null then
    raise exception 'refus.licence.absente' using errcode = 'P0002';
  end if;

  if not p_accepte then
    update facturation.acces
       set statut = 'termine', licence_id = v_lic, effet_du = current_date,
           effet_au = current_date, motif_fin = 'refus_client',
           repondu_le = current_date, repondu_par = auth.uid()
     where id = p_acces;
  else
    select f.franchise_ht, f.jusqu_au into v_fr
      from facturation.franchise_de_reprise(
             v_lic, 0, (ref.offre_a(v.offre_code, v.offre_depuis)).prix_mensuel_ht,
             current_date) f;
    update facturation.acces
       set statut = 'actif', licence_id = v_lic, effet_du = current_date,
           repondu_le = current_date, repondu_par = auth.uid(),
           franchise_ht = v_fr.franchise_ht, franchise_jusqu_au = v_fr.jusqu_au
     where id = p_acces;

    -- L'offre attribuée devient le forfait si elle est AU-DESSUS du forfait
    -- courant ; au-dessous, la PME garde le sien et paie la différence au-dessus
    -- du plancher couvert par le cabinet (`periodes_v`).
    select f.offre_code into v_offre
      from facturation.forfait_courant_v f where f.licence_id = v_lic;
    v_rang_c := (ref.offre_a(v_offre, current_date)).rang;
    v_rang_o := (ref.offre_a(v.offre_code, current_date)).rang;
    if v_rang_o > coalesce(v_rang_c, 0) then
      perform public.forfait_changer(v.offre_code, v.tenant_id, current_date);
    end if;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(),
          case when p_accepte then 'acces.accepte' else 'acces.refuse' end,
          'facturation', 'acces', p_acces, jsonb_build_object('cabinet', v.cabinet_tenant_id));
  perform notif.emettre(v.cabinet_tenant_id, case when p_accepte then 'acces.accepte' else 'acces.refuse' end, jsonb_build_object('acces_id', p_acces, 'pme_org_id', v.tenant_id,
                             'client', (select name from identity.organizations where id = v.tenant_id),
                             'offre', v.offre_code));
  return jsonb_build_object('acces_id', p_acces,
                            'statut', case when p_accepte then 'actif' else 'termine' end);
end
$function$;

-- public.arbitrage_creer
CREATE OR REPLACE FUNCTION public.arbitrage_creer(p_tenant uuid, p_conversation uuid, p_question text, p_reponse text, p_sources jsonb, p_certitude numeric, p_doute text, p_canal text, p_theme text, p_langue text, p_statut text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cabinet   uuid;
  v_message   uuid;
  v_demandeur text;
  v_id        uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;
  if p_statut not in ('en_attente', 'repondue') then
    raise exception 'refus.arbitrage.etat_initial' using errcode = 'check_violation';
  end if;

  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
   where e.pme_org_id = p_tenant and e.status = 'actif'
     and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
   order by e.starts_on desc
   limit 1;
  if v_cabinet is null then
    raise exception 'refus.conseil.sans_cabinet' using errcode = 'no_data_found';
  end if;

  select m.id into v_message
    from agents.conversation_messages m
   where m.conversation_id = p_conversation and m.role = 'user' and m.contenu = p_question
   order by m.created_at desc, m.id desc
   limit 1;

  /*
   * L'AVIS DEMANDÉ PAR LA PERSONNE (canal « avis ») ne se pose qu'une fois par
   * question. Si la réponse est déjà chez la comptabilité — parce que Malica
   * l'y a envoyée, ou parce que le bouton a déjà été pressé —, on rend la
   * ligne qui existe et rien n'est écrit : ni doublon dans la file, ni
   * seconde notification.
   */
  if coalesce(nullif(btrim(p_canal), ''), 'conversation') = 'avis' then
    select a.id into v_id
      from agents.arbitrages a
     where a.tenant_id = p_tenant
       and a.conversation_id = p_conversation
       -- La réponse que l'assistant envoie d'elle-même est posée avant que le
       -- fil range la question : sa ligne ne porte pas de message. On la
       -- reconnaît donc à la question, dans ce fil.
       and btrim(a.question) = btrim(p_question)
       and (a.message_id is null or a.message_id is not distinct from v_message)
     order by a.created_at desc, a.id desc
     limit 1;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'cabinetId', v_cabinet, 'deja', true);
    end if;
  end if;

  select u.email::text into v_demandeur from auth.users u where u.id = auth.uid();

  insert into agents.arbitrages
    (tenant_id, cabinet_tenant_id, conversation_id, message_id, demandeur, question,
     reponse_proposee, sources, certitude, doute, canal, theme, langue, statut)
  values
    (p_tenant, v_cabinet, p_conversation, v_message, v_demandeur, btrim(p_question),
     p_reponse, coalesce(p_sources, '[]'::jsonb), p_certitude, nullif(btrim(p_doute), ''),
     coalesce(nullif(btrim(p_canal), ''), 'conversation'), nullif(btrim(p_theme), ''),
     coalesce(nullif(btrim(p_langue), ''), 'fr'), p_statut)
  returning id into v_id;

  -- Le cabinet lit les notifications de ses dossiers : c''est là qu''on la pose.
  perform notif.emettre(p_tenant, case when p_statut = 'en_attente' then 'conseil.arbitrage' else 'conseil.repondu' end, jsonb_build_object('arbitrage_id', v_id, 'conversation_id', p_conversation,
                             'certitude', p_certitude, 'theme', p_theme));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(),
          case when p_statut = 'en_attente' then 'conseil.retenu' else 'conseil.repondu' end,
          'agents', 'arbitrages', v_id,
          jsonb_build_object('cabinet', v_cabinet, 'certitude', p_certitude, 'theme', p_theme,
                             'sources', coalesce(p_sources, '[]'::jsonb)));

  return jsonb_build_object('id', v_id, 'cabinetId', v_cabinet);
end $function$;

-- public.arbitrage_decider
CREATE OR REPLACE FUNCTION public.arbitrage_decider(p_id uuid, p_decision text, p_reponse text, p_article text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_a agents.arbitrages%rowtype;
  v_reponse text := nullif(btrim(p_reponse), '');
  v_article text := nullif(btrim(p_article), '');
  v_origine text;
begin
  select * into v_a from agents.arbitrages where id = p_id;
  if not found then
    raise exception 'refus.introuvable.arbitrage' using errcode = 'no_data_found';
  end if;
  if v_a.cabinet_tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.arbitrage' using errcode = '42501';
  end if;
  if p_decision not in ('approuvee', 'corrigee', 'ecartee') then
    raise exception 'refus.arbitrage.decision_inconnue' using errcode = 'check_violation';
  end if;
  if v_a.statut not in ('en_attente', 'repondue') then
    raise exception 'refus.arbitrage.deja_decide' using errcode = 'check_violation';
  end if;
  if v_a.statut = 'repondue' and p_decision = 'ecartee' then
    raise exception 'refus.arbitrage.reponse_envoyee' using errcode = 'check_violation';
  end if;
  if p_decision = 'corrigee' and v_reponse is null then
    raise exception 'refus.reponse.vide' using errcode = 'check_violation';
  end if;

  update agents.arbitrages
     set statut = p_decision,
         reponse_cabinet = case when p_decision = 'corrigee' then v_reponse else null end,
         article_cabinet = case when p_decision = 'corrigee' then v_article else null end,
         decide_par = auth.uid(),
         decide_le = now()
   where id = p_id;

  -- Le message part dans le fil du client, s''il existe encore. Il est signé
  -- Malica dans le fil — c''est elle qui parle au client — mais le journal
  -- d''audit dit qui a décidé.
  if p_message is not null and length(btrim(p_message)) > 0
     and v_a.conversation_id is not null
     and exists (select 1 from agents.conversations c where c.id = v_a.conversation_id) then
    -- La réponse arbitrée est écrite par la BASE, au nom du cabinet qui vient
    -- de décider : la marque d'origine est posée le temps de cette ligne,
    -- puis rendue (20261022440000 réserve ces écritures au serveur).
    v_origine := coalesce(current_setting('malica.origine', true), '');
    perform set_config('malica.origine', 'serveur', true);
    insert into agents.conversation_messages (conversation_id, role, contenu)
    values (v_a.conversation_id, 'assistant', p_message);
    perform set_config('malica.origine', v_origine, true);
  end if;

  perform notif.emettre(v_a.tenant_id, 'conseil.decide', jsonb_build_object('arbitrage_id', p_id, 'decision', p_decision,
                             'conversation_id', v_a.conversation_id, 'theme', v_a.theme));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_a.tenant_id, auth.uid(),
          case p_decision when 'approuvee' then 'conseil.approuve'
                          when 'corrigee' then 'conseil.corrige'
                          else 'conseil.ecarte' end,
          'agents', 'arbitrages', p_id,
          jsonb_build_object('cabinet', v_a.cabinet_tenant_id, 'depuis', v_a.statut,
                             'article', v_article, 'certitude', v_a.certitude));

  return (select to_jsonb(v) from public.arbitrages_v v where v.id = p_id);
end $function$;

-- public.cabinet_place_pour_le_client
CREATE OR REPLACE FUNCTION public.cabinet_place_pour_le_client(p_cabinet uuid, p_pme uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_paye  boolean;
  v_lic   uuid;
  v_max   smallint;
  v_inclus smallint;
begin
  if not app.has_org_role(p_cabinet, array['expert'])
     or not exists (select 1 from identity.engagements e
                     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_pme
                       and e.status = 'actif') then
    raise exception 'refus.reserve.expert_mandate' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'refus.invitation.adresse' using errcode = '22023';
  end if;
  if not exists (select 1 from identity.memberships m
                  where m.tenant_id = p_pme and m.role = 'dirigeant') then
    raise exception 'refus.dossier.dirigeant_attendu' using errcode = '22023';
  end if;
  v_paye := exists (select 1 from facturation.acces a
                     where a.tenant_id = p_pme and a.cabinet_tenant_id = p_cabinet
                       and a.statut = 'actif');
  if v_paye then
    v_lic := facturation.licence_de(p_pme);
    select sieges_max into v_max from facturation.droits_v where licence_id = v_lic;
    if v_max is not null and facturation.places_occupees(v_lic) >= v_max then
      raise exception '%', app.refus_avec_valeurs('refus.place.offre_pleine', 'places', (v_max)::text)
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from identity.memberships m
                where m.tenant_id = p_pme
                  and lower(coalesce(app.email_du_membre(m.user_id), '')) = v_email) then
      raise exception 'refus.invitation.deja_membre' using errcode = '22023';
    end if;
    -- Comme `place_offrir` : depuis l'application installée, une place au-delà
    -- des places incluses se vend, et elle ne se vend pas là (Google Play).
    select sieges_inclus into v_inclus from facturation.droits_v where licence_id = v_lic;
    if coalesce(current_setting('malica.client_coque', true), '') = 'oui'
       and not exists (select 1 from identity.invitations i
                        where i.tenant_id = p_pme and lower(i.email) = v_email
                          and i.accepted_at is null and i.revoked_at is null
                          and i.expires_at > now())
       and facturation.places_engagees(v_lic) >= coalesce(v_inclus, 0) then
      raise exception 'refus.place.incluses_prises' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from identity.invitations i
                    where i.tenant_id = p_pme and lower(i.email) = v_email
                      and i.accepted_at is null and i.revoked_at is null
                      and i.expires_at > now()) then
      insert into identity.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
      values (p_pme, v_email, 'collaborateur',
              encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
              auth.uid(), now() + interval '30 days');
    end if;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (p_pme, auth.uid(), 'place.donnee', 'identity', 'organizations', p_pme,
            jsonb_build_object('cabinet', p_cabinet, 'email', v_email));
    perform notif.emettre(p_pme, 'place.donnee', jsonb_build_object('email', v_email,
                               'cabinet', (select name from identity.organizations where id = p_cabinet)));
    return jsonb_build_object('mode', 'donnee');
  end if;
  perform notif.emettre(p_pme, 'place.suggeree', jsonb_build_object('email', v_email,
                             'cabinet', (select name from identity.organizations where id = p_cabinet)));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_pme, auth.uid(), 'place.suggeree', 'identity', 'organizations', p_pme,
          jsonb_build_object('cabinet', p_cabinet, 'email', v_email));
  return jsonb_build_object('mode', 'suggeree');
end
$function$;

-- public.capture_piece_set_vis
CREATE OR REPLACE FUNCTION public.capture_piece_set_vis(p_piece uuid, p_vis app.vis_t, p_par_accord boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_old    app.vis_t;
  v_status text;
  v_auteur uuid;
  v_rendue boolean := false;
  v_derive record;
begin
  -- Jamais NULL : « par accord » se dit, ou ne se dit pas.
  p_par_accord := coalesce(p_par_accord, false);
  select tenant_id, vis, status, created_by
    into v_tenant, v_old, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null
     or not ((v_tenant in (select app.member_orgs()) and app.piece_lisible(p_piece))
             or (p_par_accord and v_tenant in (select app.engaged_orgs())
                 and app.accord_donne(p_piece, 'rappel'))) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;

  if p_vis = 'personnel'::app.vis_t
     and (v_status in ('comptabilisee','supervisee')
          or exists (select 1 from socle.ecritures e
                      where e.piece_id in (select app.versions_de_la_piece(p_piece))
                        and e.status = 'booked'
                        and e.reverses_id is null
                        and not exists (select 1 from socle.ecritures r
                                         where r.reverses_id = e.id and r.status = 'booked')))
  then
    raise exception 'refus.piece.comptabilisee_dans_la_societe' using errcode = 'check_violation';
  end if;

  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee')
       or exists (select 1 from socle.ecritures e
                   where e.piece_id in (select app.versions_de_la_piece(p_piece))
                     and e.status = 'booked'
                     and app.ecriture_vivante(e.id)) then
      raise exception 'refus.piece.comptabilisee_partagee' using errcode = 'check_violation';
    end if;
    -- Ce qui est chez le comptable revient par qui l'y envoie, ou par son accord.
    if not app.a_le_droit(v_tenant, 'envoi.cabinet')
       and not (p_par_accord and v_tenant in (select app.engaged_orgs())) then
      raise exception 'refus.envoi.reserve_au_proprietaire'
        using errcode = '42501', hint = 'envoi.proprietaire';
    end if;
    v_rendue := coalesce(v_status = 'retournee' and p_vis = 'entite'::app.vis_t, false);
    if not v_rendue and not app.accord_donne(p_piece, 'rappel') then
      raise exception 'refus.piece.transmise_au_cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Retournée au siège par le propriétaire, la main est au siège : elle ne
  -- part chez le comptable qu'après qu'il l'a reprise et renvoyée (revue Codex
  -- de #146 — le lot du propriétaire la comptait). La même règle que l'écran
  -- (`resteAEnvoyer` au Socle), tenue ici pour toute porte.
  if p_vis = 'partage'::app.vis_t and v_old = 'entite'::app.vis_t
     and (select fait from app.dernier_fait_du_circuit(p_piece)) is not distinct from 'retournee' then
    raise exception 'refus.envoi.chez_le_siege' using errcode = 'check_violation';
  end if;

  -- Entre Mon espace et la société : chacun les siennes, dans les deux sens.
  if (p_vis = 'personnel'::app.vis_t and v_old = 'entite'::app.vis_t)
     or (p_vis = 'entite'::app.vis_t and v_old = 'personnel'::app.vis_t) then
    if v_auteur is distinct from auth.uid() then
      raise exception 'refus.deplacer.pas_la_sienne' using errcode = '42501';
    end if;
    -- Partie chez le propriétaire, ou retournée par lui : elle se demande,
    -- elle ne se reprend pas en douce.
    if p_vis = 'personnel'::app.vis_t
       and (select fait from app.dernier_fait_du_circuit(p_piece)) in ('envoyee', 'retournee') then
      raise exception 'refus.deplacer.chez_le_proprietaire' using errcode = 'check_violation';
    end if;
  end if;

  if v_rendue then
    perform app.piece_oublie_ses_propositions(p_piece);
  end if;

  update capture.pieces
     set vis = p_vis,
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         gardee_le = null,
         status = case when v_rendue then app.statut_hors_retour(p_piece) else status end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  if v_old = 'partage'::app.vis_t then
    for v_derive in
      update capture.pieces
         set vis = p_vis,
             transmise_le = null,
             gardee_le = null,
             updated_at = now()
       where tenant_id = v_tenant
         and source_piece_id in (select app.versions_de_la_piece(p_piece))
         and vis = 'partage'::app.vis_t
         and status not in ('comptabilisee', 'supervisee')
      returning id
    loop
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', v_derive.id,
              jsonb_build_object('from', 'partage', 'to', p_vis,
                                 'par_accord', p_par_accord, 'suit_la_source', p_piece));
    end loop;
  end if;

  if p_vis = 'partage'::app.vis_t then
    perform notif.emettre(v_tenant, 'piece.partagee', jsonb_build_object('piece_id', p_piece));
  elsif p_vis = 'entite'::app.vis_t and v_old = 'personnel'::app.vis_t then
    perform app.notifier_les_receveurs(v_tenant, 'piece.a_valider',
                                       jsonb_build_object('piece_id', p_piece, 'auteur', v_auteur));
  end if;

  if v_rendue and not p_par_accord then
    perform notif.emettre(v_tenant, 'piece.gardee', jsonb_build_object('piece_id', p_piece, 'vis', p_vis));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$function$;

-- public.capture_piece_supprimer
CREATE OR REPLACE FUNCTION public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_vis      text;
  v_status   text;
  v_tenant   uuid;
  v_archivee timestamptz;
  v_version  uuid;
  v_auteur   uuid;
  v_prevenir uuid;
begin
  -- Jamais NULL : « par accord » se dit, ou ne se dit pas.
  p_par_accord := coalesce(p_par_accord, false);
  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;

  select p.vis::text, p.status, p.tenant_id, p.archivee_le, p.created_by
    into v_vis, v_status, v_tenant, v_archivee, v_auteur
    from capture.pieces p where p.id = p_piece;

  if v_vis is null then
    raise exception 'refus.introuvable.piece' using errcode = 'no_data_found';
  end if;

  if v_tenant not in (select app.member_orgs())
     and not (v_vis = 'personnel' and v_auteur is not distinct from auth.uid()
              and v_auteur is not null)
     and not (p_par_accord
              and v_tenant in (select app.engaged_orgs())
              and app.accord_donne(p_piece, 'suppression')) then
    raise exception 'refus.introuvable.piece' using errcode = 'no_data_found';
  end if;

  if v_tenant in (select app.member_orgs()) then
    -- Ce qu'on ne lit pas n'existe pas pour soi.
    if not app.piece_lisible(p_piece) then
      raise exception 'refus.introuvable.piece' using errcode = 'no_data_found';
    end if;
    if v_vis = 'personnel' and v_auteur is distinct from auth.uid() then
      raise exception 'refus.introuvable.piece' using errcode = 'no_data_found';
    end if;
    if v_vis <> 'personnel' and v_auteur is distinct from auth.uid()
       and not app.a_le_droit(v_tenant, 'piece.supprimer_toutes') then
      raise exception 'refus.suppression.pas_la_sienne' using errcode = '42501';
    end if;
    if v_vis = 'entite' and v_auteur = auth.uid()
       and not app.a_le_droit(v_tenant, 'piece.supprimer_toutes')
       and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'envoyee' then
      raise exception 'refus.suppression.chez_le_proprietaire' using errcode = 'check_violation';
    end if;
    -- Le propriétaire retire la pièce d'un autre : l'auteur le saura. Sur
    -- l'accord de sa demande, la réponse le lui dit déjà.
    if v_auteur is distinct from auth.uid() and not p_par_accord then
      v_prevenir := v_auteur;
    end if;
  end if;

  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  if v_archivee is not null then
    return 'archivee';
  end if;

  if v_vis = 'partage'
     and v_status <> 'retournee'
     and not app.accord_donne(p_piece, 'suppression') then
    raise exception
      'refus.piece.transmise_au_cabinet'
      using errcode = 'check_violation';
  end if;

  if v_status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id in (select app.versions_de_la_piece(p_piece))
                   and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception
      'refus.suppression.engagee'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from immo.assets a
              where a.piece_id in (select app.versions_de_la_piece(p_piece)))
     or exists (select 1 from stocks.mouvements m
                 where m.piece_id in (select app.versions_de_la_piece(p_piece)))
     or exists (select 1 from identity.fiches_fiscales f
                 where f.piece_id in (select app.versions_de_la_piece(p_piece)))
  then
    raise exception
      'refus.suppression.justificatif'
      using errcode = 'check_violation';
  end if;

  perform app.piece_oublie_ses_propositions(v.id)
     from app.versions_de_la_piece(p_piece) v(id);

  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.status = 'booked') then
    update capture.pieces set archivee_le = now(), updated_at = now()
     where id in (select app.versions_de_la_piece(p_piece)) and archivee_le is null;
    perform app.les_issues_suivent_l_archive(p_piece);

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'piece.archivee', 'capture', 'pieces', p_piece,
            jsonb_build_object('vis', v_vis, 'status', v_status, 'par_accord', p_par_accord));

    if v_vis = 'partage' and not p_par_accord then
      perform notif.emettre(v_tenant, 'piece.archivee', jsonb_build_object('piece_id', p_piece));
    end if;
    if v_prevenir is not null then
      perform notif.emettre(v_tenant, 'piece.supprimee_par_le_proprietaire', jsonb_build_object('piece_id', p_piece,
                                 'par', app.prenom_au_moment(auth.uid()), 'archivee', true), v_prevenir);
    end if;
    return 'archivee';
  end if;

  if exists (
       select 1 from fabrique.exemples x
        where x.piece_id in (select app.versions_de_la_piece(p_piece))
          and (exists (select 1 from fabrique.recette_version_exemples r where r.exemple_id = x.id)
               or exists (select 1 from fabrique.evaluation_exemples v where v.exemple_id = x.id)))
  then
    raise exception 'refus.suppression.exemple_de_recette' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.supprimee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis, 'status', v_status,
                             'par_accord', p_par_accord,
                             'versions', (select jsonb_agg(v)
                                            from app.versions_de_la_piece(p_piece) v
                                           where v <> p_piece)));

  if v_vis = 'partage' and not p_par_accord then
    perform notif.emettre(v_tenant, 'piece.supprimee', jsonb_build_object('piece_id', p_piece));
  end if;
  -- L'auteur apprend que sa pièce a été retirée par un propriétaire. La
  -- notification lui est adressée : elle survit à la pièce.
  if v_prevenir is not null then
    perform notif.emettre(v_tenant, 'piece.supprimee_par_le_proprietaire', jsonb_build_object('piece_id', p_piece, 'par', app.prenom_au_moment(auth.uid())), v_prevenir);
  end if;

  for v_version in
    with recursive suite(id, rang) as (
      select p_piece, 0
      union all
      select r.piece_id, s.rang + 1
        from capture.remplacements r join suite s on r.remplacee_par = s.id
    )
    select id from suite order by rang
  loop
    -- L'effacement s'inscrit comme un fait de la transaction, que les gardes
    -- de R7 lisent (`20261104120000`) ; il se retire avant de rendre la main.
    perform app.effacer_la_piece(v_version);
  end loop;
  perform app.effacements_clos();

  return 'supprimee';
end
$function$;

-- public.comptabilite_invitation_accepter
CREATE OR REPLACE FUNCTION public.comptabilite_invitation_accepter(p_jeton text, p_invitation uuid, p_cabinet uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_engagement uuid;
  v_cabinet text;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select * into v from app.invitation_expert_lire(p_jeton, p_invitation);
  if v.id is null or v.pme_kind <> 'pme' then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;
  if not exists (select 1 from identity.organizations c
                  where c.id = p_cabinet and c.kind = 'cabinet' and c.archived_at is null)
     or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if app.autre_mandat_en_vigueur(v.tenant_id, p_cabinet) then
    raise exception 'refus.mandat.un_seul_actif' using errcode = '22023';
  end if;

  -- Le mandat, puis ce qu'il dit ; l'invitation est encore ouverte à cet
  -- instant, c'est elle qui autorise ces écritures (politiques ci-dessus).
  insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on, created_by)
  values (v.tenant_id, p_cabinet, 'actif', current_date, auth.uid())
  on conflict (pme_org_id, cabinet_org_id) do update
    set status = 'actif', starts_on = current_date, ends_on = null
  returning id into v_engagement;

  select name into v_cabinet from identity.organizations where id = p_cabinet;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'engagement.accepte', 'identity', 'engagements', v_engagement,
          jsonb_build_object('cabinet_org_id', p_cabinet, 'par', 'invitation')),
         (p_cabinet, auth.uid(), 'engagement.accepte', 'identity', 'engagements', v_engagement,
          jsonb_build_object('pme_org_id', v.tenant_id, 'par', 'invitation'));
  perform notif.emettre(v.tenant_id, 'mandat.accepte', jsonb_build_object('engagement_id', v_engagement, 'cabinet', v_cabinet,
                             'client', v.pme_name));

  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;

  return jsonb_build_object('engagementId', v_engagement, 'pmeTenantId', v.tenant_id,
                            'cabinetTenantId', p_cabinet);
end
$function$;

-- public.mandat_proposer
CREATE OR REPLACE FUNCTION public.mandat_proposer(p_cabinet uuid, p_legal_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_legal text := trim(p_legal_id);
  v_pme uuid;
  v_nom text;
  v_id uuid;
  v_status text;
  v_cabinet text;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v_legal = '' then
    raise exception 'refus.mandat.identifiant_fiscal_requis' using errcode = '22023';
  end if;
  select id, name into v_pme, v_nom
    from identity.organizations
   where kind = 'pme' and archived_at is null and legal_id = v_legal
   order by created_at limit 1;
  if v_pme is null then
    raise exception 'refus.mandat.pme_inconnue'
      using errcode = 'P0002';
  end if;

  select id, status into v_id, v_status
    from identity.engagements where pme_org_id = v_pme and cabinet_org_id = p_cabinet;

  -- Un mandat en cours, proposé ou suspendu : rien à reproposer.
  if v_id is not null and v_status <> 'termine' then
    return jsonb_build_object('id', v_id, 'pmeTenantId', v_pme, 'pmeName', v_nom,
                              'status', v_status, 'deja', true);
  end if;

  select name into v_cabinet from identity.organizations where id = p_cabinet;

  if v_id is null then
    insert into identity.engagements (pme_org_id, cabinet_org_id, status, created_by)
    values (v_pme, p_cabinet, 'propose', auth.uid())
    returning id into v_id;
  else
    -- Terminé ou refusé : la proposition renaît, la PME répondra à nouveau.
    update identity.engagements
       set status = 'propose', starts_on = current_date, ends_on = null
     where id = v_id;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'engagement.propose', 'identity', 'engagements', v_id,
          jsonb_build_object('pme_org_id', v_pme));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v_pme, auth.uid(), 'engagement.propose', 'identity', 'engagements', v_id,
          jsonb_build_object('cabinet_org_id', p_cabinet));
  perform notif.emettre(v_pme, 'mandat.propose', jsonb_build_object('engagement_id', v_id, 'cabinet', v_cabinet));

  return jsonb_build_object('id', v_id, 'pmeTenantId', v_pme, 'pmeName', v_nom,
                            'status', 'propose', 'deja', false);
end $function$;

-- public.mandat_repondre
CREATE OR REPLACE FUNCTION public.mandat_repondre(p_engagement uuid, p_accepte boolean, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_status text;
  v_cabinet text;
  v_pme text;
  v_quitte jsonb;
begin
  select id, pme_org_id, cabinet_org_id, status into v
    from identity.engagements where id = p_engagement;
  if v.id is null or v.pme_org_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.mandat' using errcode = '42501';
  end if;
  if v.status <> 'propose' then
    raise exception 'refus.mandat.deja_repondu' using errcode = '22023';
  end if;

  -- Le passage simultané : l'ancien mandat se termine par la porte de la
  -- révocation, qui exige le dirigeant et le motif, et prévient l'ancienne.
  if p_accepte and exists (select 1 from identity.engagements o
                            where o.pme_org_id = v.pme_org_id and o.status = 'actif'
                              and o.id <> v.id) then
    v_quitte := public.mandat_revoquer(v.pme_org_id, p_motif);
  end if;

  v_status := case when p_accepte then 'actif' else 'termine' end;
  update identity.engagements
     set status = v_status,
         starts_on = case when p_accepte then current_date else starts_on end,
         ends_on = case when p_accepte then null else current_date end
   where id = p_engagement;

  select name into v_cabinet from identity.organizations where id = v.cabinet_org_id;
  select name into v_pme from identity.organizations where id = v.pme_org_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.pme_org_id, auth.uid(),
          case when p_accepte then 'engagement.accepte' else 'engagement.refuse' end,
          'identity', 'engagements', p_engagement,
          jsonb_build_object('cabinet_org_id', v.cabinet_org_id));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_org_id, auth.uid(),
          case when p_accepte then 'engagement.accepte' else 'engagement.refuse' end,
          'identity', 'engagements', p_engagement,
          jsonb_build_object('pme_org_id', v.pme_org_id));
  -- Le cabinet lit les notifications de ses mandats : celle-ci lui dit la réponse.
  perform notif.emettre(v.pme_org_id, case when p_accepte then 'mandat.accepte' else 'mandat.refuse' end, jsonb_build_object('engagement_id', p_engagement, 'cabinet', v_cabinet, 'client', v_pme));

  return jsonb_build_object('id', p_engagement, 'status', v_status,
                            'quitte', v_quitte ->> 'id');
end $function$;

-- public.mandat_revoquer
CREATE OR REPLACE FUNCTION public.mandat_revoquer(p_tenant uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.dirigeant' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.mandat.motif_de_revocation' using errcode = '22023';
  end if;

  select e.id, e.cabinet_org_id
    into v
    from identity.engagements e
   where e.pme_org_id = p_tenant and e.status = 'actif'
   order by e.created_at desc
   limit 1
   for update;

  if v.id is null then
    raise exception 'refus.mandat.aucun_actif' using errcode = '22023';
  end if;

  update identity.engagements
     set status = 'termine', ends_on = current_date
   where id = v.id;

  -- L'abonnement attribué par ce cabinet passe à la PME, le jour même
  -- (décision du 20 octobre 2026) : l'accès se termine, la licence reste la
  -- sienne, le cabinet cesse d'être payeur. Une proposition en attente tombe.
  update facturation.acces a
     set statut = 'termine', effet_au = current_date, motif_fin = 'revocation_client'
   where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
     and a.statut in ('actif', 'suspendu');
  update facturation.acces a
     set statut = 'termine',
         licence_id = (select lo.licence_id from facturation.licence_organisations lo
                        where lo.tenant_id = p_tenant),
         effet_du = current_date, effet_au = current_date, motif_fin = 'revocation_client'
   where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
     and a.statut = 'propose';
  if found or exists (select 1 from facturation.acces a
                       where a.tenant_id = p_tenant and a.cabinet_tenant_id = v.cabinet_org_id
                         and a.effet_au = current_date and a.motif_fin = 'revocation_client') then
    -- La PME est avertie : son abonnement continue, à sa charge, au prix public.
    perform notif.emettre(p_tenant, 'acces.repris', jsonb_build_object('cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                               'offre', (select f.offre_code from facturation.forfait_courant_v f
                                           join facturation.licence_organisations lo on lo.licence_id = f.licence_id
                                          where lo.tenant_id = p_tenant)));
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'engagement.revoque', 'identity', 'engagements', v.id,
          jsonb_build_object('cabinet_org_id', v.cabinet_org_id, 'motif', btrim(p_motif)));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_org_id, auth.uid(), 'engagement.revoque', 'identity', 'engagements', v.id,
          jsonb_build_object('pme_org_id', p_tenant, 'motif', btrim(p_motif)));

  perform notif.emettre(p_tenant, 'mandat.revoque', jsonb_build_object('engagement_id', v.id, 'motif', btrim(p_motif),
                             'cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                             'client', (select name from identity.organizations where id = p_tenant)));

  -- Le cabinet aussi l'apprend, chez LUI : la notification du dossier client
  -- lui devient invisible à l'instant où le mandat se termine.
  perform notif.emettre(v.cabinet_org_id, 'mandat.revoque', jsonb_build_object('engagement_id', v.id, 'motif', btrim(p_motif),
                             'pme_org_id', p_tenant,
                             'cabinet', (select name from identity.organizations where id = v.cabinet_org_id),
                             'client', (select name from identity.organizations where id = p_tenant)));

  return jsonb_build_object('id', v.id, 'statut', 'termine', 'le', current_date);
end
$function$;

-- public.piece_demander
CREATE OR REPLACE FUNCTION public.piece_demander(p_piece uuid, p_objet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_auteur uuid;
  v_etape text;
  v_dernier text;
begin
  select tenant_id, vis, status, created_by into v_tenant, v_vis, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null or v_tenant not in (select app.member_orgs())
     or not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  if app.a_le_droit(v_tenant, 'envoi.cabinet') then
    v_etape := 'cabinet';
    -- Une pièce qu'on n'a pas envoyée se reprend sans demander.
    if v_vis <> 'partage'::app.vis_t then
      raise exception 'refus.piece.non_partagee'
        using errcode = 'check_violation';
    end if;
  elsif app.a_le_droit(v_tenant, 'envoi.proprietaire') and v_auteur = auth.uid() then
    v_etape := 'proprietaire';
    -- Dans la société, il ne demande que ce qui est parti chez le propriétaire.
    if v_vis = 'personnel'::app.vis_t
       or (v_vis = 'entite'::app.vis_t
           and (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee') then
      raise exception 'refus.piece.non_partagee'
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Prise en charge, elle se demande : le comptable qui accorde contre-passe.
  -- Un règlement inscrit, lui, engage un paiement réel : il s'annule d'abord.
  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.nature <> 'piece'
                and e.status = 'booked'
                and app.ecriture_vivante(e.id)) then
    raise exception '%', case when p_objet = 'rappel' then 'refus.rappel.inscrite'
                              else 'refus.suppression.inscrite' end
      using errcode = 'check_violation';
  end if;

  select d.fait into v_dernier from app.derniere_demande(p_piece, p_objet, v_etape) d;
  if v_dernier = 'demandee' then
    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', true,
                              'etape', v_etape);
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur, etape)
  values (v_tenant, p_piece, p_objet, 'demandee', auth.uid(), v_etape);

  if v_etape = 'cabinet' then
    perform notif.emettre(v_tenant, 'piece.demande', jsonb_build_object('piece_id', p_piece, 'objet', p_objet));
  else
    perform app.notifier_les_receveurs(v_tenant, 'piece.demande',
                                       jsonb_build_object('piece_id', p_piece, 'objet', p_objet,
                                                          'chez', 'proprietaire'));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', false,
                            'etape', v_etape);
end
$function$;

-- public.piece_remplacer
CREATE OR REPLACE FUNCTION public.piece_remplacer(p_ancienne uuid, p_nouvelle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record;
  n record;
begin
  -- Les deux lignes, dans un ordre fixe : deux remplacements croisés ne
  -- s'attendent pas l'un l'autre.
  perform 1 from capture.pieces where id in (p_ancienne, p_nouvelle) order by id for update;
  select * into a from capture.pieces where id = p_ancienne;
  select * into n from capture.pieces where id = p_nouvelle;

  -- L'ancienne n'est plus là pour celui qui la reprend — retirée, archivée,
  -- jamais vue : la reprise le dit par son code (la file hors ligne propose
  -- alors de garder la photo comme une pièce à part).
  if a.id is null or not app.piece_lisible(p_ancienne) then
    raise exception 'refus.remplacement.introuvable' using errcode = 'P0002';
  end if;

  -- `security definer` court-circuite la RLS : le contrôle est refait ici.
  if n.id is null or p_ancienne = p_nouvelle
     or a.tenant_id <> n.tenant_id
     or a.tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  if exists (select 1 from capture.remplacements r
              where r.piece_id = p_ancienne and r.remplacee_par = p_nouvelle) then
    return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', true);
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_ancienne) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Un reçu, un justificatif : ils ont leur propre reprise (`justificatif_remplacer`).
  if a.source_piece_id is not null or app.piece_accompagne(p_ancienne) then
    raise exception 'refus.remplacement.accompagne' using errcode = 'check_violation';
  end if;

  -- Une pièce prise en charge porte une écriture : le cabinet la retourne
  -- d'abord (contre-passation), puis la photo se reprend.
  if a.status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id in (select app.versions_de_la_piece(p_ancienne))
                   and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception 'refus.remplacement.inscrite' using errcode = 'check_violation';
  end if;

  -- La nouvelle est une photo qui vient d'être prise, par celui qui remplace,
  -- et rien d'autre : jamais une pièce lue, issue d'une autre, ou déjà liée.
  if n.status <> 'capturee'
     or n.created_by is distinct from auth.uid()
     or n.source_piece_id is not null
     or exists (select 1 from capture.extractions x where x.piece_id = p_nouvelle)
     or exists (select 1 from capture.remplacements r
                 where r.remplacee_par = p_nouvelle or r.piece_id = p_nouvelle) then
    raise exception 'refus.remplacement.nouvelle_photo' using errcode = 'check_violation';
  end if;

  -- Qui reprend la photo est inscrit ici (`auteur`) ; la pièce, elle, reste
  -- à l'auteur de l'ancienne.
  insert into capture.remplacements (tenant_id, piece_id, remplacee_par, auteur)
  values (a.tenant_id, p_ancienne, p_nouvelle, auth.uid());

  -- La nouvelle hérite du partage de l'ancienne : ce n'est pas une nouvelle
  -- transmission, et un impayé ne doit pas empêcher de corriger une pièce
  -- déjà envoyée. Les déclencheurs le lisent au fait inscrit juste au-dessus
  -- (`app.remplacement_en_cours`), jamais à un réglage de session.
  update capture.pieces
     set vis = a.vis,
         entity_id = coalesce(n.entity_id, a.entity_id),
         transmise_le = a.transmise_le,
         gardee_le = a.gardee_le,
         -- La pièce d'un siège reprise par le dirigeant reste celle du siège.
         created_by = a.created_by,
         -- Le retour en cours suit la photo ; sinon, elle part en lecture.
         status = case when a.status = 'retournee' then 'retournee' else 'capturee' end,
         -- Le type déclaré suit, à confirmer : la lecture aura le dernier mot.
         document_kind = coalesce(n.document_kind, a.document_kind),
         document_kind_statut = case
           when n.document_kind is not null then n.document_kind_statut
           when a.document_kind is not null then 'a_confirmer'
           else n.document_kind_statut end,
         updated_at = now()
   where id = p_nouvelle;

  -- Les documents rattachés à l'ancienne ne se recopient pas : `rattachements_v`
  -- les lit à travers la version courante.

  -- Une demande en attente sur l'ancienne n'a plus d'objet : on inscrit le
  -- fait qui la clôt, À SON ÉTAPE (au propriétaire, au comptable) — la ligne
  -- « demandee » reste, R7. L'état se lit par étape (`app.etat_des_demandes`).
  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
  select a.tenant_id, p_ancienne, e.objet, 'retiree', null, auth.uid(), e.etape
    from app.etat_des_demandes(p_ancienne) e
   where e.fait = 'demandee';

  perform app.piece_oublie_ses_propositions(p_ancienne);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (a.tenant_id, auth.uid(), 'piece.remplacee', 'capture', 'pieces', p_nouvelle,
          jsonb_build_object('remplace', p_ancienne, 'vis', a.vis, 'status', a.status));

  if a.vis = 'partage'::app.vis_t then
    perform notif.emettre(a.tenant_id, 'piece.remplacee', jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne));
  end if;

  return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', false);
end
$function$;

-- public.piece_renvoyer
CREATE OR REPLACE FUNCTION public.piece_renvoyer(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Le retour du propriétaire : le siège la lui renvoie.
  if v_vis = 'entite'::app.vis_t
     and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'retournee' then
    return app.envoyer_au_proprietaire(p_piece);
  end if;

  if v_vis <> 'partage'::app.vis_t or v_status <> 'retournee' then
    raise exception 'refus.renvoi.sans_retour' using errcode = 'check_violation';
  end if;
  -- Seul qui transmet au comptable lui renvoie : le siège fait le geste, le
  -- propriétaire renvoie.
  if not app.a_le_droit(v_tenant, 'envoi.cabinet') then
    raise exception 'refus.envoi.reserve_au_proprietaire'
      using errcode = '42501', hint = 'envoi.proprietaire';
  end if;

  perform app.piece_oublie_ses_propositions(p_piece);

  update capture.pieces
     set status = app.statut_hors_retour(p_piece), updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.renvoyee', 'capture', 'pieces', p_piece, '{}'::jsonb);

  perform notif.emettre(v_tenant, 'piece.renvoyee', jsonb_build_object('piece_id', p_piece));

  return jsonb_build_object('piece_id', p_piece, 'le', now());
end
$function$;

-- public.piece_repondre
CREATE OR REPLACE FUNCTION public.piece_repondre(p_piece uuid, p_objet text, p_accorde boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_auteur  uuid;
  v_dernier record;
  v_demandeur uuid;
  v_relayee boolean := false;
  v_vivante uuid;
begin
  if p_accorde is null then
    raise exception 'refus.reponse.sans_decision' using errcode = 'check_violation';
  end if;
  if not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;
  select tenant_id, vis, created_by into v_tenant, v_vis, v_auteur
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Le propriétaire tranche la demande d'un siège. Un membre de la société
  -- ne tranche rien d'autre : la demande faite au cabinet n'est pas à lui (nul
  -- ne tranche sa propre demande).
  -- LE RÔLE SE CHOISIT PAR L'ÉTAPE QUI ATTEND (recette du 2 novembre 2026).
  -- Une personne à la fois membre de la société ET du cabinet mandaté (un
  -- dirigeant qui tient aussi le cabinet) entrait toujours ici, et la
  -- demande faite au cabinet lui était refusée « réservée au cabinet
  -- mandaté ». La branche du propriétaire ne vaut que si une demande attend
  -- le propriétaire, ou si la personne n'est pas du cabinet mandaté.
  if v_tenant in (select app.member_orgs())
     and ((select d.fait from app.derniere_demande(p_piece, p_objet, 'proprietaire') d)
            = 'demandee'
          or v_tenant not in (select app.engaged_orgs())) then
    select * into v_dernier from app.derniere_demande(p_piece, p_objet, 'proprietaire');
    if v_dernier.fait is distinct from 'demandee' then
      raise exception 'refus.reserve.cabinet_mandate'
        using errcode = '42501';
    end if;
    if not app.a_le_droit(v_tenant, 'circuit.recevoir') then
      raise exception 'refus.reserve.proprietaire'
        using errcode = '42501';
    end if;
    v_demandeur := v_dernier.auteur;
    -- Le droit de trancher est établi : le motif se nettoie et se borne, avant
    -- toute écriture (audit du 10 novembre 2026).
    p_note := app.motif_d_une_reponse(p_accorde, p_note);

    -- Accordée sur une pièce chez le comptable, la demande y part : un fait.
    v_relayee := p_accorde and v_vis = 'partage'::app.vis_t;
    insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape,
                                           transmise)
    values (v_tenant, p_piece, p_objet,
            case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid(),
            'proprietaire', v_relayee);

    if v_relayee then
      -- Chez le comptable : la demande part d'elle-même, au nom du propriétaire.
      if (select d.fait from app.derniere_demande(p_piece, p_objet, 'cabinet') d)
         is distinct from 'demandee' then
        -- Après l'accord, dans la même transaction : l'heure de l'horloge, pas
        -- celle de la transaction, pour que la suite des faits garde son ordre.
        insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur, etape,
                                               created_at)
        values (v_tenant, p_piece, p_objet, 'demandee', auth.uid(), 'cabinet', clock_timestamp());
        perform notif.emettre(v_tenant, 'piece.demande', jsonb_build_object('piece_id', p_piece, 'objet', p_objet));
      end if;
    elsif p_accorde and p_objet = 'rappel' then
      -- Rendue au siège, dans la société : à envoyer de nouveau.
      insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
      values (v_tenant, p_piece, 'rappelee', auth.uid(), app.prenom_au_moment(auth.uid()));
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid(), 'proprietaire'
       where (select d.fait from app.derniere_demande(p_piece, 'suppression', 'proprietaire') d)
             = 'demandee';
    end if;

    perform notif.emettre(v_tenant, 'piece.demande_tranchee', jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                               'note', p_note, 'chez', 'proprietaire',
                               'transmise', v_relayee), v_demandeur);

    if p_accorde and p_objet = 'suppression' and not v_relayee then
      perform public.capture_piece_supprimer(p_piece, true);
    end if;

    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                              'transmise', v_relayee);
  end if;

  -- Le comptable : repris de `20261029100000`, sur les demandes qui lui sont faites.
  if v_tenant not in (select app.engaged_orgs()) then
    raise exception 'refus.reserve.cabinet_mandate'
      using errcode = '42501';
  end if;

  select * into v_dernier from app.derniere_demande(p_piece, p_objet, 'cabinet');
  if v_dernier.fait is distinct from 'demandee' then
    raise exception 'refus.piece.aucune_demande'
      using errcode = 'check_violation';
  end if;
  -- Le droit de trancher est établi : le motif se nettoie et se borne, avant
  -- toute écriture (audit du 10 novembre 2026).
  p_note := app.motif_d_une_reponse(p_accorde, p_note);

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
  values (v_tenant, p_piece, p_objet,
          case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid(), 'cabinet');

  perform notif.emettre(v_tenant, 'piece.demande_tranchee', jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                             'note', p_note));

  -- La demande venait d'un siège, que son propriétaire a fait partir ici : il
  -- apprend la réponse. L'état par étape le dit (`transmise`).
  select e.demandeur into v_demandeur
    from app.etat_des_demandes(p_piece) e
   where e.objet = p_objet and e.etape = 'proprietaire' and e.transmise;
  if v_demandeur is not null then
    perform notif.emettre(v_tenant, 'piece.demande_tranchee', jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                               'note', p_note), v_demandeur);
  end if;

  if p_accorde then
    -- Prise en charge : son écriture se contre-passe au journal du jour, puis
    -- la pièce revient ou s'archive (spec §3).
    select e.id into v_vivante
      from socle.ecritures e
     where e.piece_id in (select app.versions_de_la_piece(p_piece))
       and e.nature = 'piece'
       and app.ecriture_vivante(e.id)
     limit 1;
    if v_vivante is not null then
      perform public.socle_ecriture_contre_passer(
        v_vivante, (select m.id from ref.rejet_motifs m where m.code = 'retrait_accorde'));
      update capture.pieces
         set status = app.statut_hors_retour(p_piece), updated_at = now()
       where id = p_piece;
    end if;

    if p_objet = 'rappel' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t, true);
      -- Rendue à la société ; la pièce d'un siège lui revient « à envoyer ».
      if v_demandeur is not null then
        insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
        values (v_tenant, p_piece, 'rappelee', auth.uid(), app.nom_au_moment(auth.uid()));
      end if;
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid(), 'cabinet'
       where (select d.fait from app.derniere_demande(p_piece, 'suppression', 'cabinet') d)
             = 'demandee';
    elsif p_objet = 'suppression' then
      perform public.capture_piece_supprimer(p_piece, true);
    end if;
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$function$;

-- public.piece_repondre_au_cabinet
CREATE OR REPLACE FUNCTION public.piece_repondre_au_cabinet(p_piece uuid, p_texte text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_au_proprietaire boolean;
begin
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  if v_tenant is null or v_tenant not in (select app.member_orgs())
     or not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  -- Jamais NULL : une pièce qui n'est jamais entrée dans le passage n'a
  -- personne à qui répondre (revue Codex de #146).
  v_au_proprietaire := coalesce(v_vis = 'entite'::app.vis_t
    and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'retournee', false);
  if v_vis <> 'partage'::app.vis_t and not v_au_proprietaire then
    raise exception 'refus.piece.non_partagee'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_texte), '') = '' then
    raise exception 'refus.reponse.vide' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.reponse_client', 'capture', 'pieces', p_piece,
          jsonb_build_object('texte', btrim(p_texte))
            -- Au propriétaire : un fait du passage interne.
            || case when v_au_proprietaire then jsonb_build_object('chez', 'proprietaire')
                    else '{}'::jsonb end);

  if v_au_proprietaire then
    perform app.notifier_les_receveurs(v_tenant, 'piece.reponse_client',
                                       jsonb_build_object('piece_id', p_piece,
                                                          'note', btrim(p_texte)));
  else
    perform notif.emettre(v_tenant, 'piece.reponse_client', jsonb_build_object('piece_id', p_piece, 'note', btrim(p_texte)));
  end if;

  return jsonb_build_object('piece_id', p_piece);
end
$function$;

-- public.piece_retourner
CREATE OR REPLACE FUNCTION public.piece_retourner(p_piece uuid, p_motif uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_auteur uuid;
  v_pack   uuid;
  v_vivante uuid;
  v_rev    uuid;
begin
  select tenant_id, vis, status, created_by into v_tenant, v_vis, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Le propriétaire, sur la pièce d'un siège qu'il a reçue.
  if v_vis = 'entite'::app.vis_t and v_tenant in (select app.member_orgs()) then
    if not app.a_le_droit(v_tenant, 'circuit.recevoir') or not app.piece_lisible(p_piece) then
      raise exception 'refus.introuvable.piece' using errcode = '42501';
    end if;
    if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
      raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
    end if;
    if (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee' then
      raise exception 'refus.retour.rien_recu' using errcode = 'check_violation';
    end if;
    perform app.exiger_un_motif_de_retour(p_motif, p_note);

    insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom, motif_id, note)
    values (v_tenant, p_piece, 'retournee', auth.uid(), app.prenom_au_moment(auth.uid()),
            p_motif, nullif(btrim(p_note), ''));

    perform notif.emettre(v_tenant, 'piece.retournee_par_le_proprietaire', jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                               'note', nullif(btrim(p_note), ''), 'chez', 'proprietaire'), v_auteur);

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, motif_id, payload)
    values (v_tenant, auth.uid(), 'piece.retournee_au_siege', 'capture', 'pieces', p_piece,
            p_motif, jsonb_build_object('note', nullif(btrim(p_note), ''), 'chez', 'proprietaire'));

    return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif, 'contre_passation', null,
                              'chez', 'siege');
  end if;

  if not app.supervise_le_dossier(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  if v_status = 'retournee' then
    raise exception 'refus.retour.deja' using errcode = 'check_violation';
  end if;

  perform app.exiger_un_motif_de_retour(p_motif, p_note);

  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.nature <> 'piece'
                and app.ecriture_vivante(e.id)) then
    raise exception 'refus.retour.inscrite' using errcode = 'check_violation';
  end if;

  select e.id into v_vivante
    from socle.ecritures e
   where e.piece_id in (select app.versions_de_la_piece(p_piece))
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_vivante is not null then
    v_rev := public.socle_ecriture_review(v_vivante, 'retourne', p_motif, p_note);
    return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                              'contre_passation', v_rev);
  end if;

  v_pack := app.pack_de_la_piece(p_piece);

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, p_piece, 'a_corriger'::app.verdict_t, p_motif, nullif(btrim(p_note), ''),
          v_pack, auth.uid());

  update capture.pieces set status = 'retournee', updated_at = now() where id = p_piece;

  perform notif.emettre(v_tenant, 'piece.retournee', jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                             'note', nullif(btrim(p_note), '')));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'piece.retournee', 'capture', 'pieces', p_piece, p_motif, v_pack,
          jsonb_build_object('note', nullif(btrim(p_note), ''), 'sans_ecriture', true));

  return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif, 'contre_passation', null);
end
$function$;

-- public.pv_envoyer
CREATE OR REPLACE FUNCTION public.pv_envoyer(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v collab.pv_reunions%rowtype;
  v_cabinet text;
begin
  select * into v from collab.pv_reunions where id = p_id for update;
  if v.id is null then
    raise exception 'refus.introuvable.proces_verbal' using errcode = 'P0002';
  end if;
  if v.cabinet_tenant_id not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.proces_verbal' using errcode = 'P0002';
  end if;
  if v.statut = 'envoye' then
    return jsonb_build_object('id', v.id, 'statut', v.statut, 'envoyeLe', v.envoye_le);
  end if;
  if v.client_tenant_id is null then
    raise exception 'refus.pv.sans_client'
      using errcode = '22023';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = v.cabinet_tenant_id
                    and e.pme_org_id = v.client_tenant_id
                    and e.status = 'actif') then
    raise exception 'refus.pv.mandat_inactif'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v.sections) = 0 then
    raise exception 'refus.pv.sans_texte'
      using errcode = '22023';
  end if;

  select name into v_cabinet from identity.organizations where id = v.cabinet_tenant_id;

  perform set_config('app.pv_envoi', 'oui', true);
  update collab.pv_reunions
     set statut = 'envoye', envoye_le = now()
   where id = p_id;

  -- Le journal du cabinet, et celui du mandat : les deux parties le voient.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.cabinet_tenant_id, auth.uid(), 'pv.envoye', 'collab', 'pv_reunions', v.id,
          jsonb_build_object('client_tenant_id', v.client_tenant_id, 'at', v.at,
                             'redige_par_malica', v.redige_par_malica));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.client_tenant_id, auth.uid(), 'pv.envoye', 'collab', 'pv_reunions', v.id,
          jsonb_build_object('cabinet_tenant_id', v.cabinet_tenant_id, 'at', v.at));

  perform notif.emettre(v.client_tenant_id, 'pv.envoye', jsonb_build_object('pv_id', v.id, 'titre', v.titre, 'at', v.at, 'cabinet', v_cabinet));

  return jsonb_build_object('id', v.id, 'statut', 'envoye', 'envoyeLe', now());
end $function$;

-- public.socle_ecriture_review
CREATE OR REPLACE FUNCTION public.socle_ecriture_review(p_ecriture uuid, p_outcome app.review_outcome_t, p_motif uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_status  text;
  v_rev     uuid;
  v_requires_note boolean;
  v_courante uuid;
begin
  select tenant_id, piece_id, pack_version_id, status
    into v_tenant, v_piece, v_pack, v_status
    from socle.ecritures where id = p_ecriture;
  -- Le verdict porte sur la pièce, donc sur sa version courante ; la
  -- contre-passation, elle, garde la pièce de l'écriture qu'elle annule.
  v_courante := app.version_courante(v_piece);

  if v_tenant is null then
    raise exception 'refus.introuvable.ecriture' using errcode = '42501';
  end if;
  -- La supervision est le second regard : elle revient à l'expert ou au
  -- collaborateur du cabinet engagé, jamais à l'assistant (ANO-CAB-006). Un
  -- membre de la société la garde seulement quand elle tient ses livres
  -- (dossier autonome, ou sans cabinet) : en mandat, elle ne valide ni ne
  -- contre-passe l'écriture du cabinet.
  if not app.peut_superviser(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_status <> 'booked' then
    raise exception 'refus.supervision.comptabilisee_seulement'
      using errcode = 'check_violation';
  end if;

  if p_outcome = 'retourne' then
    if p_motif is null then
      raise exception 'refus.motif.requis' using errcode = 'check_violation';
    end if;
    select requires_note into v_requires_note from ref.rejet_motifs
     where id = p_motif and usage = 'retour';
    if v_requires_note is null then
      raise exception 'refus.motif.inconnu' using errcode = 'check_violation';
    end if;
    if v_requires_note and coalesce(btrim(p_note), '') = '' then
      raise exception 'refus.motif.note_requise' using errcode = 'check_violation';
    end if;
  end if;

  update socle.ecritures
     set reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_outcome = p_outcome,
         review_motif_id = p_motif,
         review_note = p_note,
         updated_at = now()
   where id = p_ecriture;

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, v_courante,
          case when p_outcome = 'valide' then 'conforme'::app.verdict_t
               else 'a_corriger'::app.verdict_t end,
          p_motif, p_note, v_pack, auth.uid());

  if p_outcome = 'valide' then
    update capture.pieces set status = 'supervisee', updated_at = now()
     where id = v_courante;
  else
    v_rev := public.socle_ecriture_contre_passer(p_ecriture, p_motif);
    update capture.pieces set status = 'retournee', updated_at = now()
     where id = v_courante;
  end if;

  perform notif.emettre(v_tenant, case when p_outcome = 'valide' then 'piece.validee' else 'piece.retournee' end, jsonb_build_object('piece_id', v_courante, 'ecriture_id', p_ecriture,
                             'motif_id', p_motif, 'note', p_note));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(),
          case when p_outcome = 'valide' then 'ecriture.validee' else 'ecriture.retournee' end,
          'socle', 'ecritures', p_ecriture, p_motif, v_pack,
          jsonb_build_object('piece_id', v_piece, 'reversal_id', v_rev, 'note', p_note));

  return v_rev;
end $function$;

-- app.notifier_les_receveurs : chaque receveur du circuit, nommément.
create or replace function app.notifier_les_receveurs(p_tenant uuid, p_kind text, p_payload jsonb)
returns void
language sql
security definer
set search_path to ''
as $function$
  select notif.emettre(p_tenant, p_kind, p_payload, r)
    from app.receveurs_du_circuit(p_tenant) r
   where r is distinct from auth.uid()
     -- Seul un membre de la société prévient ses propriétaires.
     and p_tenant in (select app.member_orgs())
$function$;

-- collab.question_tranchee : une demande tranchée n'est plus à traiter, pour
-- personne. Un fait de plus par destinataire, au lieu d'une ligne réécrite.
create or replace function collab.question_tranchee()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_avant text;
  v_apres text;
  v_tenant uuid;
  v_kind text;
  v_cle text;
begin
  if tg_table_name = 'engagements' then
    v_avant := old.status; v_apres := new.status; v_tenant := new.pme_org_id;
    v_kind := 'mandat.propose'; v_cle := 'engagement_id';
  elsif tg_table_name = 'acces' then
    v_avant := old.statut; v_apres := new.statut; v_tenant := new.tenant_id;
    v_kind := 'acces.propose'; v_cle := 'acces_id';
  else
    v_avant := old.statut; v_apres := new.statut; v_tenant := new.tenant_id;
    v_kind := 'acces.descente_demandee'; v_cle := 'descente_id';
  end if;

  if v_avant = 'propose' and v_apres <> 'propose' then
    insert into notif.suites (envoi_id, tenant_id, destinataire, nature, issue)
    select e.id, e.tenant_id, e.destinataire, 'tranchee', v_apres
      from notif.envois e
     where e.tenant_id = v_tenant
       and e.canal = 'app'
       and e.code = v_kind
       and e.donnees ->> v_cle = new.id::text
    on conflict do nothing;
  end if;
  return new;
end
$function$;

-- collab.retour_tranche : une pièce retournée dont la pièce (ou une de ses
-- versions) disparaît n'est plus à lire.
create or replace function collab.retour_tranche()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  with recursive versions(id) as (
    select old.id
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  )
  insert into notif.suites (envoi_id, tenant_id, destinataire, nature)
  select e.id, e.tenant_id, e.destinataire, 'lue'
    from notif.envois e
   where e.tenant_id = old.tenant_id
     and e.canal = 'app'
     and e.code = 'piece.retournee'
     and e.donnees ->> 'piece_id' in (select v.id::text from versions v)
  on conflict do nothing;
  return null;
end
$function$;

-- public.notification_marquer_lue : une personne marque lue SA ligne, et elle seule.
create or replace function public.notification_marquer_lue(p_notification uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into notif.suites (envoi_id, tenant_id, destinataire, nature)
  select e.id, e.tenant_id, e.destinataire, 'lue'
    from notif.envois e
   where e.id = p_notification
     and e.canal = 'app'
     and e.destinataire = (select auth.uid())
  on conflict do nothing;

  if not exists (select 1 from notif.envois e
                  where e.id = p_notification and e.canal = 'app'
                    and e.destinataire = (select auth.uid())) then
    raise exception 'refus.introuvable.notification' using errcode = '42501';
  end if;
end
$function$;

-- notif.relancer_les_impayes : la porte du moteur, comme tout le reste.
CREATE OR REPLACE FUNCTION notif.relancer_les_impayes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r          record;
  v_reglage  jsonb := plateforme.relances_reglage();
  v_susp     numeric;
  v_tenant   uuid;
  v_n        integer;
  v_postes   integer := 0;
  v_retenues integer := 0;
  v_suspendues integer := 0;
  v_erreurs  integer := 0;
begin
  if not (v_reglage ->> 'actives')::boolean then
    return jsonb_build_object('actives', false);
  end if;
  -- Un seul ordonnanceur à la fois, même si deux API tournent.
  if not pg_try_advisory_xact_lock(hashtext('notif.relancer_les_impayes')) then
    return jsonb_build_object('actives', true, 'deja_en_cours', true);
  end if;

  select sp.value_num into v_susp from ref.socle_params sp
   where sp.code = 'recouvrement.suspension_jours'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  for r in
    select a.*, f.devise
      from facturation.a_relancer_v a
      join facturation.factures f on f.id = a.facture_id
     where a.palier is not null
  loop
    -- Une fois par facture et par palier, pour toujours : ce qui est décidé
    -- ne se redit pas, et un passage horaire n'inscrit rien de plus.
    if exists (select 1 from notif.envois e
                where e.destinataire = r.titulaire
                  and e.code = 'impaye.' || r.palier
                  and e.sujet_cle = r.facture_id::text || ':' || r.palier
                  and e.decision = 'a_remettre') then
      continue;
    end if;

    -- Au dernier palier, l'annonce dit que la licence EST suspendue : elle ne
    -- part que si c'est vrai — suspendue ici par la machine, ou déjà par la
    -- tour. Sinon la suspension reste le geste de la tour, et l'avis déjà
    -- envoyé suffit.
    if r.palier = 'suspension' then
      if r.statut_licence = 'active' and (v_reglage ->> 'suspension_automatique')::boolean then
        update facturation.licences
           set statut = 'suspendue', suspendue_le = now(), motif_suspension = 'impaye',
               updated_at = now()
         where id = r.licence_id and statut = 'active';
        insert into plateforme.interventions (licence_id, acte, motif, avant, operateur)
        values (r.licence_id, 'suspension',
                'Suspension automatique : facture ' || r.numero || ' due depuis '
                  || r.jours_de_retard || ' jours',
                'active', null);
        v_suspendues := v_suspendues + 1;
      elsif r.statut_licence <> 'suspendue' then
        v_retenues := v_retenues + 1;
        continue;
      end if;
    end if;

    select lo.tenant_id into v_tenant
      from facturation.licence_organisations lo
      join identity.memberships m on m.tenant_id = lo.tenant_id and m.user_id = r.titulaire
     where lo.licence_id = r.licence_id
     order by lo.tenant_id limit 1;

    -- Par courriel si la personne le veut ; sinon, dans l'application seule.
    begin
      -- Une seule porte : la ligne de l'application, et le courriel que la
      -- table des diffusions prévoit pour ce palier — avec les mêmes verrous.
      v_n := notif.emettre(
        v_tenant,
        'impaye.' || r.palier,
        jsonb_build_object(
          'numero', r.numero,
          'echeance', to_char(r.echeance_le, 'DD/MM/YYYY'),
          'reste', to_char(r.reste_du, 'FM999G999G990D000'),
          'devise', r.devise,
          'jours', r.jours_de_retard,
          'date_suspension', to_char(r.echeance_le + coalesce(v_susp, 0)::int, 'DD/MM/YYYY'),
          'en_attente', (select count(*) from capture.pieces p
                           join facturation.licence_organisations lo on lo.tenant_id = p.tenant_id
                          where lo.licence_id = r.licence_id and p.status = 'capturee'
                            and p.vis <> 'personnel'::app.vis_t)),
        r.titulaire,
        r.facture_id::text || ':' || r.palier,
        interval '400 days');
      if v_n > 0 then
        v_postes := v_postes + 1;
      else
        v_retenues := v_retenues + 1;
      end if;
    exception when others then
      v_erreurs := v_erreurs + 1;
    end;
  end loop;

  return jsonb_build_object('actives', true, 'postes', v_postes, 'retenues', v_retenues,
                            'suspendues', v_suspendues, 'erreurs', v_erreurs);
end
$function$;

commit;
