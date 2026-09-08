-- =====================================================================================
--  Malica Office — Couche fiscale : le schéma
--
--  DEUX OBJETS, JAMAIS CONFONDUS
--
--    ref.fiscal_parameters   ce qui CALCULE — taux, seuils, barèmes, délais.
--                            Machine-lisible. Clé : PAYS + date.
--    legal.*                 ce qui JUSTIFIE — le texte, versionné à l'article.
--                            Cité, jamais calculé. Clé : article + version.
--
--  Le lien entre les deux est la citation portée par chaque paramètre : c'est la règle
--  R2 (« aucun montant sans citation ») appliquée au fiscal.
--
--  CLÉS — trois dimensions distinctes, à ne pas fusionner :
--    plan comptable        -> REFERENTIEL (SCE, PCG, SYSCOHADA) — l'OHADA, c'est 17 pays
--                             pour un seul plan.
--    paramètres fiscaux    -> PAYS — trois pays OHADA partagent le plan, pas la TVA.
--    régime du dossier     -> PÉRIODE, portée par le dossier lui-même.
-- =====================================================================================

create schema if not exists legal;

-- --- 1. Paramètres : ce qui calcule ---------------------------------------------------

create table if not exists ref.fiscal_parameters (
  id             uuid primary key default gen_random_uuid(),
  jurisdiction   text        not null,           -- pays, ISO-3166 alpha-2
  code           text        not null,
  libelle        text        not null,
  forme          text        not null check (forme in
                   ('taux','montant','seuil','bareme','duree','delai','booleen','exoneration','texte')),
  echelle        text        not null,           -- ratio | dinars | jours | texte | bareme
  valeur_num     numeric,                        -- forme canonique, la SEULE lue par le socle
  valeur_texte   text,
  valeur_brute   text        not null,           -- graphie officielle, pour l'audit
  corpus         text        not null,
  texte_source   text,
  article        text,
  citation       text,
  autorite       text        not null check (autorite in ('texte','doctrine','lecture')),
  confiance      text        not null check (confiance in ('confirme','a_confirmer','non_trouve')),
  valid_from     date        not null,
  valid_to       date,
  note           text,

  -- R2 : aucun montant sans citation. Un paramètre confirmé porte son article.
  constraint fiscal_param_citation
    check (confiance <> 'confirme' or (article is not null and citation is not null)),
  -- un paramètre non trouvé n'a pas de valeur : il existe pour rendre l'absence visible
  constraint fiscal_param_non_trouve_sans_valeur
    check (confiance <> 'non_trouve' or valeur_num is null),
  constraint fiscal_param_periode check (valid_to is null or valid_to > valid_from)
);

-- Deux versions d'un même paramètre ne peuvent jamais se chevaucher dans le temps.
-- C'est la base qui l'interdit, pas le code applicatif.
create extension if not exists btree_gist;
alter table ref.fiscal_parameters drop constraint if exists fiscal_param_sans_chevauchement;
alter table ref.fiscal_parameters add constraint fiscal_param_sans_chevauchement
  exclude using gist (
    jurisdiction with =, code with =,
    daterange(valid_from, valid_to, '[)') with &&
  );

create index if not exists idx_fiscal_param_resolution
  on ref.fiscal_parameters (jurisdiction, code, valid_from desc);

comment on column ref.fiscal_parameters.valeur_brute is
  'Graphie officielle du texte (« 1,000 dinar », « 0,2 % »). Conservée pour l''audit. '
  'Le socle ne la lit jamais pour calculer : il lit valeur_num, qui porte l''échelle canonique.';
comment on column ref.fiscal_parameters.valid_from is
  'Date à laquelle la valeur est CONSTATÉE en vigueur, pas nécessairement sa date d''entrée '
  'en vigueur réelle. Une résolution hors période échoue ; elle n''extrapole jamais.';

-- --- 2. Barèmes : un barème n'est pas un scalaire ------------------------------------

create table if not exists ref.fiscal_scale_brackets (
  parameter_code text    not null,
  jurisdiction   text    not null,
  valid_from     date    not null,
  ordre          int     not null,
  borne_min      numeric not null,
  borne_max      numeric,                        -- null = tranche ouverte
  taux           numeric not null,               -- ratio canonique
  primary key (jurisdiction, parameter_code, valid_from, ordre),
  constraint bracket_ordonnee check (borne_max is null or borne_max > borne_min)
);

-- --- 3. Calendrier des obligations ---------------------------------------------------
-- L'échéance ne dépend pas que de la forme juridique : elle dépend aussi du MODE DE DÉPÔT.
-- Une personne morale télédéclarante a 20 jours là où une autre en a 28 — c'est une
-- réduction, pas une faveur, et un calendrier naïf la manque.

create table if not exists ref.fiscal_obligations (
  id             uuid primary key default gen_random_uuid(),
  jurisdiction   text not null,
  code           text not null,
  libelle        text not null,
  periodicite    text not null,                  -- mensuelle | trimestrielle | annuelle | ponctuelle
  echeance_jour  int,                            -- quantième du mois
  echeance_regle text not null,                  -- formulation littérale, fait foi
  forme_juridique text,                          -- physique | morale | null = les deux
  mode_depot     text,                           -- papier | electronique | null = indifferent
  regime         text,                           -- réel | forfaitaire | exportateur | null
  texte_source   text not null,
  article        text,
  citation       text,
  valid_from     date not null,
  valid_to       date,
  unique (jurisdiction, code, valid_from)
);

-- --- 4. Corpus juridique : ce qui justifie -------------------------------------------
-- Grain = l'ARTICLE, et un article a une IDENTITÉ stable et des VERSIONS successives.
-- Une loi de finances n'écrit pas un texte neuf : elle amende des articles.

create table if not exists legal.articles (
  id             uuid primary key default gen_random_uuid(),
  jurisdiction   text not null,
  corpus         text not null,                  -- CIRPPIS | CTVA | CDPF | CDET | CFL | ...
  numero         text not null,                  -- « 49-I-3 »
  unique (jurisdiction, corpus, numero)
);
comment on table legal.articles is
  'Identité stable d''un article. L''article 52 du CIRPP est UNE ligne ici et autant de '
  'lignes dans legal.article_versions qu''il a connu de rédactions.';

create table if not exists legal.article_versions (
  id                uuid primary key default gen_random_uuid(),
  article_id        uuid not null references legal.articles(id),
  version_num       int  not null,
  texte_fr          text,
  texte_ar          text,
  langue_faisant_foi text not null default 'ar', -- le JORT fait foi en arabe
  source_url        text not null,
  source_sha256     char(64) not null,           -- empreinte du texte extrait PAR LE CODE
  modifie_par       text,                        -- « art. 20-6 LF 2025-17 du 12/12/2025 »
  jort_reference    text,
  valid_from        date not null,
  valid_to          date,
  extraction_confiance text not null
                    check (extraction_confiance in ('verbatim','partiel','incertain')),
  open_issues       jsonb not null default '[]'::jsonb,
  unique (article_id, version_num)
);
comment on column legal.article_versions.source_sha256 is
  'Empreinte SHA-256 du texte extrait, calculée PAR LE CODE sur la source, jamais par un '
  'modèle. Un modèle qui recopie un texte et en compte ensuite les mots ne prouve rien : '
  'il compte ce qu''il a produit, pas ce qu''il a lu.';
comment on column legal.article_versions.open_issues is
  'Ce que l''extraction n''a pas pu établir. Une convention dont la date de signature est '
  'laissée en blanc doit arriver ici, pas entrer en base comme « en vigueur ».';

-- Autorité et opposabilité : un entier « norm_level » écrase la distinction qui compte.
create table if not exists legal.sources (
  code          text primary key,                -- 'LOI' | 'LF' | 'DECRET' | 'ARRETE' | 'NOTE_COMMUNE' | ...
  libelle       text not null,
  autorite      text not null check (autorite in ('normative','interpretative')),
  opposable_a   text[] not null default '{}',    -- {'administration'} | {} | ...
  fondement     text
);

insert into legal.sources (code, libelle, autorite, opposable_a, fondement) values
  ('CONVENTION','Convention internationale ratifiée','normative','{administration,contribuable,juge}',
   'Constitution 2022, art. 74 : autorité supérieure à la loi'),
  ('LOI','Loi ordinaire','normative','{administration,contribuable,juge}', null),
  ('LF','Loi de finances','normative','{administration,contribuable,juge}',
   'Loi ordinaire : même rang que la loi. Prime par lex posterior, non par nature.'),
  ('DECRET','Décret','normative','{administration,contribuable,juge}', null),
  ('ARRETE','Arrêté ministériel','normative','{administration,contribuable,juge}', null),
  ('NOTE_COMMUNE','Note commune DGELF','interpretative','{administration}',
   'Art. 54 LFC 2012 : opposable aux services de l''administration fiscale et du recouvrement, '
   'si publiée et relative aux législations en vigueur. N''oblige ni le contribuable ni le juge.'),
  ('PRISE_POSITION','Prise de position individuelle','interpretative','{}',
   'Aucun fondement légal d''opposabilité identifié. À traiter comme non opposable par défaut.')
on conflict (code) do nothing;

-- --- 5. Résolution : la fonction que le socle appelle ---------------------------------
-- Jumelle exacte de la résolution des rôles comptables :
--   trouvé et confirmé  -> la valeur
--   trouvé mais douteux -> erreur nommant le paramètre et son niveau de confiance
--   absent              -> erreur nommant le paramètre
-- Jamais de valeur par défaut, jamais d'extrapolation hors période.
-- « Aucun compte deviné » a pour jumeau « aucun taux deviné ».

create or replace function ref.parametre_fiscal(
  p_jurisdiction text, p_code text, p_date date
) returns numeric
language plpgsql stable as $$
declare r record;
begin
  select * into r from ref.fiscal_parameters
   where jurisdiction = p_jurisdiction and code = p_code
     and valid_from <= p_date and (valid_to is null or valid_to > p_date);

  if not found then
    raise exception
      'Paramètre fiscal introuvable : % (%) au %. Aucune valeur par défaut n''est appliquée.',
      p_code, p_jurisdiction, p_date
      using errcode = 'no_data_found';
  end if;

  if r.confiance = 'non_trouve' then
    raise exception
      'Paramètre fiscal % non établi sur source officielle. Il ne peut pas servir à un calcul. %',
      p_code, coalesce(r.note,'')
      using errcode = 'no_data_found';
  end if;

  if r.valeur_num is null then
    raise exception
      'Paramètre fiscal % n''est pas une valeur calculable (forme = %). Utilisez ref.parametre_fiscal_texte.',
      p_code, r.forme
      using errcode = 'wrong_object_type';
  end if;

  return r.valeur_num;
end $$;

comment on function ref.parametre_fiscal is
  'Résout un paramètre à la DATE DE LA PIÈCE, jamais à la date du jour. Une facture du '
  '15 janvier est jugée par la règle en vigueur le 15 janvier, même si le paramètre a été '
  'chargé en mars.';

-- Le barème se résout tranche par tranche. Le seuil bas effectif d'une tranche est le
-- plafond de la précédente : les bornes du texte (« 5 000,001 ») sont une écriture, pas
-- une arithmétique. Les confondre décale l'impôt de quelques dinars sur chaque tranche.
create or replace function ref.appliquer_bareme(
  p_jurisdiction text, p_code text, p_date date, p_base numeric
) returns numeric
language plpgsql stable as $$
declare n int; bas numeric; total numeric;
begin

  with tr as (
    select b.ordre, b.taux, b.borne_max,
           coalesce(lag(b.borne_max) over (order by b.ordre), 0) as seuil_bas
    from ref.fiscal_scale_brackets b
    join ref.fiscal_parameters p
      on p.code = b.parameter_code and p.jurisdiction = b.jurisdiction
     and p.valid_from = b.valid_from
    where b.jurisdiction = p_jurisdiction and b.parameter_code = p_code
      and p.valid_from <= p_date and (p.valid_to is null or p.valid_to > p_date)
  )
  select count(*), min(seuil_bas),
         coalesce(sum(greatest(0, least(p_base, coalesce(borne_max, p_base)) - seuil_bas) * taux), 0)
    into n, bas, total
  from tr;

  if n = 0 then
    raise exception 'Barème % introuvable au % pour la juridiction %.', p_code, p_date, p_jurisdiction
      using errcode = 'no_data_found';
  end if;

  -- Un barème dont la première tranche ne part pas de zéro est incomplet.
  -- Calculer dessus produirait un impôt faux, et personne ne le verrait.
  if bas <> 0 then
    raise exception
      'Barème % incomplet : la première tranche démarre à % au lieu de 0. Aucun calcul n''est effectué.',
      p_code, bas
      using errcode = 'data_exception';
  end if;

  return total;
end $$;

comment on function ref.appliquer_bareme is
  'Barème progressif par tranches. N''applique aucun arrondi : la règle d''arrondi est un '
  'paramètre distinct (IRPP_ARRONDI), parce qu''elle peut changer sans que le barème change.';
