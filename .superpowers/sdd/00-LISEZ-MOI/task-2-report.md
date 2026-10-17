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
