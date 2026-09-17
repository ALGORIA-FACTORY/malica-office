# État des lieux de Malica Office

Relevé fait le **14 septembre 2026**, en lecture seule. Le nom du fichier suit la demande (11 septembre), mais les chiffres datent du 14.

**Ce qui a été fait pour l'établir :**

- lecture du dépôt et de l'historique git ;
- lecture des workflows GitHub, de leurs exécutions et de leurs journaux (`gh`) ;
- requêtes sur les trois bases PostgreSQL du poste, toutes en `default_transaction_read_only=on` ;
- deux requêtes GET publiques sur le staging (`/sante`, `/sante/profonde`) ;
- lecture de code, dont deux lectures en largeur déléguées à des agents en lecture seule (l'API, et le parcours d'une pièce). Les passages concernés sont signalés comme « lecture de code ».

**Ce qui n'a pas été fait :**

- Aucun fichier du dépôt n'a été écrit, à part ce document.
- Aucune commande n'a écrit dans une base, et rien n'a été poussé ni commité.
- **Une tentative de connexion SSH en lecture au serveur de staging a été refusée par le garde-fou du poste.** Je ne l'ai pas contournée. Tout ce qui concerne la base vivante du staging est donc dans « Ce que je ne peux pas vérifier d'ici ».

---

## En une minute

1. **L'application Android publiée parle au staging.** Deux versions sont sur la piste de test interne de Google Play : 0.1.1 (construction 6, 7 sept.) et 0.2.0 (construction 7, 8 sept.). Aucune piste fermée, ouverte ou de production n'a été alimentée par la CI. Les deux versions interrogent le serveur de staging `116.203.144.94`, qui répond aujourd'hui sous ses deux noms.
2. **Ce staging se redéploie seul, migrations comprises, à chaque poussée sur `main` ou `application-android`.** L'environnement GitHub `staging` n'a aucune règle d'approbation.
   - Une fusion modifie donc, sans intervention humaine, la base qu'interroge l'application publiée.
   - La branche locale `application-android` porte 3 commits non poussés, dont une migration.
3. **Pilote et production n'existent pas.** Leurs noms de domaine ne résolvent pas, et leurs environnements GitHub n'existent pas.
4. **Aucune clé ni aucun jeton dans le dépôt ni dans son historique.** En revanche :
   - trois mots de passe de comptes d'essai sont en clair dans `main`, et au moins une partie de ces comptes a existé sur le staging ;
   - les clés réelles des modèles (DeepSeek, Qwen) sont dans `apps/api/.env`, dans un dossier synchronisé par OneDrive.
5. **Le parcours d'une pièce est écrit jusqu'à l'écriture comptable, mais :**
   - l'empreinte du fichier n'est jamais calculée ;
   - la confiance par champ n'est jamais remplie ;
   - la lecture n'est plus journalisée ;
   - aucun contrôle automatique ne rend de verdict ;
   - la proposition d'écriture est calculée dans le navigateur ;
   - le cabinet ne peut pas créer une PME cliente.
6. **Les deux épreuves de nuit échouent tous les jours depuis au moins le 9 septembre.** C'est une erreur de configuration (limite de connexions, 429) : la chaîne réelle avec les modèles n'est plus éprouvée par personne.

---

## 1. Le produit, tel qu'il est déployé

### 1.1 Les applications

| Application                                                           | Où dans le dépôt                                           | Comment elle se construit                                                               | Où elle est déployée                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **API** (Express, Node)                                               | `apps/api`                                                 | image Docker `infra/api.Dockerfile`, publiée sur GHCR par `images.yml`                  | staging seulement, conteneur `api` de `infra/compose.yml` derrière Caddy |
| **Interface web**                                                     | `apps/web`                                                 | image Docker `infra/web.Dockerfile` (même chaîne)                                       | staging seulement, conteneur `web`                                       |
| **Application Android** (coque Capacitor qui embarque le bundle web)  | `android/` (projet Gradle), `apps/web/capacitor.config.ts` | `android.yml` : bundle web `build:coque:<cible>`, `cap sync`, AAB signé, envoi sur Play | Google Play, piste interne                                               |
| **Mise à jour en vol** du bundle web                                  | `apps/web`                                                 | `ota.yml` sur étiquette `web-v*` : envoi Capgo                                          | Capgo, canal `staging`                                                   |
| **Sauvegarde**                                                        | `infra/sauvegarde`                                         | image Docker (même chaîne)                                                              | staging, conteneur `sauvegarde`                                          |
| **Outils** (jeu de données, épreuves, captures, opérateur plateforme) | `outils/`, `db/`                                           | scripts Node lancés à la main ou par la CI                                              | nulle part : ils tournent sur le poste ou dans la CI                     |

### 1.2 L'application Android sur Google Play

Il y a eu **deux applications distinctes** sur Play, car l'identifiant a changé le 8 sept. :

| Version | versionCode | Identifiant                   | Date d'envoi      | Piste       | API embarquée                                         | Preuve                                                      |
| ------- | ----------- | ----------------------------- | ----------------- | ----------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| 0.1.0   | 1           | `com.algoriafactory.regalica` | 6 sept.           | interne     | ?                                                     | envoi manuel selon `docs/versions.md` (pas de journal CI)   |
| 0.1.1   | 2           | `com.algoriafactory.regalica` | 7 sept.           | interne     | ?                                                     | envoi manuel selon `docs/versions.md`                       |
| 0.1.1   | **6**       | `com.algoriafactory.regalica` | 7 sept. 13:52 UTC | **interne** | `https://staging.regalica-office.algoria-factory.com` | exécution CI n° 34129382807 (run_number 4), voir ci-dessous |
| 0.2.0   | **7**       | `com.algoriafactory.malica`   | 8 sept. 12:03 UTC | **interne** | `https://staging.malica-office.algoria-factory.com`   | exécution CI n° 34223423462 (run_number 5), voir ci-dessous |

**D'où viennent ces valeurs :**

- **versionCode.** `android.yml` le calcule comme `github.run_number + DECALAGE_VERSION` avec `DECALAGE_VERSION: 2`, soit 4+2 = 6 et 5+2 = 7.
- **Piste et cible.** Elles sont lues dans les journaux des deux exécutions :
  ```
  CIBLE: staging   SAVEUR: pilote   PISTE: internal
  Validating tracks: 'internal'
  Uploading android/app/build/outputs/bundle/piloteRelease/app-pilote-release.aab
  Successfully committed 15053093202431606611          (8 sept.)
  Successfully committed 11379248916821527662          (7 sept.)
  ```
- **Version.** Elle vient de `package.json` au commit construit : `e24a96f` donne `"version": "0.2.0"`, `efc86ce` donne `"version": "0.1.1"`.
- **Identifiant.** `git show efc86ce:android/app/build.gradle` donne `applicationId "com.algoriafactory.regalica"`. Aujourd'hui, le fichier dit `com.algoriafactory.malica`.
- **Adresse de l'API.** Elle est lue dans le fichier de build **au commit construit**, pas dans un fichier local :
  - `git show efc86ce:apps/web/.env.coque-staging` donne `VITE_API_URL=https://staging.regalica-office.algoria-factory.com` ;
  - `git show e24a96f:apps/web/.env.coque-staging` donne `VITE_API_URL=https://staging.malica-office.algoria-factory.com`.
- **Saveur.** Les deux AAB sont de saveur `pilote` : nom affiché « Malica (pilote) ». Ils visent pourtant le **staging**, comme le prévoit `android.yml` tant que le pilote n'existe pas.

**Aucune exécution n'a visé les pistes `alpha` ou `production`.** Les 5 exécutions de `android.yml` sont listées : 2 réussies, les deux en `internal`, et 3 échecs.

### 1.3 La mise à jour en vol

Cinq bundles web sont partis sur le canal Capgo `staging` : 0.1.1, 0.1.2 et 0.1.3 le 7 sept., 0.2.0 et 0.2.1 le 8 sept. Toutes les exécutions de `ota.yml` sont réussies, sauf la première tentative de 0.1.1.

- Le dernier, 0.2.1 (commit `9a67a65`), a été envoyé à l'application `com.algoriafactory.malica`. Journal : `console.capgo.app/app/com.algoriafactory.malica/channel/46880`.
- Il embarque la même adresse `staging.malica-office…`.

### 1.4 Les deux noms du staging répondent

```
GET https://staging.malica-office.algoria-factory.com/sante           -> 200 {"etat":"ok"}
GET https://staging.regalica-office.algoria-factory.com/sante         -> 200 {"etat":"ok"}
GET https://…malica-office…/sante/profonde   {"etat":"ok","version":"application-android","base":"ok","stockage":"ok"}
GET https://pilote.malica-office.algoria-factory.com/sante            -> Could not resolve host
GET https://app.malica-office.algoria-factory.com/sante               -> Could not resolve host
```

Les deux noms répondent. La variable GitHub `DOMAINE` de l'environnement staging vaut encore `staging.regalica-office.algoria-factory.com`, et `infra/compose.yml` prévoit un `DOMAINE_ALIAS` pour servir un second nom le temps d'une bascule. **Si l'alias est retiré sur le serveur, la construction 6 (0.1.1, ancienne application) ne joint plus son API.**

### 1.5 Versions installées et contrat attendu

**Chez qui.** Seuls les testeurs de la piste interne peuvent l'avoir installée. Leur nombre n'est pas lisible d'ici. `docs/versions.md` mentionne un « téléphone de test ».

**Version en service.** Vraisemblablement :

- l'application `com.algoriafactory.malica` 0.2.0 (7), avec le bundle en vol 0.2.1 ;
- éventuellement l'ancienne `com.algoriafactory.regalica` 0.1.1 (6), avec le bundle 0.1.3.

**Contrat.** L'application appelle `/auth/*`, `/rpc`, `/moi`, `/pieces`, `/pieces/:id/contenu` et `/malica/*`, avec l'en-tête `X-Malica-Client: coque-android/<version>` (`apps/web/src/capabilities/coque.ts:37-43`). La version vient de `apps/web/vite.config.ts:80`.

**Refus d'une version trop ancienne.** Le serveur répond 426 « mise à jour requise » si `CLIENT_MIN_VERSION` est renseignée (`apps/api/src/session.ts:83-103`). Elle est vide par défaut dans `infra/compose.yml`. Sa valeur réelle sur le staging n'est pas vérifiable d'ici.

**Changements depuis 0.2.0.** Une migration (`20260908120000_le_type_de_la_piece_se_confirme.sql`), puis les 3 commits du solveur des montants sur le serveur. Ces derniers ne changent pas les routes (lecture du diff, §5).

---

## 2. Les environnements et leurs bases

### 2.1 Tableau

| Environnement                 | Base                                                                                            | Hôte                                                                                                         | Qui y écrit                                                                            | Qui la déploie                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Poste : travail               | `malica_local` (615 Mo)                                                                         | `localhost:5432`, PostgreSQL 17.11                                                                           | l'API locale (`apps/api/.env`), les scripts du poste                                   | à la main (`node db/migrer.mjs`)                                          |
| Poste : tests                 | `malica_test` (18 Mo)                                                                           | `localhost:5432`                                                                                             | `npm test` d'`apps/api` (garde `garde-base-de-test.ts`)                                | `npm run base-de-test`                                                    |
| Poste : ancienne vérification | `regalica_verif` (16 Mo)                                                                        | `localhost:5432`                                                                                             | personne depuis le 31 août (voir 2.4)                                                  | inconnu : base montée par psql avant l'exécuteur de migrations            |
| CI                            | `malica` (jetable)                                                                              | conteneur de service GitHub                                                                                  | les jobs `api`, `epreuves`, les nuits                                                  | `ci.yml`, `epreuve-reelle.yml`, `android-e2e.yml`                         |
| **Staging**                   | **`malica`** (lu dans `infra/compose.yml` : `POSTGRES_DB: malica` ; non vérifié sur la machine) | Hetzner `116.203.144.94`, conteneur `postgres`, non publié (`provisionner.sh` : ufw n'ouvre que 22, 80, 443) | l'API du staging (rôle `malica_api`), les applications installées, le service `migrer` | `images.yml`, job `staging`, automatique                                  |
| Pilote                        | n'existe pas                                                                                    | —                                                                                                            | —                                                                                      | `deployer.yml` (manuel) ; l'environnement GitHub `pilote` renvoie 404     |
| Production                    | n'existe pas                                                                                    | —                                                                                                            | —                                                                                      | `deployer.yml` (manuel) ; l'environnement GitHub `production` renvoie 404 |

### 2.2 Ce que contiennent les bases du poste

Comptages exacts (`count(*)` table par table) :

|                                     |          `malica_local` | `malica_test` |               `regalica_verif` |
| ----------------------------------- | ----------------------: | ------------: | -----------------------------: |
| comptes (`auth.users`)              |                   **0** |            13 |                              0 |
| organisations                       |                   **0** |             7 |                              0 |
| pièces (`capture.pieces`)           |                   **0** |             6 |                              0 |
| fichiers (`storage.objects`)        |                       0 |             0 |                              0 |
| journal d'audit (`audit.event_log`) |                       0 |            15 |                              0 |
| journal de plateforme               |    1 (la remise à zéro) |             0 |                  table absente |
| migrations appliquées               |                  **96** |        **96** | table `app.migrations` absente |
| écart avec le dépôt (96 fichiers)   | **aucun** (`diff` vide) |     **aucun** |                  non mesurable |

**Données de vraies personnes.**

- `malica_local` : aucune donnée métier. La purge du 11 sept. l'a vidée.
- `malica_test` : ses 13 comptes sont tous `@essai.local`. Ses 7 organisations s'appellent `ESSAI … 1789140378…`, laissées par les tests.
- `regalica_verif` : aucun compte.
- **Ailleurs sur le poste**, il reste des traces possibles de données réelles :
  - `db/sauvegardes/` : 15 dumps, 1,1 Go. Celui du 11 sept. contient les 1 089 comptes d'avant la purge, dont 1 075 `@essai.local` (audit de l'étape 0). Les 14 autres ont des domaines comme `@bensalah.tn` ou `@sotumag.tn`.
  - `.stockage.avant-remise-a-zero-20260911/` : 36 fichiers de pièces.
  - Des factures « réelles » tirées d'un jeu public Kaggle ont servi aux épreuves (`docs/epreuve-factures-reelles-2026-08-31.md`). Je ne sais pas si certaines sont parmi ces 36 fichiers.
- Le corpus juridique contient des textes de loi publics, pas des données personnelles.

**Corpus juridique**, les cinq compteurs :

|                  | articles | versions | fragments |      sondages | banque de cas |
| ---------------- | -------: | -------: | --------: | ------------: | ------------: |
| `malica_local`   |   11 440 |   16 183 |    31 863 |        12 101 |           667 |
| `malica_test`    |        0 |        0 |         0 |             0 |             0 |
| `regalica_verif` |        0 |        0 |         — | table absente | table absente |

`malica_local` est identique aux chiffres de l'audit de l'étape 0.

### 2.3 Le staging

Rien de sa base n'a pu être lu depuis le poste (voir « Ce que je ne peux pas vérifier d'ici »).

**Ce qui est établi sans y entrer :**

- **Branche servie.** Le dernier déploiement réussi date du 10 sept. à 14:51 UTC : `▶ dépôt → application-android` / `975eaa7`, journal du job `staging` de l'exécution 34491595511. `/sante/profonde` répond aujourd'hui `"version":"application-android"`.
- **Migrations appliquées.** L'arbre `origin/application-android` porte **94 migrations**. Le service `migrer` les joue toutes avant de démarrer l'API. Sauf intervention manuelle, la base du staging en a donc vraisemblablement 94 : 2 de moins que le poste (`20260911150000` et `20260911160000`).

### 2.4 `regalica_verif`

- Elle a été créée le 31 août, date de création de son `PG_VERSION` : `2026-08-31 13:02:31`.
- Elle est citée dans `docs/etat-de-la-base-2026-08-31.md:5` comme « base neuve » de vérification.
- Elle n'a pas de table `app.migrations`, et elle a encore `sync.outbox`, supprimé depuis par la migration `20260905230000`.
- C'est un reste, que personne ne lit.
- Le fichier `pgpass.conf` du poste porte encore un rôle `regalica_api` qui n'existe plus.

### 2.5 Pour accéder à la base du staging

Une clé administrateur existe sur le poste (`~/.ssh/malica-serveur`, commentaire `regalica-serveur`). `docs/exploitation.md` la décrit.

Il faudrait que vous autorisiez explicitement une session SSH en lecture, par exemple :

```
ssh root@116.203.144.94 'cd /srv/malica/depot/infra && docker compose --env-file /srv/malica/.env exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U postgres -d malica -c "…"'
```

Ou que vous la lanciez vous-même.

---

## 3. La chaîne de déploiement

### 3.1 Qui déclenche quoi

| Événement                                       | Workflow et job                                                                    | Cible                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| toute poussée, toute branche, et toute PR       | `ci.yml` : `atelier`, `web`, `api`, `epreuves`                                     | base jetable de la CI, **aucun déploiement**   |
| **poussée sur `main` ou `application-android`** | `images.yml` : `publier` (3 images GHCR), puis **`staging`**                       | **le serveur de staging**                      |
| étiquette `v*`                                  | `images.yml` : `publier` seulement (`staging` exige `github.ref_type == 'branch'`) | images GHCR                                    |
| manuel                                          | `deployer.yml` (pilote ou production, étiquette `v*`)                              | environnements inexistants                     |
| étiquette `android-v*` ou manuel                | `android.yml`                                                                      | Google Play (piste `internal` par défaut)      |
| étiquette `web-v*` ou manuel                    | `ota.yml`                                                                          | Capgo (canal `staging` par défaut)             |
| chaque nuit 02:17 UTC, ou manuel                | `epreuve-reelle.yml`                                                               | base jetable, avec les vraies clés des modèles |
| chaque nuit 02:47 UTC, ou manuel                | `android-e2e.yml`                                                                  | émulateur et base jetable                      |

**Le commentaire d'en-tête d'`images.yml` est faux.** Il dit « sur main seulement, le staging se déploie tout seul », alors que le déclencheur est `branches: [main, application-android]`.

### 3.2 Les migrations sur le staging

- **Moment.** À chaque déploiement, `infra/deployer.sh` lance `compose up -d`. Le service `migrer` de `infra/compose.yml` joue alors `node db/migrer.mjs --mot-de-passe-api`. L'API et le site attendent sa fin : `condition: service_completed_successfully`.
- **Droits.** Superutilisateur : `DATABASE_URL_ADMIN: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/malica`.
- **Garde-fous de `db/migrer.mjs`.**
  - Une migration déjà appliquée dont l'empreinte a changé arrête tout.
  - `--forcer` n'est pas passé par `compose.yml`.
  - Chaque fichier absent est joué dans une transaction.
- **Pas de retour arrière du schéma.** `deployer.sh` le dit : « tant que les migrations restent expansion puis contraction ».
- **Chaîne d'appel.** Job `staging` d'`images.yml`, puis `ssh malica@$HOTE "deployer $BRANCHE"`, puis `porte-ssh.sh` (qui n'accepte que `deployer <version>`), puis `deployer.sh`.

### 3.3 Une fusion peut-elle modifier la base de l'application publiée sans intervention humaine ?

**Oui.**

- `.github/workflows/images.yml` : `on: push: branches: [main, application-android]`, puis le job `staging` exécute `ssh … "deployer $BRANCHE"`, qui joue les migrations (`infra/compose.yml`, service `migrer`).
- L'application publiée interroge ce staging (§1.2).
- L'environnement GitHub `staging` n'a **aucune règle de protection** : `gh api …/environments` renvoie `staging règles=` vide.
- La protection de branche n'est pas disponible sur ce dépôt privé au plan actuel (`HTTP 403 Upgrade to GitHub Pro`).
- Rien n'impose donc une relecture avant une poussée sur `main`.

**Conséquence immédiate.** La branche locale `application-android` est 3 commits devant `origin/application-android` : `b438b74`, `5c38ada`, `eb68c9c`. Ils contiennent la migration `20260911150000_le_journal_de_la_plateforme.sql` et le script de purge. **La pousser déploierait le staging et y créerait `audit.journal_plateforme`.**

- La purge elle-même ne s'y exécuterait pas. Elle n'est pas jouée par le déploiement et refuse toute base autre que `malica_local`.
- Pousser `chantier/remise-a-zero-metier` ne déclenche rien de tel.

### 3.4 Sauvegardes

**Staging, selon la configuration (lecture de code) :**

- conteneur `sauvegarde` (`infra/sauvegarde/crontab`) ;
- dump toutes les six heures, envoyé chiffré par restic sur la Storage Box `u664122.your-storagebox.de:23`, avec les pièces ;
- rétention le dimanche, `restic check` le 1er du mois ;
- signal de vie vers `SAUVEGARDE_SIGNAL_URL` s'il est renseigné.

**Répétitions de restauration.** Une seule est consignée dans `docs/exploitation.md` (registre) : `2026-09-06 | staging | dump malica-20260906-175133 (365 Mio) | 98 s | 112 tables`. Le même document pose que « une répétition de plus de trente jours est un critère rouge ».

**Non vérifiable d'ici :**

- que le conteneur tourne ;
- que des instantanés récents existent ;
- que le signal est surveillé.

**Poste :**

- `db/sauvegardes/` contient 15 dumps faits à la main, du 31 août au 11 sept. ;
- celui du 11 sept. a été relu et vérifié à l'étape 1 ;
- rien d'automatique.

---

## 4. Ce à quoi on est exposé

Classé par gravité. Rien n'a été corrigé.

| #   | Gravité   | Constat                                                                                                                                                                                                                                                                                                                                                                                                                                      | Où, depuis quand                                                                                                                                                                                                                                                                                                         | Dans l'APK ?                                                                                                                                                                                                                 |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Haute** | **Déploiement automatique, avec migrations en superutilisateur, sur la base qu'interroge l'application publiée**, sans approbation. S'y ajoutent 3 commits locaux non poussés sur `application-android`, dont une migration                                                                                                                                                                                                                  | `images.yml` ; `application-android` locale +3                                                                                                                                                                                                                                                                           | non (serveur)                                                                                                                                                                                                                |
| E2  | **Haute** | **Mots de passe de comptes d'essai en clair dans `main`**. Au moins un de ces comptes a ouvert une session sur le staging, qui est joignable depuis Internet : `leila.bensalah@bensalah.tn` lors de la session du 10-11 sept. Ils ne sont pas revérifiés aujourd'hui. Les domaines utilisés (`bensalah.tn`, `sotumag.tn`, `medina-textile.tn`) ressemblent à de vrais domaines tunisiens, et `sotumag` est le nom d'une vraie société        | `JeuDeDonnees2026!` depuis `9a810e4` (5 sept.), dans 4 fichiers de `origin/main` (`outils/jeu-de-donnees.mjs:63`, `apps/web/e2e/comptes.ts:7`, `outils/captures.mjs:41`, `android/maestro/connexion.yaml:15`). `EpreuveMalica2026!` et `DeveloppeurMalica2026!` depuis `b638cff` (8 sept.), dans `outils/epreuves/*.mjs` | **non** : `git grep` sur `apps/web/src` et `packages/socle/src` ne trouve ni adresse ni mot de passe d'essai ; le bundle ne lit que `VITE_API_URL`, `VITE_CANAL_OTA`, `VITE_CIBLE`, `VITE_SENTRY_DSN`, `VITE_VERSION_CLIENT` |
| E3  | **Haute** | **Clés réelles des modèles (DeepSeek, Qwen) et mot de passe administrateur de la base locale dans `apps/api/.env`, dans un dossier OneDrive.** Le processus OneDrive tourne sur le poste. Les dumps (1,1 Go) et les pièces d'avant la purge sont au même endroit. Le fichier est bien ignoré par git (`.gitignore:3`). `docs/exploitation.md` range volontairement les jetons Hetzner et GitHub « hors OneDrive » ; ces clés-ci n'y sont pas | poste                                                                                                                                                                                                                                                                                                                    | non                                                                                                                                                                                                                          |
| E4  | Moyenne   | **Inscription publique sans vérification d'adresse** sur le staging. N'importe qui peut créer un compte, puis une organisation par l'écran d'accueil (`create_organization`), à raison de 30 essais par minute par IP (lecture de code)                                                                                                                                                                                                      | `apps/api/src/app.ts:156`, `apps/api/src/auth.ts:70-76`                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                            |
| E5  | Moyenne   | **`/sante/profonde` est public, sans limite, et écrit un fichier témoin sur le disque à chaque appel.** Il révèle aussi la branche déployée (`"version":"application-android"`, constaté)                                                                                                                                                                                                                                                    | `apps/api/src/app.ts:349`, `apps/api/src/stockage.ts:184-191`                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                            |
| E6  | Moyenne   | **Deux noms pour un serveur**, dont l'ancien porté par la variable `DOMAINE` de GitHub. L'ancienne application (construction 6) en dépend                                                                                                                                                                                                                                                                                                    | §1.4                                                                                                                                                                                                                                                                                                                     | oui : adresse embarquée                                                                                                                                                                                                      |
| E7  | Moyenne   | **Plus aucune épreuve réelle ne tourne** (voir §8, D5) : une régression de la chaîne avec les modèles passerait inaperçue                                                                                                                                                                                                                                                                                                                    | `epreuve-reelle.yml`, `android-e2e.yml`                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                            |
| E8  | Basse     | Le mot de passe de la base de CI (`postgres`, `ci`) et `JWT_SECRET: integration_continue_seulement_32_caracteres` sont en clair dans les workflows. Ils ne servent qu'aux bases jetables de la CI                                                                                                                                                                                                                                            | `.github/workflows/*.yml`                                                                                                                                                                                                                                                                                                | non                                                                                                                                                                                                                          |
| E9  | Basse     | Un jeton de rafraîchissement de 30 jours est délivré à tout client qui se déclare `coque-*`. Il faut quand même le mot de passe                                                                                                                                                                                                                                                                                                              | `apps/api/src/session.ts:106-108` (lecture de code)                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                            |

**Ce qui n'est pas exposé (vérifié) :**

- Aucun motif de clé (`sk-…`, `AKIA…`, `AIza…`, `ghp_…`, `BEGIN … PRIVATE KEY`) dans l'arbre de `main` ni dans tout l'historique.
- Aucun `.env`, keystore, `.jks` ni dump n'a jamais été ajouté à git (`git log --all --diff-filter=AD` vide).
- Les secrets de CI sont dans GitHub : `ANDROID_KEYSTORE_*`, `ANDROID_KEY_*`, `CAPGO_CLE`, `DEPLOI_CLE_SSH` (environnement staging).
- Play passe par OIDC, sans clé de compte de service.
- Le dépôt est **privé**.
- PostgreSQL du staging ne publie aucun port (`compose.yml`, `provisionner.sh`).
- Les octets des pièces ne sont servis que sous session et RLS (`apps/api/src/stockage.ts:117-131`, lecture de code).
- Les clés d'API du cabinet ne couvrent que `capture.enregistrer`, deux lectures d'écritures et le dépôt d'octets (`apps/api/src/cles-api.ts:46-49`).

**Routes ouvertes sans authentification en production** (lecture de code, `apps/api/src/app.ts`) :

| Route                    | Effet                                           | Limite        |
| ------------------------ | ----------------------------------------------- | ------------- |
| `POST /auth/inscription` | crée un compte                                  | 30/min par IP |
| `POST /auth/connexion`   | ouvre une session                               | 30/min        |
| `POST /auth/rafraichir`  | échange un jeton long                           | 30/min        |
| `POST /auth/deconnexion` | révoque                                         | aucune        |
| `GET /sante`             | `{"etat":"ok"}`                                 | aucune        |
| `GET /sante/profonde`    | version, état base et stockage, écriture disque | aucune        |

`POST /journal-atelier` n'est monté que hors production. Toutes les autres routes exigent une session, ou une clé pour `/rpc` et le dépôt d'octets.

**Ordre de traitement proposé :**

1. E1, avant toute poussée sur `application-android` ou `main`.
2. E3, parce qu'une clé fuitée se paie.
3. E2 et E4 ensemble : ils ferment le même accès.
4. E7.
5. E5 et E6.
6. E8 et E9.

---

## 5. L'état du dépôt

### 5.1 Branches

`git fetch` fait le 14 sept. :

| Branche                                | Tête                  | Par rapport à `origin/main`           | Poussée ?                                                   |
| -------------------------------------- | --------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `origin/main`                          | `4a01252` (8 sept.)   | —                                     | —                                                           |
| `main` locale                          | `f6b7d8b` (1er sept.) | **58 commits en retard**, 0 en avance | périmée ; ne jamais s'y comparer                            |
| `origin/application-android`           | `975eaa7` (10 sept.)  | +3 (solveur des montants)             | oui, **servie par le staging**                              |
| `application-android` locale           | `eb68c9c`             | +6                                    | **3 commits non poussés** : `b438b74`, `5c38ada`, `eb68c9c` |
| `origin/chantier/remise-a-zero-metier` | `081f3aa`             | +8                                    | oui, identique à la locale                                  |

Non suivis dans l'arbre de travail : `db/verification/.diag.sql`, `.diag2.sql`, `.diag3.sql`. Ce sont des requêtes de diagnostic laissées pendant l'étape 1 (commencent par `\pset pager off`).

**Étiquettes :** `web-v0.1.1` à `web-v0.2.1`. Aucune `v*`, donc aucune version déployable sur pilote ou production.

### 5.2 `application-android` par rapport à `main`

`git diff main...application-android --stat` sur les branches locales mélangerait le retard de `main`. Voici donc la comparaison demandée **sur les références distantes** :

```
git diff --stat origin/main...origin/application-android
 17 files changed, 1006 insertions(+), 147 deletions(-)
```

Ce sont 3 commits : `10db76f` (montants), `ec6631f` (devise et échelle du pack), `975eaa7` (une date n'est pas un montant). Ils touchent seulement :

- la lecture des pièces : `apps/api/src/malica/lecture/*`, `apps/api/src/depots/capture.ts`, `supervision.ts` ;
- deux messages et codes de drapeau du socle ;
- une ligne de l'écran pièce du cabinet.

**Les 147 lignes supprimées** (lues dans le diff) :

- **`token-plan.ts`.** Suppression de `normalizeAmount`, qui effaçait tout caractère inconnu avant de lire un montant. C'est ce qui lisait `08/09/2026` comme 8 092,026. Elle est remplacée par la lecture sur treillis de `montants.ts`, qui refuse au lieu d'effacer.
- **`read-piece.ts`.** Suppression des appels `take(…, "amount", …)` champ par champ. Ils sont remplacés par une résolution globale des montants en deux passes.
- **`depots/capture.ts` et `supervision.ts`.** Suppression des repli implicites `?? "TN"` et `?? "TND"` sur la juridiction et la devise (R4). La devise et l'échelle viennent désormais du dossier et du pack.
- **`vision.ts`.** Suppression de `currency: … .default("TND")` et de l'exemple d'invite `"currency":"TND"`.
- **Tests.** `lecture-incomplete.test.ts` et `token-plan.test.ts` : suppression des assertions sur l'ancienne fonction.

**Ce que le diff ne touche pas** (vérifié le 11 sept. et inchangé) : aucun fichier sous `db/corpus/`, `db/verification/` ou `db/migrations/`, et aucun secret ajouté.

Le chantier (`origin/main...origin/chantier/remise-a-zero-metier`) : 34 fichiers, +3 310/−150. Il **ajoute** deux migrations (`20260911150000`, `20260911160000`) et `db/verification/comparer-referentiel.mjs`. Il ne modifie aucune migration existante.

### 5.3 Migrations : où elles sont appliquées

| Lieu                                   |                        Migrations |
| -------------------------------------- | --------------------------------: |
| dépôt, `origin/main`                   |                                94 |
| dépôt, `origin/application-android`    |                                94 |
| dépôt, `application-android` locale    |                                95 |
| dépôt, `chantier/remise-a-zero-metier` |                                96 |
| `malica_local`, `malica_test`          |   96, sans écart avec le chantier |
| staging                                | vraisemblablement 94, non vérifié |

- **Dans le dépôt mais pas sur le staging :** `20260911150000_le_journal_de_la_plateforme.sql` et `20260911160000_le_modele_de_la_capture.sql`.
- **L'inverse** (appliqué quelque part, absent du dépôt) : aucun sur le poste. Pour le staging, non vérifiable.

---

## 6. Le modèle de données, en une page

### 6.1 Les schémas

| Schéma                                                                  | Ce qu'il porte                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`                                                                  | les comptes (adresse, empreinte du mot de passe) et les jetons de rafraîchissement                                                     |
| `identity`                                                              | organisations (cabinets, PME), membres, invitations, mandats (engagements), fiches fiscales, clés d'API                                |
| `app`                                                                   | la mécanique de la plateforme : migrations appliquées, opérateurs plateforme, signalements                                             |
| `audit`                                                                 | le journal des événements de chaque tenant, et le journal de plateforme (hors tenant)                                                  |
| `ref`                                                                   | le référentiel réglementaire : pack de juridiction, plan comptable officiel, taux, paramètres fiscaux, obligations, modèles d'écriture |
| `parametrage`                                                           | le plan comptable et les liaisons propres à un cabinet                                                                                 |
| `legal`                                                                 | le corpus juridique : sources, articles, versions, fragments vectoriels, sondages, banque de cas                                       |
| `capture`                                                               | la pièce : enregistrement, plan de jetons, extraction, citations, précisions, articles, contrôle                                       |
| `socle`                                                                 | les écritures comptables et leurs lignes                                                                                               |
| `agents`                                                                | les appels aux modèles, leurs tarifs et budgets, les conversations avec Malica, les arbitrages                                         |
| `collab`                                                                | la vie du cabinet : affectations, questions de charge, notifications, PV, exports, honoraires, réglages                                |
| `tiers`                                                                 | les comptes auxiliaires (clients, fournisseurs)                                                                                        |
| `banque`                                                                | comptes bancaires, relevés, rapprochements, lettrages                                                                                  |
| `immo`, `stocks`                                                        | immobilisations et stocks, avec leurs écritures                                                                                        |
| `billing`, `payments`, `pricing`, `catalog`, `commissions`, `contracts` | facturation et vente, hérités, tous vides                                                                                              |
| `schedule`                                                              | les échéances déclaratives                                                                                                             |
| `coffre`, `storage`                                                     | objets stockés : tables présentes, **jamais écrites**                                                                                  |
| `extensions`, `public`                                                  | extensions (pgvector…) et vues ou fonctions exposées à l'API                                                                           |

### 6.2 Le parcours d'une pièce, table par table

Ordre du parcours. « Écrite par » est une lecture de code ; les lignes sont comptées sur `malica_local` et `malica_test`.

| Étape      | Table                                                            | Existe | Lignes (local / test) | Écrite par le code ?                                                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------- | ------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dépôt      | `capture.pieces`                                                 | oui    | 0 / 6                 | oui : `capture_piece_register`, depuis `apps/api/src/depots/capture.ts:75`. **`sha256` toujours `null`** (passé en dur, `capture.ts:76`)                                                                         |
| octets     | disque `STOCKAGE_RACINE/<tenant>/<pièce>`                        | —      | `.stockage` vide      | oui : `apps/api/src/stockage.ts:207-210`                                                                                                                                                                         |
| octets     | `storage.objects`                                                | oui    | 0 / 0                 | **non, jamais**                                                                                                                                                                                                  |
| versions   | `capture.piece_versions`                                         | oui    | 0 / 0                 | **non, jamais**                                                                                                                                                                                                  |
| lecture    | `capture.token_plan`, `capture.extractions`, `capture.citations` | oui    | 0 / 0                 | oui : `capture_read_persist`, depuis `POST /malica/lectures/:id`. **`confiance_par_champ` jamais remplie** ; plus d'événement `piece.read` (vérifié dans la définition en base : `position('piece.read' …) = 0`) |
| lecture    | `agents.agent_runs`                                              | oui    | 0 / 0                 | **pas par la lecture** : seulement par le conseil                                                                                                                                                                |
| articles   | `capture.piece_articles`                                         | oui    | 0 / 0                 | oui, s'il y a des articles                                                                                                                                                                                       |
| précisions | `capture.precisions`                                             | oui    | 0 / 0                 | oui : réponse du dirigeant                                                                                                                                                                                       |
| écriture   | `socle.ecritures`, `socle.ecriture_lignes`                       | oui    | 0 / 0                 | oui : `socle_ecriture_propose` puis `book`, **au clic « Oui »**, avec des lignes calculées dans le navigateur (`buildProposal`)                                                                                  |
| contrôle   | `capture.conformite`                                             | oui    | 0 / 0                 | **seulement lors de la revue du cabinet**, après comptabilisation. Jamais `non_conforme`                                                                                                                         |
| audit      | `audit.event_log`                                                | oui    | 0 / 15                | oui : par les fonctions SQL (capture, proposition, revue, précision)                                                                                                                                             |

### 6.3 Le cloisonnement par tenant

**Vérifié dans `malica_local`.** Tables où la RLS n'est pas à la fois activée et forcée :

```
agents.model_pricing  rls=t force=f      collab.assignments  rls=t force=f
collab.pv_reunions    rls=t force=f      auth.users          rls=f
auth.refresh_tokens   rls=f              app.migrations      rls=f
legal.sondages        rls=f              legal.banque_cas    rls=f
storage.buckets       rls=f              storage.objects     rls=f
```

**Cloisonnement appliqué.** Toutes les autres tables des schémas métier et du référentiel (103 tables) ont la RLS activée et forcée, par `app.enable_tenant_rls` ou par boucle.

**Ce qui en découle** (vérifié) :

- Les 113 tables appartiennent à `postgres`. L'API se connecte en `malica_api`, qui n'en est pas propriétaire, n'est pas superutilisateur et n'a pas `bypassrls`. Elle est membre d'`authenticated`.
- Pour l'API, « activée mais non forcée » **suffit donc** : `collab.assignments` et `collab.pv_reunions` restent cloisonnées.
- Le défaut est de cohérence avec la règle R6, pas une fuite.

**Cloisonnement non appliqué :**

- `auth.users` et `auth.refresh_tokens` : lues par l'API sous son propre rôle, par conception (connexion). `authenticated` n'y a pas accès.
- `legal.sondages` et `legal.banque_cas` : ni RLS, ni droit de lecture pour `authenticated` ou `malica_api` (`has_table_privilege` = faux). Elles sont inaccessibles à l'API, pas exposées.

**Tests.**

- `apps/api/src/schema.test.ts` vérifie l'index qui mène par `tenant_id` et l'enveloppe `(select app.is_platform())`. Il **ne vérifie pas** que la RLS est activée et forcée.
- `isolation.test.ts` vérifie que `malica_api` n'est ni superutilisateur ni `bypassrls`.

---

## 7. Ce qui marche vraiment aujourd'hui

**Précision de méthode.** « Fonctionne » veut dire : le chemin est écrit de bout en bout **et** un test automatisé le parcourt.

- Aucun parcours n'a été exécuté pour ce relevé : la base de travail est vide, et les épreuves ne doivent pas tourner avant l'étape 3.
- La dernière preuve d'exécution est la CI du 11 sept. sur `081f3aa` : `atelier`, `web`, `api`, `epreuves` réussis, avec le jeu de données.

| Parcours                          | État                                                         | Fondé sur                                                                                                                                                                                       | Couvert par un test ?                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inscription d'un cabinet          | **fonctionne**                                               | `POST /auth/inscription`, écran `routes/auth.tsx`, puis `onboarding.tsx`, puis `create_organization` (lecture de code) ; CI `epreuves` verte le 11 sept.                                        | oui, par l'API (`outils/epreuves/socle.mjs`, `jeu-de-donnees.mjs`) ; **non par l'écran** (aucun Playwright ne crée de cabinet)                                                                                                |
| Création d'une PME par le cabinet | **non écrit** en tant que tel ; **partiel** en contournement | le cabinet propose un mandat à une PME **qui doit déjà exister** (`mandat_proposer`) ; la PME accepte. `identite.creerMandat` n'est appelé par aucun écran (lecture de code)                    | oui : `outils/epreuves/mandats-et-invitations.mjs`                                                                                                                                                                            |
| Invitation                        | **partiel**                                                  | invitation et acceptation dans l'application (lecture de code) ; **aucun courriel n'est envoyé** (aucun client de messagerie dans `apps/api/src`) ; inviter le dirigeant d'une PME n'existe pas | oui : `mandats-et-invitations.mjs`                                                                                                                                                                                            |
| Dépôt d'une pièce depuis le web   | **fonctionne**                                               | `pme.tsx`, file hors ligne, `capture.enregistrer`, `POST /pieces/:id/contenu`                                                                                                                   | oui : `stockage.test.ts`, `depots.test.ts`, `outils/epreuves/hors-ligne.mjs`, vitest hors ligne. Playwright ne dépose pas                                                                                                     |
| Photo depuis le téléphone         | **partiel**                                                  | scanner natif, file native (lecture de code) ; le téléphone de test a reçu 0.1.3 en vol le 7 sept. (`docs/versions.md`)                                                                         | vitest sur les capacités ; Maestro ouvre et annule le scanner. **Aucune capture réelle suivie de l'envoi n'est testée**, et les flux Maestro échouent chaque nuit avant de démarrer (D5)                                      |
| Lecture du fichier, extraction    | **partiel**                                                  | œil (Qwen-VL-OCR), plan de jetons, désignation, filtre R2, solveur des montants. Sans empreinte, sans confiance par champ, sans journal d'appel ni événement d'audit                            | oui en unitaires (`malica/lecture/*.test.ts`, banc de factures). **Aucun test automatisé n'appelle les modèles** : l'épreuve de nuit est cassée, et d'après sa lecture elle n'appelle de toute façon aucune route `/malica/*` |
| Contrôles, verdict                | **non écrit** en automatique                                 | `capture.conformite` n'est écrite qu'à la revue du cabinet                                                                                                                                      | contraintes du modèle seulement (`modele-capture.test.ts`, étape 2)                                                                                                                                                           |
| Proposition d'écriture            | **partiel**                                                  | calculée dans le navigateur, enregistrée au clic ; verrou R2 sur le type confirmé                                                                                                               | `propose-ecriture.test.ts` (3 cas, libellé), `propositions.test.ts` ; épreuve `file-exports-integrations.mjs` avec des lignes écrites à la main                                                                               |
| Interrogation du corpus juridique | **écrit, non éprouvé**                                       | `/malica/demander` et `/malica/conseil`, empreintes, `corpus.rechercher` sur `legal.chunks` (31 863 fragments en local)                                                                         | fonctions pures seulement ; **aucun test n'exécute `corpus.rechercher`**                                                                                                                                                      |

---

## 8. Les dettes, rassemblées

Classées par ce qu'elles coûtent si on ne les traite pas. **Déjà connue** : relevée aux étapes 1 et 2. **Nouvelle** : découverte ici.

| #   | Dette                                                                                                                                                                                                                                                                                                   | Origine                                                                            | Coût si on ne la traite pas                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D1  | Déploiement automatique du staging sur `main` et `application-android`, migrations en superutilisateur, sans approbation, alors que l'application publiée l'interroge ; 3 commits locaux non poussés sur `application-android`                                                                          | nouvelle (en partie connue : on savait que la poussée déploie)                     | une fusion ou une poussée change la base des testeurs sans que personne ne l'ait voulu ; pas de retour arrière du schéma |
| D2  | Clés des modèles et mot de passe administrateur local dans un dossier OneDrive ; dumps et pièces au même endroit                                                                                                                                                                                        | nouvelle                                                                           | une clé qui fuit se paie en appels ; des dumps de données hors du poste                                                  |
| D3  | Mots de passe d'essai en clair dans `main` (3 mots de passe, 9 fichiers), comptes vraisemblablement présents sur le staging, inscription publique sans vérification                                                                                                                                     | déjà connue (signalée le 11 sept.) ; aggravée ici par E4                           | quiconque lit le dépôt ou s'inscrit entre dans le staging, donc dans l'application des testeurs                          |
| D4  | `outils/operateur-plateforme.mjs` à rejouer après l'onboarding : jusque-là, personne ne lit `audit.journal_plateforme`                                                                                                                                                                                  | déjà connue (étape 1)                                                              | le journal de la remise à zéro reste illisible                                                                           |
| D5  | Les deux épreuves de nuit échouent chaque jour depuis au moins le 9 sept. : `connexion refusée pour leila.bensalah@bensalah.tn : 429`. `AUTH_ESSAIS_PAR_MINUTE: "1000"` n'est posé que dans `ci.yml:156`, pas dans `epreuve-reelle.yml` ni dans `android-e2e.yml`                                       | **nouvelle**                                                                       | la chaîne réelle (modèles) et l'émulateur ne sont plus éprouvés ; une régression arrive chez le testeur avant d'être vue |
| D6  | Un seul fichier de comptes de parcours à créer (Playwright, Maestro, captures) ; jusqu'à l'étape 3, Playwright, Maestro, captures et épreuves sont attendus en échec sur le poste                                                                                                                       | déjà connue (étape 1)                                                              | les parcours ne se vérifient pas sur le poste                                                                            |
| D7  | `sha256` jamais calculée (`capture.ts:76`) : l'unicité par tenant ne détecte aucun doublon                                                                                                                                                                                                              | déjà connue (étape 2)                                                              | deux photos du même ticket deviennent deux charges                                                                       |
| D8  | `confiance_par_champ` jamais remplie                                                                                                                                                                                                                                                                    | déjà connue (étape 2)                                                              | l'écran ne sait pas quel champ faire vérifier                                                                            |
| D9  | La lecture n'écrit plus `piece.read` dans l'audit et n'écrit pas `agents.agent_runs` (le commentaire de `vision.ts:170` dit le contraire)                                                                                                                                                               | **nouvelle** (lecture de code, et vérifiée sur la définition en base pour l'audit) | on ne sait ni qui a lu quoi ni ce que coûtent les lectures ; les budgets d'agents ne voient pas la lecture               |
| D10 | Pas de contrôle automatique ni de verdict avant comptabilisation ; proposition d'écriture calculée côté client                                                                                                                                                                                          | **nouvelle**                                                                       | le parcours « scan, contrôle, verdict » de l'étape 3 n'a pas de fondation serveur                                        |
| D11 | Le cabinet ne peut pas créer une PME ; aucune invitation n'envoie de courriel                                                                                                                                                                                                                           | **nouvelle**                                                                       | l'onboarding « Cabinet d'Expertises CADG, puis ALGORIA FACTORY SARL » de l'étape 3 ne peut pas se faire tel quel         |
| D12 | R4 enfreinte : `socle_ecriture_propose` garde `p_devise default 'TND'` (migration `20260824133728:206`), alors que `20260830180000` l'annonce retiré. `schema.test.ts` ne voit que les colonnes, pas les paramètres de fonction                                                                         | **nouvelle** (lecture de code)                                                     | une écriture sans devise passe en dinars sans le dire                                                                    |
| D13 | R11 : défauts connus (`ref.rejet_motifs.valid_from`, dates de tarifs de modèles) ; aucune migration corrective                                                                                                                                                                                          | déjà connue                                                                        | le référentiel diffère selon le jour où la base est montée                                                               |
| D14 | R6 : `collab.assignments` et `collab.pv_reunions` en RLS non forcée ; `schema.test.ts` ne contrôle pas le forçage                                                                                                                                                                                       | **nouvelle**                                                                       | aucune fuite aujourd'hui (l'API n'est pas propriétaire) ; une fuite le jour où un propriétaire lit                       |
| D15 | Rejeu idempotent de `capture_piece_register` : réécrit `piece.captured` dans l'audit                                                                                                                                                                                                                    | **nouvelle** (lecture de code)                                                     | un journal qui compte plus de captures qu'il n'y en a                                                                    |
| D16 | Deux noms de staging servis ; la variable `DOMAINE` porte l'ancien                                                                                                                                                                                                                                      | **nouvelle**                                                                       | retirer l'alias coupe l'ancienne application                                                                             |
| D17 | `/sante/profonde` : public, non limité, écrit sur le disque, dit la branche                                                                                                                                                                                                                             | **nouvelle**                                                                       | charge disque gratuite pour un tiers                                                                                     |
| D18 | `images.yml` : commentaire « sur main seulement » faux ; `epreuve-bout-en-bout.mjs` annonce une lecture et une interrogation de Malica qu'il ne fait pas                                                                                                                                                | **nouvelle**                                                                       | on se croit protégé par un texte                                                                                         |
| D19 | R9 : `regalica_verif` et l'entrée `regalica_api` de `pgpass.conf` sont des restes ; `db/verification/.diag*.sql` non suivis                                                                                                                                                                             | **nouvelle** (les `.diag` sont de mon fait, étape 1)                               | bruit, confusion sur quelle base fait foi                                                                                |
| D20 | `malica_test` garde 13 comptes et 7 organisations de tests non annulés                                                                                                                                                                                                                                  | nouvelle                                                                           | sans conséquence tant que la base se recrée par `npm run base-de-test`                                                   |
| D21 | Temps 2 du solveur (qualité de la désignation) non commencé                                                                                                                                                                                                                                             | déjà connue                                                                        | l'arithmétique ne tranche pas quand la désignation est incohérente                                                       |
| D22 | Rotation des clés des modèles non traitée — acceptée le 16 sept. 2026 : poste en développement                                                                                                                                                                                                          | décision de l'utilisateur                                                          | à reprendre avant le pilote                                                                                              |
| D23 | Locale : poste `French_Tunisia.1252`, staging `en_US.utf8` — acceptée nommément le 17 sept. 2026 dans `db/registre.mjs` (portée « autre serveur », retrait quand les deux locales coïncident) ; la recherche lexicale diffère sur 791 fragments, la mesure de 99,3 % n'a pas été rejouée sur le staging | nouvelle (15-17 sept.)                                                             | une question peut rendre un autre article sur le staging, d'abord en arabe                                               |
| D24 | Les noms `deepseek-chat` et `deepseek-reasoner` du code sont annoncés retirés par DeepSeek au 24 juillet 2026 ; absents de `GET /models` le 16 sept. ; encore servis au 11 sept.                                                                                                                        | nouvelle (16 sept.)                                                                | la désignation des pièces et le conseil tombent d'un coup le jour où l'API les refuse                                    |

---

## Les trois choses à traiter en premier

### 1. Séparer « fusionner » de « changer la base des testeurs »

**Aujourd'hui :**

- une poussée sur `main` ou `application-android` redéploie le staging et joue les migrations en superutilisateur, sans approbation ;
- ce staging est le serveur de l'application installée depuis Google Play ;
- la branche locale `application-android` porte déjà une migration non poussée.

**Si on ne fait rien.** La première fusion du chantier modifie le schéma de la base des testeurs, et il n'y a pas de retour arrière du schéma. Une purge ou une migration mal écrite n'aurait plus besoin de personne pour atteindre des données d'utilisateurs.

**Ce qui le traiterait :**

- une règle d'approbation sur l'environnement GitHub `staging` ;
- ou retirer `application-android` des déclencheurs d'`images.yml`.

C'est une décision qui vous revient.

### 2. Sortir les clés des modèles du dossier OneDrive, et les faire tourner

**Aujourd'hui.** `apps/api/.env` porte les vraies clés DeepSeek et Qwen, et le mot de passe administrateur de la base locale. Il est dans un dossier que OneDrive synchronise, à côté de 1,1 Go de dumps et des pièces d'avant la purge.

**Si on ne fait rien.** La sécurité de ces clés dépend de celle du compte Microsoft, de tout appareil connecté à ce OneDrive, et de tout lien de partage du dossier. Une clé de modèle utilisée par un tiers se paie à l'appel, sans alerte.

### 3. Fermer l'accès au staging par les comptes d'essai, et réparer les épreuves de nuit

**Aujourd'hui :**

- les mots de passe des comptes d'essai sont dans le dépôt ;
- ces comptes ont existé sur un serveur public ;
- n'importe qui peut s'y inscrire ;
- les deux épreuves censées surveiller la chaîne réelle échouent tous les jours sur une variable manquante.

**Si on ne fait rien.** Le staging est ouvert à qui lit le dépôt ou s'inscrit. Et une régression de la lecture par les modèles, précisément ce que le chantier va toucher à l'étape 3, ne sera vue par personne avant un testeur.

---

## Ce que je ne peux pas vérifier d'ici

| Ce qui manque                                                                                                                                                                                    | Pourquoi                                                                                            | Ce qu'il faudrait                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Le contenu de la base du staging : nombre de comptes, organisations, pièces, fichiers ; présence de données réelles ; migrations appliquées ; corpus et ses cinq compteurs ; nom réel de la base | la session SSH en lecture a été **refusée par le garde-fou du poste** ; PostgreSQL n'est pas publié | votre autorisation explicite pour une session SSH en lecture (commande au §2.5), ou la lancer vous-même |
| Que les comptes d'essai existent **aujourd'hui** sur le staging                                                                                                                                  | vérifier exigerait d'ouvrir une session avec leur mot de passe, ce que je ne fais pas               | la même requête en base                                                                                 |
| Les variables réelles du serveur : `DOMAINE_ALIAS`, `CLIENT_MIN_VERSION`, `AUTH_ESSAIS_PAR_MINUTE`, `CORS_ORIGINS`                                                                               | fichier `/srv/malica/.env` sur le serveur                                                           | la même session                                                                                         |
| Que les sauvegardes du staging tournent, qu'il existe des instantanés récents, que le signal de vie est surveillé                                                                                | conteneur et Storage Box non joignables d'ici                                                       | `docker compose run --rm sauvegarde restaurer.sh lister` sur le serveur                                 |
| Le nombre de testeurs de la piste interne, et les versions réellement installées                                                                                                                 | Play Console, non accessible d'ici                                                                  | Play Console, « Tests internes », puis « Statistiques »                                                 |
| Les versions 0.1.0 (1) et 0.1.1 (2) envoyées à la main : leur adresse d'API                                                                                                                      | aucune trace CI                                                                                     | Play Console (bundle), ou le commit de construction si vous l'avez                                      |
| Que OneDrive synchronise effectivement `apps/api/.env`                                                                                                                                           | j'ai vu le processus OneDrive et le dossier sous OneDrive, pas l'état de synchronisation du fichier | l'icône d'état du fichier dans l'Explorateur                                                            |
| Les 36 fichiers de `.stockage.avant-remise-a-zero-20260911` : réels ou synthétiques                                                                                                              | je ne les ai pas ouverts                                                                            | les regarder                                                                                            |
| Les tests « invités » de Capgo : quels appareils ont pris 0.2.1                                                                                                                                  | console Capgo                                                                                       | console Capgo                                                                                           |

## Ce dont je ne suis pas sûr

**Parties fondées sur la lecture de code, pas sur une exécution :**

- **Routes publiques** (§4). L'inventaire des routes, les limites de débit et le comportement de `/sante/profonde` sur le disque viennent d'une lecture d'`apps/api/src/app.ts`, `session.ts`, `stockage.ts`, `cles-api.ts`. Seuls `/sante` et `/sante/profonde` ont été appelés.
- **Parcours d'une pièce et parcours utilisateurs** (§6.2, §7). « Qui écrit quelle table », l'absence d'envoi de courriel, l'impossibilité pour le cabinet de créer une PME, la proposition calculée dans le navigateur et le rejeu de `piece.captured` sont des lectures de code et de migrations. Seuls deux points ont été vérifiés dans la base : l'absence de `piece.read` et de `confiance_par_champ` dans `capture_read_persist`.
- **Création d'organisation par un inscrit.** L'idée qu'un compte fraîchement inscrit peut créer une organisation (E4) repose sur la lecture de `onboarding.tsx` et de `create_organization`. Je ne l'ai pas éprouvé.

**Déductions :**

- **Version de la base du staging** (« 94 migrations »). C'est une déduction : dernier déploiement réussi sur `975eaa7`, plus le service `migrer`. Quelqu'un a pu jouer autre chose à la main.
- **Nom de la base du staging** (« `malica` »). Il est lu dans `infra/compose.yml`, pas sur la machine.
- **Compte d'essai sur le staging.** La présence de `leila.bensalah@bensalah.tn` repose sur la session du 10-11 sept., pas sur un relevé d'aujourd'hui.
- **Épreuves de nuit en échec « depuis au moins le 9 sept. ».** `gh run list` en montre six consécutives (9 au 14 sept.) plus un échec le 6 sept. sur une autre cause possible. Je n'ai lu le journal d'échec que de celle du 14 sept.
- **Nombre de fichiers portant un mot de passe.** L'étape 1 disait « 14 fichiers ». Le relevé d'aujourd'hui donne 9 fichiers (4 + 2 + 3) pour ces trois mots de passe dans `origin/main`. Le chiffre du 11 sept. comptait vraisemblablement d'autres motifs ; je retiens 9, mesuré.
- **Adresse de l'API des versions 0.1.0 et 0.1.1 envoyées à la main.** Inconnue.
- **Similitude des domaines d'essai.** Que `bensalah.tn`, `sotumag.tn` ou `medina-textile.tn` appartiennent à de vraies organisations est une présomption sur le nom, non vérifiée.

**Écarts de méthode :**

- La comparaison demandée `git diff main...application-android --stat` a été faite sur `origin/main...origin/application-android`. Le `main` local est périmé de 58 commits et aurait faussé le résultat.
- La date du fichier (11 sept.) ne correspond pas à la date du relevé (14 sept.).
