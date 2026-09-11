# Audit avant la remise à zéro du métier

**Étape 0 — lecture seule.** Rien n'a été modifié : ni en base, ni dans le dépôt, hormis ce fichier.

Base auditée : `malica_local` sur le poste (PostgreSQL 17.11), 620 Mo. Le projet s'appelait Regalica Office jusqu'au 8 septembre ; la base, le dépôt et les schémas portent désormais le nom Malica. Le staging n'est pas concerné par cet audit.

Méthode : une connexion d'administration ouverte en `BEGIN TRANSACTION READ ONLY`, refermée par `ROLLBACK` — PostgreSQL y refuse toute écriture, même par erreur. Les comptages sont des `count(*)` exacts, pas des estimations. Relevé du 11 septembre 2026.

## 1. Ce qu'il faut retenir

**Le corpus est isolé du métier, à une exception près.** 188 clés étrangères au total ; aucune ne relie une table de `legal` à une table métier, dans un sens ou dans l'autre. Aucune table de `legal` ne porte de colonne `tenant_id`, `user_id` ou `created_by`, et ses politiques RLS valent `true` : vider le métier ne change ni ce que contient le corpus, ni ce qu'il laisse voir.

L'exception : **`legal.chunks.pricing_id → agents.model_pricing`** (`ON DELETE NO ACTION`). Les 31 863 fragments pointent tous vers la ligne `qwen3.7-text-embedding`. `agents.model_pricing` est donc classée référentiel et doit rester intacte. Surtout : un `TRUNCATE … CASCADE` qui l'atteindrait viderait `legal.chunks` — 522 Mo de réencodage. L'étape 1 devra nommer ses tables une par une, et je propose qu'elle vérifie par une requête, avant d'agir, que la fermeture de la cascade ne contient aucune table de `legal`.

**Les chiffres du corpus sont ceux que vous attendez** : 11 440 articles, 16 183 versions, 31 863 fragments, 12 101 sondages, 667 cas. Le corpus pèse 597 Mo sur 620 Mo.

**Les gardes R7 refusent le `DELETE`, pas le `TRUNCATE`.** 26 déclencheurs gardent la suppression de ligne (liste en §4) : 14 la refusent sans condition, 6 ne l'ouvrent qu'à la suppression gouvernée d'une pièce, 6 la refusent selon l'état de la ligne — écriture comptabilisée, facture émise, PV envoyé. Aucun ne porte sur `TRUNCATE`, qui ne déclenche pas les déclencheurs de ligne. Une remise à zéro par `DELETE` échouera donc table après table ; par `TRUNCATE`, elle passera — en contournant R7 par construction. C'est légitime sur une base de développement locale, mais c'est une décision à prendre explicitement à l'étape 1, pas un détail d'exécution.

**La base se repolluera au premier `npm test`.** 1 075 des 1 089 comptes sont `@essai.local` : ce sont les tests de l'API (`depots.test.ts`, `isolation.test.ts`, `cles-api.test.ts`, `stockage.test.ts`…), qui créent un compte et deux organisations à chaque exécution contre la base locale, puis les **archivent** au lieu de les supprimer (R7). D'où 842 organisations archivées sur 856. Sans décision sur ce point — une base de test séparée, typiquement — le métier remis à zéro se remplira de nouveau d'organisations d'essai dès la première exécution des tests.

**Une partie du métier vit hors de la base** : 532 pièces en base pour 36 fichiers sur disque (`STOCKAGE_RACINE`, 642 ko, 6 dossiers de tenant). Vider les lignes sans les fichiers laisserait des fichiers orphelins ; l'inverse est déjà le cas pour la plupart des pièces, enregistrées par les tests sans octets.

## 2. Inventaire et classement

| Classement                               | Tables | Lignes | Taille |
| ---------------------------------------- | -----: | -----: | -----: |
| Corpus juridique — à préserver           |     11 | 96 975 | 597 Mo |
| Données métier — à vider                 |     70 |  6 346 | 6.2 Mo |
| Référentiel de paramétrage — à préserver |     29 |  2 423 | 2.0 Mo |
| À trancher (§6)                          |      2 |  3 071 | 1.2 Mo |

Les 26 schémas, dont `public` (64 vues, 248 fonctions, aucune table) et `extensions` (154 fonctions, aucune table) : les vues et fonctions ne portent pas de données et ne sont pas concernées par une remise à zéro.

Extensions : `btree_gist` 1.7, `pgcrypto` 1.3, `plpgsql` 1.0, `vector` 0.8.6.

Légende : ● la table appartient à la colonne. RLS : « forcée » quand elle s'applique aussi au propriétaire.

### `agents`

| Table                   | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note                                                            |
| ----------------------- | -----: | -----: | ------ | :----: | :----: | :---------: | --------------------------------------------------------------- |
| `agent_runs`            |     11 |  64 ko | forcée |        |   ●    |             |                                                                 |
| `arbitrages`            |     49 | 160 ko | forcée |        |   ●    |             |                                                                 |
| `budgets`               |      0 |  16 ko | forcée |        |   ●    |             | réglage par tenant                                              |
| `conversation_messages` |    289 | 240 ko | forcée |        |   ●    |             |                                                                 |
| `conversations`         |    189 | 120 ko | forcée |        |   ●    |             |                                                                 |
| `model_pricing`         |      6 |  48 ko | oui    |        |        |      ●      | tarifs des modèles (R8) — et cible de `legal.chunks.pricing_id` |
| `reponse_controles`     |      6 |  48 ko | forcée |        |   ●    |             |                                                                 |
| `reponse_verdicts`      |      0 |  32 ko | forcée |        |   ●    |             |                                                                 |

### `app`

| Table                | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note                                                                                   |
| -------------------- | -----: | -----: | ------ | :----: | :----: | :---------: | -------------------------------------------------------------------------------------- |
| `migrations`         |     94 |  64 ko | —      |        |        |      ●      | historique des migrations — votre règle : on n'y touche pas                            |
| `platform_operators` |      1 |  32 ko | forcée |        |        |             | **À trancher** — configuration de plateforme tenue par un `user_id` sans clé étrangère |
| `signalements`       |     32 |  64 ko | forcée |        |   ●    |             |                                                                                        |

### `audit`

| Table       | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note                                                                                                |
| ----------- | -----: | -----: | ------ | :----: | :----: | :---------: | --------------------------------------------------------------------------------------------------- |
| `event_log` |  3 070 | 1.2 Mo | forcée |        |        |             | **À trancher** — métier par son rattachement, mais c'est la piste d'audit que R7 déclare inviolable |

### `auth`

| Table            | Lignes | Taille | RLS | Corpus | Métier | Référentiel | Note                                                                  |
| ---------------- | -----: | -----: | --- | :----: | :----: | :---------: | --------------------------------------------------------------------- |
| `refresh_tokens` |    123 | 128 ko | —   |        |   ●    |             |                                                                       |
| `users`          |  1 089 | 456 ko | —   |        |   ●    |             | 1 075 comptes `@essai.local` sur 1 089 — créés par les tests de l'API |

### `banque`

| Table            | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ---------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `comptes`        |      3 |  48 ko | forcée |        |   ●    |             |      |
| `lettrage_etat`  |      1 |  48 ko | forcée |        |   ●    |             |      |
| `lettrages`      |     40 |  64 ko | forcée |        |   ●    |             |      |
| `rapprochements` |      0 |  32 ko | forcée |        |   ●    |             |      |
| `releve_lignes`  |      5 |  64 ko | forcée |        |   ●    |             |      |

### `billing`

| Table               | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ------------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `invoice_lines`     |      0 |  32 ko | forcée |        |   ●    |             |      |
| `invoice_sequences` |      0 |  16 ko | forcée |        |   ●    |             |      |
| `invoices`          |      0 |  32 ko | forcée |        |   ●    |             |      |

### `capture`

| Table            | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note                                                             |
| ---------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---------------------------------------------------------------- |
| `citations`      |    113 | 152 ko | forcée |        |   ●    |             |                                                                  |
| `conformite`     |     39 |  64 ko | forcée |        |   ●    |             |                                                                  |
| `extractions`    |     18 | 104 ko | forcée |        |   ●    |             |                                                                  |
| `piece_articles` |     23 |  96 ko | forcée |        |   ●    |             |                                                                  |
| `piece_versions` |      0 |  32 ko | forcée |        |   ●    |             |                                                                  |
| `pieces`         |    532 | 448 ko | forcée |        |   ●    |             | 532 pièces sur 327 tenants ; seules 36 ont un fichier sur disque |
| `precisions`     |      0 |  64 ko | forcée |        |   ●    |             |                                                                  |
| `token_plan`     |    935 | 680 ko | forcée |        |   ●    |             |                                                                  |

### `catalog`

| Table      | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ---------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `products` |      0 |  24 ko | forcée |        |   ●    |             |      |

### `coffre`

| Table     | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| --------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `objects` |      0 |  32 ko | forcée |        |   ●    |             |      |

### `collab`

| Table                        | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ---------------------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `assignments`                |     24 |  64 ko | oui    |        |   ●    |             |      |
| `charge_questions`           |      0 |  24 ko | forcée |        |   ●    |             |      |
| `encaissements_honoraires`   |     25 |  48 ko | forcée |        |   ●    |             |      |
| `exports`                    |     55 |  80 ko | forcée |        |   ●    |             |      |
| `factures_honoraires`        |     26 |  64 ko | forcée |        |   ●    |             |      |
| `factures_honoraires_lignes` |     74 |  96 ko | forcée |        |   ●    |             |      |
| `mandats_honoraires`         |     29 |  64 ko | forcée |        |   ●    |             |      |
| `notifications`              |    206 | 128 ko | forcée |        |   ●    |             |      |
| `obligations_cabinet`        |      3 |  48 ko | forcée |        |   ●    |             |      |
| `obligations_propres`        |      1 |  48 ko | forcée |        |   ●    |             |      |
| `push_devices`               |      0 |  32 ko | forcée |        |   ●    |             |      |
| `pv_reunions`                |     18 |  88 ko | oui    |        |   ●    |             |      |
| `reglages_cabinet`           |      3 |  48 ko | forcée |        |   ●    |             |      |

### `commissions`

| Table     | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| --------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `entries` |      0 |  24 ko | forcée |        |   ●    |             |      |
| `rules`   |      0 |  24 ko | forcée |        |   ●    |             |      |

### `contracts`

| Table       | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ----------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `contracts` |      0 |  24 ko | forcée |        |   ●    |             |      |

### `identity`

| Table             | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note                                                                    |
| ----------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ----------------------------------------------------------------------- |
| `api_keys`        |     90 | 104 ko | forcée |        |   ●    |             |                                                                         |
| `engagements`     |     15 |  80 ko | forcée |        |   ●    |             |                                                                         |
| `entities`        |     18 |  64 ko | forcée |        |   ●    |             |                                                                         |
| `fiches_fiscales` |     12 |  56 ko | forcée |        |   ●    |             |                                                                         |
| `invitations`     |      7 |  64 ko | forcée |        |   ●    |             |                                                                         |
| `memberships`     |    861 | 312 ko | forcée |        |   ●    |             |                                                                         |
| `organizations`   |    856 | 248 ko | forcée |        |   ●    |             | 842 archivées sur 856 — les tests archivent, ils ne suppriment pas (R7) |
| `profiles`        |      0 |  16 ko | forcée |        |   ●    |             |                                                                         |

### `immo`

| Table           | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| --------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `assets`        |      1 |  48 ko | forcée |        |   ●    |             |      |
| `cessions`      |      0 |  32 ko | forcée |        |   ●    |             |      |
| `depreciations` |      0 |  24 ko | forcée |        |   ●    |             |      |
| `dotations`     |      1 |  64 ko | forcée |        |   ●    |             |      |

### `legal`

| Table                  | Lignes |  Taille | RLS    | Corpus | Métier | Référentiel | Note                                                               |
| ---------------------- | -----: | ------: | ------ | :----: | :----: | :---------: | ------------------------------------------------------------------ |
| `article_versions`     | 16 183 | 59.9 Mo | forcée |   ●    |        |             |                                                                    |
| `articles`             | 11 440 |  5.4 Mo | forcée |   ●    |        |             |                                                                    |
| `articles_extraits`    |      0 |   24 ko | forcée |   ●    |        |             |                                                                    |
| `banque_cas`           |    667 |  328 ko | —      |   ●    |        |             | sans RLS, contrairement au reste de `legal`                        |
| `chunks`               | 31 863 |  522 Mo | forcée |   ●    |        |             | 31 863 fragments, tous rattachés au tarif `qwen3.7-text-embedding` |
| `corpus_noms`          |    156 |   96 ko | forcée |   ●    |        |             |                                                                    |
| `documents`            |      0 |   16 ko | forcée |   ●    |        |             |                                                                    |
| `ingestion_queue`      |    926 |  1.2 Mo | forcée |   ●    |        |             |                                                                    |
| `references_extraites` | 23 631 |  3.4 Mo | forcée |   ●    |        |             |                                                                    |
| `sondages`             | 12 101 |  4.6 Mo | —      |   ●    |        |             | sans RLS, contrairement au reste de `legal`                        |
| `sources`              |      8 |   32 ko | forcée |   ●    |        |             |                                                                    |

### `parametrage`

| Table           | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note                                                                                      |
| --------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ----------------------------------------------------------------------------------------- |
| `accounts`      |      0 |  64 ko | forcée |        |   ●    |             | « paramétrage » par le nom, mais c'est la couche du CABINET (R10) : rattachée à un tenant |
| `role_bindings` |      0 |  64 ko | forcée |        |   ●    |             | idem : surcharge du cabinet, rattachée à un tenant                                        |

### `payments`

| Table      | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ---------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `payments` |      0 |  24 ko | forcée |        |   ●    |             |      |

### `pricing`

| Table         | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `price_lists` |      0 |  24 ko | forcée |        |   ●    |             |      |
| `prices`      |      0 |  32 ko | forcée |        |   ●    |             |      |

### `ref`

| Table                   | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note                                                |
| ----------------------- | -----: | -----: | ------ | :----: | :----: | :---------: | --------------------------------------------------- |
| `account_mappings`      |     10 |  48 ko | forcée |        |        |      ●      |                                                     |
| `account_roles`         |    160 |  72 ko | forcée |        |        |      ●      |                                                     |
| `accounts`              |    626 | 240 ko | forcée |        |        |      ●      | déclencheur `proteger_comptes_officiels` sur UPDATE |
| `anomaly_thresholds`    |      1 |  48 ko | forcée |        |        |      ●      |                                                     |
| `charge_famille_rules`  |     10 |  48 ko | forcée |        |        |      ●      |                                                     |
| `charge_familles`       |      9 |  48 ko | forcée |        |        |      ●      |                                                     |
| `document_types`        |     20 |  32 ko | forcée |        |        |      ●      |                                                     |
| `entry_controls`        |      5 |  32 ko | forcée |        |        |      ●      |                                                     |
| `entry_template_lines`  |    464 | 144 ko | forcée |        |        |      ●      |                                                     |
| `entry_templates`       |    182 |  80 ko | forcée |        |        |      ●      |                                                     |
| `fiscal_charges`        |      2 |  48 ko | forcée |        |        |      ●      |                                                     |
| `fiscal_obligations`    |     43 |  80 ko | forcée |        |        |      ●      |                                                     |
| `fiscal_parameters`     |    454 | 344 ko | forcée |        |        |      ●      |                                                     |
| `fiscal_scale_brackets` |      8 |  32 ko | forcée |        |        |      ●      |                                                     |
| `immo_categories`       |      7 |  48 ko | forcée |        |        |      ●      |                                                     |
| `journals`              |      4 |  32 ko | forcée |        |        |      ●      |                                                     |
| `jurisdiction_packs`    |      1 |  48 ko | forcée |        |        |      ●      |                                                     |
| `labels`                |    108 |  80 ko | forcée |        |        |      ●      |                                                     |
| `mentions`              |     12 |  48 ko | forcée |        |        |      ●      |                                                     |
| `pack_rules`            |      6 |  48 ko | forcée |        |        |      ●      |                                                     |
| `regimes_fiscaux`       |      5 |  48 ko | forcée |        |        |      ●      |                                                     |
| `rejet_motifs`          |      9 |  48 ko | forcée |        |        |      ●      |                                                     |
| `role_bindings`         |    160 |  80 ko | forcée |        |        |      ●      |                                                     |
| `socle_params`          |      6 |  48 ko | forcée |        |        |      ●      |                                                     |
| `stock_categories`      |      5 |  48 ko | forcée |        |        |      ●      |                                                     |
| `tva_rates`             |      5 |  48 ko | forcée |        |        |      ●      |                                                     |

### `schedule`

| Table       | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note                                                                  |
| ----------- | -----: | -----: | ------ | :----: | :----: | :---------: | --------------------------------------------------------------------- |
| `echeances` |    190 | 200 ko | forcée |        |   ●    |             | dérivées du pack par `echeances_deriver`, mais rattachées à un tenant |

### `socle`

| Table             | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ----------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `ecriture_lignes` |    238 | 176 ko | forcée |        |   ●    |             |      |
| `ecritures`       |     79 | 128 ko | forcée |        |   ●    |             |      |

### `stocks`

| Table           | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| --------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `depreciations` |      0 |  32 ko | forcée |        |   ●    |             |      |
| `inventaires`   |      1 |  48 ko | forcée |        |   ●    |             |      |
| `items`         |      1 |  48 ko | forcée |        |   ●    |             |      |
| `mouvements`    |      3 |  64 ko | forcée |        |   ●    |             |      |

### `storage`

| Table     | Lignes | Taille | RLS | Corpus | Métier | Référentiel | Note                                                     |
| --------- | -----: | -----: | --- | :----: | :----: | :---------: | -------------------------------------------------------- |
| `buckets` |      1 |  32 ko | —   |        |        |      ●      | configuration de stockage (une ligne : le seau `pieces`) |
| `objects` |      0 |  24 ko | —   |        |   ●    |             |                                                          |

### `tiers`

| Table         | Lignes | Taille | RLS    | Corpus | Métier | Référentiel | Note |
| ------------- | -----: | -----: | ------ | :----: | :----: | :---------: | ---- |
| `auxiliaires` |     12 |  64 ko | forcée |        |   ●    |             |      |

### Le référentiel : préserver, pas recharger

Je recommande de **préserver** les 26 tables de `ref`, `agents.model_pricing` et `storage.buckets`, sans les recharger. Quatre raisons :

1. **Aucune donnée métier n'y est entrée.** Aucune table de `ref` n'a de colonne `tenant_id`, `user_id` ou `created_by`. La couche que le cabinet surcharge (R10) vit ailleurs, dans `parametrage.*`, et elle est classée métier.
2. **Elles n'ont été écrites que par les migrations.** Les seuls fichiers du dépôt qui écrivent dans `ref.*` sont des migrations (liste en §5), plus les deux fichiers de `db/seed/`. Les dates de création relevées concordent : `ref.jurisdiction_packs` le 31 août à 12:34, `ref.document_types` le 8 septembre à 12:21:43 — la minute même où la migration correspondante figure dans `app.migrations`.
3. **Recharger voudrait dire rejouer les migrations**, donc réécrire `app.migrations` — ce que votre règle interdit — ou réexécuter à la main des scripts dont l'idempotence n'est pas garantie.
4. **Le pack est cohérent avec le code.** Un seul pack en vigueur, `TN 2026.1`, devise `TND`, avec `money.decimals` que le solveur des montants lit depuis le 10 septembre.

Limite, dite franchement : je n'ai pas comparé le contenu de `ref` ligne à ligne avec ce que les migrations sèment. Une modification manuelle hors migration ne se verrait pas dans cet audit. Si vous voulez cette garantie, c'est une étape à part : monter une base vierge par `db/migrer.mjs` et comparer les deux `ref`.

## 3. Graphe des clés étrangères entre tables métier

Calculé à partir des 188 contraintes. Seules les relations entre tables métier (et « à trancher ») comptent pour l'ordre ; les références vers `ref` et `legal` n'imposent rien, puisque ces tables restent.

Le niveau d'une table est la longueur du plus long chemin qui la mène à une racine. **On supprime du niveau le plus haut au niveau 0.**

**Niveau 4 — les feuilles, en premier** (11 tables)

- `banque.lettrage_etat` (1) → `banque.releve_lignes`, `identity.organizations`, `socle.ecritures`
- `banque.lettrages` (40) → `banque.releve_lignes`, `identity.organizations`, `socle.ecritures`
- `banque.rapprochements` (0) → `banque.releve_lignes`, `identity.organizations`, `socle.ecritures`
- `capture.citations` (113) → `capture.pieces`, `capture.token_plan`, `identity.organizations`
- `immo.cessions` (0) → `identity.organizations`, `immo.assets`, `socle.ecritures`
- `immo.depreciations` (0) → `identity.organizations`, `immo.assets`, `socle.ecritures`
- `immo.dotations` (1) → `identity.organizations`, `immo.assets`, `socle.ecritures`
- `socle.ecriture_lignes` (238) → `identity.organizations`, `socle.ecritures`
- `stocks.depreciations` (0) → `identity.organizations`, `socle.ecritures`, `stocks.items`
- `stocks.inventaires` (1) → `identity.organizations`, `socle.ecritures`, `stocks.items`
- `stocks.mouvements` (3) → `capture.pieces`, `identity.organizations`, `socle.ecritures`, `stocks.items`

**Niveau 3** (19 tables)

- `agents.agent_runs` (11) → `capture.pieces`, `identity.organizations`
- `agents.arbitrages` (49) → `agents.conversation_messages`, `agents.conversations`, `identity.organizations`
- `agents.reponse_controles` (6) → `agents.conversation_messages`, `identity.organizations`
- `agents.reponse_verdicts` (0) → `agents.conversation_messages`, `identity.organizations`
- `banque.releve_lignes` (5) → `banque.comptes`, `identity.organizations`
- `billing.invoice_lines` (0) → `billing.invoices`, `catalog.products`, `identity.organizations`
- `capture.conformite` (39) → `capture.pieces`, `identity.organizations`
- `capture.extractions` (18) → `capture.pieces`, `identity.organizations`
- `capture.piece_articles` (23) → `capture.pieces`, `identity.entities`, `identity.organizations`
- `capture.piece_versions` (0) → `capture.pieces`, `identity.organizations`
- `capture.precisions` (0) → `capture.pieces`, `identity.organizations`
- `capture.token_plan` (935) → `capture.pieces`, `identity.organizations`
- `collab.encaissements_honoraires` (25) → `collab.factures_honoraires`, `identity.organizations`
- `collab.factures_honoraires_lignes` (74) → `collab.factures_honoraires`, `identity.organizations`
- `commissions.entries` (0) → `billing.invoices`, `commissions.rules`, `identity.organizations`
- `identity.fiches_fiscales` (12) → `capture.pieces`, `identity.organizations`
- `immo.assets` (1) → `capture.pieces`, `identity.entities`, `identity.organizations`
- `payments.payments` (0) → `billing.invoices`, `identity.organizations`
- `socle.ecritures` (79) → `capture.pieces`, `identity.entities`, `identity.organizations`

**Niveau 2** (9 tables)

- `agents.conversation_messages` (289) → `agents.conversations`
- `banque.comptes` (3) → `identity.entities`, `identity.organizations`
- `billing.invoices` (0) → `identity.entities`, `identity.organizations`
- `capture.pieces` (532) → `identity.entities`, `identity.organizations`
- `collab.factures_honoraires` (26) → `collab.mandats_honoraires`, `identity.organizations`
- `pricing.prices` (0) → `catalog.products`, `identity.organizations`, `pricing.price_lists`
- `schedule.echeances` (190) → `identity.entities`, `identity.organizations`
- `stocks.items` (1) → `identity.entities`, `identity.organizations`
- `tiers.auxiliaires` (12) → `identity.entities`, `identity.organizations`

**Niveau 1** (29 tables)

- `agents.budgets` (0) → `identity.organizations`
- `agents.conversations` (189) → `identity.organizations`
- `app.signalements` (32) → `identity.organizations`
- `audit.event_log` (3 070) → `identity.organizations`
- `auth.refresh_tokens` (123) → `auth.users`
- `billing.invoice_sequences` (0) → `identity.organizations`
- `catalog.products` (0) → `identity.organizations`
- `coffre.objects` (0) → `identity.organizations`
- `collab.assignments` (24) → `auth.users`, `identity.organizations`
- `collab.charge_questions` (0) → `identity.organizations`
- `collab.exports` (55) → `identity.organizations`
- `collab.mandats_honoraires` (29) → `identity.organizations`
- `collab.notifications` (206) → `identity.organizations`
- `collab.obligations_cabinet` (3) → `identity.organizations`
- `collab.obligations_propres` (1) → `identity.organizations`
- `collab.push_devices` (0) → `identity.organizations`
- `collab.pv_reunions` (18) → `identity.organizations`
- `collab.reglages_cabinet` (3) → `identity.organizations`
- `commissions.rules` (0) → `identity.organizations`
- `contracts.contracts` (0) → `identity.organizations`
- `identity.api_keys` (90) → `identity.organizations`
- `identity.engagements` (15) → `identity.organizations`
- `identity.entities` (18) → `identity.organizations`
- `identity.invitations` (7) → `identity.organizations`
- `identity.memberships` (861) → `identity.organizations`
- `parametrage.accounts` (0) → `identity.organizations`
- `parametrage.role_bindings` (0) → `identity.organizations`
- `pricing.price_lists` (0) → `identity.organizations`
- `storage.objects` (0) → `auth.users`

**Niveau 0 — les racines** (4 tables)

- `app.platform_operators` (1)
- `auth.users` (1 089)
- `identity.organizations` (856)
- `identity.profiles` (0)

Ce que l'ordre ne dit pas, et qui compte :

- **Presque tout remonte à `identity.organizations` en `ON DELETE CASCADE`.** Supprimer une organisation emporte en principe tout son dossier — mais les déclencheurs R7 des tables dépendantes refusent la cascade ligne à ligne (§4). La cascade n'est pas un raccourci utilisable par `DELETE`.
- **Quatre auto-références** : `socle.ecritures.reverses_id`, `billing.invoices.reverses_id`, `collab.factures_honoraires.avoir_de`, `auth.refresh_tokens.remplace_par`, toutes en `NO ACTION`. Par `DELETE`, l'ordre à l'intérieur d'une même table compte ; par `TRUNCATE`, non.
- **Deux `RESTRICT`** entre tables métier : `collab.encaissements_honoraires → collab.factures_honoraires`, `commissions.entries → commissions.rules`.
- **Des `user_id` sans contrainte.** `identity.memberships.user_id`, `identity.organizations.created_by`, `app.platform_operators.user_id`, `app.signalements.user_id` et les `created_by` ne portent pas de clé étrangère vers `auth.users`. Vider `auth.users` sans ces tables laisserait des références orphelines que la base ne signalerait pas.
- **Aucune séquence métier à réinitialiser** : les tables métier sont indexées par UUID. La seule séquence de la base appartient au corpus (`legal.articles_extraits_id_seq`).

## 4. Les gardes R7 qui refusent la suppression

| Table                               | Déclencheur                              | Fonction                                     |
| ----------------------------------- | ---------------------------------------- | -------------------------------------------- |
| `agents.agent_runs`                 | `agents_agent_runs_no_upd`               | `app.deny_mutation`                          |
| `agents.reponse_controles`          | `reponse_controles_no_upd`               | `app.deny_mutation`                          |
| `audit.event_log`                   | `audit_event_log_no_upd`                 | `app.deny_mutation`                          |
| `banque.lettrages`                  | `banque_lettrages_no_upd`                | `app.deny_mutation`                          |
| `banque.rapprochements`             | `banque_rapprochements_no_upd`           | `app.deny_mutation`                          |
| `billing.invoice_lines`             | `invoice_lines_freeze`                   | `billing.freeze_issued_lines`                |
| `billing.invoices`                  | `invoices_freeze`                        | `billing.freeze_issued`                      |
| `capture.citations`                 | `capture_citations_no_upd`               | `app.deny_mutation_hors_effacement_de_piece` |
| `capture.conformite`                | `capture_conformite_no_upd`              | `app.deny_mutation_hors_effacement_de_piece` |
| `capture.extractions`               | `capture_extractions_no_upd`             | `app.deny_mutation_hors_effacement_de_piece` |
| `capture.piece_versions`            | `capture_piece_versions_no_upd`          | `app.deny_mutation_hors_effacement_de_piece` |
| `capture.precisions`                | `capture_precisions_no_upd`              | `app.deny_mutation_hors_effacement_de_piece` |
| `capture.token_plan`                | `capture_token_plan_no_upd`              | `app.deny_mutation_hors_effacement_de_piece` |
| `coffre.objects`                    | `coffre_objects_no_upd`                  | `app.deny_mutation`                          |
| `collab.encaissements_honoraires`   | `collab_encaissements_honoraires_no_upd` | `app.deny_mutation`                          |
| `collab.exports`                    | `collab_exports_no_upd`                  | `app.deny_mutation`                          |
| `collab.factures_honoraires`        | `factures_honoraires_figee`              | `app.honoraires_facture_figee`               |
| `collab.factures_honoraires_lignes` | `factures_honoraires_lignes_figees`      | `app.honoraires_ligne_figee`                 |
| `collab.pv_reunions`                | `pv_reunions_fige`                       | `collab.pv_figer`                            |
| `identity.api_keys`                 | `api_keys_garde`                         | `identity.api_keys_garde`                    |
| `immo.cessions`                     | `immo_cessions_no_upd`                   | `app.deny_mutation`                          |
| `immo.depreciations`                | `immo_depreciations_no_upd`              | `app.deny_mutation`                          |
| `immo.dotations`                    | `immo_dotations_no_upd`                  | `app.deny_mutation`                          |
| `socle.ecriture_lignes`             | `lignes_freeze`                          | `socle.freeze_lignes`                        |
| `stocks.depreciations`              | `stocks_depreciations_no_upd`            | `app.deny_mutation`                          |
| `stocks.inventaires`                | `stocks_inventaires_no_upd`              | `app.deny_mutation`                          |

`app.deny_mutation` refuse sans exception. `app.deny_mutation_hors_effacement_de_piece` a une seule porte : la cascade d'une pièce que `capture_piece_supprimer` a validée, reconnue par le réglage de session `malica.piece_effacable`. `socle.freeze_lignes` ne refuse que les lignes d'une écriture comptabilisée ; `collab.pv_figer`, qu'un PV envoyé.

## 5. Les fichiers du dépôt qui écrivent dans ces tables

Relevé sur les sources (449 fichiers), deux façons d'écrire : du SQL direct, ou l'appel d'une fonction SQL qui écrit elle-même. L'API passe presque toujours par ces fonctions ; le rapprochement fonction → tables vient du corps des fonctions en base.

### Les routes de l'API

| Fichier                                | Par                                                                                                                                                                                                                                                                                       | Tables écrites                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/auth.ts`                 | SQL direct                                                                                                                                                                                                                                                                                | `auth.refresh_tokens`, `auth.users`                                                                                                                                           |
| `apps/api/src/cles-api.ts`             | `public.api_key_resoudre`                                                                                                                                                                                                                                                                 | `identity.api_keys`                                                                                                                                                           |
| `apps/api/src/depots/banque.ts`        | `public.banque_delettrer`, `public.banque_lettrer`                                                                                                                                                                                                                                        | `audit.event_log`, `banque.lettrage_etat`, `banque.lettrages`, `banque.releve_lignes`                                                                                         |
| `apps/api/src/depots/capture.ts`       | `public.agents_run_log`, `public.capture_articles_persist`, `public.capture_piece_register`, `public.capture_piece_supprimer`, `public.capture_precision_persist`, `public.capture_read_persist`                                                                                          | `agents.agent_runs`, `audit.event_log`, `capture.citations`, `capture.extractions`, `capture.piece_articles`, `capture.pieces`, `capture.precisions`, `capture.token_plan`    |
| `apps/api/src/depots/charges.ts`       | `public.charge_question_answer`                                                                                                                                                                                                                                                           | `audit.event_log`, `collab.charge_questions`                                                                                                                                  |
| `apps/api/src/depots/collab.ts`        | `public.cabinet_inviter`, `public.capture_piece_set_vis`, `public.collab_assign`, `public.echeance_marquer`, `public.echeances_deriver`, `public.invitation_repondre`, `public.pv_envoyer`                                                                                                | `audit.event_log`, `capture.pieces`, `collab.assignments`, `collab.notifications`, `collab.pv_reunions`, `identity.invitations`, `identity.memberships`, `schedule.echeances` |
| `apps/api/src/depots/conseil.ts`       | `public.arbitrage_creer`, `public.arbitrage_decider`                                                                                                                                                                                                                                      | `agents.arbitrages`, `agents.conversation_messages`, `audit.event_log`, `collab.notifications`                                                                                |
| `apps/api/src/depots/conversations.ts` | SQL direct                                                                                                                                                                                                                                                                                | `agents.conversation_messages`, `agents.conversations`, `agents.reponse_controles`, `agents.reponse_verdicts`                                                                 |
| `apps/api/src/depots/exports.ts`       | `public.export_journaliser`                                                                                                                                                                                                                                                               | `audit.event_log`, `collab.exports`                                                                                                                                           |
| `apps/api/src/depots/honoraires.ts`    | `public.honoraires_avoir`, `public.honoraires_brouillon_creer`, `public.honoraires_brouillon_modifier`, `public.honoraires_brouillon_supprimer`, `public.honoraires_encaisser`, `public.honoraires_facture_emettre`, `public.honoraires_mandat_clore`, `public.honoraires_mandat_definir` | `audit.event_log`, `collab.encaissements_honoraires`, `collab.factures_honoraires`, `collab.factures_honoraires_lignes`, `collab.mandats_honoraires`                          |
| `apps/api/src/depots/identite.ts`      | SQL direct, `public.create_organization`, `public.mandat_proposer`, `public.mandat_repondre`, `public.organisation_definir`                                                                                                                                                               | `audit.event_log`, `collab.notifications`, `identity.engagements`, `identity.fiches_fiscales`, `identity.memberships`, `identity.organizations`                               |
| `apps/api/src/depots/immo.ts`          | `public.immo_depreciation_constater`, `public.immo_dotation_constater`                                                                                                                                                                                                                    | `audit.event_log`, `immo.depreciations`, `immo.dotations`, `socle.ecriture_lignes`, `socle.ecritures`                                                                         |
| `apps/api/src/depots/integrations.ts`  | `public.api_key_creer`, `public.api_key_revoquer`                                                                                                                                                                                                                                         | `audit.event_log`, `identity.api_keys`                                                                                                                                        |
| `apps/api/src/depots/office.ts`        | `public.socle_ecriture_book`, `public.socle_ecriture_propose`                                                                                                                                                                                                                             | `audit.event_log`, `capture.pieces`, `socle.ecriture_lignes`, `socle.ecritures`                                                                                               |
| `apps/api/src/depots/parametrage.ts`   | SQL direct, `public.cabinet_mise_en_route_terminer`, `public.cabinet_obligation_definir`, `public.cabinet_obligation_propre_creer`, `public.cabinet_reglages_definir`                                                                                                                     | `audit.event_log`, `collab.obligations_cabinet`, `collab.obligations_propres`, `collab.reglages_cabinet`, `parametrage.accounts`, `parametrage.role_bindings`                 |
| `apps/api/src/depots/signalements.ts`  | SQL direct                                                                                                                                                                                                                                                                                | `app.signalements`                                                                                                                                                            |
| `apps/api/src/depots/stocks.ts`        | `public.stocks_depreciation_constater`, `public.stocks_inventaire_constater`                                                                                                                                                                                                              | `audit.event_log`, `socle.ecriture_lignes`, `socle.ecritures`, `stocks.depreciations`, `stocks.inventaires`                                                                   |
| `apps/api/src/depots/supervision.ts`   | `public.socle_ecriture_review`                                                                                                                                                                                                                                                            | `audit.event_log`, `capture.conformite`, `capture.pieces`, `collab.notifications`, `socle.ecriture_lignes`, `socle.ecritures`                                                 |

Limite du relevé : une fonction qui en appelle une autre n'est suivie que sur un niveau. `public.banque_book_lignes`, appelée par `banque.ts`, ne contient aucune écriture directe dans son corps : si elle écrit, c'est par une autre fonction, et ses tables n'apparaissent pas ci-dessus. La colonne « Tables écrites » est un minimum, pas un inventaire complet.

`apps/web` n'écrit rien en base : les occurrences relevées (`collab.assignments(…)`, `collab.notifications(…)`) sont des appels au client de l'API, pas du SQL.

### Les scripts qui peuplent le métier — tous par l'API

- `outils/jeu-de-donnees.mjs` — le Cabinet Ben Salah, ses quatre collaborateurs et six PME (SOTUMAG, Medina Textile, Cléopâtre Voyages, TunisFresh, Atelier Zitouna, Nabeul Céramique). Par `/auth/inscription` et `/rpc`.
- `db/dev/jeu_dessai.mjs` — `dev@malica.local`, CABINET MALICA, DREAM OPTIC, ATLAS DISTRIBUTION. Par `/rpc`.
- `outils/epreuve-bout-en-bout.mjs` et `outils/epreuves/*.mjs` — les organisations « ÉPREUVE … SARL » et les comptes `epreuve.*@malica.local`, `visuel.assistant@malica.local`. Par l'API.

### Les scripts qui écrivent en direct

- `outils/operateur-plateforme.mjs` — `app.platform_operators`.
- `db/pilote/purger-pieces.mjs` — efface les **fichiers** d'un tenant sur disque, consigne dans `app.signalements`.
- `db/verification/banc_essai.sql` — insère dans `capture.pieces`, `capture.token_plan`, `capture.citations`, `socle.ecritures`, `socle.ecriture_lignes`.
- `db/migrer.mjs` — `app.migrations`.
- `db/local/00_compat_supabase.sql` — `storage.buckets`.
- `db/seed/plan_comptable_tn_1a4.sql`, `db/seed/plan_comptable_tn_5a7.sql` — `ref.accounts`.
- `db/local/charger.ps1 -Recreate` — **supprime la base entière**, corpus compris, puis rejoue les migrations. À ne pas lancer.

### Les tests qui écrivent dans la base locale

`apps/api/src/auth.ts` (`creerCompte`) insère dans `auth.users` ; les tests l'appellent à chaque exécution. En SQL direct : `depots.test.ts`, `cles-api.test.ts`, `stockage.test.ts` (archivage des organisations), `isolation.test.ts` (`capture.pieces`, `agents.conversations`, `agents.conversation_messages`).

### Les scripts du corpus — hors périmètre, à ne pas lancer pendant la remise à zéro

`db/corpus/charger.ps1` (**`TRUNCATE legal.references_extraites`**), `db/corpus/reconstruire.mjs` et `db/corpus/notes.mjs` (**`DELETE` sur `legal.articles` et `legal.article_versions`**), `db/corpus/vectoriser.mjs`, `db/corpus/completer.sql`, et `db/verification/.diag3.sql` (non suivi par git, insère dans `legal`).

### Les migrations

Elles écrivent dans `ref.*` (les semis du référentiel) et dans `legal.*` (corpus), et **définissent** les fonctions qui écrivent dans le métier. Quelques-unes corrigent des lignes métier existantes (par exemple `20260831100000_devise_du_pack_et_defauts_retires.sql` sur `identity.organizations`) : sans effet après la remise à zéro, et elles ne rejoueront pas, puisqu'`app.migrations` est conservée.

| Table du référentiel        | Migrations qui la sèment                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `agents.model_pricing`      | 20260825235433, 20260826163000, 20260901090000                                                                 |
| `ref.account_mappings`      | 20260824132104                                                                                                 |
| `ref.account_roles`         | 20260831120300, 20260831120400                                                                                 |
| `ref.accounts`              | 20260824132104, 20260826133602, 20260826135849, 20260831110000, 20260831120000, 20260831120100, 20260831120200 |
| `ref.anomaly_thresholds`    | 20260826141710                                                                                                 |
| `ref.charge_famille_rules`  | 20260826141710                                                                                                 |
| `ref.charge_familles`       | 20260826141710                                                                                                 |
| `ref.document_types`        | 20260902180000                                                                                                 |
| `ref.entry_controls`        | 20260831120300, 20260831120400                                                                                 |
| `ref.entry_template_lines`  | 20260831120300, 20260831120400                                                                                 |
| `ref.entry_templates`       | 20260831120300, 20260831120400                                                                                 |
| `ref.fiscal_charges`        | 20260826133602, 20260826135849, 20260831110000                                                                 |
| `ref.fiscal_obligations`    | 20260831120700                                                                                                 |
| `ref.fiscal_parameters`     | 20260831120600                                                                                                 |
| `ref.fiscal_scale_brackets` | 20260831120600                                                                                                 |
| `ref.immo_categories`       | 20260825213940, 20260825220306                                                                                 |
| `ref.journals`              | 20260831120300                                                                                                 |
| `ref.jurisdiction_packs`    | 20260824132104, 20260831100000                                                                                 |
| `ref.labels`                | 20260824132104, 20260826133602, 20260826141710                                                                 |
| `ref.mentions`              | 20260824132104                                                                                                 |
| `ref.pack_rules`            | 20260824132104                                                                                                 |
| `ref.regimes_fiscaux`       | 20260901210000                                                                                                 |
| `ref.rejet_motifs`          | 20260824132104                                                                                                 |
| `ref.role_bindings`         | 20260831120300, 20260831120400                                                                                 |
| `ref.socle_params`          | 20260825213940                                                                                                 |
| `ref.stock_categories`      | 20260825221225                                                                                                 |
| `ref.tva_rates`             | 20260824132104                                                                                                 |

## 6. Ce que je n'arrive pas à classer

1. **`app.platform_operators`** (1 ligne). C'est de la configuration de plateforme — elle décide qui voit tout, par `app.is_platform()` dans les politiques de lecture — mais elle désigne un compte, `dev@malica.local`, par un `user_id` sans clé étrangère. Si l'on vide `auth.users`, elle reste et pointe dans le vide. Deux options : la vider avec le métier puis relancer `outils/operateur-plateforme.mjs` une fois le compte recréé, ou garder `dev@malica.local`.
2. **`audit.event_log`** (3 070 lignes). Métier par son rattachement (`tenant_id`), mais c'est la piste d'audit, déclarée inviolable par R7. Sur une base locale d'essais, la vider est cohérent avec la remise à zéro ; je ne le décide pas à votre place.
3. **`db/seed/plan_comptable_tn_1a4.sql` et `_5a7.sql`**. Ce ne sont pas des tables, mais ils décident de « recharger ». Hors du dossier des migrations, donc absents d'`app.migrations` : je ne sais pas s'ils ont été appliqués, s'ils recoupent `20260831120100_plan_officiel_nc01.sql`, ni s'ils sont idempotents. Raison de plus pour préserver `ref.accounts` plutôt que de la recharger.
4. **Les fichiers de pièces sur disque** (36 fichiers, 6 dossiers). Du métier hors base, que ni un `TRUNCATE` ni un `DELETE` n'atteignent.

Comptes qui ne sont pas des comptes de test, et qui disparaîtraient avec `auth.users` :

| Compte                                    | Créé le    | Appartenances |
| ----------------------------------------- | ---------- | ------------: |
| `dev@malica.local` — opérateur plateforme | 2026-08-30 |             6 |
| `epreuve.collaborateur@malica.local`      | 2026-09-03 |             1 |
| `epreuve.dirigeant@malica.local`          | 2026-09-03 |             1 |
| `visuel.assistant@malica.local`           | 2026-09-03 |             1 |
| `leila.bensalah@bensalah.tn`              | 2026-09-04 |             1 |
| `amine.bouzid@bensalah.tn`                | 2026-09-04 |             1 |
| `nour.khelifi@bensalah.tn`                | 2026-09-04 |             1 |
| `sana.trabelsi@bensalah.tn`               | 2026-09-04 |             1 |
| `contact@sotumag.tn`                      | 2026-09-04 |             1 |
| `contact@medina-textile.tn`               | 2026-09-04 |             1 |
| `contact@cleopatre-voyages.tn`            | 2026-09-04 |             1 |
| `contact@tunisfresh.tn`                   | 2026-09-04 |             1 |
| `contact@atelier-zitouna.tn`              | 2026-09-04 |             1 |
| `contact@nabeul-ceramique.tn`             | 2026-09-04 |             1 |

Tous sont recréables par les scripts de la section 5 ; aucun n'est un compte réel.

**Mais trois outils en dépendent par leur adresse.** Les parcours Playwright (`apps/web/e2e/comptes.ts`), le parcours Maestro du téléphone (`android/maestro/connexion.yaml`) et l'outil de captures (`outils/captures.mjs`) se connectent avec `contact@sotumag.tn` (le dirigeant de SOTUMAG) et `leila.bensalah@bensalah.tn` (l'experte du Cabinet Ben Salah). Après la remise à zéro, ils échoueront tant que `outils/jeu-de-donnees.mjs` n'aura pas été rejoué — ou tant que les nouveaux parcours d'onboarding n'auront pas recréé des comptes que ces trois fichiers connaissent.

## 7. Les questions à trancher avant l'étape 1

1. **`TRUNCATE` ou `DELETE`.** `TRUNCATE` passe les gardes R7 par construction ; `DELETE` exigerait de les désactiver le temps de l'opération. Dans les deux cas, c'est un geste d'administration à réserver à la base locale — je propose qu'il refuse de s'exécuter si la base ne s'appelle pas `malica_local`.
2. **La base des tests.** Garder les tests sur `malica_local` repollue le métier à chaque exécution. Une base dédiée, ou des tests qui travaillent dans une transaction annulée ?
3. **`app.platform_operators` et `dev@malica.local`** : on vide, ou on garde ?
4. **`audit.event_log`** : on vide avec le reste ?
5. **Les fichiers de pièces** : on purge `STOCKAGE_RACINE` en même temps ?
6. **Les comptes des parcours automatisés** : on rejoue le jeu de données juste après la remise à zéro, pour que Playwright, Maestro et les captures retrouvent SOTUMAG et le Cabinet Ben Salah — ou on les réécrit sur les comptes que créeront les nouveaux parcours d'onboarding ?
7. **La vérification du référentiel** (§2) : on compare `ref` à une base vierge avant de s'y fier, ou on l'accepte tel quel ?

Rien ne bloque dans vos règles : préserver `legal` et `app.migrations` est compatible avec tout ce qui précède. Le seul point où la règle devra être tenue activement, c'est `agents.model_pricing` — la tentation d'un `TRUNCATE … CASCADE` large.
