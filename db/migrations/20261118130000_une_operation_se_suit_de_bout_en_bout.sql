-- Une opération se suit de bout en bout : traces et étapes, hors de la transaction métier.
--
-- ================================================================== POURQUOI
--
-- Novembre 2026, la facture MyTek : l'écran Android affichait un TTC faux, et
-- personne ne pouvait dire à quelle étape — lecture, extraction, sudoku,
-- rattrapage, persistance ou affichage — la valeur avait changé. Les journaux
-- existants répondent chacun à une autre question :
--
--   audit.event_log         les faits MÉTIER (une pièce transmise, une écriture
--                           comptabilisée), écrits DANS la transaction métier :
--                           un refus ou un rollback les efface avec elle ;
--   audit.journal_client    les pannes que le téléphone remonte, sans lien
--                           avec la requête qui les a causées ;
--   audit.journal_plateforme les gestes de la tour.
--
-- Aucun ne relie une capture à son affichage, et aucun ne survit à l'échec
-- qu'on cherche justement à comprendre.
--
-- ================================================================== CE QUI EST POSÉ
--
-- 1. `observabilite.traces` : une ligne par opération d'origine (son
--    identifiant vient du client dès la capture, ou de l'entrée HTTP).
-- 2. `observabilite.evenements` : ses étapes horodatées, au vocabulaire fermé
--    (`observabilite.etapes`), dédoublonnées par (trace, étape, clé) : un
--    renvoi après reconnexion compte une répétition, il n'ajoute pas de ligne.
--    Une étape qui porte un changement audité RÉFÉRENCE `audit.event_log` par
--    ses identifiants ; elle n'en recopie rien.
-- 3. Une seule porte d'écriture, `observabilite.consigner`, appelée par l'API
--    sur une connexion à part, hors de toute transaction métier.
-- 4. La consultation en SQL : `observabilite.chronologie_v` et
--    `observabilite.diagnostic_piece(piece)`, au rôle d'exploitation.
-- 5. La rétention, en base (`observabilite.reglages`), et sa purge.
--
-- ================================================================== LES DROITS
--
-- Ni `anon`, ni `authenticated`, ni `malica_api` ne lisent ces tables. Le
-- propriétaire est un rôle dédié sans connexion, `greffier`, et NON le
-- `portier` : le portier est membre d'`authenticated` et existe pour que ses
-- portes s'exécutent sous les politiques de leur appelant ; ici aucune
-- politique client n'existe, et lui donner ces tables élargirait l'inventaire
-- de ses droits à un schéma que nul client ne lit. Le greffier ne possède que
-- ce schéma. La lecture est à `malica_exploitation` (sans connexion : un DBA
-- l'endosse par `grant malica_exploitation to <son rôle>`, hors du dépôt) et
-- au superutilisateur.
--
-- REJEU (R11) : rôles créés s'ils manquent, `if not exists`, dates littérales.

begin;

-- --- 1. Les rôles --------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'greffier') then
    create role greffier nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'malica_exploitation') then
    create role malica_exploitation nologin noinherit;
  end if;
end
$$;

-- Le greffier juge qu'un acteur parle pour son dossier avec les règles de
-- tout le produit — les mêmes fonctions que les politiques, pas une copie.
grant usage on schema app, auth to greffier;
grant execute on function app.member_orgs(), app.engaged_orgs(), app.is_platform() to greffier;

create schema if not exists observabilite;
revoke all on schema observabilite from public;
grant usage on schema observabilite to greffier, malica_exploitation, malica_api;

-- --- 2. Le vocabulaire et le réglage ------------------------------------------------------------

create type observabilite.origine_t as enum ('android', 'pwa', 'web', 'api', 'tache');
create type observabilite.issue_t as enum ('ok', 'refus', 'erreur', 'ignore');

/*
 * Les étapes : un code fermé, et les seules clés que son détail peut porter.
 * Un lot qui ajoute une étape (ou une clé) le fait ici, par migration : le
 * détail d'un événement ne transporte jamais ce que personne n'a autorisé.
 */
create table observabilite.etapes (
  code             text primary key check (code ~ '^[a-z][a-z_]{1,39}$'),
  cles_autorisees  text[] not null default '{}',
  description      text not null check (length(btrim(description)) > 0),
  constraint etapes_cles_bien_formees check (
    cardinality(cles_autorisees) <= 32
    and array_to_string(cles_autorisees, ',') ~ '^([a-z][a-z0-9_]{0,39}(,[a-z][a-z0-9_]{0,39})*)?$')
);

insert into observabilite.etapes (code, cles_autorisees, description) values
  ('capture',          '{}', 'La pièce est prise sur l''appareil.'),
  ('file_hors_ligne',  '{}', 'La pièce attend le réseau dans la file de l''appareil.'),
  ('synchronisation',  '{}', 'La file de l''appareil se vide vers l''API.'),
  ('upload',           '{}', 'Les octets de la pièce arrivent au stockage.'),
  ('http',             '{methode,route,statut}', 'Une requête HTTP, de son entrée à sa réponse.'),
  ('rpc',              '{depot,methode,statut,code_refus}',
                       'Un appel de dépôt sur /rpc ; ses changements audités sont référencés.'),
  ('ocr',              '{}', 'La lecture optique de la pièce.'),
  ('extraction',       '{}', 'Les champs désignés dans le plan de tokens.'),
  ('sudoku',           '{}', 'Le verdict du moteur de cohérence.'),
  ('rattrapage',       '{}', 'Le second lecteur, quand la première lecture est partielle.'),
  ('persistance',      '{}', 'Les valeurs inscrites en base.'),
  ('affiche',          '{}', 'Ce que l''écran a réellement montré.'),
  ('transfert',        '{}', 'La pièce passe de la PME au cabinet.'),
  ('validation',       '{}', 'Une validation de pièce ou d''écriture.'),
  ('rejet',            '{}', 'Un rejet motivé.'),
  ('comptabilisation', '{}', 'Une écriture inscrite au journal.'),
  ('paiement',         '{}', 'Un paiement inscrit, rattaché ou annulé.'),
  ('droits',           '{}', 'Un droit donné, retiré ou refusé.'),
  ('reglage',          '{}', 'Un réglage du cabinet ou de la plateforme.'),
  ('export',           '{}', 'Un export produit ou servi.'),
  ('tache',            '{nom,tentative}', 'Un travail différé, rattaché à l''opération d''origine.'),
  ('perte',            '{nombre,raison}',
                       'Des événements réellement perdus (disque plein, ligne illisible, rejet).');

alter table observabilite.etapes owner to greffier;

/* La rétention : la dernière décision vaut. Une ligne nouvelle la change. */
create table observabilite.reglages (
  id               uuid primary key default gen_random_uuid(),
  retention_jours  integer not null check (retention_jours between 1 and 3660),
  motif            text not null check (length(btrim(motif)) > 0),
  decide_par       text not null default current_user,
  decide_le        timestamptz not null default now()
);

insert into observabilite.reglages (retention_jours, motif, decide_par, decide_le) values
  (90, 'Valeur de départ INCERTAINE, à arrêter par le dirigeant : 90 jours couvrent un trimestre '
       'de recette et de support. Les traces nomment un acteur (son identifiant) et une pièce, '
       'jamais leur contenu.',
   'migration', timestamptz '2026-11-18 00:00:00+00');

alter table observabilite.reglages owner to greffier;

-- --- 3. Les traces et leurs étapes --------------------------------------------------------------

/*
 * `parente_id` et `piece_id` n'ont pas de clé étrangère, et c'est voulu
 * (verrous/integrite-de-la-base.json) : la trace d'une pièce refusée,
 * annulée par rollback ou supprimée ensuite doit rester ; une trace parente
 * peut arriver APRÈS l'enfant (rejeu du fichier d'attente) ou être purgée
 * avant lui.
 */
create table observabilite.traces (
  id           uuid primary key,
  parente_id   uuid,
  origine      observabilite.origine_t not null,
  tenant_id    uuid references identity.organizations (id) on delete cascade,
  acteur       uuid,
  piece_id     uuid,
  version      text check (version is null or length(version) <= 120),
  debut        timestamptz not null,
  inscrite_le  timestamptz not null default clock_timestamp(),
  constraint traces_pas_sa_propre_parente check (parente_id is distinct from id)
);

create index traces_tenant_idx on observabilite.traces (tenant_id, debut desc);
create index traces_piece_idx on observabilite.traces (piece_id, debut) where piece_id is not null;
create index traces_parente_idx on observabilite.traces (parente_id) where parente_id is not null;
create index traces_debut_idx on observabilite.traces (debut);

create table observabilite.evenements (
  id                    bigint generated always as identity primary key,
  trace_id              uuid not null references observabilite.traces (id) on delete cascade,
  etape                 text not null references observabilite.etapes (code),
  issue                 observabilite.issue_t not null,
  cle                   text not null check (length(cle) between 1 and 120),
  debut                 timestamptz not null,
  duree_ms              integer check (duree_ms is null or duree_ms >= 0),
  acteur                uuid,
  piece_id              uuid,
  -- Les lignes d'`audit.event_log` que l'étape a écrites : référencées, pas recopiées.
  audit_ids             uuid[] not null default '{}' check (cardinality(audit_ids) <= 16),
  detail                jsonb not null default '{}'::jsonb
                          check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 2048),
  repetitions           integer not null default 0 check (repetitions >= 0),
  derniere_repetition   timestamptz,
  inscrit_le            timestamptz not null default clock_timestamp(),
  constraint evenements_une_fois unique (trace_id, etape, cle)
);

create index evenements_piece_idx on observabilite.evenements (piece_id, debut)
  where piece_id is not null;

alter table observabilite.traces owner to greffier;
alter table observabilite.evenements owner to greffier;

/*
 * RLS forcée, comme toute table qui porte un `tenant_id` : le greffier écrit,
 * l'exploitation lit, et personne d'autre n'a même le droit de l'essayer.
 */
do $$
declare
  t text;
begin
  foreach t in array array['etapes', 'reglages', 'traces', 'evenements'] loop
    execute format('alter table observabilite.%I enable row level security', t);
    execute format('alter table observabilite.%I force row level security', t);
    execute format('revoke all on table observabilite.%I from public, anon, authenticated, malica_api', t);
    execute format('create policy %I on observabilite.%I for all to greffier using (true) with check (true)',
                   t || '_greffier', t);
    execute format('create policy %I on observabilite.%I for select to malica_exploitation using (true)',
                   t || '_exploitation', t);
    execute format('grant select on table observabilite.%I to malica_exploitation', t);
  end loop;
end
$$;

-- --- 4. Ce qu'une étape a audité : la transaction le note ------------------------------------------

/*
 * Chaque ligne d'`audit.event_log` inscrit son identifiant dans un réglage
 * LOCAL à la transaction (`malica.audit_ids`, seize au plus). L'API le relit
 * avant de rendre l'appel : l'étape `rpc` référence ainsi ce que l'audit porte,
 * sans requête sur la table, et un rollback efface la note avec les lignes.
 */
create function app.audit_se_note_dans_la_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_notes text := coalesce(current_setting('malica.audit_ids', true), '');
begin
  if v_notes = '' then
    perform set_config('malica.audit_ids', new.id::text, true);
  elsif length(v_notes) < 16 * 37 - 1 then
    perform set_config('malica.audit_ids', v_notes || ',' || new.id::text, true);
  end if;
  return new;
end
$$;

revoke all on function app.audit_se_note_dans_la_transaction() from public, anon, authenticated;

create trigger event_log_se_note_dans_la_transaction
  after insert on audit.event_log
  for each row execute function app.audit_se_note_dans_la_transaction();

-- --- 5. La porte d'écriture ----------------------------------------------------------------------

/* Une valeur venue du réseau : un uuid bien formé, ou rien. Jamais d'exception. */
create function observabilite.uuid_ou_nul(p text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then p::uuid end
$$;

/* Un instant ISO 8601 bien formé, ou rien. */
create function observabilite.instant_ou_nul(p text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    return null;
  end if;
  return p::timestamptz;
exception when others then
  return null;
end
$$;

/*
 * Le détail BORNÉ d'une étape : les seules clés que son code autorise, des
 * valeurs scalaires, une chaîne coupée à 200 caractères. Un objet ou une liste
 * (une photo en base64, un texte OCR découpé) ne passe pas : il est écarté.
 */
create function observabilite.detail_borne(p_etape text, p_detail jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(
           d.key,
           case when jsonb_typeof(d.value) = 'string' then to_jsonb(left(d.value #>> '{}', 200))
                else d.value end), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(p_detail) = 'object' then p_detail else '{}'::jsonb end) d
    join observabilite.etapes e on e.code = p_etape
   where d.key = any (e.cles_autorisees)
     and jsonb_typeof(d.value) in ('string', 'number', 'boolean', 'null')
$$;

/*
 * Inscrit un lot d'événements, chacun avec le descripteur de sa trace :
 *
 *   [{ "trace": { "id", "parente", "origine", "tenant", "acteur", "piece",
 *                 "version", "debut" },
 *      "etape", "issue", "cle", "debut", "dureeMs", "acteur", "piece",
 *      "audits": [uuid…], "detail": {…} }, …]
 *
 * Ce que la porte garantit :
 *   - un élément mal formé (uuid, instant, étape, issue) est écarté et compté,
 *     jamais une exception : un lot rejoué depuis le disque ne s'empoisonne pas ;
 *   - le dossier d'une trace n'est retenu que s'il appartient à son acteur
 *     (membre, cabinet engagé, opérateur de la plateforme) — sinon il est
 *     écarté et compté. Sans acteur (une tâche du serveur), il est cru ;
 *   - appelée sous l'identité d'un utilisateur (`auth.uid()` posé), elle refuse
 *     un acteur qui n'est pas lui et un dossier qui n'est pas le sien ;
 *   - (trace, étape, clé) ne s'inscrit qu'une fois : la première vaut, les
 *     suivantes s'ajoutent à `repetitions` ;
 *   - une trace déjà connue se complète (dossier, pièce, acteur restés vides),
 *     elle ne se réécrit pas.
 */
create function observabilite.consigner(p_evenements jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appelant uuid := auth.uid();
  v_admis text[] := '{}';
  v_ecartes integer := 0;
  v_rejetes integer;
  v_nouveaux integer;
  v_repetes integer;
  r record;
begin
  if p_evenements is null or jsonb_typeof(p_evenements) <> 'array'
     or jsonb_array_length(p_evenements) > 1000 then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;

  if v_appelant is not null and exists (
       select 1 from jsonb_array_elements(p_evenements) e
        where observabilite.uuid_ou_nul(e #>> '{trace,acteur}') is distinct from v_appelant
           or observabilite.uuid_ou_nul(coalesce(e ->> 'acteur', e #>> '{trace,acteur}'))
                is distinct from v_appelant) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  -- Chaque couple (acteur, dossier) est jugé une fois, par les règles du produit.
  for r in
    select distinct observabilite.uuid_ou_nul(e #>> '{trace,acteur}') as acteur,
                    observabilite.uuid_ou_nul(e #>> '{trace,tenant}') as tenant
      from jsonb_array_elements(p_evenements) e
     where observabilite.uuid_ou_nul(e #>> '{trace,acteur}') is not null
       and observabilite.uuid_ou_nul(e #>> '{trace,tenant}') is not null
  loop
    if v_appelant is null then
      perform set_config('request.jwt.claim.sub', r.acteur::text, true);
    end if;
    if r.tenant in (select app.member_orgs()) or r.tenant in (select app.engaged_orgs())
       or app.is_platform() then
      v_admis := v_admis || (r.acteur::text || '|' || r.tenant::text);
    elsif v_appelant is not null then
      raise exception 'refus.geste.non_permis' using errcode = '42501';
    else
      v_ecartes := v_ecartes + 1;
    end if;
  end loop;
  if v_appelant is null then
    perform set_config('request.jwt.claim.sub', '', true);
  end if;

  /*
   * Une seule instruction : les traces d'abord, les étapes ensuite. Les clés
   * étrangères se vérifient à la fin de l'instruction, quand les deux sont là.
   */
  with brut as (
    select e, ord,
           observabilite.uuid_ou_nul(e #>> '{trace,id}') as trace_id,
           observabilite.uuid_ou_nul(e #>> '{trace,parente}') as parente_id,
           e #>> '{trace,origine}' as origine,
           observabilite.uuid_ou_nul(e #>> '{trace,tenant}') as tenant_id,
           observabilite.uuid_ou_nul(e #>> '{trace,acteur}') as trace_acteur,
           observabilite.uuid_ou_nul(e #>> '{trace,piece}') as trace_piece,
           left(e #>> '{trace,version}', 120) as version,
           observabilite.instant_ou_nul(e #>> '{trace,debut}') as trace_debut,
           e ->> 'etape' as etape,
           e ->> 'issue' as issue,
           left(e ->> 'cle', 120) as cle,
           observabilite.instant_ou_nul(e ->> 'debut') as debut,
           case when e ->> 'dureeMs' ~ '^\d{1,9}$' then (e ->> 'dureeMs')::integer end as duree_ms,
           observabilite.uuid_ou_nul(e ->> 'acteur') as acteur,
           observabilite.uuid_ou_nul(e ->> 'piece') as piece_id,
           array(select observabilite.uuid_ou_nul(a)
                   from jsonb_array_elements_text(
                          case when jsonb_typeof(e -> 'audits') = 'array' then e -> 'audits'
                               else '[]'::jsonb end) with ordinality as l(a, n)
                  where observabilite.uuid_ou_nul(a) is not null and n <= 16) as audit_ids
      from jsonb_array_elements(p_evenements) with ordinality as l(e, ord)
     where jsonb_typeof(e) = 'object'
  ), lot as (
    select b.ord, b.trace_id, nullif(b.parente_id, b.trace_id) as parente_id,
           b.origine::observabilite.origine_t as origine,
           case when b.trace_acteur is null
                  or (b.trace_acteur::text || '|' || b.tenant_id::text) = any (v_admis)
                then b.tenant_id end as tenant_id,
           b.trace_acteur, b.trace_piece, b.version, coalesce(b.trace_debut, b.debut) as trace_debut,
           b.etape, b.issue::observabilite.issue_t as issue, b.cle, b.debut, b.duree_ms,
           coalesce(b.acteur, b.trace_acteur) as acteur, b.piece_id, b.audit_ids,
           observabilite.detail_borne(b.etape, b.e -> 'detail') as detail
      from brut b
     where b.trace_id is not null
       and b.origine = any (enum_range(null::observabilite.origine_t)::text[])
       and b.issue = any (enum_range(null::observabilite.issue_t)::text[])
       and exists (select 1 from observabilite.etapes s where s.code = b.etape)
       and b.cle is not null and length(b.cle) > 0
       and b.debut is not null
  ), traces_inscrites as (
    insert into observabilite.traces as t
      (id, parente_id, origine, tenant_id, acteur, piece_id, version, debut)
    select l.trace_id,
           (array_agg(l.parente_id order by l.ord) filter (where l.parente_id is not null))[1],
           (array_agg(l.origine order by l.ord))[1],
           (array_agg(l.tenant_id order by l.ord) filter (where l.tenant_id is not null))[1],
           (array_agg(l.trace_acteur order by l.ord) filter (where l.trace_acteur is not null))[1],
           (array_agg(l.trace_piece order by l.ord) filter (where l.trace_piece is not null))[1],
           (array_agg(l.version order by l.ord) filter (where l.version is not null))[1],
           min(l.trace_debut)
      from lot l
     group by l.trace_id
    on conflict (id) do update
       set parente_id = coalesce(t.parente_id, excluded.parente_id),
           tenant_id  = coalesce(t.tenant_id, excluded.tenant_id),
           acteur     = coalesce(t.acteur, excluded.acteur),
           piece_id   = coalesce(t.piece_id, excluded.piece_id),
           version    = coalesce(t.version, excluded.version),
           debut      = least(t.debut, excluded.debut)
    returning t.id
  ), uniques as (
    select distinct on (l.trace_id, l.etape, l.cle)
           l.*, count(*) over (partition by l.trace_id, l.etape, l.cle) - 1 as doubles
      from lot l
     order by l.trace_id, l.etape, l.cle, l.ord
  ), inscrits as (
    insert into observabilite.evenements as v
      (trace_id, etape, issue, cle, debut, duree_ms, acteur, piece_id, audit_ids, detail,
       repetitions, derniere_repetition)
    select u.trace_id, u.etape, u.issue, u.cle, u.debut, u.duree_ms, u.acteur, u.piece_id,
           u.audit_ids, u.detail, u.doubles,
           case when u.doubles > 0 then clock_timestamp() end
      from uniques u
     -- La trace est inscrite par la même instruction : on attend qu'elle le soit.
     where u.trace_id in (select ti.id from traces_inscrites ti)
    on conflict (trace_id, etape, cle) do update
       set repetitions = v.repetitions + excluded.repetitions + 1,
           derniere_repetition = clock_timestamp()
    returning (xmax = 0) as nouveau
  )
  select jsonb_array_length(p_evenements) - (select count(*) from lot),
         (select count(*) from inscrits i where i.nouveau),
         (select count(*) from lot) - (select count(*) from inscrits i where i.nouveau)
    into v_rejetes, v_nouveaux, v_repetes;

  return jsonb_build_object('inscrits', v_nouveaux, 'repetes', v_repetes,
                            'rejetes', v_rejetes, 'dossiers_ecartes', v_ecartes);
end
$$;

/* La règle de rétention en vigueur. */
create function observabilite.reglage_en_vigueur()
returns observabilite.reglages
language sql
stable
set search_path = ''
as $$
  select r.* from observabilite.reglages r order by r.decide_le desc, r.id desc limit 1
$$;

/*
 * La purge : les traces dont aucune étape n'est plus récente que la rétention,
 * et leurs étapes avec elles. Par paquets bornés, pour ne pas tenir un verrou
 * long ; rend le nombre de traces purgées (l'API rappelle tant qu'il en reste).
 */
create function observabilite.purger()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite timestamptz :=
    now() - make_interval(days => (observabilite.reglage_en_vigueur()).retention_jours);
  v_n integer;
begin
  delete from observabilite.traces t
   where t.id in (select x.id from observabilite.traces x
                   where x.debut < v_limite
                     and not exists (select 1 from observabilite.evenements e
                                      where e.trace_id = x.id and e.debut >= v_limite)
                   limit 5000);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- --- 6. La consultation --------------------------------------------------------------------------

/* Chaque étape, avec sa trace : la ligne qu'on lit en diagnostic. */
create view observabilite.chronologie_v with (security_invoker = true) as
select e.debut, t.id as trace_id, t.parente_id, t.origine, t.tenant_id, t.acteur as trace_acteur,
       coalesce(e.piece_id, t.piece_id) as piece_id, t.version, e.etape, e.issue, e.duree_ms,
       e.acteur, e.detail, e.audit_ids, e.repetitions, e.cle, e.id as evenement_id
  from observabilite.evenements e
  join observabilite.traces t on t.id = e.trace_id;

/*
 * La chronologie complète d'une pièce, en une requête : les traces qui la
 * nomment (par la trace ou par une étape), leurs ancêtres et leurs
 * descendants (un travail différé, une reprise), toutes leurs étapes dans
 * l'ordre du temps.
 */
create function observabilite.diagnostic_piece(p_piece uuid)
returns setof observabilite.chronologie_v
language sql
stable
set search_path = ''
as $$
  with recursive nommees as (
    select t.id from observabilite.traces t where t.piece_id = p_piece
    union
    select e.trace_id from observabilite.evenements e where e.piece_id = p_piece
  ), ancetres as (
    select n.id from nommees n
    union
    select t.parente_id from observabilite.traces t join ancetres a on a.id = t.id
     where t.parente_id is not null
  ), famille as (
    select a.id from ancetres a
    union
    select t.id from observabilite.traces t join famille f on t.parente_id = f.id
  )
  select c.* from observabilite.chronologie_v c
   where c.trace_id in (select f.id from famille f)
   order by c.debut, c.evenement_id
$$;

alter view observabilite.chronologie_v owner to greffier;
revoke all on observabilite.chronologie_v from public, anon, authenticated, malica_api;
grant select on observabilite.chronologie_v to malica_exploitation;

do $$
declare
  f text;
begin
  foreach f in array array[
    'observabilite.uuid_ou_nul(text)',
    'observabilite.instant_ou_nul(text)',
    'observabilite.detail_borne(text, jsonb)',
    'observabilite.consigner(jsonb)',
    'observabilite.reglage_en_vigueur()',
    'observabilite.purger()',
    'observabilite.diagnostic_piece(uuid)'] loop
    execute format('alter function %s owner to greffier', f);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$$;

grant execute on function observabilite.consigner(jsonb), observabilite.purger() to malica_api;
grant execute on function observabilite.purger(), observabilite.diagnostic_piece(uuid),
  observabilite.reglage_en_vigueur() to malica_exploitation;

comment on schema observabilite is
  'Traces et étapes des opérations, écrites hors de la transaction métier par '
  'observabilite.consigner. Lues en SQL par malica_exploitation ; voir docs/journalisation.md.';

commit;
