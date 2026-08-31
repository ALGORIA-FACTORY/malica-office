# Prompts Claude Code — Vague 1 : fermer les brèches

**Source** : `docs/evaluation-architecture-base-2026-08-31.md`, section 8, vague 1.
**Objet** : les sept chantiers à mener avant toute mise en production chez un cabinet.

## Comment utiliser ces prompts

Un prompt = une session Claude Code = une branche = une migration. Ne les enchaîne pas dans une
seule session : chacun se termine par une vérification qui doit passer avant de commencer le
suivant.

**Ordre imposé.** P5 avant P3 (les clés étrangères doivent tenir avant qu'on ferme les droits, sinon
on ne peut plus réparer les données de banc). P1, P2, P4, P6, P7 sont indépendants entre eux.

```
P1 ─┐
P2 ─┤
P4 ─┼─► P5 ─► P3
P6 ─┤
P7 ─┘
```

**Colle systématiquement le bloc suivant en tête de chaque prompt.** Claude Code démarre sans
mémoire de nos échanges.

---

### Bloc de contexte commun (à coller en tête de chaque prompt)

```
Tu travailles sur le dépôt Regalica Office :
C:\Users\wisse\OneDrive\Bureau\ALGORIA Factory\Platefomre\Regalica Office\regalica-office

Lis AGENTS.md avant toute chose. Les dix règles R1 à R10 y sont exécutables : la CI échoue
si elles sont violées. Ton travail doit les respecter et, quand c'est possible, les rendre
plus vérifiables qu'elles ne le sont.

Règles de travail non négociables :
- Zéro hardcoding, zéro doublon, zéro stub, zéro placeholder. Un dossier vide en attente
  d'un futur travail est un placeholder.
- Aucune constante réglementaire dans le code TypeScript (R4). Tout taux, compte, seuil,
  mention, code devise ou code de juridiction vit en base, versionné par date d'effet.
- Une correction est une écriture nouvelle (R7). On ne réécrit pas un fait.
- Un échec bruyant vaut mieux qu'une adaptation silencieuse.

Convention de migration :
- Un seul fichier, dans db/migrations/, nommé AAAAMMJJHHMMSS_nom_en_francais_snake_case.sql
  (la dernière migration existante est 20260831180000_corpus_versions_editions.sql ; prends
  un horodatage postérieur).
- La migration doit être rejouable sur une base VIERGE et applicable sur une base EXISTANTE :
  utilise `if not exists`, `create or replace`, `drop policy if exists`.
- Elle commence par un commentaire qui dit ce qu'elle corrige, pourquoi, et ce qui se
  produisait avant. Écris-le pour un expert-comptable, pas pour un développeur.

Vérification obligatoire avant de dire que c'est fini — les trois, dans cet ordre :

  1. Rejeu complet sur une base neuve. Depuis la racine du dépôt, dans PowerShell :
       $env:PGPASSWORD = 'regalica_local_2026'
       $env:REGALICA_API_PASSWORD = 'api_local_2026'
       .\db\local\charger.ps1 -Base regalica_ci -Recreate
     Le rejeu doit se terminer avec ZÉRO ligne contenant "ERREUR" ou "ERROR".
     Il applique aujourd'hui 49 migrations et produit 88 tables, 54 vues, 220 politiques.
     Après ta migration, le compte de tables/vues/politiques doit être celui que tu attends,
     et tu dois le dire explicitement dans ton rapport.

  2. Audit des défauts :
       & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -U postgres -h localhost `
         -d regalica_ci -f db\verification\audit_defauts.sql
     Aucune section ne doit régresser.

  3. npm test  (puis npm run typecheck si tu as touché du TypeScript)

Ne dis jamais qu'un travail est terminé sans avoir exécuté ces trois étapes et collé leur
sortie réelle. Si une étape échoue, corrige — ne contourne pas, ne désactive pas un test.

Ne touche pas à regalica_local sans me le dire : c'est la base de travail. Fais tes essais
sur regalica_ci.
```

---

## P1 — Le mandat ne peut plus s'auto-attribuer

**Gravité : bloquant. C'est la faille la plus grave de la base.**

```
[BLOC DE CONTEXTE COMMUN]

## Le défaut

La politique d'insertion de identity.engagements est :

  WITH CHECK (
    app.has_org_role(pme_org_id,      ARRAY['dirigeant'])
    OR app.has_org_role(cabinet_org_id, ARRAY['expert'])
  )

Le second disjoint ne contrôle QUE le côté cabinet. pme_org_id n'est contraint par rien,
et status — dont le défaut est pourtant 'propose' — est librement positionnable à 'actif'.

Vérifié en conditions réelles : un utilisateur de rôle expert d'un cabinet peut insérer une
ligne désignant une organisation qu'il ne voit même pas (select count(*) from
identity.organizations where id = <cible> renvoie 0 pour lui), et le WITH CHECK passe.
engagements_upd porte le même prédicat en USING et en WITH CHECK : il peut aussi repointer
pme_org_id d'une ligne existante vers une autre organisation.

Conséquence : les 38 politiques contenant `tenant_id in (select app.engaged_orgs())`
s'ouvrent d'un coup — écritures, lignes d'écriture, relevés bancaires, pièces, factures,
paiements, contrats, coffre. Et une révocation de mandat n'est pas opposable : le cabinet
remet status='actif' lui-même. Il n'existe par ailleurs AUCUNE politique DELETE sur cette
table : le dirigeant de la PME ne peut pas rompre le lien.

## Ce que tu dois faire

Une migration qui :

1. Remplace engagements_ins par deux politiques distinctes :
   - le cabinet (rôle expert sur cabinet_org_id) ne peut créer qu'une PROPOSITION :
     status doit valoir 'propose' ;
   - le dirigeant de la PME (rôle dirigeant sur pme_org_id) peut créer directement.

2. Remplace engagements_upd par deux politiques :
   - le dirigeant de la PME peut tout faire évoluer, y compris activer ;
   - le cabinet ne peut faire évoluer le statut QUE vers 'suspendu' ou 'termine'.
     Il ne peut jamais activer.

3. Ajoute un déclencheur BEFORE UPDATE qui refuse tout changement de pme_org_id ou de
   cabinet_org_id après création. Une politique RLS ne voit pas OLD : ce contrôle ne peut
   pas être une politique, il doit être un déclencheur. Réutilise le style de message des
   déclencheurs existants (voir app.deny_mutation et socle.freeze_booked).

4. Ajoute une politique DELETE permettant au dirigeant de la PME de retirer une proposition
   qu'il n'a pas acceptée (status = 'propose' uniquement). Un engagement actif ou terminé ne
   se supprime pas : R7.

5. Contraint les deux côtés à leur nature : cabinet_org_id doit désigner une organisation
   kind='cabinet', pme_org_id une organisation kind='pme'. Aujourd'hui rien ne l'exige et un
   cabinet peut « s'engager » sur un cabinet concurrent (la base contient 72 organisations
   kind='cabinet'). Un déclencheur convient ; explique dans un commentaire pourquoi ce n'est
   pas une clé étrangère.

6. Ajoute le statut 'refuse' à engagements_status_check. Un appel refusé doit laisser une
   trace : c'est un fait, pas un vide.

## Le test qui doit exister ensuite

Dans apps/api/src/isolation.test.ts (ce fichier existe déjà — étudie sa forme et suis-la),
ajoute un test qui, sous un rôle authenticated réel :

- échoue si un expert parvient à insérer un engagement actif vers une organisation dont il
  n'est pas dirigeant ;
- échoue s'il parvient à faire passer un engagement de 'propose' à 'actif' ;
- échoue s'il parvient à repointer pme_org_id.

Ce test doit ÉCHOUER sur la base actuelle avant ta migration et PASSER après. Montre-moi les
deux exécutions.

## Ce que tu ne dois pas faire

- Ne déplace pas ce contrôle dans l'API. R6 : l'isolation est portée par la base. Un filtre
  applicatif oublié ouvre l'accès ; une politique oubliée le refuse.
- Ne supprime pas app.engaged_orgs() ni les 38 politiques qui l'utilisent. Le problème n'est
  pas la lecture du mandat, c'est qui décide de son existence.
```

---

## P2 — La confidentialité `vis` doit descendre aux tables filles

**Gravité : bloquant. Fuite latente de documents personnels vers le cabinet.**

```
[BLOC DE CONTEXTE COMMUN]

## Le défaut

Le modèle promet deux niveaux de visibilité : vis='personnel' (invisible au cabinet mandaté)
et vis='partage'. Ce contrôle est posé sur 7 tables racines et il est ABSENT de toutes leurs
tables filles — c'est-à-dire de celles qui portent réellement la donnée.

Comparaison verbatim :

  capture.pieces / capture_pieces_sel  (la porte est là)
    (tenant_id in (select app.member_orgs()))
    OR ((vis = 'partage') AND (tenant_id in (select app.engaged_orgs())))
    OR (select app.is_platform())

  capture.token_plan / capture_token_plan_sel  (la porte a disparu)
    (tenant_id in (select app.member_orgs()))
    OR (tenant_id in (select app.engaged_orgs()))
    OR (select app.is_platform())

capture.token_plan porte la colonne `text` : le texte OCR intégral de chaque page. Une pièce
marquée personnel disparaît de capture.pieces pour le cabinet, et son contenu reste lisible
mot pour mot.

Tables filles concernées, par racine :

  capture.pieces    → token_plan, citations, extractions, piece_versions, conformite
  socle.ecritures   → socle.ecriture_lignes            (les montants)
  banque.comptes    → releve_lignes, lettrages, rapprochements, lettrage_etat
  immo.assets       → dotations, depreciations, cessions
  stocks.items      → mouvements, inventaires, depreciations

capture.piece_articles a, elle, reçu sa propre colonne vis et sa politique la contrôle : la
règle était connue, elle n'a pas été généralisée.

La base contient déjà 340 pièces vis='personnel' réparties sur 210 tenants. Aucune n'a
encore de token_plan attaché : la fuite est structurelle et latente, elle s'ouvre à la
première pièce confidentielle passée à l'OCR.

## Ce que tu dois faire

1. Ne duplique PAS la colonne vis sur les douze tables filles. Ce serait une dénormalisation
   et la dérive serait garantie. La fille doit hériter de la porte de sa racine par un EXISTS
   sur la racine. Le motif correct existe déjà dans le dépôt : lis la politique
   pieces_storage_read_membre sur storage.objects, elle fait exactement cela.

2. Étends app.enable_tenant_rls (db/migrations/…_rls_enveloppe_is_platform.sql et
   …_enveloppe_politiques_identity.sql pour la forme actuelle) avec des paramètres décrivant
   la racine et la clé qui y mène, de sorte que le générateur produise lui-même la bonne
   politique. Le but est qu'une treizième table fille créée demain ne puisse pas oublier la
   porte.

3. Régénère les politiques de lecture des douze tables filles avec cette forme.

4. Vérifie que chaque table fille a un index utilisable par ce EXISTS (la clé qui mène à la
   racine : piece_id, ecriture_id, compte_id, asset_id, item_id). Ajoute ceux qui manquent.

## Le test qui doit exister ensuite

Un test qui parcourt le catalogue et ÉCHOUE dès qu'une table possède une clé étrangère vers
une table portant une colonne `vis` sans que sa politique SELECT ne mentionne cette racine.
Écris-le dans apps/api/src/schema.test.ts, dans le style des cinq tests structurels qui y
sont déjà (ils interrogent pg_attribute et pg_policy, pas information_schema — garde cette
discipline, information_schema ment par privilège).

Plus un test d'isolation réel : un cabinet mandaté ne doit voir aucune ligne de token_plan
appartenant à une pièce vis='personnel' de son client.

## Ce que tu ne dois pas faire

- N'ajoute pas de colonne vis aux tables filles.
- Ne relâche pas la porte sur les racines pour « simplifier ».
```

---

## P4 — Le grand livre ne se supprime plus

**Gravité : bloquant. R7 ne couvre aujourd'hui que UPDATE.**

```
[BLOC DE CONTEXTE COMMUN]

## Le défaut

Les trois déclencheurs de socle.ecritures sont TOUS des BEFORE UPDATE :
ecritures_assert_bookable, ecritures_freeze_booked, ecritures_touch. Aucun BEFORE DELETE.
Et la politique socle_ecritures_del est ouverte à tout membre du tenant, avec le privilège
DELETE accordé à authenticated.

Pire, le garde-fou des lignes est contourné par la cascade. socle.freeze_lignes() fait :

  select e.status into v_status from socle.ecritures e
    where e.id = coalesce(new.ecriture_id, old.ecriture_id);
  if v_status = 'booked' then raise exception 'R7 : ...'

combiné à ecriture_lignes_ecriture_id_fkey ... ON DELETE CASCADE. Pendant la cascade, la
ligne parente est déjà supprimée : le select ne ramène rien, v_status vaut NULL, et
NULL = 'booked' vaut NULL — donc faux. L'exception n'est jamais levée.

Une écriture comptabilisée et toutes ses lignes disparaissent, et audit.event_log ne
journalise aucune suppression (les seules actions enregistrées sont ecriture.proposed,
booked, validee, retournee).

Même défaut sur stocks.mouvements : ZÉRO déclencheur, alors que ses voisines
stocks.inventaires et stocks.depreciations sont protégées par app.deny_mutation. Modifier
rétroactivement un mouvement d'entrée change la valorisation de toutes les sorties
postérieures — donc le coût des ventes, donc le résultat — sans qu'aucune écriture
comptable ne bouge.

Ce mécanisme de cascade est déduit du code, pas exécuté. Commence par le PROUVER dans une
transaction annulée (BEGIN ... ROLLBACK) sur regalica_ci, et colle-moi la sortie. Si le
comportement diffère de ce que je décris, dis-le et adapte : je préfère être corrigé.

## Ce que tu dois faire

1. Corriger socle.freeze_lignes : le test doit être
   `if v_status is distinct from 'proposee' then raise ...`
   et non `if v_status = 'booked'`. Cela ferme la cascade ET tout statut futur qu'on
   ajouterait sans y penser. Un NULL doit refuser, jamais laisser passer.

2. Ajouter un BEFORE DELETE sur socle.ecritures qui refuse la suppression d'une écriture
   status='booked'.

3. Restreindre la politique socle_ecritures_del :
   using (status <> 'booked' and tenant_id in (select app.member_orgs()))

4. Ajouter BEFORE UPDATE OR DELETE sur stocks.mouvements avec app.deny_mutation. L'annulation
   d'un mouvement est un mouvement inverse, exactement comme la contre-passation.

5. Traiter socle_ecriture_propose. Cette fonction fait aujourd'hui :
       delete from socle.ecritures where piece_id = p_piece and status = 'proposee';
   C'est la seule suppression réelle de la base, elle n'a aucun filtre de tenant explicite
   et n'écrit rien dans audit.event_log. Reproposer une écriture détruit la proposition
   antérieure et les corrections manuelles d'un collaborateur, sans trace.
   Remplace la suppression par un passage à un statut 'remplacee' (élargis
   ecritures_status_check) et journalise 'ecriture.superseded' dans audit.event_log.
   Vérifie que les vues et les écrans qui lisent les propositions filtrent bien ce statut.

## Le test qui doit exister ensuite

Dans apps/api/src/refus.test.ts (il existe — suis sa forme), quatre cas :
- suppression directe d'une écriture booked → refusée ;
- suppression d'une écriture booked provoquant la cascade sur ses lignes → refusée ;
- update d'un stocks.mouvements → refusé ;
- reproposition sur une pièce → l'ancienne proposition existe toujours, en statut remplacee,
  et un événement ecriture.superseded a été écrit.

## Ce que tu ne dois pas faire

- Ne retire pas ON DELETE CASCADE de la clé étrangère : la cascade est correcte pour une
  écriture en brouillon. C'est le garde-fou qui est faux, pas la cascade.
```

---

## P5 — Les codes deviennent des clés étrangères

**Gravité : bloquant. Deux lignes du grand livre sont déjà fautives.**

```
[BLOC DE CONTEXTE COMMUN]

## Le défaut

Aucune clé étrangère ne protège socle.ecriture_lignes.account_code ni socle.ecritures.journal.
Résultat de la requête d'intégrité sur la base actuelle :

  COMPTES_INCONNUS   : account_code 43661 → 2 lignes
  JOURNAUX_INCONNUS  : journal VTE        → 1 écriture

Deux lignes sont imputées sur un compte qui n'existe dans aucun des 626 comptes de
ref.accounts, et une écriture sur un journal absent de ref.journals (ACH, BQ, OD, VEN).
Ces montants n'apparaîtront dans aucune balance, aucun état financier, aucune déclaration —
tout en restant dans une écriture parfaitement équilibrée. C'est la pire classe de bug
comptable : invisible et permanent.

L'origine du 43661 est dans le dépôt :
  apps/web/src/verticals/regalica-office/use-cases/__tests__/propose-ecriture.test.ts:21
    vatAccount: "43661",
C'est une valeur de fixture inventée. VTE ne figure nulle part dans le dépôt : il vient d'une
insertion manuelle. Corrige la fixture pour qu'elle utilise un compte réel du plan livré —
si le test échoue ensuite, c'est le test qui avait tort.

Deuxième défaut, même famille : la clé étrangère ecriture_lignes_ecriture_id_fkey ne porte
que sur id, pas sur (id, tenant_id). Comme l'intégrité référentielle contourne la RLS par
construction, ecriture_id peut désigner l'écriture d'un AUTRE tenant. Et assert_bookable est
security definer détenue par postgres (rolbypassrls = t) : sa somme de contrôle verrait les
lignes injectées que le tenant victime ne voit pas. Aujourd'hui zéro ligne divergente sur
31 049 — mais uniquement parce que personne n'a essayé.

Troisième défaut, même famille, côté capture : capture.citations.token_id est NOT NULL avec
une clé étrangère, mais rien ne garantit que le token appartienne à la même pièce ni au même
tenant. Test exécuté en transaction annulée : l'insertion d'une citation du tenant A, pièce A,
page 7, adossée à un token du tenant B, pièce B, page 1 a été ACCEPTÉE par la base. R2 est
donc vérifiée par une fonction (public.capture_read_persist) et pas par le schéma — et cette
fonction est security invoker, donc contournable. Le banc d'essai du dépôt
(db/verification/banc_essai.sql) la contourne déjà.

## Ce que tu dois faire

1. Réparer d'abord la fixture de test, puis les trois lignes fautives de regalica_ci — et
   dis-moi quoi faire des mêmes lignes dans regalica_local avant que la contrainte ne les
   rejette. Ne touche pas à regalica_local sans mon accord.

2. socle.ecritures.journal → clé étrangère vers ref.journals(code).

3. socle.ecriture_lignes.account_code → clé étrangère composite vers ref.accounts. La clé
   cible existe déjà : UNIQUE (pack_version_id, account_code). Il faut donc que la ligne
   porte pack_version_id. Deux voies, choisis et justifie :
   - dénormaliser pack_version_id sur la ligne, alimenté par déclencheur depuis l'écriture ;
   - ou UNIQUE (id, pack_version_id) sur l'écriture puis clé étrangère composite depuis la
     ligne.
   Attention : le plan comptable propre au cabinet vit dans parametrage.accounts (voir
   tiers.verifier_compte_collectif et parametrage.verifier_compte_cabinet). Une subdivision
   ouverte par un cabinet DOIT rester imputable. Si la cible de la clé étrangère ne couvre
   que le pack livré, les comptes maison seront rejetés — ce serait une régression grave.
   Propose une résolution unifiée (vue matérialisée, table de comptes effectifs, ou
   déclencheur de validation) et explique ton choix avant de coder.

4. ALTER TABLE socle.ecritures ADD UNIQUE (id, tenant_id), puis remplacer
   ecriture_lignes_ecriture_id_fkey par une clé étrangère composite (ecriture_id, tenant_id)
   → (id, tenant_id) ON DELETE CASCADE.

5. capture.citations : rendre la citation structurellement incapable de désigner le token
   d'une autre pièce. La clé cible existe déjà :
   token_plan_piece_id_page_ordinal_key UNIQUE (piece_id, page, ordinal).
   La voie la plus propre est d'ajouter `ordinal` à citations et de poser une clé étrangère
   (piece_id, page, ordinal) — piece_id étant alors partagé par la même ligne, la citation ne
   peut plus sortir de sa pièce. Variante si tu tiens à conserver token_id : UNIQUE
   (id, piece_id, tenant_id) sur token_plan et clé étrangère composite depuis citations.
   Choisis, justifie, et vérifie que les 97 000 citations existantes passent la contrainte.

6. Supprime l'index capture.token_plan_piece_idx (piece_id, page) : il est un préfixe strict
   de token_plan_piece_id_page_ordinal_key et ne peut jamais être préféré. Il coûte 1 Mo
   aujourd'hui et plusieurs Go à l'échelle cible.

## Le test qui doit exister ensuite

Dans apps/api/src/schema.test.ts, un test d'intégrité qui échoue si :
- une ligne d'écriture porte un account_code absent du plan effectif ;
- une écriture porte un journal absent de ref.journals ;
- une ligne porte un tenant_id différent de celui de son écriture ;
- une citation porte un token appartenant à une autre pièce ou à un autre tenant.

Ces quatre requêtes doivent tourner en CI et échouer le build. Deux d'entre elles remontent
déjà des anomalies que personne n'avait vues.

## Ce que tu ne dois pas faire

- Ne supprime pas les lignes fautives sans me le dire. Ce sont des données de banc, mais la
  décision de les effacer m'appartient.
- Ne relâche pas la contrainte pour faire passer une fixture. C'est la fixture qui a tort.
```

---

## P3 — Fermer les portes latérales sur les tables de faits

**Gravité : bloquant. C'est le chantier de fond — à faire APRÈS P5.**

```
[BLOC DE CONTEXTE COMMUN]

## Le défaut, énoncé une fois pour toutes

Les invariants métier de cette base sont écrits dans des fonctions PL/pgSQL, et les tables
qu'elles gardent restent ouvertes en écriture directe au rôle authenticated.

  Invariant                                    Où il est écrit                    Ce que authenticated a
  ─────────────────────────────────────────────────────────────────────────────────────────────────────
  Une citation pointe le token du montant (R2) public.capture_read_persist        INSERT/UPDATE/DELETE
                                               — security INVOKER                 sur capture.citations
  Le journal d'audit dit la vérité             app.deny_mutation (UPDATE/DELETE)  INSERT libre,
                                                                                  actor non contraint
  Un tenant ne dépasse pas son budget d'agents nulle part                         UPDATE sur sa propre
                                                                                  table agents.budgets

Une fonction security invoker n'apporte aucun privilège que l'appelant n'ait déjà : elle ne
peut donc rien interdire qu'il ne puisse faire sans elle. Elle documente une intention, elle
ne l'exécute pas. Preuve dans ce dépôt : db/verification/banc_essai.sql insère ses 97 000
citations en contournant capture_read_persist, sans intention malveillante — simplement parce
que rien ne l'en empêche.

## Ce que tu dois faire

1. Dresse d'abord l'INVENTAIRE, et montre-le-moi avant de coder : pour chaque table de faits
   (capture.citations, capture.token_plan, capture.extractions, capture.conformite,
   capture.piece_versions, socle.ecritures, socle.ecriture_lignes, audit.event_log,
   agents.agent_runs, agents.budgets, coffre.objects, sync.outbox), liste :
   - les privilèges DML réellement accordés à authenticated ;
   - tous les chemins d'écriture existants dans le code (apps/api, apps/web) : RPC, insert
     direct, PostgREST. Cherche les appels réels, ne suppose pas.
   Il faut savoir ce qu'on casse AVANT de révoquer.

2. Passe les fonctions d'écriture légitimes en security definer avec search_path figé
   (`set search_path = ''`), en suivant exactement la forme des fonctions app.* existantes,
   qui sont toutes correctement figées. Chaque fonction doit vérifier elle-même
   l'appartenance au tenant, comme le fait déjà billing.next_invoice_number :
     if not exists (select 1 from app.member_orgs() m where m = p_tenant) then raise ...

3. Révoque INSERT, UPDATE et DELETE à authenticated sur les tables de faits. La lecture reste
   ouverte, gouvernée par RLS.

4. Cas particuliers à traiter explicitement :
   - audit.event_log : retire l'INSERT direct. Le journal doit être écrit par des déclencheurs
     security definer posés sur les tables auditées, qui renseignent eux-mêmes actor, at et
     tenant_id depuis auth.uid(). Aujourd'hui un membre peut forger un événement attribué à un
     autre acteur, et un cabinet peut en forger dans le journal de son client.
   - agents.budgets : sort du périmètre d'écriture du tenant. Un tenant qui relève son propre
     plafond n'est pas un plafond. Ajoute un BEFORE INSERT sur agents.agent_runs qui refuse le
     run au-delà du cap.
   - capture_read_persist : passe-la en security definer. Attention, elle est aujourd'hui à
     usage unique — elle ouvre par un delete sur des tables protégées par deny_mutation, donc
     un second appel sur la même pièce avorte. Ne la corrige PAS ici : signale-le, c'est
     l'objet d'un chantier séparé (introduction d'une passe de lecture).

5. Mets à jour db/verification/banc_essai.sql pour qu'il passe par les fonctions, et non plus
   à côté. Si le banc ne peut pas passer par les fonctions, c'est un signal : dis-le-moi.

## Le test qui doit exister ensuite

Un test de catalogue qui échoue si authenticated détient INSERT, UPDATE ou DELETE sur l'une
des tables de faits listées. C'est la garantie que la porte ne se rouvrira pas par
inadvertance dans six mois.

## Ce que tu ne dois pas faire

- Ne révoque rien avant d'avoir l'inventaire du point 1 et mon accord dessus.
- Ne casse pas les écrans. Si un chemin d'écriture n'a pas d'équivalent en fonction, écris la
  fonction — ne laisse pas la table ouverte « en attendant ».
```

---

## P6 — Les trois oublis d'infrastructure

**Gravité : sérieux. Trois défauts indépendants, une seule migration.**

```
[BLOC DE CONTEXTE COMMUN]

## Défaut 1 — auth.users est sans RLS et regalica_api lit les mots de passe

  TABLES_SANS_RLS : auth.users, storage.buckets, storage.objects
  regalica_api | encrypted_password | INSERT, SELECT, UPDATE
  regalica_api | email              | INSERT, SELECT, UPDATE

449 comptes, aucune politique, un GRANT colonne direct au rôle de connexion.

L'identité applicative repose sur un GUC : auth.uid() lit
current_setting('request.jwt.claim.sub', true). Or tout rôle peut positionner un GUC. Une
seule injection SQL, n'importe où dans le code, suffit alors à usurper un compte, puis — par
RESET ROLE, qui ramène toujours au rôle de session regalica_api — à lire ou réécrire la table
des mots de passe. La qualité de l'isolation RLS est donc exactement égale à l'absence
d'injection SQL dans tout le code : c'est précisément ce que R6 dit vouloir éviter.

À faire :
- retirer SELECT et UPDATE sur encrypted_password à regalica_api ;
- faire passer vérification et changement de mot de passe par deux fonctions security definer
  à surface étroite, seules détentrices du droit ;
- activer enable + force row level security sur auth.users, avec une politique
  using (id = (select auth.uid())) pour authenticated.

## Défaut 2 — storage.objects : trois politiques écrites, RLS jamais activée

pg_class.relrowsecurity = false sur storage.objects. Les trois politiques
(pieces_storage_read_membre, _insert_membre, _delete_membre) sont INERTES. La première est la
mieux écrite de la base — elle honore vis et vérifie p.storage_path = objects.name — et elle
ne s'applique pas.

Aucune exposition aujourd'hui, faute de GRANT hors postgres. Mais le jour où l'extension de
stockage pose ses GRANT habituels à authenticated, le coffre à pièces devient intégralement
public entre tenants sans qu'une seule ligne de politique n'ait changé.

À faire : activer enable + force row level security sur storage.objects, et ajouter un test
de catalogue qui échoue si une table portant au moins une politique n'a pas relrowsecurity.
Ce test attrape aussi les régressions futures.

Note pour la même migration : 80 pièces ont un storage_path dont le premier segment n'est pas
leur tenant_id (exemple : essai/1788096925.pdf). Or l'isolation de storage.objects repose sur
split_part(name,'/',1)::uuid — sur ces chemins, la cast LÈVE au lieu de refuser. Ajoute
  check (storage_path like tenant_id::text || '/%')
sur capture.pieces, et corrige les 80 chemins de banc.

## Défaut 3 — app.platform_operators : un refus voulu qui ne tient que par accident

État : relrowsecurity = t, relforcerowsecurity = t, zéro politique, zéro GRANT, zéro ligne.
C'est un refus délibéré et correct.

Mais app.is_platform() ne le traverse que parce que postgres porte BYPASSRLS. force row level
security soumet le propriétaire à RLS : sans BYPASSRLS, une table sous force et sans politique
renvoie zéro ligne même au definer. Le jour où le schéma sera restauré sous un propriétaire
non-superutilisateur — c'est-à-dire le jour du durcissement en production — app.is_platform()
renverra false pour tout le monde, silencieusement, et les 38 disjoints
`or (select app.is_platform())` s'éteindront sans message d'erreur.

Le sens de la panne va vers la fermeture, donc pas de fuite — mais le support plateforme
perdra l'accès sans diagnostic possible.

À faire : poser une politique explicite
  create policy platform_operators_self on app.platform_operators
    for select to authenticated using (user_id = (select auth.uid()));
app.is_platform() devient alors indépendante du privilège du propriétaire.

Corrige aussi, par symétrie : auth.uid() et auth.role() sont restées en PUBLIC EXECUTE alors
que toutes les fonctions de app ont été verrouillées ({postgres=X, authenticated=X}).
Et trois tables sont sous RLS sans force — agents.model_pricing, collab.assignments,
collab.pv_reunions — les trois seules créées hors app.enable_tenant_rls.

## Le test qui doit exister ensuite

Dans schema.test.ts : toute table portant une politique a relrowsecurity ET
relforcerowsecurity ; aucune fonction de app ou auth n'est en PUBLIC EXECUTE.
```

---

## P7 — Une pièce a une empreinte, et son ancre ne bouge plus

**Gravité : bloquant en exploitation.**

```
[BLOC DE CONTEXTE COMMUN]

## Le défaut

1. capture.pieces.sha256 est NUL sur 100 % des 4 223 pièces. Il n'y a aucune déduplication
   par empreinte : la seule barrière est pieces_tenant_id_idempotency_key_key UNIQUE
   (tenant_id, idempotency_key), et cette clé est FOURNIE PAR LE CLIENT — c'est le nom du
   document source (voir ingest-push.ts). La même facture déposée deux fois sous deux noms
   crée deux pièces, deux plans de tokens, deux jeux de citations, et peut être comptabilisée
   deux fois. Pour un produit comptable, c'est le défaut le plus coûteux en exploitation.

2. capture.pieces ne porte que le déclencheur pieces_touch, et la politique
   capture_pieces_upd autorise le membre à écrire TOUTE la ligne — storage_path et sha256
   compris. Test exécuté en transaction annulée : le repointage d'une pièce vers
   « autre-tenant/piece-substituee.pdf » a été accepté.
   Toute la partie immuable de la chaîne — tokens, citations, extractions, écritures — pend
   donc à un pointeur mutable. On remplace le PDF derrière la pièce, on ne touche à aucune
   ligne protégée par R7, et les citations continuent de désigner des coordonnées dans un
   document qui n'existe plus. C'est exactement la falsification que R2 prétend interdire, et
   elle ne laisse aucune trace : audit.event_log ne journalise aucun piece.updated.

3. capture.piece_versions existe, est immuable, porte storage_path et sha256 en NOT NULL avec
   UNIQUE (piece_id, ordinal) — et compte ZÉRO ligne. Ni token_plan ni citations ne
   référencent une version : leurs colonnes sont piece_id, jamais piece_version_id.

## Ce que tu dois faire

1. sha256 devient NOT NULL sur capture.pieces, calculé côté API sur les octets reçus — jamais
   fourni par le client. Ajoute UNIQUE (tenant_id, sha256) et fais de la collision un cas
   métier explicite : l'API répond « pièce déjà présente » avec l'identifiant existant, ce
   n'est pas une erreur d'insertion.
   Traite les 4 223 pièces existantes : ce sont des données de banc, propose-moi soit un
   recalcul depuis le disque, soit une purge — et attends mon accord.

2. Ajoute un déclencheur BEFORE UPDATE sur capture.pieces qui refuse toute modification de
   storage_path ou de sha256. Une nouvelle numérisation devient une ligne piece_versions,
   jamais un UPDATE.

3. Rends capture.piece_versions obligatoire dès l'enregistrement : capture_piece_register doit
   poser l'ordinal 1. Une table immuable à zéro ligne dans un dépôt qui interdit les
   placeholders (R9) est soit à remplir, soit à supprimer — ici, à remplir.

4. Fais porter le plan de tokens sur la VERSION et non sur la pièce : ajoute
   piece_version_id à capture.token_plan et fais-le référencer capture.piece_versions.
   Vérifie l'impact sur les 97 000 lignes de banc et sur les lectures existantes.

5. Journalise piece.updated, piece.version_added et piece.deleted dans audit.event_log.
   Aujourd'hui 92 % des pièces n'ont aucun événement : quatre types d'action seulement sont
   enregistrés dans toute la base, pour 4 223 pièces.

6. Le stockage : trois mécanismes coexistent et aucun ne fonctionne — storage.objects (vide,
   RLS désactivée), coffre.objects (vide), et le disque, qui contient 3 fichiers pour 4 223
   pièces référencées. Tranche : coffre.objects est la bonne table (elle porte tenant_id,
   sha256, bytes, mime, deny_mutation et UNIQUE (bucket, path)) ; storage.objects est un
   vestige d'émulation Supabase. Propose-moi le plan de suppression du vestige avant de le
   supprimer — il est référencé par la politique la mieux écrite de la base, et par P6.

## Le test qui doit exister ensuite

- toute pièce a un sha256 et au moins une version ;
- l'update de storage_path ou de sha256 est refusé ;
- deux dépôts du même contenu sous deux noms différents produisent une seule pièce.
```

---

## Ce qui vient ensuite

Les vagues 2 à 4 de `docs/evaluation-architecture-base-2026-08-31.md` — l'exercice comptable et
la clôture, la numérotation chronologique, le référentiel daté et rejouable, la performance de
RLS, et la conception du modèle de facturation — feront l'objet de leurs propres prompts. Ne les
commence pas avant que la vague 1 ne soit close : chacune suppose que les brèches sont fermées et
que les invariants sont devenus vérifiables.
