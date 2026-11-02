-- ======================================================================
--  La passe de nuit (B.2, B.3, B.4 — conception validée le 2 novembre 2026).
--
--  Les relectures ne partent plus en journée (décision 4). Une passe planifiée
--  dans le processus de l'API (`malica/lecture/demarrer-la-nuit.ts`) les fait
--  tourner, dossier par dossier, sous le relecteur de nuit (20261118100000) :
--
--    * dans la fenêtre de nuit du DOSSIER, à son heure locale (décision 1) —
--      `organizations.fuseau`, sinon celui de sa juridiction ; sans fuseau, le
--      dossier est écarté et le motif le dit, jamais une heure UTC devinée ;
--    * sous trois plafonds glissants sur 24 h et une part du plafond IA
--      mensuel (décision 2) ; un dossier au plafond n'est pas PRIS : aucune
--      tentative consommée ;
--    * en cédant la place à toute lecture fraîche (le client passe d'abord) ;
--    * ALGORIA paie : une relecture ne touche jamais `facturation.lectures`
--      (décision 3 — le relecteur n'a pas le droit d'y écrire).
--
--  Tous les seuils sont EN BASE, datés, en ajout seul, réglés par la tour
--  (`plateforme.reglages_relecture_nuit`, R10). Les valeurs de départ sont
--  INCERTAINES : le coût réel d'une relecture n'a pas été mesuré. Elles se
--  revoient après la première nuit observée sur le staging. La passe est
--  livrée COUPÉE (`actif = false`, décision 8).
--
--  Le délai avant relecture passe de 12 h à 4 h (décision 5), par le défaut
--  du pack et seulement s'il valait encore 12 h — forme de 20261108100000.
--
--  REJEU (R11) : les dates de la ligne initiale sont des littéraux ; aucune
--  horloge n'écrit dans `ref`.
-- ======================================================================

-- ------------------------------------------------- 1. Le délai avant relecture : 4 h

update ref.socle_params
   set value_num = 4
 where code = 'lecture.relecture_delai_heures'
   and value_num = 12;

-- Ce qui restait au réglage (« il manque un déclencheur planifié sous une
-- identité de service », 20261117100100) est fait : le libellé le dit.
update ref.labels set value = v.value
  from (values
    ('fr', 'Appliqués : la relecture de nuit et son délai. Elle part la nuit, à l''heure du '
           'dossier, sous le relecteur de nuit, quand la plateforme a ouvert la passe de nuit ; '
           'ALGORIA la paie. Le passage en désignation se décide sur les mesures de l''observation '
           'des vraies pièces.'),
    ('en', 'Applied: the night re-reading and its delay. It runs at night, at the file''s time, '
           'under the night re-reader, once the platform has opened the night pass; ALGORIA pays '
           'for it. Switching to designation is decided on the measurements of observing real '
           'documents.'),
    ('ar', 'مطبّق: إعادة القراءة الليلية ومهلتها. تنطلق ليلاً، بتوقيت الملف، تحت القارئ الليلي، متى '
           'فتحت المنصة المرور الليلي؛ وتتحمّل ألغوريا كلفتها. يُقرَّر المرور إلى التعيين على أساس '
           'قياسات ملاحظة الوثائق الحقيقية.')
  ) as v(locale, value)
 where ref.labels.ns = 'reglage_sujet_incertain' and ref.labels.key = 'lecture'
   and ref.labels.locale = v.locale;

-- ------------------------------------------------------------ 2. Le réglage de la tour

create table plateforme.reglages_relecture_nuit (
  id                          uuid primary key default gen_random_uuid(),
  actif                       boolean not null,
  fenetre_debut               time not null,
  fenetre_fin                 time not null,
  plafond_usd_24h_plateforme  numeric(12,4) not null check (plafond_usd_24h_plateforme >= 0),
  plafond_usd_24h_dossier     numeric(12,4) not null check (plafond_usd_24h_dossier >= 0),
  relectures_max_24h_dossier  integer not null check (relectures_max_24h_dossier >= 0),
  part_max_plafond_mensuel    numeric(5,4) not null
                                check (part_max_plafond_mensuel >= 0 and part_max_plafond_mensuel <= 1),
  alerte_retard_nuits         integer not null check (alerte_retard_nuits > 0),
  motif                       text not null check (length(btrim(motif)) > 0),
  decide_par                  uuid,
  decide_le                   timestamptz not null default now(),
  constraint reglages_relecture_nuit_fenetre check (fenetre_debut <> fenetre_fin)
);

comment on table plateforme.reglages_relecture_nuit is
  'La passe de nuit : interrupteur, fenêtre (heure locale du dossier, fin exclue, peut passer '
  'minuit), plafonds glissants sur 24 h (plateforme, dossier, nombre de relectures), part du '
  'plafond IA mensuel au-delà de laquelle on ne relit plus, et seuil d''alerte des relectures en '
  'retard (en nuits). La dernière décision de la tour vaut.';

alter table plateforme.reglages_relecture_nuit enable row level security;
alter table plateforme.reglages_relecture_nuit force row level security;
revoke all on table plateforme.reglages_relecture_nuit from public, anon;
grant select on table plateforme.reglages_relecture_nuit to authenticated;
create policy reglages_relecture_nuit_lire on plateforme.reglages_relecture_nuit
  for select to authenticated using ((select app.is_platform()));
create trigger reglages_relecture_nuit_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_relecture_nuit
  for each row execute function app.deny_mutation();

-- Valeurs INCERTAINES (coût réel non mesuré), livrées coupées.
insert into plateforme.reglages_relecture_nuit
  (actif, fenetre_debut, fenetre_fin, plafond_usd_24h_plateforme, plafond_usd_24h_dossier,
   relectures_max_24h_dossier, part_max_plafond_mensuel, alerte_retard_nuits, motif, decide_par,
   decide_le)
values
  (false, time '01:00', time '06:00', 20, 1, 200, 0.5, 3,
   'Valeurs de départ décidées par le dirigeant le 2 novembre 2026, INCERTAINES (coût réel d''une '
   'relecture non mesuré) : à revoir après la première nuit observée. Livrée coupée.',
   null, timestamptz '2026-11-02 00:00:00+00');

/* Le réglage en vigueur. Lu par les fonctions de la passe seulement. */
create function plateforme.relecture_nuit_en_vigueur()
returns plateforme.reglages_relecture_nuit
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from plateforme.reglages_relecture_nuit r
   order by r.decide_le desc, r.id desc
   limit 1
$$;

revoke all on function plateforme.relecture_nuit_en_vigueur() from public, anon, authenticated;

/* La tour règle la passe : daté, motivé, en ajout seul. */
create function plateforme.relecture_nuit_regler(
  p_actif boolean, p_fenetre_debut time, p_fenetre_fin time,
  p_plafond_usd_24h_plateforme numeric, p_plafond_usd_24h_dossier numeric,
  p_relectures_max_24h_dossier integer, p_part_max_plafond_mensuel numeric,
  p_alerte_retard_nuits integer, p_motif text)
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
  if p_actif is null or p_fenetre_debut is null or p_fenetre_fin is null
     or p_plafond_usd_24h_plateforme is null or p_plafond_usd_24h_dossier is null
     or p_relectures_max_24h_dossier is null or p_part_max_plafond_mensuel is null
     or p_alerte_retard_nuits is null or p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_fenetre_debut = p_fenetre_fin then
    raise exception 'refus.relecture_nuit.fenetre_vide' using errcode = '22023';
  end if;
  if p_plafond_usd_24h_plateforme < 0 or p_plafond_usd_24h_dossier < 0
     or p_relectures_max_24h_dossier < 0 or p_alerte_retard_nuits <= 0
     or p_part_max_plafond_mensuel < 0 or p_part_max_plafond_mensuel > 1 then
    raise exception 'refus.relecture_nuit.hors_bornes' using errcode = '22023';
  end if;
  insert into plateforme.reglages_relecture_nuit
    (actif, fenetre_debut, fenetre_fin, plafond_usd_24h_plateforme, plafond_usd_24h_dossier,
     relectures_max_24h_dossier, part_max_plafond_mensuel, alerte_retard_nuits, motif, decide_par)
  values (p_actif, p_fenetre_debut, p_fenetre_fin, p_plafond_usd_24h_plateforme,
          p_plafond_usd_24h_dossier, p_relectures_max_24h_dossier, p_part_max_plafond_mensuel,
          p_alerte_retard_nuits, btrim(p_motif), auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_relecture_nuit r
           where r.id = v_id);
end
$$;

revoke all on function plateforme.relecture_nuit_regler(
  boolean, time, time, numeric, numeric, integer, numeric, integer, text) from public, anon;
grant execute on function plateforme.relecture_nuit_regler(
  boolean, time, time, numeric, numeric, integer, numeric, integer, text) to authenticated;

-- ------------------------------------------------------------- 3. La fenêtre de nuit

/* Une heure dans une fenêtre [début, fin), qui peut passer minuit. */
create function app.heure_dans_la_fenetre(p_heure time, p_debut time, p_fin time)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_debut < p_fin then p_heure >= p_debut and p_heure < p_fin
              else p_heure >= p_debut or p_heure < p_fin end
$$;

revoke all on function app.heure_dans_la_fenetre(time, time, time) from public, anon;

/*
 * L'instant `p_a` est-il dans la fenêtre de nuit du dossier, à SON heure
 * locale ? Le fuseau suit la règle de `pieces_v.recue_le` (20261117100000) :
 * celui du dossier, sinon celui de sa juridiction ; aucun des deux lève
 * `refus.fuseau.dossier_non_defini` — jamais une heure UTC devinée (R4).
 */
create function app.dans_la_fenetre_de_nuit(p_tenant uuid, p_a timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fuseau text;
  v_reglage plateforme.reglages_relecture_nuit := plateforme.relecture_nuit_en_vigueur();
begin
  select coalesce(o.fuseau, c.fuseau) into v_fuseau
    from identity.organizations o
    left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
   where o.id = p_tenant;
  return app.heure_dans_la_fenetre((p_a at time zone app.fuseau_defini(v_fuseau))::time,
                                   v_reglage.fenetre_debut, v_reglage.fenetre_fin);
end
$$;

revoke all on function app.dans_la_fenetre_de_nuit(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.dans_la_fenetre_de_nuit(uuid, timestamptz) to malica_api;

-- ------------------------------------------------------------------- 4. Le budget

create index if not exists agent_runs_created_by_created_at_idx
  on agents.agent_runs (created_by, created_at);
create index if not exists travail_faits_inscrit_par_inscrit_le_idx
  on fabrique.travail_faits (inscrit_par, inscrit_le);

/*
 * La raison de ne pas relire ce dossier à l'instant `p_a`, ou nul :
 *   plafond.plateforme   la dépense du relecteur sur 24 h, tous dossiers ;
 *   plafond.dossier      sa dépense sur 24 h dans ce dossier ;
 *   plafond.relectures   ses prises sur 24 h dans ce dossier ;
 *   plafond.mensuel      la dépense IA du mois du dossier — journée comprise —
 *                        a atteint la part réglée de son plafond mensuel.
 * La dépense de nuit est celle du relecteur seul (`created_by`) : ce qu'un
 * membre dépense en journée ne compte pas au plafond de nuit, mais compte au
 * mensuel. Le coût n'est connu qu'APRÈS l'appel : un plafond peut être
 * dépassé d'au plus une relecture, et c'est dit.
 */
create function fabrique.relecture_nuit_budget(p_tenant uuid, p_a timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reglage plateforme.reglages_relecture_nuit := plateforme.relecture_nuit_en_vigueur();
  v_service uuid := app.compte_de_service_id('relecteur_de_nuit');
  v_depuis timestamptz := p_a - interval '1 day';
begin
  if (select coalesce(sum(r.cost), 0) from agents.agent_runs r
       where r.created_by = v_service and r.created_at > v_depuis and r.created_at <= p_a)
     >= v_reglage.plafond_usd_24h_plateforme then
    return 'plafond.plateforme';
  end if;
  if (select coalesce(sum(r.cost), 0) from agents.agent_runs r
       where r.created_by = v_service and r.tenant_id = p_tenant
         and r.created_at > v_depuis and r.created_at <= p_a)
     >= v_reglage.plafond_usd_24h_dossier then
    return 'plafond.dossier';
  end if;
  if (select count(*) from fabrique.travail_faits f
       where f.inscrit_par = v_service and f.tenant_id = p_tenant and f.nature = 'pris'
         and f.inscrit_le > v_depuis and f.inscrit_le <= p_a)
     >= v_reglage.relectures_max_24h_dossier then
    return 'plafond.relectures';
  end if;
  if app.depense_ia_du_mois(p_tenant)
     >= v_reglage.part_max_plafond_mensuel * app.plafond_ia_de(p_tenant) then
    return 'plafond.mensuel';
  end if;
  return null;
end
$$;

revoke all on function fabrique.relecture_nuit_budget(uuid, timestamptz) from public, anon, authenticated;
grant execute on function fabrique.relecture_nuit_budget(uuid, timestamptz) to malica_api;

-- ------------------------------------------------------------ 5. Les passages, observés

create table fabrique.passages_de_nuit (
  id        uuid primary key default gen_random_uuid(),
  ouvert_le timestamptz not null
);

comment on table fabrique.passages_de_nuit is
  'Un passage de la passe de nuit. Ses faits disent comment il s''est fermé ; sans fait de fin, '
  'il a été interrompu (processus tué, déploiement).';

create table fabrique.passage_faits (
  id         uuid primary key default gen_random_uuid(),
  passage_id uuid not null references fabrique.passages_de_nuit (id),
  nature     text not null
               check (nature in ('ouvert', 'cede', 'fenetre_close', 'plafond', 'termine')),
  detail     jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  inscrit_le timestamptz not null
);
create index passage_faits_passage_idx on fabrique.passage_faits (passage_id, inscrit_le);
create unique index passage_faits_une_fin_ux on fabrique.passage_faits (passage_id)
  where nature <> 'ouvert';
create unique index passage_faits_une_ouverture_ux on fabrique.passage_faits (passage_id)
  where nature = 'ouvert';

comment on table fabrique.passage_faits is
  'Ouvert, puis une fin : cede (une lecture fraîche attendait), fenetre_close, plafond '
  '(plateforme), termine. Le détail porte les compteurs du passage et les dossiers écartés.';

do $$
declare
  t text;
begin
  foreach t in array array['passages_de_nuit', 'passage_faits'] loop
    execute format('alter table fabrique.%I enable row level security', t);
    execute format('alter table fabrique.%I force row level security', t);
    execute format('revoke all on table fabrique.%I from public, anon', t);
    execute format('grant select on table fabrique.%I to authenticated', t);
    execute format('create policy %I on fabrique.%I for select to authenticated '
                   'using ((select app.is_platform()))', t || '_lire', t);
    execute format('create trigger %I before update or delete on fabrique.%I '
                   'for each row execute function app.deny_mutation()',
                   t || '_ne_se_reecrivent_pas', t);
  end loop;
end
$$;

-- ---------------------------------------------------- 6. L'ordonnanceur : hors RLS, l'API seule

/*
 * La clé du verrou consultatif de la passe : un seul passage à la fois, même
 * si deux API tournent. L'API la tient en verrou de SESSION pendant tout le
 * passage ; la tour la lit pour dire qu'un passage est en cours.
 */
create function fabrique.passe_de_nuit_verrou()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select hashtext('fabrique.passe_de_nuit')::bigint
$$;

-- L'ordonnanceur s'exécute sous le rôle de connexion de l'API, hors RLS ; il
-- n'a que l'usage du schéma et l'exécution des fonctions qui suivent.
grant usage on schema fabrique to malica_api;
revoke all on function fabrique.passe_de_nuit_verrou() from public, anon;
grant execute on function fabrique.passe_de_nuit_verrou() to authenticated, malica_api;

/*
 * Ouvre un passage, ou rend nul si la passe est coupée par la tour ou si le
 * relecteur est révoqué : rien ne s'inscrit alors, une passe coupée ne fait
 * pas de bruit toutes les dix minutes.
 */
create function fabrique.passe_de_nuit_ouvrir(p_a timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reglage plateforme.reglages_relecture_nuit := plateforme.relecture_nuit_en_vigueur();
  v_passage uuid;
begin
  if not coalesce(v_reglage.actif, false)
     or not exists (select 1 from identity.comptes_de_service_v v
                     where v.code = 'relecteur_de_nuit' and v.actif) then
    return null;
  end if;
  insert into fabrique.passages_de_nuit (ouvert_le) values (p_a) returning id into v_passage;
  insert into fabrique.passage_faits (passage_id, nature, detail, inscrit_le)
  values (v_passage, 'ouvert', to_jsonb(v_reglage) - 'decide_par' - 'motif', p_a);
  return v_passage;
end
$$;

/*
 * Les dossiers qui ont une relecture prenable à `p_a`, la plus ancienne due
 * d'abord : leur identifiant et des compteurs, aucun contenu. `ecart` est nul
 * pour un dossier à relire maintenant ; sinon il dit pourquoi pas : hors de
 * sa fenêtre, sans fuseau (`refus.fuseau.dossier_non_defini`), ou le plafond
 * atteint (`fabrique.relecture_nuit_budget`).
 */
create function fabrique.dossiers_a_relire(p_passage uuid, p_a timestamptz)
returns table (tenant_id uuid, en_attente integer, plus_ancienne_due timestamptz, ecart text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_dans boolean;
begin
  if not exists (select 1 from fabrique.passage_faits f
                  where f.passage_id = p_passage and f.nature = 'ouvert')
     or exists (select 1 from fabrique.passage_faits f
                 where f.passage_id = p_passage and f.nature <> 'ouvert') then
    raise exception 'refus.relecture_nuit.passage_ferme' using errcode = '42501';
  end if;
  for r in
    select e.tenant_id, count(*)::integer as n, min(e.prenable_a) as due
      from fabrique.etat_des_travaux_v e
      -- Un dossier archivé ne se relit plus.
      join identity.organizations o on o.id = e.tenant_id and o.archived_at is null
     where e.nature = 'relecture_piece'
       and e.etat in ('a_faire', 'abandonne', 'en_panne')
       and e.prenable_a <= p_a
     group by e.tenant_id
     order by min(e.prenable_a), e.tenant_id
  loop
    tenant_id := r.tenant_id;
    en_attente := r.n;
    plus_ancienne_due := r.due;
    begin
      v_dans := app.dans_la_fenetre_de_nuit(r.tenant_id, p_a);
      ecart := case when not v_dans then 'hors_fenetre'
                    else fabrique.relecture_nuit_budget(r.tenant_id, p_a) end;
    exception when sqlstate '22023' then
      -- Le seul refus de la fenêtre : un dossier sans fuseau. Il se dit.
      ecart := sqlerrm;
    end;
    return next;
  end loop;
end
$$;

/*
 * Une lecture fraîche attend-elle, quelque part ? Une lecture en cours, ou
 * demandée depuis moins que son âge d'abandon (`fabrique.seuil.travail.
 * abandon_s`, celui du dossier). Plus ancienne, elle n'est plus « fraîche » :
 * elle attend son auteur, et la nuit n'a pas à l'attendre avec elle.
 */
create function fabrique.lectures_en_attente(p_a timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from fabrique.etat_des_travaux_v e
     where e.nature = 'lecture_piece'
       and (e.etat = 'en_cours'
            or (e.etat = 'a_faire'
                and e.demande_le > p_a - make_interval(secs => (
                      select b.valeur::double precision
                        from fabrique.bornes_de_travail(e.tenant_id) b
                       where b.borne = 'abandon_s')))))
$$;

/* Ferme un passage : une seule fin, ses compteurs, et la raison. */
create function fabrique.passe_de_nuit_fermer(
  p_passage uuid, p_raison text, p_compteurs jsonb, p_a timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_raison is null or p_raison not in ('cede', 'fenetre_close', 'plafond', 'termine') then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into fabrique.passage_faits (passage_id, nature, detail, inscrit_le)
  values (p_passage, p_raison, coalesce(p_compteurs, '{}'::jsonb), p_a);
end
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'fabrique.passe_de_nuit_ouvrir(timestamptz)',
    'fabrique.dossiers_a_relire(uuid, timestamptz)',
    'fabrique.lectures_en_attente(timestamptz)',
    'fabrique.passe_de_nuit_fermer(uuid, text, jsonb, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to malica_api', f);
  end loop;
end
$$;

-- ---------------------------------------------------------------- 7. Ce que la tour lit

/*
 * Par dossier et par jour LOCAL du dossier : retenues, écartées, abstentions
 * par motif, pannes, épuisées, coût du relecteur ; et, sur la ligne du jour,
 * les relectures en attente, l'âge en nuits de la plus ancienne, et l'alerte
 * au-delà du seuil réglé. `sans_cout` compte les relectures qui ont appelé
 * un modèle (retenue ou écartée) sans ligne de coût du relecteur : un modèle
 * sans tarif, que le plafond en dollars ne borne pas.
 *
 * Un dossier sans fuseau n'a pas de jour local : `jour` est nul, et c'est
 * visible plutôt que deviné.
 */
create view plateforme.relectures_de_nuit_v with (security_invoker = true) as
with service as (
  select c.id from identity.comptes_de_service c where c.code = 'relecteur_de_nuit'
),
reglage as (
  select r.alerte_retard_nuits from plateforme.reglages_relecture_nuit r
   order by r.decide_le desc, r.id desc limit 1
),
dossiers as (
  select o.id as tenant_id, o.name as dossier, coalesce(o.fuseau, c.fuseau) as fuseau
    from identity.organizations o
    left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
   where exists (select 1 from fabrique.travaux t
                  where t.tenant_id = o.id and t.nature = 'relecture_piece')
),
faits as (
  select t.tenant_id, (f.inscrit_le at time zone d.fuseau)::date as jour, f.nature::text as nature,
         f.motif, t.piece_id, f.travail_id, f.tentative, f.inscrit_le
    from fabrique.travail_faits f
    join fabrique.travaux t on t.id = f.travail_id and t.nature = 'relecture_piece'
    join dossiers d on d.tenant_id = t.tenant_id
   where f.nature <> 'pris'
),
sans_cout as (
  select x.tenant_id, x.jour, count(*)::integer as n
    from faits x
   where x.nature = 'termine' and x.motif in ('relecture.retenue', 'relecture.ecartee')
     and not exists (
       select 1 from agents.agent_runs r
        join fabrique.travail_faits p on p.travail_id = x.travail_id and p.tentative = x.tentative
                                     and p.nature = 'pris'
        where r.created_by = (select s.id from service s) and r.piece_id = x.piece_id
          and r.created_at between p.inscrit_le and x.inscrit_le)
   group by x.tenant_id, x.jour
),
couts as (
  select r.tenant_id, (r.created_at at time zone d.fuseau)::date as jour, sum(r.cost) as usd
    from agents.agent_runs r
    join dossiers d on d.tenant_id = r.tenant_id
   where r.created_by = (select s.id from service s)
   group by 1, 2
),
etats as (
  select e.tenant_id, e.etat, e.prenable_a, d.fuseau,
         (coalesce(e.dernier_le, e.demande_le) at time zone d.fuseau)::date as jour_du_fait,
         (now() at time zone d.fuseau)::date as aujourd_hui
    from fabrique.etat_des_travaux_v e
    join dossiers d on d.tenant_id = e.tenant_id
   where e.nature = 'relecture_piece'
),
attente as (
  select x.tenant_id, x.aujourd_hui as jour, count(*)::integer as n,
         max(x.aujourd_hui - (x.prenable_a at time zone x.fuseau)::date) as nuits
    from etats x
   where x.etat in ('a_faire', 'abandonne', 'en_panne') and x.prenable_a <= now()
   group by 1, 2
),
epuisees as (
  select x.tenant_id, x.jour_du_fait as jour, count(*)::integer as n
    from etats x where x.etat = 'epuise' group by 1, 2
),
cles as (
  select tenant_id, jour from faits
  union select tenant_id, jour from couts
  union select tenant_id, jour from attente
  union select tenant_id, jour from epuisees
)
select k.jour,
       k.tenant_id,
       d.dossier,
       (select count(*) from faits f where f.tenant_id = k.tenant_id and f.jour is not distinct from k.jour
           and f.nature = 'termine' and f.motif = 'relecture.retenue')::integer as retenues,
       (select count(*) from faits f where f.tenant_id = k.tenant_id and f.jour is not distinct from k.jour
           and f.nature = 'termine' and f.motif = 'relecture.ecartee')::integer as ecartees,
       coalesce((select jsonb_object_agg(a.motif, a.n) from (
                  select f.motif, count(*) as n from faits f
                   where f.tenant_id = k.tenant_id and f.jour is not distinct from k.jour
                     and f.nature = 'termine' and f.motif like 'relecture.abstention.%'
                   group by f.motif) a), '{}'::jsonb) as abstentions,
       (select count(*) from faits f where f.tenant_id = k.tenant_id and f.jour is not distinct from k.jour
           and f.nature in ('panne_fournisseur', 'erreur_technique', 'refus_metier'))::integer as pannes,
       coalesce((select e.n from epuisees e
                  where e.tenant_id = k.tenant_id and e.jour is not distinct from k.jour), 0) as epuisees,
       coalesce((select a.n from attente a
                  where a.tenant_id = k.tenant_id and a.jour is not distinct from k.jour), 0) as en_attente,
       (select a.nuits from attente a
         where a.tenant_id = k.tenant_id and a.jour is not distinct from k.jour) as plus_ancienne_nuits,
       coalesce((select a.nuits from attente a
                  where a.tenant_id = k.tenant_id and a.jour is not distinct from k.jour), 0)
         > (select r.alerte_retard_nuits from reglage r) as en_retard,
       coalesce((select c.usd from couts c
                  where c.tenant_id = k.tenant_id and c.jour is not distinct from k.jour), 0) as cout_usd,
       coalesce((select s.n from sans_cout s
                  where s.tenant_id = k.tenant_id and s.jour is not distinct from k.jour), 0) as sans_cout
  from cles k
  join dossiers d on d.tenant_id = k.tenant_id
 where (select app.is_platform());

revoke all on plateforme.relectures_de_nuit_v from public, anon;
grant select on plateforme.relectures_de_nuit_v to authenticated;

comment on view plateforme.relectures_de_nuit_v is
  'La passe de nuit, par dossier et par jour local du dossier : retenues, écartées, abstentions '
  'par motif, pannes, épuisées, en attente (et la plus ancienne en nuits, en retard au-delà du '
  'seuil réglé), coût du relecteur, relectures sans ligne de coût. Opérateurs seulement.';

/*
 * Les passages et leur raison d'arrêt. Sans fait de fin : « en_cours » si
 * c'est le dernier passage et que le verrou de la passe est tenu en ce
 * moment, « interrompu » sinon (processus tué, déploiement).
 */
create view plateforme.passages_de_nuit_v with (security_invoker = true) as
select p.id, p.ouvert_le,
       case
         when f.nature is not null then f.nature
         when p.id = (select x.id from fabrique.passages_de_nuit x
                       order by x.ouvert_le desc, x.id desc limit 1)
          and exists (select 1 from pg_catalog.pg_locks l
                       where l.locktype = 'advisory' and l.objsubid = 1
                         and l.classid::bigint = (fabrique.passe_de_nuit_verrou() >> 32) & 4294967295
                         and l.objid::bigint = fabrique.passe_de_nuit_verrou() & 4294967295)
           then 'en_cours'
         else 'interrompu'
       end as raison,
       f.inscrit_le as ferme_le,
       coalesce(f.detail, '{}'::jsonb) as compteurs
  from fabrique.passages_de_nuit p
  left join fabrique.passage_faits f on f.passage_id = p.id and f.nature <> 'ouvert'
 where (select app.is_platform());

revoke all on plateforme.passages_de_nuit_v from public, anon;
grant select on plateforme.passages_de_nuit_v to authenticated;
