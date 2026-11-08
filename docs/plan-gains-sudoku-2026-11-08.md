# Le Sudoku sans IA : analyse à 360° et plan par les plus gros gains (8 novembre 2026)

Demande du dirigeant : réanalyser le Sudoku de tous les côtés, silence et temps compris,
avec un plan ordonné par gain, chaque correction disant ce qu'elle doit gagner avant d'être
faite et ce qu'elle a gagné une fois mesurée. Objectif : 90 % de pièces prouvées, zéro
faux, lecture ≤ 4 s par pièce, IA et GPU au minimum.

Branche `claude/sudoku-gains` (depuis `claude/sudoku-vers-90`). Chiffres tirés des quatre
bancs (caches seulement, aucun appel payant) : la référence (411 pièces), PP-OCRv6 small
(261), l'OCR frais du staging (69), Qwen (261). Le diagnostic de la lecture
(`docs/diagnostic-non-prouvees-2026-11-08.md`, branche `claude/diagnostic-non-prouvees`)
est intégré : ses causes E et D reviennent au moteur, ses causes F et G (32 pièces) ne
doivent jamais être prouvées.

## En une phrase

283 → **304 pièces prouvées sur 411 (68,9 % → 74,0 %)**, soit 80,2 % des 379 pièces
prouvables, **sans aucun faux nouveau sur les quatre bancs**, sans juste perdu, aucune
pièce F/G prouvée ; le moteur passe de 84,5 à **61,5 ms** en médiane (p95 269 → 158 ms).
90 % des 411 pièces ne s'atteint pas par le moteur seul : il faut aussi les remèdes de
lecture, et le plafond est 92,2 % (379 / 411).

## 1. L'analyse

### a. La couverture

|                    |           départ |          arrivée |
| ------------------ | ---------------: | ---------------: |
| factures (350)     |     276 (78,9 %) |     285 (81,4 %) |
| autres pièces (61) |                7 |               19 |
| algoria (161)      |               98 |              109 |
| synthétique (100)  |               77 |               82 |
| dirigeant (150)    |              108 |              113 |
| arabe (77)         |               38 |               45 |
| **total (411)**    | **283 (68,9 %)** | **304 (74,0 %)** |

Par grille, hors facture (départ → arrivée / pièces) : ticket 0 → 3 / 7, bon de livraison
0 → 1 / 7 (les 6 autres sont des formulaires vierges ou sans montant, cause F), reçu
0 → 1 / 4, relevé 0 → 1 / 2, bulletin 0 → 1 / 2, note de frais 0 → 1 / 2, acompte
provisionnel 0 → 1 / 2, avis d'assurance 0 → 1 / 2, déclaration d'IS 0 → 1 / 1, bon de
commande 0 → 1 / 1 ; avoir 4 / 4 et devis 3 / 3 gardés.

### b. Les silences, par cause (champs « à travailler », référence)

| cause                                       |    départ |   arrivée |
| ------------------------------------------- | --------: | --------: |
| la preuve ne ferme pas (pièce non prouvée)  |       934 |       988 |
| pièce prouvée, cellule de ligne non prouvée |       579 |       675 |
| pièce prouvée, champ non lu                 |       503 |       542 |
| pièce prouvée, partie non attribuée (tiers) |       465 |       483 |
| preuve absente de la grille                 |       543 |       214 |
| champ jamais lu nulle part (non câblé)      |       118 |       207 |
| ambiguïté                                   |        65 |        54 |
| **total**                                   | **3 207** | **3 163** |

La « preuve absente » a fondu (− 329) : ces champs sont passés dans les pièces prouvées,
où ils restent souvent à lire. Les plus gros silences restent les cellules des lignes
(quantité 314, prix 236, montant 224) et les parties (raison sociale de l'émetteur, nom du
client, matricules) : la moitié se trouve sur des pièces DÉJÀ prouvées, où c'est
l'appariement des lignes et des tiers, non la preuve, qui manque.

### c. Les pistes signalées qui pourraient devenir affirmées

530 pistes signalées justes, 465 fausses. Sans aucune fausse sur le banc : la date
d'émission (18), la date d'opération (18), le contact de l'émetteur (13), le droit de
timbre (9), le total TTC (9). Elles sont signalées parce que la pièce n'est pas prouvée.
Les affirmer contredit la règle « rien d'affirmé sans preuve » : c'est une décision du
dirigeant (proposée au plan, ligne 7), pas une correction.

### d. Le temps

|                                                          |  départ |     arrivée |
| -------------------------------------------------------- | ------: | ----------: |
| moteur dans le banc (WebAssembly + préparation), médiane | 84,5 ms | **61,5 ms** |
| idem, p95                                                |  269 ms |  **158 ms** |
| natif, pire pièce (algoria-006, 149 jetons)              |  453 ms |      249 ms |
| premier appel du processus (compilation du WebAssembly)  |   4,8 s |       4,4 s |

Le « 1,1 s » cité n'est pas le moteur : c'est l'OCR qui pèse (4,7 s médiane par page sur
2 cœurs, diagnostic). Ce qui pesait dans le moteur, mesuré au profileur (callgrind) : 60 %
du temps dans la normalisation des textes (`normaliser`, `entete::mot`), le même jeton
normalisé des milliers de fois. Les deux sont mémorisés le temps d'une résolution ; le
résultat est identique, prouvé sur les 800 entrées du banc (sorties égales octet pour
octet). Ce qui reste : une facture se résout DEUX fois (variantes « TTC hors timbre » et
« TTC avec timbre ») ; et le premier appel compile le WebAssembly (à faire au démarrage de
l'API, pas à la première pièce).

### e. La robustesse : les faux sur les quatre bancs

| valeurs fausses ou inventées affirmées | référence |            v6 small | staging |  Qwen |
| -------------------------------------- | --------: | ------------------: | ------: | ----: |
| `claude/sudoku-vers-90`                |         0 |     6 (+ 1 échange) |       0 |     0 |
| **`claude/sudoku-gains`**              |     **0** | **6 (+ 1 échange)** |   **0** | **0** |

Les six de v6 sont les mêmes qu'au départ (bulletin du 8 novembre) : des lettres perdues
par l'OCR avec assurance et un registre de commerce lu « 8 » pour « B ». Aucun n'est venu
de ces lots. Le jeu du dirigeant ne porte pas les totaux dans sa vérité : chaque pièce
nouvellement prouvée de ce jeu a été relue à la main contre son relevé (100/C-03, C-04,
C-18, 50/16, 50/29 : valeurs justes). C'est ainsi que le faux de 50/05 a été trouvé et
fermé avant d'entrer.

## 2. Le plan, ordonné par gain sur effort

« Estimé » est écrit avant la correction (à l'analyse, puis repris du diagnostic quand il
est arrivé) ; « mesuré » est le banc de référence après (et les trois autres bancs).

| #   | correction                                                                                                                                                                                                                | estimé                                                     | mesuré (référence)                                    | autres bancs                       | faux      | état                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- | --------- | -------------------------------------- |
| 1   | **Preuves des pièces autres que la facture** (relevé, bulletin, quittance, BL/ticket/reçu/bon de commande valorisés, IS, acompte, certificat, assurance) + règles du moteur sans groupe de taux                           | +9 à +13 pièces (diagnostic E : +33 au plus)               | **+12 pièces** (283 → 295), +30 justes, − 30 silences | v6 +7, Qwen +5, staging 0          | 0 nouveau | fait                                   |
| 2   | **Formes de facture** : libellé arabe à une lettre près ; l'export départagé par le libellé du HT                                                                                                                         | +8 (5 exports ambigus, 3 à 10 arabes) ; diagnostic D : +13 | **+9 pièces** (295 → 304), +63 justes                 | v6 +5, Qwen 0 (ambiguës − 3)       | 0 nouveau | fait                                   |
| 3   | **Temps** : la normalisation mémorisée                                                                                                                                                                                    | médiane ÷ 1,5                                              | médiane 84,5 → 61,5 ms, p95 269 → 158 ms              | résultat identique sur les 4 bancs | 0         | fait                                   |
| 4   | Déclaration mensuelle (collectée − déductible = à payer ; Σ rubriques = total) : libellés des rubriques TFP/FOPROLOS sans libellé sur leur rangée, numéros de ligne                                                       | +2 à +3                                                    | —                                                     |                                    |           | essayé, laissé (algoria-142, 143, 147) |
| 5   | Preuve par les lettres seules (chèque, virement, reçu : chiffres = lettres)                                                                                                                                               | +3                                                         | —                                                     |                                    |           | à faire                                |
| 6   | Le reste de E : relevé arabe (137), bulletin bilingue (141), note de frais (135), acompte (149), certificat (152, libellés en tête de colonne), PV d'AGO (prose), statuts, avis de débit (50/27), assurance (50/26), CNSS | +8 à +12                                                   | —                                                     |                                    |           | à faire                                |
| 7   | Le reste de D : FODEC (50/02, 064, 091, 097, synth. 066), débours (50/21), exonération partielle (50/17, 50/30, 50/38…), facture sans TVA (50/18–20, 50/35), « Total avec timbre » (023)                                  | +10 à +13                                                  | —                                                     |                                    |           | à faire                                |
| 8   | Affirmer les dates et le contact signalés sans aucune faute au banc (point c)                                                                                                                                             | 0 pièce, +36 à +49 valeurs                                 | —                                                     |                                    | à mesurer | décision du dirigeant                  |
| 9   | Une seule résolution par facture au lieu de deux (les deux variantes du TTC) ; compiler le WebAssembly au démarrage                                                                                                       | médiane ÷ 2 ; 4,4 s de moins sur la première pièce         | —                                                     |                                    | 0         | à faire                                |
| 10  | « 100 % traité » : issues « sans montant » (F, 18) et « signalée » (G, 14), et la contrainte en échec avec sa case                                                                                                        | 32 pièces traitées                                         | —                                                     |                                    |           | à faire                                |

### Les preuves par type de pièce, et ce que les grilles déclaraient

| type                                        | preuve                                                         | en base avant                                         | maintenant                                                      |
| ------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| relevé                                      | solde initial + crédits − débits = solde final                 | `a_traduire`                                          | `P01a` exécutée                                                 |
| bulletin                                    | base + indemnités = brut ; brut − CNSS − IRPP − retenues = net | `a_traduire`                                          | `P01a`, `P03a`                                                  |
| quittance                                   | loyer + TVA + charges + timbre − retenue = reçu                | `a_traduire`                                          | `P01a` (variante « loyer »)                                     |
| BL, ticket, reçu, bon de commande valorisés | HT + TVA = TTC ; TVA = HT × taux ; lettres = TTC               | rien (BL : recoupements seulement)                    | `T01`–`T03`                                                     |
| BL non valorisé                             | quantités × prix ; correspondance avec la facture              | `a_traduire`                                          | rien à prouver dans la pièce seule : rapprochement entre pièces |
| ticket                                      | Σ lignes = total ; reçu − rendu = total                        | `a_traduire`                                          | les totaux (`T01`–`T03`) ; Σ lignes à faire                     |
| reçu, chèque, virement                      | chiffres = lettres                                             | chèque : `lettres` déclarée, non comptée comme preuve | à faire (ligne 5)                                               |
| déclaration d'IS                            | impôt dû − acomptes − retenues = reste                         | `a_traduire`                                          | `P90`                                                           |
| acompte provisionnel                        | acompte − retenues = net                                       | rien                                                  | `P90`                                                           |
| certificat de retenue                       | brut − retenue = net servi                                     | `a_traduire`                                          | `P02a` (ambigu : libellés en tête de colonne)                   |
| avis d'assurance                            | prime nette + accessoires + taxes = TTC                        | rien                                                  | `P90`                                                           |
| déclaration mensuelle                       | TVA = taux × CA ; collectée − déductible = à payer             | partiel, champs obligatoires                          | 13 % et 7 % facultatifs ; le reste à faire                      |

### Ce que le moteur a appris (grilles sans groupe de taux seulement ; la facture garde ses règles)

- le total d'une somme porte son libellé, ou la base de chaque taux le sien, ou il est le
  plus grand montant de la pièce — sans cette règle, 50/05 (ticket à deux taux) affirmait
  un article pour le total TTC ;
- le montant d'une rubrique se lit au bout de sa rangée (bulletin : « Cotisation CNSS |
  base | taux | montant »), une date ou un numéro de rubrique en tête de rangée ne coupe
  pas le libellé ;
- un libellé de plusieurs mots rendus un par un annonce son champ, mot pour mot (« Prêt »
  n'est pas lu dans « présent ») ;
- une somme dont les termes s'annulent deux à deux n'est pas une solution (relevé : deux
  soldes égaux, deux totaux égaux).

## 3. Ce qui reste pour 90 %, et pour 100 % « traité »

|                                                                               |      pièces |   sur 411 |
| ----------------------------------------------------------------------------- | ----------: | --------: |
| aujourd'hui                                                                   |         304 |    74,0 % |
| + remèdes de lecture mesurés par le diagnostic (1 ↔ 7, v6 en second prouveur) |       ≈ 320 |    77,9 % |
| + le reste de E et D (lignes 4 à 7 du plan)                                   | ≈ 345 à 350 | 84 à 85 % |
| + chiffres arabes orientaux et libellés arabes (lecture, diagnostic B et C)   | ≈ 356 à 361 | 87 à 88 % |
| plafond (F et G jamais prouvées)                                              |         379 |    92,2 % |

90 % des 411 pièces (370) demande presque tout le récupérable : c'est la conclusion du
diagnostic, et elle tient. Mesuré sur les pièces prouvables (379), le moteur est à 80,2 %
aujourd'hui, et ≈ 92 % une fois les lignes 4 à 7 faites avec les remèdes de lecture.

« 100 % traité » ne dépend pas du taux : chaque pièce non prouvée sort avec son motif
(ligne 10) — sans montant, signalée, type sans vérification arithmétique, ou la
contrainte en échec avec la case à relire.
