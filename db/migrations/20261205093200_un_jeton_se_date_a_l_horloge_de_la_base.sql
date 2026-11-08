-- Un jeton d'accès se date à l'horloge de la base.
--
-- ================================================================== POURQUOI
--
-- `20261205093000` compare la date d'émission d'un jeton (`iat`) à l'instant où
-- toutes les sessions du compte ont été fermées (`sessions_invalidees_le`). La
-- fermeture était datée par la base, l'émission par l'API : deux horloges. Qu'elles
-- dérivent d'une milliseconde, et le jeton qu'ouvre une réinitialisation naît
-- « d'avant » sa propre fermeture — ou un jeton émis juste avant « partout » naît
-- « d'après » et lui survit.
--
-- ================================================================== CE QUI CHANGE
--
-- `auth.instant_d_emission(compte)` rend l'instant d'un jeton à émettre : l'horloge
-- de la base (`clock_timestamp()`, à la milliseconde, la précision du jeton), et
-- jamais avant la dernière fermeture du compte — le jeton qu'émet le geste même
-- qui ferme (la réinitialisation) tient. L'API le lit à chaque émission, dans la
-- transaction du geste : connexion, inscription, rafraîchissement (sous le verrou
-- du compte), réinitialisation.
--
-- REJEU (R11) : rien n'écrit dans une donnée de référence.

create or replace function auth.instant_d_emission(p_user uuid)
returns timestamptz
language sql
volatile
security invoker
set search_path = ''
as $$
  select greatest(date_trunc('milliseconds', clock_timestamp()), u.sessions_invalidees_le)
    from auth.users u
   where u.id = p_user
$$;

revoke all on function auth.instant_d_emission(uuid) from public, anon, authenticated;
grant execute on function auth.instant_d_emission(uuid) to malica_api;
