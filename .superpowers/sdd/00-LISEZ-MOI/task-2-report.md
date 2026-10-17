# Tâche 2 — rapport : le compteur branché sur la lecture

Statut : DONE_WITH_CONCERNS (les réserves sont des chemins de fuite, listés plus bas).

## Ce qui a été fait

- `apps/api/src/malica/lecture/read-flow.ts`
  - **Avant tout** (avant le contexte, avant le téléchargement, avant tout modèle) :
    `capture.lectureAutorisee` → `public.lecture_autorisee`. Si `autorisee` est
    faux : `throw new LectureRefusee(motif)`, motif de la base mot pour mot
    (`message === motif`). Aucun libellé, seuil ou compteur dans le fichier.
  - **Dernier geste avant de rendre**, APRÈS `persisterLecture` ET après
    `analyser` : `capture.consommerLecture` → `public.lecture_consommer`.
    J'ai placé le comptage après l'analyse, pas juste après la persistance :
    l'analyse peut lever, et une lecture comptée dont le client reçoit une
    erreur est exactement le cas à éviter. (Le brief disait « après
    persisterLecture » : c'est respecté, en plus strict.)
  - Le rattrapage est englobé : une pièce = un contrôle, un comptage.
  - `readPieceFlow(api, pieceId, lecteurs = réels)` : troisième paramètre
    facultatif pour injecter `runVisionRead` / `secondLecteurDisponible`. Sans
    cela, l'épreuve ne peut pas prouver « aucun appel de modèle ». En service,
    personne ne le passe.
- `apps/api/src/depots/capture.ts` : deux méthodes minces, `lectureAutorisee` et
  `consommerLecture` (un `select public.…($1)` chacune, aucune logique). Elles
  n'ont pas de chemin de contournement : c'est la forme exacte de
  `journaliserAgent`. `contrat/rpc.json` relevé (`npm run contrat`).
- `apps/api/src/malica/lecture/une-lecture-qui-echoue-ne-se-facture-pas.test.ts`
  (un seul `describe`, organisations archivées en `after`, 65 lectures de décor
  posées sous `postgres`).

## Ce que l'épreuve prouve

1. modèle qui lève : 0 ligne ;
2. persistance refusée (après paiement du modèle) : 0 ligne ;
3. analyse qui lève après persistance : 0 ligne ;
4. lecture aboutie : exactement 1 ligne ;
5. rattrapage déclenché (2 appels de modèle, contrat complet retenu à la seconde) :
   exactement 1 ligne ;
6. refus au plafond (65/65) et pièce personnelle : `LectureRefusee`, motif égal au
   verdict de la base, **0 appel** sur un faux qui lève s'il est touché
   (lecteur ET `secondLecteurDisponible`), 0 ligne.

Preuve que l'épreuve mord : j'ai déplacé temporairement le comptage juste après
la porte (avant tout modèle). Les trois épreuves « qui échoue » (1, 2, 3) sont
passées au rouge, les autres sont restées vertes. Rétabli.

## Verts

`npm test` (689 tests, 0 échec, 0 todo ; 5 sautés = « aucun fragment vectorisé
sur cette instance », étrangers à ce travail), `typecheck`, `lint`, `code-mort`,
`db/reproductibilite.test.mjs` (14/14), `db/registre.test.mjs` (8/8).

## Ce qui échoue ou fuit — la découverte

**A. Une pièce déjà lue se paie encore, et ne rend rien (argent perdu).**
Mesuré par l'épreuve 6. `lecture_autorisee` répond `relecture_gratuite` pour une
pièce déjà comptée → autorisée. Mais `capture_read_persist` refuse une seconde
persistance (R7 : « cette piece a deja ete lue »). Résultat : le(s) modèle(s)
sont appelés et payés, puis la persistance lève. Aucun comptage (correct), mais
une dépense sans contrepartie. Déclencheur réaliste : relance par la file hors
ligne du téléphone, double clic, `lireOuRejoindre` ne dédoublonne que dans un
processus. Le brief parlait de « correction gratuite » : en l'état, la
re-lecture n'existe pas côté persistance. Correctif suggéré (non fait, hors
périmètre) : refuser avant le modèle une pièce déjà lue — côté base, dans
`lecture_autorisee` ou dans `contexteLecture` (statut de la pièce), jamais en TS.

**B. Deux lectures simultanées de pièces différentes à 64/65.** Les deux passent
la porte, les deux paient le modèle, la seconde `lecture_consommer` lève
`plafond_atteint` : lecture payée, persistée, non comptée, et le client reçoit
une erreur. Écart borné par la concurrence, mais réel. Pas de réservation
atomique dans la base aujourd'hui.

**C. Même pièce, deux instances de serveur.** Le registre de
dédoublonnage est en mémoire de processus : deux instances = deux lectures
payées, un seul comptage (`on conflict do nothing`), puis la persistance de la
seconde lève (cas A).

**D. Mort du processus entre la persistance et le comptage.** Lecture
persistée, jamais comptée (service gratuit) ; le client qui relance retombe sur A.

**E. Le refus remonte en HTTP 500.** `LectureRefusee` n'est pas reconnue par
`repondre` dans `apps/api/src/malica.ts` (que je n'ai pas modifié : un seul
fichier de production demandé). Le corps contient bien le motif en clair
(`erreur: "plafond_atteint"`), mais un refus métier n'est pas une panne : il
faudrait un 4xx (402/403) et un journal sans `console.error`. À vérifier aussi
que la file hors ligne du téléphone ne relance pas indéfiniment sur 5xx.

Aucun chemin « comptée sans être rendue » côté flux normal : le comptage est le
dernier appel, après tout ce qui peut lever. Seul le cas B (erreur renvoyée alors
que la lecture est persistée) s'en approche, sans comptage.

## Sur l'arbitrage du rattrapage

Je le confirme : une pièce lue = une lecture. Rien dans le code n'y résiste, et
le plafond se vérifie une fois. La seule réserve est de coût, pas de
principe : le rattrapage double la dépense modèle d'une pièce comptée une fois,
ce qui se règle dans le prix de l'offre, pas dans le compteur.

## Non tranché

- A (relecture d'une pièce déjà lue) : où la refuser avant le modèle ?
- B : réservation atomique d'une lecture à la porte, ou tolérance assumée ?
- E : statut HTTP d'un refus de lecture et traitement par la file hors ligne.

## Ronde de correction 1

### A — une pièce déjà lue est refusée avant le modèle
- Rouge d'abord : la première version de l'épreuve (avant correctif) a rendu, en
  échouant, `R7 : cette piece a deja ete lue` APRÈS que le faux modèle eut été
  appelé — la dépense sans résultat, mesurée.
- Section 13 ajoutée à `20261019150000` : `lecture_autorisee` rend
  `autorisee:false, motif:'piece_deja_lue'` quand une extraction existe (la
  condition exacte du refus de `capture_read_persist`). Aucun référentiel de
  motifs n'existe dans `ref` : les quatre motifs existants sont des chaînes de la
  fonction SQL, `piece_deja_lue` en est une cinquième, au même endroit (pas dans
  le TypeScript).
- **Piège trouvé par les épreuves, en rougissant** : `lecture_consommer` appelle
  la porte APRÈS la persistance, donc se refusait elle-même sur chaque lecture
  réussie (4 épreuves rouges : « lecture refusee : piece_deja_lue »). Le verdict
  de fond est déplacé dans `public.lecture_verdict` (ancien corps, inchangé,
  non exposé à `authenticated`) ; `lecture_autorisee` = porte + refus « déjà lue »
  + verdict ; `lecture_consommer` appelle le verdict nu. `relecture_gratuite`
  est conservé pour une pièce comptée sans extraction.
- R2 : `capture_read_persist` et la chaîne de lecture non touchés.
- La migration étant déjà appliquée à la base de travail, le registre dérivait ;
  rejouée avec `node db/migrer.mjs --forcer` (atelier), `registre.test.mjs` revert au vert.
  À rejouer de même partout où la migration 20261019150000 est déjà posée.

### E — un refus est un 4xx
- `repondre` (malica.ts) : `LectureRefusee` -> HTTP 403, corps
  `{erreur: motif, motif}`. Épreuve par la vraie application, sur trois motifs
  (`piece_deja_lue`, `piece_personnelle`, `plafond_atteint`), motif égal au
  verdict de la base.
- File hors ligne (`apps/web/src/lib/hors-ligne/vidage.ts`) : 401 arrête la
  passe ; >= 500 ou réseau relance avec recul ; tout autre 4xx = « refus »,
  échec définitif montré, jamais rejoué. Elle ne relance donc PAS sur 4xx : OK.
- **Défaut de plus, non corrigé** : la file appelle `?attendre=0`, la route
  répond `{enCours:true}` avant la lecture, et un refus ne survient que dans la
  promesse d'arrière-plan (`lecture.catch(() => undefined)`). La file ne voit
  JAMAIS le refus ; le motif n'est visible que si l'écran appelle la lecture
  synchrone. Aucun rejeu (donc pas de boucle payante), mais la personne dont
  la pièce est refusée au plafond n'est pas informée du motif par ce chemin.

### B, C, D — tolérance assumée
Commentaire ajouté à l'endroit du comptage dans `read-flow.ts` : dépassement
d'une ou deux lectures à la frontière accepté, pourquoi (réserver = facturer un
échec), et « ne pas corriger en réservant en tête ».

### Épreuves
9 tests dans le fichier : la pièce déjà lue est refusée avec zéro appel de
modèle (faux qui lève), motif mot pour mot, comptage toujours à 1 ; le 4xx ;
l'invariant « lecture aboutie = exactement une ligne, rattrapage compris »
inchangé et vert. Verts : fichier, `le-plafond-ne-se-contourne-pas` (10),
`une-lecture-s-impute-a-la-bonne-licence` (7), `le-plafond-arrete…` (7),
`schema` (13), `npm test` (690, 0 échec, 0 todo), typecheck, lint, code-mort,
reproductibilité (14), registre (8).

### Arbre de travail
`AGENTS.md` et `apps/web/src/styles-pme.css` étaient modifiés hors de mon
travail : laissés tels quels, non commités.

## Ronde de correction 2 — le refus d'arrière-plan ne se tait plus

- Rouge d'abord : l'épreuve « un refus d'arrière-plan s'inscrit » a échoué sur
  `le refus est lisible après coup, il n'est pas avalé` (dossier.lectureRefusee
  absent) — la route avait répondu 200 `{enCours:true}`, la lecture avait été
  refusée, et rien n'en restait.
- Où le motif est inscrit : `audit.event_log`, action `lecture.refusee`, objet
  `capture.pieces`, `payload = {"motif": <code>}`. Pourquoi là : il porte déjà
  `lecture.consommee` pour la même pièce, il est en ajout seul (R7), lisible par
  les membres et le cabinet engagé, et indexé par objet. Aucune colonne nouvelle :
  `capture.pieces.status` est une machine à huit états qui ne dit pas « refusée »
  (une pièce refusée est `capturee`, non lue — c'est exact). `capture.precisions`
  est ce que la PERSONNE tranche, pas ce que le système décide.
- Écriture : `public.lecture_refusee_inscrire(piece)` (section 14 de
  `20261019150000`, `security definer`, porte `piece_lisible` via
  `lecture_autorisee`). Elle REJOUE le verdict et n'inscrit que le motif de la
  base : le client ne choisit jamais le motif. Rien si autorisée ; pas de doublon
  si le dernier refus a le même motif (un rejeu de la file ne remplit pas le
  journal). Le motif est le code, jamais une phrase (R4).
- Appel : `readPieceFlow` inscrit avant de lever `LectureRefusee` (donc pour les
  chemins synchrone ET d'arrière-plan). Si l'inscription échoue : `console.error`
  fort, le refus est maintenu. Dans la route, `lecture.catch(() => undefined)`
  est remplacé : un refus (déjà inscrit) passe, toute autre cause est journalisée.
- Lecture : `capture.listAvecLecture` (par pièce) et `capture.dossier` rendent
  `lectureRefusee: {motif, le} | null`, `null` dès que la pièce a une extraction.
  Types : `PieceLue.lectureRefusee` et `PieceDossier.lectureRefusee` (optionnels)
  dans `packages/socle/src/ports/repositories.ts` ; l'adaptateur web du dossier
  les fait suivre. Contrat relevé (195 méthodes : `inscrireRefusDeLecture`).
- L'écran n'est PAS fait (étape des écrans). Il devra : dans la liste
  (`pme.list.tsx`, `pme.coffre.tsx`), distinguer une pièce `status:'capturee'`
  avec `lectureRefusee` non nul (« non lue, refusée : <traduction du motif> »)
  d'une pièce `capturee` simple (« en attente de lecture ») ; dans l'écran
  de pièce, prendre `dossier.lectureRefusee.motif`. Le motif se traduit par les
  clés d'interface (fr/en/ar) : `plafond_atteint`, `piece_personnelle`,
  `licence_suspendue`, `organisation_sans_licence`, `piece_deja_lue`, ainsi que
  `licence_<statut>` pour un statut autre que suspendue (le motif est construit
  par la base : `'licence_' || statut`).
- La capture est intacte : l'épreuve vérifie que la pièce du plafond existe
  (`capturee`), 0 ligne dans `facturation.lectures`, et le 403 synchrone garde
  son motif (épreuve inchangée, verte).
- Verts : fichier (10), plafond-ne-se-contourne (10), plafond-arrete (7),
  s-impute (7), schema (13), `npm test` (691, 0 échec, 0 todo), typecheck, lint,
  code-mort, reproductibilité, registre (migration rejouée `--forcer` sur la
  base de travail). Aucun `pme-tmp.css` / `pme-compile.css` à la racine.
- `AGENTS.md` intact, non commité. `apps/web/src/styles-pme.css` porte à nouveau
  des modifications qui ne sont pas les miennes (autre session) : non commité.
