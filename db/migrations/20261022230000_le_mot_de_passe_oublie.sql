-- Le mot de passe oublié (20 octobre 2026).
--
-- POURQUOI : un mot de passe perdu n'avait aucun recours — le dirigeant
-- d'ALGORIA Factory s'est trouvé hors de son propre compte sur staging. Une
-- demande émet un lien par courriel, valable une heure, une seule fois ; le
-- nouveau mot de passe est choisi par la personne, et toutes ses sessions
-- longues tombent.
--
-- Comme `auth.refresh_tokens` : hors RLS, seule l'empreinte SHA-256 du secret
-- est gardée, `authenticated` n'y voit rien. Une demande ne s'efface pas : elle
-- est utilisée, ou elle expire.
--
-- Idempotent.

create table if not exists auth.reinitialisations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  empreinte  text not null unique check (empreinte ~ '^[0-9a-f]{64}$'),
  cree_le    timestamptz not null default now(),
  expire_le  timestamptz not null,
  utilise_le timestamptz
);
create index if not exists reinitialisations_user_idx
  on auth.reinitialisations (user_id, cree_le desc);

revoke all on auth.reinitialisations from public, anon, authenticated;
grant select, insert, update on auth.reinitialisations to malica_api;

-- Changer le mot de passe : l'API le fait sous ses droits propres, comme
-- l'inscription.
grant update (encrypted_password) on auth.users to malica_api;
