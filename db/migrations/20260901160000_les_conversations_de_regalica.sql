-- ============================================================================
-- Les conversations avec Regalica — gardées, nommées, privées.
-- ============================================================================
--
-- CE QUI SE PASSAIT AVANT
--
-- Rien ne restait. Une question posée à Regalica, sa réponse, et le fil
-- disparaissait au rechargement de la page. On ne pouvait pas revenir sur ce
-- qu'elle avait répondu la semaine passée, ni montrer à son comptable la
-- réponse qu'on avait reçue. Chaque échange repartait de zéro.
--
-- CE QUE CETTE MIGRATION POSE
--
-- Deux tables. Une conversation porte un titre et appartient à UNE personne,
-- sur UN dossier. Ses messages s'y accrochent dans l'ordre.
--
-- ============================================================ QUI PEUT LIRE
--
-- La personne qui a écrit, et elle seule. Pas ses associés, pas son cabinet,
-- pas le dirigeant si c'est le cabinet qui a écrit.
--
-- Ce n'est pas de la prudence excessive : on confie à Regalica des questions
-- qu'on ne pose pas devant tout le monde — « puis-je passer ce véhicule en
-- charge ? », « que risque-t-on si on déclare en retard ? ». Une conversation
-- visible par toute l'organisation serait une conversation qu'on n'a plus.
--
-- Deux conditions, et il faut les deux : être l'auteur, ET avoir encore accès
-- au dossier. Un cabinet dont le mandat est révoqué perd la lecture de ce
-- qu'il avait demandé sur ce dossier — le fil contient les chiffres du client.
--
-- ======================================================= POURQUOI PAS R7 ICI
--
-- R7 dit qu'une correction est une écriture nouvelle, et le produit refuse
-- d'effacer une écriture, une lecture, une citation. Ces tables-là portent des
-- FAITS COMPTABLES, et un fait ne se réécrit pas.
--
-- Une conversation n'est pas un fait comptable. C'est une note personnelle :
-- on doit pouvoir la renommer quand le titre tombe mal, et la supprimer quand
-- elle ne sert plus. Le déclencheur `app.deny_mutation` n'est donc PAS posé
-- ici, et c'est délibéré.
--
-- Ce qui reste malgré la suppression : `agents.agent_runs`, qui journalise
-- chaque appel avec son modèle, ses jetons et son coût — sans jamais porter le
-- texte. Effacer une conversation efface ce qui a été dit, jamais la trace de
-- ce que cela a coûté.
-- ============================================================================

create table if not exists agents.conversations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  -- L'auteur. `auth.uid()` par défaut : la colonne ne se remplit pas à la main,
  -- donc on ne peut pas écrire une conversation au nom de quelqu'un d'autre.
  created_by  uuid not null default auth.uid(),
  -- Regalica le propose après le premier échange ; il se renomme ensuite.
  -- Vide tant qu'elle n'a pas encore répondu.
  titre       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint conversations_titre_borne check (length(titre) <= 120)
);

create index if not exists conversations_sienne_idx
  on agents.conversations (created_by, tenant_id, updated_at desc);

create table if not exists agents.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references agents.conversations(id) on delete cascade,
  role            text not null,
  contenu         text not null,
  -- Le raisonnement du modèle, quand il le rend. Il n'est montré qu'au
  -- cabinet ; on le garde pour pouvoir relire comment une réponse est venue.
  raisonnement    text,
  -- De quoi retrouver ce qu'a coûté CE message, sans stocker un montant :
  -- le prix vit dans `agents.model_pricing`, versionné par date d'effet (R8).
  model           text,
  tokens_in       integer,
  tokens_out      integer,
  latency_ms      integer,
  created_at      timestamptz not null default now(),
  constraint conversation_messages_role_check check (role in ('user', 'assistant')),
  constraint conversation_messages_contenu_non_vide check (length(contenu) > 0)
);

create index if not exists conversation_messages_fil_idx
  on agents.conversation_messages (conversation_id, created_at);

-- L'horodatage de la conversation suit son dernier message : c'est ce qui
-- ordonne la liste, et une conversation ranimée doit remonter en tête.
create or replace function agents.toucher_conversation() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  update agents.conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists conversation_messages_touch on agents.conversation_messages;
create trigger conversation_messages_touch
  after insert on agents.conversation_messages
  for each row execute function agents.toucher_conversation();

alter table agents.conversations enable row level security;
alter table agents.conversations force row level security;
alter table agents.conversation_messages enable row level security;
alter table agents.conversation_messages force row level security;

-- ------------------------------------------------------------ la conversation
--
-- Le sous-appel est enveloppé dans un `select` : sans cette enveloppe, la
-- fonction est rejouée pour CHAQUE ligne examinée. Mesuré ailleurs dans cette
-- base : 194 436 blocs lus contre 2 438 une fois enveloppée.
drop policy if exists conversations_sel on agents.conversations;
create policy conversations_sel on agents.conversations for select to authenticated
  using (
    created_by = (select auth.uid())
    and (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()))
  );

drop policy if exists conversations_ins on agents.conversations;
create policy conversations_ins on agents.conversations for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()))
  );

-- Renommer, et rien d'autre : le déclencheur ci-dessous refuse de changer
-- d'auteur ou de dossier. Une politique ne voit pas OLD ; lui, si.
drop policy if exists conversations_upd on agents.conversations;
create policy conversations_upd on agents.conversations for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

drop policy if exists conversations_del on agents.conversations;
create policy conversations_del on agents.conversations for delete to authenticated
  using (created_by = (select auth.uid()));

create or replace function agents.conversation_immuable() returns trigger
language plpgsql set search_path to '' as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'une conversation ne change pas d''auteur'
      using errcode = 'check_violation';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'une conversation ne change pas de dossier'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists conversations_immuable on agents.conversations;
create trigger conversations_immuable
  before update on agents.conversations
  for each row execute function agents.conversation_immuable();

-- --------------------------------------------------------------- les messages
--
-- Ils n'ont ni auteur ni dossier propres : ils héritent de leur conversation
-- par un EXISTS. Recopier `created_by` sur chaque message serait une
-- dénormalisation, et la dérive serait garantie — un message dont l'auteur ne
-- correspond plus à celui du fil deviendrait lisible par la mauvaise personne.
drop policy if exists conversation_messages_sel on agents.conversation_messages;
create policy conversation_messages_sel on agents.conversation_messages
  for select to authenticated
  using (exists (select 1 from agents.conversations c where c.id = conversation_id));

drop policy if exists conversation_messages_ins on agents.conversation_messages;
create policy conversation_messages_ins on agents.conversation_messages
  for insert to authenticated
  with check (exists (select 1 from agents.conversations c where c.id = conversation_id));

drop policy if exists conversation_messages_del on agents.conversation_messages;
create policy conversation_messages_del on agents.conversation_messages
  for delete to authenticated
  using (exists (select 1 from agents.conversations c where c.id = conversation_id));

-- Un message ne se réécrit pas : on ne corrige pas après coup ce que Regalica
-- a répondu. Aucune politique UPDATE, donc aucun UPDATE possible.

grant select, insert, update, delete on agents.conversations to authenticated;
grant select, insert, delete on agents.conversation_messages to authenticated;
