# L'architecture telle qu'elle est — 4 octobre 2026

Relevé sur **la base du staging** (`staging.malica-office.algoria-factory.com`,
Hetzner CX23, 103 migrations appliquées) et dans le code, jamais dans la
documentation. Lecture seule : rien n'a été modifié.

Le staging porte l'essai réel du 4 octobre : **une pièce, une lecture, une
analyse, une conversation de six messages, deux arbitrages**. C'est peu, et
c'est précieux : chaque anomalie a laissé sa trace.

---

## 1. Les données

### 1.1 Ce qui existe, et ce qu'il pèse

| Table                                 |                   Lignes (staging) |     Taille | Rôle                                              |
| ------------------------------------- | ---------------------------------: | ---------: | ------------------------------------------------- |
| `capture.pieces`                      |                              **1** |      96 kB | la pièce : empreinte, chemin, statut, visibilité  |
| `capture.token_plan`                  |                            **171** |     136 kB | les jetons relevés par l'œil, avec leur géométrie |
| `capture.extractions`                 |                              **1** |      64 kB | la lecture : `payload` jsonb, confiance par champ |
| `capture.analyses`                    |                              **1** |      80 kB | le jugement : verdict motivé                      |
| `capture.citations`                   |                              **5** |      80 kB | quel jeton justifie quel champ (R2)               |
| `capture.precisions`                  |                                  0 |      32 kB | les confirmations humaines (type de pièce)        |
| `capture.conformite`                  |                                  0 |      32 kB | les contrôles de forme                            |
| `capture.piece_versions`              |                                  0 |      32 kB | versions d'une pièce                              |
| `socle.ecritures` / `ecriture_lignes` |                      **0** / **0** |      40 kB | l'écriture comptable                              |
| `identity.organizations`              |                              **2** |      32 kB | AUDICORP (cabinet), ALGORIA FACTORY (pme)         |
| `identity.engagements`                |                              **1** |      80 kB | **le mandat**                                     |
| `identity.memberships`                |                                  2 |      64 kB | qui appartient à quelle organisation              |
| `auth.users`                          |                              **1** |      48 kB | `w.barouni@algoria-factory.com`                   |
| `agents.conversations`                |                                  1 |      48 kB | le fil avec Malica                                |
| `agents.conversation_messages`        |                              **6** |      64 kB | 3 questions, 3 réponses                           |
| `agents.arbitrages`                   |                              **2** |      64 kB | **la file de relecture du cabinet**               |
| `agents.agent_runs`                   |                                  4 |      64 kB | le journal de coût des appels                     |
| `legal.*`                             | 11 440 articles · 31 863 fragments | **913 MB** | le corpus juridique                               |

La base entière pèse ~950 Mo, dont **96 %** de corpus.

### 1.2 Le client de référence pour l'isolement : **l'organisation**, pas le dossier

Aujourd'hui, la clé de cloisonnement est `tenant_id`, qui pointe
`identity.organizations` — une organisation étant soit une PME, soit un
cabinet. Il n'existe **aucune notion de « dossier »** distincte de la PME :
la PME _est_ le dossier.

Le cloisonnement est tenu **par la base**, pas par le code applicatif :

|                            |         |
| -------------------------- | ------- |
| Tables portant `tenant_id` | **63**  |
| …avec RLS **activée**      | **63**  |
| …avec RLS **forcée**       | **63**  |
| Politiques                 | **276** |

Six fonctions le décident : `app.member_orgs()` (mes organisations),
`app.engaged_orgs()` (celles que je sers par mandat), `app.cabinets_de_mes_orgs()`,
`app.mandats_visibles()`, `app.has_org_role()`, `app.is_platform()`.

**Est-ce testé ?** Oui, à deux niveaux. `isolation.test.ts` prouve le
comportement sur des tables nommées (un tiers ne voit ni l'organisation, ni la
pièce, ni la conversation d'un autre ; le rôle de connexion ne contourne pas la
RLS). Et depuis le 4 octobre, `schema.test.ts` tient l'invariant sur **les 63
tables**, présentes et à venir : RLS activée ET forcée ET au moins une
politique, et aucune politique inconditionnelle.

### 1.3 Le rattachement d'une PME à un cabinet

`identity.engagements` :

```
id · pme_org_id → organizations · cabinet_org_id → organizations
status · starts_on (date) · ends_on (date, nullable) · created_by · created_at · updated_at
```

Le mandat réel du staging :

```
pme ALGORIA FACTORY → cabinet AUDICORP · status « actif » · depuis 2026-10-04 · fin : aucune
```

**Changement de cabinet** : la table porte déjà `starts_on`/`ends_on`, donc
plusieurs engagements successifs sont représentables, et `mandat_proposer`
sait reproposer un mandat terminé. **L'historique survit** : les pièces
appartiennent à la PME (`tenant_id` = la PME), pas au cabinet — un changement
de cabinet ne déplace aucune donnée.

**Ce qui manque** par rapport à la cible : le mandat ne porte **aucun droit**
(pas de colonne de permissions), et rien ne borne l'accès de l'ancien cabinet
**à la période qu'il a traitée** : `app.mandats_visibles()` raisonne sur le
mandat, pas sur la période de la pièce.

### 1.4 Y a-t-il duplication d'une pièce ?

**Non.** Une pièce existe en un seul exemplaire, `tenant_id` = la PME. Le
cabinet la voit par jointure sur le mandat, jamais par copie. Les 42 clés
étrangères du parcours convergent toutes vers `capture.pieces(id)`, en
`on delete cascade`.

Une colonne `doublon_de` existe déjà sur `capture.pieces`, et l'empreinte
SHA-256 est calculée au dépôt : **la déduplication par empreinte est en place**
(une pièce redéposée à l'identique est acceptée ; un contenu différent sous la
même clé est refusé en 409).

---

## 2. Les fichiers

**Aucun binaire n'est en base.** Vérifié : zéro colonne `bytea` dans tout le
schéma.

Les pièces vivent sur le **disque du serveur**, montées dans l'API sous
`/pieces` (`STOCKAGE_RACINE`), un fichier par pièce, rangé
`<racine>/<tenant_id>/<piece_id>` :

```
/srv/malica/pieces/294d4e2e-…/afcd341b-…   186 480 octets
total : 192 Ko · 1 fichier
```

Ce n'est **pas un stockage objet** : c'est un volume local, sauvegardé par
restic vers une Storage Box (toutes les 6 h, 54 instantanés, rétention
24 h/14 j/8 s/12 m).

### Ce que contient la pièce réelle, mesuré

|                           |                                                                      |
| ------------------------- | -------------------------------------------------------------------- |
| Format                    | **PDF 1.7**, une page, une image                                     |
| Compression               | **DCTDecode** (JPEG) — le JPEG fait 185 624 o, soit **100 %** du PDF |
| Espace de couleur déclaré | **DeviceRGB**                                                        |
| Dimensions                | **1287 × 1800 px**                                                   |
| Poids                     | **182 Ko**                                                           |
| Moyenne RVB               | 244, 244, 244                                                        |
| **Saturation moyenne**    | **0**                                                                |

Deux conclusions qui comptent pour la suite. D'abord, **l'évolution 4 est déjà
faite aux trois quarts** : PDF, JPEG, côté long à 1800 px, 182 Ko — sous la
cible de 300 Ko. Ensuite, **saturation 0 : l'image est en gris pur**, écrite
dans un conteneur RVB. Le code le dit (`apps/web/src/capabilities/scanner.ts`,
`normalizeForReading`) : « passage en niveaux de gris avec étirement de
dynamique […] la page pèse deux à trois fois moins pour une lisibilité
supérieure ». Réglages en vigueur : `MAX_SIDE = 1800`,
`PAGE_BYTES_BUDGET = 190 000`, `JPEG_QUALITY_MAX = 0.78`, `MIN = 0.42`.

C'est un choix délibéré et documenté — qui **contredit ta règle** « l'utilisateur
voit et l'archive conserve la couleur ».

---

## 3. Les flux

### 3.1 Le parcours d'une pièce

```
① CAPTURE            apps/web/src/capabilities/scanner.ts
   caméra → détection du quadrilatère → redressement → MAX_SIDE 1800
   → normalizeForReading() : NIVEAUX DE GRIS + étirement
   → JPEG qualité 0,78 → 0,42 jusqu'à tenir dans 190 000 octets
   → PDF une page                                        (aucune table)

② DÉPÔT              apps/api/src/stockage.ts   POST /pieces/:id/contenu
   flux haché en SHA-256 pendant l'écriture → renommage atomique
   → capture_sceller_empreinte                 écrit : capture.pieces
   fichier : <racine>/<tenant>/<piece>         statut « recue », vis « personnel »

③ RELEVÉ (l'œil)     apps/api/src/malica/lecture/qwen.ts
   couche de texte du PDF si elle existe, sinon Qwen-VL-OCR
                                               écrit : capture.token_plan (171)

④ DÉSIGNATION        apps/api/src/malica/lecture/vision.ts (deepseek-reasoner)
   ne voit JAMAIS la pièce — seulement le plan de jetons (R2)
                                               écrit : capture.extractions
                                                       capture.citations (5)

⑤ JUGEMENT           apps/api/src/scan/{normaliser-montants,controles,analyse}.ts
   sept contrôles à motif obligatoire → verdict
                                               écrit : capture.analyses (1)
                                               statut de la pièce → « lue »

⑥ ÉCRITURE PROPOSÉE  apps/api/src/scan/proposition.ts → depots/office.ts
   calculée par le SERVEUR, au paramétrage daté de la pièce
                                               écrit : socle.ecritures (0 ici)

⑦ VISIBILITÉ CABINET apps/api/src/depots/supervision.ts  queue()
   join engagements + app.mandats_visibles()
   ⚠ WHERE p.vis = 'partage'                   ← la pièce du 4 octobre est
                                                 restée « personnel »

⑧ VALIDATION         office.book → socle.ecritures.status = 'booked'
```

**L'état réel de la pièce du 4 octobre** : `source = photo`, `status = lue`,
`vis = personnel`, `document_kind` vide / `a_determiner`,
`verdict = « anomalie à signaler »`.

### 3.2 Le parcours d'une question à Malica

```
① écran            apps/web/src/routes/_authenticated/… (fil de Malica)
② API              POST /malica/demander
③ conseil          apps/api/src/malica/conseil/ask.ts
   ├─ recherche dans le corpus (embedding de la question → legal.chunks)
   ├─ appel du modèle (deepseek-reasoner)      écrit : agents.agent_runs
   ├─ relecture des sources citées par le modèle
   │     « sans source dans le corpus, sa certitude vaut zéro,
   │       quoi qu'elle en dise »              (ask.ts, en-tête)
   └─ retenue = certitude < seuil du cabinet   (ask.ts:471)
④ si retenue       écrit : agents.arbitrages (statut « en_attente »)
                   le client reçoit « votre comptable relit ma réponse »
⑤ file du cabinet  agents.arbitrages → écran du cabinet
⑥ retour au client (à vérifier : boucle de validation)
```

**Les traces du 4 octobre** :

| Question                             | Modèle appelé     |         Jetons | Résultat                                   |
| ------------------------------------ | ----------------- | -------------: | ------------------------------------------ |
| « Qui es-tu ? »                      | deepseek-reasoner |    8 931 → 180 | **réponse rendue**                         |
| « Taux de TVA en Tunisie en 2026 ? » | deepseek-reasoner | 11 784 → 1 634 | **retenue**, arbitrage, certitude **0.00** |
| « Donne ce que tu sais »             | deepseek-reasoner |  9 077 → 1 197 | **retenue**, arbitrage, certitude **0.00** |

Le modèle **a bien travaillé** et a produit 1 634 et 1 197 jetons de réponse.
Ce qui a été retenu, c'est le fond ; ce que tu as vu est le message d'attente.
Les deux arbitrages sont `en_attente`, rattachés au cabinet AUDICORP.

---

## 4. Le corpus

|                           |                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Où                        | `legal.*` dans **la même base** que le métier, sur le staging                                                                         |
| Volume                    | 11 440 articles · 16 183 versions · **31 863 fragments**                                                                              |
| Vectorisation             | **31 863 / 31 863 — aucun trou**                                                                                                      |
| Modèle d'empreinte        | `qwen3.7-text-embedding`, 1024 dimensions, tarifé en base (R8)                                                                        |
| Index                     | `chunks_hnsw` (HNSW cosinus) pour le sens · `chunks_recherche_idx` (GIN) pour les mots                                                |
| Taille                    | 913 MB                                                                                                                                |
| Rattachement à un dossier | **aucun** — le corpus est le droit tunisien, commun à tous les tenants, lisible par `authenticated` sous une politique `using (true)` |

Le corpus est donc **présent, complet et indexé** sur le staging. Ce n'est pas
la donnée qui manque pour l'anomalie 2.

---

## 5. Écarts entre l'existant et la cible

| #   | Écart                                                                                                                                                                                                                                                                 | Gravité       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| É1  | **La file du cabinet exige `vis = 'partage'`** ; une pièce scannée naît `personnel` et n'est transmise que par un geste explicite. La pièce du 4 octobre est restée personnelle : c'est pourquoi AUDICORP ne la voit pas                                              | **bloquant**  |
| É2  | **L'archive est en niveaux de gris** (saturation mesurée à 0), par choix délibéré de poids et de lisibilité — contraire à la règle « l'archive conserve la couleur »                                                                                                  | **bloquant**  |
| É3  | **Certitude 0 dès que les sources ne sont pas relues dans le corpus** → toute question part en relecture, même réglementaire et même quand le corpus la couvre. À instruire : la recherche rend-elle des résultats, et la relecture des sources les retrouve-t-elle ? | **bloquant**  |
| É4  | **Pas de boucle de retour** vérifiée : rien ne prouve aujourd'hui que le client reçoit la réponse une fois validée. Si elle n'existe pas, le message « je vous la transmets » est faux                                                                                | **bloquant**  |
| É5  | **Pas de notion de dossier** distincte de la PME : `tenant_id` pointe l'organisation. La cible veut un `dossier_id` partout                                                                                                                                           | **important** |
| É6  | **Le mandat ne porte pas de droits** et ne borne pas l'accès de l'ancien cabinet à la période traitée                                                                                                                                                                 | **important** |
| É7  | **La lecture n'est pas corrigeable par la PME**, et aucune historisation des corrections n'existe (`capture.precisions` ne couvre que le type de pièce). Pas de statut « à revalider »                                                                                | **important** |
| É8  | **Pas de couche « échanges »** : ni commentaires, ni demandes de pièces rattachées à une pièce et visibles des deux côtés                                                                                                                                             | **important** |
| É9  | **Stockage sur disque local, pas objet.** Sauvegardé hors site par restic, mais la cible demande un stockage objet                                                                                                                                                    | **important** |
| É10 | **Conservation 10 ans non outillée** : pas d'échéance, pas de contrôle d'intégrité périodique par empreinte. L'inaltérabilité R7 et le journal d'audit existent                                                                                                       | **important** |
| É11 | Statut de pièce et statut d'écriture sont **deux échelles distinctes** (`recue/lue/…` et `proposed/booked`) ; la cible en veut une seule, partagée                                                                                                                    | **confort**   |
| É12 | `document_kind` reste `a_determiner` après lecture : la pièce attend une confirmation humaine (R2) qui n'a pas eu lieu                                                                                                                                                | **confort**   |

---

## 6. Pourquoi les tests n'ont rien vu — première lecture

Trois raisons distinctes, à confirmer à l'étape du diagnostic :

1. **Les épreuves déposent des octets, elles ne scannent pas.** Tout le
   parcours caméra — permission, flux vidéo, redressement, mise en gris — vit
   dans le navigateur et n'est exercé par aucun test : `epreuve-bout-en-bout`
   envoie un PDF déjà fait.
2. **D27 ferme l'autre voie.** Dans la WebView de l'application, un contenu
   apparu après un geste n'entre pas dans l'arbre d'accessibilité que lit
   Maestro : l'épreuve sur émulateur ne peut pas juger un aperçu de caméra.
   Trois de ses six flux échouent pour cette raison, et ces échecs ne disent
   rien sur l'application.
3. **Les épreuves transmettent la pièce.** Elles passent `vis = 'partage'`
   là où l'application laisse `personnel` : le chemin réel du téléphone n'est
   couvert par aucune épreuve.

---

## 7. Ce que je n'ai pas fait

Rien n'a été modifié : ni le code, ni la base, ni le serveur. Le seul écrit est
ce document, sur la branche `chantier/essai-reel-telephone`.
