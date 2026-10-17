# Malica Office — mise en place de l'abonnement et correctifs

**Pour Claude Code, dans le dépôt `ALGORIA-FACTORY/malica-office`.**
Base de travail : HEAD `7eb55e8`. Rédigé le 18 octobre 2026.

---

## Les quatre décisions, tranchées par Wissem le 18 octobre

Elles ne se rediscutent pas, et tout le dossier en découle.

| | décision |
|---|---|
| **Le rayon** | **Deux surfaces, deux langages.** Edition One reste intact pour le cabinet ; la PME reçoit le sien sous `[data-surface="pme"]`. Voir `04-design-systeme.md`. |
| **Les établissements** | **Archivage, jamais de DELETE** — comme `identity.organizations`. Migration `20261018130000`. |
| **La revalidation** | **Une huitième valeur de statut, `a_revalider`** : le client qui corrige et le cabinet qui rend sont deux faits différents, et deux piles différentes chez Mondher. Migration `20261018140000`. |
| **La séquence** | **Tout**, dans l'ordre ci-dessous. |
| **Le siège à 8 DT** | **Validé** le 18 octobre. La grille de `ref.offres` est définitive. |
| **Le volume mensuel** | **Paramétrable à deux niveaux** : `ref.offres` pour tout le monde, `plateforme.accorder_lectures` pour un client. |

## L'ordre, puisque c'est tout

Les dépendances sont réelles : chaque étape s'appuie sur la précédente, et
l'ordre n'est pas une préférence.

```
  1  les 15 migrations           ──┐
  2  le correctif de suppression   │  la base d'abord : tout le reste
  3  le compteur dans read-flow    │  s'y appuie, et c'est là que se
  4  les 7 méthodes du contrat   ──┘  trouvent les deux bogues en production

  5  malica-pme.css + le témoin  ──┐  le langage avant les écrans, sinon
  6  pme.tsx pose data-surface     │  on refait douze fois la même
  7  les 14 routes existantes      │  décision visuelle

  8  pme.capturer      (nouvelle) ──┐
  9  pme.piece.$id     (à compléter)│  le produit, une branche par écran,
 10  pme.list          (4 axes)     │  par ordre de valeur
 11  pme.malica        (nouvelle)   │
 12  pme.reglages      (sièges)     │
 13  pme.cabinet       (nouvelle) ──┘

 14  le mort de R9 : assistant, 'confirmee', doublon_de, la FK morte

  ── la tour (07), une fois 1-4 en place ──────────────────────────────
 15  le mur : la plateforme ne lit plus les pièces  ← AVANT tout le reste
 16  compteurs, suspension, reprise, supplément de lectures
 17  facturation ALGORIA, encaissements, flux
 18  réclamations et réquisitions
 19  le moteur de notifications
 20  les e-mails, branchés sur notif.poster

  ── les exécutions (08), toutes écrites et éprouvées ─────────────────
 21  poser les 4 modules de code/ dans apps/api/src/
 22  découper code/essai-executions.ts en épreuves node:test
 23  les adaptateurs FCM / APNs / courriel (les ports sont écrits)
 24  brancher l'ordonnanceur : 1×/jour les relances, 1×/min les pushs
 25  brancher le lecteur de coffre sur la constitution d'archive
```

L'étape 15 passe avant les autres de la tour : construire des écrans
d'exploitation sur une base qui laisse tout lire, c'est se donner une habitude
qu'on ne reprendra plus.

Les étapes 1 à 4 se font **avant** toute ligne de JSX : le bogue de
suppression est en production, et un écran construit sur un compteur absent
devra être repris.

---

## Ce qu'il y a dans ce dossier

```
00-LISEZ-MOI.md                 ce fichier — la commande
01-audit-par-abonnement.md      l'audit, avec les mesures
02-specification-offre.md       la grille et les règles d'interaction
03-retour-correction-suppression.md   la règle du retour, écran par écran
04-design-systeme.md            le langage visuel, relevé à la valeur près
05-cablage-ecran-par-ecran.md   quel appel alimente quel élément
06-chaine-ia-de-bout-en-bout.md de la photo à l'écriture
07-la-tour-de-controle.md       la tour ALGORIA : compteurs, facturation,
                                réquisitions, réclamations, notifications
08-les-quatre-executions.md     le PDF, l'ordonnanceur, le travailleur,
                                l'archive — écrits et éprouvés
code/                           les quatre modules TypeScript + leur épreuve
exemples/                       une facture PDF et un paquet d'archive réels
design/malica-pme.css           la feuille de l'app PME, prête à poser
design/temoin.html              toutes les primitives sur une page
design/emails/construire.py     le squelette e-mail et ses six gabarits
design/emails/apercu/           les six, remplis, pour regarder
migrations/                     14 fichiers .sql, joués et vérifiés
verification/                   les scripts psql qui prouvent chaque point
ecrans/                         10 maquettes HTML — la source de vérité de l'UI
                                (dont malica-tour.html, la tour)
```

Les maquettes de `ecrans/` **ne sont pas du code à copier**. Ce sont des
spécifications exécutables : elles disent ce que l'écran doit faire, dans quel
ordre, avec quels mots exacts. Les mots comptent — ils ont été arbitrés un par
un. Le code, lui, suit la doctrine du dépôt (TanStack Start, Tailwind), et son
apparence suit `04-design-systeme.md`, dont toutes les valeurs ont été relevées
sur ces mêmes maquettes.

**L'ordre de lecture : 04 avant 05 avant les écrans.** Le design dit à quoi ça
ressemble, le câblage dit d'où viennent les données, les maquettes disent ce
qui se passe.

---

## La commande, dans l'ordre

### Étape 1 — Jouer les quinze migrations, et les éprouver

```bash
cp <ce dossier>/migrations/*.sql db/migrations/
node db/migrer.mjs --base "<url de ta base d'atelier>"
```

Elles ont été jouées sur un PostgreSQL neuf, après celles du dépôt, et elles
passent toutes.

> **Corrigé le 17 octobre.** Ce document annonçait tour à tour « 8 », « six » et
> « huit » migrations. Il y en a **quatorze livrées**, plus une quinzième —
> `20261019150000` — écrite ici parce que les quatorze ne passaient pas les
> règles du dépôt : cinq violations, dont deux que la CI aurait refusées, et une
> fuite entre clients qu'il a fallu fermer. Le décompte de la prose était périmé,
> et la phrase « migrations jouées et vérifiées » était fausse. Les deux sont
> dites ici plutôt que corrigées en silence.

Ne les réécris pas : si tu les trouves fausses, **dis-le avant de changer quoi
que ce soit** — elles encodent des arbitrages commerciaux, pas des préférences
techniques.

Puis écris les épreuves qui manquent, dans le style du dépôt (un fichier, un
nom qui dit la règle, un en-tête qui dit pourquoi) :

- `apps/api/src/scan/une-piece-avec-un-paiement-se-supprime.test.ts` —
  l'épreuve de non-régression du bogue ① ;
- `apps/api/src/scan/l-espace-prive-l-est-aussi-du-patron.test.ts` ;
- `apps/api/src/facturation/le-plafond-arrete-la-lecture-pas-la-capture.test.ts` ;
- `apps/api/src/facturation/la-grille-du-17-octobre.test.ts` — les cinq
  scénarios publiés, recalculés par `droits_v`.

Les scripts de `verification/` contiennent déjà la fixture et les assertions en
SQL ; traduis-les, ne les réinvente pas.

### Étape 2 — Brancher le compteur sur la lecture

C'est le seul endroit où une erreur coûte de l'argent réel.

Dans `apps/api/src/malica/lecture/read-flow.ts` :

1. **avant** tout appel de modèle : `select public.lecture_autorisee($1)`.
   Si `autorisee` est faux, on s'arrête et on rend le motif — `plafond_atteint`,
   `piece_personnelle`, `licence_suspendue`, `organisation_sans_licence`. La
   capture, elle, n'est jamais bloquée.
2. **après** une lecture qui a produit quelque chose :
   `select public.lecture_consommer($1)`.

L'ordre est la règle : une lecture qui échoue — modèle indisponible, citation
orpheline levée par R2 — **ne se facture pas**, parce que le client n'a rien reçu.

Écris l'épreuve qui le dit : une lecture qui lève ne laisse aucune ligne dans
`facturation.lectures`.

### Étape 3 — Le contrat RPC

`contrat/rpc.json` est gelé et `contrat.test.ts` échoue sur toute divergence :
chaque ajout est délibéré, et se relève avec `contrat/relever.mjs`.

**Sept méthodes à créer, et sept seulement** — la liste a été établie en
confrontant le câblage des douze écrans au contrat gelé :

| méthode | rend |
|---|---|
| `facturation.monForfait()` | la ligne de `facturation.consommation_v` de la licence de l'appelant |
| `facturation.sieges()` | les membres de toutes les organisations de la licence |
| `facturation.organisations()` | les organisations de la licence et ce qu'elles consomment |
| `facturation.inviterSiege(email, tenantId)` | délègue à l'invitation existante ; le plafond mord dans la base, pas ici |
| `facturation.libererPlace(tenantId, membre)` | `public.siege_reprendre_sa_place` |
| `cabinet.documents()` | ce que le cabinet a déposé — `coffre.objects` existe, son dépôt RPC non |
| `cabinet.accuserReception(objetId)` | inscrit l'accusé |

Et modifier, dans `apps/api/src/depots/` :

- `capture.supprimer` → passe le second argument (`false` depuis un écran, toujours) ;
- `collab.demanderSurPiece` → accepte `'suppression'` en plus de `'rappel'` ;
- `collab.setPieceVis` → accepte `'entite'`.

### Étape 3bis — Poser le langage visuel

1. `design/malica-pme.css` → `apps/web/src/styles-pme.css`, importé après
   `styles.css`.
2. Le layout `_authenticated/pme.tsx` pose `data-surface="pme"` sur sa racine.
   Rien d'autre ne le porte : Edition One reste intact pour le cabinet.
3. La coque : `viewport-fit=cover` dans le `<meta viewport>`, sinon les
   `env(safe-area-inset-*)` valent zéro et le bouton principal passe sous la
   barre de gestes de l'iPhone.
4. `design/temoin.html` devient une route d'atelier — pas un fichier mort,
   R9 l'interdirait. C'est le contrôle : si un écran s'écarte du langage, la
   page témoin le montre.

Vérifié à 320, 360, 375, 390, 412, 480, 768, 834, 1024, 1280, 1440 et 1920 px :
aucun débordement, aucune erreur console. **Lis `04-design-systeme.md` avant
d'écrire une ligne de JSX** — notamment la décision « deux surfaces, deux
langages », qui est la seule du dossier à revenir à Wissem.

### Étape 4 — Les écrans

Le dépôt a 14 routes PME. Les maquettes en décrivent une douzaine d'autres.
`05-cablage-ecran-par-ecran.md` donne, pour chacune, quel appel alimente quel
élément — toutes les méthodes y ont été vérifiées contre `contrat/rpc.json`.
Par ordre de valeur, et **une par branche** :

1. **La capture conversationnelle** (`ecrans/malica-capture.html`) — c'est le
   produit. Destination avant lecture, lecture sur clic explicite, sélection en
   masse, puis les questions une par une, Malica menant toujours.
2. **Le dossier d'une pièce** (`ecrans/malica-dossier.html`) — la route
   `pme.piece.$pieceId` existe ; il lui manque la chaîne des documents
   rattachés, l'annulation d'un règlement et le bloc « Revenir dessus ».
3. **La bibliothèque à quatre axes** (`ecrans/malica-bibliotheque.html`).
4. **Le chat avec Malica** (`ecrans/malica-chat.html`) — le dépôt RPC
   `conversations` existe déjà en entier, sans écran PME.
5. **Les paramètres** : organisations, sièges, forfait
   (`ecrans/malica-parametres.html`).
6. **Le cabinet côté PME** (`ecrans/malica-manquants.html`, écran « Cabinet ») —
   deux onglets : ses réponses, et les documents qu'il dépose.

Pour chacune : l'écran lit son forfait par `facturation.monForfait` et se
dégrade sans jamais mentir — une carte verrouillée dit ce qu'elle ferait et
sous quelle offre, elle ne disparaît pas.

### Étape 5 — Les orphelins (tranchés), et le mort (à faire)

**Les établissements : archivage.** `20261018130000` retire la politique
DELETE et le droit, pose `archived_at` / `archived_reason`, et ouvre
`public.etablissement_archiver(entity, motif)`. Elle refuse trois cas, et
c'est le cœur : le dernier établissement ouvert d'une société, un établissement
qui porte encore des pièces en cours (elle dit **combien**, pour qu'on les
traite au lieu de les découvrir), et quiconque n'est pas dirigeant. Si
l'établissement archivé était celui par défaut, le relais passe au plus ancien
encore ouvert — sans ça, la capture suivante n'a plus de destination. Les
écrans lisent `public.entities_v`.

**La reprise d'un partant** reste à écrire côté écran.
`siege_reprendre_sa_place` refuse tant qu'il reste des pièces `personnel` de la
personne : la machine ne peut pas distinguer la facture de la société rangée au
mauvais endroit du papier qui lui appartient. Il faut l'écran qui les fait
trancher une par une. `facturation.pieces_orphelines_v` les nomme.

**R9, à faire** : le rôle `assistant` n'est attribué par aucun chemin, le
statut `'confirmee'` n'est jamais posé, `capture.pieces.doublon_de` n'est pas
exposée par `pieces_v`, et une clé étrangère vers `legal.versions` porte sur
une colonne supprimée. `knip` ne voit pas le SQL — c'est pour ça que ça a
vécu.

### Étape 6 — La correction après transmission

`20261018140000` ajoute `a_revalider` au CHECK de `capture.pieces.status` et
ouvre `public.piece_corriger_apres_transmission(piece, champ, valeur)`. Elle
fait les trois choses ensemble : la précision s'ajoute (R7, jamais un UPDATE),
la pièce revient `a_revalider`, et le cabinet est prévenu — sans la
notification il ne saurait pas qu'il a du travail. Elle refuse sur une pièce
`comptabilisee` : là une écriture s'appuie dessus, et la corriger en silence
rendrait le grand livre de Mondher faux sans qu'il le sache. C'est une demande
de retour, pas une correction.

Côté contrat : `capture.preciser` garde son rôle sur une pièce non transmise ;
l'écran choisit entre les deux en lisant `vis`, exactement comme le bloc
« Revenir dessus » de `05-cablage-ecran-par-ecran.md`.

---

## Ce qu'il ne faut pas faire

**Ne refais pas ce qui marche.** L'audit a trouvé plus d'acquis que prévu :
`app.member_orgs()` rend déjà un ensemble, donc le multi-organisation fonctionne
sans rien ajouter ; le cabinet ne voit déjà que `partage`, y compris sur les
paiements et les justificatifs ; l'annulation d'un règlement et le rappel d'une
pièce par accord existent, inscrits et datés.

**Ne confonds pas les plafonds.** `agents.budgets.monthly_cost_cap` est en
dollars et borde ce qu'ALGORIA dépense chez Alibaba. Il n'a rien à voir avec
les lectures du client.

**Ne confonds pas les facturations.** `pricing`, `billing`, `catalog`,
`commissions` sont les ventes **du client**. `collab.*_honoraires` sont les
honoraires **du cabinet**. Le forfait Malica est le troisième, et il n'existait
pas avant ces migrations.

**Ne crée pas de surcharge de fonction.** `capture_piece_set_vis` et
`capture_piece_supprimer` ont vu leur ancienne signature droppée délibérément :
deux surcharges, et la garde se contourne en choisissant la plus permissive.

**Ne mets aucune règle dans l'application.** R6 : un filtre oublié dans du code
applicatif **ouvre** l'accès ; une politique RLS oubliée le **refuse**.

---

## Les onze règles, rappelées parce qu'elles décident

Elles sont dans `AGENTS.md` et elles sont exécutables en CI. Les quatre qui
mordent le plus sur ce travail :

- **R6** — l'isolation est portée par la base. Toute table de tenant porte un
  index menant par `tenant_id`, et un test échoue sinon.
- **R7** — une correction est une écriture nouvelle. Les tables de fait refusent
  l'UPDATE par déclencheur. `facturation.lectures` est en ajout seul.
- **R8** — le modèle est une donnée. Par analogie, la grille tarifaire vit dans
  `ref.offres`, versionnée par date d'effet : changer un prix est une ligne de
  migration, jamais un déploiement.
- **R11** — une migration donne le même référentiel quel que soit le jour où on
  la joue. Les dates sont écrites, jamais `current_date`.

---

## Et une question à poser avant de commencer

La grille entière repose sur un volume mensuel de factures d'achat que Mondher
Chaouech n'a jamais confirmé. Si sa réponse arrive pendant ce travail, elle ne
changera **qu'une ligne de `ref.offres`** — c'est précisément pour ça que la
grille est en base et pas dans le code. Ne la recopie nulle part ailleurs.
