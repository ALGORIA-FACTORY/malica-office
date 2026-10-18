-- ALGORIA facture, encaisse, et sait ce qui lui reste dû.
--
-- ================================================================== POURQUOI
--
-- Trois facturations coexistent dans ce produit, et les confondre serait la
-- faute la plus coûteuse du dépôt :
--
--   `billing.invoices`              ce que LA PME vend à ses clients
--   `collab.factures_honoraires`    ce que LE CABINET facture à ses dossiers
--   `facturation.factures`  (ici)   ce qu'ALGORIA facture à ses abonnés
--
-- Les deux premières portent `tenant_id` et vivent sous RLS de tenant. La
-- troisième est au-dessus : elle porte `licence_id`, et seuls la plateforme
-- et le titulaire la voient.
--
-- ============================================== POURQUOI LA FACTURE EST FIGÉE
--
-- Une facture émise ne se recalcule pas. Si la grille change en mars, la
-- facture de février doit continuer à dire ce qu'elle disait — sinon aucun
-- contrôle n'est possible, et un client qui compare deux relevés y trouve
-- deux chiffres différents pour le même mois.
--
-- D'où les montants STOCKÉS, et non dérivés de `ref.offres` à la lecture.
-- C'est l'exception à « rien ne se stocke qui peut se calculer » : un fait
-- comptable se fige au moment où il naît. R7, appliqué à nos propres ventes.
--
-- ============================================= LA FISCALITÉ, DANS LE RÉFÉRENTIEL
--
-- R4 : aucune constante réglementaire dans le code. Le taux de TVA et le
-- droit de timbre viennent donc de `ref.tva_rates` et `ref.socle_params`, lus
-- à l'émission et RECOPIÉS sur la facture. On ne met pas 19 % ici.

begin;

-- --- 1. La facture ----------------------------------------------------------

create table if not exists facturation.factures (
  id            uuid primary key default gen_random_uuid(),
  licence_id    uuid not null references facturation.licences(id) on delete restrict,

  -- Un numéro séquentiel, continu, sans trou : c'est une obligation, pas un
  -- confort. La séquence est posée plus bas.
  numero        text not null unique,

  periode       date not null,          -- le mois facturé, premier du mois
  emise_le      date not null,
  echeance_le   date not null,

  -- Ce qu'on facture, figé.
  offre_code    text not null,
  organisations smallint not null check (organisations >= 1),
  sieges_payants smallint not null check (sieges_payants >= 0),

  montant_ht    app.money_t not null check (montant_ht >= 0),
  -- Une FRACTION, comme `ref.tva_rates.rate` : 0,190000 et non 19. Les deux
  -- écritures coexistaient dans le produit ; celle du référentiel gagne.
  taux_tva      numeric(8,6) not null check (taux_tva >= 0),
  montant_tva   app.money_t not null check (montant_tva >= 0),
  timbre        app.money_t not null check (timbre >= 0),
  montant_ttc   app.money_t not null check (montant_ttc >= 0),
  devise        text not null default 'TND',

  statut        text not null default 'emise'
                check (statut in ('emise','payee','partielle','annulee','irrecouvrable')),

  -- Une facture ne se corrige pas : on en émet un avoir, qui la cite.
  avoir_de      uuid references facturation.factures(id),

  created_at    timestamptz not null default now(),

  constraint factures_periode_premier_du_mois check (extract(day from periode) = 1),
  constraint factures_echeance_apres_emission check (echeance_le >= emise_le),
  constraint factures_ttc_coherent
    check (montant_ttc = montant_ht + montant_tva + timbre),
  unique (licence_id, periode, avoir_de)
);

create index factures_licence_idx on facturation.factures (licence_id, periode desc);
create index factures_impayees_idx on facturation.factures (echeance_le)
  where statut in ('emise','partielle');

comment on table facturation.factures is
  'Ce qu''ALGORIA facture à ses abonnés. Montants figés à l''émission : une '
  'facture de février doit dire en mars ce qu''elle disait en février.';

create table if not exists facturation.facture_lignes (
  id          uuid primary key default gen_random_uuid(),
  facture_id  uuid not null references facturation.factures(id) on delete cascade,
  ordinal     smallint not null,
  libelle     text not null,
  quantite    numeric(12,2) not null default 1,
  prix_unitaire app.money_t not null,
  montant_ht  app.money_t not null,
  unique (facture_id, ordinal)
);

-- --- 2. L'encaissement ------------------------------------------------------
--
-- Append-only, comme les paiements d'une pièce, et pour la même raison : un
-- encaissement est un fait. Un virement qui revient impayé n'efface pas le
-- premier, il en inscrit un second, négatif et motivé.

create table if not exists facturation.encaissements (
  id          uuid primary key default gen_random_uuid(),
  facture_id  uuid not null references facturation.factures(id) on delete restrict,
  montant     app.money_t not null check (montant <> 0),
  moyen       text not null check (moyen in (
                'virement','cheque','especes','carte','prelevement','compensation')),
  reference   text,
  encaisse_le date not null,
  -- Un rejet est un encaissement négatif qui cite celui qu'il annule.
  annule_id   uuid references facturation.encaissements(id),
  motif       text,
  saisi_par   uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint encaissements_negatif_motive
    check (montant > 0 or (annule_id is not null and motif is not null))
);

create index encaissements_facture_idx on facturation.encaissements (facture_id);

-- --- 3. Ce qui reste dû, et ce qui est en retard ---------------------------

create or replace view facturation.encours_v as
select
  f.id                         as facture_id,
  f.licence_id, f.numero, f.periode, f.emise_le, f.echeance_le,
  f.montant_ttc,
  coalesce(e.encaisse, 0)      as encaisse,
  (f.montant_ttc - coalesce(e.encaisse, 0)) as reste_du,
  case
    when f.statut in ('annulee','irrecouvrable')        then f.statut
    when coalesce(e.encaisse, 0) >= f.montant_ttc       then 'payee'
    when coalesce(e.encaisse, 0) > 0                    then 'partielle'
    when f.echeance_le < current_date                   then 'en_retard'
    else 'a_echoir'
  end                          as etat,
  greatest(0, current_date - f.echeance_le)::int as jours_de_retard
from facturation.factures f
left join lateral (
  select sum(montant) as encaisse from facturation.encaissements
  where facture_id = f.id
) e on true
where f.avoir_de is null;

comment on view facturation.encours_v is
  'L''état réel de chaque facture, déduit des encaissements. Le `statut` '
  'stocké reste la décision humaine (annulée, irrécouvrable) ; le reste se '
  'calcule, parce qu''un solde recalculé ne se désaccorde jamais.';

-- --- 4. Le flux monétaire ---------------------------------------------------
--
-- Par mois : ce qui a été facturé, ce qui a été encaissé, et l'écart. C'est
-- la question que pose un dirigeant le 5 du mois, et elle n'a pas besoin de
-- plus de trois colonnes pour être répondue.

create or replace view facturation.flux_mensuel_v as
with mois as (
  select date_trunc('month', d)::date as m
  from generate_series(
    (select coalesce(min(periode), current_date) from facturation.factures),
    date_trunc('month', current_date)::date, interval '1 month') d
)
select
  m.m                                           as mois,
  coalesce(fa.facture_ht,  0)                   as facture_ht,
  coalesce(fa.facture_ttc, 0)                   as facture_ttc,
  coalesce(en.encaisse,    0)                   as encaisse,
  coalesce(fa.facture_ttc, 0) - coalesce(en.encaisse, 0) as ecart,
  coalesce(fa.nb, 0)                            as factures_emises
from mois m
left join lateral (
  select sum(montant_ht) as facture_ht, sum(montant_ttc) as facture_ttc,
         count(*) as nb
  from facturation.factures
  where periode = m.m and avoir_de is null and statut <> 'annulee'
) fa on true
left join lateral (
  select sum(montant) as encaisse from facturation.encaissements
  where date_trunc('month', encaisse_le)::date = m.m
) en on true
order by m.m;

comment on view facturation.flux_mensuel_v is
  'Facturé contre encaissé, par mois. L''écart est la seule colonne qui '
  'demande une action.';

-- --- 4bis. Le droit de timbre entre au référentiel -------------------------
--
-- Il n'y était pas : `ref.socle_params` porte dix paramètres, tous métier,
-- aucun fiscal de facturation. La maquette des paramètres calculait
-- `ht * 1,19 + 1` en dur — c'est exactement la constante que R4 interdit.
--
-- R11 : la date est écrite, jamais `current_date`. Et `valid_to` reste nul :
-- le jour où la loi de finances le change, une migration pose la fin de
-- celle-ci et le début de la suivante, sans toucher au code.
--
-- ⚠ Le montant doit être confirmé par Mondher contre la dernière loi de
-- finances avant la première facture émise. Il est ici parce qu'il doit
-- exister quelque part, et quelque part veut dire cette table.

insert into ref.socle_params
  (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, 'facture.droit_de_timbre', 1.000,
       'Code des droits d''enregistrement et de timbre — droit sur facture',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and p.effective_from <= date '2026-01-01'
   and (p.effective_to is null or p.effective_to >= date '2026-01-01')
on conflict do nothing;

-- --- 5. Émettre -------------------------------------------------------------
--
-- Une seule porte, et elle lit le référentiel fiscal au lieu de porter des
-- constantes (R4). Le numéro vient d'une séquence dédiée : `billing` en a
-- déjà une pour les ventes des clients, et mélanger les deux donnerait des
-- trous dans l'une et des doublons dans l'autre.

create sequence if not exists facturation.numero_facture_seq;

create or replace function facturation.emettre(
  p_licence uuid, p_periode date, p_jours_echeance integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          record;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_ht       app.money_t;
  v_tva      app.money_t;
  v_numero   text;
  v_id       uuid;
  v_sieges   smallint;
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

  -- R4 : le taux et le timbre viennent du référentiel en vigueur, par leur
  -- CODE et leur date de validité — jamais d'un littéral dans cette fonction.
  -- `pack_version_id` n'est pas filtré ici : ALGORIA facture en Tunisie, sous
  -- le pack actif, et `valid_to is null` suffit à désigner la ligne en cours.
  select r.rate into v_taux
    from ref.tva_rates r
   where r.code = 'TVA19'
     and r.valid_from <= current_date
     and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date
     and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  -- Pas de valeur de repli. R4 jusqu'au bout : une facture émise sous un taux
  -- supposé serait fausse sans que personne ne le voie, et un `coalesce(…, 19)`
  -- est exactement la constante que la règle interdit.
  if v_taux is null then
    raise exception 'aucun taux de TVA en vigueur (ref.tva_rates, code TVA19)'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'aucun droit de timbre en vigueur (ref.socle_params, code facture.droit_de_timbre)'
      using errcode = 'no_data_found';
  end if;

  v_ht     := c.prix_mensuel_ht;
  -- `rate` est une fraction : pas de division par cent, et l'arrondi au
  -- millime, qui est la plus petite unité du dinar.
  v_tva    := round(v_ht * v_taux, 3);
  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;
  v_numero := 'ALG-' || to_char(p_periode, 'YYYYMM') || '-'
              || lpad(nextval('facturation.numero_facture_seq')::text, 5, '0');

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code,
     organisations, sieges_payants, montant_ht, taux_tva, montant_tva,
     timbre, montant_ttc)
  values
    (p_licence, v_numero, p_periode, current_date,
     current_date + p_jours_echeance, c.offre_code,
     c.organisations, v_sieges, v_ht, v_taux, v_tva, v_timbre,
     v_ht + v_tva + v_timbre)
  returning id into v_id;

  insert into facturation.facture_lignes
    (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
  values (v_id, 1, 'Abonnement ' || c.offre_code || ' — '
                   || to_char(p_periode, 'TMMonth YYYY'),
          1, v_ht, v_ht);

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero,
                            'ttc', v_ht + v_tva + v_timbre);
end
$$;

-- --- 6. L'isolation ---------------------------------------------------------
--
-- La plateforme voit tout ; le titulaire voit SES factures, et rien d'autre.
-- Un client doit pouvoir télécharger ses propres factures sans passer par un
-- courriel — c'est la première chose que son comptable lui réclamera.

do $$
declare t text;
begin
  foreach t in array array['factures','facture_lignes','encaissements'] loop
    execute format('alter table facturation.%I enable row level security', t);
    execute format('alter table facturation.%I force row level security', t);
    execute format('revoke all on table facturation.%I from public, anon, service_role', t);
    execute format('grant select on table facturation.%I to authenticated', t);
  end loop;
end $$;

create policy facturation_factures_sel on facturation.factures
  for select to authenticated
  using (app.is_platform()
         or licence_id in (select id from facturation.licences
                            where titulaire = auth.uid()));

create policy facturation_facture_lignes_sel on facturation.facture_lignes
  for select to authenticated
  using (exists (select 1 from facturation.factures f
                  where f.id = facture_id
                    and (app.is_platform()
                         or f.licence_id in (select id from facturation.licences
                                              where titulaire = auth.uid()))));

create policy facturation_encaissements_sel on facturation.encaissements
  for select to authenticated
  using (exists (select 1 from facturation.factures f
                  where f.id = facture_id
                    and (app.is_platform()
                         or f.licence_id in (select id from facturation.licences
                                              where titulaire = auth.uid()))));

-- Seule la plateforme écrit. Et les encaissements sont en ajout seul (R7).
grant insert on table facturation.factures, facturation.facture_lignes,
                     facturation.encaissements to authenticated;
create policy facturation_factures_ins on facturation.factures
  for insert to authenticated with check (app.is_platform());
create policy facturation_facture_lignes_ins on facturation.facture_lignes
  for insert to authenticated with check (app.is_platform());
create policy facturation_encaissements_ins on facturation.encaissements
  for insert to authenticated with check (app.is_platform());

create trigger facturation_encaissements_no_upd
  before update or delete on facturation.encaissements
  for each row execute function app.deny_mutation();

grant select on facturation.encours_v, facturation.flux_mensuel_v to authenticated;
revoke all on function facturation.emettre(uuid, date, integer) from public, anon;
grant execute on function facturation.emettre(uuid, date, integer) to authenticated;

commit;
