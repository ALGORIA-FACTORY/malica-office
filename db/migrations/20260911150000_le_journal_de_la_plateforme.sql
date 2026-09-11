-- Le journal de la plateforme — les actes qui n'appartiennent à aucun tenant.
--
-- ==================================================================== POURQUOI
--
-- La remise à zéro du métier du 11 septembre 2026 devait s'inscrire dans la
-- piste d'audit. Mais `audit.event_log.tenant_id` est NOT NULL, et c'est
-- délibéré : tant qu'aucune ligne ne peut exister sans tenant, aucune ligne
-- ne peut échapper au cloisonnement de la RLS. Relâcher cette contrainte pour
-- un besoin unique l'aurait laissée ouverte pour toujours.
--
-- Un acte de plateforme n'a pas de tenant. Ce n'est pas une donnée manquante,
-- c'est une donnée qui n'existe pas. Il a donc sa table, et `event_log` n'est
-- pas touchée : R7 tient.
--
-- ==================================================================== CE QU'ELLE PORTE
--
--   horodatage          l'instant de l'acte ;
--   acte                son nom, en points : « plateforme.remise_a_zero_metier » ;
--   role_base           le rôle PostgreSQL qui l'a exécuté (session_user) ;
--   utilisateur_poste   l'utilisateur du système qui l'a lancé, fourni par
--                       l'appelant — la base ne le connaît pas autrement ;
--   detail              le récit, en jsonb : ce qui a été fait, et combien.
--
-- Le journal est immuable (R7) : ni mise à jour, ni suppression.
--
-- ==================================================================== QUI LE LIT
--
-- Les seuls opérateurs de plateforme (`app.is_platform()`). Aucun tenant.
--
-- POINT D'ORDRE : la remise à zéro vide `app.platform_operators`. Juste après
-- elle, `app.is_platform()` renvoie donc faux pour tout le monde, et PERSONNE
-- ne peut lire ce journal par l'application jusqu'à ce que l'opérateur soit
-- recréé (`node outils/operateur-plateforme.mjs <email>`, étape 3 du chantier,
-- une fois le nouveau compte ouvert par le parcours d'onboarding). L'écriture
-- n'est pas concernée : elle se fait en administration, hors RLS.
--
-- Aucune donnée n'est semée ici (R11) : les défauts de colonne sont du schéma.

create table if not exists audit.journal_plateforme (
  id                uuid primary key default gen_random_uuid(),
  horodatage        timestamptz not null default now(),
  acte              text not null check (acte ~ '^[a-z_]+(\.[a-z_]+)+$'),
  role_base         text not null default session_user,
  utilisateur_poste text not null check (length(btrim(utilisateur_poste)) > 0),
  detail            jsonb not null default '{}'::jsonb
);

comment on table audit.journal_plateforme is
  'Actes de plateforme, sans tenant par nature (remise à zéro du métier…). Immuable (R7). Lisible des seuls opérateurs de plateforme.';

create index if not exists journal_plateforme_horodatage_idx
  on audit.journal_plateforme (horodatage desc);

alter table audit.journal_plateforme enable row level security;
alter table audit.journal_plateforme force row level security;

revoke all on table audit.journal_plateforme from public;
revoke all on table audit.journal_plateforme from anon;
revoke all on table audit.journal_plateforme from authenticated;
grant select on table audit.journal_plateforme to authenticated;

drop policy if exists journal_plateforme_lecture on audit.journal_plateforme;
-- Enveloppée dans un `select` : PostgreSQL l'évalue une fois par requête, pas
-- une fois par ligne (convention vérifiée par apps/api/src/schema.test.ts).
create policy journal_plateforme_lecture on audit.journal_plateforme
  for select to authenticated
  using ((select app.is_platform()));

create or replace trigger journal_plateforme_immuable
  before update or delete on audit.journal_plateforme
  for each row execute function app.deny_mutation();
