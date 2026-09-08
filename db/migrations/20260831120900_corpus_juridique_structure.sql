-- Le corpus juridique : sa structure, pas ses données.
--
-- ========================================================== LA SÉPARATION
--
-- Sept tables portent le corpus : les sources, les documents, leur file
-- d'ingestion, les articles, leurs versions datées, les occurrences découpées et
-- les références extraites. Le paquet de la base de connaissance en apporte
-- 21 973 pages, 23 631 références et 4 902 versions d'articles.
--
-- Cette migration crée la STRUCTURE et rien d'autre. Les données du corpus ne
-- sont pas versionnées ici, et c'est délibéré : elles pèsent vingt mégaoctets,
-- elles vivent déjà dans `docs/Base de connaissance/`, et surtout elles ne sont
-- pas de même nature qu'un schéma. Un corpus juridique s'ALIMENTE — le Journal
-- officiel publie, une loi de finances paraît, un article est amendé. C'est un
-- flux, pas une définition.
--
-- C'est exactement le volet 2 du paramétrage : Algoria Factory et son partenaire
-- alimentent ce corpus périodiquement, hors de tout cabinet et de toute PME. Le
-- schéma est livré par migration ; le contenu arrive par ingestion.
--
-- Pour charger le corpus d'aujourd'hui :
--   tar -xzf "docs/Base de connaissance/referentielmalica20260831.tar.gz"
--   psql "$DATABASE_URL_ADMIN" -f paquet/dump_referentiel.sql   # sections legal.*
--
-- ========================================================== CE QUI REVIENT
--
-- Le schéma `legal` avait été retiré la veille : sa table `chunks` déclarait un
-- `vector(768)` que pgvector, absent, obligeait le chargeur à réécrire en
-- `real[]`. Ce schéma-ci n'a PAS d'empreintes vectorielles — il porte du texte,
-- des dates et des empreintes SHA-256. Il ne dépend de rien qui ne soit
-- installé.

create schema if not exists legal;

CREATE TABLE IF NOT EXISTS legal.articles_extraits (
    id bigint NOT NULL,
    queue_id uuid NOT NULL,
    corpus text NOT NULL,
    edition integer,
    numero text NOT NULL,
    langue text,
    sha256 character(64) NOT NULL,
    caracteres integer NOT NULL,
    amendements text[],
    texte text NOT NULL,
    offset_debut integer,
    offset_fin integer
);

do $$ begin
  CREATE SEQUENCE legal.articles_extraits_id_seq
      START WITH 1
      INCREMENT BY 1
      NO MINVALUE
      NO MAXVALUE
      CACHE 1;
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  ALTER SEQUENCE legal.articles_extraits_id_seq OWNED BY legal.articles_extraits.id;
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

CREATE TABLE IF NOT EXISTS legal.documents (
    queue_id uuid NOT NULL,
    sha256 character(64) NOT NULL,
    pages integer,
    pages_sans_texte integer,
    langue_mesuree text,
    langue_annoncee text,
    besoin_ocr boolean DEFAULT false NOT NULL,
    caracteres integer,
    texte text,
    ingere_le timestamp with time zone DEFAULT now() NOT NULL,
    origine_texte text DEFAULT 'natif'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS legal.references_extraites (
    queue_id uuid NOT NULL,
    type_ref text NOT NULL,
    corpus_ref text NOT NULL,
    reference text NOT NULL
);

do $$ begin
  ALTER TABLE ONLY legal.articles_extraits ALTER COLUMN id SET DEFAULT nextval('legal.articles_extraits_id_seq'::regclass);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  ALTER TABLE ONLY legal.articles_extraits
      ADD CONSTRAINT articles_extraits_pkey PRIMARY KEY (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  ALTER TABLE ONLY legal.articles_extraits
      ADD CONSTRAINT articles_extraits_queue_id_numero_offset_debut_key UNIQUE (queue_id, numero, offset_debut);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  ALTER TABLE ONLY legal.documents
      ADD CONSTRAINT documents_pkey PRIMARY KEY (queue_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  ALTER TABLE ONLY legal.references_extraites
      ADD CONSTRAINT references_extraites_pkey PRIMARY KEY (queue_id, type_ref, corpus_ref, reference);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  ALTER TABLE ONLY legal.articles_extraits
      ADD CONSTRAINT articles_extraits_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES legal.ingestion_queue(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  ALTER TABLE ONLY legal.documents
      ADD CONSTRAINT documents_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES legal.ingestion_queue(id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

do $$ begin
  ALTER TABLE ONLY legal.references_extraites
      ADD CONSTRAINT references_extraites_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES legal.ingestion_queue(id) ON DELETE CASCADE;
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
