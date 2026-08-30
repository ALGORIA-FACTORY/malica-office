-- Couche de compatibilité Supabase, pour un PostgreSQL nu.
--
-- Les migrations de Regalica Office sont écrites pour Supabase : elles
-- s'appuient sur `auth.uid()`, sur les rôles `authenticated` / `service_role`
-- et sur `storage.objects`. Un Postgres fraîchement installé n'a rien de tout
-- cela, et les 21 migrations échouent dès la première politique RLS.
--
-- Ce fichier ne simule pas Supabase : il en recrée le strict nécessaire, avec
-- la même sémantique, pour que le schéma et les politiques s'installent et se
-- testent à l'identique. Il ne doit JAMAIS être exécuté sur la base de
-- production — Supabase fournit déjà tous ces objets.

-- --------------------------------------------------------------------------
-- Les rôles. `service_role` contourne la RLS, comme chez Supabase : c'est
-- précisément ce qui rend la preuve d'isolation significative, puisqu'elle
-- vérifie qu'aucun chemin utilisateur ne l'emprunte.
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- Extensions imposées par le Guide de Stack (§06) : pgcrypto pour le
-- chiffrement, vector pour les embeddings. pgcrypto est fourni avec toute
-- installation PostgreSQL standard ; vector est traité plus bas, car il ne
-- l'est pas sous Windows.
create extension if not exists pgcrypto with schema extensions;

grant usage on schema auth, storage, extensions to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- L'identité. `auth.uid()` lit le claim `sub` du jeton, exactement comme chez
-- Supabase — c'est ce que PostgREST place dans les réglages de la transaction.
-- Un test local ouvre donc une session en écrivant ce réglage, sans jamais
-- emprunter un rôle privilégié.
-- --------------------------------------------------------------------------
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role() returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

-- --------------------------------------------------------------------------
-- Le stockage. Seule la table `storage.objects` est référencée par les
-- migrations (les pièces vivent dans le bucket `pieces`).
-- --------------------------------------------------------------------------
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid references auth.users (id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

insert into storage.buckets (id, name, public)
values ('pieces', 'pieces', false)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- pgvector. Présent chez Supabase, absent d'une installation Windows standard.
-- On tente l'extension ; le chargeur signale son absence et adapte la seule
-- migration concernée (`legal.chunks`) plutôt que d'échouer.
-- --------------------------------------------------------------------------
do $$
begin
  create extension if not exists vector with schema extensions;
  raise notice 'pgvector : disponible';
exception
  when others then
    raise notice 'pgvector : ABSENT — la recherche sémantique ne sera pas testable en local';
end $$;
