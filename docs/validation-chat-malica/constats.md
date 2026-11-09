# Chat de Malica : les 14 constats rejoués

**Date** : 9 novembre 2026. **Commit éprouvé** : `f2daac4c` (`origin/main`, merge de #316). Les constats
portent sur `main` tel qu'il est, pas sur la PR #298 (agent Claude en flux).
**Exécutant** : Claude Code, branche `verif/constats-chat`. Aucun code produit n'a été modifié.

Les sorties brutes sont dans `preuves/constats/`, et les scripts qui les produisent dans `preuves/constats/scripts/`. Les scripts y sont rangés en `.txt`
(`x.mjs.txt`) pour que knip ne les compte pas comme fichiers morts (R9) : retirer `.txt` pour les rejouer.
Dans le texte ci-dessous, ils sont cités sous leur nom d'origine.

## Montage

- La base jetable `malica_constats_chat` (PostgreSQL 17, `lc_messages='C'`) est migrée par
  `node db/migrer.mjs --base …` : **418 migrations jouées**. Le script est `scripts/monter-base.mjs`.
- **Écart au montage.** Le serveur refuse le mot de passe du rôle `malica_api` (`28P01`), y compris sur
  `malica_local`. Ce rôle est partagé par tout le serveur ; on ne le modifie pas ici. L'API locale se connecte
  donc avec l'URL d'administration de la base jetable. Les chemins utilisateur descendent quand même en
  `set local role authenticated` (`db.ts:190`), si bien que la RLS s'applique à chaque requête des épreuves.
  **À régler par le dirigeant** : le mot de passe de `malica_api` du `.env` n'est plus celui du serveur.
- Données : le jeu d'essai `db/dev/jeu_dessai.mjs`, joué par l'API locale (un cabinet, ATLAS DISTRIBUTION,
  DREAM OPTIC). Il s'arrête sur `capture.persisterLecture` ; la suite des épreuves n'en dépend pas.
- **Modèle simulé.** `scripts/intercepter.mjs` est préchargé par `--import`. Il journalise chaque appel
  sortant (hôte, chemin, corps tronqué, jamais les en-têtes) et rend une réponse fabriquée, ce qui évite tout
  appel payant. Seuls les constats 2, 6 et 13 appellent un vrai fournisseur.
- **Corpus.** La base jetable n'en a pas. `malica_local` porte 31 863 fragments vectorisés : le constat 2 la
  lit dans une transaction `READ ONLY`.

## Verdicts

| # | Constat | Verdict | Preuve d'exécution, en une ligne |
|---|---------|---------|-----------------------------------|
| 1 | Le chat passe par DeepSeek seul, sans flux ; le web simule le mot à mot | **CONFIRMÉ** | Appels sortants : `api.deepseek.com` seulement, `stream:false`. Le navigateur reçoit un seul corps JSON, puis le texte se dévoile de 3,6 s à 4,9 s |
| 2 | La recherche rend 6 articles coupés à 320 caractères, par vecteurs seuls | **CONFIRMÉ, NUANCÉ** | Sur le vrai corpus : 6 lignes avant le seuil, **2 seulement** après le seuil de 0,37. Chaque extrait fait 320 caractères, sur des fragments de 1 790 et 1 784 |
| 3 | Une question de suite est cherchée seule ; la date est toujours celle du jour | **CONFIRMÉ** | Encodé : `["Et pour les hôtels ?"]`. `rechercher` reçoit `jour:null`, donc `current_date`. Le contrôle compare au jour de l'horloge |
| 4 | Les contrôles journalisent sans rien retirer | **CONFIRMÉ, NUANCÉ** | 2 verdicts `retirer` (l'article 99 et le chiffre 37 inventés), et la réponse part intacte. Les verdicts vont aussi au navigateur (`controles`), que l'écran PME n'affiche pas |
| 5 | Aucun écran n'appelle `/malica/conseil-cite` | **CONFIRMÉ** | `grep` sur `apps/web/src`, `android` et `packages` : aucune occurrence. L'adaptateur web appelle `/demander`, `/conseil`, `/pv` et `/briefing` |
| 6 | La latence est mesurée avant la lecture du corps, donc fausse | **CONFIRMÉ** | DeepSeek réel : 290 ms journalisées pour 889 ms réelles (`chat`), 271 pour 803 (`reasoner`). Corps simulé à 1 500 ms : 0 ms journalisée (DeepSeek), 68 ms (Claude) |
| 7 | `contexteAssistant` prend au plus 500 pièces sans ordre, et 25 écritures | **CONFIRMÉ** | Base : 502 pièces `capturee` et 100 `lue`. Malica reçoit `{"capturee":500}`, sans aucune `lue`. Les 25 écritures, elles, sont ordonnées |
| 8 | Le sélecteur « Toutes les sociétés » existe, mais le chat n'envoie que `pme.tenantId` | **CONFIRMÉ** | Après « Toutes » puis retour au chat, la requête porte un seul `tenantId`, celui d'ATLAS |
| 9 | `.mal`, `.srcs` (non cliquables, absents d'un fil rouvert), `.et1`, `.chips`, aucune pièce jointe, `MalicaChat` en texte brut | **CONFIRMÉ** | `.srcs a` : `href:null`, `onclick:null`, aucun effet au clic. Après reprise du fil, aucun lien `.srcs`. Aucun `input[type=file]`. Le Markdown sort brut |
| 10 | `/malica/demander` et `conversations.ouvrir` envoient au navigateur le modèle, les jetons et la durée | **CONFIRMÉ** | Clés reçues : `model`, `latencyMs`, `tokensIn`, `tokensOut`, et dans le fil `model`, `tokensIn`, `tokensOut`, `latencyMs` |
| 11 | Caddy compresse (`encode zstd gzip`) : un flux serait-il retenu ? | **INCERTAIN** | `encode zstd gzip` est global et couvre `/malica/*`. Ni Caddy, ni Docker, ni Go sur ce poste : pas d'essai possible. La façon de trancher est donnée plus bas |
| 12 | Pas de plafond de 150 $, pas de quota par offre, pas de limite de débit sur `/malica` | **NUANCÉ** | 30 requêtes simultanées : 30 × 200, aucune 429. Mais il existe un **plafond mensuel de 10 $ par organisation**, et il mord : `400 refus.conseil.plafond` une fois le plafond abaissé |
| 13 | Le code appelle `deepseek-chat` et `deepseek-reasoner`, alors que l'API sert d'autres modèles | **CONFIRMÉ** | `/models` répond `["deepseek-flash","deepseek-v4-pro"]`. Les deux noms sont acceptés comme **alias**, et **tous deux sont servis par `deepseek-flash`**. Le code journalise le nom demandé |
| 14 | `ANTHROPIC_API_KEY` manque à `.env.example` | **CONFIRMÉ, NUANCÉ** | Absente de `.env.example` à la racine. Présente dans `infra/env.exemple:41` et dans `infra/compose.yml:151` |

**Constat annexe**, trouvé en jouant le constat 3 : **le fil se relit dans le désordre**. Une question et sa
réponse sont rangées avec le même `created_at`, et `conversations.ouvrir` les trie par
`order by created_at, id`, où `id` est un uuid aléatoire. Dans l'épreuve, les **deux** échanges du fil sont
revenus inversés, la réponse avant la question (`preuves/constats/fil-ordre.txt`). Le modèle a donc reçu le
fil passé dans l'ordre `assistant, user`, puis la nouvelle question (rôles
`system×5, assistant, user, user`). Le même ordre sert à l'écran d'un fil rouvert. Le risque est d'une chance
sur deux par échange. `dernierMessage` n'est pas touché : il filtre sur `role = 'assistant'`.

## Preuves

Toutes les preuves sont datées du 2026-11-09 et portent sur le commit `f2daac4c`. Chaque bloc donne la
commande lancée puis un extrait de sa sortie.

### 1. DeepSeek seul, sans flux, et un mot à mot simulé

```
$ node scripts/c01-c03-c10-mock.mjs        # API locale 3917, modèle simulé
Q1 status 200 content-type application/json; charset=utf-8
#2 api.deepseek.com/chat/completions model=deepseek-reasoner stream=false response_format={"type":"json_object"}
#3 api.deepseek.com/chat/completions model=deepseek-chat stream=false         (titre du fil)
```

Côté navigateur (`c01-c08-c09-navigateur.txt`), la réponse arrive comme **un** corps JSON de 672 caractères.
Le texte affiché vaut 0 caractère à 153 ms, puis 21 à 3 603 ms, 40, 68, 94 et ainsi de suite jusqu'à 186 à
4 852 ms. L'attente dure tant que le JSON n'est pas entier, puis `lib/mot-a-mot.ts` dévoile le texte par pas
(`PAS_MS = 45`, borne `DUREE_MAX = 3200`). Le seul fournisseur de la voix est DeepSeek : `deepseek.ts:68`
(`stream: false`) et aucun autre client dans `ask.ts`. L'encodeur Qwen sert à la recherche, pas à la réponse.

### 2. Six articles, 320 caractères, des vecteurs seuls

```
$ node --experimental-strip-types scripts/c02-recherche-reelle.mjs   # le vrai chercherDansLeDroit, malica_local en READ ONLY
appels à l'encodeur : 1
fragments rendus au modèle : 2
  CIRPPIS art. 52 · distance 0.2501 · extrait 320 car. (fragment entier : 1790 car.)
  CIRPPIS art. 53 · distance 0.3182 · extrait 320 car. (fragment entier : 1784 car.)
rechercher() brut (avant seuil) : 6 lignes, distances 0.2501, 0.3182, 0.4073, 0.416, 0.4277, 0.4312
```

**Nuance.** 6 est un plafond, pas ce que reçoit le modèle. Le seuil `DISTANCE_MAX = 0.37` (`corpus.ts:85`)
n'en a laissé passer que 2, chacun réduit à 18 % de son texte (`left(c.texte, 320)`, `depots/corpus.ts:356`).
La requête trie sur la seule distance cosinus ; la recherche hybride, qui ajoute les mots, existe
(`rechercherHybride`) mais ne sert qu'à `/conseil-cite`.

### 3. La question de suite est cherchée seule, à la date du jour

```
$ node --experimental-strip-types scripts/c03-c04-unitaire.mjs    # askMalica réel, AppelApi factice, fetch simulé
CONSTAT 3 — ce qui est encodé pour la recherche : [["Et pour les hôtels ?"]]
CONSTAT 3 — arguments de corpus.rechercher : {"nb":6,"jour":null,"doctrine":true,"historique":false}
CONSTAT 3 — le modèle, lui, reçoit le fil : rôles = system,system,system,system,user,assistant,user
```

L'API locale confirme le même comportement (`c01-c03-c10-mock.txt`, appel n° 4) : la question encodée est
`["Et pour les hôtels ?"]`. Avec `jour: null`, la requête prend `coalesce($4, current_date)`. Le contrôle
reçoit `aujourdhui: new Date()` (`ask.ts:321`). Une question sur un exercice clos se cherche donc dans le
droit d'aujourd'hui, et seule la règle 13 de la consigne demande au modèle de raisonner sur le fait
générateur.

### 4. Les contrôles journalisent, ils ne retirent rien

```
CONSTAT 4 — verdicts : [{"code":"article_non_fourni","suite":"retirer",…"l'article 99…"},
                        {"code":"chiffre_sans_source","suite":"retirer",…"le chiffre 37…"}]
CONSTAT 4 — journaliserControles appelé : true
CONSTAT 4 — réponse RANGÉE dans le fil : "Le taux est de 37 %, selon l'article 99 du code de l'IRPP, depuis toujours."
CONSTAT 4 — réponse RENDUE au navigateur : (identique)
CONSTAT 4 — ordre : … → conversations.ajouter → corpus.editionsPlusRecentes → … → conversations.journaliserControles
```

La réponse est rangée **avant** que les contrôles tournent. Un verdict `suite: "retirer"` ne retire rien.
**Nuance** : les verdicts partent quand même au navigateur, dans la clé `controles`, mais
`pme.malica.tsx` ne les lit pas.

### 5. Aucun écran n'appelle `/malica/conseil-cite`

Commande : `sh scripts/greps.sh` (sortie dans `greps.txt`). Aucune occurrence de `/malica/conseil-cite`
dans `apps/web/src`, `android` ni `packages` (code retour 1). L'adaptateur web
`adapters/http/malica.ts` n'appelle que `/demander`, `/conseil`, `/pv` et `/briefing`. Côté web,
`tour/conseil-cite.tsx` ne règle que la consigne (`tour.conseilCiteEtat`) ; il n'interroge pas le modèle.
La coque Android charge l'application web et n'a aucun appel propre.

### 6. La latence journalisée est fausse

```
$ node --experimental-strip-types scripts/c06-c13-deepseek-reel.mjs   # 2 appels payants
[chat]     latencyMs journalisé 290 ms · en-têtes à 288 ms · corps complet à 889 ms · bout en bout 889 ms
[reasoner] latencyMs journalisé 271 ms · en-têtes à 271 ms · corps complet à 803 ms · bout en bout 803 ms
$ node --experimental-strip-types scripts/c06-corps-lent.mjs          # en-têtes immédiats, corps à +1 500 ms
lecture/claude.ts envoyerAClaude : latencyMs journalisé = 68 ms · durée réelle = 1520 ms
conseil/deepseek.ts callDeepSeek   : latencyMs journalisé = 0 ms · durée réelle = 1513 ms
```

La valeur journalisée est l'heure d'arrivée des en-têtes : `deepseek.ts:97` et `lecture/claude.ts:96`
prennent `Date.now()` avant `res.text()`. C'est elle qui va dans `agents_run_log` et dans le fil
(`latencyMs`). Sur DeepSeek réel, elle sous-estime d'environ deux tiers.

### 7. Le contexte : 500 pièces sans ordre, 25 écritures

```
$ (base jetable) insert de 600 pièces sur ATLAS : 500 'capturee' puis 100 'lue'
  pieces_v actives : capturee 502 · lue 100
$ node --env-file=.env --env-file=.env.test scripts/c07-contexte.mjs   # creerAppelLocal(sousIdentite) → loadMalicaContext
capture.contexteAssistant : pieces = 500
loadMalicaContext → dossier.pieces (ce que Malica lit) : {"capturee":500}
```

`depots/capture.ts:1396-1397` fait un `limit 500` sans `order by`. Résultat : à « combien de pièces
lues ? », Malica a sous les yeux **zéro**, alors qu'il y en a 100. Les écritures, elles, sont triées par
`date_ecriture desc limit 25`, et les échéances par `due_date limit 20`.

### 8. « Toutes les sociétés » ne change pas ce que le chat interroge

Le scénario de navigateur est dans `c01-c08-c09-navigateur.txt`. En-tête, puis « Toutes les sociétés » :
l'écran passe sur `/pme/societes`, avec « Toutes les sociétés · 2 ». De retour sur `/pme/malica`, l'en-tête
affiche « ATLAS DISTRIBUTION 1/2 », et la question part avec `"tenantId":"d2fc8356-…"`, un seul dossier. Le
schéma `Question` de `malica.ts` n'accepte qu'un `tenantId`, et la page envoie `pme.tenantId`
(`pme.malica.tsx:146`).

### 9. L'écran du chat

Mêmes conditions que le constat 8 ; un article de test est inséré pour qu'une source s'affiche
(`scripts/c09-mini-corpus.sql`) :

```
paragraphesMal: 2 · balisesGras: 0 (« **Réponse simulée** » s'affiche avec ses astérisques)
srcs: [{texte:"CONSTAT-TEST 52", href:null, onclick:null, focusable:false}] · clic → url inchangée, 0 dialogue
après reprise du fil (conversations.ouvrir) : liens .srcs = 0
chips: ["Mes conversations","CABINET MALICA"] · input[type=file]: 0 · compositeur : Envoyer, Parler à Malica
```

Les autres éléments viennent du code. `.et1` sert l'erreur (`pme.malica.tsx:483`) et l'avis de relecture
(`:690`), et n'a pas été déclenché dans ce scénario. La reprise ne garde que `role` et `contenu` (`:180`).
`MalicaChat.tsx:359` rend `{turn.content}` en `whitespace-pre-wrap`, donc en texte brut ; la ligne
`modèle · s · jetons` (`:126`) n'apparaît que si `technique` est vrai (`:419`).

### 10. Le navigateur reçoit le modèle, les jetons et la durée

```
$ node scripts/c01-c03-c10-mock.mjs
Q1 clés JSON reçues : answer, reasoning, model, latencyMs, tokensIn, tokensOut, runId, conversationId, messageId, controles, titre, retenue, conseil
conversations.ouvrir → clés : id, role, contenu, raisonnement, model, tokensIn, tokensOut, latencyMs, createdAt
```

`reasoning` et `raisonnement` arrivent bien à `null`, comme le veut ANO-023.

### 11. Caddy retiendrait-il un flux ?

`infra/caddy/Caddyfile:11` applique `encode zstd gzip` à tout le site, `/malica/*` compris (`:21`). Le
`reverse_proxy api:3000` ne règle aucun `flush_interval`. L'image est `caddy:2.9` (`compose.yml:19`).
**Rien n'a pu être exécuté** : ni `caddy`, ni `docker`, ni `go` sur ce poste (`greps.txt`). Aujourd'hui la
question est sans objet, puisqu'aucune réponse de l'API n'est un flux (constat 1). Elle se posera avec la
PR #298.

**Comment trancher.** Lancer `caddy:2.9` avec ce Caddyfile (`DOMAINE=localhost`) devant un petit serveur
Node qui sert `/malica/flux`, en `text/event-stream`, un événement par seconde pendant 5 s. Puis lancer
`curl -N --compressed -H 'Accept-Encoding: gzip, zstd' https://localhost/malica/flux` et horodater chaque
ligne reçue. Si les événements arrivent ensemble à la fin, ou par paquets, le flux est retenu. Si c'est le
cas, la correction candidate est un matcher qui exclut `text/event-stream` de l'`encode`, ou un
`flush_interval -1` ; le résultat est à rejouer.

### 12. Débit, quota et plafond

```
$ node scripts/c12-rafale.mjs
30 requêtes simultanées en 586 ms → statuts : {"200":30} · aucune 429
conseil.exigerBudget après la rafale : {"depense":0.00147,"plafond":10}
$ (base jetable) agents.budgets.monthly_cost_cap = 0.001 pour DREAM OPTIC, puis une 31e question
→ status 400 {"erreur":"refus.conseil.plafond"}
```

Le seul `rateLimit(` de l'API est `limiteAuth` (`app.ts:197`), posé sur les routes `/auth/*`. Aucun
quota par offre n'existe : `grep quota|par_offre` ne ramène qu'un commentaire de lecture. Aucun plafond de
150 $ n'existe non plus.

**Nuance** : un plafond existe. Il vaut **10 $ par organisation et par mois**
(`plateforme.reglages_ia`, migration `20261022590000`), la tour le règle, et `agents.budgets` peut
l'abaisser. Il est vérifié avant chaque appel (`conseil_budget_exiger`, `ask.ts:351`). C'est un plafond
de coût, pas une limite de débit : 30 requêtes en 0,6 s passent.

### 13. Les modèles que l'API sert vraiment

```
GET /models → 200 ["deepseek-flash","deepseek-v4-pro"]
[chat]     modèle DEMANDÉ et journalisé : deepseek-chat     · modèle SERVI : deepseek-flash
[reasoner] modèle DEMANDÉ et journalisé : deepseek-reasoner · modèle SERVI : deepseek-flash (reasoning_tokens 43)
```

L'API ne renvoie pas d'erreur : elle traite les deux noms comme des **alias** et répond `deepseek-flash`
dans les deux cas, le second en mode raisonnement. `callDeepSeek` rend son propre `model` (`deepseek.ts:124`)
et ignore le champ `model` de la réponse. Le journal et le coût, tarifés par `agents.model_pricing` sous
`deepseek-chat` et `deepseek-reasoner`, portent donc un nom que le fournisseur ne sert plus.

### 14. `ANTHROPIC_API_KEY` dans les gabarits d'environnement

```
$ grep -c ANTHROPIC_API_KEY .env.example        → 0
$ grep -c ANTHROPIC_API_KEY infra/env.exemple   → 1   (ligne 41)
$ grep -c ANTHROPIC_API_KEY infra/compose.yml   → 1   (ligne 151)
```

Un poste de développement monté depuis `.env.example` n'a pas la clé, alors que `/conseil-cite` et la
désignation par Claude l'exigent.

## Valeurs écrites en dur sur le chemin du chat (R4 / R8)

**Noms de modèles**
- `deepseek-reasoner` et `deepseek-chat` : `modeles.ts:41-42`. Repris en repli dans `ask.ts:493` et `:748`.

**Points d'entrée**
- `DEEPSEEK_URL` : `deepseek.ts:10`.
- `ANTHROPIC_URL` et `ANTHROPIC_VERSION = "2023-06-01"` : `lecture/claude.ts:18-20`.
- Chemin de l'encodeur `/compatible-mode/v1/embeddings` : `corpus.ts:108`.

**Appel au modèle**
- `temperature: 0` pour le chat : `deepseek.ts:71`.
- `SORTIE_MAX_JETONS = 8192` et `EFFORT = "low"` (Claude) : `lecture/claude.ts:25` et `:32`.

**Recherche**
- `nb: 6` pour le chat et `8` pour le cabinet : `corpus.ts:167`, `ask.ts:688`. Borne `1..20` : `depots/corpus.ts`.
- `left(c.texte, 320)` : `depots/corpus.ts:356`.
- `DISTANCE_MAX = 0.37` : `corpus.ts:85`.
- `RRF_K = 60` et `CANDIDATS_PAR_CLASSEMENT = 60` (recherche hybride) : `depots/corpus.ts:101-103`.
- Délai de l'encodeur `12_000` ms : `corpus.ts:118`.

**Fil et contexte**
- `TOURS_TRANSMIS = 16` : `ask.ts:229`.
- Titre du fil : `reponse.slice(0, 600)`, titre coupé à 120 caractères (`ask.ts:276`, `:280`), erreur journalisée coupée à 500 (`:500`).
- `PLAFOND_LISTE = 60` fils : `depots/conversations.ts:45`.
- `PLAFOND_FILE = 200` : `depots/conseil.ts:106`.
- Contexte : `limit 500` pièces, `25` écritures, `20` échéances, `40` motifs, `80` citations (`depots/capture.ts:1397-1438`).

**Écran**
- Mot à mot : `PAS_MS = 45`, `DUREE_MAX = 3200` (`apps/web/src/lib/mot-a-mot.ts:11-13`).
- `staleTime` de 10 min sur `conseil.contexte` : `pme.malica.tsx:126`.

**Taux et prix.** **Aucun taux ni prix en TypeScript** sur ce chemin. Les prix sont dans
`agents.model_pricing` : `deepseek-chat` à 0,27 / 1,10 $ par million de jetons, `deepseek-reasoner` à
0,56 / 1,68. Le plafond de 10 $ vit dans `plateforme.reglages_ia`, posé par migration. Seule réserve :
les prix sont tarifés sous des noms d'alias, servis aujourd'hui par `deepseek-flash` (constat 13).

## Lieux demandés

- **Les 24 questions du chat** : `apps/api/src/malica/conseil/epreuve-conseil.json` (24 `cas`), lues par
  `epreuve-conseil.ts` et `epreuve-conseil.test.ts`. Le rejeu réel est `apps/api/tests/real/conseil-cite.ts`.
- **Les 29 règles** : ce sont les règles numérotées de 1 à 29 de `systemPrompt()`, dans
  `apps/api/src/malica/conseil/ask.ts:148-188`, plus `1 bis` et `20 bis` (31 lignes).
  **Aucun test par règle n'a été trouvé.** Seul `un-decompte-n-est-pas-une-valeur-liante.test.ts` vise la
  doctrine : 5 tests sur les règles 1 et 1 bis, plus 2 tests de contrôles. Aucune collection « 29 règles
  fiscales, un test chacune » n'existe ailleurs dans le dépôt (recherche par `grep`).
- **`epreuve-conseil.yml`** : `.github/workflows/epreuve-conseil.yml`.

## Dépense payante (exacte)

| Fournisseur | Appels | Détail |
|-------------|--------:|--------|
| DeepSeek | **2** | `c06-c13-deepseek-reel.mjs` : 15 jetons en entrée et 2 en sortie, puis 41 et 46 (dont 43 de raisonnement). Moins de 0,001 $ au tarif de la table |
| DeepSeek `GET /models` | 1 | gratuit |
| Qwen (embeddings) | **1** | `c02-recherche-reelle.mjs` : une question encodée, de l'ordre de 0,000001 $ |
| Anthropic | **0** | |

Les autres appels (`/malica/demander`, la rafale de 30, l'écran) ont tourné sur le modèle simulé, sans
aucun appel payant.
