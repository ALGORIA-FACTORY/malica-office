-- Le jeton d'accès se révoque.
--
-- ================================================================== POURQUOI
--
-- Audit de sécurité du 6 novembre 2026, S4 : `POST /auth/deconnexion`, puis `GET /moi`
-- avec le MÊME jeton en porteur → 200. Le jeton d'accès (douze heures) ne portait ni
-- identifiant ni date comparée à rien : la déconnexion effaçait le cookie, la
-- réinitialisation du mot de passe révoquait les jetons longs, et le jeton déjà émis
-- valait jusqu'à son expiration — téléphone perdu, session volée.
--
-- ================================================================== CE QUI CHANGE
--
-- Chaque jeton d'accès porte désormais un identifiant de session (`sid`) et sa date
-- d'émission à la milliseconde (`iat`). L'API les confronte, à chaque requête, à deux
-- faits tenus ici :
--
-- 1. `auth.users.sessions_invalidees_le` — « toute session émise avant cet instant est
--    close ». Posé par la déconnexion de partout et par la réinitialisation du mot de
--    passe : tous les appareils du compte tombent d'un coup, en une colonne.
--
-- 2. `auth.sessions_fermees` — les sessions fermées une à une : la déconnexion d'UN
--    appareil ferme son jeton, et lui seul (c'est ce que faisait déjà la déconnexion,
--    qui ne révoquait que le jeton long de l'appareil). Une ligne n'a de sens que
--    tant que le jeton qu'elle ferme pourrait encore servir : `expire_le` est
--    l'expiration du jeton, et ce qui est passé se purge.
--
-- Le schéma `auth` est hors RLS, comme `auth.users` et `auth.refresh_tokens` : le
-- rôle de l'API y travaille sous ses droits propres, avant toute identité ;
-- `authenticated` n'y voit rien.
--
-- REJEU (R11) : rien n'écrit dans une donnée de référence.

-- --- 1. Toute session émise avant cet instant est close --------------------------------
alter table auth.users add column if not exists sessions_invalidees_le timestamptz;
grant update (sessions_invalidees_le) on auth.users to malica_api;

-- --- 2. Les sessions fermées une à une --------------------------------------------------
create table if not exists auth.sessions_fermees (
  -- Le `sid` du jeton fermé.
  id        uuid primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  -- L'expiration du jeton : au-delà, il ne sert plus, et la ligne non plus.
  expire_le timestamptz not null,
  fermee_le timestamptz not null default now()
);
create index if not exists sessions_fermees_user_idx on auth.sessions_fermees (user_id);
create index if not exists sessions_fermees_expire_idx on auth.sessions_fermees (expire_le);

revoke all on auth.sessions_fermees from public, anon, authenticated;
grant select, insert, delete on auth.sessions_fermees to malica_api;

-- --- 3. Une session tient-elle encore ? -------------------------------------------------
-- Deux sondes d'index, en une requête : l'API l'appelle à chaque requête authentifiée.
-- Un compte disparu ne tient plus aucune session.
create or replace function auth.session_en_vigueur(p_user uuid, p_session uuid,
                                                   p_emise_le timestamptz)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from auth.users u
                  where u.id = p_user
                    and (u.sessions_invalidees_le is null
                         or p_emise_le >= u.sessions_invalidees_le))
     and not exists (select 1 from auth.sessions_fermees f where f.id = p_session)
$$;

revoke all on function auth.session_en_vigueur(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function auth.session_en_vigueur(uuid, uuid, timestamptz) to malica_api;
