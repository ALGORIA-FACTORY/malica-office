# Audit de bout en bout — 4 octobre 2026

Cinq couches : écrans, serveur, intelligence, base, application Android. Tout
ce qui est chiffré ici a été **mesuré sur le poste ce jour**, pas repris d'un
document antérieur. Ce qui n'a pas pu être mesuré est dit tel quel.

Dépôt : branche `chantier/remise-a-zero-metier`, 45 commits d'avance sur `main`,
version `0.2.2`.

---

## Verdict d'ensemble

| Couche       | Ce qui tient                                                     | Ce qui ne tient pas                                                                                   |
| ------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Écrans       | 41 routes, 410 tests, hors-ligne éprouvé, trois langues          | aucune vérification d'accessibilité automatique ; le bouton « mettre à jour » est mort dans une coque |
| Serveur      | 170 méthodes au contrat, 355 tests, frontière des refus nette    | le plafond de dépense ne peut pas mordre sur ce qui n'est pas mesuré                                  |
| Intelligence | le modèle vient du tarif, jamais d'une constante ; corpus mesuré | **la passe la plus chère n'est pas journalisée** (D31)                                                |
| Base         | 101 migrations, 0 écart au dépôt, 276 politiques RLS             | répétition de restauration vieille de 28 jours ; panne de sauvegarde silencieuse                      |
| Android      | 6 flux Maestro, clair confiné à l'émulateur                      | **D27 : rien d'apparu après un geste n'est éprouvable** ; la version publiée a un mois de retard      |

Un défaut a été trouvé **et corrigé pendant cet audit** : voir « La collision du
matricule », plus bas. C'est le seul qui aurait cassé le déploiement.

## Ce qui a été corrigé dans la foulée

| Défaut                                                                                          | Correction                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Deux outils du corpus portaient un **chemin absolu** vers un dossier OneDrive disparu           | la racine du dépôt se déduit de `import.meta.url` — ils étaient morts depuis le déménagement               |
| Le même mot de passe d'épreuve écrit dans **cinq fichiers**, deux adresses et une PME en double | une seule déclaration dans `outils/epreuves/socle.mjs`, remplaçable par `MALICA_MDP_EPREUVE`               |
| La tolérance au **certificat auto-signé** recopiée trois fois                                   | `tolererLeCertificatLocal()` — une tolérance en trois exemplaires finit par être élargie dans un seul      |
| `"deepseek-reasoner"` écrit deux fois, le millésime Qwen une troisième                          | `apps/api/src/malica/modeles.ts` — une déclaration, et la raison du verrou écrite à côté                   |
| Rien ne vérifiait que ces modèles ont un **tarif en vigueur**                                   | `modeles.test.ts`, écrit comme `db/registre.mjs` : dispenses datées, et rouge quand une dispense se périme |
| Rien n'empêchait d'ajouter demain une **table de tenant sans RLS**                              | deux invariants dans `schema.test.ts`, sur les 63 tables portant `tenant_id`                               |
| `22P02` et `23P01` rendus en `500 « erreur interne »`                                           | traduits en refus lisibles, sans répéter la phrase du moteur                                               |

Chacune est éprouvée par mutation : la garantie est cassée volontairement, le
test tombe, la garantie est remise. Pour les invariants de cloisonnement, une
table nue a été créée dans une transaction annulée — l'invariant l'a vue.

**Ce que je n'ai pas « corrigé », et pourquoi.** Le millésime `qwen-vl-ocr-2025-11-20`
et la correspondance rôle → modèle **restent dans le code**. Ce ne sont pas des
oublis : un modèle qui suivrait `-latest` changerait le relevé sans qu'une ligne
bouge, et une pièce relue ne donnerait plus ce qu'elle donnait à sa
comptabilisation. R8 n'exige pas que le nom vive dans la table — elle exige que
les deux soient d'accord. C'est désormais prouvé plutôt que supposé.

---

## 1. Les écrans

**Mesuré** : 41 routes, 21 composants, 30 fichiers de test, **410 tests** (vitest,
31 fichiers), 5 parcours Playwright, 15 composants portant `aria-*` ou `role=`.

**Ce qui tient.**
La file hors ligne est un vrai sous-système, avec son dépôt IndexedDB, son dépôt
de fichiers, son vidage et ses tests (`apps/web/src/lib/hors-ligne/`). Elle
rejoue les octets stockés, et l'épreuve correspondante vérifie le contrat réel :
mêmes octets acceptés, autres octets refusés en 409 parce que le contenu est
scellé par son empreinte.

Les trois langues (fr, en, ar) ont leurs tests propres — pluriels et statuts
traduits. L'écran du garde de version porte ses phrases lui-même, **hors** du
fournisseur de traductions, pour qu'un refus de version s'affiche même si le
reste n'a pas pu se charger. C'est un détail d'architecture bien vu.

La résolution de l'API est écrite comme une décision, pas comme un repli :
`resoudreApi` **exige** `VITE_API_URL` en production et lève plutôt que de
deviner.

**Ce qui ne tient pas.**

_L'accessibilité n'est vérifiée par rien._ Aucun `axe`, aucun test d'arbre
d'accessibilité. Quinze composants portent des attributs ARIA qu'aucune machine
ne relit. C'est la dette **D25**, laissée ouverte en connaissance de cause après
l'expérience du 17 septembre — mais elle reste ouverte, et elle ne se fermera pas
par Maestro (voir D27).

_Le bouton de l'écran « mettez à jour » ne fait qu'un `window.location.reload()`_
(`mise-a-jour-requise.tsx`). Dans un navigateur il a du sens ; dans une coque,
recharger ne change rien par construction. Le jour où `CLIENT_MIN_VERSION` sera
posée, un appareil verrouillé n'aura **aucune issue depuis l'application**.

_Les tuiles vides de l'accueil_ restent le point d'ergonomie noté le 18
septembre, non traité.

---

## 2. Le serveur

**Mesuré** : 53 fichiers TypeScript hors tests (**13 214 lignes**), 21 fichiers
de test (2 867 lignes), 22 dépôts RPC, **170 méthodes au contrat**, **355 tests**
qui passent.

**Ce qui tient.**
Le contrat (`contrat/rpc.json`) est tenu par deux tests : une méthode ne se
renomme pas en silence. La frontière entre un refus rédigé et une fuite est
explicite, documentée, et vérifiée dans les deux sens — un `raise` écrit par nous
remonte, une violation détectée par PostgreSQL est tue parce que son message
nomme une table et un index.

Le garde 426 est monté **avant toute route** et ce placement est testé. La
proposition d'écriture est calculée côté serveur, pas côté écran. Les montants se
normalisent en entiers de centimes avec des taux rationnels exacts, et la
convention se tranche en vérifiant que HT × (1 + taux) retombe sur le TTC
imprimé.

**Corrigé ce jour.** Deux erreurs rendaient `500 « erreur interne »` pour une
faute de saisie : un mode de validation hors énumération (`22P02`) et une fiche
fiscale réécrite à une date déjà couverte (`23P01`). Elles sont désormais
traduites — notre phrase, et de celle du moteur on ne garde que la valeur venue
de l'appelant. La traduction lit les deux ponctuations, française et anglaise :
la locale du staging n'est pas celle du poste. Deux mutants l'ont éprouvée.

**Ce qui ne tient pas.**

_Le plafond de dépense ne peut pas mordre._ `agents.budgets` porte un plafond
mensuel et par pièce. Il ne peut contraindre que ce qui est journalisé — et la
passe de lecture ne l'est pas (couche 3). Le plafond protège donc tout **sauf**
l'appel le plus coûteux.

_D29 reste ouverte, mesurée._ Une pièce d'un autre tenant et une pièce
inexistante rendent le même statut et le même corps — 12 chemins mesurés le
18 septembre. C'est un choix défendable (ne pas livrer de canal d'existence),
mais il faut savoir qu'un exploitant ne distinguera pas non plus les deux cas.

_`AUTH_ESSAIS_PAR_MINUTE=1000`_ a été posé dans `apps/api/.env` du poste le
4 octobre pour que le jeu de données ne soit pas refusé en 429. C'est une valeur
de poste. Elle ne doit jamais atteindre un serveur, où la valeur est 30.

---

## 3. L'intelligence

**La chaîne** : Qwen-VL-OCR relève les tokens et leurs positions → DeepSeek
désigne les champs → sept contrôles rendent un verdict motivé → la proposition
d'écriture est calculée côté serveur, au paramétrage daté de la pièce.

**Ce qui tient.**
La règle R8 est respectée là où elle est appliquée : le modèle d'empreintes vient
de `agents.model_pricing`, jamais d'une constante, et chaque fragment du corpus
porte l'identifiant de la ligne de tarif qui l'a encodé. Encoder une question et
un document avec le même modèle n'est pas une précaution de style : deux modèles
donnent deux espaces vectoriels, et le résultat n'est pas dégradé, il n'a plus de
sens. Le fichier le dit, avec la mesure (cosinus 0,5755 sans typage contre 0,6507
avec).

Le corpus répond. Mesure refaite ce jour : « obligations du commissaire aux
comptes d'une SARL » → **CSC art. 266 au rang 1 en 1 126 ms**, texte verbatim,
bornes de validité, statut, opposabilité, et les deux rangs séparés (sens n° 1,
mots n° 75). 31 863 fragments, **tous vectorisés**, aucun trou.

Les contrôles refusent de rendre un verdict sans motif — `rendreVerdict` lève si
le motif manque. C'est la bonne contrainte : un verdict sans raison est une
opinion.

**Ce qui ne tient pas.**

_**D31 — la passe la plus chère n'est pas journalisée.**_ `agents_run_log` refuse
d'écrire un coût sans tarif en vigueur, et **aucun tarif n'existe pour
`qwen-vl-ocr-2025-11-20`**. Les lignes de rôle `vision` sont aujourd'hui
`lovable/google/gemini-2.5-flash` (périmée depuis le 30 août) et `interne/pdf-text`.
Conséquence : le relevé OCR s'exécute, mais ne laisse **aucune trace de coût ni
de latence**. Le code le dit explicitement et le remonte dans sa réponse au lieu
de l'avaler — c'est honnête, et ce n'est pas une solution. Il faut relever le
prix dans la console Alibaba et l'inscrire par migration datée.

_La configuration de l'IA est coupée en deux._ L'API lit `QWEN_BASE_URL` et
`QWEN_API_KEY` dans `apps/api/.env` ; les outils du corpus les lisent dans
`apps/web/.env`. Le 4 octobre, le second avait perdu ses clés : la recherche en
ligne de commande était morte depuis un déménagement, pendant que la chaîne dans
l'application marchait. Deux sources pour une même clé, c'est une panne qui
attend. (Réparé ce jour ; la cause reste.)

_Les outils du corpus exigent `bun`, pas `node`_ : `dashscope-intl.aliyuncs.com`
ne se résout qu'en IPv6 depuis ce poste et le `fetch` de Node expire. C'est écrit
dans les en-têtes, mais rien ne l'impose : lancé avec `node`, l'outil échoue sur
une erreur sans rapport (`Cannot read properties of undefined`).

---

## 4. La base

**Mesuré** : 101 migrations, **77 tables de métier dont 72 sous RLS**, 276
politiques, 24 fonctions `app.*`, 58 déclencheurs métier, 265 index, **617 Mo**
dont 614 pour le corpus.

**Ce qui tient.**
`node db/registre.mjs` compare 3 501 objets à une base montée depuis les seules
migrations : **0 écart, 0 accepté, 0 périmé**. La dérive de septembre — trois
objets hérités du mode `--adopter` retiré depuis — est résorbée. C'est la
garantie la plus importante de tout l'édifice : ce qui tourne est ce que le dépôt
décrit.

Le registre refuse qu'une migration se réécrive : empreinte SHA-256 par fichier,
arrêt net si elle change. L'inaltérabilité R7 est posée par déclencheurs, pas par
convention. Le paramétrage est daté et aucune valeur fiscale n'est en dur (R11),
vérifié par `db/reproductibilite.mjs`. Les sauvegardes tournent toutes les six
heures, chiffrées, hors site.

**Les cinq tables sans RLS ne sont pas un trou** : `auth.users` et
`auth.refresh_tokens` n'accordent aucun droit au rôle `authenticated` — seul
`malica_api` les touche, hors de toute session utilisateur. `app.migrations`,
`storage.buckets` et `storage.objects` n'accordent rien au-delà de `postgres`.
La barrière est le droit, pas la politique. Elle tient tant qu'aucune fonction
`security definer` accessible à `authenticated` ne lit ces tables.

**Ce qui ne tient pas.**

_La dernière répétition de restauration date du 6 septembre_ — 28 jours. Le
critère de pilote est « moins de trente jours ». On est à deux jours du rouge, et
`restaurer.sh repeter` restaure à côté de la base vivante sans rien détruire :
il n'y a aucune raison d'attendre.

_Une panne de sauvegarde serait silencieuse._ `SAUVEGARDE_SIGNAL_URL` est vide
sur le staging. Les dumps partent toutes les six heures ; si demain ils
s'arrêtent, personne ne l'apprendra. La surveillance doit porter sur le
**silence**, pas sur l'erreur.

_D23 — la locale._ `French_Tunisia.1252` sur le poste contre `en_US.utf8` sur le
serveur : la recherche lexicale diffère sur 791 des 31 863 fragments. L'exception
est inscrite et datée dans le registre, donc visible — mais la mesure de qualité
de la recherche (99,3 % au rang 1) n'a jamais été rejouée hors du poste. On ne
sait pas ce qu'elle vaut sur le serveur.

_Les identifiants de `agents.model_pricing` sont tirés au sort par migration._
Toute copie de `legal.chunks` d'une base à l'autre produit 31 863 clés
étrangères orphelines. La réconciliation par clé naturelle a été faite à la main
le 6 septembre et n'est outillée nulle part. Un chargement de corpus entre
environnements retombera dans le piège.

---

## 5. L'application Android

**Mesuré** : publiée **0.2.0, versionCode 7, piste interne, 8 septembre**. Dépôt
en 0.2.2. Dernière mise à jour en vol : `web-v0.2.1`, 8 septembre également. Six
flux Maestro. Trois saveurs Gradle.

**Ce qui tient.**
`allowBackup="false"` : la file hors ligne et le jeton long ne se recopient pas
sur un autre appareil par la sauvegarde Google. Le trafic en clair n'existe que
dans la saveur `emulateur`, par un manifeste séparé qui ne se fusionne que là.
Une construction locale vaut `versionCode 1`, donc ne peut pas partir au magasin
par erreur. La signature est absente si la clé l'est — la variante se construit
mais reste inutilisable : c'est voulu, et c'est dit.

Le bundle est embarqué, pas chargé depuis un site : une première version affichait
le site hébergé et rendait une page blanche sans réseau.

**Ce qui ne tient pas.**

_**D27 — l'épreuve nocturne prouve moins qu'elle n'en a l'air.**_ Dans cette
WebView, un contenu qui apparaît **après un geste, sans changement de page**
n'entre jamais dans l'arbre d'accessibilité que lit Maestro. Conséquences
établies le 17 septembre et toujours valables : aucun contenu dynamique n'est
éprouvable par Maestro, et le **mode hors ligne ne peut pas être vérifié
automatiquement**. Les six flux passent ; ce qu'ils ne couvrent pas n'est pas
couvert ailleurs.

_Un mois de retard._ Tout 3A (entrée en relation, lien d'invitation, faille D28
fermée) et tout 3B (empreinte scellée, lecture jugée, sept contrôles, proposition
serveur) sont **absents de l'application installée**. Ce que porte un téléphone
aujourd'hui est la version du 8 septembre.

_La saveur ment._ Une construction visant le staging produit la saveur `pilote` :
l'application s'appelle « Malica (pilote) » et porte le même `applicationId` que
le futur vrai pilote. Impossible de les distinguer, impossible de les faire
cohabiter. Laissé tel quel sciemment — une saveur distincte impliquerait une
nouvelle fiche Play — mais à reprendre le jour où le pilote existera.

---

## La collision du matricule — trouvée et corrigée pendant cet audit

L'épreuve 3A ouvrait le dossier d'**ALGORIA FACTORY SARL, matricule
`1856324/A/M/000`** — l'identité réelle de la société du commanditaire, parce que
le chantier s'était écrit sur cet exemple.

Le 4 octobre, ce dossier a été ouvert pour de vrai. L'épreuve est tombée :
`identite.ouvrirDossier : 400 — Ce matricule fiscal a déjà un dossier`.

Sur le poste, c'est une porte rouge. **Sur un environnement partagé, c'eût été
pire** : si l'épreuve avait tourné avant la création du vrai dossier, son compte
de contact — `epreuve.contact.algoria@malica.local`, mot de passe en clair dans
le dépôt — serait devenu **dirigeant de la vraie société**. Un matricule réel
dans une épreuve est une collision qui attend son tour.

Corrigé : le dossier d'épreuve porte désormais une identité fictive
(`ÉPREUVE ENTRÉE EN RELATION SARL`, `9000002/A/M/000`). L'épreuve repasse —
16 réussites, 0 échec — et la raison est écrite dans son en-tête pour que
personne ne refasse le chemin inverse.

**Règle à retenir** : une épreuve ne porte jamais un identifiant du monde réel.

---

## Hygiène des secrets

- **Trois mots de passe de comptes d'essai sont en clair dans le dépôt**, dans
  8 fichiers (dette E2/D3). Tant qu'ils ne servent qu'à des comptes fictifs sur
  des bases jetables, c'est tolérable ; le jour où un de ces comptes touche un
  tenant réel, ce n'en est plus un. La collision ci-dessus montre que ce jour
  peut arriver sans que personne l'ait décidé.
- `apps/api/.env` porte des **clés API vivantes** (DeepSeek, Qwen). Le fichier
  n'est pas suivi par git — correct — mais il vit désormais sur le Bureau et non
  plus dans un dossier synchronisé : il n'a **aucune copie**.
- L'inscription publique est ouverte sans vérification d'adresse (E4).
- `main` déploie le staging sans relecture, et la protection de branche n'est pas
  disponible sur le dépôt privé (E1/D1 partiellement traitée : le déclencheur a
  été restreint à `main` le 15 septembre).

---

## Ce que je ferais dans l'ordre

1. **Relever le prix de Qwen-VL-OCR** et l'inscrire par migration datée (D31).
   Sans lui, la lecture — l'acte central du produit — n'a ni coût ni latence, et
   le plafond de dépense est décoratif.
2. **Rejouer une restauration** (28 jours, limite à 30).
3. **Poser un moniteur de silence** sur les sauvegardes.
4. Fusionner, déployer, publier — c'est le plan en cours.
5. Unifier la source des clés IA (une seule, `apps/api/.env`).
6. Rejouer `db/corpus/sonder.mjs` **sur le serveur** pour savoir ce que vaut la
   recherche hors du poste (D23).
7. Fermer D25 par un vrai contrôle d'accessibilité — Maestro ne le fera pas.

---

## Mesures brutes

|                                  |                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Tests unitaires et d'intégration | **958** — 355 API, 410 écrans, 160 socle, 33 racine                                |
| Épreuves de bout en bout         | 9 parcours contre l'application vivante                                            |
| Porte de vérification            | typage, lint, knip, tests, 9 épreuves — **verte** après correction de la collision |
| Migrations                       | 101, empreinte vérifiée, 0 écart au dépôt sur 3 501 objets                         |
| Politiques RLS                   | 276 sur 72 tables de métier                                                        |
| Corpus                           | 11 440 articles, 16 183 versions, 31 863 fragments vectorisés (100 %)              |
| Base                             | 617 Mo, dont 614 de corpus                                                         |
