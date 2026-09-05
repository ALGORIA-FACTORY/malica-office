-- ============================================================================
-- Les contrôles d'une réponse, et le verdict du comptable.
-- ============================================================================
--
-- CE QUI SE PASSAIT AVANT
--
-- On ne savait pas si Regalica s'améliorait. On avait des impressions : « elle
-- répond mieux qu'avant ». Aucun chiffre, donc aucun moyen de voir qu'un
-- réglage a cassé quelque chose — jusqu'à ce qu'un client le trouve.
--
-- CE QUE CETTE MIGRATION POSE
--
-- Deux tables, et elles se complètent exactement là où l'autre est aveugle.
--
-- `agents.reponse_controles` — ce que la MACHINE a vérifié. Chaque réponse
-- laisse une ligne par contrôle qui a cédé : article cité sans avoir été
-- transmis, édition périmée, portée d'une note commune passée sous silence,
-- chiffre sans provenance. C'est mécanique, gratuit, et ça tourne sur toutes
-- les réponses.
--
-- `agents.reponse_verdicts` — ce que l'HUMAIN a jugé. Un expert-comptable
-- marque une réponse juste ou fausse, d'un geste.
--
-- ================================================== POURQUOI LES DEUX
--
-- La machine attrape l'invention : un article qui n'existe pas, un montant
-- sorti de nulle part. Elle ne peut PAS attraper la réponse bien citée, bien
-- sourcée, en vigueur — et à côté de la question. Répondre 19 % en citant
-- l'article 7 sur une question de produits alimentaires passe tous les
-- contrôles au vert, et c'est faux : l'alimentaire est à 7 %.
--
-- La ligne la plus précieuse de tout le dispositif est donc celle où les
-- contrôles disent VERT et le comptable dit FAUX. Elle désigne l'angle mort.
-- C'est ce que la vue `agents.angles_morts` rend visible.
--
-- ======================================================= CE QUI N'EST PAS ICI
--
-- Le texte de la réponse. Il vit dans `agents.conversation_messages`, qui
-- appartient à son auteur et se supprime. Ces deux tables-ci ne portent que
-- des verdicts, et survivent donc à l'effacement d'une conversation — sans
-- jamais avoir conservé ce qui a été dit.
-- ============================================================================

create table if not exists agents.reponse_controles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  -- Le message jugé. Il peut disparaître : le verdict, lui, reste.
  message_id  uuid references agents.conversation_messages(id) on delete set null,
  -- Le contrôle qui a cédé, tel que le module le nomme.
  controle    text not null,
  -- retirer : c'est une invention · completer : il manque une incise ·
  -- signaler : c'est un doute sur NOTRE corpus, le cabinet le voit, pas le client.
  suite       text not null,
  detail      text not null,
  created_at  timestamptz not null default now(),
  constraint reponse_controles_suite_check check (suite in ('retirer', 'completer', 'signaler'))
);

create index if not exists reponse_controles_compte_idx
  on agents.reponse_controles (controle, created_at desc);

create table if not exists agents.reponse_verdicts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  message_id  uuid references agents.conversation_messages(id) on delete set null,
  -- Le geste du comptable, et rien d'autre.
  verdict     text not null,
  -- Ce qu'il aurait fallu répondre. Facultatif — mais c'est cette phrase-là
  -- qui transforme un « faux » en cas rejouable.
  attendu     text,
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint reponse_verdicts_verdict_check check (verdict in ('juste', 'faux')),
  -- Un seul verdict par personne et par message : on juge, on ne vote pas.
  constraint reponse_verdicts_unicite unique (message_id, created_by)
);

create index if not exists reponse_verdicts_tenant_idx
  on agents.reponse_verdicts (tenant_id, created_at desc);

-- Ni l'un ni l'autre ne se réécrit : un verdict qu'on peut retoucher ne mesure
-- plus rien. On se trompe, on en pose un nouveau — R7.
drop trigger if exists reponse_controles_no_upd on agents.reponse_controles;
create trigger reponse_controles_no_upd
  before update or delete on agents.reponse_controles
  for each row execute function app.deny_mutation();

alter table agents.reponse_controles enable row level security;
alter table agents.reponse_controles force row level security;
alter table agents.reponse_verdicts enable row level security;
alter table agents.reponse_verdicts force row level security;

-- Les contrôles se lisent par qui a accès au dossier — c'est un instrument de
-- cabinet, pas une donnée personnelle : ils ne portent aucun texte de réponse.
drop policy if exists reponse_controles_sel on agents.reponse_controles;
create policy reponse_controles_sel on agents.reponse_controles for select to authenticated
  using (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()));

drop policy if exists reponse_controles_ins on agents.reponse_controles;
create policy reponse_controles_ins on agents.reponse_controles for insert to authenticated
  with check (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()));

drop policy if exists reponse_verdicts_sel on agents.reponse_verdicts;
create policy reponse_verdicts_sel on agents.reponse_verdicts for select to authenticated
  using (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()));

drop policy if exists reponse_verdicts_ins on agents.reponse_verdicts;
create policy reponse_verdicts_ins on agents.reponse_verdicts for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()))
  );

grant select, insert on agents.reponse_controles to authenticated;
grant select, insert on agents.reponse_verdicts to authenticated;

-- ------------------------------------------------------------ l'angle mort
--
-- Les réponses que la machine a laissées passer et que l'humain a refusées.
-- C'est la liste de travail : chacune de ces lignes dit où les contrôles ne
-- suffisent pas, et donc quel contrôle reste à écrire.
create or replace view agents.angles_morts
with (security_invoker = true) as
select v.tenant_id,
       v.message_id,
       v.attendu,
       v.created_at,
       (select count(*) from agents.reponse_controles c where c.message_id = v.message_id) as controles_cedes
  from agents.reponse_verdicts v
 where v.verdict = 'faux'
   and not exists (
     select 1 from agents.reponse_controles c
      where c.message_id = v.message_id and c.suite = 'retirer'
   );

grant select on agents.angles_morts to authenticated;
