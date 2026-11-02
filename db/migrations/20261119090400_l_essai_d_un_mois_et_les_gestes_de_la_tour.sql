-- ======================================================================
--  L'essai d'un mois, une fois, et les gestes de la tour (moteur commercial,
--  5/9 — plan du 2 novembre 2026, annexe L2, X1 ; décisions du dirigeant
--  n° 1, 2, 5, 6).
--
--  L'ESSAI. Un mois offert à la naissance d'une licence du canal DIRECT
--  (`ref.essais_par_canal`), une seule fois par propriétaire principal ET par
--  organisation (matricule fiscal normalisé) : trois uniques le tiennent, pas
--  une vérification applicative. Si un cabinet dote la société pendant
--  l'essai, l'essai s'arrête le jour où l'accès prend effet
--  (`facturation.essais_v.fin_effective`). Les jours d'essai sortent du
--  prorata de la part du titulaire (`facturation.a_facturer`).
--
--  LES GESTES. `plateforme.interventions` reçoit le payeur visé, l'annulation
--  (un geste s'annule par un geste, une fois), les plafonds en vigueur au
--  moment du geste et une clé d'idempotence. Trois portes ici, toutes
--  nominatives, motivées, plafonnées par `plateforme.reglages_commerciaux`
--  (décision 5), sans double validation (décision 6) :
--
--    plateforme.remise_accorder    en pourcentage ou en montant, sur N mois ;
--    plateforme.mois_offrir        N mois offerts, à partir d'un mois ;
--    plateforme.essai_prolonger    N jours de plus, tant que l'essai court.
--
--  Les lectures offertes (stock) et l'annulation (qui doit lire les factures)
--  viennent avec leurs tables (20261119090500, 20261119090600).
-- ======================================================================

-- ------------------------------------------------------------ 1. Les gestes

alter table plateforme.interventions
  add column payeur_type     text references ref.payeur_types (code),
  add column annule          uuid references plateforme.interventions (id),
  add column reglage_id      uuid references plateforme.reglages_commerciaux (id),
  add column cle_idempotence text;

alter table plateforme.interventions
  add constraint interventions_annule_une_fois unique (annule),
  add constraint interventions_cle_unique unique (cle_idempotence),
  add constraint interventions_annulation_nomme_son_geste
    check ((acte = 'annulation') = (annule is not null)),
  add constraint interventions_remise_et_mois_ont_leur_payeur
    check (acte not in ('remise_pourcentage', 'remise_montant', 'mois_offerts')
           or (payeur_type is not null and effet_du is not null and effet_au is not null
               and extract(day from effet_du) = 1));

create index interventions_payeur_type_fk_idx on plateforme.interventions (payeur_type);
create index interventions_reglage_id_fk_idx on plateforme.interventions (reglage_id);
create index interventions_licence_acte_idx on plateforme.interventions (licence_id, acte, effet_du);

/** Une valeur strictement positive dès que l'unité de l'acte n'est pas « aucune ». */
create function plateforme.geste_a_sa_valeur() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from ref.actes_intervention a
              where a.code = new.acte and a.unite <> 'aucune')
     and (new.valeur is null or new.valeur <= 0) then
    raise exception 'refus.geste.valeur_positive' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger interventions_geste_a_sa_valeur before insert on plateforme.interventions
  for each row execute function plateforme.geste_a_sa_valeur();

/** Un geste en vigueur : ni annulé, ni lui-même une annulation. */
create function plateforme.geste_en_vigueur(p_geste uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from plateforme.interventions x where x.annule = p_geste)
$$;
revoke all on function plateforme.geste_en_vigueur(uuid) from public, anon;
grant execute on function plateforme.geste_en_vigueur(uuid) to authenticated;

/**
 * Le corps commun des portes de gestes : la garde de la plateforme, le motif,
 * l'idempotence, le verrou de la licence (deux gestes concurrents se
 * sérialisent), les plafonds en vigueur recopiés, l'audit. Chaque porte borne
 * sa valeur AVANT de l'appeler. Non exécutable par un client.
 */
create function plateforme.geste_inscrire(
  p_licence uuid, p_acte text, p_valeur numeric, p_payeur_type text,
  p_du date, p_au date, p_motif text, p_cle text, p_annule uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id      uuid;
  v_existe  plateforme.interventions;
  v_tenant  uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.commerce.motif_requis' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from ref.actes_intervention a where a.code = p_acte and a.ouvert) then
    raise exception 'refus.geste.ferme' using errcode = 'check_violation';
  end if;

  if p_cle is not null then
    select * into v_existe from plateforme.interventions where cle_idempotence = p_cle;
    if v_existe.id is not null then
      if v_existe.licence_id <> p_licence or v_existe.acte <> p_acte then
        raise exception 'refus.commerce.cle_deja_prise' using errcode = 'unique_violation';
      end if;
      return to_jsonb(v_existe) || jsonb_build_object('deja', true);
    end if;
  end if;

  perform 1 from facturation.licences where id = p_licence for update;
  if not found then
    raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
  end if;

  insert into plateforme.interventions
    (licence_id, acte, motif, valeur, effet_du, effet_au, payeur_type, annule, reglage_id,
     cle_idempotence)
  values (p_licence, p_acte, p_motif, p_valeur, p_du, p_au, p_payeur_type, p_annule,
          (plateforme.reglage_commercial()).id, p_cle)
  returning id into v_id;

  select lo.tenant_id into v_tenant from facturation.licence_organisations lo
   where lo.licence_id = p_licence order by lo.tenant_id limit 1;
  if v_tenant is not null then
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'geste.' || p_acte, 'plateforme', 'interventions', v_id,
            jsonb_build_object('licence_id', p_licence, 'valeur', p_valeur, 'motif', p_motif));
  end if;

  return (select to_jsonb(i) || jsonb_build_object('deja', false)
            from plateforme.interventions i where i.id = v_id);
end
$$;
revoke all on function plateforme.geste_inscrire(uuid, text, numeric, text, date, date, text, text, uuid)
  from public, anon, authenticated;

/** Le prix mensuel HT de l'offre en vigueur de la licence : la mesure du plafond d'une remise en montant. */
create function plateforme.prix_mensuel_de(p_licence uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select d.prix_mensuel_ht::numeric from facturation.droits_v d where d.licence_id = p_licence
$$;
revoke all on function plateforme.prix_mensuel_de(uuid) from public, anon, authenticated;

/** Deux gestes de la même famille sur le même payeur ne se chevauchent pas. */
create function plateforme.geste_chevauche(
  p_licence uuid, p_actes text[], p_payeur_type text, p_du date, p_au date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from plateforme.interventions i
     where i.licence_id = p_licence and i.acte = any (p_actes)
       and i.payeur_type = p_payeur_type
       and plateforme.geste_en_vigueur(i.id)
       and daterange(i.effet_du, i.effet_au, '[]') && daterange(p_du, p_au, '[]'))
$$;
revoke all on function plateforme.geste_chevauche(uuid, text[], text, date, date) from public, anon, authenticated;

create function plateforme.remise_accorder(
  p_licence uuid, p_unite text, p_valeur numeric, p_payeur_type text, p_du date,
  p_mois smallint, p_motif text, p_cle text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     plateforme.reglages_commerciaux;
  v_au  date;
  v_prix numeric;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  r := plateforme.reglage_commercial();
  if p_unite not in ('pourcentage', 'montant') then
    raise exception 'refus.geste.unite_inconnue' using errcode = 'check_violation';
  end if;
  if p_du is null or extract(day from p_du) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;
  if p_mois is null or p_mois < 1 or p_mois > r.remise_duree_max_mois then
    raise exception '%', app.refus_avec_valeurs('refus.geste.au_dela_du_plafond',
                                                'plafond', r.remise_duree_max_mois::text)
      using errcode = 'check_violation';
  end if;
  if p_valeur is null or p_valeur <= 0 then
    raise exception 'refus.geste.valeur_positive' using errcode = 'check_violation';
  end if;
  if p_unite = 'pourcentage' and p_valeur > r.remise_pct_max then
    raise exception '%', app.refus_avec_valeurs('refus.geste.au_dela_du_plafond',
                                                'plafond', r.remise_pct_max::text)
      using errcode = 'check_violation';
  end if;
  if p_unite = 'montant' then
    v_prix := plateforme.prix_mensuel_de(p_licence);
    if v_prix is null then
      raise exception 'refus.introuvable.licence' using errcode = 'no_data_found';
    end if;
    if p_valeur > round(v_prix * r.remise_montant_max_mois, 3) then
      raise exception '%', app.refus_avec_valeurs('refus.geste.au_dela_du_plafond',
                                                  'plafond', round(v_prix * r.remise_montant_max_mois, 3)::text)
        using errcode = 'check_violation';
    end if;
  end if;
  v_au := (p_du + make_interval(months => p_mois) - interval '1 day')::date;
  if plateforme.geste_chevauche(p_licence, array['remise_pourcentage', 'remise_montant'],
                                p_payeur_type, p_du, v_au) then
    raise exception 'refus.geste.chevauchement' using errcode = 'check_violation';
  end if;
  return plateforme.geste_inscrire(p_licence,
                                   case p_unite when 'pourcentage' then 'remise_pourcentage'
                                                else 'remise_montant' end,
                                   p_valeur, p_payeur_type, p_du, v_au, p_motif, p_cle, null);
end
$$;
revoke all on function plateforme.remise_accorder(uuid, text, numeric, text, date, smallint, text, text)
  from public, anon;
grant execute on function plateforme.remise_accorder(uuid, text, numeric, text, date, smallint, text, text)
  to authenticated;

create function plateforme.mois_offrir(
  p_licence uuid, p_payeur_type text, p_du date, p_nombre smallint, p_motif text,
  p_cle text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r    plateforme.reglages_commerciaux;
  v_au date;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  r := plateforme.reglage_commercial();
  if p_du is null or extract(day from p_du) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;
  if p_nombre is null or p_nombre < 1 or p_nombre > r.mois_offerts_max then
    raise exception '%', app.refus_avec_valeurs('refus.geste.au_dela_du_plafond',
                                                'plafond', r.mois_offerts_max::text)
      using errcode = 'check_violation';
  end if;
  v_au := (p_du + make_interval(months => p_nombre) - interval '1 day')::date;
  if plateforme.geste_chevauche(p_licence, array['mois_offerts'], p_payeur_type, p_du, v_au) then
    raise exception 'refus.geste.chevauchement' using errcode = 'check_violation';
  end if;
  return plateforme.geste_inscrire(p_licence, 'mois_offerts', p_nombre, p_payeur_type,
                                   p_du, v_au, p_motif, p_cle, null);
end
$$;
revoke all on function plateforme.mois_offrir(uuid, text, date, smallint, text, text) from public, anon;
grant execute on function plateforme.mois_offrir(uuid, text, date, smallint, text, text) to authenticated;

-- ------------------------------------------------------------ 2. L'essai

create table facturation.essais (
  id                  uuid primary key default gen_random_uuid(),
  licence_id          uuid not null unique references facturation.licences (id) on delete restrict,
  tenant_id           uuid not null references identity.organizations (id) on delete restrict,
  titulaire           uuid not null references auth.users (id) on delete restrict,
  matricule_normalise text,
  canal               text not null references ref.canaux (code),
  du                  date not null,
  au                  date not null,
  grille_le           date not null,
  created_at          timestamptz not null default now(),
  constraint essais_fenetre check (au > du),
  constraint essais_une_fois_par_titulaire unique (titulaire),
  constraint essais_une_fois_par_organisation unique (tenant_id)
);
create unique index essais_une_fois_par_matricule
  on facturation.essais (matricule_normalise) where matricule_normalise is not null;
create index essais_tenant_idx on facturation.essais (tenant_id, du desc);
create index essais_canal_fk_idx on facturation.essais (canal);
comment on table facturation.essais is
  'L''essai gratuit, un mois, une fois : par licence, par titulaire, par organisation et par '
  'matricule fiscal (décisions du dirigeant n° 1 et 2). `au` est exclu. La fin effective, avec '
  'les prolongations et l''arrêt quand un cabinet dote, se lit dans facturation.essais_v.';

alter table facturation.essais enable row level security;
alter table facturation.essais force row level security;
revoke all on table facturation.essais from public, anon, service_role;
grant select on table facturation.essais to authenticated;
create policy facturation_essais_sel on facturation.essais for select to authenticated
  using ((select app.is_platform()) or licence_id in (select facturation.licences_lisibles()));
create policy service_hors_perimetre on facturation.essais as restrictive
  for select to authenticated using ((select app.service()) is null);
create trigger service_hors_perimetre before insert or update or delete on facturation.essais
  for each statement execute function app.service_hors_perimetre();
create trigger facturation_essais_ajout_seul before update or delete on facturation.essais
  for each row execute function app.deny_mutation();

/** Le couple (licence_id, tenant_id) existe, et le titulaire est celui de la licence. */
create function facturation.essai_legitime() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from facturation.licence_organisations lo
                  where lo.licence_id = new.licence_id and lo.tenant_id = new.tenant_id)
     or not exists (select 1 from facturation.licences l
                     where l.id = new.licence_id and l.titulaire = new.titulaire) then
    raise exception 'refus.essai.illegitime' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger essais_legitime before insert on facturation.essais
  for each row execute function facturation.essai_legitime();

create view facturation.essais_v with (security_invoker = true) as
  select e.id, e.licence_id, e.tenant_id, e.titulaire, e.canal, e.du, e.au,
         coalesce(p.jours, 0)::int as jours_prolonges,
         least((e.au + coalesce(p.jours, 0))::date, c.dote_le) as fin_effective,
         c.dote_le
    from facturation.essais e
    left join lateral (
      select sum(i.valeur)::int as jours
        from plateforme.interventions i
       where i.licence_id = e.licence_id and i.acte = 'prolongation_essai'
         and plateforme.geste_en_vigueur(i.id)) p on true
    left join lateral (
      select min(a.effet_du) as dote_le
        from facturation.acces a
       where a.licence_id = e.licence_id and a.canal = 'cabinet'
         and a.effet_du is not null and a.effet_du >= e.du
         and a.statut in ('actif', 'suspendu', 'termine')) c on true;
comment on view facturation.essais_v is
  'L''essai et sa fin effective (borne exclue) : `au` plus les prolongations non annulées, ou le '
  'jour où un cabinet dote la société s''il vient avant (décision du dirigeant n° 1).';
revoke all on facturation.essais_v from public, anon;
grant select on facturation.essais_v to authenticated;

/** La normalisation d'un matricule : lettres et chiffres, en majuscules. */
create function facturation.matricule_normalise(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

/** La naissance d'une licence ouvre l'essai, une fois, si le canal en donne un. */
create or replace function facturation.licence_naitre(
  p_tenant uuid, p_titulaire uuid, p_offre text default null, p_le date default current_date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_licence uuid;
  v_kind    text;
  v_offre   text;
  v_essai   ref.essais_par_canal;
begin
  -- D'ABORD la nature de la société, ENSUITE la porte. Dans l'autre ordre,
  -- un cabinet — dont le créateur est `expert`, jamais `dirigeant` — butait
  -- sur la porte au lieu d'être ignoré.
  select o.kind into v_kind from identity.organizations o where o.id = p_tenant;
  if v_kind is distinct from 'pme' then
    return null;
  end if;

  if auth.uid() is not null
     and not (app.is_platform() or app.has_org_role(p_tenant, array['dirigeant'])) then
    raise exception 'refus.reserve.dirigeant_ou_plateforme'
      using errcode = '42501';
  end if;

  select lo.licence_id into v_licence
    from facturation.licence_organisations lo where lo.tenant_id = p_tenant;
  if v_licence is not null then
    return v_licence;
  end if;

  v_offre := p_offre;
  if v_offre is null then
    select c.offre_code into v_offre
      from ref.offres_par_canal c
     where c.canal = 'direct' and c.par_defaut and c.effective_from <= p_le
     order by c.effective_from desc
     limit 1;
    if v_offre is null then
      raise exception '%', app.refus_avec_valeurs('refus.offre.naissance_absente', 'date', (p_le)::text)
        using errcode = '22023';
    end if;
  end if;

  insert into facturation.licences (titulaire, offre_code, offre_depuis, origine)
  values (p_titulaire, v_offre, p_le, 'direct')
  returning id into v_licence;

  insert into facturation.licence_organisations (licence_id, tenant_id)
  values (v_licence, p_tenant);

  -- L'essai : une fois par titulaire, par organisation, par matricule. Un
  -- conflit n'est pas une erreur : la licence naît, sans essai.
  select * into v_essai from ref.essais_par_canal e
   where e.canal = 'direct' and e.effective_from <= p_le
   order by e.effective_from desc limit 1;
  if v_essai.essai_mois > 0 then
    insert into facturation.essais
      (licence_id, tenant_id, titulaire, matricule_normalise, canal, du, au, grille_le)
    select v_licence, p_tenant, p_titulaire, facturation.matricule_normalise(o.legal_id),
           'direct', p_le, (p_le + make_interval(months => v_essai.essai_mois))::date,
           v_essai.effective_from
      from identity.organizations o where o.id = p_tenant
    on conflict do nothing;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, coalesce(auth.uid(), p_titulaire), 'licence.nee', 'facturation',
          'licences', v_licence, jsonb_build_object('offre', v_offre, 'depuis', p_le));

  return v_licence;
end
$$;

create function plateforme.essai_prolonger(
  p_licence uuid, p_jours smallint, p_motif text, p_cle text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r   plateforme.reglages_commerciaux;
  v_e record;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  r := plateforme.reglage_commercial();
  if p_jours is null or p_jours < 1 or p_jours > r.prolongation_essai_max_jours then
    raise exception '%', app.refus_avec_valeurs('refus.geste.au_dela_du_plafond',
                                                'plafond', r.prolongation_essai_max_jours::text)
      using errcode = 'check_violation';
  end if;
  select * into v_e from facturation.essais_v where licence_id = p_licence;
  if v_e.id is null then
    raise exception 'refus.essai.absent' using errcode = 'no_data_found';
  end if;
  if v_e.dote_le is not null or v_e.fin_effective < current_date then
    raise exception 'refus.essai.termine' using errcode = 'check_violation';
  end if;
  return plateforme.geste_inscrire(p_licence, 'prolongation_essai', p_jours, null,
                                   null, null, p_motif, p_cle, null);
end
$$;
revoke all on function plateforme.essai_prolonger(uuid, smallint, text, text) from public, anon;
grant execute on function plateforme.essai_prolonger(uuid, smallint, text, text) to authenticated;

-- ------------------------------------------------------------ 3. Les jours d'essai sortent du prorata

create or replace function facturation.a_facturer(p_licence uuid, p_periode date)
returns table(payeur_type text, payeur_tenant_id uuid, payeur_personne uuid, offre_code text,
              acces_reference text, jours integer, jours_du_mois integer, montant_ht app.money_t)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.is_platform()
          or exists (select 1 from facturation.licences l
                      where l.id = p_licence and l.titulaire = auth.uid())
          or exists (select 1 from facturation.acces a
                      where a.licence_id = p_licence
                        and a.cabinet_tenant_id in (select app.member_orgs()))) then
    raise exception
      'refus.geste.non_permis'
      using errcode = '42501';
  end if;

  return query
  with mois as (
    select p_periode                                     as du,
           (p_periode + interval '1 month')::date         as au_exclu,
           ((p_periode + interval '1 month')::date - p_periode)::int as jours
  ),
  essai as (
    select ev.fin_effective from facturation.essais_v ev where ev.licence_id = p_licence
  ),
  lignes as (
    select pv.payeur_type                        as payeur_type,
           pv.payeur_tenant_id                   as payeur_tenant_id,
           pv.payeur_personne                    as payeur_personne,
           pv.part_offre_code                    as part_offre_code,
           pv.acces_reference                    as acces_reference,
           pv.part_ht                            as part_ht,
           m.jours                               as jours_du_mois,
           -- Les jours d'essai ne se paient pas : la part du titulaire commence
           -- à la fin effective de l'essai.
           greatest(pv.du, m.du,
                    case when pv.payeur_type = 'titulaire'
                         then (select e.fin_effective from essai e) end) as seg_du,
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
  where l.seg_au_exclu > l.seg_du
  group by l.payeur_type, l.payeur_tenant_id, l.payeur_personne;
end
$$;

/** Les jours d'essai d'une licence dans un mois : zéro hors essai. */
create function facturation.jours_d_essai(p_licence uuid, p_periode date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select greatest(0, least(ev.fin_effective, (p_periode + interval '1 month')::date)
                                      - greatest(ev.du, p_periode))
                      from facturation.essais_v ev where ev.licence_id = p_licence), 0)::int
$$;
revoke all on function facturation.jours_d_essai(uuid, date) from public, anon;
grant execute on function facturation.jours_d_essai(uuid, date) to authenticated;
