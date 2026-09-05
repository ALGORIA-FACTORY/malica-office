-- =====================================================================================
--  Regalica Office — Les jetons de rafraîchissement, et les signalements.
--
--  POURQUOI : le jeton d'accès dure douze heures parce qu'il n'est pas
--  révocable. Sur un téléphone, douze heures veulent dire un mot de passe à
--  retaper chaque matin — et une file hors ligne qui se vide la nuit tomberait
--  en 401. Le jeton long, lui, est révocable : il vit ici, par son empreinte,
--  et tourne à chaque usage. Un jeton volé ne vaut qu'un seul rafraîchissement.
--
--  Le secret n'est ni stocké ni relu : seule son empreinte SHA-256 l'est, comme
--  pour les clés d'API. Un jeton ne s'efface pas : il se révoque, et la ligne
--  dit par quel jeton il a été remplacé.
--
--  Le schéma `auth` est hors RLS, comme `auth.users` : le rôle de l'API y
--  travaille sous ses droits propres, avant toute identité. `authenticated` n'y
--  voit rien.
--
--  Les signalements sont ce que la personne envoie volontairement depuis
--  l'application — « ça n'a pas marché », avec où, sur quel appareil, quelle
--  version. Sous RLS : chacun dépose les siens, seul l'opérateur les lit.
--
--  Idempotent.
-- =====================================================================================

-- --- 1. Les jetons de rafraîchissement -----------------------------------------------
create table if not exists auth.refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- SHA-256 du secret, en hexadécimal. Le secret lui-même ne passe jamais ici.
  empreinte    text not null unique check (empreinte ~ '^[0-9a-f]{64}$'),
  -- Ce que le client a dit de lui (« coque-android/0.1.0 ») : pour reconnaître
  -- un appareil dans une liste, jamais pour décider d'un droit.
  appareil     text,
  cree_le      timestamptz not null default now(),
  expire_le    timestamptz not null,
  revoque_le   timestamptz,
  -- Le jeton émis à la place de celui-ci, quand il a tourné.
  remplace_par uuid references auth.refresh_tokens(id)
);
create index if not exists refresh_tokens_user_idx on auth.refresh_tokens (user_id, cree_le desc);

revoke all on auth.refresh_tokens from public, anon, authenticated;
grant select, insert, update on auth.refresh_tokens to regalica_api;

-- --- 2. Les signalements -------------------------------------------------------------
create table if not exists app.signalements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  -- Le dossier ouvert au moment du signalement, s'il y en avait un.
  tenant_id      uuid references identity.organizations(id) on delete set null,
  version_client text not null check (length(version_client) <= 120),
  appareil       text check (length(appareil) <= 300),
  ou             text check (length(ou) <= 200),
  message        text not null check (length(btrim(message)) between 1 and 2000),
  pile           text check (length(pile) <= 4000),
  piece_id       uuid,
  cree_le        timestamptz not null default now()
);
create index if not exists signalements_tenant_idx on app.signalements (tenant_id, cree_le desc);
create index if not exists signalements_cree_idx on app.signalements (cree_le desc);

alter table app.signalements enable row level security;
alter table app.signalements force row level security;
revoke all on app.signalements from public, anon, service_role;
grant select, insert on app.signalements to authenticated;

-- Chacun dépose les siens : la ligne porte l'identité de la session, pas
-- celle que le client prétend. Seul l'opérateur de la plateforme les relit.
drop policy if exists app_signalements_ins on app.signalements;
create policy app_signalements_ins on app.signalements
  for insert to authenticated
  with check (user_id = (select app.current_uid()));

drop policy if exists app_signalements_sel on app.signalements;
create policy app_signalements_sel on app.signalements
  for select to authenticated
  using ((select app.is_platform()));
