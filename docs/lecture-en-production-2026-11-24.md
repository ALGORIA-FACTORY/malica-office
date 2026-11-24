# La lecture en production rejoint le banc — 24 novembre 2026

Le banc sans IA (`banc-sans-ia.ts`) se disait « la chaîne de production, sans modèle ». Il ne
l'était pas tout à fait. Trois écarts le rendaient plus favorable que la production, et
l'évaluation du 24 novembre les a nommés (document « Malica Office — évaluation de la
lecture OCR → Sudoku ») :

| Écart                           | Banc                                      | Production avant                                   |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| Relecture des cellules          | branchée (`relecture.ts`, `POST /relire`) | jamais appelée                                     |
| Lecteur passé au Sudoku d'abord | texte exact, cachets, lecteur génératif   | rien : `sansIa(plan)` ignorait d'où venait le plan |
| Grille                          | celle du vrai type de la pièce            | toujours `facture` (`GRILLE_DE_LA_LECTURE_CITEE`)  |

## Ce qui change

**1. La relecture des cellules se branche.** Sur un relevé de PaddleOCR, quand le centre de
la pièce est prouvé et que ses lignes ne le sont pas, les cellules du tableau que
l'arithmétique contredit sont relues seules, dans leur boîte, par le même service OCR. Elle a
lieu dans `runVisionRead`, AVANT le Sudoku d'abord : le plan relu est celui que la preuve lit,
que la désignation cite et que la base garde (R2).

Elle n'est retenue que si (`relectureRetenue`) :

- la pièce reste prouvée, et ses lignes le deviennent ;
- aucun champ prouvé avant ne change de valeur ni ne perd sa preuve ;
- des parties prouvées gardent leur preuve et leur sens.

Sinon le plan reste celui du relevé, à l'octet près. Une panne, un lecteur occupé ou un
réglage coupé rendent aussi le plan reçu : la relecture ne fait jamais échouer une lecture.
Chaque décision est au journal (`relecture_cellules` : `inchangee`, `retenue`, `ecartee`,
`erreur`).

**2. Le réglage `lecture.relecture_cellules`** (`20261231280000`) : `active` par défaut (R10),
`coupee` au choix du cabinet, sans déploiement — comme la relecture de nuit.

**3. Le Sudoku d'abord sait quel lecteur a relevé.** `sudokuDAbord(plan, releve)` passe le
lecteur et les cachets au moteur, comme `lire` et le banc. La couche de texte d'un PDF y est
le texte exact. Et les mots d'un lecteur génératif (Qwen, quand PaddleOCR est tombé) y sont
douteux : sans le dire, le Sudoku d'abord pouvait affirmer un texte que le modèle de vision
avait récrit. Le banc Qwen du 8 novembre comptait 80 valeurs fausses dans ce cas.

**4. Le banc dit le chiffre de la production.** Le bulletin porte une ligne de plus :
`En production (grille « facture », relecture des cellules, exigences de l'écriture) : N / 411
pièces sans aucun modèle, M sans la relecture des cellules`. `N − M` est le gain de cette
livraison, en pièces qui n'appellent plus de modèle. Le reste du bulletin reste le plafond.

## Ce qui ne change pas encore : la grille par type de pièce

La production lit toute pièce avec la grille `facture`. Les preuves des autres pièces
(bulletin, relevé, ticket, reçu, déclarations) ne servent qu'au banc. Les brancher ne se fait
pas dans `sudoku.ts` seul, parce que :

- le type d'une pièce n'est connu qu'APRÈS sa lecture (`document_kind`, désigné ou corrigé
  par la personne) : choisir la grille avant demande un classement sans modèle, par le titre
  imprimé (le domaine du titre existe, `20261205090200`) ;
- l'aval ne sait traiter que des factures : contrat `extract.v1`, proposition d'écriture,
  écrans. Une lecture de bulletin n'y a pas sa place ; elle irait dans `capture.champs_lus`
  seulement.

Le plan proposé, en trois lots mesurés au banc :

1. **Classer sans modèle.** Le titre imprimé, lu dans son domaine, désigne la grille ; à
   défaut, `facture`. Le banc mesure le classement contre la vérité des trois corpus
   (classement juste, faux, inconnu), sans rien brancher.
2. **Lire, inscrire, ne rien proposer.** Une pièce classée hors facture est lue avec sa
   grille ; ses champs vont dans `capture.champs_lus`. Aucune écriture n'est proposée :
   l'écran la montre « lue, à classer ».
3. **Proposer**, type par type, quand le Socle sait en tirer une écriture.

## Mesuré — banc du moteur sur la branche, 24 novembre 2026

411 pièces (ALGORIA, synthétique, dirigeant), sans aucun modèle, OCR relu à neuf.

|                                     | `main` (run #12) | branche |
| ----------------------------------- | ---------------: | ------: |
| Pièces prouvées (plafond)           |              309 |     309 |
| Valeurs justes                      |            7 120 |   7 130 |
| Valeurs fausses ou inventées        |                0 |       0 |
| Références (numéro…) lues justes    |              215 |     225 |
| **Production : pièces sans modèle** | non mesuré (50)¹ |  **57** |

¹ La production n'était pas mesurée sur `main` ; 50 est le chiffre de la branche avant le
correctif du numéro, à moteur égal à `main`.

**Ce qui oblige encore une pièce à appeler un modèle**, en pièces (dont : seule exigence
manquante) : nom de l'émetteur 276 (17), matricule de l'émetteur 237 (9), sens 199,
numéro 179 (31), date 135 (9), montants 111 (3). Le levier suivant est l'anneau 2 (les
parties), puis la lecture OCR des lignes bilingues (français et arabe sur la même ligne),
que PaddleOCR perd : « FACTURE N° … / فاتورة عدد » disparaît du relevé de la pièce
synthétique 071.

La relecture des cellules ne fait gagner aucune pièce « sans modèle » au banc : les lignes
d'articles ne sont pas une exigence de l'écriture. Elle sert la nuit et l'écran (« lu,
vérifié » au lieu de « lu, non vérifié »), et sa règle de rétention n'a retenu aucune
relecture sur ce banc, ce qui confirme qu'elle ne déplace rien.

## Lot 2 — les parties (anneau 2)

Le banc dit désormais, pour chaque pièce dont le sens n'est pas dit, où est passé le
matricule de l'AUTRE partie. Sur 144 pièces, 134 l'ont dans leur relevé : c'est
l'attribution, pas l'OCR, qui manquait.

**Deux repères du client, ajoutés aux grilles `facture`** (`20261231290000`) :

- « Livré à » : le dossier imprimé sous « Livré à : » n'était pas placé au camp du client.
  Seul un repli votait « achat », et la hauteur votait « vente », parce que le fournisseur
  imprime son matricule en pied de page. Le moteur se taisait (33 pièces « indices de sens
  contradictoires », 9 après) ;
- « السيد » : l'équivalent arabe de « M. », déjà repère du client ; les carnets arabes
  présentent le client ainsi.

|                                 | après lot 1 | « Livré à » | + « السيد » |
| ------------------------------- | ----------: | ----------: | ----------: |
| Sens justes / 347               |         203 |         227 |         232 |
| Sens inversés                   |           0 |           0 |           0 |
| Valeurs justes                  |       7 130 |       7 272 |       7 286 |
| Valeurs fausses ou inventées    |           0 |           0 |           0 |
| Pièces sans modèle (production) |          57 |          80 |          80 |

**Ce qui reste, et qui ne relève pas du moteur** : 77 pièces « seul le matricule du dossier
est lu ». Les matricules fictifs du jeu d'essai (`matriculeDEssai`) tirent leur lettre de
contrôle au hasard, de A à Z : 26 sur 29 dans le jeu d'ALGORIA, 12 sur 15 dans le jeu
synthétique, ne portent pas la lettre que la règle du pack calcule, et 8 portent une lettre
qui n'existe pas (I, O, U). L'OCR lit le « O » comme un zéro (`1487008O` relevé
`14870080`, algoria-045), et le moteur refuse — à juste titre — de réparer vers une lettre
impossible. Un vrai matricule tunisien porte sa lettre calculée (ALGORIA : `1958330V`,
vérifié). Corriger le jeu demande de le régénérer là où son rendu est reproductible à
l'octet ; ce n'est pas le cas dans l'atelier de cette mesure (145 fichiers changent sans
aucune modification). Décision du dirigeant.
