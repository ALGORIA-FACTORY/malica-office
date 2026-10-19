-- ======================================================================
--  Un expert de cabinet inscrit une recette pour un dossier sous mandat
--  ACTIF — et ce n'est pas l'ecran qui le decide.
--
--  CE QUI CLOCHAIT. `docs/fabrique-de-lecteurs/02-ce-qui-est-livre.md`,
--  limite 7 : « Un expert de cabinet ne peut pas inscrire une recette pour
--  son mandat : la politique d'insertion exige l'appartenance. » Le helper
--  `app.enable_tenant_rls` ecrit toujours la meme politique d'ecriture —
--  `tenant_id in (select app.member_orgs())` — et un expert engage n'est pas
--  MEMBRE de son client : il est ENGAGE chez lui.
--
--  ====================================================== POURQUOI C'EST INCOHERENT
--
--  Une decision deja prise et deja en base dit le contraire : la lecture d'un
--  expert engage SE COMPTE SUR LA LICENCE DU CLIENT, parce que le cabinet
--  travaille pour le client. Celui qui lit les pieces est celui qui sait quel
--  format revient ; lui interdire d'en faire un lecteur revient a dire qu'il
--  peut depenser les lectures du client mais pas lui en economiser.
--
--  ============================================================== LES TROIS BORNES
--
--    MANDAT ACTIF. Pas propose, pas suspendu, pas echu. `app.engaged_orgs()`
--    porte deja cette regle : statut `actif`, debut passe, fin nulle ou
--    future. On ne la reecrit pas pour le plaisir — mais on ne la delegue pas
--    non plus a `engaged_orgs()` seul, et la raison est un cas precis : un
--    utilisateur expert dans le cabinet A (mandat suspendu sur P) et simple
--    collaborateur du cabinet B (mandat actif sur P) verrait son role chez A
--    servir un mandat porte par B. Le role et le mandat se lisent donc sur LA
--    MEME LIGNE d'engagement.
--
--    LA BASE REFUSE, PAS L'ECRAN (R6). Un filtre applicatif oublie OUVRE
--    l'acces ; une politique oubliee le REFUSE. Rien de ce qui suit n'est
--    verifie en TypeScript.
--
--    INSCRIRE N'EST PAS PROMOUVOIR. `fabrique.promotions` porte les deux :
--    la naissance (`candidate`) et les decisions qui engagent un resultat
--    (`evaluee`, `observation`, `active`, `suspendue`, `retiree`). L'expert
--    engage n'ecrit que la naissance. Promouvoir reste au dirigeant et a
--    l'expert DU DOSSIER, par la politique existante, qu'on ne touche pas.
--
--  ============================================ CE QUE CE FICHIER N'OUVRE PAS
--
--  Ni evaluation, ni execution, ni derive : ce sont des faits produits en
--  tournant, pas des inscriptions. Et pour `fabrique.travaux`, la seule
--  nature ouverte est `generation_recette` : un expert engage PROPOSE une
--  generation, il ne met pas une lecture en file — cette porte-la ne s'ouvre
--  pas en passant.
--
--  L'EXECUTION d'une generation, elle, reste au client, et la base le tient
--  deja sans qu'on ecrive une ligne : `public.agents_run_log` exige
--  `member_orgs()`, donc un expert engage ne peut pas journaliser un appel
--  paye. Une generation non journalisee est une depense qui disparait — ce
--  defaut a coute dix jours de mesures a ce depot. On laisse donc la base
--  refuser : l'expert propose, la file du client execute et paie.
-- ======================================================================

-- Le lanceur (db/migrer.mjs) ouvre deja la transaction : on n'en ouvre pas une seconde.

create or replace function app.engaged_orgs_as_expert()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id in (select app.member_orgs())
     and e.status = 'actif'
     and e.starts_on <= current_date
     and (e.ends_on is null or e.ends_on >= current_date)
     and app.has_org_role(e.cabinet_org_id, array['expert'])
$$;

revoke all on function app.engaged_orgs_as_expert() from public, anon;
grant execute on function app.engaged_orgs_as_expert() to authenticated;

comment on function app.engaged_orgs_as_expert() is
  'Les dossiers sur lesquels l''appelant est expert d''un cabinet au mandat '
  'ACTIF. Plus etroit que app.engaged_orgs() de deux crans : le role, et le '
  'fait que role et mandat se lisent sur la meme ligne d''engagement.';

-- ------------------------------------------------- Ce que l'expert engage INSCRIT
--
-- Des politiques EN PLUS, sous des noms qui n'appartiennent pas au helper :
-- `app.enable_tenant_rls` ne connait que les suffixes `_sel`, `_ins`, `_upd`,
-- `_del`, et un rejeu du helper ne les effacerait donc pas. PostgreSQL
-- applique les politiques d'une meme commande en OU : celle du membre
-- continue de valoir, mot pour mot.

drop policy if exists fabrique_recettes_ins_expert_engage on fabrique.recettes;
create policy fabrique_recettes_ins_expert_engage on fabrique.recettes
  for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs_as_expert()));

drop policy if exists fabrique_recette_versions_ins_expert_engage
  on fabrique.recette_versions;
create policy fabrique_recette_versions_ins_expert_engage on fabrique.recette_versions
  for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs_as_expert()));

drop policy if exists fabrique_exemples_ins_expert_engage on fabrique.exemples;
create policy fabrique_exemples_ins_expert_engage on fabrique.exemples
  for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs_as_expert()));

drop policy if exists fabrique_rve_ins_expert_engage on fabrique.recette_version_exemples;
create policy fabrique_rve_ins_expert_engage on fabrique.recette_version_exemples
  for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs_as_expert()));

-- La NAISSANCE, et elle seule. `etat = 'candidate'` n'est pas une politesse :
-- c'est la frontiere entre inscrire et promouvoir, et elle est dans le
-- predicat. Le cycle (fabrique.verifier_promotion) continue par ailleurs de
-- refuser « candidate » sur une version qui a deja un etat.
drop policy if exists fabrique_promotions_ins_expert_engage on fabrique.promotions;
create policy fabrique_promotions_ins_expert_engage on fabrique.promotions
  for insert to authenticated
  with check (etat = 'candidate'::fabrique.etat_t
              and tenant_id in (select app.engaged_orgs_as_expert()));

-- Proposer une generation : la mettre en file, pas l'executer.
drop policy if exists fabrique_travaux_ins_expert_engage on fabrique.travaux;
create policy fabrique_travaux_ins_expert_engage on fabrique.travaux
  for insert to authenticated
  with check (nature = 'generation_recette'::fabrique.travail_nature_t
              and tenant_id in (select app.engaged_orgs_as_expert()));

comment on policy fabrique_promotions_ins_expert_engage on fabrique.promotions is
  'Un expert de cabinet au mandat actif inscrit la NAISSANCE d''une recette '
  'chez son client. Promouvoir reste a fabrique_promotions_ins : le '
  'dirigeant ou l''expert du dossier.';
