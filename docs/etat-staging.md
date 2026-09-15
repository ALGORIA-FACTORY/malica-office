# État du staging — étape A, lecture seule

Relevé du **14 septembre 2026, vers 14 h 45 (heure de Paris)**. Il a été fait par SSH sur `root@116.203.144.94`, avec votre autorisation.

Toutes les requêtes SQL ont tourné dans le conteneur `malica-postgres-1` avec `PGOPTIONS="-c default_transaction_read_only=on"`. Le serveur l'a confirmé : `show default_transaction_read_only` → `on`, `current_setting('transaction_read_only')` → `on`.

Rien n'a été écrit sur le serveur ni dans une base. En plus des requêtes SQL, deux lectures ont eu lieu sur la machine : la liste des instantanés restic (`restaurer.sh lister`) et le journal d'accès de Caddy.

---

## ⛔ Deux conditions d'arrêt sont atteintes

Votre consigne : « si un compte du staging n'est pas un compte d'essai, ou si une pièce a été déposée par quelqu'un de réel, tu t'arrêtes ». **Aucun des 14 comptes n'est en `@essai.local`.** Dix viennent du jeu de données du dépôt. Les quatre autres et trois des pièces ne se laissent pas classer sans vous.

### 1. Quatre comptes absents du dépôt

| Adresse                    | Créé le (UTC) | Nom affiché | Depuis                | Organisation créée             |
| -------------------------- | ------------- | ----------- | --------------------- | ------------------------------ |
| `john.doe@example.com`     | 6 sept. 17:34 | John Doe    | `coque-android/0.1.0` | « My Test Company », dirigeant |
| `test@example.com`         | 6 sept. 17:52 | Test User   | `coque-android/0.1.0` | « Test Org », dirigeant        |
| `testuser@example.com`     | 7 sept. 14:07 | Test User   | `coque-android/0.1.1` | « Test Org », dirigeant        |
| `newuser98765@example.com` | 8 sept. 12:19 | John Doe    | `coque-android/0.2.0` | « My Test Company », dirigeant |

- **Absents du dépôt.** `git grep` sur toutes les branches distantes ne trouve aucune de ces adresses ni aucun de ces noms d'organisation.
- **Quasi vides.** Chaque compte porte un jeton de rafraîchissement et un événement d'audit. Leurs organisations n'ont ni pièce ni écriture.
- **Origine vraisemblable.** Ce seraient les **robots du rapport de pré-lancement de Google Play**. Chaque compte apparaît dans les minutes qui suivent un envoi sur la piste interne : envoi du 7 sept. à 13:52, compte à 14:07 ; envoi du 8 sept. à 12:03, compte à 12:19.
- **Ce que dit le journal de Caddy** pour le dernier (horodatage `1788869951` = 8 sept. 12:19:11 UTC) :
  ```
  "remote_ip":"66.102.8.238"   (plage Google)
  "User-Agent":"Mozilla/5.0 (Linux; Android 11; OnePlus8Pro Build/QKR1.191246.002; wv) … Chrome/90.0.4430.210"
  "X-Malica-Client":"coque-android/0.2.0"
  ```
  Le journal (5,3 Mo) ne remonte pas assez loin pour les trois premiers.
- **Limite de la preuve.** C'est une forte présomption, pas une preuve.

**Décision qui vous revient :** tenez-vous ces quatre comptes pour des comptes d'essai ?

### 2. Trois photos venues d'un téléphone

Le staging porte 14 pièces, déposées par le compte d'essai `contact@sotumag.tn` (SOTUMAG SARL) ou par d'autres comptes du jeu de données :

| Déposée (UTC)                     | Source      | Fichier              | Type                                    | Lue | Total lu |
| --------------------------------- | ----------- | -------------------- | --------------------------------------- | --- | -------- |
| 6 sept. 16:13 → 16:21 (11 pièces) | `pdf`       | **909 à 989 octets** | factures générées par le jeu de données | —   | —        |
| **6 sept. 21:39**                 | **`photo`** | **140 441 octets**   | facture de vente, type confirmé         | oui | 2800     |
| **6 sept. 21:41**                 | **`photo`** | **184 501 octets**   | facture d'achat, type confirmé          | oui | 44400    |
| **7 sept. 13:23**                 | **`photo`** | **189 488 octets**   | facture d'achat, type confirmé          | oui | 110.000  |

- **Les 11 premières** sont les PDF synthétiques de `outils/jeu-de-donnees.mjs` : moins d'un kilo-octet, déposés en rafale en une seconde.
- **Les 3 photos** ont été prises avec l'application, sur le compte d'essai, en dehors de toute exécution de script.
  - Émetteur, client et numéro sont vides dans l'extraction : je ne peux pas dire d'ici ce qu'elles montrent.
  - **Si ce sont des photos de vraies factures, ce sont des données réelles**, même déposées sous un compte d'essai.
  - Je ne les ai pas ouvertes.
  - Emplacement : `/srv/malica/pieces/b7f79db4-bfe7-4415-ae04-ae627f3a4b0b/` (`286ea66b…`, `b97ed23c…`, `41ef7513…`).

**Décision qui vous revient :** que montrent ces trois photos ?

**Conséquence.** Je m'arrête ici comme prévu, sans entamer l'étape B. Aucune bascule n'est envisageable avant vos deux réponses.

---

## 1. La base

|                         | Staging                                                                                                                                                                                                                      | Poste (`malica_local`) |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Nom réel                | **`malica`** (seule base applicative ; l'autre est `postgres`)                                                                                                                                                               | `malica_local`         |
| PostgreSQL              | 17.11 (Debian 17.11-1.pgdg12+2), image `pgvector/pgvector:pg17`                                                                                                                                                              | 17.11                  |
| Taille                  | **632 Mo** (662 607 539 octets)                                                                                                                                                                                              | 615 Mo                 |
| Extensions              | `vector 0.8.6`, `pgcrypto 1.3`, `btree_gist 1.7`, `plpgsql 1.0`                                                                                                                                                              | identiques             |
| Schémas                 | agents, app, audit, auth, banque, billing, capture, catalog, coffre, collab, commissions, contracts, extensions, identity, immo, legal, parametrage, payments, pricing, public, ref, schedule, socle, stocks, storage, tiers | identiques             |
| Poids du schéma `legal` | 614 Mo                                                                                                                                                                                                                       | 597 Mo                 |
| Rôles                   | `postgres` (superutilisateur), `malica_api` (connexion, sans bypassrls), `authenticated`, `anon`, `service_role`                                                                                                             | identiques             |
| Réglages                | `shared_buffers 1GB`, **`maintenance_work_mem 64MB`**, `work_mem 4MB`, `max_parallel_maintenance_workers 2`                                                                                                                  | —                      |

## 2. Le métier

Comptages exacts, `count(*)` table par table.

| Table                                                                                                                                                      |                 Lignes |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------: |
| `auth.users`                                                                                                                                               |                 **14** |
| `auth.refresh_tokens`                                                                                                                                      |                     33 |
| `identity.organizations`                                                                                                                                   | 11 (1 cabinet, 10 PME) |
| `identity.memberships`                                                                                                                                     |                     14 |
| `identity.engagements` (mandats)                                                                                                                           |                      6 |
| `identity.invitations`                                                                                                                                     |                      3 |
| `identity.entities` / `fiches_fiscales`                                                                                                                    |                 11 / 6 |
| `capture.pieces`                                                                                                                                           |                 **14** |
| `capture.token_plan` / `extractions` / `citations`                                                                                                         |           463 / 9 / 71 |
| `capture.piece_articles` / `precisions`                                                                                                                    |                 14 / 3 |
| `socle.ecritures` / `ecriture_lignes`                                                                                                                      |                 6 / 22 |
| `schedule.echeances`                                                                                                                                       |                    130 |
| `audit.event_log`                                                                                                                                          |                    124 |
| `agents.agent_runs` / `conversations` / `conversation_messages`                                                                                            |             8 / 6 / 17 |
| `agents.arbitrages` / `reponse_controles`                                                                                                                  |                  7 / 4 |
| `collab.*` (notifications 22, mandats d'honoraires 5, affectations 4, factures d'honoraires 2 + 2 lignes, encaissement 1, PV 1, obligations 1, réglages 1) |                     39 |
| `banque.comptes` / `releve_lignes`                                                                                                                         |                  1 / 1 |
| `tiers.auxiliaires`                                                                                                                                        |                      6 |
| `app.platform_operators`                                                                                                                                   |                  **0** |
| `storage.objects`, `coffre.objects`                                                                                                                        |                      0 |

**Comptes du jeu de données.** Les 10 comptes suivants sont tous présents dans `outils/jeu-de-donnees.mjs`, et ont tous été créés le 6 sept. :

- `leila.bensalah@bensalah.tn`, `amine.bouzid@bensalah.tn`, `nour.khelifi@bensalah.tn`, `sana.trabelsi@bensalah.tn` ;
- `contact@sotumag.tn`, `contact@medina-textile.tn`, `contact@cleopatre-voyages.tn`, `contact@tunisfresh.tn`, `contact@atelier-zitouna.tn`, `contact@nabeul-ceramique.tn`.

Les 4 comptes `@example.com` sont traités plus haut.

**Appareils.** Les jetons de rafraîchissement viennent de `coque-android/0.1.0` (13), `0.1.1` (1), `0.1.2` (2), `0.1.3` (4), `0.2.0` (2) et **`0.2.1` (11, jusqu'au 12 sept.)**. L'application installée s'en sert encore.

## 3. Les migrations

- **94 appliquées**, la première le 6 sept. à 16:06 UTC, la dernière le 8 sept. à 12:28 UTC (`20260908120000_le_type_de_la_piece_se_confirme.sql`).
- La liste est identique, nom pour nom, aux 94 premières du poste.
- **Deux manquent**, présentes seulement sur `chantier/remise-a-zero-metier` :
  - `20260911150000_le_journal_de_la_plateforme.sql`
  - `20260911160000_le_modele_de_la_capture.sql`
- **Aucune migration du staging n'est absente du dépôt.**

## 4. Le corpus juridique

**Présent.** Les cinq compteurs sont égaux à ceux du poste :

|         | articles | versions | fragments | sondages | banque de cas |
| ------- | -------: | -------: | --------: | -------: | ------------: |
| staging |   11 440 |   16 183 |    31 863 |   12 101 |           667 |
| poste   |   11 440 |   16 183 |    31 863 |   12 101 |           667 |

Les autres tables de `legal` sont égales aussi : `references_extraites` 23 631, `ingestion_queue` 926, `corpus_noms` 156, `sources` 8, `articles_extraits` 0, `documents` 0.

**L'égalité des compteurs ne prouve pas l'identité du contenu** : c'est l'objet de l'étape B.5. Trois écarts sont déjà visibles :

- **les fragments ne pointent pas vers le même tarif** (voir §5) ;
- **les index n'ont pas la même taille** :
  - GIN `chunks_recherche_idx` : 37 Mo contre 26 Mo ;
  - `chunks_pkey` : 2,2 Mo contre 1,0 Mo ;
  - `article_versions_pkey` : 0,6 Mo contre 1,4 Mo.

  Ces écarts de taille sont compatibles avec un historique d'écritures différent. Ils ne disent rien du contenu ;

- l'index HNSW `chunks_hnsw` fait **249 Mo des deux côtés** (261 021 696 octets), avec les mêmes paramètres : `m=16`, `ef_construction=128`, `vector_cosine_ops`.

## 5. `agents.model_pricing` — aucun identifiant commun

| provider, modèle, rôle                     | id **staging**                             | id **poste**                               | écart de contenu                                      |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ----------------------------------------------------- |
| deepseek, deepseek-reasoner, reasoner      | `0cae90b1-0b80-4ddb-9daf-155e45104f8a`     | `078d2fd9-3db2-4a05-97c4-cd63262decb8`     | aucun                                                 |
| deepseek, deepseek-chat, cache             | `54c01a84-9d7a-4fdc-b3d3-e3426e226756`     | `caf41a65-b197-4025-9740-cabcfa1cbf7c`     | aucun                                                 |
| deepseek, deepseek-chat, chat              | `c01a3e9c-88d6-49ae-8857-fd05e52d708e`     | `f3bd0bd1-e289-45c0-b19a-35352f03a715`     | aucun                                                 |
| lovable, google/gemini-2.5-flash, vision   | `0c0f9768-78cb-4a5a-93a0-02682cd83059`     | `e54db984-0069-4e01-8cc1-ea8e30c69ef0`     | `effective_to` **2026-09-06** contre **2026-08-31**   |
| interne, pdf-text, vision                  | `67be74fb-1a5d-466a-871d-357cc243fcdc`     | `a5ac9a28-d406-4530-b755-069560bb0758`     | `effective_from` **2026-09-06** contre **2026-08-31** |
| alibaba, qwen3.7-text-embedding, embedding | **`6ee5a8e5-f1f9-4687-b52c-04cd90b61ed4`** | **`a7220a6e-3a32-420c-8bb6-331e3df92958`** | aucun (`effective_from` 2026-09-01 des deux côtés)    |

**Les fragments dépendent de ce tarif d'embedding :**

```
staging : select pricing_id, count(*) from legal.chunks  →  6ee5a8e5-f1f9-4687-b52c-04cd90b61ed4 | 31863
poste   : select pricing_id, count(*) from legal.chunks  →  a7220a6e-3a32-420c-8bb6-331e3df92958 | 31863
```

- Les 31 863 fragments de chaque côté pointent vers la ligne d'embedding de leur propre base.
- Les identifiants sont tirés au hasard (`gen_random_uuid()`) à chaque montage.
- Les deux dates qui diffèrent sont le défaut R11 déjà connu : `current_date` dans `20260826163000`, jouée le 31 août sur le poste et le 6 sept. sur le staging.

## 6. Les fichiers de pièces

- `PIECES_DIR=/srv/malica/pieces`, monté dans l'API sous `/pieces`.
- **14 fichiers, 572 Ko**, répartis dans 3 dossiers de tenant. C'est un fichier par pièce en base.
- Détail : 11 fichiers de 909 à 989 octets (PDF du jeu de données, 6 sept.) et 3 fichiers de 140 à 189 Ko (les photos, §⛔2).

## 7. La machine

|                    | Valeur                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Hôte               | `malica-staging`, Ubuntu 24.04.4 LTS, en service depuis 8 jours                                                                      |
| Processeurs        | 2                                                                                                                                    |
| Mémoire            | 3 819 Mo au total, 1 125 Mo utilisés, **2 694 Mo disponibles**, **pas de swap**                                                      |
| Disque             | un seul volume `/dev/sda1` de 38 Go : 7,1 Go utilisés, **29 Go libres** (20 %)                                                       |
| Données PostgreSQL | `/srv/malica/postgres`, 1,7 Go sur disque (base, WAL, catalogue)                                                                     |
| Volumes Docker     | 773 Mo, dont les dumps locaux                                                                                                        |
| Images Docker      | 2,2 Go, dont 703 Mo récupérables                                                                                                     |
| Conteneurs         | `api`, `web`, `sauvegarde` (image `application-android`, en service depuis 4 jours), `caddy`, `postgres` (en service depuis 6 jours) |
| Dépôt servi        | `975eaa7`, 10 sept., « Une date n'est pas un montant » ; arbre propre                                                                |

## 8. Les variables réelles du serveur

Lues dans `/srv/malica/.env`, puis dans l'environnement du conteneur `malica-api-1` (`printenv`).

| Variable                            | Valeur                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOMAINE`                           | `staging.malica-office.algoria-factory.com`                                                                                                                                  |
| **`DOMAINE_ALIAS`**                 | **`staging.regalica-office.algoria-factory.com`**                                                                                                                            |
| **`CLIENT_MIN_VERSION`**            | **vide** : aucune version d'application n'est refusée                                                                                                                        |
| **`AUTH_ESSAIS_PAR_MINUTE`**        | **`30`**                                                                                                                                                                     |
| **`CORS_ORIGINS`**                  | absent de `.env` ; composé par `compose.yml` : **`https://staging.malica-office.algoria-factory.com,https://staging.regalica-office.algoria-factory.com,https://localhost`** |
| `VERSION` / `MALICA_VERSION`        | `application-android`                                                                                                                                                        |
| `NODE_ENV`                          | `production`                                                                                                                                                                 |
| `QWEN_OCR_MODEL`                    | `qwen-vl-ocr-2025-11-20`                                                                                                                                                     |
| Secrets renseignés (noms seulement) | `POSTGRES_PASSWORD`, `MALICA_API_PASSWORD`, `JWT_SECRET`, `DEEPSEEK_API_KEY`, `QWEN_API_KEY`, `RESTIC_PASSWORD`                                                              |
| `SAUVEGARDE_SIGNAL_URL`             | **vide** : aucune surveillance ne signale un silence des sauvegardes                                                                                                         |

## 9. Les sauvegardes, constatées

- **Elles tournent.** Journal du conteneur :
  ```
  [2026-09-14T12:00:00] dump → /sauvegardes/malica-20260914-120000.dump
  [2026-09-14T12:00:48] hors site
  [2026-09-14T12:00:53] ok : 183.1M de base, 572.0K de pièces
  ```
- **Hors site :** 34 instantanés restic. Le plus récent est `2df4efa5`, du 14 sept. à 12:00:49 (732 Mio, tag `base`).
- **Dumps locaux** dans le volume : 191 975 652 octets pour les deux derniers `malica-*`. Deux dumps `regalica-20260908-*` subsistent.
- **Surveillance.** `SAUVEGARDE_SIGNAL_URL` est vide : un arrêt des sauvegardes ne serait signalé à personne.
- **Restauration.** La seule répétition consignée date du 6 sept., il y a 8 jours.

---

## Ce que ce relevé ne dit pas

- **Contenu des trois photos.** Il n'est pas ouvert, et c'est vous qui pouvez le dire.
- **Origine des quatre comptes `@example.com`.** Présomption forte (robots Google Play), sans preuve pour les trois premiers : le journal d'accès ne remonte pas assez loin.
- **Identité du corpus au-delà des compteurs.** À établir par empreinte à l'étape B.5.

**Je m'arrête ici.** Je n'entame pas l'étape B avant vos réponses aux deux points du haut.

---

# Étape B — 15 septembre 2026

## Où en sont les deux conditions d'arrêt

- **Les quatre comptes `@example.com` : levée.** Vous l'avez tranché : c'est un domaine réservé (RFC 2606), et le journal de Caddy montre le robot de pré-lancement de Play.
- **Les trois photos : en suspens.** Elles sont copiées sur le poste, en lecture seule, hors du dépôt et hors OneDrive :

  `C:\Users\wisse\AppData\Local\Malica\photos-staging-20260915\`

  Ce sont trois PDF (en-tête `%PDF-1.7`), marqués en lecture seule. Chaque copie a la même empreinte SHA-256 que son original :

  | Fichier                                                    |  Octets | SHA-256             |
  | ---------------------------------------------------------- | ------: | ------------------- |
  | `286ea66b-11fb-4c46-b9a7-55a0403eb73d.pdf` (6 sept. 21:39) | 140 441 | `59f4f8d8…6e826570` |
  | `b97ed23c-6376-46a4-9e0b-08e82a87a83f.pdf` (6 sept. 21:41) | 184 501 | `3a75aa95…709a176b` |
  | `41ef7513-bfad-4f90-813b-dd6a9b922679.pdf` (7 sept. 13:23) | 189 488 | `3b8adcd7…6198cda8` |

  Sur le staging, rien n'a bougé : `find /srv/malica/pieces -type f | wc -l` → 14.

**Tant que vous n'avez pas répondu sur les photos, rien ne s'exécute.**

## B.1 — Les empreintes du schéma `legal`

### La méthode

- **Transaction.** Tout se fait dans une transaction `read only`, des deux côtés ; `lecture_seule=on` est imprimé en tête de chaque sortie.
- **Réglages fixés à l'identique** avant tout calcul, parce qu'ils changent le rendu en texte :
  - `timezone = UTC` (le poste est à +01, le staging à +00) ;
  - `datestyle = ISO, YMD` ;
  - `extra_float_digits = 1`.
- **Le calcul.** Chaque ligne est rendue par `row::text`, puis condensée en `md5`. Les condensés sont triés en collation C et condensés à leur tour. **Aucune colonne n'est exclue.**
- **Durée.** 8 s sur le poste, 12 s sur le staging.
- **Structures.** Elles ont été comparées avant le calcul : colonnes, types et défauts des 11 tables sont identiques (`diff` vide).

### Le résultat

| Table                  | Lignes | Empreinte poste                        | Empreinte staging                      |             |
| ---------------------- | -----: | -------------------------------------- | -------------------------------------- | ----------- |
| `article_versions`     | 16 183 | `4e7bffb3ce9cab78d254e7a6f23d2eef`     | `4e7bffb3ce9cab78d254e7a6f23d2eef`     | identique   |
| `articles`             | 11 440 | `b44a87a3fd5609631901809e398fc4b0`     | `b44a87a3fd5609631901809e398fc4b0`     | identique   |
| `articles_extraits`    |      0 | `d41d8cd9…` (vide)                     | `d41d8cd9…` (vide)                     | identique   |
| `banque_cas`           |    667 | `b630025e34cd7839051a15fa60cc93f6`     | `b630025e34cd7839051a15fa60cc93f6`     | identique   |
| **`chunks`**           | 31 863 | **`5ff634549ef9e6b9934f54e824190e90`** | **`df578b2a027b3bbb544bafe4e59a464a`** | **DIFFÈRE** |
| `corpus_noms`          |    156 | `fb68b733d11e05abe324c66a89f7184b`     | `fb68b733d11e05abe324c66a89f7184b`     | identique   |
| `documents`            |      0 | `d41d8cd9…` (vide)                     | `d41d8cd9…` (vide)                     | identique   |
| `ingestion_queue`      |    926 | `1de41120b3cff102e08061a396b2ebba`     | `1de41120b3cff102e08061a396b2ebba`     | identique   |
| `references_extraites` | 23 631 | `84a5b9af8caf877e976337dca35c3fc1`     | `84a5b9af8caf877e976337dca35c3fc1`     | identique   |
| `sondages`             | 12 101 | `b0ce1d1b6bbb8770acf291f87f833b5c`     | `b0ce1d1b6bbb8770acf291f87f833b5c`     | identique   |
| `sources`              |      8 | `4e6fc3e5fbbe68f8442fd28770c8c1c2`     | `4e6fc3e5fbbe68f8442fd28770c8c1c2`     | identique   |

- **Dix tables sur onze sont identiques au contenu près**, identifiants et horodatages compris : le corpus du staging vient bien du poste.
- **Une table diffère : `legal.chunks`.** Selon votre règle, c'est la branche 3, et voici de combien.

### Où `legal.chunks` diffère, et de combien

**Empreinte colonne par colonne** (paires `id=valeur`, triées par `id`) : 10 colonnes sur 12 sont identiques.

| Colonne                                                                                                                              |            | Portée de l'écart                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------- |
| `id`, `article_version_id`, `ordinal`, `langue`, **`texte`**, `caracteres`, **`embedding`**, `encode_le`, `created_at`, **`entete`** | identiques | —                                                        |
| **`pricing_id`**                                                                                                                     | diffère    | **31 863 lignes sur 31 863**                             |
| **`recherche`**                                                                                                                      | diffère    | **791 lignes sur 31 863** (717 en arabe, 74 en français) |

**`pricing_id`.**

- Toutes les lignes pointent vers **le même tarif**, désigné par un identifiant tiré au hasard à chaque montage : `alibaba / qwen3.7-text-embedding / embedding / effet 2026-09-01`.
- Son contenu est identique des deux côtés : prix, devise et dates sont égaux.
- C'est l'effet connu des identifiants `gen_random_uuid()` de `agents.model_pricing` (§5). Ce n'est pas une donnée du corpus.

**`recherche`.**

- C'est une **colonne générée par PostgreSQL** (`generated always as … stored`, migrations `20260902160000` puis `20260902190000`). Son expression, lue dans le catalogue, est la même des deux côtés : `setweight(to_tsvector(<simple si arabe, sinon french>, entete), 'A') || setweight(to_tsvector(…, texte), 'D')`.
- **Ses trois entrées (`langue`, `entete`, `texte`) sont identiques.**
- **Chaque serveur stocke exactement ce qu'il calcule.** Le recalcul exact sur toutes les lignes donne `0` écart sur le poste, `0` écart sur le staging.
- **La cause est la locale des deux bases :** `French_Tunisia.1252` sur le poste (Windows), `en_US.utf8` sur le staging (Debian).
  - L'analyseur de `to_tsvector` découpe les mots selon la classification des caractères de la locale.
  - Il ne découpe donc pas pareil les formes de présentation arabes et les signes diacritiques. Exemple de la première ligne en écart (`001bb69e…`) : 216 lexèmes sur le poste, 217 sur le staging.
- **Ce n'est pas un défaut de synchronisation.** C'est la même donnée, indexée par deux systèmes différents.

**Contre-épreuve.** L'empreinte de `chunks` recalculée en ne touchant qu'à ces deux colonnes est **identique** des deux côtés : `7f7c8595a78cc99aafb98335c412dee3`, 31 863 lignes. Les deux colonnes sont traitées ainsi, et ce sont les deux seules :

- `pricing_id` est **traduit** en son tarif ;
- `recherche` est **retirée**, parce qu'elle est générée par le serveur.

### Ce que cela change à la décision

**Une bascule ne rendrait pas `chunks` plus identique qu'aujourd'hui.**

- `pg_dump` ne transporte pas les valeurs des colonnes générées : la base neuve recalculerait `recherche` avec la locale `en_US.utf8` du staging, donc exactement la valeur actuelle.
- `pricing_id` devrait de toute façon être réécrit vers l'identifiant du tarif de la base cible.

Au terme d'une bascule, l'empreinte brute de `chunks` serait `df578b2a…`, celle qui existe déjà. Le transfert de 31 863 fragments, la réconciliation de la clé étrangère et la reconstruction HNSW n'apporteraient rien.

**Ma recommandation : la branche 2, la purge sur place.** La décision vous revient, puisque le résultat brut relève de la branche 3.

**Deux constats à garder, sans les traiter maintenant :**

- La recherche par les mots ne donne pas exactement les mêmes résultats sur le poste et sur le staging pour ces 791 fragments. C'est une non-reproductibilité de même famille que R11, venue du serveur et pas des migrations.
- L'index HNSW fait 261 021 696 octets des deux côtés, avec les mêmes paramètres, sur des vecteurs identiques. Son contenu interne n'est pas comparable par empreinte : il se déduit des vecteurs, qui sont prouvés identiques.

## B.2 — L'API déployée tient-elle sur le schéma 96 ? Oui, preuve à l'appui

### 1. Le code est le même

- **Code identique.** Hors tests, l'API déployée (`975eaa7`) et le chantier (`081f3aa`) ne diffèrent que par le script de test : `git diff --stat 975eaa7 081f3aa -- apps/api packages/socle` → `apps/api/package.json` (1 ligne), `garde-base-de-test.ts` et deux fichiers de test.
- **Aucune référence aux nouveaux objets.** `git grep "journal_plateforme|confiance_par_champ|confiances_valides" 975eaa7 -- apps packages outils` → 0 ligne.

### 2. Ce même code a tourné, avec succès, sur le schéma 96

CI du 11 sept., exécution 34616285642 sur `081f3aa`, job `epreuves` :

```
appliquée  20260911150000_le_journal_de_la_plateforme.sql
appliquée  20260911160000_le_modele_de_la_capture.sql
96 migrations, 96 jouée(s), 0 déjà à jour.
OK    SOTUMAG SARL dépose EI-2026-0417  — jeu-sotumag-1
OK    EI-2026-0417 est lue sans IA  — lue, 5 citations
OK    EI-2026-0417 est proposée puis comptabilisée  — ACH · 4 lignes
```

Toutes les étapes sont réussies : `Peupler le jeu de données`, `Les épreuves par module`, `Parcours dans un navigateur`, et le job `api`.

- « dépose » passe par `capture_piece_register` puis le dépôt d'octets.
- « est lue » passe par `persisterLecture`, puis `capture_read_persist`, puis l'insertion dans `capture.extractions`.

### 3. Chaque changement, confronté aux écritures de l'ancien code

**`20260911150000` — le journal de plateforme.**

- Elle crée une table neuve, `audit.journal_plateforme`, et ne modifie aucun objet existant.
- L'ancien code ne la connaît pas.
- **Aucun effet.**

**`20260911160000` — la contrainte de format sur `capture.pieces.sha256`.**

- La contrainte est `sha256 is null or sha256 ~ '^[0-9a-f]{64}$'`.
- La seule écriture de l'ancien code passe `null` en dur : `capture.ts:75-76`. Elle est donc toujours admise.
- Sur le staging, les lignes existantes valident la contrainte à sa création : 0 `sha256` non nulle, 0 mal formée.

**`20260911160000` — l'index unique `(tenant_id, sha256) where sha256 is not null`.**

- L'ancien code n'y écrit jamais de valeur, donc il ne peut pas le violer.
- Sa création ne peut pas échouer sur le staging : 0 doublon.

**`20260911160000` — la colonne `capture.extractions.confiance_par_champ`.**

- Elle est `not null default '{}'`.
- La seule insertion, dans `capture_read_persist`, nomme ses colonnes : `tenant_id, piece_id, contract, payload, flags`. La colonne prend donc son défaut, `{}`.

**`20260911160000` — le `check (capture.confiances_valides(…))`.**

- `'{}'` est valide, donc le contrôle passe.
- **Le rôle qui l'évalue a le droit d'exécution.** Ce point méritait d'être vérifié, et il l'a été :
  - `has_function_privilege('malica_api', …)` renvoie **faux** : `malica_api` n'hérite de rien (`rolinherit = f`, `inherit_option = f`) ;
  - mais l'API endosse le rôle avant d'écrire : `set local role authenticated` (`db.ts:97`, et `cles-api.ts:92` pour les clés) ;
  - `authenticated` a le droit : ACL `{postgres=X/postgres,authenticated=X/postgres}` ;
  - `capture_read_persist` est une fonction « invoker », donc évaluée sous `authenticated`.
- Le point 2 le confirme par l'exécution.

**`20260911160000` — le commentaire sur `capture.conformite`.**

- **Aucun effet.**

### 4. L'exécuteur de migrations ne bloquera ni aujourd'hui ni après

- **Aujourd'hui.** Les empreintes des 94 migrations du staging sont **toutes égales** à celles des fichiers du chantier : 0 différence. `migrer.mjs` jouera donc les deux nouvelles, sans rejouer ni refuser les anciennes.
- **Après.** Un redéploiement ultérieur d'`application-android` (94 fichiers) sur une base à 96 ne casse rien. `migrer.mjs` ne boucle que sur les fichiers du dépôt (`for (const nom of fichiers)`, l. 136) et ne regarde pas les migrations appliquées qui en sont absentes.

**Conclusion.** Les deux migrations ne cassent pas l'API déployée. **Il n'est pas nécessaire de déployer l'API en même temps.**

## B.3 — Le plan simplifié : purge du métier sur place

On ne touche à aucune table de `legal`, et le corpus n'est pas en jeu. Le plan porte sur les 72 tables métier de `purge_metier.sql`, les 14 fichiers et le journal.

**Durée d'indisponibilité visée.** Environ une minute, de l'arrêt de l'API à la sonde verte.

**Choix de la fenêtre.**

- Hors des sauvegardes automatiques de 00 h, 6 h, 12 h et 18 h.
- **Personne ne pousse sur `main` ni sur `application-android` pendant l'opération** : un déploiement automatique se croiserait avec elle.

### Ce qui doit changer avant l'exécution, avec votre accord

Rien de tout ceci n'est écrit.

1. **Le verrou de `purge_metier.sql` en liste blanche.**
   - Aujourd'hui : `if current_database() <> 'malica_local' then raise exception` (l. 78). Sur le staging, il refuserait, et c'est voulu.
   - Proposition : un paramètre obligatoire `-v base=<nom>`.
     - Il doit être égal à `current_database()`.
     - Il doit appartenir à la liste blanche nommée `('malica_local', 'malica')`.
     - Pour `malica`, un second paramètre `-v serveur=malica-staging` doit être égal au nom d'hôte du serveur PostgreSQL. Une base `malica` d'un futur pilote ne passerait donc pas.
   - Les verrous 2 à 4 (72 tables nommées, fermeture des cascades, oubli d'une table) et les compteurs du corpus avant/après restent inchangés : les mêmes nombres sur le staging.
   - Le changement est commité sur `chantier/remise-a-zero-metier` avec un test, puis copié sur le serveur par `scp`. Jamais poussé sur `application-android`.
2. **L'opérateur.** Sur le serveur, `USERNAME` et `USER` ne désignent pas le poste. Je passe `-e USERNAME=wisse` à `docker exec`. Le journal enregistre aussi `session_user` (`postgres`).

### Le plan

Pour chaque étape : ce qu'on fait, ce qui se passe si elle échoue au milieu, et comment on revient en arrière.

**1. Sauvegarde du staging, relue.**

- `pg_dump -Fc` dans le conteneur `postgres` vers `/srv/malica/sauvegardes-manuelles/malica_avant_purge_<horodatage>.dump`, puis copie sur le poste dans `db/sauvegardes/`, qui est ignoré par git.
- **Relecture :**
  - `pg_restore -l` compte les entrées `TABLE DATA` ;
  - un `pg_restore -a` des tables `auth.users`, `capture.pieces` et `legal.chunks` compte les lignes **à l'intérieur du fichier**, comparées au relevé de l'étape A (14 / 14 / 31 863).
  - Même SHA-256 sur la copie du poste.
- _Échec au milieu :_ rien n'a changé. On recommence.
- _Retour arrière :_ sans objet.

**2. Sauvegarde de `malica_local`.**

- `pg_dump -Fc`, qui est une lecture, relue de la même façon.
- _Échec :_ rien n'a changé.

**3. Copie des 14 fichiers de pièces sur le poste.**

- Destination : `%LOCALAPPDATA%\Malica\pieces-staging-<date>\`, avec leur SHA-256 comparé. C'est un second filet, hors du serveur.
- _Échec :_ rien n'a changé.

**4. Les deux migrations, sans redéployer l'API.**

- Un conteneur jetable de l'image **déjà en service** (`malica-api:application-android`) joue `node db/migrer.mjs`, avec les 96 fichiers du chantier montés en lecture seule sur `/srv/db/migrations`.
- **Sans `--mot-de-passe-api`** : le mot de passe de l'API ne bouge pas.
- L'API reste en service. Les `alter table` prennent un verrou exclusif de quelques millisecondes sur 14 pièces et 9 extractions.
- _Échec au milieu :_ chaque migration est jouée dans sa transaction. Celle qui échoue est annulée, la base reste à 94 ou 95, et l'API ne voit rien. On s'arrête et on lit l'erreur.
- _Retour arrière :_ les deux migrations sont additives et ignorées par le code en service (B.2). Il n'y a rien à défaire pour que l'application fonctionne. On ne réécrit pas l'historique.
- _Vérification :_ `app.migrations` = 96, `audit.journal_plateforme` existe, empreintes du corpus inchangées (B.1 rejoué).

**5. Répétition, `mode=essai`.**

- Arrêt de l'API et du site : `docker compose stop api web`. Le `TRUNCATE` prend un verrou exclusif sur 72 tables : autant que personne n'attende derrière.
- Commande : `purge_metier.sql` avec `-v base=malica -v serveur=… -v sauvegarde=<nom> -v mode=essai`. Elle déroule les verrous et les comptes, puis fait un `ROLLBACK`.
- **Preuve de la répétition :** les 72 tables gardent leurs lignes (recomptées), le journal reste vide.
- _Échec au milieu :_ la transaction s'annule d'elle-même.
- _Retour arrière :_ `docker compose start api web`.

**6. Déplacement des fichiers de pièces, jamais supprimés.** API toujours arrêtée.

- **On ne renomme pas `/srv/malica/pieces`.** L'API et la sauvegarde y sont montées par un _bind mount_ : un conteneur garde le dossier renommé, et l'API continuerait d'écrire dedans.
- On crée `/srv/malica/pieces.avant-remise-a-zero-20260915/` et on y **déplace les trois dossiers de tenant**, par des `mv` sur le même disque.
- On vérifie : 14 fichiers, 572 Ko, SHA-256 égaux à ceux relevés avant.
- _Échec au milieu :_ les `mv` sont atomiques un par un. On remet les dossiers déjà déplacés.
- _Retour arrière :_ trois `mv` inverses.

**7. Purge réelle, `mode=reel`, API toujours arrêtée.**

- L'événement s'écrit **dans la même transaction**, avant le `COMMIT`, dans `audit.journal_plateforme` : date, rôle de base, opérateur, nom de la sauvegarde, tables et lignes, compteurs du corpus avant/après, dossier où sont partis les fichiers.
- _Échec au milieu :_ `ON_ERROR_STOP`, pas de `COMMIT`, donc annulation totale. On remet les trois dossiers (6) et on redémarre : la base et les fichiers sont exactement ceux d'avant.
- _Retour arrière après `COMMIT` :_ ce n'est **pas** deux renommages. C'est une restauration des données des 72 tables depuis le dump de l'étape 1 (`pg_restore --data-only --disable-triggers`, quelques centaines de lignes), puis les trois `mv` inverses. La ligne du journal reste : elle est append-only, et c'est voulu.
  - **Je n'ai pas mesuré ce temps.** Je propose de le mesurer avant l'opération, sur le poste, dans une base jetable montée à 96 migrations, en y restaurant les données métier du dump du staging.
  - Cela écrit une base jetable sur le poste, pas `malica_local`, et demande votre accord.
  - Si la mesure dépasse une minute, on le sait avant.

**8. Redémarrage et vérifications.**

- `docker compose start api web`, en chronométrant de l'arrêt (5) à la première sonde verte.
- **À vérifier :**
  - `/sante/profonde` répond `200` avec `base: ok` et `stockage: ok` ;
  - `POST /auth/connexion` avec un compte inconnu répond `401` : l'API atteint la base ;
  - les 72 tables sont à zéro ;
  - `app.migrations` = 96 ;
  - l'empreinte du corpus (B.1) est inchangée sur le staging ;
  - **`malica_local` est inchangé** (B.1 rejoué sur le poste) ;
  - `qualite_corpus.sql` et `proprete_corpus.sql` sont joués sur le staging.
- **« Une session s'ouvre »** exige un compte, et il n'en existe plus aucun après la purge. Deux voies, à vous de choisir :
  - soit inscrire un compte de vérification, qui laisserait du métier dans une base qu'on veut vide ;
  - soit repousser cette preuve à l'onboarding de l'étape 3.
- _Échec du redémarrage :_ on lit le journal. L'API n'a pas changé d'image, donc un échec viendrait de la base : restauration comme en 7.

### Ce que la purge fait à l'application installée, et qu'il faut savoir avant

- **L'application continue de fonctionner** : même API, même adresse, même schéma compatible.
- **Mais chaque testeur perd son compte.** `auth.users` et `auth.refresh_tokens` font partie des 72 tables.
  - Au prochain appel, la coque reçoit `401`, tente un rafraîchissement, reçoit un second `401`, et oublie la session (`transport.ts:110-120`, code déployé). Elle revient donc à l'écran de connexion.
  - **Lecture de code : pas éprouvé sur le téléphone.**
- `DOMAINE_ALIAS` n'est pas touché, et la construction 6 garde son adresse.
- `CLIENT_MIN_VERSION` et `SAUVEGARDE_SIGNAL_URL` ne sont pas touchés. Ce dernier reste noté comme à corriger.

## Je m'arrête ici

J'attends trois choses de vous :

1. votre réponse sur les trois photos ;
2. le choix entre la purge sur place (ma recommandation) et la bascule malgré B.1 ;
3. votre accord pour la modification du verrou et pour la mesure du retour arrière sur une base jetable du poste.

Rien n'a été écrit sur le staging ni dans une base. La seule écriture est la copie des trois photos, faite à votre demande, sur le poste et hors du dépôt.

---

# Décisions du 15 septembre, et dette consignée

**Décisions :**

- **Purge sur place.** La bascule est abandonnée.
- **Aucun déploiement de l'API.** La preuve de compatibilité de B.2 est retenue.
- **Aucune purge tant que la question des trois photos n'est pas tranchée.**

**Copie des photos.** À votre demande, elles sont copiées dans `C:\Users\wisse\OneDrive\Bureau\photos-staging\`, dossier synchronisé par OneDrive, à supprimer aussitôt votre réponse donnée. Les SHA-256 sont identiques aux originaux.

## Dette — la recherche textuelle n'est pas la même sur le poste et sur le staging

> **La configuration de recherche textuelle diffère entre le poste et le staging ; la mesure de la recherche n'a jamais été rejouée sur le staging.**

**Pourquoi c'est une vraie dette.**

- La colonne `legal.chunks.recherche` porte la recherche par les mots, celle qui mesure **99,3 % au rang 1 sur les questions d'identité** (`docs/la-recherche-mesuree-2026-09-02.md`). Ce chiffre a été mesuré **sur le poste**.
- Sur le staging, **791 fragments** sont indexés autrement : **717 en arabe**, 74 en français. Une même question peut donc y rendre un autre article, d'abord en arabe.

**Configurations relevées** (lecture seule, `pg_database` et `pg_settings`) :

|                                      | Poste                                           | Staging                                                           |
| ------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| PostgreSQL                           | 17.11, `x86_64-windows`, compilé par MSVC 19.44 | 17.11, Debian `17.11-1.pgdg12+2`, `x86_64-pc-linux-gnu`, gcc 12.2 |
| Fournisseur de locale de la base     | `c` (celui du système)                          | `c` (celui du système)                                            |
| `datcollate` / `datctype` de la base | **`French_Tunisia.1252`** (Windows)             | **`en_US.utf8`** (glibc)                                          |
| Version de la collation              | — (non tracée sous Windows)                     | **glibc 2.36** (`datcollversion`)                                 |
| Encodage                             | UTF8                                            | UTF8                                                              |
| `default_text_search_config`         | `pg_catalog.french`                             | **`pg_catalog.english`**                                          |

**Ce qui compte, et ce qui ne compte pas :**

- **Ce qui cause l'écart : `datctype`.** L'analyseur de `to_tsvector` et de `websearch_to_tsquery` classe chaque caractère (lettre ou non) selon la locale de la base. Windows `French_Tunisia.1252` et glibc `en_US.utf8` ne classent pas pareil les formes de présentation arabes et les signes diacritiques. La même règle s'applique **aux questions**, pas seulement à l'index : sur le staging, la question et l'index sont découpés de la même façon entre eux, mais autrement que sur le poste.
- **Ce qui ne cause pas l'écart : `default_text_search_config`.** Les appels du dépôt nomment toujours leur configuration :
  - l'index : `'french'` ou `'simple'`, dans l'expression générée ;
  - les requêtes : `websearch_to_tsquery('french', …)` et `('simple', …)` dans `db/corpus/rechercher.mjs:210-213` et `db/corpus/sonder.mjs:72`.

  Cette différence de réglage par défaut est donc, en l'état, sans effet. Elle le deviendrait au premier appel sans configuration nommée.

**Point de départ, pour plus tard :**

- rejouer la mesure (`db/corpus/sonder.mjs`) sur le staging ;
- puis décider d'une locale commune, ou d'un fournisseur ICU, identique pour les deux serveurs.

**Rien n'est corrigé maintenant.**

## `SAUVEGARDE_SIGNAL_URL` — ce qu'il faut pour la renseigner

**Je ne peux pas la renseigner seul : il n'existe aujourd'hui aucun moniteur pour la recevoir.**

- `docs/exploitation.md` (§ Surveiller) prévoit « Uptime Kuma (ou UptimeRobot), hors de la machine », avec un moniteur _push_ qui alerte sur le silence.
- Aucune adresse de moniteur n'existe dans le dépôt, dans `/srv/malica/.env`, ni dans les variables GitHub.

**Ce que fait la variable.** `infra/sauvegarde/sauvegarder.sh:40-41` appelle `curl -fsS --max-time 10 "$SAUVEGARDE_SIGNAL_URL"` après chaque sauvegarde réussie, toutes les six heures.

**Ce qu'il faut, dans l'ordre :**

1. **Créer le moniteur.** C'est à vous de le faire : il faut créer un compte, ce que je ne fais pas. Deux possibilités :
   - **Healthchecks.io**, gratuit, hors de la machine : un « check » de période 6 h et de délai de grâce 1 h, qui donne une adresse `https://hc-ping.com/<uuid>` ;
   - **UptimeRobot** ou **Uptime Kuma** hébergé ailleurs : un moniteur _Heartbeat/Push_ de même période.

   Dans les deux cas, l'alerte doit aller vers une adresse de courriel que vous lisez. **Surtout pas une instance d'Uptime Kuma sur le staging lui-même** : la machine qui tombe ne peut pas signaler sa propre chute.

2. **Me donner l'adresse du moniteur.** Elle est à traiter comme un secret faible : quiconque la connaît peut simuler un signal.
3. **Côté serveur, avec votre accord.** C'est une écriture sur le staging :
   - ajouter la ligne `SAUVEGARDE_SIGNAL_URL=…` dans `/srv/malica/.env` ;
   - recréer **le seul** conteneur de sauvegarde (`docker compose up -d sauvegarde`), puisque la variable est lue au démarrage ;
   - l'API et le site ne sont pas touchés.
4. **Preuve.** Déclencher une sauvegarde à la main (`docker compose exec sauvegarde sauvegarder.sh`), puis voir le signal arriver dans le moniteur. Enfin, laisser passer une échéance sans signal pour voir l'alerte partir.

## Le plan de purge retenu — il s'exécute seulement après votre réponse sur les photos

1. **Sauvegarde du staging, relue.** Comptage réel à l'intérieur du fichier : `pg_restore -a` des tables, lignes comptées, comparées aux comptes de la base au même instant.
2. **`purge_metier.sql` en liste blanche explicite :**
   - la base est nommée en argument (`-v base=…`) et doit être égale à `current_database()` ;
   - la liste blanche est réduite à `malica_local` et `malica` ;
   - **refus si aucune sauvegarde de moins d'une heure** : le fichier nommé par `-v sauvegarde` doit exister, et son horodatage doit dater de moins de 60 minutes au moment de l'exécution.
   - Le changement est commité sur `chantier/remise-a-zero-metier` avec ses tests. Rien n'est poussé sur `application-android`.
3. **Répétition avec `ROLLBACK` sur le staging**, API arrêtée. Compteurs des 72 tables et du corpus : avant, pendant (dans la transaction, après le `TRUNCATE`), après (le `ROLLBACK` a tout rendu).
4. **Purge réelle.** Puis les cinq compteurs du corpus inchangés, l'empreinte `legal` rejouée, et `qualite_corpus.sql` et `proprete_corpus.sql` rejoués sur le staging.
5. **Fichiers de pièces déplacés, jamais supprimés**, les trois photos comprises, quelle que soit la réponse. On déplace les dossiers de tenant dans `/srv/malica/pieces.avant-remise-a-zero-<date>/`, sans renommer le dossier monté.
6. **Événement dans `audit.journal_plateforme`**, dans la transaction de la purge : date, opérateur, nom de la sauvegarde, lignes par table, compteurs du corpus avant et après.

**Préalable technique à 4 et 6.** Les deux migrations `20260911150000` et `20260911160000` doivent être jouées sur le staging, sans redéployer l'API (B.3, étape 4), pour que `audit.journal_plateforme` existe.

---

# Exécution — 15 septembre 2026

Feu vert donné après votre réponse : **les trois photos sont des factures d'essai.** La copie posée dans `OneDrive\Bureau\photos-staging\` a été supprimée. Celle de `%LOCALAPPDATA%\Malica\photos-staging-20260915\` reste.

Toutes les heures ci-dessous sont en UTC.

## 1. Sauvegarde du staging, relue

**Création.** `pg_dump -Fc` de 15:45:44 à 15:46:24 : `malica_avant_purge_20260915_154544.dump`, **191 975 678 octets**, signature `PGDMP`.

**Trois copies, même SHA-256** `59bd15478f7328b1325e7393f1cd44e96381937d54c3df718ace67963ac7e891` :

- `/tmp/` dans le conteneur `malica-postgres-1`. C'est la copie que le verrou lit ; elle disparaît au redémarrage du conteneur.
- `/srv/malica/sauvegardes-manuelles/` sur le serveur, dossier en `700`.
- `db/sauvegardes/staging_malica_avant_purge_20260915_154544.dump` sur le poste, ignoré par git.

**Relecture.**

- `pg_restore -l` compte **112** entrées `TABLE DATA`.
- `pg_restore -a -f -` compte les lignes table par table **à l'intérieur du fichier** : **100 441 lignes**. Elles sont égales, table par table, aux `count(*)` de la base vivante (`diff` vide).

**À noter.** Le journal enregistre le chemin `/tmp/…` vu du serveur PostgreSQL. Les copies durables sont les deux autres, de même empreinte.

## 2. Pièces copiées sur le poste

Les 14 fichiers (572 Ko) sont copiés dans `%LOCALAPPDATA%\Malica\pieces-staging-20260915\`. Les SHA-256 sont identiques des deux côtés.

## 3. Les deux migrations, sans redéployer l'API

**Méthode.**

- Un conteneur jetable (`compose run --rm --no-deps migrer`) de l'image **en service** exécute `node db/migrer.mjs`.
- Les 96 fichiers du chantier sont montés en lecture seule sur `/srv/db/migrations`.
- **Sans `--mot-de-passe-api`.**

**Résultat.**

```
appliquée  20260911150000_le_journal_de_la_plateforme.sql
appliquée  20260911160000_le_modele_de_la_capture.sql
96 migrations, 2 jouée(s), 94 déjà à jour.
```

- `audit.journal_plateforme` existe, vide.
- `pieces_sha256_format` et `extractions_confiance_par_champ_valide` sont posées.
- `/sante/profonde` a répondu `200` avant et après, sans que l'API redémarre.

## 4. Le verrou en liste blanche, et ses refus prouvés

`db/maintenance/purge_metier.sql` a été modifié :

- **`-v base` est obligatoire**, et doit être égal à `current_database()` ;
- **la liste blanche est nommée** : `('malica_local', 'malica')` ;
- **la sauvegarde est lue par le serveur**, par `pg_stat_file` et `pg_read_binary_file`. Elle doit exister, commencer par `PGDMP`, être non vide, et dater de **moins d'une heure** ;
- le journal reçoit en plus `sauvegarde_octets` et `sauvegarde_date` ;
- le script compte les tables **pendant**, après le `TRUNCATE` et avant `COMMIT` ou `ROLLBACK`.

**Refus éprouvés** (code de sortie 3, rien écrit) :

| Cas                            | Où                                                                    | Message                                                                       |
| ------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| sans `-v base`                 | poste, `malica_test`                                                  | `-v base=<nom de la base> est obligatoire`                                    |
| base nommée ≠ base connectée   | poste et staging                                                      | `la base nommée (malica_local) n'est pas celle où l'on est connecté (malica)` |
| base hors liste                | poste, `malica_test`                                                  | `malica_test n'est pas dans la liste blanche (malica_local, malica)`          |
| sauvegarde inexistante         | poste et staging                                                      | `la sauvegarde /tmp/nexiste-pas.dump n'existe pas sur le serveur PostgreSQL`  |
| fichier qui n'est pas un dump  | staging (`/etc/hostname`)                                             | `n'est pas un fichier pg_dump (signature PGDMP absente)`                      |
| sauvegarde de plus d'une heure | staging (copie datée par `touch -d "2 hours ago"`, supprimée ensuite) | `date du 2026-09-15 13:49:11+00 — plus d'une heure. Refaites-la.`             |
| mode inconnu                   | staging                                                               | `mode peutetre inconnu (essai ou reel)`                                       |

**Sur le poste**, le serveur PostgreSQL tourne sous un compte Windows qui ne peut pas lire les fichiers du dossier OneDrive : il refuse aussi, par « Permission denied ». Pour une purge future de `malica_local`, la sauvegarde devra être posée dans un dossier que ce service peut lire.

## 5. Répétition, `mode=essai`

L'API et le site sont arrêtés à **15:49:39.169**.

**Avant.** Les 113 tables sont recomptées. Seuls deux écarts séparent ce comptage de la sauvegarde, et tous deux sont attendus : `app.migrations` passe de 94 à 96, et `audit.journal_plateforme` apparaît. **Rien n'a été écrit depuis la sauvegarde.**

**Pendant.** `72 tables | 0 lignes restantes`.

**Le détail.** 1 043 lignes dans 72 tables. Corpus avant et après : `11440 | 16183 | 31863 | 12101 | 667`. Récit inscrit, puis `ROLLBACK`.

**Après.** `diff` des 113 tables avant et après : **identique**. Aucune ligne perdue, journal vide.

## 6. Pièces déplacées, jamais supprimées

- `/srv/malica/pieces` reste en place, puisque c'est le point de montage de l'API et de la sauvegarde.
- Ses 3 dossiers de tenant sont déplacés dans **`/srv/malica/pieces.avant-remise-a-zero-20260915/`** (droits `700`).
- Il reste 0 élément dans `pieces`. On en retrouve **14 fichiers, 572 Ko**, dont les trois photos.
- **SHA-256 identiques** à ceux relevés avant le déplacement.

## 7. Purge réelle, `mode=reel`

- **COMMIT à 15:50:11.594.**
- 72 tables, **1 043 lignes**, corpus inchangé (`11440 | 16183 | 31863 | 12101 | 667` avant et après).

Lignes vidées par table :

| table                        | lignes | table                                                                               |    lignes |
| ---------------------------- | -----: | ----------------------------------------------------------------------------------- | --------: |
| capture.token_plan           |    463 | agents.agent_runs                                                                   |         8 |
| schedule.echeances           |    130 | agents.arbitrages                                                                   |         7 |
| audit.event_log              |    124 | agents.conversations                                                                |         6 |
| capture.citations            |     71 | identity.engagements                                                                |         6 |
| auth.refresh_tokens          |     33 | identity.fiches_fiscales                                                            |         6 |
| collab.notifications         |     22 | socle.ecritures                                                                     |         6 |
| socle.ecriture_lignes        |     22 | tiers.auxiliaires                                                                   |         6 |
| agents.conversation_messages |     17 | collab.mandats_honoraires                                                           |         5 |
| auth.users                   |     14 | agents.reponse_controles                                                            |         4 |
| capture.piece_articles       |     14 | collab.assignments                                                                  |         4 |
| capture.pieces               |     14 | capture.precisions                                                                  |         3 |
| identity.memberships         |     14 | identity.invitations                                                                |         3 |
| identity.entities            |     11 | collab.factures_honoraires (+ lignes)                                               |     2 + 2 |
| identity.organizations       |     11 | banque.comptes, banque.releve_lignes                                                |     1 + 1 |
| capture.extractions          |      9 | collab.encaissements_honoraires, obligations_cabinet, pv_reunions, reglages_cabinet | 1 chacune |

Les 37 autres tables de la liste étaient déjà vides.

## 8. L'événement du journal

Relu après le `COMMIT` :

```
horodatage  2026-09-15 15:50:11.593955+00
acte        plateforme.remise_a_zero_metier
role_base   postgres        utilisateur_poste  wisse
detail      base: malica · mode: reel · script: db/maintenance/purge_metier.sql
            sauvegarde: /tmp/malica_avant_purge_20260915_154544.dump
            sauvegarde_octets: 191975678 · sauvegarde_date: 2026-09-15 15:46:24+00
            tables_videes: 72 · lignes_supprimees: 1043 · tables: {72 entrées, somme 1043}
            corpus_avant = corpus_apres = {articles 11440, versions 16183, fragments 31863, sondages 12101, cas 667}
```

Ce journal n'est lisible par l'application qu'avec un opérateur de plateforme. Il n'en existe aucun sur le staging, et c'est la dette connue de l'étape 3.

## 9. Redémarrage et vérifications

**Indisponibilité de l'application : 36,1 s.** Arrêt à 15:49:39.169, redémarrage à 15:50:11.885, première sonde verte à 15:50:15.287.

| Vérification                                                  | Résultat                                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/sante/profonde` (nom principal et ancien nom)               | `200 {"etat":"ok","version":"application-android","base":"ok","stockage":"ok"}`                                            |
| `POST /auth/connexion`, compte inconnu                        | `401 {"erreur":"identifiants invalides"}` : l'API atteint la base                                                          |
| Lignes restantes dans les tables métier                       | **0**                                                                                                                      |
| `app.migrations`                                              | 96                                                                                                                         |
| Corpus, cinq compteurs                                        | `11440 / 16183 / 31863 / 12101 / 667`                                                                                      |
| Empreintes des 11 tables `legal`, **staging**, après la purge | **identiques** à celles d'avant (`diff` vide)                                                                              |
| Empreintes des 11 tables `legal`, **`malica_local`**          | **inchangées** (`diff` vide)                                                                                               |
| `qualite_corpus.sql` sur le staging                           | **10 vérités sur 10 à « oui »** ; sortie identique à celle du poste, à l'ordre d'une ligne près                            |
| `proprete_corpus.sql` sur le staging                          | identique au poste **sauf une ligne** : « en-têtes vieillies depuis l'encodage » = **31 863** (poste : 0), voir ci-dessous |
| Conteneurs                                                    | `api` et `web` repartis (healthy) ; `postgres`, `caddy`, `sauvegarde` non touchés                                          |

**« Une session s'ouvre » n'est pas prouvé.** Il n'existe plus aucun compte, et en inscrire un laisserait du métier dans une base qu'on veut vide. Cette preuve revient à l'onboarding de l'étape 3.

**Retour arrière, si on le voulait.** Il se fait depuis la sauvegarde : `pg_restore --data-only --disable-triggers` des 72 tables, puis les trois `mv` inverses. Sa durée n'a pas été mesurée.

## 10. Constat découvert en vérifiant : le schéma du poste dérive du dépôt

**Ce que dit l'anomalie.** « En-têtes vieillies » compare `legal.chunks.entete` à `legal.entete_de_fragment(…)`. Les en-têtes stockés sont identiques sur le poste et le staging (empreinte `entete` égale). **C'est la fonction qui diffère.**

**Qui est conforme au dépôt.** J'ai comparé les définitions de 3 173 objets de schéma (fonctions, vues, politiques, contraintes, déclencheurs, index, colonnes), en lecture seule, dans trois bases :

|                          | Écart avec `malica_test` (montée depuis les 96 migrations le 11 sept.) |
| ------------------------ | ---------------------------------------------------------------------- |
| **staging** `malica`     | **aucun** : le staging est conforme au dépôt                           |
| **poste** `malica_local` | **3 objets**                                                           |

**Les trois objets qui dérivent sur le poste :**

1. **`legal.entete_de_fragment`**
   - Le poste écrit `', opposable à '`, alors que le dépôt (`20260902140000:67`) écrit `', opposable à : '`.
   - Le corpus a été encodé sur le poste avec l'ancienne version. **Mesurés à l'aune du dépôt, les 31 863 en-têtes sont donc vieillis, partout.** Le poste ne le voit pas, puisqu'il se compare à sa propre fonction.
   - Conséquence : le premier réencodage sur le staging (`db/corpus/vectoriser.mjs:149`) produira des en-têtes différents de ceux mesurés sur le poste, donc des vecteurs et une recherche différents.
2. **`public.mandat_proposer`**
   - Il manque au poste la logique « un mandat terminé se repropose » de `20260904194000`.
   - Le poste crée toujours un nouvel engagement ; le dépôt remet le terminé à `propose`.
3. **`public.reglages_cabinet_v`**
   - Deux colonnes sont dans l'autre ordre : `mise_en_route_terminee_le` et `seuil_certitude_conseil`.

**Cause vraisemblable.** Dans `malica_local`, les 94 premières migrations portent **la même heure d'application à la milliseconde près** (2026-09-08 13:21:43). Elles ont été **adoptées** (`migrer.mjs --adopter`) sur une base montée à la main, pas jouées. Les fichiers ont été retouchés après que le poste avait exécuté leurs anciennes versions, et l'empreinte enregistrée est celle des fichiers d'aujourd'hui.

**À traiter, pas maintenant :**

- une migration qui rejoue ces trois objets sur le poste ;
- `schema.test.ts`, ou un comparateur, qui confronte une base de travail à une base montée depuis les migrations.

**La purge n'en est pas la cause**, et elle n'y a rien changé.

## Ce qui n'est pas fait

- **`SAUVEGARDE_SIGNAL_URL` : toujours vide.** Il faut d'abord le moniteur, que vous devez créer (voir plus haut).
- **Opérateur de plateforme** : aucun sur le staging, comme sur le poste. À l'étape 3.
- **Les deux dettes de ce jour** : la recherche textuelle entre poste et staging, et la dérive du schéma du poste. Consignées, non corrigées.
- **Rien n'est poussé sur `application-android`**, et l'API n'a pas été redéployée.
