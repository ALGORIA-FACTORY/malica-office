# Le banc sans IA — premier bulletin (4 novembre 2026)

Le banc lit chaque pièce par la chaîne de production **sans aucun modèle ni GPU** :
relevé (couche de texte d'un PDF, sinon OCR rapide ONNX sur CPU, le service de
`infra/ocr/`), jetons (`jetonsDuSudoku`), preuve (`resoudreLaPiece` et le moteur
WASM), grille et pack lus en base pour le type de la pièce, et le dossier connu.
Chaque concept est compté contre la vérité de son corpus :

- **juste** : imprimé, lu, égal à la vérité ;
- **faux** : imprimé, lu, différent ; **inventé** : non imprimé et pourtant lu.
  Ces deux issues sont interdites ;
- **silence** : imprimé, non lu (« inconnu »). C'est honnête, mais c'est à gagner.

```sh
# le service OCR du dépôt, sur CPU (port 8095), puis :
OCR_URL=http://127.0.0.1:8095 DATABASE_URL_ADMIN=<base migrée> \
node --experimental-strip-types apps/api/src/malica/lecture/banc-sans-ia.ts \
  --corpus algoria:outils/jeu-algoria --corpus synthetique:outils/jeu-synthetique \
  --corpus dirigeant:packages/sudoku/tests/donnees/jeux_dirigeant_ocr.json \
  --corpus photo:<image réelle>:<vérité json> \
  --cache <dossier des relevés> --sortie mesures.json > bulletin.md
```

Les relevés OCR sont gardés par pièce (`--cache`) : la mesure du moteur se rejoue en
13 secondes pour les 412 pièces. Une pièce réelle (`photo:`) se lit sur place et
n'est jamais copiée dans le dépôt.

## Bulletin 2 — après les mécanismes généraux (4 novembre 2026, soir)

Mêmes 412 pièces, moteur natif (même code que le WebAssembly), OCR avec lecture mixte :

|                |     juste |   faux |   silence | inventé |
| -------------- | --------: | -----: | --------: | ------: |
| Bulletin 1     |     4 014 |    452 |     7 642 |      37 |
| **Bulletin 2** | **4 842** | **84** | **6 798** |  **16** |

- Sens des parties dit : 131 sur 348, contre 62 ; aucune inversion.
- Les mécanismes et leurs mesures : `docs/brevet/dossier-d-invention.md` (I-A à I-G).
- Ce qui reste :
  - les silences (pièces non prouvées, 160 environ ; parties sans indice) ;
  - les faux de l'OCR manuscrit ;
  - les experts des pièces qui ne sont pas des factures ;
  - la présence d'un cachet ou d'une signature (aucun détecteur visuel).
- La médiane OCR CPU est de 5,5 s par image, contre 2,3 s : c'est le coût de la lecture
  mixte, à réduire par l'OCR guidé (I-H).
- Le banc se lance avec `--moteur-natif packages/sudoku/target/release/examples/resoudre`
  quand la cible wasm32 ne s'installe pas.

## Bulletin 3 — la pente de la page, et la vitesse sans perte (4 novembre 2026, nuit)

Mêmes 412 pièces, même cache OCR que le bulletin 2 :

|                |     juste |   faux |   silence | inventé |
| -------------- | --------: | -----: | --------: | ------: |
| Bulletin 2     |     4 842 |     84 |     6 798 |      16 |
| **Bulletin 3** | **5 114** | **74** | **6 536** |  **16** |

- Aucun champ n'est passé de juste à faux.
- MyTek : les cinq articles sont prouvés, avec leurs taux et leurs désignations complètes.
  Avant, aucun ne l'était, parce que la page est inclinée.
- Les mécanismes sont dans le dossier d'invention :
  - I-I : la pente de la page lue sur ses boîtes, et les rangées par recouvrement ;
  - I-J : un texte non prouvé se tait sous `lecture.confiance_du_texte`.

L'OCR, relancé sans cache :

- **Sonde arabe.** Une page sans arabe ne paie plus la relecture arabe. La médiane passe de
  5,5 s à 4,5 s par image, et les résultats sont identiques au champ près.
- **Lecture par vagues** (`--vagues`) :
  - la médiane passe à 3,4 s (−26 %) ;
  - mais 243 champs justes deviennent muets, et 4 faux s'ajoutent (voir I-K) ;
  - elle reste désactivée par défaut.

## Les corpus

| Corpus                                     |                                        Pièces | Vérité                                | Relevé                     |
| ------------------------------------------ | --------------------------------------------: | ------------------------------------- | -------------------------- |
| Jeu d'ALGORIA (`outils/jeu-algoria`)       | 161 : 100 achats, 20 ventes, 41 autres pièces | toute la grille de chaque pièce       | PDF ou OCR CPU             |
| Jeu synthétique (`outils/jeu-synthetique`) |                                  100 factures | totaux, TVA, droits, tableau, en-tête | PDF ou OCR CPU             |
| Jeux du dirigeant 100 et 50                |                                    150 pièces | en-tête et tableau                    | plan relevé sur le staging |
| MyTek (pièce réelle, lue en lecture seule) |                                             1 | totaux connus                         | OCR CPU                    |

## Les résultats, en bref

|                                 | juste | faux | silence | inventé | juste / imprimés |
| ------------------------------- | ----: | ---: | ------: | ------: | ---------------: |
| **Tous les champs**             | 4 014 |  452 |   7 642 |      37 |           33,2 % |
| Montants (familles « montant ») |   714 |   14 |     523 |       1 |           57,1 % |
| Cellules du tableau             | 2 318 |  300 |   4 211 |       0 |           33,9 % |
| MyTek (HT, TVA, timbre, TTC)    |     4 |    0 |       0 |       0 |            100 % |

- **Preuve du centre** : les factures sont prouvées 71 fois sur 120 dans le jeu
  d'ALGORIA, 50 fois sur 100 dans le jeu synthétique, 103 fois sur 150 dans les jeux
  du dirigeant. Les 41 autres pièces : 2 prouvées. Leurs grilles n'ont presque pas
  de preuve : leurs champs reposent sur les seuls experts.
- **Parties** : le sens n'est jamais inversé (0 échange). Il n'est dit que 62 fois
  sur 348 : il n'y a pas assez d'indices, ou le matricule n'a pas le bon format.
  Dans les jeux du dirigeant, les matricules inventés n'ont pas leur lettre de
  contrôle.
- **OCR sur CPU** (2 cœurs) : médiane 2,3 s, maximum 12,9 s par image (210 images).
- **Par langue** : l'arabe est juste à 11 %, le français à 39 %. **Par rendu** : le
  PDF est juste à 43 %, la photo à 35 %, le scan à 20 %.

L'objectif des 100 % est encore loin. Sur ce banc, le moteur sait **se taire** :
7 642 silences pour 452 faux. Mais il se trompe encore, et c'est par là qu'il
faut commencer.

## Les faux et les inventés, par cause

| #   | Cause                                                                                                          |        Faux | Où                                    | Nature                             |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------: | ------------------------------------- | ---------------------------------- |
| 1   | La désignation avale les colonnes voisines (référence, EAN, unité) ; elle est parfois coupée                   |         300 | `lignes`, expert désignation          | moteur                             |
| 2   | Le RIB est coupé au premier espace (« 99 »)                                                                    |          55 | expert `identifiant`                  | moteur                             |
| 3   | **Nom de l'émetteur = le dossier** (ALGORIA lu comme fournisseur sur un achat)                                 |          17 | expert `tiers`, anneau 2              | moteur, **échange de parties**     |
| 4   | Le libellé de l'étiquette pris pour la valeur (« règlement: », « Motif », « ORDRE DU JOUR », « Le Président ») |        ≈ 30 | expert `libelle`, repères             | moteur et repères en base          |
| 5   | La base de TVA rendue égale au HT quand le FODEC entre dans l'assiette ; une base à 0 % perdue                 |           9 | preuve `groupe_taux`                  | moteur, **dans une pièce prouvée** |
| 6   | Le numéro garde un préfixe ou un suffixe (« Jc: », « —18mars »)                                                |           9 | expert `reference`                    | moteur                             |
| 7   | La date prise sur la mauvaise étiquette (l'échéance, la date d'effet, la date de naissance)                    |        ≈ 14 | expert `date`                         | moteur                             |
| 8   | Une liste non ramenée à son code (« Télédéclaration », « Impôt sur les sociétés », « mensuel »)                |         ≈ 6 | expert `libelle` sur un champ `liste` | moteur                             |
| 9   | Une confusion de l'OCR que le format aurait dû arrêter (RC « B96B… », « 8503… »)                               |           3 | expert `identifiant`                  | moteur                             |
| 10  | Des totaux non prouvés mais rendus quand même (072, 083, 091)                                                  |           5 | sortie de la pièce non prouvée        | à vérifier côté chaîne             |
| —   | La devise « (DT) » est imprimée, mais la vérité du jeu ne la porte pas                                         | 22 inventés | vérité du corpus                      | **corpus**, à compléter            |

Ce qui n'est **pas** compté comme faux, parce que ce n'en est pas un :

- l'espace qu'un OCR perd dans une désignation ;
- une date-heure dont le moteur rend la date ;
- le titre imprimé « FACTURE / فاتورة » lu en code « facture » ;
- une raison sociale lue avec sa forme juridique ;
- une remise de la vérité écrite en fraction.

Le banc les normalise, une règle à la fois, et dit laquelle.

## Les corrections proposées : six inventions, dont trois d'abord

Le moteur est gelé depuis le 1er novembre. **Aucune de ces corrections n'est faite
sans l'accord du dirigeant.** Chacune se mesure à ce banc, avant et après.

**Recherche d'antériorité : INCERTAIN.** Je n'ai fait qu'une recherche rapide.
Elle est à refaire par un conseil en propriété industrielle avant tout dépôt. Les
antériorités repérées :

- l'extraction neuro-symbolique qui vérifie l'arithmétique des pièces
  transactionnelles (arXiv 2512.09666, décembre 2025) ;
- l'identification du fournisseur par ses identifiants d'entreprise (n° de TVA,
  IBAN) dans les logiciels de capture (Continia Document Capture) ;
- la génération de données synthétiques pour extraire les lignes de facture
  (brevet US 11 798 301).

Les revendications ci-dessous visent ce que ces antériorités ne font pas, à ma
connaissance.

### I-1 — La triangulation des parties par exclusion du dossier (cause 3)

**Le problème.** Le lecteur sait qui est le dossier. Il voit deux blocs d'identité
sur la page, et il doit dire lequel est l'émetteur. Les capteurs connus cherchent le
fournisseur dans une base de fournisseurs connus. Ici, le tiers est souvent inconnu.

**L'invention.** On prouve d'abord la place du dossier : son matricule, lu sous
l'une de ses formes (barrée, compacte, espacée, chiffres orientaux), ancre son bloc.
On construit ensuite le **grappe légale** de l'autre partie : matricule, RC, RIB,
téléphone, adresse, groupés par voisinage géométrique et par compatibilité de
format. Le bloc de la contrepartie est alors **le seul bloc d'identité complet qui
ne contient aucun identifiant du dossier**. Un nom n'est attribué à une partie que
s'il appartient à la grappe de cette partie. S'il n'appartient à aucune grappe, ou
à deux, le moteur s'abstient.

**Revendication principale (projet).** Un procédé d'attribution des rôles de partie
dans un document lu par OCR, dans lequel :

- (a) un identifiant connu du titulaire du dossier est recherché sous un ensemble
  de formes normalisées ;
- (b) les jetons d'identité sont regroupés en grappes par voisinage et par format ;
- (c) la grappe qui contient l'identifiant du titulaire reçoit le rôle du titulaire,
  et le rôle opposé est attribué à l'unique grappe complète disjointe ;
- (d) toute valeur d'identité hors de ces deux grappes est refusée.

### I-2 — La preuve d'alignement en-tête / tableau (cause 1)

**Le problème.** Une désignation avale la référence, l'EAN et l'unité, parce que
les colonnes du tableau ne sont pas séparées par des traits.

**L'invention.** Les rangées prouvées par l'arithmétique (q × prix = montant)
fixent les colonnes numériques. Les mots de l'en-tête du tableau sont appariés aux
colonnes par un **couplage biparti qui respecte l'ordre gauche-droite**. Les bornes
de chaque colonne textuelle (référence, code-barres, désignation, unité) se
déduisent de la structure du tableau et ne se devinent pas rangée par rangée. Une
cellule n'est rendue que si elle tombe entre deux bornes prouvées. Un code de
13 chiffres de clé EAN valide est une preuve de colonne.

**Revendication (projet).** Le découpage des colonnes textuelles d'un tableau à
partir de colonnes numériques prouvées par une contrainte arithmétique de rangée,
par couplage ordonné avec les intitulés de l'en-tête.

### I-3 — L'OCR à la demande, guidé par la preuve (latence, et causes 2 et 9)

**Le problème.** L'OCR relit toute la page (12,9 s pour MyTek sur CPU).

**L'invention.** La détection des lignes est rapide. La reconnaissance ne lit
d'abord que les zones que la grille rend nécessaires : la zone des totaux, les
étiquettes de la grille, les identifiants. Le moteur demande ensuite une **relecture
ciblée** de la zone où une preuve échoue, ou là où un identifiant viole son format
(clé du RIB, lettre de contrôle du matricule, forme du RC). La relecture se fait
avec un autre modèle (l'arabe, par exemple) ou à une autre échelle. On ne relit
plus la page : on relit **la contradiction**.

**Revendication (projet).** Une boucle dans laquelle un solveur de contraintes
désigne à l'OCR les régions à reconnaître ou à relire, en fonction des preuves non
fermées et des violations de format, jusqu'à la preuve ou l'abstention.

### Les trois suivantes

- **I-4 — L'assiette prouvée (cause 5).** La base d'un taux de TVA n'est jamais un
  jeton choisi. Elle est la **somme prouvée** des jetons qui entrent dans l'assiette
  du pack (HT, FODEC…). Elle est rendue « déduite » quand aucun jeton imprimé ne
  l'égale. Un jeton imprimé mal lu (« 2.992,725 » pour 2 942,725) est alors signalé,
  et il n'est pas cité.
- **I-5 — L'étiquette n'est pas une valeur (causes 4, 7, 8).** Chaque repère de la
  grille est un mot interdit comme valeur de son champ et des champs voisins. Une
  date ou un libellé est lié à **son** étiquette par la géométrie et par le rang
  (les ordinaux). Un champ `liste` n'est rendu que ramené à un code de sa liste en
  base.
- **I-6 — L'identifiant par son format, jamais par ses espaces (causes 2, 6, 9).**
  Le RIB (2-3-13-2 chiffres, clé), le RC et le matricule se lisent d'abord par leur
  automate de format, qui traverse les espaces et coupe aux bornes. Un identifiant
  dont la clé échoue n'est pas rendu : il déclenche I-3.

## Ce qui reste à faire, dans l'ordre

1. **L'accord du dirigeant** pour toucher au moteur gelé. On commence par I-1 et
   I-4, parce que ce sont des faux sur la partie et dans une pièce prouvée. Puis
   I-6 et I-5, enfin I-2 et I-3.
2. **Compléter le corpus** : la devise imprimée « (DT) » ; les matricules des jeux
   du dirigeant (lettre de contrôle). Ces matricules sont tels que le staging les a
   lus, ce n'est pas une donnée à corriger en silence. Il faut les relever à part.
3. **Chaque correction passe à ce banc, avant et après.** Une correction qui fait
   apparaître un seul faux nouveau est refusée.
