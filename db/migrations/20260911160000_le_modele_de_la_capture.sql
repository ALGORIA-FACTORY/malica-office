-- Le modèle de la capture — ce qui manquait au scan pour tenir ses promesses.
--
-- ==================================================================== POURQUOI UNE MIGRATION ADDITIVE
--
-- Le modèle de la capture existe déjà, et l'API s'en sert : `capture.pieces`,
-- `capture.extractions` (la lecture d'une pièce), `capture.citations`,
-- `capture.conformite` (le contrôle d'une pièce). Créer à côté un
-- `piece_extraction` et un `piece_controle` ferait deux sources de vérité
-- pour la même chose (R9). On complète donc l'existant de ce qui lui manque.
--
-- ==================================================================== L'EMPREINTE DU FICHIER
--
-- `capture.pieces.sha256` existait, mais rien ne la contraignait : ni son
-- format, ni son unicité. Deux photos du même ticket, déposées à une semaine
-- d'écart, devenaient deux charges. L'empreinte est désormais UNIQUE PAR
-- TENANT — le même fichier peut exister dans deux dossiers, jamais deux fois
-- dans le même — et c'est un SHA-256 en hexadécimal minuscule.
--
-- Elle reste NULLABLE : une pièce s'enregistre avant que ses octets arrivent
-- (le chemin de stockage contient son identifiant), et l'empreinte se pose au
-- dépôt des octets. DETTE, à solder à l'étape du scan : aujourd'hui l'API
-- appelle `capture_piece_register(…, p_sha256 => null, …)` et ne la pose
-- jamais ensuite. L'unicité est prête ; le calcul ne l'est pas encore.
--
-- L'index mène par `tenant_id` : c'est la convention vérifiée par
-- apps/api/src/schema.test.ts, et c'est aussi le chemin de la recherche de
-- doublon, qui se fait toujours dans un dossier.
--
-- ==================================================================== LA CONFIANCE PAR CHAMP
--
-- `capture.extractions.payload.field_confidence.overall` est un indice
-- GLOBAL, rendu par le désignateur sur lui-même. Un numéro lu proprement et
-- une date illisible ne valent pas la même chose ; un indice global les
-- moyenne, et l'écran ne sait plus lequel demander. `confiance_par_champ`
-- porte donc un indice par champ : un objet `{ "totals.ttc": 0.4,
-- "document_date": 0.95, … }`, chaque valeur un nombre entre 0 et 1.
--
-- L'indice global reste dans le payload : il groupe aujourd'hui les
-- propositions du cabinet. Il ne tient pas lieu de confiance par champ.
--
-- DETTE, à solder à l'étape du scan : `capture_read_persist` ne remplit pas
-- encore cette colonne ; elle vaut `{}` jusque-là. Aucun indice n'est inventé.
--
-- ==================================================================== LE CONTRÔLE
--
-- `capture.conformite` tient déjà la règle : un verdict parmi `conforme`,
-- `a_corriger`, `non_conforme`, et un motif obligatoire dès qu'il n'est pas
-- `conforme` (contrainte `conformite_check`). Jamais un booléen seul. Rien à
-- ajouter, sinon le dire dans le schéma lui-même.
--
-- Aucune donnée n'est semée ici (R11).

-- ------------------------------------------------------------ l'empreinte

alter table capture.pieces drop constraint if exists pieces_sha256_format;
alter table capture.pieces
  add constraint pieces_sha256_format
  check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');

create unique index if not exists pieces_empreinte_par_tenant
  on capture.pieces (tenant_id, sha256)
  where sha256 is not null;

comment on column capture.pieces.sha256 is
  'Empreinte SHA-256 (hexadécimal minuscule) des octets déposés. Unique par tenant : un même fichier ne devient pas deux pièces dans un dossier. Nulle tant que les octets ne sont pas arrivés.';

-- ------------------------------------------------- la confiance par champ

create or replace function capture.confiances_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1
         from jsonb_each(p) as e(champ, indice)
        where jsonb_typeof(e.indice) <> 'number'
           or (e.indice #>> '{}')::numeric < 0
           or (e.indice #>> '{}')::numeric > 1
     )
$$;

comment on function capture.confiances_valides(jsonb) is
  'Vrai si l''objet associe à chaque champ un indice de confiance numérique entre 0 et 1.';

revoke all on function capture.confiances_valides(jsonb) from public;
grant execute on function capture.confiances_valides(jsonb) to authenticated;

alter table capture.extractions
  add column if not exists confiance_par_champ jsonb not null default '{}'::jsonb;

alter table capture.extractions drop constraint if exists extractions_confiance_par_champ_valide;
alter table capture.extractions
  add constraint extractions_confiance_par_champ_valide
  check (capture.confiances_valides(confiance_par_champ));

comment on column capture.extractions.confiance_par_champ is
  'Indice de confiance PAR CHAMP, de 0 à 1 : { "totals.ttc": 0.4, "document_date": 0.95, … }. L''indice global du payload ne le remplace pas.';

-- -------------------------------------------------------------- le contrôle

comment on table capture.conformite is
  'Le contrôle d''une pièce : un verdict (conforme, a_corriger, non_conforme) et, dès qu''il n''est pas conforme, son motif (conformite_check). Jamais un booléen seul.';
