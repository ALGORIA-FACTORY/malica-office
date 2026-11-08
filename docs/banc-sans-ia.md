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

L'OCR, relancé sans cache à chaque mesure (210 images, deux processeurs, sans GPU) :

|                                           |   médiane |       p95 |     total |
| ----------------------------------------- | --------: | --------: | --------: |
| Bulletin 2                                |     5,5 s |         — |         — |
| Sonde arabe                               |     4,5 s |     9,4 s |   1 059 s |
| **Lecture en deux temps, image contiguë** | **3,9 s** | **8,5 s** | **901 s** |

- **Sonde arabe.** Une page sans arabe ne paie plus la relecture arabe, à champs
  identiques.
- **Image contiguë.** OpenCV recopiait l'image entière à chaque découpe de ligne. Sur
  MyTek, la découpe passe de 1,2 s à 0,02 s et la détection de 1,3 s à 0,9 s.
- **Deux temps.** Le service rend le tableau d'abord, puis la page entière. 78 pièces sont
  prouvées dès le tableau, en 1,8 s médianes.
- **Rien n'est sauté.** Par rapport à la lecture d'avant, 5 116 champs sont justes contre
  5 114 et 73 faux contre 74. Aucun champ n'est perdu, aucun ne devient faux.
- **Mesuré, puis écarté :**
  - sauter la seconde vague quand les totaux se prouvent : 243 champs justes perdus ;
  - une ligne à la fois : 2,5 % gagnés, mais deux faux de plus ;
  - des poids int8 : plus lents sur ce processeur, et 36 lignes sur 140 lues autrement ;
  - deux sessions en parallèle sur les mêmes lots : aucun gain.
- **Débit.** `OCR_LECTEURS` lit plusieurs pages à la fois. Sur deux cœurs, deux pages de
  MyTek prennent 8,2 s avec deux lecteurs d'un fil, contre 10,8 s avec un lecteur de deux
  fils. L'API lit les pages d'une pièce autant à la fois que le service le dit.

## Bulletin 4 — zéro valeur fausse affirmée (4 novembre 2026, fin de nuit)

Mêmes 412 pièces, même cache OCR. Le banc compte désormais à part les **pistes
signalées** : une valeur que le moteur montre sans l'affirmer (statut `signale`). Elles ne
sont plus comptées justes. C'est pourquoi la colonne « juste » baisse : elle ne compte que
ce que le moteur affirme.

|                          |     juste |  faux |   silence | inventé | signalé (non affirmé) |
| ------------------------ | --------: | ----: | --------: | ------: | --------------------: |
| Bulletin 3 (tout compté) |     5 114 |    74 |     6 536 |      16 |                     — |
| **Bulletin 4**           | **4 757** | **0** | **6 629** |   **0** |               **338** |

Sur les 338 pistes signalées, la vérité en dit 26 fausses : ce sont des pistes, jamais des
valeurs rendues.

Chaque faux a eu sa cause exacte et sa correction générale :

| Cause                                                                                                    | Correction                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Une date ou un identifiant sans libellé, rendu pour plusieurs champs                                     | sans ancre, le champ est signalé ; ancrage par séparateur, deux-points, libellé de plusieurs mots exact, arabe normalisé     |
| Le champ d'une partie lu au voisin (matricule du preneur pour le bailleur, RC du client pour l'émetteur) | plusieurs valeurs pour un même libellé de partie : signalé                                                                   |
| Une cellule d'une parcelle répétée rendue comme champ de la pièce                                        | `ref.grille_champs.repetee` : ce n'est pas un champ de la pièce                                                              |
| Un texte coupé (borne de mots, paragraphe qui continue, cellule trop étroite)                            | un texte n'est rendu qu'entier                                                                                               |
| Un mot mal lu par l'OCR avec assurance (« matérel », « 2oo », « I'Ouest »)                               | doute lexical sans modèle : Hunspell fr/en et listes de mots, confusions classiques de l'OCR ; la valeur non prouvée se tait |
| Une valeur non prouvée sous le seuil de confiance                                                        | `lecture.confiance_du_texte` à 0,96 (distribution dans la migration)                                                         |
| La ventilation d'une exonération partielle sans sa part exonérée (a102)                                  | la part exonérée est une instance, nommée par `taux_exonere` (EXO) et vérifiée par les lignes sans taux                      |
| Un net à rembourser jamais imprimé, « prouvé » sur le jeton du total (a135)                              | une valeur imprimée une fois n'est lue que pour un champ ; une preuve qui ne tenait que par ce partage tombe                 |
| Une désignation sur trois lignes, la tête perdue (50/08)                                                 | le centrage de la cellule compte la suite sous la rangée                                                                     |
| Une désignation dont la seconde ligne cite un montant (50/32)                                            | sans en-tête reconnu, une rangée serrée sous la ligne fait taire la désignation                                              |

- **Un champ juste perdu, honnêtement :** a135 `total_frais` (304,000). Il n'était
  « prouvé » que par net = total − avance, sur le même jeton. Il revient avec la preuve
  « somme des lignes = total » de la note de frais (P01, encore `a_traduire`).
- **Une règle de comparaison du banc, dite ici :** la vérité d'un identifiant saisie avec
  son libellé (« N° 1547 ») se compare sans ce libellé, pris dans les repères du champ en
  base. Une seule pièce change : 50/12, de faux à juste.
- Les régressions sont fixées dans `packages/sudoku/tests/zero_faux_du_banc.rs`.

## Bulletin 5 — des silences aux preuves, sans nouveau faux (4 novembre 2026, aube)

Mêmes 412 pièces, même cache OCR, toujours **0 faux et 0 inventé** :

|                |     juste |  faux |   silence | inventé | signalé (non affirmé) |
| -------------- | --------: | ----: | --------: | ------: | --------------------: |
| Bulletin 4     |     4 757 |     0 |     6 629 |       0 |                   338 |
| **Bulletin 5** | **5 029** | **0** | **6 450** |   **0** |               **245** |

Le diagnostic d'abord : sur les 85 factures non prouvées sans raison dite, 47 portaient
tous leurs totaux lus. Ce n'était pas l'OCR, c'était l'appariement des libellés. Trois
mécanismes généraux :

- **L'appariement global d'une colonne de libellés** (`reperes::colonnes_de_libelles`).
  Photographiée, la colonne des montants glisse d'une demi-rangée, et le voisin d'un
  libellé n'est plus sa valeur. L'ordre, lui, se conserve : le i-ème libellé d'une
  colonne (alignée, serrée, en majorité terminée par « : ») va à la i-ème valeur de la
  suite la plus proche. Un « : » perdu (« Timbre fiscalt ») ne rompt pas la colonne, et
  une valeur de trop au-dessus (la dernière ligne d'articles) non plus. Pièces
  prouvées : a013, a029, a030, a034, a035.
- **Une charge proportionnelle s'annonce par son taux** imprimé, sans mot, sur une
  rangée chiffrée (« 31,675 1 % »). Le FODEC dont le libellé arabe n'est pas lu n'est
  plus pris dans le HT. « Retenue à la source 1 % » porte un mot et n'annonce rien.
  Pièces prouvées : a054, a057, s042, s062.
- **Un point collé après des décimales complètes** (« 534,443. ») laisse une lecture
  faible ; l'arithmétique la retient ou non. « 8, » reste illisible. Pièce prouvée : a018.

- **Le dictionnaire des concepts complété, en base** : le HT arabe « المبلغ الصافي دون اعتبار
  الأداءات » et « المجموع دون اعتبار الأداءات » (a053, a063, a096, a099, s041, s053), la
  mention d'exonération arabe « معفاة من الأداء » et « معفى من الأداء ». Une mention en
  plusieurs jetons s'annonce désormais (un mot par jeton en arabe).
- **L'exonération totale nomme sa part exonérée** (`taux_exonere`, EXO, INCERTAIN comme
  pour la partielle) : la ventilation rend « 0 % : tout le HT », que la vérité attend.
- **Le partage d'un jeton se juge sur chaque solution, avant l'unicité.** Une seconde
  solution qui lisait un champ requis sur le jeton d'un autre (le TTC sur le seul
  « 1,000 » du timbre, le HT sur « 0,000 ») n'est pas une seconde lecture. Lue forte, une
  valeur ne compte que ses occurrences fortes. Nettoyée, la solution doit encore tenir.
  Huit factures ambiguës sont levées (a036, a046, a055, a065, a066, a073…), lignes
  comprises.
- **Retirer la preuve arithmétique ne retire que ses champs** : les matricules établis
  par l'identité (anneau 2) restent prouvés, quelle que soit la variante.

Mesuré, puis écarté : relancer la recherche sans la restriction aux valeurs ancrées
quand elle ne trouve rien. Sur le jeu des 100 factures, la variante « TTC avec timbre »
prenait alors le net à payer pour le TTC. Rien n'en dépendait une fois l'appariement en
place.

Les régressions sont fixées dans `packages/sudoku/tests/des_silences_aux_preuves.rs`.

## Bulletin 6 — les dates, l'OCR des chiffres orientaux, et la couche de texte à zéro (4 novembre 2026, matin)

Mêmes 412 pièces. Les pièces arabes et hybrides sont relues par l'OCR corrigé (126 pages,
cache `cache9`) ; les autres gardent leur lecture :

|                |     juste |  faux |   silence | inventé | signalé (non affirmé) |
| -------------- | --------: | ----: | --------: | ------: | --------------------: |
| Bulletin 5     |     5 029 |     0 |     6 450 |       0 |                   245 |
| **Bulletin 6** | **5 120** | **0** | **6 360** |   **0** |               **244** |

Et, pour la première fois, la **couche de texte** du jeu du dirigeant (134 pièces,
`jeux_dirigeant_jetons.json`), que le banc des 412 ne mesurait pas. Elle portait **5 faux**
affirmés avant cette passe ; elle n'en porte plus : **1 761 justes, 0 faux, 0 inventé**.

Causes exactes et corrections :

- **OCR** (`infra/ocr/service.py`) : devant des chiffres arabes orientaux, le modèle latin
  ne rend que leurs séparateurs (« , »), et une ligne de ponctuation passait pour une ligne
  de chiffres : la lecture arabe était jetée. Il faut désormais un chiffre, et un latin qui
  n'a lu aucun chiffre n'a rien à troquer contre l'arabe.
- **Le deux-points collé à la valeur** (« التاريخ | :11-09-2026 ») dit le sens du libellé
  comme un deux-points seul.
- **L'expert des dates ne défait plus une date ancrée** sous son libellé quand il ne voit
  rien lui-même, sauf si c'est la date qu'il donne à l'autre champ de la paire.
- **Un repère court** (« Le », « MF ») ne se lit pas dans un mot (« AVANTLE ») ; sur le
  jeton de la valeur, il se colle en tête (« MF0458213A/A/C/000 »).
- **Une date est un tout** : ni morceau d'une référence (« CEV-26-04-0778 »), ni d'une
  période (« 05/05-15/05 »), et ses deux séparateurs sont de la même espèce. Un mois collé
  à l'année (« 04 | février2026 ») se relit décollé.
- **Couche de texte** : la remise prise dans la désignation emporte son annotation
  (« (remise 10 %) ») ; un texte qui finit à moins d'un blanc et deux signes de la
  colonne suivante, sur la dernière ligne de sa cellule, a pu être coupé (« … couleur »
  pour « … couleur A4 », ticket à chasse fixe) et se tait.
- **Une règle de comparaison du banc, dite ici** : une vérité arabe saisie dans l'ordre
  visuel (les lettres retournées, 100/D-14) se compare aussi retournée. Une pièce change.

Étape 3, les grilles autres que la facture (deux preuves traduites, en base) :

- **Le devis** se prouve par ses totaux : HT + TVA = TTC, et TVA = HT × un taux du barème.
  Les trois devis du banc sont prouvés. La vérité du jeu du dirigeant ne porte pas leurs
  totaux, donc le tableau ne les compte pas. Ils ont été vérifiés à la main contre la
  somme des lignes de la vérité : 12 490,000, 6 438,000 et 10 700,000 HT à 19 %, justes
  tous les neuf.
- **L'avoir** se prouve aussi par son taux. a127 est prouvé juste (3 champs) et a126 le
  reste. Un avoir avec FODEC ou à plusieurs taux reste muet, jamais faux.

Restent dans le silence, avec leur cause : les factures arabes MANUSCRITES (chiffres
orientaux tracés à la main, lus de travers par les deux modèles : étape 5), les ventes à
l'export (taux zéro EXPORT, mention à traduire), les pièces dont l'OCR a perdu un total.

## Bulletin 7 — le cachet vu sans modèle (4 novembre 2026, midi)

Mêmes 412 pièces. Les pages lues par le second lecteur sont relues pour leurs marques
(cache `cache10`, 209 pages) : leurs textes sont identiques au pixel.

|                |     juste |  faux |   silence | inventé | signalé (non affirmé) |
| -------------- | --------: | ----: | --------: | ------: | --------------------: |
| Bulletin 6     |     5 120 |     0 |     6 360 |       0 |                   244 |
| **Bulletin 7** | **5 146** | **0** | **6 334** |   **0** |               **244** |

- **Le détecteur** (`infra/ocr/service.py`, `_cachets`) cherche une empreinte d'encre de
  COULEUR, compacte (ni trait, ni ligne de texte) et creuse (un anneau, un cadre). Mesuré
  hors banc sur les 161 rendus du jeu d'ALGORIA : 41 cachets trouvés sur 81, aucun sur
  les 80 pièces sans cachet. Une photocopie, où le cachet devient gris, n'est pas vue :
  rien n'est rendu plutôt qu'un faux.
- **Le moteur** ne l'affirme que pour le champ qui l'attend (`ref.grille_champs.marque`,
  posé sur le cachet de l'émetteur de la facture), et seulement s'il est le seul de la
  grille à l'attendre : un cachet ne dit pas de qui il est.
- **26 cachets justes**, 0 inventé, alors que la vérité complète du jeu d'ALGORIA aurait
  compté comme inventé tout cachet lu sur une pièce qui n'en porte pas.
- **Pas encore** : la signature (un trait d'encre fin, à distinguer de l'écriture
  manuscrite) et les champs qui mêlent cachet et signature (« Signature et cachet »).

## La colonne « normal » (4 novembre 2026, après-midi)

Un silence est un champ imprimé que le moteur n'affirme pas. Le rapport le coupe désormais
en deux :

- **normal** : la valeur attendue n'est nulle part dans la lecture de la pièce. Elle a été
  perdue par l'OCR (« LSB » pour « USB »), elle est illisible, ou elle n'est pas imprimée
  telle que la vérité la dit. Aucun moteur ne la prouverait sur ce relevé.
- **à travailler** : la valeur est dans la lecture, et le moteur ne sait pas encore la
  prouver ou l'attribuer.

Le doute compte contre le moteur. Une valeur de moins de trois signes, une valeur de liste
(« TND » s'imprime « DT ») et une marque (un cachet, une signature) ne sont jamais
« normales ».

|                 | silence | dont normal | dont à travailler |
| --------------- | ------: | ----------: | ----------------: |
| tous les champs |   6 334 |         866 |             5 468 |

« Normal » ne veut pas dire « perdu pour toujours ». Ces silences se gagnent par une
meilleure lecture (OCR, étape 5), pas par le moteur.

## Bulletin 8 — la relecture guidée par la contradiction (4 novembre 2026, soir)

Quand une pièce est prouvée par ses totaux et que ses lignes ne ferment pas, le banc fait
relire, cellule par cellule, les seules cellules des rangées d'articles
(`relecture.ts`, `POST /relire` du service OCR). Une relecture ne remplace un jeton que si
elle est plus sûre ; le moteur rejuge ensuite.

|                | juste | faux | dont à travailler | inventé |
| -------------- | ----: | ---: | ----------------: | ------: |
| avant          | 5 454 |    0 |             5 167 |       0 |
| avec relecture | 5 472 |    0 |             5 151 |       0 |

Le diagnostic qui suit : sur les pièces prouvées, 779 cellules de lignes ont toutes leurs
valeurs dans la lecture, et le tableau ne se prouve pas quand même. Ce n'est plus l'OCR,
c'est la structure. Un article a sa désignation sur la rangée visuelle du dessous, ses
chiffres sur celle du dessus, et des lignes « SN » s'intercalent. C'est le chantier
suivant.

Pas encore fait : la relecture en production, et sur les PDF.

## Bulletin 9 — le tableau qui se prouve en taisant ce que l'OCR a perdu (4 novembre 2026, nuit)

Sur les pièces prouvées, 779 cellules de lignes avaient toutes leurs valeurs dans la
lecture, et le tableau ne se prouvait pas. La cause racine, pièce par pièce (algoria-018,
un scan) :

- **La lecture du milieu ignorait les prix TTC.** Le gabarit A imprime « PU TTC » et un
  montant HT : 1 × 247,000 ÷ 1,19 = 207,563. La lecture du milieu ne fermait que par
  q × p = m. Ses graines venaient de `triplets(r, false)` : aucune graine sur un tableau
  TTC, aucune ligne. Elle ferme désormais ses rangées par la même règle que la stratégie
  de toujours (`Contexte::fermeture`).
- **Un « 1 » isolé que l'OCR n'a pas vu bloquait tout le tableau.** L'en-tête annonce une
  remise (« R. ») : la quantité ne se déduit pas, et la rangée bloquait. Une **rangée
  partielle** reste une ligne : son montant est prouvé par la somme exacte, sa cellule
  perdue est **tue**. Le prix n'est rendu que si une quantité entière le ferme avec le
  montant. Un tableau qui porte une rangée partielle ou une remise lue ne déduit plus
  rien (100/A-07 : deux quantités déduites justes par chance, que rien ne garantissait).
- **Le numéro de série n'est pas la désignation.** « Multiprise parafoudre 5 prises
  SN:981368512458374 » : la ligne « SN : … » de la cellule ouvre un autre champ de la
  parcelle (`numero_serie_ligne`, migration 20261127200000). Deux mots d'une même ligne de
  texte ne se recouvrent pas (« Hub SN: USB-C », algoria-025).
- **Un mot sous une tache.** « Souris optique sans fi » : la ligne à 0,98, le i à 0,69.
  Le second lecteur rend désormais la probabilité de chaque caractère ; un mot dont le
  caractère le moins sûr est sous 0,8 (`lecture.confiance_du_caractere`, migration 20261127210000) fait taire la désignation ou le nom qui le porte. Le seuil vient de la
  mesure : sur 162 désignations justes d'images, 15 ont un caractère sous 0,8 ; les deux
  désignations fausses en avaient un à 0,69 et à 0,78.

Une relecture des désignations par le même modèle a été essayée puis retirée : elle
redisait « sans fi », et coûtait 43 désignations justes.

|            | juste | faux | dont à travailler | inventé |
| ---------- | ----: | ---: | ----------------: | ------: |
| bulletin 8 | 5 472 |    0 |             5 151 |       0 |
| bulletin 9 | 5 936 |    0 |             4 681 |       0 |

Six valeurs justes passent en « signalé » : un caractère sous 0,8 les rend incertaines,
le moteur les signale au lieu de les affirmer.

**Ce qui reste fragile, dit.**

- Le seuil de 0,8 laisse une marge courte (une désignation fausse à 0,78). Il se
  règle par une ligne de référentiel.
- Un tableau prouvé du milieu SANS en-tête lisible prend dans la désignation tout ce
  qui est à gauche de la colonne des quantités. Un bloc posé à côté du tableau (« RC »,
  un téléphone) peut y entrer. Aucune pièce du banc ne le fait aujourd'hui (0 faux) ;
  une épreuve du moteur le montre sur une pièce retouchée (50/11).
- La probabilité par caractère n'existe que pour le second lecteur ; la relecture
  arabe et les PDF n'en ont pas.

## Bulletin 10 — le sens de la pièce par l'étiquette du client (5 novembre 2026)

Les matricules des deux parties étaient lus, et le moteur ne les rendait pas : il ne
savait pas laquelle émet la pièce (« aucun indice de sens », 45 pièces). La grappe
légale ne votait que si le bloc d'une partie ne portait AUCUNE étiquette de l'émetteur ;
or un client imprime souvent son RC et son téléphone (algoria-001 : « RC : B0128… » à
côté du matricule du dossier, client).

Les étiquettes du client (« Client », « Facturé à », « الحريف »), elles, ne s'impriment
que dans le bloc du destinataire. Le bloc qui en porte une, quand l'autre n'en porte
aucune, est le client. Les indices restent tous concordants ou rien.

|             | juste | faux | dont à travailler | sens justes |
| ----------- | ----: | ---: | ----------------: | ----------: |
| bulletin 9  | 5 936 |    0 |             4 681 |   132 / 348 |
| bulletin 10 | 5 949 |    0 |             4 667 |   139 / 348 |

**Mesuré et écarté.**

- Le vote de la géométrie (le matricule le plus haut est l'émetteur) contredit
  l'étiquette sur le gabarit A, qui imprime le matricule de l'émetteur en pied de page :
  23 pièces passent en « indices contradictoires ». Sans ce vote : 6 029 justes mais
  9 faux, dont deux pièces aux parties échangées (50/15, 50/23). Il reste : il ne décide
  jamais, il empêche.
- Donner le rôle « client » à l'adresse de livraison : le dictionnaire des concepts le
  refuse (`adresse_livraison` ne porte sur aucune partie — une livraison peut se faire
  chez un tiers). Rien n'est forcé.

**Piste suivante.** Comparer le haut des BLOCS des parties, pas celui de leurs
matricules : sur le gabarit A, les deux blocs commencent à la même hauteur.

## Bulletin 11 — le sens déclaré par la personne, et le matricule du tiers corroboré (5 novembre 2026)

Le dirigeant : « tu peux vérifier la matricule de celui qui fait le scan pour identifier la
matricule du tiers ; l'utilisateur identifie le sens (achat ou vente) et peut le corriger
après ». Le moteur reçoit désormais ce sens comme un fait connu (`connus.sens`) :

- le matricule du dossier (celui qui scanne) le place — client d'un achat, émetteur d'une
  vente — et l'autre matricule est le TIERS ;
- des indices de la pièce UNANIMES contre la déclaration la font signaler (« le sens
  déclaré contredit la pièce ») : une déclaration fausse se voit, elle ne se recopie pas ;
- en production, seul un sens CONFIRMÉ (`document_kind_statut = confirme`) est passé au
  moteur (`depots/sens.ts`) ; un sens seulement lu ne l'est pas.

Le sens résolu a montré des faiblesses qui ne se voyaient pas ; elles sont fermées :

- **Le matricule du tiers n'est affirmé que corroboré** : couche de texte exacte, deux
  occurrences qui concordent, tiers connu du dossier, ou chaque caractère lu avec
  assurance. Sinon il est rendu à vérifier (50/02 : « 0567321M » lu « 0557321M » une seule
  fois, par un OCR sans confiance). Le matricule du dossier est corroboré par sa fiche.
- **Deux matricules lus à un chiffre près** sont une écriture lue deux fois, dont l'une est
  fausse : rien n'est rendu (50/03, 50/33, 50/49 — le moteur en choisissait une).
- **Une civilité n'est pas un nom** : « M. », repère du client, n'est plus son nom.
- **Les morceaux latins d'une ligne mixte** (« المعرف الجبائي : 1381012E/A/M/000 ») portent
  enfin la probabilité de leurs caractères.
- **L'étiquette du client** (bulletin 10) ne vote plus qu'en repli : « Doit : », qui coiffe
  le bloc du dossier, était rattachée par proximité au bloc du fournisseur (50/02, 50/04,
  50/46, couche de texte).
- **La ligne principale d'une désignation** reste, même quand ses mots ressemblent à un
  libellé (« Droit de consommation 25 % », 100/B-20) — sauf un identifiant ou un repère
  seul (« SN », algoria-032).

|                               | juste | faux | dont à travailler | sens justes |
| ----------------------------- | ----: | ---: | ----------------: | ----------: |
| bulletin 10                   | 5 949 |    0 |             4 667 |   139 / 348 |
| bulletin 11, sens lu          | 5 943 |    0 |             4 659 |   143 / 348 |
| bulletin 11, sens déclaré     | 6 052 |    0 |             4 528 |   193 / 348 |
| couche de texte, sens lu      | 1 878 |    0 |               922 |           — |
| couche de texte, sens déclaré | 1 899 |    0 |               901 |           — |

**Mesuré et écarté.** La lettre de contrôle du matricule (somme pondérée modulo 23,
`ref.identifiant_controles`, INCERTAINE) ne peut pas servir ici : les matricules inventés
des jeux d'essai ne la suivent pas (254 des matricules rendus justes la violent), alors que
146 des 150 matricules publics testés la suivent. Les jeux d'essai devraient porter des
lettres conformes.

**La correction du sens après la lecture** (option A du dirigeant, 5 novembre 2026). Le
jugement rejoue la lecture sur ses jetons gardés, avec le sens confirmé — aucun OCR, aucun
modèle (`apps/api/src/scan/parties-selon-le-sens.ts`). Le dossier prend son matricule ; le
tiers, celui que le moteur prouve, sinon celui que la lecture avait lu. La lecture inscrite
ne change pas (R7). Épreuve : une lecture qui avait rangé le dossier en émetteur, corrigée
en achat, n'est plus rejetée (`le-sens-corrige-replace-les-parties.test.ts`, qui échoue
sans le correctif).

## Bulletin 12 — un sens déclaré rend ce qui est lu, même partiel (5 novembre 2026)

Sans déclaration, le sens se lit sur la pièce : il faut le matricule du dossier ET un
autre. Avec un sens déclaré, rien ne justifiait de tout taire quand l'un manque : le nom
du dossier ne dépend d'aucun matricule (sa fiche le donne, la page le porte), et le seul
matricule lu, quand ce n'est pas celui du dossier, est le tiers. Le moteur rend donc ce
qu'il lit — un matricule non lu n'est jamais recopié de la fiche, puisque rien ne prouve
qu'il est imprimé.

Deux gardes l'accompagnent :

- un matricule lu à un chiffre de celui du dossier est le sien, mal lu : rien n'est rendu ;
- un nom connu (du dossier, d'un tiers en base) n'est rendu que si chaque mot imprimé est
  celui de la fiche, ou ce mot sans ses accents : « ALGORIA FAÇTORY SARL » (algoria-065,
  une cédille que la fiche n'a pas) est une lecture fausse.

|                                 | juste | faux | dont à travailler |
| ------------------------------- | ----: | ---: | ----------------: |
| banc, sens déclaré, bulletin 11 | 6 052 |    0 |             4 528 |
| banc, sens déclaré              | 6 215 |    0 |             4 347 |
| couche de texte, sens déclaré   | 1 990 |    0 |               808 |

Sans déclaration, rien ne change (5 943 justes, 0 faux).

## Bulletin 13 — les lignes : deux articles réunis, et une lettre perdue (5 novembre 2026)

Le plus gros bloc « à travailler » est celui des lignes : environ 2 200 cellules. Sur les
pièces prouvées, les tableaux du gabarit A (scans, photos) se taisaient encore. Causes
exactes, pièce par pièce (algoria-022, 029) :

- **Deux articles dans une seule rangée.** Les rangées se forment de proche en proche ; les
  lignes « SN » intercalées réunissaient deux articles dont la quantité était perdue
  (« 160,000 | 134,454 » et « 43,500 | 36,555 »). Une rangée qui porte deux montants
  EMPILÉS dans une même colonne se scinde : une bande par montant, qui garde les jetons de
  sa ligne ; les autres lignes redeviennent des rangées à part (`scinder_les_empilees`).
- **La ligne de livraison de l'article d'avant** (« D1 **1.00 ») devenait la tête de la
  désignation : le centrage du texte comptait les lignes « SN » sous l'article. Elles n'en
  comptent plus ; et une ligne de la rangée au-dessus de la ligne principale n'est gardée
  que si elle recentre le texte sur les chiffres (`au_dessus_centrees`).
- **Une lettre perdue.** « Claver » pour « Clavier » : chaque caractère est sûr, et
  « claver » est un mot. Le décodeur CTC laisse la trace de la lettre perdue dans les
  tranches où le blanc l'a emporté (le i à 0,33). Le second lecteur rend ce MANQUE après
  chaque caractère ; au-dessus de 0,15 (`lecture.manque_du_caractere`), le mot est
  incertain. Sur 200 désignations justes, le plus fort manque est 0,034.

|                                 | juste | faux | dont à travailler |
| ------------------------------- | ----: | ---: | ----------------: |
| banc, sens déclaré, bulletin 12 | 6 215 |    0 |             4 347 |
| banc, sens déclaré              | 6 410 |    0 |             4 156 |
| banc, sens lu                   | 6 138 |    0 |             4 468 |
| couche de texte, sens déclaré   | 1 990 |    0 |               808 |

## Bulletin 14 — une page gauchie : la pente locale, et l'en-tête dans la première rangée (5 novembre 2026)

algoria-014 est la photo d'une page gauchie, pas tournée : la pente des lignes va de 0,041
en haut à 0,018 en bas. Deux causes exactes faisaient taire son tableau :

- **Une seule pente pour la page.** Les paires de jetons votaient une pente ; trop
  dispersés, les votes ne s'accordaient pas et la pente retenue était nulle. Les rangées
  séparaient alors le montant de sa quantité et de son prix. Chaque jeton se redresse
  désormais à la pente LOCALE : les votes des paires à ±0,08 de sa hauteur
  (`FENETRE_DE_PENTE`), avec le même pic d'accord ; à défaut, la pente de la page. Une
  correction globale de rotation avait été essayée et retirée : elle aggravait la page.
- **L'en-tête collé au premier article.** Sans rangée d'en-tête au-dessus du tableau, les
  colonnes de référence et d'EAN se lisaient comme la désignation. L'en-tête se cherche
  aussi parmi les lignes de la première rangée prouvée, au-dessus de sa ligne d'ancrage
  (`colonnes.rs`, `dans_la_premiere`).

Les vingt rangées se prouvent entières (test `des_lignes_partielles`, qui échoue sans le
correctif).

|                                 | juste | faux | inventé | dont à travailler |
| ------------------------------- | ----: | ---: | ------: | ----------------: |
| banc, sens déclaré, bulletin 13 | 6 410 |    0 |       0 |             4 156 |
| banc, sens déclaré              | 6 495 |    0 |       0 |             4 071 |
| banc, sens lu                   | 6 223 |    0 |       0 |             4 383 |
| couche de texte, sens déclaré   | 1 990 |    0 |       0 |               808 |

## Bulletin 15 — le matricule sans sa lettre, la devise non imprimée, EXO ou EXPORT (5 novembre 2026)

Trois décisions du dirigeant, du 5 novembre 2026.

- **Un matricule imprimé sans sa lettre de contrôle se calcule.** Les pièces du jeu du
  dirigeant impriment « 1856324/A/M/000 » : 192 matricules se taisaient, le motif exigeant la
  lettre. La règle de la lettre est en base (`ref.identifiant_controles` : somme pondérée
  7..1 des sept chiffres, modulo 23, sur l'alphabet sans I, O ni U ; elle retrouve 146 des
  150 matricules publics testés ; la DGI ne la publie pas, statut `defaut_a_valider`,
  source `incertain`). Le motif de LECTURE (`ref.identifiant_formats.pattern_lu`) rend la
  lettre facultative ; le motif de SAISIE ne change pas — une fiche ne s'enregistre toujours
  pas sans sa lettre. Une écriture sans lettre se compare par la lettre calculée ; la valeur
  rendue reste l'imprimée. Si la lettre calculée diffère de celle de la fiche sur les mêmes
  chiffres, rien n'est placé (moteur) et le contrôle du destinataire met une réserve, jamais
  un rejet. Limite à dire : la lettre calculée ne VÉRIFIE rien — elle est fonction des
  chiffres ; seule une lettre imprimée peut révéler un chiffre mal lu.
- **Un faux évité en chemin.** Le devis 100/C-01 n'a qu'un champ de matricule, celui du
  fournisseur ; « MF:1856324/A/M/000 », sous « Client : », devenait lisible et s'y rangeait.
  Un champ d'identifiant d'une partie lu égal au matricule du dossier, quand la page imprime
  un autre identifiant de même noyau (même hors du motif), se signale : le ranger serait
  affirmer le sens sans l'avoir lu.
- **Une pièce sans devise imprimée est dans la devise du dossier.** `ref.concepts` gagne
  `defaut_du_dossier` (`devise` pour le concept de la devise de la pièce) ; le moteur rend la
  devise du dossier au statut `deduit`, sans référence de jeton, quand rien n'est imprimé —
  pas même l'étiquette. Une devise imprimée l'emporte toujours. Le banc juge une valeur
  déduite contre la vraie devise de la pièce (juste si elle est celle du dossier, faux
  sinon), jamais contre la devise du dossier.

- **Le taux nul suit la mention imprimée** (décision du 5 novembre 2026, « ok »). La preuve
  `groupe_taux` gagne `autres_exonerations` (`{"mention_export": "EXPORT"}`) : « exonéré »
  nomme EXO ; « export », « exportation », « en suspension », « Article 11 » (repères passés
  au champ `mention_export`) nomment EXPORT. Deux mentions de taux différents imprimées : la
  part exonérée n'est pas nommée. INCERTAIN fiscalement pour la suspension, défaut à
  valider. Sans effet sur le banc (une seule pièce à l'export, algoria-111, en dollars :
  désormais ambiguë au lieu de muette, sans faux).

|                                 | juste | faux | inventé | dont à travailler |
| ------------------------------- | ----: | ---: | ------: | ----------------: |
| banc, sens déclaré, bulletin 14 | 6 495 |    0 |       0 |             4 071 |
| banc, sens déclaré              | 6 655 |    0 |       0 |             3 924 |
| banc, sens lu                   | 6 353 |    0 |       0 |             4 266 |
| couche de texte, sens déclaré   | 2 116 |    0 |       0 |               679 |
| couche de texte, sens lu        | 1 975 |    0 |       0 |               822 |

## Bulletin 16 — un taux nul imprimé prouve la pièce (5 novembre 2026)

Le découpage des 4 266 cellules « à travailler » (sens lu) : 1 915 de lignes, 876 de noms
des parties, 629 d'identifiants, 384 de montants, 259 de références ; 2 112 sur des pièces
non prouvées (139 pièces). Parmi les factures non prouvées dont l'OCR a lu le HT et le TTC,
31 impriment un taux nul (« TVA 0 % — Base 1.988,009 0,000 », ou des lignes à « 0 % ») sans
mention d'exonération : l'exonération n'était permise que par la mention.

- **Un taux nul imprimé sur une rangée chiffrée est la preuve d'une part exonérée**
  (`Plan::taux_nul_imprime`). L'arithmétique décide : HT, TVA, droits et TTC doivent
  fermer ; une exonération partielle exige toujours que les lignes la confirment, taux par
  taux.
- **Sans mention, le code se tait.** La part exonérée est nommée provisoirement par un taux
  nul du barème, le temps que les lignes la vérifient ; la ventilation est ensuite
  signalée (EXO ou EXPORT : la pièce ne le dit pas, le comptable choisit — décision du
  5 novembre). Totaux, droits, lignes : prouvés.
- **Le numéro de facture a son repère arabe court** « رقم » (et « فاتورة رقم ») : les
  factures arabes impriment « فاتورة رقم », l'ordre inverse de « رقم الفاتورة ».

|                                 | juste | faux | inventé | dont à travailler |
| ------------------------------- | ----: | ---: | ------: | ----------------: |
| banc, sens lu, bulletin 15      | 6 353 |    0 |       0 |             4 266 |
| banc, sens lu                   | 6 609 |    0 |       0 |             4 034 |
| banc, sens déclaré              | 6 911 |    0 |       0 |             3 692 |
| couche de texte, sens déclaré   | 2 124 |    0 |       0 |               671 |
| couche de texte, sens lu        | 1 983 |    0 |       0 |               814 |

## Bulletin 17 — le nom du tiers, et le numéro collé à son libellé (5 novembre 2026)

- **Le seul autre nom à forme juridique de la page est le tiers** (`Page::seul_autre_nom`).
  Le matricule du fournisseur s'imprime souvent en pied de page, loin de sa raison sociale
  en tête : la recherche autour du matricule ne la trouvait pas, ou trouvait le nom du
  dossier, écarté. Quand la page ne nomme, à forme juridique, que le dossier et UNE autre
  société, celle-ci est le tiers. Deux autres sociétés (un transporteur, une banque) :
  rien. Un « nom » qui porte des chiffres (« 1612398F/A/M/00 SARL ») ou qui est le nom du
  dossier lu sans ses blancs (« ALGORITHMACONSULTING SARL ») n'est pas candidat — deux faux
  trouvés et corrigés en chemin.
- **Un numéro collé à son libellé, qui a la forme d'une référence, est conforme.**
  « N°293/2026 » était signalé par prudence (50/48 : l'OCR y avait collé autre chose).
  Sur 118 numéros signalés, 109 étaient justes. Désormais : le libellé collé se ferme par
  un signe (« ° », « : »), et la valeur n'est faite que de groupes de capitales et de
  chiffres séparés par « - », « / » ou « . ». Ce qui y est collé de plus
  (« MFS-FAC-2026-06129juin2026 », « Jc:H/2026/045 ») la garde signalée ; un libellé collé
  par un séparateur (« BAIL-VZ-2026-013 ») aussi — un faux trouvé et corrigé en chemin.

|                                 | juste | faux | inventé | à travailler | signalé |
| ------------------------------- | ----: | ---: | ------: | -----------: | ------: |
| banc, sens déclaré, bulletin 16 | 6 911 |    0 |       0 |        3 692 |     320 |
| banc, sens déclaré              | 7 073 |    0 |       0 |        3 620 |     230 |
| banc, sens lu                   | 6 732 |    0 |       0 |        4 005 |     182 |
| couche de texte, sens déclaré   | 2 124 |    0 |       0 |          671 |       5 |

## Bulletin 18 — la relecture ciblée essayée ; le code TVA et l'adresse des parties (5 novembre 2026)

- **La relecture OCR ciblée n'est pas un levier, avec ce modèle.** Essai sur algoria-018
  (scan) : chaque mot incertain, puis chaque segment de ligne, relu seul dans sa boîte. Les
  relectures sont le plus souvent pires (« Cartouche toneror » → « Carouhe sr ») et
  certaines sont fausses ET sûres (« Arrêtée » → « Arrêté » à 0,81 par caractère) : les
  rendre aurait créé des faux. Essai retiré, rien n'est livré. Le gain viendrait d'un
  modèle de reconnaissance plus fort, que ce conteneur ne peut pas télécharger.
- **Le code TVA, la catégorie et l'établissement de l'émetteur** se lisent dans son
  matricule (« 2815004Q/A/M/000 » → « A/M/000 ») : la preuve `parties` gagne
  `groupes_emetteur`, au statut du matricule. 120 cellules jamais lues.
- **L'adresse d'une partie** est la ligne sous son nom placé, alignée sur son bord gauche,
  rendue seulement entière (la ligne d'après s'ouvre sur un libellé), portant un numéro,
  jamais en écriture de droite à gauche. Le premier essai donnait 18 faux (débuts de ligne
  perdus, « Tel: » collé, adresses arabes, slogans) : les règles ci-dessus les écartent.

|                                 | juste | faux | inventé | à travailler | signalé |
| ------------------------------- | ----: | ---: | ------: | -----------: | ------: |
| banc, sens déclaré, bulletin 17 | 7 073 |    0 |       0 |        3 620 |     230 |
| banc, sens déclaré              | 7 194 |    0 |       0 |        3 479 |     253 |
| banc, sens lu                   | 6 765 |    0 |       0 |        3 969 |     186 |
| couche de texte, sens déclaré   | 2 124 |    0 |       0 |          671 |       5 |

## Bulletin 19 — la prise de vue contrôlée ; les lignes « lu, non vérifié » (5 novembre 2026)

Deux décisions du dirigeant du 5 novembre 2026.

- **Le contrôle de la prise de vue, sur l'appareil.** L'analyse en direct mesurait la
  netteté et la taille du document. Elle mesure aussi, DANS le document : le niveau du
  papier (trop sombre : refus), le rapport des côtés opposés (pris trop de biais : refus) et
  l'égalité de la lumière entre ses quarts (une ombre : conseil, la prise reste permise).
  Seuils larges : les 96 photos et scans du jeu passent ; le calibrage sur de vraies photos
  de téléphone reste à faire.
- **Les lignes que la somme ne prouve pas se montrent, signalées.** Elles étaient tues.
  Chaque rangée qui ferme q × p = m d'une seule façon est rendue au statut `signale`
  (« Lu, à vérifier » à l'écran), avec `complet` : chaque ligne a-t-elle sa désignation, sa
  quantité, son prix et son montant, sans rangée chiffrée laissée de côté ? Une
  désignation lue sans assurance se montre aussi, au statut `incertain`. Rien n'en est
  affirmé ; la lecture de nuit les reprendra. Sur le banc : 811 cellules de lignes passent
  du silence au signalé — 366 justes, 445 fausses. C'est pourquoi elles restent à vérifier.

|                                 | juste | faux | inventé | à travailler | signalé |
| ------------------------------- | ----: | ---: | ------: | -----------: | ------: |
| banc, sens déclaré, bulletin 18 | 7 194 |    0 |       0 |        3 479 |     253 |
| banc, sens déclaré              | 7 194 |    0 |       0 |        2 934 |   1 064 |
| banc, sens lu                   | 6 765 |    0 |       0 |        3 424 |     997 |
| couche de texte, sens déclaré   | 2 124 |    0 |       0 |          457 |     238 |

## Bulletin 20 — la nuit reprend les lignes à vérifier (5 novembre 2026)

La passe de nuit existait (décision du 2 novembre : la relecture par l'autre lecteur — le
modèle de vision pour une lecture OCR — part la nuit, sous plafond, payée par ALGORIA).
Elle ne relisait qu'une lecture IMPARFAITE (contrat partiel, arithmétique incohérente), et
ne retenait qu'une relecture de QUALITÉ supérieure : une pièce aux totaux justes mais aux
lignes non prouvées n'était jamais relue.

- La première lecture dont les lignes sont à vérifier (lues sans preuve, ou une
  désignation incertaine) inscrit une relecture de nuit, avec `consigne.lignes`
  (`20261127290000`). Jamais en journée.
- La nuit, une relecture ainsi demandée est retenue, à qualité égale, quand le moteur
  PROUVE ses lignes (`relectureRetenue`). Le modèle propose, la somme tranche : l'IA ne
  rend aucun verdict. Moins bonne, elle n'est jamais retenue.
- Le banc n'en dit rien encore : il ne rejoue pas la nuit. La mesure viendra de la
  première nuit observée sur le staging, la passe étant livrée coupée.

## Bulletin 21 — l'heure du dossier, l'écran de la pièce, la photo importée (6 novembre 2026)

- **Les réglages d'un dossier se lisent à SON jour.** Entre minuit à Tunis et minuit UTC,
  un réglage arrêté le jour même ne s'appliquait pas : le mode du lecteur prouvé
  (`lecture.sudoku`) se lisait au jour UTC du serveur, et la relecture de nuit
  (`app.relecture_de_nuit`) au `current_date` UTC. `public.jour_du_dossier` rend le jour
  dans le fuseau du dossier ; les deux lectures s'en servent (`20261127300000`,
  `20261127310000`). Les épreuves de la relecture de nuit échouaient toutes dans cette
  heure-là : elles passent.
- **L'épreuve de la passe de nuit ne dépend plus de l'historique de la base.** Le plafond de
  la plateforme se compte sur 24 h, tous dossiers confondus : au septième passage du jour,
  il était atteint avant l'épreuve. Elle le décale de ce que le relecteur a déjà dépensé ;
  son cabinet est à Dakar, comme ses dossiers.
- **L'écran de la pièce (PME) dit « Lignes lues, à vérifier »** au-dessus des articles quand
  le lecteur prouvé a inscrit des lignes signalées ; il se tait sinon.
- **Une photo importée (galerie, fichier) dit ses défauts avant l'envoi** — page trop
  petite, de biais, sombre, floue —, sans la refuser : c'est peut-être la seule copie. La
  caméra, elle, les refuse avant la prise (bulletin 19).
- Les dépendances du poste d'essai, abîmées, ont été réinstallées : les suites web (1 076)
  et socle (495) repassent sous vitest.

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

## Bulletin — l'expert des tiers (7 novembre 2026)

Demandé par le dirigeant le 7 novembre 2026 (le moteur était gelé) : faire tomber les
silences à travailler, en gardant zéro faux. Mêmes 411 pièces, même cache OCR que le
bulletin du 6 novembre (`r2-lu.json`), reproduit à l'identique avant toute correction.

|                        |     juste |  faux | silence à travailler | sens justes | inventé |
| ---------------------- | --------: | ----: | -------------------: | ----------: | ------: |
| 6 novembre (référence) |     6 757 |     0 |                3 424 |         170 |       0 |
| **7 novembre**         | **6 931** | **0** |            **3 212** |     **203** |   **0** |

Aucun champ n'est passé de juste à faux, aucun sens n'est échangé ; 41 silences
deviennent des pistes signalées (36 justes, 5 fausses), jamais affirmées.

### Le diagnostic qui a orienté le travail

Pour chaque silence à travailler, la valeur attendue a été cherchée dans le relevé OCR
de la pièce (`_banc/diagnostic-silences-2026-11-07.py`, hors dépôt) : sur les pièces
dont le relevé est gardé, **74 % des silences étaient déjà lus par l'OCR** ; le moteur
ne les prenait pas. 5 % seulement n'étaient pas vus par l'OCR.

### Ce qui change (`packages/sudoku/src/entete.rs`)

- **La hauteur ne contredit plus un indice fort.** La géométrie « corrobore, elle ne
  décide jamais seule » ; en pratique elle cassait l'unanimité et tout le bloc des
  parties se taisait (algoria-001 : le matricule du dossier en tête sous « Livré à »,
  celui du fournisseur en pied). Elle garde sa voix quand le dossier est imprimé deux
  fois, quand le seul indice est un repli, ou quand la contrepartie n'a pas sa lettre de
  contrôle. +44 justes, +13 sens.
- **Le matricule réparé sous sa lettre de contrôle.** L'écriture sans séparateurs
  (« 1958330VAM000 ») et la lettre lue comme un chiffre de même dessin ne sont
  retenues que si la lettre calculée par la règle du pack les confirme. +84 justes,
  +20 sens.
- **Le nom par la tête du bloc.** Un émetteur sans forme juridique (« Imprimerie
  Darvane ») : la première ligne du bloc aligné sur son matricule, suivie de son
  écriture arabe éventuelle, d'une adresse d'une ou deux lignes qui porte un numéro,
  puis de lignes à libellé. Affirmé par le texte exact ou une lecture assurée, sinon
  signalé (dirigeant 50/08 : « Leïla » relu « Leila »).
- **L'adresse alignée sous le libellé** (« Client : … », l'adresse sous « Client »),
  et jamais à partir d'un mot qui tombe par hasard sous le nom. +18 adresses client.
- **Le contact de l'émetteur** (`contact_emetteur`, migration
  `20261202140000`) : les lignes « Tél », « Fax », « E-mail » de SON bloc. Jamais lu
  avant (0 juste) : +14 justes, 13 pistes justes.

### Ce que le banc a appris sur le corpus

- **352 des 531 matricules attendus ont une lettre que la règle du pack refuse** (la
  lettre « O », que l'alphabet exclut, en particulier). La règle retrouve 146 des 150
  matricules publics réels : le corpus les invente. Les réparations gardées par la
  lettre sont donc sous-mesurées ici ; elles serviront davantage sur des pièces réelles.
- Les jeux du dirigeant n'ont pas de confiance OCR : leurs noms et contacts lus par la
  structure restent des pistes, jamais des affirmations.

### Ce qui reste, du plus gros au plus petit

1. Les pièces où seul le matricule du dossier est lu (77, surtout des photos) : la
   contrepartie sans lettre valide ou hors du motif.
2. Les noms et adresses en écriture de droite à gauche (une quarantaine de raisons
   sociales attendues en arabe).
3. L'identifiant (registre de commerce, code TVA) hors du bloc des parties.
4. Les pièces non prouvées (116), dont 44 sans aucune preuve exécutable dans leur grille.
