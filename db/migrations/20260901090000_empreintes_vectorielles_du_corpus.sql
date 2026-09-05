-- Les empreintes vectorielles du corpus juridique.
--
-- ========================================================== POURQUOI MAINTENANT
--
-- pgvector 0.8.6 est installé sur le poste depuis le 31 août 2026. La migration
-- du 30 août avait retiré `legal.chunks` parce que l'extension manquait et que
-- le chargeur réécrivait `vector(768)` en `real[]` — une divergence silencieuse
-- entre la base locale et la production. Ce motif n'existe plus : l'extension
-- est là, le type est le vrai type, et le rejeu complet des migrations le
-- vérifie.
--
-- ========================================================== POURQUOI DES FRAGMENTS
--
-- Une empreinte par version d'article aurait été plus simple. Les mesures du
-- corpus l'interdisent : sur 4 902 versions, 96 dépassent 20 000 caractères et
-- l'une atteint 738 225. Un vecteur unique pour un texte de cette taille ne
-- désigne plus rien — il moyenne un code entier — et dépasse la fenêtre de
-- n'importe quel modèle d'empreinte.
--
-- On fragmente donc, et la table dégénère d'elle-même : les 3 694 versions de
-- moins de 2 000 caractères, soit trois quarts du corpus, donnent un fragment
-- unique. Seules les longues sont découpées.
--
-- ========================================================== LA DIMENSION EST LE VRAI VERROU
--
-- R8 dit que changer de modèle est une ligne de migration. C'est vrai du nom du
-- modèle ; ce ne l'est PAS de la dimension de ses empreintes. Une colonne
-- `vector(1024)` n'accueille pas des vecteurs de 768 ou de 1536 : en changer
-- impose une migration de schéma ET un réencodage complet du corpus.
--
-- D'où le choix de 1024 : c'est la dimension native de qwen3.7-text-embedding,
-- de text-embedding-v3 et v4, et celle de bge-m3, le modèle souverain vers
-- lequel on basculera si l'on veut que rien ne sorte de la machine. Le jour où
-- ce basculement arrive, il reste ce que R8 promet — une ligne dans la table
-- qui tarife, puis un réencodage. Pas une refonte.
--
-- Le modèle n'est écrit nulle part dans le code : `agents.model_pricing` en est
-- la seule source, et chaque fragment porte la ligne de tarif qui l'a produit.
-- « Quel modèle a produit cette empreinte, et ce qu'il a coûté » est une seule
-- lecture, comme R8 l'exige.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Le rôle « embedding » n'existait pas dans la table des tarifs.
-- ---------------------------------------------------------------------------
alter table agents.model_pricing drop constraint if exists model_pricing_role_check;
alter table agents.model_pricing
  add constraint model_pricing_role_check
  check (role = any (array['reasoner', 'chat', 'vision', 'cache', 'embedding']));

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign, effective_from)
select 'alibaba', 'qwen3.7-text-embedding', 'embedding', 0.070, 0.000, 'USD', false, date '2026-09-01'
where not exists (
  select 1 from agents.model_pricing
  where provider = 'alibaba' and model = 'qwen3.7-text-embedding'
    and role = 'embedding' and effective_from = date '2026-09-01');

-- ---------------------------------------------------------------------------
-- Les fragments.
-- ---------------------------------------------------------------------------
create table if not exists legal.chunks (
  id                 uuid primary key default gen_random_uuid(),
  article_version_id uuid not null references legal.article_versions (id) on delete cascade,
  ordinal            integer not null,
  langue             text not null,
  texte              text not null,
  caracteres         integer not null,
  -- L'empreinte est nullable : un fragment existe dès le découpage, et il est
  -- encodé ensuite. Un fragment sans empreinte est un travail en attente, pas
  -- une erreur — et il se voit d'une requête.
  embedding          extensions.vector(1024),
  -- La traçabilité R8 : quel modèle, et à quel tarif. La ligne de tarif ne
  -- disparaît jamais (elle se clôt par effective_to), donc la référence tient.
  pricing_id         uuid references agents.model_pricing (id),
  encode_le          timestamptz,
  created_at         timestamptz not null default now(),
  constraint chunks_ordinal_positif check (ordinal >= 1),
  constraint chunks_texte_non_vide check (length(texte) > 0),
  constraint chunks_caracteres_coherent check (caracteres = length(texte)),
  -- Une empreinte sans son tarif serait une valeur sans provenance.
  constraint chunks_empreinte_tracee check (
    (embedding is null and pricing_id is null and encode_le is null)
    or (embedding is not null and pricing_id is not null and encode_le is not null)),
  constraint chunks_version_ordinal_key unique (article_version_id, ordinal)
);

create index if not exists chunks_version_idx on legal.chunks (article_version_id);

-- Les fragments en attente d'empreinte, sans parcourir la table entière.
create index if not exists chunks_a_encoder_idx on legal.chunks (article_version_id)
  where embedding is null;

-- L'index de recherche. Cosinus : les empreintes de Qwen sont normalisées, et
-- le cosinus est la distance que le fournisseur documente.
--
-- m et ef_construction sont laissés à leurs valeurs par défaut (16 et 64) :
-- sur 10 000 fragments, les régler serait un réglage sans mesure.
do $$ begin
  create index chunks_hnsw on legal.chunks
    using hnsw (embedding extensions.vector_cosine_ops);
exception when duplicate_table then null; end $$;

-- ---------------------------------------------------------------------------
-- Droits : le corpus est un référentiel livré. Lecture pour tous les membres,
-- écriture réservée au propriétaire, comme les sept autres tables de `legal`.
-- ---------------------------------------------------------------------------
alter table legal.chunks enable row level security;
alter table legal.chunks force row level security;

drop policy if exists legal_chunks_sel on legal.chunks;
create policy legal_chunks_sel on legal.chunks for select to authenticated using (true);

revoke all on legal.chunks from public;
grant select on legal.chunks to authenticated;
