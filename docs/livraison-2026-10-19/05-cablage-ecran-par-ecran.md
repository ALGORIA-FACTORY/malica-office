# Le câblage, écran par écran

**Toutes les méthodes citées ont été vérifiées contre `contrat/rpc.json`.**
Celles marquées **À CRÉER** n'existent pas : ce sont les sept seules à ajouter,
et chaque ajout est délibéré — le contrat est gelé, `contrat.test.ts` échoue sur
toute divergence, et on le relève ensuite avec `contrat/relever.mjs`.

---

## La mécanique du dépôt, à respecter

L'adaptateur est un `Proxy` : il n'y a rien à écrire par dépôt.

```ts
// apps/web/src/verticals/malica-office/adapters/http/rpc.ts
export function creerDepotHttp<T extends object>(depot: string): T
// → office.capture.lister(...)  devient  POST /rpc {depot:"capture", methode:"lister", args}
```

Un écran ne touche jamais `fetch`. Il appelle un hook, le hook appelle
`office.<depot>.<methode>`, et `useQuery` fait le reste. Le modèle à suivre est
`apps/web/src/hooks/use-accueil.ts`, dont l'en-tête dit la règle qui gouverne
tout le câblage :

> *Aucun chiffre n'est fabriqué ici. […] Quand une donnée manque, la valeur est
> `null` et l'écran le dit. Il ne dit jamais « 0,000 » à la place : zéro est un
> fait comptable, l'absence n'en est pas un, et les confondre sur l'écran
> d'accueil d'un dirigeant est la pire chose que ce produit puisse faire.*

Donc, pour **chaque** champ de chaque écran, trois états et non deux :
**la valeur**, **le vide** (« rien ce mois-ci »), **l'absence** (`null` → « je
ne sais pas encore »). Les trois s'écrivent différemment.

Et un principe de chargement : **un écran, une fenêtre de données.** Douze mois
de trajectoire se chargent en un appel, pas douze — le produit doit s'ouvrir en
moins d'une seconde sur un téléphone d'entrée de gamme.

---

## Les sept méthodes à créer

| méthode | rend | s'appuie sur |
|---|---|---|
| `facturation.monForfait()` | `{offre, lectures_droit, lectures_consommees, lectures_restantes, organisations, sieges_occupes, sieges_inclus, sieges_max, prix_mensuel_ht, statut}` | `facturation.consommation_v` |
| `facturation.sieges()` | les membres de toutes les organisations de la licence : `{user_id, nom, role, tenant_id, organisation}` | `identity.memberships` ∩ `licence_organisations` |
| `facturation.organisations()` | `{tenant_id, nom, lectures_consommees}` par organisation | `facturation.lectures` groupé |
| `facturation.inviterSiege(email, tenantId)` | délègue à `inviter_contact` ; **le plafond mord dans la base**, pas ici | déclencheur `memberships_place_disponible` |
| `facturation.libererPlace(tenantId, membre)` | `{libere, motif, pieces}` | `public.siege_reprendre_sa_place` |
| `cabinet.documents()` | ce que le cabinet a déposé : `{id, libelle, categorie, exercice, depose_le, action_attendue}` | `coffre.objects` — **la table existe, le dépôt RPC non** |
| `cabinet.accuserReception(objetId)` | inscrit l'accusé | `audit.event_log` |

`capture.supprimer` prend désormais un second argument (`false` depuis un
écran, toujours). `collab.demanderSurPiece` accepte `'suppression'` en plus de
`'rappel'`. `collab.setPieceVis` accepte `'entite'`.

---

## Accueil · `_authenticated/pme.index.tsx` *(existe)*

| élément | appel | notes |
|---|---|---|
| le rôle, pour tout le reste de l'écran | `acces.monAcces` | `dirigeant` ou `collaborateur` |
| le sélecteur d'organisation (Premium) | `identite.listMyOrganizations` | absent si une seule |
| l'établissement courant | `identite.listEntities` | `isDefault` ou le premier |
| « Lectures restantes 9 » + la barre marigold | **`facturation.monForfait`** | `.bar[data-k="plafond"]` |
| les charges du mois | `charges.familles` | |
| « 3 questions en attente » | `charges.questions` | pastille ambre |
| les dernières pièces | `capture.lister` | 10 lignes, pas plus |
| la prochaine échéance | `collab.echeances` | |
| le nom du cabinet | `identite.monCabinet` | `null` → « aucun cabinet » |
| **cartes verrouillées** « Mes sièges · Team », « Mes sociétés · Premium » | `facturation.monForfait` → `offre` | `.card[data-verrou]`, **jamais masquées** |

## Charges par classe · `pme.charges.tsx` *(existe)*

`charges.familles` · `charges.articles` · `charges.anomalyThreshold` ·
`referentiel.classesDeComptes`.

Filtres Premium : `identite.listMyOrganizations` (société) et `collab.members`
(siège). Le filtre siège lit `capture.pieces.created_by` — c'est la colonne qui
porte « qui a saisi », elle existe depuis le premier jour.

« Non classée » est ambre, l'intragroupe est azure. Le total ne s'affiche
jamais si une seule famille est `null` : un total partiel présenté comme
complet est un mensonge, pas une approximation.

## Bibliothèque · `pme.list.tsx` *(existe, à étendre aux quatre axes)*

| axe | source de la clé |
|---|---|
| par mois | `capture.pieces.document_date` |
| par dossier | `charges.familles` |
| par tiers | `tiers.lister` |
| par type d'opération | `referentiel.typesDeDocument` |

`capture.listAvecLecture` pour la vue liste, `capture.lister` pour la grille
annuelle. La cadence (mensuel / bimestriel / trimestriel) et l'anneau « il en
manque un » se calculent **dans le client, sur les données déjà chargées** —
c'est un calcul, pas une requête.

## Dossier d'une pièce · `pme.piece.$pieceId.tsx` *(existe, à compléter)*

| bloc | appels |
|---|---|
| l'en-tête et les montants | `capture.dossier` |
| ce que Malica a lu, champ par champ | `capture.contexteLecture` |
| la chaîne BC → BL → facture | `capture.piecesIssuesDe` |
| les règlements | `capture.paiementsDUnePiece`, `referentiel.moyensDePaiement` |
| inscrire un règlement | `capture.enregistrerPaiement` |
| **annuler un règlement** | `capture.motifsDAnnulation` puis `capture.annulerPaiement` — jamais « modifier » |
| rattacher un justificatif | `capture.rattacherJustificatif` |
| corriger un champ | `capture.preciser` — un ajout, jamais un UPDATE (R7) |
| dater une pièce sans date | `capture.daterLaPiece` |
| **Revenir dessus** | voir ci-dessous |
| transmettre / garder | `collab.setPieceVis`, `collab.garderPiece` |

**Le bloc « Revenir dessus » lit `vis` et le rôle, et rien d'autre :**

| `vis` | rôle | ce qui s'affiche | appels |
|---|---|---|---|
| `personnel` | — | `LIBRE` — corriger, supprimer, mettre au privé | `capture.preciser`, `capture.supprimer(id, false)` |
| `entite` | `collaborateur` | `AVANT VALIDATION` — corriger librement, demander la suppression | `capture.preciser`, `collab.demanderSurPiece(id,'suppression')` |
| `entite` | `dirigeant` | `LIBRE` | idem `personnel` |
| `partage` | — | `SUR ACCORD` — corriger et renvoyer, demander la suppression | `collab.demanderSurPiece`, et l'état se lit par `collab.demandesDUnePiece` |

## Capture · `pme.capturer.tsx` **(route à créer)**

C'est le produit. L'ordre des appels est la règle, et il ne se réarrange pas.

| étape | appel |
|---|---|
| 0 · la caméra, sans mode | — (`capabilities/scanner.ts`, déjà écrit, plafond 350 Ko) |
| 1 · **la destination, AVANT la lecture** | `capture.enregistrer({vis})` — B6 : une pièce personnelle n'est jamais lue, donc la question se pose avant, sinon on débite le quota de la société pour un papier qui ne la regarde pas |
| 2 · « Lire les 6 — 6 lectures sur 23 » | **`facturation.monForfait`** pour le compte |
| 3 · la lecture, sur clic explicite | `capture.analyser` |
| 4 · ce que Malica a lu | `capture.contexteLecture` |
| 5 · les questions, une par une | `capture.contexteAssistant`, `charges.questions`, `charges.answer` |
| 6 · la période à cheval | `charges.enAttenteDeDate`, `capture.daterLaPiece` |
| 7 · le règlement groupé | `capture.enregistrerPaiement`, `referentiel.moyensDePaiement` |
| 8 · la fin · société | `collab.setPieceVis(id,'partage'\|'entite')`, `capture.persisterLecture` |
| 8bis · la fin · espace privé | rien — non lue, quota intact, invisible |
| — · la trace du modèle | `capture.journaliserAgent` |

Hors ligne : `lib/hors-ligne/file.ts` existe déjà, plafonds 50 éléments et
250 Mo. La capture ne s'arrête jamais, même sans réseau, **même plafond
atteint** — les pièces s'empilent, non lues.

## Chat avec Malica · `pme.malica.tsx` **(route à créer)**

Le dépôt `conversations` existe **en entier** et n'a aucun écran PME.

`conversations.lister` / `ouvrir` / `ouvrirNouvelle` / `ajouter` / `renommer` /
`supprimer` / `dernierMessage` / `juger`.

Le retour cabinet : `conseil.creer` (poser la question), `conseil.file` (ce qui
est en relecture), `conseil.lire` (l'avis rendu), `conseil.contexte`,
`conseil.nomsDesCorpus`, `corpus.rechercher` pour les sources citées en pastilles.

**Un fil porte toujours sa suite** : demander l'avis → *en relecture, je vous
préviens* → *avis rendu* → **appliquer l'avis à vos pièces**. Le dernier état
est une action, jamais un cul-de-sac.

## Paramètres · `pme.reglages.tsx` *(existe, à étendre)*

Organisations : `identite.createOrganization`, `definirOrganisation`,
`listMyOrganizations`, `etablirFiche`, `ficheCourante`, `formesDisponibles`,
`regimesDisponibles`.

Sièges : **`facturation.sieges`**, **`facturation.inviterSiege`**,
**`facturation.libererPlace`**, `identite.invitationsDuDossier`,
`identite.revoquerInvitation`, `collab.members`, `collab.invitations`.

Forfait : **`facturation.monForfait`** et **`facturation.organisations`** —
« 3 / 3, le maximum est atteint », le prix dû, ce que chaque société consomme.

Rubriques : `parametrage.plan`, `parametrage.roles`. Le matricule s'affiche
sous cadenas : immuable dès la première pièce.

## Cabinet · `pme.cabinet.tsx` **(route à créer)**

Deux onglets.

**Échanges** — `collab.demandesDUnePiece`, `collab.notifications`,
`collab.markRead`, `conseil.file`, `conseil.lire`.

**Ses documents** — **`cabinet.documents`**, **`cabinet.accuserReception`**.
Trois règles à écrire sur l'écran : ils ne consomment aucune lecture, ils
restent au client même après un changement de cabinet, et certains arrivent
avec une action à faire.

## Espace privé · `pme.coffre.tsx` *(existe)*

`capture.lister` (filtré `vis='personnel'`), `collab.setPieceVis`,
`capture.supprimer`.

Fond `--prive`, bandeau azure. **Aucun bouton de transmission au cabinet.**
Depuis `20261018103000`, la base le tient : un `personnel` n'est visible que de
son auteur, et un siège ne peut plus sortir une pièce de la société.

## Échéances · `pme.echeances.tsx` *(existe)* · TVA · `pme.tva.tsx` *(existe)*

`collab.echeances`, `marquerEcheance`, `deriverEcheances`. Règle à afficher :
**une pièce entre dans la TVA du mois où elle est transmise**, pas du mois où
elle est datée.

---

## La dégradation par offre — la règle unique

Un écran lit `facturation.monForfait` **une fois**, au niveau du layout
`pme.tsx`, et le passe par contexte. Aucun écran n'appelle deux fois.

| offre | ce qui change à l'écran |
|---|---|
| **Basic** | pas de sélecteur d'organisation, pas de bloc sièges ; « Mes sièges » et « Mes sociétés » en cartes verrouillées |
| **Solo** | idem, quota 120 |
| **Team** | le bloc sièges s'ouvre ; un `collaborateur` voit « c'est lui qui transmet » et perd les boutons de transmission |
| **Premium** | le sélecteur d'organisation apparaît, les filtres société+siège sur les charges, la vue consolidée, la copie de rubriques entre sociétés |

**Une carte verrouillée dit ce qu'elle ferait et sous quelle offre. Elle ne
disparaît jamais** — un produit qui cache ce qu'il vend ne le vend pas.
