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

-- --------------------------------------------------------------------------
-- Le rôle de connexion de l'API.
--
-- Il n'EST pas `authenticated` : il en est membre, ce qui lui permet de
-- l'endosser à chaque transaction. La distinction est essentielle — un rôle
-- superutilisateur, ou propriétaire des tables, contournerait la RLS et
-- viderait de son sens tout l'édifice de politiques.
--
-- Le mot de passe n'est pas posé ici : il est propre à chaque environnement.
--   alter role regalica_api with password '...';
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'regalica_api') then
    create role regalica_api login noinherit;
  end if;
  grant authenticated to regalica_api;
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

-- L'empreinte du mot de passe. Elle n'existait pas tant que GoTrue tenait
-- l'authentification ; elle devient nécessaire dès que l'API la tient
-- elle-même, avec bcrypt comme le prescrit le Guide de Stack.
--
-- `add column if not exists` plutôt qu'une redéfinition : la table peut déjà
-- exister avec des comptes dedans, et R7 interdit de réécrire ce qui est là.
alter table auth.users add column if not exists encrypted_password text;

-- La table des comptes n'est visible ni de `anon` ni de `authenticated` : aucun
-- chemin utilisateur ne doit pouvoir lire une empreinte de mot de passe, même
-- la sienne.
revoke all on auth.users from anon, authenticated;

-- Le rôle de connexion de l'API, lui, y accède — mais seulement tant qu'il n'a
-- pas endossé `authenticated`. C'est toute la séparation : le chemin
-- d'authentification travaille sous les droits propres de `regalica_api`, le
-- chemin métier sous `authenticated` et ses politiques.
--
-- `noinherit` sur le rôle rend cette frontière effective : il ne reçoit rien
-- de `authenticated` sans l'endosser explicitement.
grant usage on schema auth to regalica_api;
grant select, insert, update on auth.users to regalica_api;

create or replace function auth.uid() returns uuid
language sql
stable
-- Chemin figé, comme toutes les autres fonctions du projet : cette fonction est
-- lue par chacune des 195 politiques, et un chemin ouvert y serait le pire
-- endroit possible.
set search_path = ''
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
set search_path = ''
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
