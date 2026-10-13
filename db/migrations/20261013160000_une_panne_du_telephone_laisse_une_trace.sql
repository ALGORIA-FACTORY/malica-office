-- Une panne du téléphone laisse une trace, et cette trace est en base.
--
-- ================================================== LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 13 octobre 2026. Le dirigeant appuie sur « Générer le reçu », et « il ne se
-- passe rien ». La base ne contient aucun reçu — pas un seul — et son dossier
-- porte bien son matricule fiscal : l'échec est donc réel, et antérieur au
-- dépôt.
--
-- La raison existait, et elle a été perdue DEUX fois :
--
--   — le message s'affichait tout en bas de la section, sous la grille des
--     huit moyens, soit environ deux cent vingt pixels sous le bouton. Hors
--     écran sur un téléphone ;
--   — le journal qui l'aurait gardée ne tourne qu'en développement
--     (`apps/web/src/lib/journal-atelier.ts`, `import.meta.env.DEV`). Sur
--     l'application installée, il ne s'exécute jamais.
--
-- Conséquence : la seule façon de savoir ce qui a échoué sur l'appareil de
-- quelqu'un était de lui demander de photographier son écran. Ce n'est pas un
-- diagnostic, c'est une devinette à deux.
--
-- ============================================== POURQUOI UNE TABLE, ET LAQUELLE
--
-- Parce qu'une panne qu'on ne peut pas relire n'existe pas. Ce qui vit dans la
-- mémoire d'un navigateur disparaît au premier rechargement ; ce qui est en
-- base se relit, se compte, se date, et se compare d'une version à l'autre.
--
-- Table à part, et NON `audit.event_log` : celui-ci inscrit des faits
-- MÉTIER — une pièce transmise, une écriture comptabilisée — relus par les
-- écrans et par les contrôles. Y verser des piles d'appels JavaScript
-- mélangerait l'histoire d'un dossier et la santé d'un logiciel, et le volume
-- de la seconde noierait la première.
--
-- ================================================================== CE QU'ELLE PORTE
--
-- Le strict nécessaire pour reproduire, et rien de la pièce : l'endroit du
-- code, le message, la pile, la version de l'application et la plateforme. Un
-- message d'erreur peut citer une valeur ; on borne donc sa longueur, et on
-- n'y verse jamais de charge utile.

begin;

create table if not exists audit.journal_client (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  acteur      uuid not null default auth.uid(),

  -- L'endroit du code qui a signalé, tel que l'application le nomme :
  -- « components/malica/comment-c-est-paye ». C'est lui qui permet de
  -- retrouver le geste sans deviner.
  ou          text not null,
  message     text not null,
  -- La pile d'appels, quand elle existe. Absente d'un refus de l'API.
  pile        text,

  -- De quoi comparer deux versions : la panne de 0.2.12 n'est pas celle de
  -- 0.2.13, et une panne qui disparaît est une panne corrigée.
  version     text,
  plateforme  text,

  at          timestamptz not null default now(),

  -- Un journal n'est pas un dépotoir : une trace qui déborde est une trace
  -- qu'on ne lit plus, et une porte ouverte pour saturer la table.
  constraint journal_client_bornes check (
    length(ou) <= 200
    and length(message) <= 2000
    and (pile is null or length(pile) <= 8000)
    and (version is null or length(version) <= 50)
    and (plateforme is null or length(plateforme) <= 100)
  )
);

-- R6 : l'index mène par `tenant_id`. On lit toujours « les dernières pannes de
-- ce dossier », jamais « toutes les pannes ».
create index if not exists journal_client_tenant_idx
  on audit.journal_client (tenant_id, at desc);
-- Et par endroit : « ce geste échoue-t-il souvent, et depuis quand ? »
create index if not exists journal_client_ou_idx
  on audit.journal_client (tenant_id, ou, at desc);

-- Ajout seul (R7) : une trace qui se réécrit ne prouve rien. Et visibilité
-- fermée : une panne n'est pas une pièce, elle ne se transmet pas au cabinet.
select app.enable_tenant_rls('audit', 'journal_client', false, true);

create or replace view public.journal_client_v with (security_invoker = true) as
  select id, tenant_id, acteur, ou, message, pile, version, plateforme, at
    from audit.journal_client;

revoke all on table public.journal_client_v from public, anon, service_role;
grant select on table public.journal_client_v to authenticated;

-- ====================================================== CONSIGNER, SANS JAMAIS NUIRE
--
-- Signaler une panne ne doit pas en créer une seconde. La fonction tronque au
-- lieu de refuser : une pile trop longue est une pile coupée, pas une trace
-- perdue. Le seul refus possible est celui de la RLS — on n'écrit pas dans le
-- dossier d'un autre.

create or replace function public.journal_client_consigner(
  p_tenant uuid,
  p_ou text,
  p_message text,
  p_pile text default null,
  p_version text default null,
  p_plateforme text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into audit.journal_client (tenant_id, ou, message, pile, version, plateforme)
  values (
    p_tenant,
    left(coalesce(nullif(p_ou, ''), 'inconnu'), 200),
    left(coalesce(nullif(p_message, ''), 'sans message'), 2000),
    left(p_pile, 8000),
    left(p_version, 50),
    left(p_plateforme, 100)
  )
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public.journal_client_consigner(uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.journal_client_consigner(uuid, text, text, text, text, text)
  to authenticated;

comment on function public.journal_client_consigner(uuid, text, text, text, text, text) is
  'Inscrit une panne survenue sur l''appareil de quelqu''un. Tronque plutôt '
  'que de refuser : signaler une panne ne doit pas en créer une seconde.';

commit;
