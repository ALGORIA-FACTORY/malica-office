-- ======================================================================
--  La fabrique de lecteurs — le socle de données.
--
--  Chaque format de facture suffisamment éprouvé doit devenir un lecteur
--  spécialisé réutilisable, pour que Malica cesse d'appeler un modèle distant
--  sur les documents récurrents. Ce fichier pose la base ; rien de ce qui
--  suivra ne peut la contourner.
--
--  ====================================================== TROIS OBJETS, TROIS VIES
--
--  Le dépôt porte déjà deux des trois, et ils ne se mélangent pas ici :
--
--    les DONNÉES DU DOCUMENT      `capture.*`      — la pièce, son plan de
--                                                    tokens, ses citations ;
--    les IMPUTATIONS COMPTABLES   `ref.*`,
--                                 `parametrage.*`  — ce qu'un compte reçoit ;
--    les RECETTES DE LECTURE      `fabrique.*`     — la FORME du papier.
--
--  Trois durées de vie, trois droits. Une recette survit au document qui l'a
--  fait naître ; une imputation change sans que la forme du papier bouge. Les
--  loger ensemble « parce que c'est pratique » ferait qu'un changement de plan
--  comptable invaliderait un lecteur, et c'est faux.
--
--  ========================================== LA FRONTIÈRE QUI PORTE LE MODÈLE
--
--  Une correction humaine se qualifie : reconnaissance OCR, désignation du
--  champ, normalisation, document incomplet, ou décision comptable. **Seules
--  les trois premières peuvent nourrir une recette.**
--
--  Un expert qui impute un droit de timbre à un autre compte n'enseigne RIEN
--  sur la forme du papier : il a changé d'avis sur la comptabilité, pas sur
--  l'endroit où le montant est imprimé. Laisser cette correction entrer dans
--  l'apprentissage ferait dériver un lecteur sur une décision qui ne le
--  regarde pas.
--
--  Cette frontière n'est PAS une convention, PAS un `if` applicatif, PAS une
--  ligne de référentiel qu'on pourrait retourner : c'est une colonne calculée
--  (`fabrique.exemples.nourrit_une_recette`), une clé étrangère composée qui la
--  reprend, et un `check` qui l'exige. Trois verrous, et aucun chemin de
--  contournement depuis l'application.
--
--  ============================================= APPRENTISSAGE ET ÉVALUATION
--
--  Séparés PAR CONSTRUCTION. `fabrique.exemples.usage` n'a pas de défaut, ne se
--  met jamais à jour (R7), et les deux tables de rattachement portent chacune
--  un `check` sur sa valeur, repris par la clé étrangère. Un exemple
--  d'apprentissage ne peut donc pas entrer dans un jeu d'évaluation — pas même
--  par une main maladroite sur une RPC à venir.
--
--  ======================================= LA MUTUALISATION, PRÉPARÉE, ÉTEINTE
--
--  `fabrique.recettes.portee` nomme le périmètre : `organisation` ou
--  `mutualisee`. La colonne N'A PAS DE DÉFAUT — un partage qu'on n'a pas décidé
--  ne doit pas pouvoir naître d'une insertion qui a oublié la colonne. Et
--  AUCUNE politique ne lit cette valeur : marquer une recette `mutualisee`
--  aujourd'hui ne la montre à personne. Le jour où l'on partagera, ce sera par
--  une politique écrite, dans une migration qui le dira.
--
--  ====================================================== CE QUI N'EST PAS ICI
--
--  Aucun seuil de promotion en dur (R4) : ils vivent dans `ref.socle_params`,
--  datés, et se surchargent par cabinet dans `parametrage.fabrique_seuils`
--  (R10). Aucun nom de format, aucune règle de lecture : une recette est une
--  DONNÉE, un JSON validé, jamais du code.
-- ======================================================================

-- Le lanceur (db/migrer.mjs) ouvre deja la transaction : on n'en ouvre pas une seconde.

create schema if not exists fabrique;
comment on schema fabrique is
  'La fabrique de lecteurs : recettes de lecture, exemples qualifiés, '
  'évaluations, exécutions, décisions de promotion et dérives. '
  'Ni données du document (capture), ni imputations comptables (ref, parametrage).';

-- La leçon du 19 octobre, en une ligne : un schéma sans `usage` rend
-- « droit refusé » à tous les `grant select` qu'on pose dessous, et aucune
-- épreuve de lecture n'avait jamais tourné.
grant usage on schema fabrique to authenticated;
grant usage on schema parametrage to authenticated;

-- ---------------------------------------------------------------- 1. Le vocabulaire
--
-- Des énumérations, pas des tables de référence. La différence est volontaire :
-- une table de référence se surcharge (R10), et ces valeurs-là ne doivent PAS
-- se surcharger. Qu'une décision comptable ne nourrisse pas une recette n'est
-- pas un défaut livré que l'expert arrête ensuite : c'est une loi du modèle.

do $$ begin
  create type fabrique.portee_t as enum ('organisation', 'mutualisee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fabrique.provenance_t as enum (
    'validation_humaine',   -- la pièce a été validée : elle FOURNIT un exemple
    'correction_humaine',   -- quelqu'un a corrigé une lecture
    'import_expert',        -- l'expert dépose un cas de référence
    'observation');         -- la recette a tourné en observation, on a comparé
exception when duplicate_object then null; end $$;

comment on type fabrique.provenance_t is
  'D''où vient l''exemple. « validation_humaine » FOURNIT un exemple ; elle '
  'n''autorise AUCUNE promotion — ce sont deux faits distincts, et seule une '
  'évaluation (fabrique.evaluations) fait avancer un cycle.';

do $$ begin
  create type fabrique.qualification_t as enum (
    'reconnaissance_ocr',   -- le caractère lu n'était pas le bon
    'designation_champ',    -- le bon texte, au mauvais champ
    'normalisation',        -- la forme du nombre ou de la date
    'document_incomplet',   -- le papier ne portait pas l'information
    'decision_comptable');  -- un arbitrage d'imputation : PAS une règle de lecture
exception when duplicate_object then null; end $$;

do $$ begin
  create type fabrique.usage_t as enum ('apprentissage', 'evaluation');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fabrique.etat_t as enum (
    'candidate', 'evaluee', 'observation', 'active', 'suspendue', 'retiree');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fabrique.issue_t as enum ('designation', 'abstention', 'echec');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fabrique.derive_t as enum (
    'abstention_en_hausse', 'desaccord_avec_le_modele',
    'correction_humaine', 'signature_changee');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------- 2. Les recettes et leurs versions

create table if not exists fabrique.recettes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  libelle       text not null check (length(btrim(libelle)) > 0),
  signature_cle text not null check (length(btrim(signature_cle)) > 0),
  -- Pas de défaut : voir l'en-tête. Un partage ne naît pas d'un oubli.
  portee        fabrique.portee_t not null,
  cree_par      uuid not null default auth.uid(),
  cree_le       timestamptz not null default now(),
  unique (tenant_id, signature_cle)
);
create index if not exists fabrique_recettes_tenant_idx
  on fabrique.recettes (tenant_id, cree_le desc);

comment on table fabrique.recettes is
  'Un lecteur spécialisé, rattaché à une signature structurelle de document. '
  'Privé à l''organisation : « portee » prépare une mutualisation future sans '
  'l''activer — aucune politique ne lit cette colonne.';

create table if not exists fabrique.recette_versions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  recette_id uuid not null references fabrique.recettes(id) on delete cascade,
  rang       smallint not null check (rang > 0),
  -- Une recette est une DONNÉE déclarative, jamais du code. Le validateur
  -- strict vit dans l'application ; la base tient la forme minimale, parce
  -- qu'un `jsonb` sans contrainte accepte « 3 » comme recette.
  definition jsonb not null
             check (jsonb_typeof(definition) = 'object'
                    and definition ? 'version' and definition ? 'champs'),
  -- LA DERNIÈRE PORTE (R2, règle ① du plan). Le contrat de recette rend la
  -- production d'une valeur impossible PAR LE TYPE : une désignation est
  -- `{ designe } | { abstention } | { absent }`, et aucun de ces trois ne
  -- porte de champ où écrire un montant. Restait le stockage : un `jsonb`
  -- accepte n'importe quelle clé, y compris celle que le type interdit.
  --
  -- Ce n'est pas une duplication du validateur. C'est la seule barrière qui
  -- tienne si l'on écrit en base sans passer par lui — une reprise, une
  -- migration de données, une RPC d'un autre jour. Une facture arabe est
  -- sortie à 650 000 D là où le papier portait 5 650 000 D parce qu'une
  -- valeur avait été recopiée au lieu d'être relue ; une recette qui PORTE
  -- un montant est exactement ce chemin, rendu permanent.
  check (not jsonb_path_exists(definition, '$.**.valeur')
         and not jsonb_path_exists(definition, '$.**.value')
         and not jsonb_path_exists(definition, '$.**.montant')
         and not jsonb_path_exists(definition, '$.**.amount')),
  empreinte  char(64) not null,
  cree_par   uuid not null default auth.uid(),
  cree_le    timestamptz not null default now(),
  unique (recette_id, rang),
  unique (tenant_id, id)
);
create index if not exists fabrique_recette_versions_tenant_idx
  on fabrique.recette_versions (tenant_id, cree_le desc);

comment on table fabrique.recette_versions is
  'La recette elle-même : un JSON déclaratif, versionné par rang. '
  'Ajout seul — corriger une recette, c''est en inscrire une version nouvelle.';

-- ------------------------------------------------------- 3. Les exemples qualifiés

create table if not exists fabrique.exemples (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references identity.organizations(id) on delete cascade,
  piece_id       uuid not null references capture.pieces(id) on delete cascade,
  signature_cle  text not null,
  provenance     fabrique.provenance_t not null,
  qualification  fabrique.qualification_t not null,
  -- Pas de défaut : un exemple entre dans l'apprentissage ou dans
  -- l'évaluation, et celui qui l'inscrit le dit.
  usage          fabrique.usage_t not null,
  -- Des DÉSIGNATIONS (page / ordinal), jamais des valeurs : R2. Le montant se
  -- relit dans le plan de tokens, il ne se recopie nulle part.
  attendu        jsonb not null check (jsonb_typeof(attendu) = 'object'),
  note           text,
  qualifie_par   uuid not null default auth.uid(),
  qualifie_le    timestamptz not null default now(),
  -- LA frontière. Calculée, donc jamais fausse ; reprise par clé étrangère
  -- dans fabrique.recette_version_exemples, donc jamais contournable.
  nourrit_une_recette boolean
    generated always as (qualification in (
      'reconnaissance_ocr'::fabrique.qualification_t,
      'designation_champ'::fabrique.qualification_t,
      'normalisation'::fabrique.qualification_t)) stored,
  unique (tenant_id, id, usage),
  unique (tenant_id, id, nourrit_une_recette, usage)
);
create index if not exists fabrique_exemples_tenant_idx
  on fabrique.exemples (tenant_id, signature_cle, usage);

comment on column fabrique.exemples.nourrit_une_recette is
  'Calculée : vraie pour reconnaissance_ocr, designation_champ et '
  'normalisation. Une décision comptable n''est pas une règle de lecture — '
  'la clé étrangère de fabrique.recette_version_exemples exige cette colonne '
  'vraie, et aucun chemin applicatif ne peut la poser lui-même.';

-- ------------------------------------------------- 4. Ce qui nourrit une recette

create table if not exists fabrique.recette_version_exemples (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.organizations(id) on delete cascade,
  recette_version_id  uuid not null,
  exemple_id          uuid not null,
  -- Recopiées pour que la clé étrangère puisse les CONTRAINDRE. Le `check`
  -- interdit de mentir : la valeur recopiée doit être celle qu'on exige, et
  -- la clé étrangère exige qu'elle soit celle de l'exemple.
  nourrit_une_recette boolean not null check (nourrit_une_recette),
  usage               fabrique.usage_t not null check (usage = 'apprentissage'),
  ajoute_par          uuid not null default auth.uid(),
  ajoute_le           timestamptz not null default now(),
  unique (recette_version_id, exemple_id),
  foreign key (tenant_id, recette_version_id)
    references fabrique.recette_versions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, exemple_id, nourrit_une_recette, usage)
    references fabrique.exemples (tenant_id, id, nourrit_une_recette, usage)
    on delete cascade
);
create index if not exists fabrique_recette_version_exemples_tenant_idx
  on fabrique.recette_version_exemples (tenant_id, recette_version_id);

comment on table fabrique.recette_version_exemples is
  'Les exemples d''APPRENTISSAGE d''une version. Deux garanties portées par la '
  'base : l''exemple peut nourrir une recette (pas une décision comptable), et '
  'il appartient au jeu d''apprentissage — jamais à celui d''évaluation.';

-- ----------------------------------------------------------- 5. Les évaluations

create table if not exists fabrique.evaluations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.organizations(id) on delete cascade,
  recette_version_id uuid not null,
  -- Les mesures du plan : exactitude des champs critiques, montants faux
  -- acceptés, taux d'abstention… Une mesure ABSENTE reste absente : la
  -- promotion la réclame et refuse, elle ne la suppose pas bonne.
  mesures            jsonb not null check (jsonb_typeof(mesures) = 'object'),
  exemples_comptes   integer not null check (exemples_comptes >= 0),
  menee_par          uuid not null default auth.uid(),
  menee_le           timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, recette_version_id)
    references fabrique.recette_versions (tenant_id, id) on delete cascade
);
create index if not exists fabrique_evaluations_tenant_idx
  on fabrique.evaluations (tenant_id, menee_le desc);

create table if not exists fabrique.evaluation_exemples (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  evaluation_id uuid not null,
  exemple_id    uuid not null,
  usage         fabrique.usage_t not null check (usage = 'evaluation'),
  ajoute_le     timestamptz not null default now(),
  unique (evaluation_id, exemple_id),
  foreign key (tenant_id, evaluation_id)
    references fabrique.evaluations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, exemple_id, usage)
    references fabrique.exemples (tenant_id, id, usage) on delete cascade
);
create index if not exists fabrique_evaluation_exemples_tenant_idx
  on fabrique.evaluation_exemples (tenant_id, evaluation_id);

comment on table fabrique.evaluation_exemples is
  'Le jeu d''ÉVALUATION d''une mesure. Le `check` et la clé étrangère refusent '
  'un exemple d''apprentissage : la séparation est de construction, pas de '
  'discipline.';

-- ------------------------------------------------------------- 6. Les exécutions

create table if not exists fabrique.executions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.organizations(id) on delete cascade,
  recette_version_id uuid not null,
  piece_id           uuid not null references capture.pieces(id) on delete cascade,
  issue              fabrique.issue_t not null,
  -- Une abstention rend la main à la chaîne existante AVEC son motif ; un
  -- échec le doit aussi. Une désignation n'a rien à expliquer.
  motif              text,
  champs_designes    smallint check (champs_designes >= 0),
  duree_ms           integer check (duree_ms >= 0),
  executee_le        timestamptz not null default now(),
  check (issue = 'designation' or motif is not null),
  foreign key (tenant_id, recette_version_id)
    references fabrique.recette_versions (tenant_id, id) on delete cascade
);
create index if not exists fabrique_executions_tenant_idx
  on fabrique.executions (tenant_id, executee_le desc);
create index if not exists fabrique_executions_version_idx
  on fabrique.executions (recette_version_id, executee_le desc);

-- ---------------------------------------------------- 7. Les décisions, et la dérive

create table if not exists fabrique.promotions (
  id                 uuid primary key default gen_random_uuid(),
  -- Monotone, et c'est ce qui rend « le dernier fait » lisible : deux
  -- décisions prises dans la même transaction partagent `now()`, et un
  -- `order by decide_le` les départagerait au hasard.
  ordre              bigint generated always as identity,
  tenant_id          uuid not null references identity.organizations(id) on delete cascade,
  recette_version_id uuid not null,
  etat               fabrique.etat_t not null,
  evaluation_id      uuid,
  motif              text not null check (length(btrim(motif)) > 0),
  decide_par         uuid not null default auth.uid(),
  decide_le          timestamptz not null default now(),
  foreign key (tenant_id, recette_version_id)
    references fabrique.recette_versions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, evaluation_id)
    references fabrique.evaluations (tenant_id, id) on delete restrict
);
create index if not exists fabrique_promotions_tenant_idx
  on fabrique.promotions (tenant_id, decide_le desc);
create index if not exists fabrique_promotions_version_idx
  on fabrique.promotions (recette_version_id, ordre desc);

comment on table fabrique.promotions is
  'Le cycle de vie, en faits datés : candidate, évaluée, observation, active, '
  'suspendue, retirée. Une suspension est une ÉCRITURE NOUVELLE (R7) — rien '
  'ici ne se met à jour. Le motif est obligatoire : « qui a décidé, et '
  'pourquoi » se lit sans enquête.';

create table if not exists fabrique.derives (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identity.organizations(id) on delete cascade,
  recette_version_id uuid not null,
  piece_id           uuid references capture.pieces(id) on delete set null,
  nature             fabrique.derive_t not null,
  mesure             jsonb not null check (jsonb_typeof(mesure) = 'object'),
  constatee_le       timestamptz not null default now(),
  foreign key (tenant_id, recette_version_id)
    references fabrique.recette_versions (tenant_id, id) on delete cascade
);
create index if not exists fabrique_derives_tenant_idx
  on fabrique.derives (tenant_id, constatee_le desc);

-- ------------------------------------------- 8. Une pièce qu'on ne voit pas ne s'attache pas
--
-- Une clé étrangère ne consulte AUCUNE politique : sans ce garde, un cabinet
-- rattacherait son exemple à la pièce d'un autre et en apprendrait l'existence
-- — et, par le jeu des erreurs d'unicité, bien davantage.
--
-- `security invoker` est ici la garantie, pas une commodité : la condition
-- n'est pas « la pièce appartient au même tenant » (ce qui interdirait à un
-- cabinet de travailler sur les pièces de ses mandats) mais « l'appelant VOIT
-- cette pièce ». C'est la RLS de `capture.pieces` qui répond, y compris pour
-- la visibilité personnelle.

create or replace function fabrique.verifier_piece_visible()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.piece_id is null then
    return new;
  end if;
  if not exists (select 1 from capture.pieces p where p.id = new.piece_id) then
    raise exception 'la piece % n''est pas lisible par l''appelant', new.piece_id
      using errcode = '42501';
  end if;
  return new;
end
$$;

-- ------------------------------------------------ 9. Les seuils, dans le référentiel
--
-- R4 : aucun seuil en TypeScript, aucun seuil dans un `check`. R10 : un défaut
-- LIVRÉ, visible, surchargeable sans migration.
--
-- Deux familles, deux préfixes, et ils ne se mélangent pas :
--
--   `fabrique.seuil.promotion.min.<mesure>`  ce qu'une évaluation doit atteindre
--   `fabrique.seuil.promotion.max.<mesure>`  ce qu'elle ne doit pas dépasser
--   `fabrique.seuil.recette.<borne>`         les bornes du validateur de recette
--
-- On réutilise `ref.socle_params` — la table existe, elle est datée, elle est
-- déjà lue par cinq moteurs — au lieu d'en créer une de plus.
--
-- R11 : la date de validité est un littéral. `valid_from` n'a pas de défaut
-- dans `ref.socle_params`, mais on l'écrit explicitement — et c'est la forme
-- CACHÉE de la faute qu'on évite ainsi : une insertion qui omet la colonne
-- ferait entrer la date du jour sans rien écrire nulle part.

insert into ref.socle_params
  (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, c.code, c.v, 'Politique de fabrique de lecteurs ALGORIA', date '2026-10-18'
  from ref.jurisdiction_packs p
  cross join (values
    -- Ce qu'une recette doit valoir pour qu'on cesse d'appeler le modèle.
    ('fabrique.seuil.promotion.min.exactitude_champs_critiques', 0.98::numeric),
    ('fabrique.seuil.promotion.max.montants_faux_acceptes',      0),
    ('fabrique.seuil.promotion.max.taux_abstention',             0.25),
    -- Les cinq bornes du validateur de recette. Le validateur les prend en
    -- paramètre OBLIGATOIRE, sans défaut : « tant qu'elles n'y sont pas, il
    -- ne s'appelle pas plutôt que de s'appeler faux ». Une borne qui aurait
    -- un défaut dans le code serait une constante invisible, et un validateur
    -- silencieusement trop permissif laisserait passer des recettes que
    -- personne n'a autorisées. Elles vivent donc ici, datées, surchargeables.
    --
    -- `ancre_texte_min` = 3 est un POINT DE DÉPART À MESURER, pas un relevé.
    -- La question n'a pas été tranchée faute de données : sur une facture
    -- arabe, une mention de deux ou trois caractères peut porter le sens
    -- (« ر.ض » pour le matricule, « ت » pour la date), là où trois caractères
    -- latins sont souvent du bruit. Tant qu'on n'aura pas compté les ancres
    -- réellement retenues sur un corpus arabe, cette borne est une opinion —
    -- livrée, visible, et qu'un cabinet change sans déploiement.
    ('fabrique.seuil.recette.ancre_texte_min',  3),
    ('fabrique.seuil.recette.selecteurs_max',   200),
    ('fabrique.seuil.recette.champs_max',       50),
    ('fabrique.seuil.recette.jetons_max',       12),
    ('fabrique.seuil.recette.rang_max',         50)
  ) as c(code, v)
 where p.effective_from <= date '2026-10-18'
   and (p.effective_to is null or p.effective_to >= date '2026-10-18')
on conflict do nothing;

-- La couche par organisation, au-dessus du pack. Bornée aux seuils de la
-- fabrique : un cabinet arrête SA tolérance de lecture, il n'arrête ni un taux
-- de TVA ni un droit de timbre, qui ne sont pas des décisions de cabinet.
create table if not exists parametrage.fabrique_seuils (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references identity.organizations(id) on delete cascade,
  code       text not null check (code like 'fabrique.seuil.%'),
  value_num  numeric(38,6) not null,
  motif      text,
  arrete_par uuid not null default auth.uid(),
  arrete_le  timestamptz not null default now(),
  unique (tenant_id, code)
);
create index if not exists parametrage_fabrique_seuils_tenant_idx
  on parametrage.fabrique_seuils (tenant_id, code);

comment on table parametrage.fabrique_seuils is
  'Ce que le cabinet a ARRÊTÉ, au-dessus du défaut livré par le pack. '
  'Se change sans migration (R10). Ce qui vient d''ici est la décision du '
  'cabinet ; ce qui vient de ref.socle_params est le défaut de Malica.';

create or replace function fabrique.seuils_exiges(p_tenant uuid)
returns table (code text, mesure text, sens text, exigence numeric, arrete_par_le_cabinet boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with livres as (
    select distinct on (s.code) s.code, s.value_num
      from ref.socle_params s
     where s.code like 'fabrique.seuil.promotion.%'
       and s.valid_from <= current_date
       and (s.valid_to is null or s.valid_to >= current_date)
     order by s.code, s.valid_from desc
  )
  select l.code,
         substring(l.code from '^fabrique\.seuil\.promotion\.(?:min|max)\.(.+)$') as mesure,
         split_part(l.code, '.', 4) as sens,
         coalesce(c.value_num, l.value_num) as exigence,
         c.value_num is not null as arrete_par_le_cabinet
    from livres l
    left join parametrage.fabrique_seuils c
      on c.tenant_id = p_tenant and c.code = l.code
$$;

revoke all on function fabrique.seuils_exiges(uuid) from public, anon;
grant execute on function fabrique.seuils_exiges(uuid) to authenticated;

comment on function fabrique.seuils_exiges(uuid) is
  'Les seuils de promotion en vigueur pour une organisation : ce que le '
  'cabinet a arrêté, puis le défaut du pack. La colonne '
  '« arrete_par_le_cabinet » répond à « qui a décidé » sans lire un historique.';

/*
 * Les cinq bornes du validateur de recette.
 *
 * Elles sortent d'ici ENSEMBLE, ou pas du tout. Le validateur les exige toutes
 * les cinq, sans défaut ; lui en rendre quatre le ferait tourner avec une
 * cinquième inventée par quelqu'un, et c'est exactement le repli implicite que
 * R4 interdit. Une borne manquante est donc une exception, pas un `null` :
 * l'appelant n'a aucune occasion de « compléter ».
 */
create or replace function fabrique.bornes_de_recette(p_tenant uuid)
returns table (borne text, valeur numeric, arrete_par_le_cabinet boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_attendues constant text[] := array[
    'ancre_texte_min', 'selecteurs_max', 'champs_max', 'jetons_max', 'rang_max'];
  v_manquantes text[];
begin
  return query
    with livres as (
      select distinct on (s.code) s.code, s.value_num
        from ref.socle_params s
       where s.code like 'fabrique.seuil.recette.%'
         and s.valid_from <= current_date
         and (s.valid_to is null or s.valid_to >= current_date)
       order by s.code, s.valid_from desc
    )
    select substring(l.code from '^fabrique\.seuil\.recette\.(.+)$'),
           coalesce(c.value_num, l.value_num),
           c.value_num is not null
      from livres l
      left join parametrage.fabrique_seuils c
        on c.tenant_id = p_tenant and c.code = l.code
     where substring(l.code from '^fabrique\.seuil\.recette\.(.+)$') = any(v_attendues);

  select array_agg(a order by a) into v_manquantes
    from unnest(v_attendues) as a
   where not exists (
     select 1 from ref.socle_params s
      where s.code = 'fabrique.seuil.recette.' || a
        and s.valid_from <= current_date
        and (s.valid_to is null or s.valid_to >= current_date));

  if v_manquantes is not null then
    raise exception
      'bornes de recette absentes du referentiel : % (ref.socle_params, codes fabrique.seuil.recette.*)',
      array_to_string(v_manquantes, ', ')
      using errcode = 'no_data_found';
  end if;
end
$$;

revoke all on function fabrique.bornes_de_recette(uuid) from public, anon;
grant execute on function fabrique.bornes_de_recette(uuid) to authenticated;

comment on function fabrique.bornes_de_recette(uuid) is
  'Les cinq bornes que le validateur de recette exige sans défaut : '
  'ancre_texte_min, selecteurs_max, champs_max, jetons_max, rang_max. '
  'Ce que le cabinet a arrêté, puis le défaut du pack ; une borne absente '
  'lève une erreur au lieu de laisser deviner la cinquième.';

-- ----------------------------------------- 10. Le cycle de vie, tenu par la base

create or replace function fabrique.verifier_promotion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_precedent fabrique.etat_t;
  v_permis    text[];
  v_mesures   jsonb;
  v_version   uuid;
  v_seuils    integer := 0;
  r           record;
  v_valeur    numeric;
begin
  select p.etat into v_precedent
    from fabrique.promotions p
   where p.recette_version_id = new.recette_version_id
   order by p.ordre desc
   limit 1;

  v_permis := case coalesce(v_precedent::text, 'neant')
    when 'neant'       then array['candidate']
    when 'candidate'   then array['evaluee', 'retiree']
    when 'evaluee'     then array['observation', 'retiree']
    when 'observation' then array['active', 'suspendue', 'retiree']
    when 'active'      then array['suspendue', 'retiree']
    when 'suspendue'   then array['observation', 'active', 'retiree']
    else array[]::text[]
  end;

  if not (new.etat::text = any(v_permis)) then
    raise exception
      'cycle de la fabrique : % -> % n''est pas une transition (permis : %)',
      coalesce(v_precedent::text, 'rien'), new.etat, v_permis
      using errcode = 'check_violation';
  end if;

  -- Une VALIDATION humaine fournit un exemple ; elle n'autorise aucune
  -- promotion. Tout état qui prétend à une qualité exige une ÉVALUATION.
  if new.etat in ('evaluee', 'observation', 'active') then
    if new.evaluation_id is null then
      raise exception
        'passer à « % » exige une evaluation : une validation humaine n''en tient pas lieu',
        new.etat
        using errcode = 'check_violation';
    end if;
    select e.mesures, e.recette_version_id into v_mesures, v_version
      from fabrique.evaluations e where e.id = new.evaluation_id;
    if v_version is distinct from new.recette_version_id then
      raise exception 'l''evaluation % porte sur une autre version', new.evaluation_id
        using errcode = 'check_violation';
    end if;
  end if;

  -- L'activation, et elle seule, se mesure contre le référentiel.
  if new.etat = 'active' then
    for r in select * from fabrique.seuils_exiges(new.tenant_id) loop
      v_seuils := v_seuils + 1;
      v_valeur := (v_mesures ->> r.mesure)::numeric;
      if v_valeur is null then
        raise exception
          'la mesure « % » manque a l''evaluation : une mesure absente reste absente',
          r.mesure
          using errcode = 'check_violation';
      end if;
      if r.sens = 'min' and v_valeur < r.exigence then
        raise exception 'seuil % : % < % exige', r.mesure, v_valeur, r.exigence
          using errcode = 'check_violation';
      end if;
      if r.sens = 'max' and v_valeur > r.exigence then
        raise exception 'seuil % : % > % tolere', r.mesure, v_valeur, r.exigence
          using errcode = 'check_violation';
      end if;
    end loop;
    -- Aucun repli implicite (R4) : sans seuil en vigueur, on refuse.
    if v_seuils = 0 then
      raise exception
        'aucun seuil de promotion en vigueur (ref.socle_params, codes fabrique.seuil.*)'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

comment on function fabrique.verifier_promotion() is
  'Le cycle, les évaluations exigées et les seuils du référentiel — dans la '
  'base, parce qu''un écran se contourne et qu''une RPC s''oublie.';

-- ------------------------------------------------------- 11. L'isolation (R6, R7)
--
-- Le helper du dépôt fait tout d'un coup : enable + force, révocation de
-- public / anon / service_role, lecture élargie aux mandats, écriture réservée
-- aux membres, et — avec le quatrième argument — le déclencheur qui refuse
-- update et delete. Les sept tables de la fabrique sont des FAITS : toutes en
-- ajout seul.

select app.enable_tenant_rls('fabrique', 'recettes',                  false, true);
select app.enable_tenant_rls('fabrique', 'recette_versions',          false, true);
select app.enable_tenant_rls('fabrique', 'exemples',                  false, true);
select app.enable_tenant_rls('fabrique', 'recette_version_exemples',  false, true);
select app.enable_tenant_rls('fabrique', 'evaluations',               false, true);
select app.enable_tenant_rls('fabrique', 'evaluation_exemples',       false, true);
select app.enable_tenant_rls('fabrique', 'executions',                false, true);
select app.enable_tenant_rls('fabrique', 'promotions',                false, true);
select app.enable_tenant_rls('fabrique', 'derives',                   false, true);

-- Le paramétrage, lui, se CHANGE : c'est sa raison d'être (R10, conséquence 3).
select app.enable_tenant_rls('parametrage', 'fabrique_seuils');

-- `ordre` est une colonne d'identité : personne ne l'écrit, et `insert … (…)`
-- sans elle suffit. On retire le droit d'écrire pour que ce soit vrai.
revoke insert (ordre) on table fabrique.promotions from authenticated;

-- Une promotion n'est pas une saisie : c'est une décision. Le dirigeant et
-- l'expert la prennent ; un assistant ou un collaborateur, non. Ici la
-- fonction reçoit une COLONNE de la ligne : elle est corrélée, PostgreSQL ne
-- peut pas la hisser en InitPlan, et l'enveloppe `(select …)` ne servirait à
-- rien. C'est la même lecture qu'au 17 octobre.
drop policy if exists fabrique_promotions_ins on fabrique.promotions;
create policy fabrique_promotions_ins on fabrique.promotions
  for insert to authenticated
  with check (tenant_id in (select app.member_orgs())
              and app.has_org_role(tenant_id, array['dirigeant', 'expert']));

drop trigger if exists fabrique_exemples_piece_visible on fabrique.exemples;
create trigger fabrique_exemples_piece_visible
  before insert on fabrique.exemples
  for each row execute function fabrique.verifier_piece_visible();
drop trigger if exists fabrique_executions_piece_visible on fabrique.executions;
create trigger fabrique_executions_piece_visible
  before insert on fabrique.executions
  for each row execute function fabrique.verifier_piece_visible();
drop trigger if exists fabrique_derives_piece_visible on fabrique.derives;
create trigger fabrique_derives_piece_visible
  before insert on fabrique.derives
  for each row execute function fabrique.verifier_piece_visible();

drop trigger if exists fabrique_promotions_cycle on fabrique.promotions;
create trigger fabrique_promotions_cycle
  before insert on fabrique.promotions
  for each row execute function fabrique.verifier_promotion();

-- ------------------------------------------------------- 12. L'état, en une lecture

create or replace view fabrique.etat_des_recettes_v with (security_invoker = true) as
select distinct on (p.recette_version_id)
       p.recette_version_id,
       v.recette_id,
       v.tenant_id,
       v.rang,
       r.libelle,
       r.signature_cle,
       r.portee,
       p.etat,
       p.motif,
       p.evaluation_id,
       p.decide_par,
       p.decide_le
  from fabrique.promotions p
  join fabrique.recette_versions v on v.id = p.recette_version_id
  join fabrique.recettes r on r.id = v.recette_id
 order by p.recette_version_id, p.ordre desc;

grant select on fabrique.etat_des_recettes_v to authenticated;

comment on view fabrique.etat_des_recettes_v is
  'L''état courant d''une version : le DERNIER fait inscrit. Rien n''est '
  'stocké — une suspension est une ligne de plus, et cette vue la voit.';


