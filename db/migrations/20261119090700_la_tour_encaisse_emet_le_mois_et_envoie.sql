-- ======================================================================
--  La tour encaisse, émet le mois et envoie (moteur commercial, 8/9 — plan
--  du 2 novembre 2026, annexe F5 à F9, 2.4, 2.5 ; décisions du dirigeant
--  n° 11, 12).
--
--  ENCAISSEMENTS. La tour saisit un encaissement (virement, chèque…) ou
--  l'annule par une ligne négative, une seule fois ; jamais au-delà du reste
--  dû. Le paiement en ligne existant reste l'autre écrivain.
--
--  LE PDF. Il se REND depuis l'instantané de la facture, qui ne change plus
--  (20261119090600) : la base garde son empreinte (`facture_documents`,
--  sha256), pas ses octets. La version 1 est l'original ; une version
--  suivante est un duplicata. L'API rend le PDF sous l'identité de qui le
--  demande : la RLS décide (`facturation.document_de_facture`).
--
--  LE COURRIEL (décision 12, allumé dès le départ). À l'inscription de
--  l'original, si la tour n'a pas éteint l'envoi, la base pose un courriel
--  `facture.emise` (lien vers l'espace client) ; le travailleur des relances
--  le remet par Brevo avec le PDF joint. Sans clé Brevo (poste, CI,
--  épreuves), rien ne part : les courriels restent « à remettre ». Hors
--  production, le travailleur ne remet qu'aux adresses de la liste de
--  l'environnement (`MALICA_COURRIEL_DESTINATAIRES`, vide = rien) : un envoi
--  retenu s'inscrit `retenu` dans `notif.remises`, état terminal
--  (docs/exploitation.md).
--
--  LA PASSE (décision 11, manuelle). « Aperçu du mois » puis « Émettre le
--  mois », depuis la tour. Une seule passe réelle par mois ; on la REPREND,
--  on ne la recrée pas. L'aperçu joue la MÊME émission que la passe réelle,
--  dans un sous-bloc annulé : mêmes calculs, aucun numéro consommé, aucune
--  facture, aucune clôture (R12 : un seul corps). Chaque cible se traite
--  dans son sous-bloc : une facture refusée ne fait pas tomber les autres.
-- ======================================================================

-- ------------------------------------------------------------ 1. Les encaissements

alter table facturation.encaissements add column cle_idempotence text unique;
create unique index encaissements_une_annulation on facturation.encaissements (annule_id)
  where annule_id is not null;

create function plateforme.encaissement_inscrire(
  p_facture uuid, p_montant numeric, p_moyen text, p_reference text, p_encaisse_le date,
  p_cle text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f       facturation.factures;
  v_reste numeric;
  v_id    uuid;
  v_deja  facturation.encaissements;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_cle is not null then
    select * into v_deja from facturation.encaissements where cle_idempotence = p_cle;
    if v_deja.id is not null then
      if v_deja.facture_id <> p_facture then
        raise exception 'refus.commerce.cle_deja_prise' using errcode = 'unique_violation';
      end if;
      return to_jsonb(v_deja) || jsonb_build_object('deja', true);
    end if;
  end if;
  select * into f from facturation.factures where id = p_facture for update;
  if f.id is null or f.nature <> 'facture' then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'refus.encaissement.montant_positif' using errcode = 'check_violation';
  end if;
  if p_encaisse_le is null or p_encaisse_le > facturation.jour_de_l_organisation(f.emetteur_organisation_id) then
    raise exception 'refus.encaissement.date_future' using errcode = 'check_violation';
  end if;
  select e.reste_du into v_reste from facturation.encours_v e where e.facture_id = p_facture;
  if p_montant > v_reste then
    raise exception '%', app.refus_avec_valeurs('refus.encaissement.au_dela_du_reste',
                                                'reste', v_reste::text)
      using errcode = 'check_violation';
  end if;
  insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le, cle_idempotence)
  values (p_facture, p_montant, p_moyen, nullif(btrim(p_reference), ''), p_encaisse_le, p_cle)
  returning id into v_id;
  return (select to_jsonb(x) || jsonb_build_object('deja', false)
            from facturation.encaissements x where x.id = v_id);
end
$$;
revoke all on function plateforme.encaissement_inscrire(uuid, numeric, text, text, date, text) from public, anon;
grant execute on function plateforme.encaissement_inscrire(uuid, numeric, text, text, date, text) to authenticated;

create function plateforme.encaissement_annuler(p_encaissement uuid, p_motif text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e    facturation.encaissements;
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.commerce.motif_requis' using errcode = 'check_violation';
  end if;
  select * into e from facturation.encaissements where id = p_encaissement for update;
  if e.id is null or e.montant::numeric <= 0 then
    raise exception 'refus.introuvable.encaissement' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from facturation.encaissements x where x.annule_id = p_encaissement) then
    raise exception 'refus.encaissement.deja_annule' using errcode = 'check_violation';
  end if;
  insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le, annule_id, motif)
  values (e.facture_id, -e.montant::numeric, e.moyen, e.reference,
          facturation.jour_de_l_organisation((select f.emetteur_organisation_id from facturation.factures f
                                            where f.id = e.facture_id)),
          e.id, p_motif)
  returning id into v_id;
  return (select to_jsonb(x) from facturation.encaissements x where x.id = v_id);
end
$$;
revoke all on function plateforme.encaissement_annuler(uuid, text) from public, anon;
grant execute on function plateforme.encaissement_annuler(uuid, text) to authenticated;

-- ------------------------------------------------------------ 2. Le document, l'envoi

create table facturation.facture_documents (
  id           uuid primary key default gen_random_uuid(),
  facture_id   uuid not null references facturation.factures (id) on delete restrict,
  version      smallint not null check (version >= 1),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  gabarit_code text not null check (gabarit_code ~ '^[a-z0-9_.-]+$'),
  langue       text not null check (langue in ('fr', 'ar', 'en')),
  genere_par   uuid not null references auth.users (id),
  genere_le    timestamptz not null default now(),
  unique (facture_id, version)
);
comment on table facturation.facture_documents is
  'L''empreinte de chaque PDF rendu d''une facture : version 1 = original, suivantes = duplicatas. '
  'Le PDF se rend depuis l''instantané de la facture (qui ne change plus) ; `gabarit_code` nomme '
  'la version du rendu.';
create index facture_documents_genere_par_idx on facturation.facture_documents (genere_par);

create table facturation.facture_envois (
  id          uuid primary key default gen_random_uuid(),
  facture_id  uuid not null references facturation.factures (id) on delete restrict,
  document_id uuid not null references facturation.facture_documents (id) on delete restrict,
  envoi_id    uuid not null unique references notif.envois (id) on delete restrict,
  created_at  timestamptz not null default now()
);
create index facture_envois_facture_idx on facturation.facture_envois (facture_id);
create index facture_envois_document_idx on facturation.facture_envois (document_id);

do $$
declare t text;
begin
  foreach t in array array['facture_documents', 'facture_envois'] loop
    execute format('alter table facturation.%I enable row level security', t);
    execute format('alter table facturation.%I force row level security', t);
    execute format('revoke all on table facturation.%I from public, anon, service_role', t);
    execute format('grant select on table facturation.%I to authenticated', t);
    execute format('create policy facturation_%s_sel on facturation.%I for select to authenticated '
                   'using (facture_id in (select facturation.factures_lisibles()))', t, t);
    execute format('create policy service_hors_perimetre on facturation.%I as restrictive '
                   'for select to authenticated using ((select app.service()) is null)', t);
    execute format('create trigger service_hors_perimetre before insert or update or delete '
                   'on facturation.%I for each statement execute function app.service_hors_perimetre()', t);
    execute format('create trigger %s_ajout_seul before update or delete on facturation.%I '
                   'for each row execute function app.deny_mutation()', t, t);
  end loop;
end
$$;

/**
 * Tout ce que le PDF d'une facture affiche, dans une langue, lu SOUS
 * L'IDENTITÉ DE L'APPELANT : la RLS de la facture décide (null sinon). Les
 * lignes à gabarit se rendent dans la langue demandée ; les rubriques
 * viennent de `ref.labels`.
 *
 * L'ORIGINAL (`p_au_jour` faux) ne lit que ce qui était vrai à l'émission et
 * ne change plus : ce qu'elle portait de payé (`encaisse_a_l_emission`, les
 * paiements en ligne imputés), aucun avoir, aucun état, la page de paiement du
 * gabarit en vigueur le jour d'émission. Rendu de nouveau, il redonne les octets dont
 * l'empreinte est inscrite (revue Codex de #202). L'ÉTAT DU JOUR (`p_au_jour`)
 * ajoute ce qui s'est passé depuis — encaissements, avoirs, retard — : c'est
 * un relevé, pas l'original.
 */
create function facturation.document_de_facture(
  p_facture uuid, p_langue text default null, p_au_jour boolean default false)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with f as (select * from facturation.factures x where x.id = p_facture),
  langue as (select coalesce(p_langue, (select f.langue from f), 'fr') as l)
  select jsonb_build_object(
    'facture', to_jsonb(f) - 'cle_idempotence',
    'langue', (select l from langue),
    'periode', jsonb_build_object(
       'mois', (select m.value from ref.labels m, langue
                 where m.ns = 'mois' and m.key = extract(month from f.periode)::int::text
                   and m.locale = langue.l),
       'annee', extract(year from f.periode)::int),
    'lignes', coalesce((
       select jsonb_agg(jsonb_build_object(
                'ordinal', x.ordinal, 'nature', x.nature,
                'libelle', case when x.gabarit is null then x.libelle
                                else facturation.libelle_rendu(x.gabarit, x.valeurs,
                                                               (select l from langue)) end,
                'quantite', x.quantite, 'prix_unitaire', x.prix_unitaire,
                'montant_ht', x.montant_ht) order by x.ordinal)
         from facturation.facture_lignes x where x.facture_id = f.id), '[]'::jsonb),
    'encours', case when p_au_jour then
                 (select jsonb_build_object('encaisse', e.encaisse, 'reste_du', e.reste_du,
                                            'etat', e.etat, 'avoirs', e.avoirs)
                    from facturation.encours_v e where e.facture_id = f.id)
               else
                 jsonb_build_object('encaisse', f.encaisse_a_l_emission,
                                    'reste_du', f.montant_ttc::numeric - f.encaisse_a_l_emission::numeric,
                                    'etat', null, 'avoirs', 0)
               end,
    'au_jour', p_au_jour,
    'avoir_de', (select jsonb_build_object('numero', a.numero, 'emise_le', a.emise_le)
                   from facturation.factures a where a.id = f.avoir_de),
    'rubriques', (select jsonb_object_agg(r.key, r.value) from ref.labels r, langue
                   where r.ns = 'facture_rubrique' and r.locale = langue.l),
    'devise', (select jsonb_build_object('code', d.code, 'exposant', d.exposant,
                                         'separateur', d.separateur_decimal)
                 from ref.devises d where d.code = f.devise),
    'route_paiement', (select g.action_route from notif.gabarits g
                        where g.canal = 'email'
                          and g.code = case f.payeur_type when 'cabinet' then 'facture.emise.cabinet'
                                                          else 'facture.emise' end
                          and g.effective_from <= f.emise_le
                        order by g.effective_from desc, g.locale limit 1),
    'nature_libelle', (select n.value from ref.labels n, langue
                        where n.ns = 'nature_document' and n.key = f.nature and n.locale = langue.l),
    'original', (select d.sha256 from facturation.facture_documents d
                  where d.facture_id = f.id and d.version = 1))
  from f
$$;
revoke all on function facturation.document_de_facture(uuid, text, boolean) from public, anon;
grant execute on function facturation.document_de_facture(uuid, text, boolean) to authenticated;

/**
 * L'API inscrit l'empreinte d'un PDF rendu. L'original (version 1) d'une
 * facture déclenche le courriel si la tour n'a pas éteint l'envoi.
 */
create function plateforme.document_inscrire(
  p_facture uuid, p_sha256 text, p_gabarit text, p_langue text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f         facturation.factures;
  v_doc     facturation.facture_documents;
  v_version smallint;
  rf        plateforme.reglages_facturation;
  v_dest    record;
  v_poste   jsonb;
  v_envois  integer := 0;
  v_tenant  uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  select * into f from facturation.factures where id = p_facture;
  if f.id is null then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;
  select * into v_doc from facturation.facture_documents d
   where d.facture_id = p_facture and d.sha256 = p_sha256 and d.gabarit_code = p_gabarit
   order by d.version limit 1;
  if v_doc.id is not null then
    return to_jsonb(v_doc) || jsonb_build_object('deja', true, 'envois', 0);
  end if;
  select coalesce(max(d.version), 0) + 1 into v_version
    from facturation.facture_documents d where d.facture_id = p_facture;
  insert into facturation.facture_documents (facture_id, version, sha256, gabarit_code, langue, genere_par)
  values (p_facture, v_version, p_sha256, p_gabarit, p_langue, auth.uid())
  returning * into v_doc;

  rf := plateforme.reglage_facturation();
  if v_version = 1 and f.nature = 'facture' and rf.envoi_courriel then
    v_tenant := coalesce(f.payeur_tenant_id,
                         (select lo.tenant_id from facturation.licence_organisations lo
                           where lo.licence_id = f.licence_id order by lo.tenant_id limit 1));
    for v_dest in
      select f.payeur_personne as personne where f.payeur_type = 'titulaire'
      union
      select m.user_id from identity.memberships m
       where f.payeur_type = 'cabinet' and m.tenant_id = f.payeur_tenant_id and m.role = 'expert'
    loop
      v_poste := notif.poster(
        v_dest.personne,
        case f.payeur_type when 'cabinet' then 'facture.emise.cabinet' else 'facture.emise' end,
        f.id::text,
        jsonb_build_object(
          'numero', f.numero,
          'offre', coalesce((select o.libelle from ref.offre_codes o where o.code = f.offre_code), ''),
          'periode', (select m.value || ' ' || extract(year from f.periode)::int
                        from ref.labels m
                       where m.ns = 'mois' and m.key = extract(month from f.periode)::int::text
                         and m.locale = coalesce((select p.locale from identity.profiles p
                                                   where p.user_id = v_dest.personne), 'fr')),
          'ttc', to_char(f.montant_ttc::numeric, 'FM999999990.000'),
          'devise', f.devise,
          'echeance', to_char(f.echeance_le, 'DD/MM/YYYY')),
        v_tenant, 'email', interval '3650 days');
      if (v_poste ->> 'envoi_id') is not null then
        insert into facturation.facture_envois (facture_id, document_id, envoi_id)
        values (f.id, v_doc.id, (v_poste ->> 'envoi_id')::uuid);
        v_envois := v_envois + 1;
      end if;
    end loop;
  end if;
  return to_jsonb(v_doc) || jsonb_build_object('deja', false, 'envois', v_envois);
end
$$;
revoke all on function plateforme.document_inscrire(uuid, text, text, text) from public, anon;
grant execute on function plateforme.document_inscrire(uuid, text, text, text) to authenticated;

/**
 * Le travailleur des courriels lit la facture jointe à un envoi : le même
 * document que l'écran, lu par le rôle de l'API (qui n'endosse personne).
 * Ouverte au seul rôle de l'API.
 */
create function notif.facture_de_l_envoi(p_envoi uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select facturation.document_de_facture(fe.facture_id, null, false)
    from facturation.facture_envois fe where fe.envoi_id = p_envoi
$$;
revoke all on function notif.facture_de_l_envoi(uuid) from public, anon, authenticated;
grant execute on function notif.facture_de_l_envoi(uuid) to malica_api;

-- Les courriels de facture suivent le réglage de la facturation, pas celui
-- des relances : leurs tentatives, et l'envoi que la tour peut éteindre.
create or replace function notif.courriels_a_remettre(p_limite integer)
returns table(envoi_id uuid, email text, locale text, titre text, corps text,
              action_libelle text, action_route text)
language sql security definer set search_path = '' as $$
  with reglage as (select plateforme.relances_reglage() as r),
  facturation as (select f.envoi_courriel, f.tentatives_max from plateforme.reglage_facturation() f),
  dus as (
    select e.id
      from notif.envois_v e, reglage, facturation
     where e.canal = 'email'
       and e.etat in ('a_remettre', 'a_reessayer')
       and (e.code not like 'impaye.%' or (reglage.r ->> 'actives')::boolean)
       and (e.code not like 'facture.emise%' or facturation.envoi_courriel)
       and e.tentatives < case when e.code like 'facture.emise%' then facturation.tentatives_max
                               else coalesce((reglage.r ->> 'tentatives_max')::int, 0) end
  ),
  pris as (
    select n.id, n.destinataire, n.gabarit_id, n.titre_rendu, n.corps_rendu, n.cree_le
      from notif.envois n
     where n.id in (select id from dus)
     order by n.cree_le
     limit p_limite
       for update of n skip locked
  )
  select p.id, u.email::text, g.locale, p.titre_rendu, p.corps_rendu,
         g.action_libelle, g.action_route
    from pris p
    join notif.gabarits g on g.id = p.gabarit_id
    join auth.users u on u.id = p.destinataire
   order by p.cree_le
$$;

-- ------------------------------------------------------------ 3. La passe

create table facturation.passes_emission (
  id              uuid primary key default gen_random_uuid(),
  periode         date not null check (extract(day from periode) = 1),
  mode            text not null check (mode in ('apercu', 'reel')),
  cle_idempotence text not null unique,
  emetteur_id     uuid not null references facturation.emetteurs (id),
  reglage_id      uuid not null references plateforme.reglages_facturation (id),
  lancee_par      uuid not null references auth.users (id),
  lancee_le       timestamptz not null default now()
);
create unique index passes_emission_une_reelle_par_mois on facturation.passes_emission (periode)
  where mode = 'reel';
create index passes_emission_periode_idx on facturation.passes_emission (periode desc, lancee_le desc);
create index passes_emission_emetteur_idx on facturation.passes_emission (emetteur_id);
create index passes_emission_reglage_idx on facturation.passes_emission (reglage_id);
create index passes_emission_lancee_par_idx on facturation.passes_emission (lancee_par);

create table facturation.passe_resultats (
  id                uuid primary key default gen_random_uuid(),
  passe_id          uuid not null references facturation.passes_emission (id) on delete restrict,
  licence_id        uuid references facturation.licences (id) on delete restrict,
  cabinet_tenant_id uuid references identity.organizations (id) on delete restrict,
  payeur_type       text not null references ref.payeur_types (code),
  payeur_cle        uuid not null,
  resultat          text not null references ref.resultats_passe (code),
  refus_cle         text check (refus_cle ~ '^refus\.'),
  montant_ht        app.money_t,
  montant_ttc       app.money_t,
  facture_id        uuid references facturation.factures (id) on delete restrict,
  created_at        timestamptz not null default now(),
  constraint passe_resultats_une_cible check ((licence_id is null) <> (cabinet_tenant_id is null)),
  constraint passe_resultats_facture_si_emise
    check ((resultat in ('emise', 'deja_emise')) = (facture_id is not null)),
  constraint passe_resultats_refus_nomme check ((resultat = 'refus') = (refus_cle is not null))
);
comment on column facturation.passe_resultats.payeur_cle is
  'La personne (titulaire) ou l''organisation (cabinet) payeuse : référence polymorphe, nommée par '
  'payeur_type.';
create unique index passe_resultats_une_par_cible on facturation.passe_resultats
  (passe_id, coalesce(licence_id, cabinet_tenant_id), payeur_type, payeur_cle)
  where resultat in ('emise', 'deja_emise', 'prevue');
create index passe_resultats_passe_idx on facturation.passe_resultats (passe_id, resultat);
create index passe_resultats_licence_idx on facturation.passe_resultats (licence_id);
create index passe_resultats_cabinet_idx on facturation.passe_resultats (cabinet_tenant_id);
create index passe_resultats_payeur_type_fk_idx on facturation.passe_resultats (payeur_type);
create index passe_resultats_resultat_fk_idx on facturation.passe_resultats (resultat);
create index passe_resultats_facture_idx on facturation.passe_resultats (facture_id);

do $$
declare t text;
begin
  foreach t in array array['passes_emission', 'passe_resultats'] loop
    execute format('alter table facturation.%I enable row level security', t);
    execute format('alter table facturation.%I force row level security', t);
    execute format('revoke all on table facturation.%I from public, anon, service_role', t);
    execute format('grant select on table facturation.%I to authenticated', t);
    execute format('create policy facturation_%s_sel on facturation.%I for select to authenticated '
                   'using ((select app.is_platform()))', t, t);
    execute format('create policy service_hors_perimetre on facturation.%I as restrictive '
                   'for select to authenticated using ((select app.service()) is null)', t);
    execute format('create trigger service_hors_perimetre before insert or update or delete '
                   'on facturation.%I for each statement execute function app.service_hors_perimetre()', t);
    execute format('create trigger %s_ajout_seul before update or delete on facturation.%I '
                   'for each row execute function app.deny_mutation()', t, t);
  end loop;
end
$$;

alter table facturation.factures
  add constraint factures_passe_id_fkey foreign key (passe_id) references facturation.passes_emission (id);
alter table facturation.lectures_dues
  add constraint lectures_dues_passe_id_fkey foreign key (passe_id) references facturation.passes_emission (id);

/** La clé d'un refus levé : `refus.x.y`, sans les valeurs qui le suivent. */
create function facturation.cle_du_refus(p_message text) returns text
language sql immutable set search_path = '' as $$
  select case when p_message ~ '^refus\.' then split_part(p_message, '?', 1)
              else 'refus.facturation.echec' end
$$;

/**
 * Ouvre la passe d'un mois et rend ses cibles. L'aperçu est une passe
 * nouvelle à chaque fois ; la passe réelle d'un mois est unique et se reprend.
 */
create function plateforme.passe_ouvrir(p_periode date, p_mode text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_cle   text;
  em      record;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_periode is null or extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;
  if p_mode not in ('apercu', 'reel') then
    raise exception 'refus.passe.mode_inconnu' using errcode = 'check_violation';
  end if;
  select * into em from facturation.emetteur_en_vigueur();
  if p_periode > date_trunc('month', em.jour)::date then
    raise exception 'refus.passe.mois_a_venir' using errcode = 'check_violation';
  end if;
  -- Deux passes du même mois ne courent pas ensemble.
  perform pg_advisory_xact_lock(hashtext('passe:' || p_periode::text));

  v_cle := case p_mode when 'reel' then 'reel:' || to_char(p_periode, 'YYYY-MM')
                       else 'apercu:' || to_char(p_periode, 'YYYY-MM') || ':' || gen_random_uuid() end;
  select p.id into v_id from facturation.passes_emission p where p.cle_idempotence = v_cle;
  if v_id is null then
    insert into facturation.passes_emission (periode, mode, cle_idempotence, emetteur_id, reglage_id, lancee_par)
    values (p_periode, p_mode, v_cle, em.emetteur_id, (plateforme.reglage_facturation()).id, auth.uid())
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'passe_id', v_id, 'periode', p_periode, 'mode', p_mode,
    'cibles', coalesce((
      select jsonb_agg(c order by c ->> 'type', c ->> 'id') from (
        select jsonb_build_object('type', 'licence', 'id', l.id) as c
          from facturation.licences l
         where exists (select 1 from facturation.forfait_historique h
                        where h.licence_id = l.id and h.effet_du < (p_periode + interval '1 month')::date
                          and (h.effet_au is null or h.effet_au >= p_periode))
        union all
        select distinct jsonb_build_object('type', 'cabinet', 'id', pv.payeur_tenant_id)
          from facturation.payeurs_v pv
         where pv.payeur_type = 'cabinet' and pv.du < (p_periode + interval '1 month')::date
           and (pv.au_exclu is null or pv.au_exclu > p_periode)) x), '[]'::jsonb));
end
$$;
revoke all on function plateforme.passe_ouvrir(date, text) from public, anon;
grant execute on function plateforme.passe_ouvrir(date, text) to authenticated;

/** Le résultat d'une cible, en ligne de `passe_resultats` (rien de plus si déjà dit). */
create function facturation.resultat_inscrire(
  p_passe uuid, p_licence uuid, p_cabinet uuid, p_payeur_type text, p_payeur uuid,
  p_resultat text, p_refus text, p_ht numeric, p_ttc numeric, p_facture uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  with ins as (
    insert into facturation.passe_resultats
      (passe_id, licence_id, cabinet_tenant_id, payeur_type, payeur_cle, resultat, refus_cle,
       montant_ht, montant_ttc, facture_id)
    values (p_passe, p_licence, p_cabinet, p_payeur_type, p_payeur, p_resultat, p_refus,
            p_ht, p_ttc, p_facture)
    on conflict do nothing
    returning id)
  select jsonb_build_object('licence_id', p_licence, 'cabinet_tenant_id', p_cabinet,
                            'payeur_type', p_payeur_type, 'payeur', p_payeur,
                            'resultat', p_resultat, 'refus', p_refus, 'ht', p_ht, 'ttc', p_ttc,
                            'facture_id', p_facture, 'inscrit', exists (select 1 from ins))
$$;
revoke all on function facturation.resultat_inscrire(uuid, uuid, uuid, text, uuid, text, text, numeric, numeric, uuid)
  from public, anon, authenticated;

/**
 * Traite une cible de la passe. En aperçu, l'émission se joue dans un
 * sous-bloc qu'on annule : rien n'est écrit qu'une ligne « prévue ». En réel,
 * l'émission est gardée, et les lectures du mois sont closes.
 */
create function plateforme.passe_traiter(p_passe uuid, p_type text, p_cible uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p        facturation.passes_emission;
  v_r      jsonb;
  v_sortie jsonb := '[]'::jsonb;
  v_titul  uuid;
  x        jsonb;
  v_ex     record;
  v_msg    text;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  select * into p from facturation.passes_emission where id = p_passe;
  if p.id is null then
    raise exception 'refus.introuvable.passe' using errcode = 'no_data_found';
  end if;
  if p_type not in ('licence', 'cabinet') then
    raise exception 'refus.passe.cible_inconnue' using errcode = 'check_violation';
  end if;
  if p_type = 'licence' then
    select l.titulaire into v_titul from facturation.licences l where l.id = p_cible;
    if v_titul is null then
      raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
    end if;
  end if;

  -- Déjà émise : la reprise de la passe le dit, sans rien émettre de plus.
  for v_ex in
    select f.id, f.payeur_type, coalesce(f.payeur_personne, f.payeur_tenant_id) as payeur,
           f.montant_ht, f.montant_ttc
      from facturation.factures f
     where f.nature = 'facture' and f.periode = p.periode
       and ((p_type = 'licence' and f.licence_id = p_cible)
            or (p_type = 'cabinet' and f.licence_id is null and f.payeur_tenant_id = p_cible))
  loop
    v_sortie := v_sortie || facturation.resultat_inscrire(
      p.id, case when p_type = 'licence' then p_cible end,
      case when p_type = 'cabinet' then p_cible end, v_ex.payeur_type, v_ex.payeur,
      'deja_emise', null, v_ex.montant_ht, v_ex.montant_ttc, v_ex.id);
  end loop;
  if jsonb_array_length(v_sortie) > 0 then
    if p.mode = 'reel' and p_type = 'licence' then
      perform facturation.cloturer_lectures(p_cible, p.periode, p.id);
    end if;
    return jsonb_build_object('cible', p_cible, 'type', p_type, 'resultats', v_sortie);
  end if;

  begin
    v_r := case p_type when 'licence' then facturation.emettre(p_cible, p.periode, p.id)
                       else facturation.emettre_cabinet(p_cible, p.periode, p.id) end;
    if p.mode = 'apercu' then
      -- L'aperçu rend ce que l'émission aurait fait, et l'annule.
      raise exception using errcode = 'P0001', message = 'apercu', detail = v_r::text;
    end if;
  exception
    when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg = 'apercu' then
        get stacked diagnostics v_msg = pg_exception_detail;
        v_r := v_msg::jsonb || jsonb_build_object('apercu', true);
      else
        v_r := jsonb_build_object('refus', facturation.cle_du_refus(v_msg));
      end if;
  end;

  if v_r ? 'refus' then
    v_sortie := v_sortie || facturation.resultat_inscrire(
      p.id, case when p_type = 'licence' then p_cible end,
      case when p_type = 'cabinet' then p_cible end,
      case when p_type = 'licence' then 'titulaire' else 'cabinet' end,
      coalesce(v_titul, p_cible), 'refus', v_r ->> 'refus', null, null, null);
  elsif p_type = 'cabinet' and v_r ->> 'facture_id' is not null then
    v_sortie := v_sortie || facturation.resultat_inscrire(
      p.id, null, p_cible, 'cabinet', p_cible,
      case when p.mode = 'apercu' then 'prevue' else 'emise' end, null,
      (v_r ->> 'ht')::numeric, (v_r ->> 'ttc')::numeric,
      case when p.mode = 'apercu' then null else (v_r ->> 'facture_id')::uuid end);
  elsif p_type = 'licence' and jsonb_array_length(coalesce(v_r -> 'factures', '[]'::jsonb)) > 0 then
    for x in select * from jsonb_array_elements(v_r -> 'factures') loop
      v_sortie := v_sortie || facturation.resultat_inscrire(
        p.id, p_cible, null, x ->> 'payeur_type', (x ->> 'payeur')::uuid,
        case when p.mode = 'apercu' then 'prevue' else 'emise' end, null,
        (x ->> 'ht')::numeric, (x ->> 'ttc')::numeric,
        case when p.mode = 'apercu' then null else (x ->> 'facture_id')::uuid end);
    end loop;
  else
    v_sortie := v_sortie || facturation.resultat_inscrire(
      p.id, case when p_type = 'licence' then p_cible end,
      case when p_type = 'cabinet' then p_cible end,
      case when p_type = 'licence' then 'titulaire' else 'cabinet' end,
      coalesce(v_titul, p_cible),
      case v_r ->> 'couvert_par' when 'annuel' then 'couverte' when 'offerte' then 'offerte'
                                 when 'essai' then 'essai' else 'rien' end,
      null, 0, 0, null);
  end if;

  if p.mode = 'reel' and p_type = 'licence' then
    perform facturation.cloturer_lectures(p_cible, p.periode, p.id);
  end if;
  return jsonb_build_object('cible', p_cible, 'type', p_type, 'resultats', v_sortie);
end
$$;
revoke all on function plateforme.passe_traiter(uuid, text, uuid) from public, anon;
grant execute on function plateforme.passe_traiter(uuid, text, uuid) to authenticated;

-- ------------------------------------------------------------ 4. Ce que la tour lit

create view plateforme.factures_v with (security_invoker = true) as
  select f.id as facture_id, f.nature, f.numero, f.periode, f.emise_le, f.echeance_le,
         f.payeur_type, f.payeur_tenant_id, f.payeur_personne, f.destinataire_nom,
         f.licence_id, f.montant_ht, f.montant_tva, f.timbre, f.montant_ttc, f.devise, f.langue,
         f.avoir_de, f.passe_id,
         e.encaisse, e.reste_du, e.etat, e.jours_de_retard, e.avoirs,
         (select max(d.version) from facturation.facture_documents d where d.facture_id = f.id)
           as documents,
         (select count(*) from facturation.facture_envois fe where fe.facture_id = f.id)::int
           as envois
    from facturation.factures f
    left join facturation.encours_v e on e.facture_id = f.id
   where (select app.is_platform());
revoke all on plateforme.factures_v from public, anon;
grant select on plateforme.factures_v to authenticated;

create view plateforme.exceptions_v with (security_invoker = true) as
  select i.id, i.licence_id, i.acte, i.valeur, i.payeur_type, i.effet_du, i.effet_au, n.motif,
         n.operateur, i.created_at, i.annule,
         (select x.id from plateforme.interventions x where x.annule = i.id) as annule_par,
         plateforme.geste_en_vigueur(i.id) and i.acte <> 'annulation' as en_vigueur,
         a.visible_client,
         (select string_agg(o.name, ', ' order by o.name)
            from facturation.licence_organisations lo
            join identity.organizations o on o.id = lo.tenant_id
           where lo.licence_id = i.licence_id) as societes
    from plateforme.interventions i
    join ref.actes_intervention a on a.code = i.acte
    -- Le motif et l'opérateur ne sont pas des colonnes que le client lit
    -- (droits de colonne, 20261119090400) : la tour les lit par la note.
    cross join lateral plateforme.note_du_geste(i.id) n
   where (select app.is_platform());
revoke all on plateforme.exceptions_v from public, anon;
grant select on plateforme.exceptions_v to authenticated;

create view plateforme.passes_v with (security_invoker = true) as
  select p.id as passe_id, p.periode, p.mode, p.lancee_par, p.lancee_le,
         (select jsonb_object_agg(r.resultat, r.n)
            from (select x.resultat, count(*)::int as n from facturation.passe_resultats x
                   where x.passe_id = p.id group by x.resultat) r) as comptes,
         (select coalesce(sum(x.montant_ttc), 0) from facturation.passe_resultats x
           where x.passe_id = p.id and x.resultat in ('prevue', 'emise')) as ttc
    from facturation.passes_emission p
   where (select app.is_platform());
revoke all on plateforme.passes_v from public, anon;
grant select on plateforme.passes_v to authenticated;

-- ------------------------------------------------------------ 5. Le courriel dit que le PDF est joint

-- Une version datée du gabarit, dans les trois langues : la précédente reste
-- pour l'histoire des envois déjà rendus.
insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, corps_html, action_libelle, action_route, effective_from)
select g.code, g.canal, g.locale, g.sujet, g.titre,
       g.corps || case g.locale when 'fr' then ' La facture est jointe en PDF.'
                                when 'en' then ' The invoice is attached as a PDF.'
                                else ' الفاتورة مرفقة بصيغة PDF.' end,
       g.corps_html, g.action_libelle, g.action_route, date '2026-11-02'
  from notif.gabarits g
 where g.code in ('facture.emise', 'facture.emise.cabinet') and g.canal = 'email'
   and g.effective_from = date '2026-10-23'
on conflict (code, canal, locale, effective_from) do nothing;

-- Un courriel RETENU par la garde des destinataires (hors production, adresse
-- hors de la liste) : la tentative s'inscrit, motivée, et l'envoi ne se
-- retente pas — la garde dirait la même chose à la tentative suivante.
alter table notif.remises drop constraint remises_resultat_check;
alter table notif.remises add constraint remises_resultat_check
  check (resultat in ('remis', 'echoue', 'refuse', 'retenu'));

create or replace view notif.envois_v with (security_invoker = true) as
 select e.id,
    e.tenant_id,
    e.destinataire,
    e.code,
    e.canal,
    e.gabarit_id,
    e.sujet_cle,
    e.titre_rendu,
    e.corps_rendu,
    e.decision,
    e.motif_abandon,
    e.cree_le,
    r.resultat as dernier_resultat,
    r.tente_le as derniere_tentative_le,
    (coalesce(n.tentatives, (0)::bigint))::integer as tentatives,
    (r.resultat = 'remis'::text) as remis,
        case
            when (e.decision = 'abandonne'::text) then 'abandonne'::text
            when (r.resultat = 'remis'::text) then 'remis'::text
            when (r.resultat = 'refuse'::text) then 'refuse'::text
            when (r.resultat = 'retenu'::text) then 'retenu'::text
            when (r.resultat = 'echoue'::text) then 'a_reessayer'::text
            else 'a_remettre'::text
        end as etat
   from ((notif.envois e
     left join lateral ( select remises.resultat,
            remises.tente_le
           from notif.remises
          where (remises.envoi_id = e.id)
          order by remises.tente_le desc
         limit 1) r on (true))
     left join lateral ( select count(*) as tentatives
           from notif.remises
          where (remises.envoi_id = e.id)) n on (true));

-- ------------------------------------------------------------ 6. Un doublon retiré (R9)

-- `plateforme.clients_v` doublait `plateforme.licences_v` ; seule une épreuve
-- la lisait. Avec la lecture élargie des licences (20261119090300), elle
-- aurait rendu au cabinet une vue « de la tour » : elle part.
drop view plateforme.clients_v;
