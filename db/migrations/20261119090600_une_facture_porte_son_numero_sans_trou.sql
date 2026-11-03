-- ======================================================================
--  Une facture porte son numéro sans trou (moteur commercial, 7/9 — plan du
--  2 novembre 2026, annexe F1 à F4, 2.3 ; décisions du dirigeant n° 4, 10).
--
--  CE QUI ÉTAIT FAUX, relevé sur la base :
--    * le numéro venait d'une séquence (`nextval`), qu'un rollback n'annule
--      pas : chaque émission ratée laissait un trou ; le préfixe `ALG-` était
--      écrit en dur dans deux fonctions ;
--    * une facture n'était protégée contre la réécriture que par l'absence de
--      droit : une porte (propriété du superutilisateur) pouvait la réécrire,
--      et ses lignes partaient en cascade ;
--    * le libellé d'une ligne était une phrase française, et le mois venait
--      de la locale du serveur (`TMMonth`) ;
--    * un seul avoir par facture était possible (l'index le refusait).
--
--  CE QUI LE REMPLACE :
--    * `facturation.compteurs_documents` : un compteur par émetteur, par
--      année et par série (facture, avoir). `numero_suivant` pose le verrou
--      de ligne (`for update`), avance d'un, et rien d'autre ne le touche
--      (`compteur_avance_d_un`, `deny_mutation`). Le numéro se prend EN
--      DERNIER, après tous les calculs et tous les refus, dans la même
--      transaction que la facture : un rollback le rend, deux émissions
--      concurrentes reçoivent deux rangs consécutifs. Forme du numéro :
--      `<trigramme de l'émetteur>-<FA|AV>-<année>-<rang>`, ALG-AV-2026-0001
--      pour un avoir (décision 10) ;
--    * l'identité de l'émetteur et du client, les taux, le timbre, la langue
--      sont COPIÉS sur la facture ; une facture émise ne change plus jamais
--      (`deny_mutation` sur la facture et ses lignes) ;
--    * chaque ligne porte sa nature (sens +1/−1), son gabarit et ses valeurs ;
--      son libellé est rendu dans la langue de la facture depuis `ref.labels`.
--      Les remises et les mois offerts sont des lignes, reliées au geste ;
--    * l'avoir est un document numéroté à part, plafonné par la facture ;
--      la décision « irrécouvrable » est une ligne de `facture_decisions`.
--
--  Le jour d'émission est le jour CIVIL de l'émetteur (son fuseau, sinon
--  celui de sa juridiction), jamais le jour UTC (#194) : l'année du numéro
--  est celle de ce jour, pas celle de la période facturée.
--
--  Les factures émises avant cette migration gardent leur numéro ; les
--  colonnes nouvelles y restent nulles. Seule une facture NOUVELLE doit les
--  porter (`facture_neuve_complete`).
-- ======================================================================

-- ------------------------------------------------------------ 1. Les paramètres du pack

-- Le code de TVA de la prestation d'ALGORIA (il était écrit dans la fonction)
-- et le timbre d'un avoir (INCERTAIN : dû, rendu ou ni l'un ni l'autre est
-- une question fiscale ouverte — docs/facturation/mentions-legales-2026-11-02.md).
insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, v.code, v.texte, v.num, v.reference, date '2026-01-01'
  from ref.jurisdiction_packs p
  cross join (values
    ('facture.code_tva', 'TVA19', null::numeric,
     'Code de la TVA, art. 7 : taux général applicable aux prestations de services'),
    ('avoir.droit_de_timbre', null, 0::numeric,
     'INCERTAIN : timbre d''un avoir non tranché ; à confirmer par un fiscaliste')
  ) as v(code, texte, num, reference)
 where p.jurisdiction = 'TN'
on conflict (pack_version_id, code, valid_from) do nothing;

-- ------------------------------------------------------------ 2. Le compteur

create table facturation.compteurs_documents (
  emetteur_organisation_id uuid not null references identity.organizations (id) on delete restrict,
  annee                    smallint not null check (annee between 2026 and 2100),
  nature                   text not null references ref.natures_document (code),
  prefixe                  text not null check (prefixe ~ '^[A-Z0-9]{1,6}-[A-Z]{1,6}$'),
  largeur                  smallint not null default 4 check (largeur between 4 and 8),
  dernier_rang             integer not null default 0 check (dernier_rang >= 0),
  ouvert_le                timestamptz not null default now(),
  primary key (emetteur_organisation_id, annee, nature)
);
comment on table facturation.compteurs_documents is
  'Le dernier rang de chaque série (émetteur, année, facture ou avoir). Avance d''un, jamais en '
  'arrière ; écrit par facturation.numero_suivant seulement, sous verrou de ligne.';
create index compteurs_documents_nature_fk_idx on facturation.compteurs_documents (nature);

alter table facturation.compteurs_documents enable row level security;
alter table facturation.compteurs_documents force row level security;
revoke all on table facturation.compteurs_documents from public, anon, service_role;
grant select on table facturation.compteurs_documents to authenticated;
create policy facturation_compteurs_documents_sel on facturation.compteurs_documents
  for select to authenticated using ((select app.is_platform()));
create policy service_hors_perimetre on facturation.compteurs_documents as restrictive
  for select to authenticated using ((select app.service()) is null);
create trigger service_hors_perimetre before insert or update or delete on facturation.compteurs_documents
  for each statement execute function app.service_hors_perimetre();

create function facturation.compteur_avance_d_un() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.dernier_rang <> old.dernier_rang + 1
     or new.emetteur_organisation_id <> old.emetteur_organisation_id
     or new.annee <> old.annee or new.nature <> old.nature
     or new.prefixe <> old.prefixe or new.largeur <> old.largeur
     or new.ouvert_le <> old.ouvert_le then
    raise exception 'refus.facture.compteur_fige' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger compteur_avance_d_un before update on facturation.compteurs_documents
  for each row execute function facturation.compteur_avance_d_un();
create trigger compteur_ne_s_efface_pas before delete on facturation.compteurs_documents
  for each row execute function app.deny_mutation();

/** Le rang suivant d'une série, sous verrou de ligne, et le numéro qu'il forme. */
create function facturation.numero_suivant(p_org uuid, p_annee smallint, p_nature text,
                                           out rang integer, out numero text)
language plpgsql security definer set search_path = '' as $$
declare
  c facturation.compteurs_documents;
begin
  insert into facturation.compteurs_documents (emetteur_organisation_id, annee, nature, prefixe)
  select p_org, p_annee, p_nature, facturation.trigramme(o.name) || '-' || n.prefixe_defaut
    from identity.organizations o, ref.natures_document n
   where o.id = p_org and n.code = p_nature
  on conflict (emetteur_organisation_id, annee, nature) do nothing;

  select * into c from facturation.compteurs_documents x
   where x.emetteur_organisation_id = p_org and x.annee = p_annee and x.nature = p_nature
     for update;
  if c.prefixe is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;

  update facturation.compteurs_documents x set dernier_rang = x.dernier_rang + 1
   where x.emetteur_organisation_id = p_org and x.annee = p_annee and x.nature = p_nature
  returning x.dernier_rang into rang;

  -- `largeur` est un MINIMUM : le 10 000e numéro garde ses cinq chiffres
  -- (lpad tronquerait, et redonnerait le numéro du rang 1 000 — revue Codex de #202).
  numero := c.prefixe || '-' || p_annee || '-'
            || lpad(rang::text, greatest(c.largeur, length(rang::text)), '0');
end
$$;
revoke all on function facturation.numero_suivant(uuid, smallint, text) from public, anon, authenticated;

-- ------------------------------------------------------------ 3. La facture

alter table facturation.factures
  add column nature                   text references ref.natures_document (code),
  add column annee                    smallint,
  add column rang                     integer,
  add column emetteur_id              uuid references facturation.emetteurs (id),
  add column emetteur_organisation_id uuid references identity.organizations (id),
  add column emetteur_nom             text,
  add column emetteur_matricule       text,
  add column emetteur_adresse         text,
  add column emetteur_juridiction     text,
  add column destinataire_adresse     text,
  add column langue                   text check (langue in ('fr', 'ar', 'en')),
  add column passe_id                 uuid,
  add column motif                    text,
  add column cle_idempotence          text unique,
  add column encaisse_a_l_emission    app.money_t not null default 0
    check (encaisse_a_l_emission::numeric >= 0);
comment on column facturation.factures.encaisse_a_l_emission is
  'Ce que la facture portait déjà de payé le jour de son émission (paiements en ligne imputés) : '
  'l''original du PDF le dit, et ne change plus quand d''autres encaissements suivent.';

update facturation.factures set nature = case when avoir_de is null then 'facture' else 'avoir' end;
alter table facturation.factures alter column nature set not null;

alter table facturation.factures
  add constraint factures_avoir_nomme_sa_facture check ((nature = 'avoir') = (avoir_de is not null)),
  add constraint factures_avoir_motive check (nature <> 'avoir' or motif is not null),
  add constraint factures_rang_dans_sa_serie unique (emetteur_organisation_id, nature, annee, rang);

drop index facturation.factures_une_par_payeur_et_periode;
create unique index factures_une_par_payeur_et_periode on facturation.factures
  (licence_id, periode, payeur_type, coalesce(payeur_tenant_id, payeur_personne))
  where nature = 'facture';
drop index facturation.factures_une_consolidee_par_cabinet_et_mois;
create unique index factures_une_consolidee_par_cabinet_et_mois on facturation.factures
  (payeur_tenant_id, periode) where licence_id is null and nature = 'facture';
create index factures_nature_fk_idx on facturation.factures (nature);
create index factures_emetteur_id_fk_idx on facturation.factures (emetteur_id);
create index factures_emetteur_organisation_id_fk_idx on facturation.factures (emetteur_organisation_id);
create index factures_passe_idx on facturation.factures (passe_id);

/** Une facture NOUVELLE porte son rang, son émetteur, sa langue ; son statut n'est plus une décision. */
create function facturation.facture_neuve_complete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.annee is null or new.rang is null or new.emetteur_id is null
     or new.emetteur_organisation_id is null or new.emetteur_nom is null
     or new.emetteur_juridiction is null or new.langue is null
     or new.statut <> 'emise' then
    raise exception 'refus.facture.incomplete' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger factures_neuve_complete before insert on facturation.factures
  for each row execute function facturation.facture_neuve_complete();
create trigger factures_ne_se_reecrivent_pas before update or delete on facturation.factures
  for each row execute function app.deny_mutation();

-- ------------------------------------------------------------ 4. Les lignes

alter table facturation.facture_lignes
  add column nature          text references ref.natures_ligne_facture (code),
  add column gabarit         text references ref.gabarits_de_ligne (code),
  add column valeurs         jsonb,
  add column intervention_id uuid references plateforme.interventions (id);

update facturation.facture_lignes set nature = case
    when libelle like 'Recharge%' then 'recharge'
    when libelle like 'Abonnement annuel%' then 'annuel'
    when libelle like 'Places et sociétés%' then 'places_et_societes'
    else 'abonnement' end;
alter table facturation.facture_lignes alter column nature set not null;

alter table facturation.facture_lignes drop constraint facture_lignes_facture_id_fkey;
alter table facturation.facture_lignes
  add constraint facture_lignes_facture_id_fkey foreign key (facture_id)
    references facturation.factures (id) on delete restrict,
  add constraint facture_lignes_geste_nomme
    check (nature not in ('remise', 'mois_offert') or intervention_id is not null);

create index facture_lignes_nature_fk_idx on facturation.facture_lignes (nature);
create index facture_lignes_gabarit_fk_idx on facturation.facture_lignes (gabarit);
create index facture_lignes_intervention_idx on facturation.facture_lignes (intervention_id)
  where intervention_id is not null;

/**
 * Le signe d'une ligne suit sa nature : une remise ne s'ajoute jamais. Et une
 * ligne qui nomme une licence et une société les nomme ensemble : la société
 * est rattachée à cette licence (la politique d'insertion le tenait ; il n'y a
 * plus de politique d'insertion).
 */
create function facturation.ligne_a_le_sens_de_sa_nature() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.licence_id is not null and new.tenant_id is not null
     and not exists (select 1 from facturation.licence_organisations lo
                      where lo.licence_id = new.licence_id and lo.tenant_id = new.tenant_id) then
    raise exception 'refus.facture.ligne_hors_licence' using errcode = 'check_violation';
  end if;
  if sign(new.montant_ht::numeric) not in (0, (select n.sens from ref.natures_ligne_facture n
                                                where n.code = new.nature)) then
    raise exception 'refus.facture.sens_de_ligne' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger facture_lignes_sens before insert on facturation.facture_lignes
  for each row execute function facturation.ligne_a_le_sens_de_sa_nature();
create trigger facture_lignes_ne_se_reecrivent_pas before update or delete on facturation.facture_lignes
  for each row execute function app.deny_mutation();

-- ------------------------------------------------------------ 5. Les décisions sur facture

create table facturation.facture_decisions (
  id         uuid primary key default gen_random_uuid(),
  facture_id uuid not null references facturation.factures (id) on delete restrict,
  decision   text not null references ref.decisions_facture (code),
  motif      text not null check (length(btrim(motif)) > 0),
  decide_par uuid not null references auth.users (id),
  decide_le  timestamptz not null default now()
);
create index facture_decisions_facture_idx on facturation.facture_decisions (facture_id, decide_le desc);
create index facture_decisions_decision_fk_idx on facturation.facture_decisions (decision);
create index facture_decisions_decide_par_idx on facturation.facture_decisions (decide_par);

alter table facturation.facture_decisions enable row level security;
alter table facturation.facture_decisions force row level security;
revoke all on table facturation.facture_decisions from public, anon, service_role;
grant select on table facturation.facture_decisions to authenticated;
create policy facturation_facture_decisions_sel on facturation.facture_decisions
  for select to authenticated using (facture_id in (select facturation.factures_lisibles()));
create policy service_hors_perimetre on facturation.facture_decisions as restrictive
  for select to authenticated using ((select app.service()) is null);
create trigger service_hors_perimetre before insert or update or delete on facturation.facture_decisions
  for each statement execute function app.service_hors_perimetre();
create trigger facture_decisions_ajout_seul before update or delete on facturation.facture_decisions
  for each row execute function app.deny_mutation();

-- ------------------------------------------------------------ 6. Les briques de l'émission


/** L'émetteur en vigueur et tout ce qu'une facture en recopie. Aucun repli (R4). */
create function facturation.emetteur_en_vigueur(
  out emetteur_id uuid, out organisation_id uuid, out nom text, out matricule text,
  out adresse text, out juridiction text, out devise text, out pack uuid,
  out jour date, out taux numeric, out timbre numeric, out timbre_avoir numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_code text;
begin
  select e.id, o.id, o.name, o.legal_id, o.adresse, o.jurisdiction, o.currency
    into emetteur_id, organisation_id, nom, matricule, adresse, juridiction, devise
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   -- Le jour de CHAQUE émetteur candidat, dans son fuseau (#194) : un émetteur
   -- valable dès le 1er l'est dès 00 h 00 à Tunis, pas à 01 h 00.
   where e.valide_des <= facturation.jour_de_l_organisation(e.organisation_id)
   order by e.valide_des desc limit 1;
  if emetteur_id is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;
  jour := facturation.jour_de_l_organisation(organisation_id);

  select p.id into pack from ref.jurisdiction_packs p
   where p.jurisdiction = juridiction and p.effective_from <= jour
     and (p.effective_to is null or p.effective_to >= jour)
   order by p.effective_from desc limit 1;

  select sp.value_text into v_code from ref.socle_params sp
   where sp.pack_version_id = pack and sp.code = 'facture.code_tva'
     and sp.valid_from <= jour and (sp.valid_to is null or sp.valid_to >= jour)
   order by sp.valid_from desc limit 1;
  select r.rate into taux from ref.tva_rates r
   where r.pack_version_id = pack and r.code = v_code
     and r.valid_from <= jour and (r.valid_to is null or r.valid_to >= jour)
   order by r.valid_from desc limit 1;
  select coalesce(sp.value_num, sp.value_text::numeric) into timbre from ref.socle_params sp
   where sp.pack_version_id = pack and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= jour and (sp.valid_to is null or sp.valid_to >= jour)
   order by sp.valid_from desc limit 1;
  select coalesce(sp.value_num, sp.value_text::numeric) into timbre_avoir from ref.socle_params sp
   where sp.pack_version_id = pack and sp.code = 'avoir.droit_de_timbre'
     and sp.valid_from <= jour and (sp.valid_to is null or sp.valid_to >= jour)
   order by sp.valid_from desc limit 1;

  if pack is null or taux is null or timbre is null or timbre_avoir is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;
end
$$;
revoke all on function facturation.emetteur_en_vigueur() from public, anon, authenticated;

/** Le libellé d'une ligne, rendu depuis son gabarit dans la langue de la facture. */
create function facturation.libelle_rendu(p_gabarit text, p_valeurs jsonb, p_langue text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_texte text;
  k       text;
  v       text;
begin
  select l.value into v_texte from ref.labels l
   where l.ns = 'facture_ligne' and l.key = p_gabarit and l.locale = p_langue;
  if v_texte is null then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.libelle_absent',
                                                'gabarit', p_gabarit, 'langue', p_langue)
      using errcode = 'no_data_found';
  end if;
  for k, v in select * from jsonb_each_text(coalesce(p_valeurs, '{}'::jsonb)) loop
    if k = 'mois' then
      select l.value into v from ref.labels l
       where l.ns = 'mois' and l.key = v and l.locale = p_langue;
    end if;
    v_texte := replace(v_texte, '{' || k || '}', coalesce(v, ''));
  end loop;
  return v_texte;
end
$$;
revoke all on function facturation.libelle_rendu(text, jsonb, text) from public, anon;
grant execute on function facturation.libelle_rendu(text, jsonb, text) to authenticated;

/** La langue d'un destinataire : la personne, ou le premier expert du cabinet. */
create function facturation.langue_du_payeur(p_type text, p_tenant uuid, p_personne uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.locale from identity.profiles p
      where p.user_id = case when p_type = 'titulaire' then p_personne end),
    (select p.locale from identity.memberships m
       join identity.profiles p on p.user_id = m.user_id
      where p_type = 'cabinet' and m.tenant_id = p_tenant and m.role = 'expert'
      order by m.created_at, m.user_id limit 1),
    'fr')
$$;
revoke all on function facturation.langue_du_payeur(text, uuid, uuid) from public, anon, authenticated;

/** Une ligne : sa nature vient de son gabarit, son libellé est rendu dans la langue de la facture. */
create function facturation.ligne_inscrire(
  p_facture uuid, p_ordinal smallint, p_gabarit text, p_valeurs jsonb, p_quantite numeric,
  p_prix numeric, p_montant numeric, p_licence uuid, p_tenant uuid, p_geste uuid, p_langue text)
returns void
language sql security definer set search_path = '' as $$
  insert into facturation.facture_lignes
    (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht, licence_id, tenant_id,
     nature, gabarit, valeurs, intervention_id)
  select p_facture, p_ordinal, facturation.libelle_rendu(p_gabarit, p_valeurs, p_langue),
         p_quantite, p_prix, p_montant, p_licence, p_tenant, g.nature, p_gabarit, p_valeurs, p_geste
    from ref.gabarits_de_ligne g where g.code = p_gabarit
$$;
revoke all on function facturation.ligne_inscrire(uuid, smallint, text, jsonb, numeric, numeric, numeric, uuid, uuid, uuid, text)
  from public, anon, authenticated;

/**
 * Les gestes qui s'appliquent à une part d'abonnement : les mois offerts
 * d'abord (la part tombe à zéro), puis la remise sur ce qui reste. Pure :
 * l'aperçu et l'émission la lisent tous les deux (R12).
 */
create function facturation.gestes_a_appliquer(
  p_licence uuid, p_payeur_type text, p_periode date, p_base numeric)
returns table(intervention_id uuid, gabarit text, valeurs jsonb, montant numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  g        record;
  v_reste  numeric := p_base;
  v_moins  numeric;
  v_mois   jsonb := jsonb_build_object('mois', extract(month from p_periode)::int,
                                       'annee', extract(year from p_periode)::int);
begin
  if p_base <= 0 then
    return;
  end if;
  for g in
    select i.id, i.acte, i.valeur from plateforme.interventions i
     where i.licence_id = p_licence and i.payeur_type = p_payeur_type
       and i.acte in ('mois_offerts', 'remise_pourcentage', 'remise_montant')
       and i.effet_du <= p_periode and i.effet_au >= p_periode
       and plateforme.geste_en_vigueur(i.id)
     order by case i.acte when 'mois_offerts' then 0 else 1 end, i.created_at
  loop
    exit when v_reste <= 0;
    v_moins := case g.acte
                 when 'mois_offerts' then v_reste
                 when 'remise_pourcentage' then round(v_reste * g.valeur / 100, 3)
                 else least(g.valeur, v_reste) end;
    continue when v_moins <= 0;
    v_reste := v_reste - v_moins;
    intervention_id := g.id;
    gabarit := case g.acte when 'mois_offerts' then 'mois_offert' else g.acte end;
    valeurs := v_mois || case when g.acte = 'remise_pourcentage'
                              then jsonb_build_object('taux', trim_scale(g.valeur)::text)
                              else '{}'::jsonb end;
    montant := -v_moins;
    return next;
  end loop;
end
$$;
revoke all on function facturation.gestes_a_appliquer(uuid, text, date, numeric) from public, anon, authenticated;

/** Le rang précédent de la série ne porte pas une date postérieure. */
create function facturation.chronologie_tenue(p_org uuid, p_nature text, p_annee smallint, p_jour date)
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from facturation.factures f
              where f.emetteur_organisation_id = p_org and f.nature = p_nature
                and f.annee = p_annee and f.emise_le > p_jour) then
    raise exception 'refus.facture.chronologie' using errcode = 'check_violation';
  end if;
end
$$;
revoke all on function facturation.chronologie_tenue(uuid, text, smallint, date) from public, anon, authenticated;

-- ------------------------------------------------------------ 7. L'émission d'une licence

drop function facturation.emettre(uuid, date, integer);

create function facturation.emettre(p_licence uuid, p_periode date, p_passe uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c          record;
  em         record;
  rf         plateforme.reglages_facturation;
  l          record;
  g          record;
  v_sieges   smallint;
  v_tva      app.money_t;
  v_nom      text;
  v_legal    text;
  v_adresse  text;
  v_langue   text;
  v_num      record;
  v_id       uuid;
  v_faites   jsonb := '[]'::jsonb;
  v_premiere uuid;
  v_premier  text;
  v_ttc      app.money_t := 0;
  v_ht       numeric;
  v_gestes   numeric;
  v_recharge record;
  v_ordinal  smallint;
  v_paiement record;
  v_enc      uuid;
  v_annuel   facturation.engagements_annuels;
  v_debut    facturation.engagements_annuels;
  v_mois     numeric;
  v_recharges numeric;
  v_deja_paye numeric;
  v_couvert  text := null;
  v_par_cabinet boolean := false;
  v_valeurs_mois jsonb := jsonb_build_object('mois', extract(month from p_periode)::int,
                                             'annee', extract(year from p_periode)::int);
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;

  -- La licence d'abord, le compteur ensuite : l'ordre évite les interblocages.
  perform 1 from facturation.licences where id = p_licence for update;
  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;

  select * into em from facturation.emetteur_en_vigueur();
  rf := plateforme.reglage_facturation();
  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;

  for l in
    select a.* from facturation.a_facturer(p_licence, p_periode) a
    union all
    -- Un mois tout en essai n'a pas de part du titulaire, mais une recharge
    -- achetée ou une année qui commence se facturent quand même.
    select 'titulaire', null::uuid, li.titulaire, li.offre_code, null::text, 0, 0, 0::app.money_t
      from facturation.licences li
     where li.id = p_licence
       and not exists (select 1 from facturation.a_facturer(p_licence, p_periode) x
                        where x.payeur_type = 'titulaire')
       and (exists (select 1 from facturation.recharges x
                     where x.licence_id = p_licence
                       and x.achetee_le < (p_periode + interval '1 month')::date
                       and not exists (select 1 from facturation.facture_recharges fr
                                        where fr.recharge_id = x.id))
            or exists (select 1 from facturation.engagements_annuels e
                        where e.licence_id = p_licence and e.du = p_periode
                          and not exists (select 1 from facturation.facture_annuels fa
                                           where fa.engagement_id = e.id)))
    order by 1
  loop
    -- La part d'un CABINET entre dans la facture mensuelle unique du cabinet.
    if l.payeur_type = 'cabinet' then
      v_par_cabinet := true;
      continue;
    end if;

    if exists (select 1 from facturation.factures f
                where f.nature = 'facture' and f.licence_id = p_licence and f.periode = p_periode
                  and f.payeur_type = l.payeur_type and f.payeur_personne = l.payeur_personne) then
      raise exception '%', app.refus_avec_valeurs('refus.facturation.deja_emise', 'periode', (p_periode)::text)
        using errcode = 'unique_violation';
    end if;

    select p.display_name, null::text, null::text into v_nom, v_legal, v_adresse
      from identity.profiles p where p.user_id = l.payeur_personne;
    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        '%', app.refus_avec_valeurs('refus.facturation.destinataire_sans_nom', 'destinataire', (l.payeur_personne)::text)
        using errcode = 'no_data_found';
    end if;
    v_langue := facturation.langue_du_payeur(l.payeur_type, l.payeur_tenant_id, l.payeur_personne);

    -- L'ANNÉE : un mois couvert par l'engagement ne porte que les places et
    -- sociétés en plus ; le mois où l'année commence porte sa ligne, une fois.
    v_mois   := l.montant_ht;
    v_annuel := facturation.annuel_de(p_licence, p_periode);
    if v_annuel.id is not null then
      v_mois := greatest(0, l.montant_ht
                            - round(v_annuel.prix_mensuel_ht * l.jours / nullif(l.jours_du_mois, 0), 3));
    end if;
    select e.* into v_debut from facturation.engagements_annuels e
     where e.licence_id = p_licence and e.du = p_periode
       and not exists (select 1 from facturation.facture_annuels fa where fa.engagement_id = e.id)
     order by e.souscrit_le limit 1;
    select coalesce(sum(x.prix_ht), 0) into v_recharges
      from facturation.recharges x
     where x.licence_id = p_licence
       and x.achetee_le < (p_periode + interval '1 month')::date
       and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
    select coalesce(sum(ga.montant), 0) into v_gestes
      from facturation.gestes_a_appliquer(p_licence, 'titulaire', p_periode, v_mois) ga;

    v_ht := v_mois + v_gestes + coalesce(v_debut.montant_ht, 0) + v_recharges;

    -- Rien à payer : aucune facture, donc aucun timbre. L'essai, l'année ou
    -- un geste de la tour le disent.
    if v_ht = 0 then
      v_couvert := case when v_gestes < 0 then 'offerte'
                        when v_annuel.id is not null then 'annuel'
                        when facturation.jours_d_essai(p_licence, p_periode) > 0 then 'essai'
                        else coalesce(v_couvert, 'rien') end;
      continue;
    end if;

    v_tva := round(v_ht * em.taux, 3);

    -- Ce que les paiements en ligne non imputés vont porter sur la facture :
    -- l'original le dit, figé (la boucle d'imputation, plus bas, les inscrit).
    select coalesce(sum(p.montant_ttc), 0) into v_deja_paye
      from facturation.paiements_en_ligne p
     where p.licence_id = p_licence and p.objet <> 'facture'
       and exists (select 1 from facturation.paiement_evenements e
                    join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                             and pp.fait_entrer_argent
                   where e.paiement_id = p.id and e.etat = 'paye')
       and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id);

    -- Le numéro EN DERNIER : tout ce qui pouvait refuser a refusé.
    perform facturation.chronologie_tenue(em.organisation_id, 'facture',
                                          extract(year from em.jour)::smallint, em.jour);
    select * into v_num from facturation.numero_suivant(em.organisation_id,
                                                        extract(year from em.jour)::smallint, 'facture');

    insert into facturation.factures
      (licence_id, numero, periode, emise_le, echeance_le, offre_code,
       organisations, sieges_payants, montant_ht, taux_tva, montant_tva,
       timbre, montant_ttc, devise,
       payeur_type, payeur_tenant_id, payeur_personne,
       destinataire_nom, destinataire_legal_id, destinataire_adresse, reference_abonne,
       nature, annee, rang, emetteur_id, emetteur_organisation_id, emetteur_nom,
       emetteur_matricule, emetteur_adresse, emetteur_juridiction, langue, passe_id,
       encaisse_a_l_emission)
    values
      (p_licence, v_num.numero, p_periode, em.jour, em.jour + rf.jours_echeance, l.offre_code,
       c.organisations, v_sieges, v_ht, em.taux, v_tva, em.timbre,
       v_ht + v_tva + em.timbre, em.devise,
       l.payeur_type, l.payeur_tenant_id, l.payeur_personne,
       v_nom, v_legal, v_adresse, l.acces_reference,
       'facture', extract(year from em.jour)::smallint, v_num.rang, em.emetteur_id,
       em.organisation_id, em.nom, em.matricule, em.adresse, em.juridiction, v_langue, p_passe,
       v_deja_paye)
    returning id into v_id;

    v_ordinal := 0;
    if v_annuel.id is null and l.montant_ht > 0 then
      v_ordinal := v_ordinal + 1;
      perform facturation.ligne_inscrire(v_id, v_ordinal, 'abonnement',
        v_valeurs_mois || jsonb_build_object('offre', (select o.libelle from ref.offre_codes o where o.code = l.offre_code),
                                             'jours', l.jours, 'jours_du_mois', l.jours_du_mois),
        1, l.montant_ht, l.montant_ht, null, null, null, v_langue);
    elsif v_mois > 0 then
      v_ordinal := v_ordinal + 1;
      perform facturation.ligne_inscrire(v_id, v_ordinal, 'places_et_societes', v_valeurs_mois,
                                         1, v_mois, v_mois, null, null, null, v_langue);
    end if;

    for g in select * from facturation.gestes_a_appliquer(p_licence, 'titulaire', p_periode, v_mois) loop
      v_ordinal := v_ordinal + 1;
      perform facturation.ligne_inscrire(v_id, v_ordinal, g.gabarit, g.valeurs, 1, g.montant,
                                         g.montant, null, null, g.intervention_id, v_langue);
    end loop;

    if v_debut.id is not null then
      v_ordinal := v_ordinal + 1;
      perform facturation.ligne_inscrire(v_id, v_ordinal, 'annuel',
        jsonb_build_object('offre', (select o.libelle from ref.offre_codes o where o.code = v_debut.offre_code),
                           'du', to_char(v_debut.du, 'DD/MM/YYYY'),
                           'au', to_char(v_debut.au, 'DD/MM/YYYY'),
                           'mois_offerts', v_debut.mois_offerts),
        1, v_debut.montant_ht, v_debut.montant_ht, null, null, null, v_langue);
      insert into facturation.facture_annuels (facture_id, engagement_id) values (v_id, v_debut.id);
    end if;

    for v_recharge in
      select x.id, x.lectures, x.prix_ht, x.achetee_le, x.origine
        from facturation.recharges x
       where x.licence_id = p_licence
         and x.achetee_le < (p_periode + interval '1 month')::date
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id)
       order by x.achetee_le, x.id
    loop
      v_ordinal := v_ordinal + 1;
      perform facturation.ligne_inscrire(v_id, v_ordinal,
        case when v_recharge.origine = 'automatique' then 'recharge_automatique' else 'recharge' end,
        jsonb_build_object('lectures', v_recharge.lectures,
                           'le', to_char(v_recharge.achetee_le, 'DD/MM/YYYY')),
        1, v_recharge.prix_ht, v_recharge.prix_ht, null, null, null, v_langue);
      insert into facturation.facture_recharges (facture_id, recharge_id) values (v_id, v_recharge.id);
    end loop;

    if (select sum(x.montant_ht) from facturation.facture_lignes x where x.facture_id = v_id) <> v_ht then
      raise exception 'refus.facture.total_incoherent' using errcode = 'check_violation';
    end if;

    for v_paiement in
      select p.id, p.montant_ttc, e.reference, e.prestataire, e.le::date as le,
             facturation.moyen_encaissement_du_paiement(p.id) as moyen
        from facturation.paiements_en_ligne p
        join facturation.paiement_evenements e on e.paiement_id = p.id and e.etat = 'paye'
        join facturation.prestataires_paiement pp on pp.code = e.prestataire
                                                 and pp.fait_entrer_argent
       where p.licence_id = p_licence
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

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    select lo.tenant_id, auth.uid(), 'facture.emise', 'facturation', 'factures', v_id,
           jsonb_build_object('numero', v_num.numero, 'periode', p_periode,
                              'ttc', v_ht + v_tva + em.timbre)
      from facturation.licence_organisations lo where lo.licence_id = p_licence
     order by lo.tenant_id limit 1;

    if v_premiere is null then
      v_premiere := v_id;
      v_premier  := v_num.numero;
    end if;
    v_ttc    := v_ttc + v_ht + v_tva + em.timbre;
    v_faites := v_faites || jsonb_build_object(
                  'facture_id', v_id, 'numero', v_num.numero,
                  'payeur_type', l.payeur_type, 'payeur', l.payeur_personne,
                  'destinataire', v_nom, 'offre_code', l.offre_code,
                  'jours', l.jours, 'jours_du_mois', l.jours_du_mois,
                  'ht', v_ht, 'ttc', v_ht + v_tva + em.timbre);
  end loop;

  if jsonb_array_length(v_faites) = 0 then
    if v_couvert is not null and v_couvert <> 'rien' then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', v_couvert);
    end if;
    if v_par_cabinet then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', 'cabinet');
    end if;
    if facturation.jours_d_essai(p_licence, p_periode) > 0 then
      return jsonb_build_object('facture_id', null, 'numero', null, 'ttc', 0,
                                'factures', '[]'::jsonb, 'couvert_par', 'essai');
    end if;
    raise exception
      '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text)
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
                            'factures', v_faites);
end
$$;
comment on function facturation.emettre(uuid, date, uuid) is
  'Émet les factures d''une licence pour un mois, une par payeur (la part d''un cabinet entre dans '
  'sa facture mensuelle). Numéro sans trou pris en dernier ; identité de l''émetteur et du client '
  'recopiées ; mois offerts et remises de la tour en lignes reliées au geste. Rien à payer : '
  'aucune facture, `couvert_par` dit pourquoi (essai, offerte, annuel, cabinet).';
revoke all on function facturation.emettre(uuid, date, uuid) from public, anon;
grant execute on function facturation.emettre(uuid, date, uuid) to authenticated;

-- ------------------------------------------------------------ 8. La facture mensuelle du cabinet

drop function facturation.emettre_cabinet(uuid, date, integer);

create function facturation.emettre_cabinet(p_cabinet uuid, p_periode date, p_passe uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  em         record;
  rf         plateforme.reglages_facturation;
  v_ht       numeric := 0;
  v_tva      app.money_t;
  v_nb       integer := 0;
  v_nom      text;
  v_legal    text;
  v_adresse  text;
  v_langue   text;
  v_num      record;
  v_id       uuid;
  l          record;
  g          record;
  v_ordinal  smallint := 0;
  v_gestes   numeric := 0;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;
  if exists (select 1 from facturation.factures f
              where f.payeur_tenant_id = p_cabinet and f.periode = p_periode
                and f.licence_id is null and f.nature = 'facture') then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.deja_emise', 'periode', (p_periode)::text)
      using errcode = 'unique_violation';
  end if;

  select o.name, o.legal_id, o.adresse into v_nom, v_legal, v_adresse
    from identity.organizations o where o.id = p_cabinet and o.kind = 'cabinet';
  if v_nom is null then
    raise exception 'refus.introuvable.cabinet' using errcode = 'no_data_found';
  end if;

  select * into em from facturation.emetteur_en_vigueur();
  rf := plateforme.reglage_facturation();
  v_langue := facturation.langue_du_payeur('cabinet', p_cabinet, null);

  for l in select * from facturation.a_facturer_cabinet(p_cabinet, p_periode) a where a.montant_ht > 0 loop
    v_nb := v_nb + 1;
    v_ht := v_ht + l.montant_ht;
    select v_gestes + coalesce(sum(ga.montant), 0) into v_gestes
      from facturation.gestes_a_appliquer(l.licence_id, 'cabinet', p_periode, l.montant_ht) ga;
  end loop;
  v_ht := v_ht + v_gestes;
  if v_nb = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text)
      using errcode = 'no_data_found';
  end if;
  if v_ht = 0 then
    return jsonb_build_object('facture_id', null, 'numero', null, 'lignes', v_nb, 'ht', 0,
                              'ttc', 0, 'couvert_par', 'offerte');
  end if;

  v_tva := round(v_ht * em.taux, 3);
  perform facturation.chronologie_tenue(em.organisation_id, 'facture',
                                        extract(year from em.jour)::smallint, em.jour);
  select * into v_num from facturation.numero_suivant(em.organisation_id,
                                                      extract(year from em.jour)::smallint, 'facture');

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations, sieges_payants,
     montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id,
     destinataire_adresse, nature, annee, rang, emetteur_id, emetteur_organisation_id,
     emetteur_nom, emetteur_matricule, emetteur_adresse, emetteur_juridiction, langue, passe_id)
  values
    (null, v_num.numero, p_periode, em.jour, em.jour + rf.jours_echeance, null, v_nb, 0,
     v_ht, em.taux, v_tva, em.timbre, v_ht + v_tva + em.timbre, em.devise,
     'cabinet', p_cabinet, null, v_nom, v_legal, v_adresse,
     'facture', extract(year from em.jour)::smallint, v_num.rang, em.emetteur_id,
     em.organisation_id, em.nom, em.matricule, em.adresse, em.juridiction, v_langue, p_passe)
  returning id into v_id;

  for l in
    select * from facturation.a_facturer_cabinet(p_cabinet, p_periode) a
     where a.montant_ht > 0 order by a.organisation, a.licence_id
  loop
    v_ordinal := v_ordinal + 1;
    perform facturation.ligne_inscrire(v_id, v_ordinal, 'abonnement_cabinet',
      jsonb_build_object('offre', (select o.libelle from ref.offre_codes o where o.code = l.offre_code),
                         'organisation', l.organisation,
                         'reference', coalesce(' (' || l.reference || ')', ''),
                         'mois', extract(month from p_periode)::int,
                         'annee', extract(year from p_periode)::int,
                         'jours', l.jours, 'jours_du_mois', l.jours_du_mois),
      1, l.montant_ht, l.montant_ht, l.licence_id, l.tenant_id, null, v_langue);
    for g in select * from facturation.gestes_a_appliquer(l.licence_id, 'cabinet', p_periode, l.montant_ht) loop
      v_ordinal := v_ordinal + 1;
      perform facturation.ligne_inscrire(v_id, v_ordinal, g.gabarit, g.valeurs, 1, g.montant,
                                         g.montant, l.licence_id, l.tenant_id, g.intervention_id, v_langue);
    end loop;
  end loop;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'facture.emise', 'facturation', 'factures', v_id,
          jsonb_build_object('numero', v_num.numero, 'periode', p_periode, 'lignes', v_nb,
                             'ttc', v_ht + v_tva + em.timbre));
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_cabinet, 'facture.emise',
          jsonb_build_object('facture_id', v_id, 'numero', v_num.numero, 'ttc', v_ht + v_tva + em.timbre));

  return jsonb_build_object('facture_id', v_id, 'numero', v_num.numero, 'lignes', v_nb,
                            'ht', v_ht, 'ttc', v_ht + v_tva + em.timbre);
end
$$;
comment on function facturation.emettre_cabinet(uuid, date, uuid) is
  'La facture mensuelle unique d''un cabinet : une ligne par licence dotée, ses gestes en lignes, '
  'un seul timbre. Même numérotation sans trou que facturation.emettre.';
revoke all on function facturation.emettre_cabinet(uuid, date, uuid) from public, anon;
grant execute on function facturation.emettre_cabinet(uuid, date, uuid) to authenticated;

-- ------------------------------------------------------------ 9. L'avoir, la décision, l'annulation d'un geste

create function plateforme.avoir_emettre(
  p_facture uuid, p_montant_ht numeric, p_motif text, p_cle text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f        facturation.factures;
  em       record;
  v_deja   record;
  v_ht     numeric;
  v_tva    numeric;
  v_num    record;
  v_id     uuid;
  v_jour   date;
  l        record;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.commerce.motif_requis' using errcode = 'check_violation';
  end if;
  if p_cle is not null then
    select x.id, x.numero, x.avoir_de into v_deja from facturation.factures x where x.cle_idempotence = p_cle;
    if v_deja.id is not null then
      if v_deja.avoir_de is distinct from p_facture then
        raise exception 'refus.commerce.cle_deja_prise' using errcode = 'unique_violation';
      end if;
      return jsonb_build_object('facture_id', v_deja.id, 'numero', v_deja.numero, 'deja', true);
    end if;
  end if;

  -- Le verrou de la facture sérialise deux avoirs concurrents.
  select * into f from facturation.factures where id = p_facture for update;
  if f.id is null or f.nature <> 'facture' then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;
  if f.emetteur_organisation_id is null then
    raise exception 'refus.facture.avant_la_numerotation' using errcode = 'check_violation';
  end if;

  select coalesce(sum(a.montant_ht), 0) as ht, coalesce(sum(a.montant_tva), 0) as tva into v_deja
    from facturation.factures a where a.avoir_de = p_facture;
  if p_montant_ht is null then
    v_ht  := f.montant_ht - v_deja.ht;
    v_tva := f.montant_tva - v_deja.tva;
  else
    v_ht  := p_montant_ht;
    v_tva := round(p_montant_ht * f.taux_tva, 3);
  end if;
  if v_ht <= 0 or v_deja.ht + v_ht > f.montant_ht or v_deja.tva + v_tva > f.montant_tva then
    raise exception '%', app.refus_avec_valeurs('refus.facture.avoir_au_dela',
                                                'reste', (f.montant_ht - v_deja.ht)::text)
      using errcode = 'check_violation';
  end if;

  select * into em from facturation.emetteur_en_vigueur();
  v_jour := facturation.jour_de_l_organisation(f.emetteur_organisation_id);
  perform facturation.chronologie_tenue(f.emetteur_organisation_id, 'avoir',
                                        extract(year from v_jour)::smallint, v_jour);
  select * into v_num from facturation.numero_suivant(f.emetteur_organisation_id,
                                                      extract(year from v_jour)::smallint, 'avoir');

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations, sieges_payants,
     montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise, avoir_de,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id,
     destinataire_adresse, reference_abonne, nature, annee, rang, emetteur_id,
     emetteur_organisation_id, emetteur_nom, emetteur_matricule, emetteur_adresse,
     emetteur_juridiction, langue, motif, cle_idempotence)
  values
    (f.licence_id, v_num.numero, f.periode, v_jour, v_jour, f.offre_code, f.organisations,
     f.sieges_payants, v_ht, f.taux_tva, v_tva, em.timbre_avoir, v_ht + v_tva + em.timbre_avoir,
     f.devise, f.id, f.payeur_type, f.payeur_tenant_id, f.payeur_personne, f.destinataire_nom,
     f.destinataire_legal_id, f.destinataire_adresse, f.reference_abonne, 'avoir',
     extract(year from v_jour)::smallint, v_num.rang, f.emetteur_id, f.emetteur_organisation_id,
     f.emetteur_nom, f.emetteur_matricule, f.emetteur_adresse, f.emetteur_juridiction, f.langue,
     p_motif, p_cle)
  returning id into v_id;

  if p_montant_ht is null and v_deja.ht = 0 then
    -- L'avoir total reprend les lignes de la facture, une à une.
    for l in select * from facturation.facture_lignes x where x.facture_id = f.id order by x.ordinal loop
      insert into facturation.facture_lignes
        (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht, licence_id, tenant_id,
         nature, gabarit, valeurs, intervention_id)
      values (v_id, l.ordinal, l.libelle, l.quantite, l.prix_unitaire, l.montant_ht, l.licence_id,
              l.tenant_id, l.nature, l.gabarit, l.valeurs, l.intervention_id);
    end loop;
  else
    perform facturation.ligne_inscrire(v_id, 1::smallint, 'avoir_partiel',
                                       jsonb_build_object('numero', f.numero),
                                       1, v_ht, v_ht, f.licence_id, null, null, f.langue);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select t, auth.uid(), 'avoir.emis', 'facturation', 'factures', v_id,
         jsonb_build_object('numero', v_num.numero, 'facture', f.numero, 'motif', p_motif)
    from (select coalesce(f.payeur_tenant_id,
                          (select lo.tenant_id from facturation.licence_organisations lo
                            where lo.licence_id = f.licence_id order by lo.tenant_id limit 1)) as t) x
   where t is not null;

  return jsonb_build_object('facture_id', v_id, 'numero', v_num.numero, 'ht', v_ht,
                            'ttc', v_ht + v_tva + em.timbre_avoir, 'deja', false);
end
$$;
revoke all on function plateforme.avoir_emettre(uuid, numeric, text, text) from public, anon;
grant execute on function plateforme.avoir_emettre(uuid, numeric, text, text) to authenticated;

create function plateforme.facture_decider(p_facture uuid, p_decision text, p_motif text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.commerce.motif_requis' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from facturation.factures f where f.id = p_facture and f.nature = 'facture') then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;
  insert into facturation.facture_decisions (facture_id, decision, motif, decide_par)
  values (p_facture, p_decision, p_motif, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'facture_id', p_facture, 'decision', p_decision);
end
$$;
revoke all on function plateforme.facture_decider(uuid, text, text) from public, anon;
grant execute on function plateforme.facture_decider(uuid, text, text) to authenticated;

create function plateforme.geste_annuler(p_geste uuid, p_motif text, p_cle text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g plateforme.interventions;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  select * into g from plateforme.interventions where id = p_geste;
  if g.id is null then
    raise exception 'refus.introuvable.geste' using errcode = 'no_data_found';
  end if;
  -- Une suspension se lève par une reprise ; des lectures offertes sont déjà
  -- dans le stock ; une annulation ne s'annule pas.
  if g.acte not in ('remise_pourcentage', 'remise_montant', 'mois_offerts', 'prolongation_essai') then
    raise exception 'refus.geste.non_annulable' using errcode = 'check_violation';
  end if;
  -- Un geste dont l'effet est déjà facturé ne s'annule pas : il se corrige
  -- par un avoir. Une remise et des mois offerts portent une ligne ; une
  -- prolongation d'essai, non — elle retire des jours au prorata : toute
  -- facture du titulaire d'un mois qu'elle touche l'a déjà comptée.
  if exists (select 1 from facturation.facture_lignes x where x.intervention_id = p_geste)
     or (g.acte = 'prolongation_essai'
         and exists (select 1 from facturation.factures f
                       join facturation.essais_v e on e.licence_id = f.licence_id
                      where f.licence_id = g.licence_id and f.avoir_de is null
                        and f.payeur_type = 'titulaire'
                        and (f.periode + interval '1 month')::date > e.au
                        and f.periode < e.au + e.jours_prolonges)) then
    raise exception 'refus.geste.deja_facture' using errcode = 'check_violation';
  end if;
  if not plateforme.geste_en_vigueur(p_geste) then
    raise exception 'refus.geste.deja_annule' using errcode = 'check_violation';
  end if;
  return plateforme.geste_inscrire(g.licence_id, 'annulation', null, null, null, null,
                                   p_motif, p_cle, p_geste);
end
$$;
revoke all on function plateforme.geste_annuler(uuid, text, text) from public, anon;
grant execute on function plateforme.geste_annuler(uuid, text, text) to authenticated;

-- ------------------------------------------------------------ 10. L'encours

-- Un avoir réduit le reste dû de son TTC. Une facture entièrement couverte
-- par ses avoirs (Σ HT des avoirs = HT) est annulée : son timbre ne reste
-- pas dû au client (le sort fiscal du timbre d'une facture annulée est
-- INCERTAIN — docs/facturation/mentions-legales-2026-11-02.md).
create or replace view facturation.encours_v with (security_invoker = true) as
 select f.id as facture_id,
    f.licence_id,
    f.numero,
    f.periode,
    f.emise_le,
    f.echeance_le,
    f.montant_ttc,
    coalesce(e.encaisse, 0::numeric) as encaisse,
    (f.montant_ttc::numeric - coalesce(a.ttc, 0) - coalesce(e.encaisse, 0::numeric)
       - case when coalesce(a.ht, 0) >= f.montant_ht::numeric and coalesce(a.ht, 0) > 0
              then f.timbre::numeric else 0 end) as reste_du,
    case
      when f.statut = any (array['annulee', 'irrecouvrable']) then f.statut
      when d.decision = 'irrecouvrable' then 'irrecouvrable'
      when coalesce(a.ht, 0) >= f.montant_ht::numeric and coalesce(a.ht, 0) > 0
           and coalesce(e.encaisse, 0) = 0 then 'annulee'
      when coalesce(a.ttc, 0) + coalesce(e.encaisse, 0::numeric)
           + case when coalesce(a.ht, 0) >= f.montant_ht::numeric then f.timbre::numeric else 0 end
           >= f.montant_ttc::numeric then 'payee'
      when coalesce(e.encaisse, 0::numeric) > 0 then 'partielle'
      when f.echeance_le < j.jour then 'en_retard'
      else 'a_echoir'
    end as etat,
    greatest(0, j.jour - f.echeance_le) as jours_de_retard,
    coalesce(a.ttc, 0) as avoirs
   from facturation.factures f
   -- Le retard se compte au jour de l'ÉMETTEUR (#194). Une facture d'avant
   -- l'émetteur (sans son organisation) n'a pas de fuseau recopié : jour du
   -- serveur, comme elle l'a toujours lu.
   cross join lateral (select case when f.emetteur_organisation_id is null then current_date
                                   else facturation.jour_de_l_organisation(f.emetteur_organisation_id)
                              end as jour) j
   left join lateral (select sum(x.montant::numeric) as encaisse
                        from facturation.encaissements x where x.facture_id = f.id) e on true
   left join lateral (select sum(x.montant_ttc::numeric) as ttc, sum(x.montant_ht::numeric) as ht
                        from facturation.factures x where x.avoir_de = f.id) a on true
   left join lateral (select x.decision from facturation.facture_decisions x
                       where x.facture_id = f.id order by x.decide_le desc, x.id desc limit 1) d on true
  where f.avoir_de is null;

-- La séquence ne numérote plus rien.
drop sequence facturation.numero_facture_seq;
