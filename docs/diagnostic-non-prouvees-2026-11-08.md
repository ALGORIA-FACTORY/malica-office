# Pourquoi 128 pièces ne sont pas prouvées — diagnostic du 8 novembre 2026

Base : la mesure du 8 novembre (PR #282, runs 42475726319 et 42477888334). PaddleOCR v5 lit
411 pièces (algoria 161, synthetique 100, dirigeant 150). Le moteur Sudoku seul en prouve
**283 (68,9 %), avec zéro faux**. Ce bulletin donne la cause de chacune des 128 autres, puis
il mesure les remèdes de lecture. Ces remèdes ne touchent pas le moteur (`packages/sudoku`,
PR #280) : ils agissent sur le relevé et sur les lectures qu'il propose.

Rejouer : `banc-sans-ia.ts` sur les relevés en cache, 37 s pour les 411 pièces (2 cœurs).
Les essais locaux portent des interrupteurs d'essai (`ESSAI_17`, `ESSAI_ORIENTAUX`), qui ne
sont **pas commités**. La relecture par Claude est mesurée en GitHub Actions
(`.github/workflows/relecture-claude.yml`, script et consigne dans `outils/relecture-claude/`).

## En une phrase

La moitié des pièces non prouvées ne le sont pas à cause de la lecture : 41 sont des types
de pièce dont la grille n'a aucune preuve exécutable, 15 sont des factures d'une forme que le
moteur ne connaît pas, et 32 n'ont rien à prouver ou sont fausses par construction. Les 40
autres sont des fautes de lecture. Les remèdes de lecture mesurés en gagnent **16, avec zéro
faux** (299 pièces, 72,7 %). Le levier principal pour viser 90 % est donc le moteur, avec ses
preuves par type de pièce.

## Méthode

1. **Les lectures parfaites.** Une lecture parfaite sépare la lecture du moteur. Pour le jeu
   du dirigeant, j'ai rejoué le moteur sur la couche de texte du PDF (`dirigeant-texte`).
   Pour algoria et synthétique, j'ai construit un relevé « oracle » : chaque montant imprimé
   y est posé dans sa boîte (`rendus/NNN.boites.json`), à la place de ce que l'OCR y a lu.
   Une pièce prouvée avec la lecture parfaite mais pas avec l'OCR a une cause de lecture.
   Une pièce non prouvée même avec la lecture parfaite a une cause qui tient au moteur, au
   type de pièce ou à la pièce elle-même.
2. **Les montants, case par case.** Pour chaque montant de la vérité, j'ai noté ce que v5,
   v6, v5 rejoué et Qwen ont lu dans sa boîte : juste, chiffre faux, chiffre perdu,
   séparateur ou montant collé.
3. **Les images**, regardées pour un échantillon : algoria 023, 088 (manuscrit) et 064
   (arabe).
4. **Le garde-fou, sur les 411 pièces.** Pour chaque remède, je compte les champs faux ou
   inventés de tous les experts, et je les compare à la référence (zéro).

Constats qui orientent tout le reste :

- **Le jeu du dirigeant.** Sur la couche de texte, lecture parfaite, 38 des 40 pièces non
  prouvées restent non prouvées (25 non prouvées, 13 sans couche de texte). Seules
  100/B-15 et 50/14 passent.
- **Algoria et synthétique.** Avec tous les montants parfaitement lus, seules 8 pièces de
  plus sont prouvées, 16 si l'on croit aussi les chiffres orientaux.
- **Les factures en français sont prouvées à 94 %** (102 sur 108). Les factures en arabe ou
  bilingues ne le sont qu'à 54 % (37 sur 68). Les 13 pièces imprimées en chiffres orientaux
  sont toutes non prouvées (0 sur 13).

## Le tableau des causes

Une cause principale par pièce. Le détail, pièce par pièce, est en annexe. « Points » =
points de pourcentage sur les 411 pièces (1 pièce = 0,24 point).

| cause                                                  | pièces | récupérables                  | points      | remède                                                                                           | coût                                                                 | statut        |
| ------------------------------------------------------ | -----: | ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------- |
| A. Lecture : montant mal lu, perdu, collé, ponctuation |     19 | 15 gagnées (+ 50/30, cause D) | +3,6        | 1 ↔ 7 en lectures faibles, v6 en second prouveur, relecture Claude                               | CPU ms ; v6 3,5 s/page sur 31 % des pièces ; Claude 0,0006 à 0,006 $ | **mesuré**    |
| B. Lecture : chiffres arabes orientaux                 |     11 | 8 (oracle)                    | +1,9        | relecture Claude des cases, et décision : croire un candidat oriental sous le contrôle du Sudoku | Claude, voir plus bas                                                | oracle mesuré |
| C. Lecture : libellés arabes perdus (manuscrit, photo) |     10 | 3 à 5                         | +0,7 à +1,2 | meilleure relecture arabe des libellés (modèle server, ou Qwen confirmé)                         | GPU ou nuit                                                          | estimé        |
| D. Moteur : forme de preuve de facture manquante       |     15 | 13                            | +3,2        | voir la liste pour l'expert du moteur                                                            | ms                                                                   | estimé        |
| E. Moteur : type de pièce sans preuve exécutable       |     41 | 33                            | +8,0        | preuves par type (liste plus bas)                                                                | ms                                                                   | estimé        |
| F. Rien à prouver (aucun montant écrit)                |     18 | 0                             | —           | issue « sans montant »                                                                           | —                                                                    | constat       |
| G. Pièce incohérente par construction (piège du jeu)   |     14 | 0                             | —           | issue « signalée » ; ne pas prouver est juste                                                    | —                                                                    | constat       |

Par corpus :

- algoria : A 9, B 5, C 8, D 2, E 31, F 8 ;
- synthétique : A 7, B 6, D 4, G 6 ;
- dirigeant : A 3, C 2, D 9, E 10, F 10, G 8.

**Le plafond.** Les causes F et G (32 pièces) ne doivent jamais être prouvées. Le plafond du
banc est donc de 379 sur 411, soit 92,2 %. Atteindre 90 % sur 411 (370 pièces) demande de
gagner 87 des 96 pièces récupérables. Cela suppose de finir presque tout E et D. Je propose
deux indicateurs : **les pièces prouvées sur les pièces prouvables** (379) et **100 % de
pièces traitées**, c'est-à-dire chaque pièce non prouvée avec son motif (voir plus bas).

## Les remèdes de lecture, mesurés (aucun appel payant local)

| remède                                                                                          | prouvées         | gagnées | perdues | faux (tous experts)                       | coût                                                    |
| ----------------------------------------------------------------------------------------------- | ---------------- | ------: | ------: | ----------------------------------------- | ------------------------------------------------------- |
| Référence v5                                                                                    | 283 (68,9 %)     |       — |       — | 0                                         | OCR 3,2 s/page médiane sur 2 cœurs                      |
| (a) Vote jeton par jeton v5/v6/Qwen (deux lecteurs contre un)                                   | 283              |       0 |       0 | 0                                         | 33 jetons remplacés, aucun effet                        |
| (a) v6 seul à la place de v5                                                                    | 277              |      11 |      17 | **14 faux** (désignations, adresses)      | rejeté                                                  |
| (a) Qwen seul à la place de v5                                                                  | 267              |      13 |      29 | **65 faux, dont 4 montants prouvés faux** | rejeté                                                  |
| (a) Union des preuves : v5, sinon v6 si chaque montant prouvé est relu identique par v5 ou Qwen | 293 (71,3 %)     |      10 |       0 | 0                                         | v6 sur les pièces non prouvées : 3,5 s méd., 10,4 s p95 |
| idem, avec v5 seul pour confirmer                                                               | 291              |       8 |       0 | 0                                         | sans IA                                                 |
| Treillis 1 ↔ 7 (lectures faibles, le Sudoku choisit)                                            | 290 (70,6 %)     |       7 |       0 | 0 montant ; 1 artefact « œ »/« oe »       | négligeable                                             |
| Treillis 1 ↔ 7 + v6 en second prouveur confirmé                                                 | 298 (72,5 %)     |      15 |       0 | 0 montant ; même artefact                 | idem                                                    |
| (b) Prétraitement : agrandi ×1,5 + contraste (31 pièces visées, v5)                             | 288              |       5 |       0 | 0                                         | OCR 8,1 s méd., 21,7 s p95 (×2,5)                       |
| (b) Prétraitement : binarisation adaptative                                                     | 283              |       0 |       0 | 0                                         | 3,2 s                                                   |
| Relecture ciblée par Claude Sonnet 5.5 (passages 1 et 2)                                        | 288              |       5 |       0 | 0                                         | 0,0062 $/pièce relue, appel 1,9 s méd.                  |
| Relecture ciblée par Claude Haiku 5.5 (passages 1 et 2)                                         | 288              |       5 |       0 | 0                                         | 0,0006 $/pièce relue, appel 2,5 s méd.                  |
| **Tout ensemble, zéro faux** (v5 + 1 ↔ 7 + v6 confirmé + Claude)                                | **299 (72,7 %)** |  **16** |   **0** | **0**                                     |                                                         |

### Ce que ces mesures enseignent

- **Une preuve peut être cohérente et fausse.** Lecteur seul, Qwen « prouve » algoria 073
  avec un HT de 12 492,611 au lieu de 12 492,811. Sur une facture exonérée, HT = TTC −
  timbre, et la même faute sur les deux montants referme l'arithmétique. Sur algoria 064, il
  prend la base de TVA (HT + FODEC) pour le HT. Un second lecteur n'est donc admis que comme
  **second prouveur confirmé** : chaque montant qu'il prouve doit être relu à l'identique,
  chiffre pour chiffre, par un autre lecteur. Qwen ne peut que confirmer : sa preuve ne se
  rattache pas au rôle du jeton (064 : la valeur existe dans v5, mais comme base de TVA).
- **Le vote jeton par jeton ne sert à rien.** Quand v6 et Qwen s'accordent contre v5, ils
  ont aussi perdu le même chiffre (« 10 471,745 » lu « 471,745 » par les deux).
- **La confusion manuscrite 1 ↔ 7 est la faute de lecture la plus fréquente.** Exemples :
  « 7.971,144 » lu « 7.971,744 », « 41,304 » lu « 91,304 », le timbre « 1,000 » lu
  « 7,000 » (50/40). Sur l'image d'algoria 088, l'œil humain hésite aussi. Offrir l'autre
  lecture en lecture faible et laisser l'arithmétique trancher gagne 7 pièces sans aucun
  faux de montant. Le seul « faux » relevé (dirigeant 50/31, « Main d'oeuvre » contre
  « Main d'œuvre ») vient du comparateur du banc, pas de la lecture : ce treillis rend même
  justes 19 champs de lignes de cette pièce. **Il faut traiter « œ » = « oe » avant
  d'activer le treillis.**
- **La binarisation n'apporte rien. L'agrandissement apporte +5**, déjà acquis par v6, pour
  2,5 fois le temps d'OCR.
- **Les chiffres orientaux sont exclus deux fois.** L'adaptateur du Sudoku appelle
  `treillisMontant` sans lecteur, donc un montant en chiffres orientaux n'y entre jamais,
  même de la couche de texte d'un PDF. Et le modèle latin les lit en lettres (« VA,517 »
  pour ٧٨,٢٣٦). Croire les lectures v5 actuelles ne gagne rien (+0, mesuré). Avec des
  lectures justes, l'oracle en gagne 8. Claude les relit justes (synthétique 057 :
  ٧٥٤٣,٩٠٤ exact).

## La relecture ciblée par Claude — PROPOSITION (touche R2, le dirigeant décide)

**Principe.** La relecture ne vise que les pièces « aucune solution » qui ont une image
(51 ici ; le jeu du dirigeant n'a pas ses images dans le dépôt). On découpe leurs cases de
montant : la ligne entière pour le contexte, la case agrandie pour la lecture. On les donne à
Claude en lots parallèles de 6 cases. Il rend les caractères exacts en JSON strict
(`output_config.format`), et « illisible » est permis. Sa lecture, réduite au seul nombre de
la case, remplace le jeton OCR **comme candidat**. La pièce n'est prouvée que si le moteur,
rejoué sur ce relevé, referme toutes ses contraintes ; sinon rien ne change.

**R2.** Le modèle ne désigne pas et ne décide d'aucune valeur : il relit une case, sous le
contrôle du Sudoku. Il voit pourtant un morceau de la pièce. Cela contredit la lettre de R2
(« le modèle qui désigne ne voit jamais la pièce »). C'est pourquoi c'est une proposition.

**La consigne.** `outils/relecture-claude/consigne.md`, version 1 : chiffres orientaux et
séparateurs tunisiens, « illisible » plutôt que deviner, exemples. Les modèles sont des
paramètres et leurs prix se lisent dans `agents.model_pricing` (R8).

| passage                                                                              | modèle     | relues | gagnées | faux | coût total | coût / pièce relue | appel méd. / p95 | découpe | re-preuve |
| ------------------------------------------------------------------------------------ | ---------- | -----: | ------: | ---: | ---------: | -----------------: | ---------------- | ------- | --------- |
| 1 (run 42481846271)                                                                  | Sonnet 5.5 |     51 |       5 |    0 |     0,31 $ |           0,0062 $ | 2,1 s / 3,2 s    | 0,76 s  | 0,03 s    |
| 1                                                                                    | Haiku 5.5  |     51 |       4 |    0 |     0,03 $ |           0,0007 $ | 2,7 s / 6,2 s    | 0,76 s  | 0,03 s    |
| 2 (run 42482964304) : candidat réduit au nombre                                      | Sonnet 5.5 |     51 |       5 |    0 |     0,32 $ |           0,0062 $ | 1,9 s / 2,7 s    | 0,02 s  | 0,02 s    |
| 2                                                                                    | Haiku 5.5  |     51 |       5 |    0 |     0,03 $ |           0,0006 $ | 2,5 s / 6,4 s    | 0,02 s  | 0,02 s    |
| 3 (run 42483585387) : montants orientaux rendus sans chiffre (« .VA ») aussi choisis | Sonnet 5.5 |     51 |       5 |    0 |     0,32 $ |           0,0063 $ | 2,0 s / 2,7 s    | 0,02 s  | 0,02 s    |
| 3                                                                                    | Haiku 5.5  |     51 |       5 |    0 |     0,03 $ |           0,0006 $ | 2,7 s / 7,6 s    | 0,02 s  | 0,02 s    |

Dépense totale des trois passages : 1,06 $ au tarif en base (plafond : 30 $).

Pièces gagnées : algoria 023, 083, 088, synthétique 094 et 099.

**Les chiffres orientaux.** Au passage 3, Sonnet rend justes les trois totaux de synthétique
057 : 7 543,904 + 980,708 + 1,000 = 8 525,612. La pièce reste pourtant non prouvée, et le
moteur dit pourquoi : « le total HT ne porte pas son libellé ». L'OCR a lu le libellé arabe
« اعتبار » sans sa lettre ب (« اعتار »). **Rétablir cette seule lettre prouve 057, ses cinq
montants justes** (rejoué en local). Sur 061, le même libellé est lu « الذداءات أعتار … »,
plusieurs lettres fausses. Les pièces orientales demandent donc deux remèdes ensemble : la
relecture des chiffres (Claude la fait) et une reconnaissance tolérante des libellés arabes
du total HT (« اعتار » ≈ « اعتبار », à une lettre près). Ces libellés vivent dans les
grilles en base (`20261201090800_le_ht_a_ses_libelles_arabes.sql`). Autre voie : la
relecture ciblée relit aussi la case du libellé.

**algoria 083 n'est gagnée par aucun autre remède.** Haiku gagne autant que Sonnet pour dix fois moins cher. Il rend
moins de cases « illisibles » (87 contre 128 sur 493 au passage 3), mais son p95 est plus long.

## Le temps : 4 secondes par pièce

Mesures du poste local : 2 cœurs Xeon à 2,1 GHz. Pour le serveur, j'extrapole des mesures de
référence connues : OCR ONNX ≈ 3 s par page sur le CX23 du staging, ≈ 0,2 s sur GPU.

| étape                                      | 2 cœurs local : médiane / p95              | CX23 (extrapolé) | GPU     |
| ------------------------------------------ | ------------------------------------------ | ---------------- | ------- |
| OCR v5, page complète (25 pages au hasard) | 4,7 s / 16,5 s (10 sur 25 ≤ 4 s)           | ≈ 3 s / ≈ 11 s   | ≈ 0,2 s |
| OCR v5, premier temps (le tableau)         | 1,9 s / 5,8 s (17 sur 25 ≤ 4 s)            | ≈ 1,3 s / ≈ 4 s  | < 0,1 s |
| Sudoku (et treillis 1 ↔ 7)                 | 0,05 s / 0,12 s (max 6,3 s)                | idem             | idem    |
| Second lecteur v6, page complète           | 3,5 s / 10,4 s                             | ≈ 2,5 s / ≈ 7 s  | ≈ 0,2 s |
| Découpe des cases                          | 0,02 s                                     | 0,02 s           | —       |
| Appel Claude, lots parallèles              | Haiku 2,5 s / 6,4 s ; Sonnet 1,9 s / 2,7 s | idem (réseau)    | —       |
| Re-preuve                                  | 0,02 s                                     | idem             | —       |

**L'architecture proposée tient en trois temps :**

1. **≤ 4 s : réponse immédiate.** OCR, puis Sudoku, avec le treillis 1 ↔ 7 qui ne coûte
   rien. Sur le CX23, la pièce prouvée sort en ≈ 3,1 s en médiane. C'est le cas de 70,6 %
   des pièces (290 sur 411), mais seulement de celles dont l'OCR passe sous 4 s : environ
   55 % des pages, extrapolé. Le premier temps (le tableau) prouve déjà 101 pièces en
   ≈ 1,9 s sur 2 cœurs.
2. **Arrière-plan : « en vérification ».** Si la pièce n'est pas prouvée, l'utilisateur
   voit ses valeurs proposées, marquées « en vérification ». En parallèle partent le second
   lecteur v6 (≈ 3 s) et la relecture Claude des cases (≈ 2 à 3 s), puis la re-preuve
   (0,02 s). Le résultat arrive ≈ 3 à 6 s plus tard (+9 pièces, puis +1).
3. **Sinon, motif actionnable** (plus bas).

Tout tient en 4 s au p95 sur GPU (OCR 0,2 s, v6 0,2 s, Claude Sonnet 2,7 s p95 en
parallèle, re-preuve). C'est vrai aussi sur un CPU 8 cœurs, une page par cœur : OCR ≈ 1 s,
estimé. Sonnet a un p95 plus court que Haiku (2,7 contre 6,4 s), pour dix fois le prix. Pour
l'appel synchrone, Sonnet tient le délai ; en arrière-plan, Haiku suffit. Un cache par
empreinte d'image évite de relire une pièce déjà vue.

## Feuille de route vers 90 %, par gain sur effort

| rang | qui             | quoi                                                                                                      | gain                         | effort      |
| ---- | --------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------- |
| 1    | lecture (moi)   | Treillis 1 ↔ 7 dans `montantsDuJeton`, après la correction « œ » = « oe » du comparateur                  | +7 (+1,7 pt), mesuré         | 1 jour      |
| 2    | moteur (expert) | **Preuves par type de pièce** (liste ci-dessous)                                                          | ≈ +33 (+8 pts), estimé       | gros        |
| 3    | moteur (expert) | **Formes de facture manquantes** (liste ci-dessous)                                                       | ≈ +13 (+3,2 pts), estimé     | moyen       |
| 4    | lecture (moi)   | v6 en second prouveur, confirmé chiffre pour chiffre, en arrière-plan                                     | +8 (+1,9 pt), mesuré         | 2 jours     |
| 5    | lecture         | Chiffres orientaux : relecture des cases + décision (croire un candidat oriental sous contrôle du Sudoku) | +8 (+1,9 pt), oracle         | 2 jours     |
| 6    | lecture         | Relecture Claude des cases (si R2 est assouplie) : algoria 083, et la part orientale de 5                 | +1 mesuré, +8 avec le rang 5 | fait (banc) |
| 7    | lecture         | Libellés arabes : relecture arabe des libellés (modèle server, la nuit)                                   | +3 à 5, estimé               | moyen       |
| 8    | moteur          | Issues « sans montant » et « signalée » pour F et G                                                       | 100 % traitées               | petit       |

Somme réaliste : 283 + 16 (mesuré) + 33 + 13 + 8 + 4 ≈ **357 (86,9 %) sur 411, soit 94 %
des 379 pièces prouvables**. Passer de 87 % à 90 % sur 411 suppose de tout gagner dans E et
D, chiffres orientaux et libellés arabes compris. **Je recommande au dirigeant de fixer
l'objectif sur les pièces prouvables, avec 100 % des pièces traitées.**

## Pour l'expert du moteur : les formes de preuve qui manquent

Toutes sont **cohérentes sur la couche de texte du PDF**, donc prouvables. Les taux viennent
du référentiel (R4).

**Factures (cause D) :**

- **FODEC** : TVA = taux × (HT + FODEC). Dirigeant 50/02 : 7 300 + 71,200 → TVA 1 400,528,
  TTC 8 772,728 ; algoria 064 (arabe), 091, 097 ; synthétique 066.
- **Débours hors champ** : TTC des prestations + débours + timbre = net. Dirigeant 50/21 :
  636,650 + 3 966,290 + 1 = 4 603,940 ; 100/B-15 (débours à 0 %).
- **Exonération partielle** : base de TVA ≠ HT, une ligne à 0 %. Dirigeant 50/17 (base
  80 850 pour un HT de 81 500), 50/38, 50/30 ; algoria 080, 092, 098.
- **Facture sans TVA** : sous-total = total, ou Σ lignes = HT = net. Dirigeant 50/18
  (USD), 50/19 (EUR autoliquidé), 50/20 (FOB USD, format « 7,108.00 »), 50/35 (régime
  forfaitaire).
- **Export ambigu** : HT = TTC, plusieurs affectations de la même valeur. Algoria 111 ;
  synthétique 046, 054, 070, 098. Quand toutes les solutions donnent les mêmes valeurs, le
  montant est prouvé : il faut l'affirmer.
- **Libellés arabes reconnus à une lettre près** : « اعتار » pour « اعتبار » (5 jetons dans
  les relevés). Synthétique 057 est prouvée dès que ce libellé est reconnu.
- **« Total avec timbre » = HT + timbre**, ligne piège distincte du TTC : algoria 023.
- **Montant écrit au-dessus de son libellé** (manuscrit) et valeur raturée : algoria 080,
  dirigeant 50/30.
- **Le moteur doit dire la case en cause** (« le TTC doit valoir HT + TVA + timbre ; la
  case (x, y) lue 5 780,238 ne boucle pas »). La relecture ciblée l'attend : elle vise
  aujourd'hui toutes les cases de montant de la pièce (9,5 en moyenne).

**Types de pièce sans preuve exécutable (cause E)**, avec leurs invariants vérifiés sur la
vérité du jeu :

| type                                                     | invariant                                                                                       | pièces exemples                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| BL, ticket, reçu, bon de commande qui portent des totaux | les preuves de la facture (Σ lignes = HT ; HT + TVA = TTC)                                      | dirigeant 100/C-03 (BL 2 136 + 405,840 = 2 541,840), C-04, C-11, C-18            |
| ticket de caisse                                         | Σ lignes = total ; reçu − total = rendu ; TVA incluse = TTC × t / (1 + t) par taux              | algoria 138 (100 − 97,900 = 2,100 ; 15,631), 139 ; dirigeant 50/05, 50/16, 50/29 |
| note de frais                                            | Σ lignes TTC = total ; total − avance = net                                                     | algoria 134 (548,500 − 200 = 348,500), 135                                       |
| relevé bancaire                                          | solde avant ± mouvement = solde après, ligne à ligne ; solde initial + crédits − débits = final | algoria 136, 137 (8 354,947 + 26 317,380 − 2 119,802 = 32 552,525)               |
| bulletin de paie                                         | base + indemnités = brut ; brut − CNSS = imposable ; imposable − IRPP = net ; coût employeur    | algoria 140 (4 063 + 89 + 48 = 4 200 ; 3 814,440 − 909,032 = 2 905,408), 141     |
| déclaration de TVA                                       | taux × CA = TVA ; collectée − déductible = à payer (ou crédit) ; + timbre = total               | algoria 142 (8 460,506 − 2 466,650 = 5 993,856), 143 (crédit 1 305,377)          |
| déclaration CNSS                                         | Σ des trois mois = trimestre, par salarié                                                       | algoria 144, 145                                                                 |
| déclaration IS / retenues                                | IS dû − acomptes − retenues = reste ; Σ retenues + TFP + FOPROLOS = total                       | algoria 146 (20 618,249 − 9 577,878 − 3 301,313 = 7 739,058), 147                |
| acompte provisionnel                                     | taux × impôt N−1 = brut ; brut − retenues = net                                                 | algoria 148, 149                                                                 |
| certificat de retenue                                    | brut − retenue = net servi ; taux × brut = retenue                                              | algoria 152 (76 483,638 − 1 147,255 = 75 336,383)                                |
| reçu de loyer                                            | loyer + TVA + charges − retenue = reçu                                                          | algoria 133 (3 200 + 608 + 207 − 320 = 3 695)                                    |
| avis d'échéance / quittance d'assurance                  | prime nette + accessoires + taxes (+ timbre) = TTC                                              | algoria 158 (1 777,849 + 32 + 163,903 = 1 973,752) ; dirigeant 50/26             |
| avis de débit                                            | HT + TVA = total débité                                                                         | dirigeant 50/27 (105,500 + 20,045 = 125,545)                                     |
| PV d'AGO                                                 | résultat + report = à affecter = réserve + dividendes + nouveau report                          | algoria 121 (90 222,319 + 5 143,722 = 95 366,041)                                |
| statuts                                                  | capital = Σ apports = parts × nominal                                                           | algoria 123 (25 000 + 15 000 + 10 000 = 50 000)                                  |
| virement, chèque, reçu                                   | montant en chiffres = montant en lettres                                                        | algoria 130, 131, 132                                                            |
| un seul montant (bail, contrat, RNE, BL sans total)      | pas d'invariant interne : montant en lettres, ou rapprochement avec une autre pièce             | algoria 124, 128, 154–157 ; dirigeant 50/49                                      |

Sont aussi prouvables, entre deux pièces, les rapprochements du relevé 136 avec le virement
130 (15 456,142), le chèque 131 (3 408,153), le certificat 152 (75 336,383) et la déclaration
142 (6 007,856).

## « 100 % traité » : un motif actionnable pour chaque pièce non prouvée

Je propose qu'aucune pièce ne sorte sans issue. Chacune reçoit l'une des cinq suivantes, avec
le champ, la raison et la zone de l'image :

- **prouvée** ;
- **en vérification** (arrière-plan en cours) ;
- **à vérifier — champ X** : par exemple « TTC : la case (x, y) lue 5 780,238 ne referme pas
  HT + TVA + timbre ; relire la zone encadrée ». Le moteur dit la contrainte en échec, et la
  découpe de la relecture donne la zone ;
- **signalée** : les montants imprimés ne se referment pas (cause G, 14 pièces) ;
- **sans montant** (cause F, 18 pièces) ;
- **type sans vérification arithmétique** (cause E, en attendant sa grille) : montants
  listés, à contrôler.

L'annexe donne déjà, pour les 128 pièces, la cause et la précision qui nourrissent ce motif.

## Annexe — les 128 pièces non prouvées

| pièce              | issue du moteur | cause principale                                  | précision (causes secondaires)                                                                                  |
| ------------------ | --------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| algoria 023        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par v6, qwen                                                                       |
| algoria 062        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par v6                                                                             |
| algoria 070        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par 1↔7, qwen                                                                      |
| algoria 083        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par oracle, qwen                                                                   |
| algoria 088        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par oracle, 1↔7                                                                    |
| algoria 089        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par oracle                                                                         |
| algoria 090        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par v6                                                                             |
| algoria 100        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par oracle, v6, qwen                                                               |
| algoria 116        | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montants manuscrits déformés (« 97232,1 » pour 17 232,139) : aucun lecteur ne les rend                          |
| dirigeant 100/B-15 | aucune          | A — Lecture — montant mal lu, perdu ou collé      | quantité « 1 » perdue sur deux lignes, taux « %0 » inversé (OCR) ; prouvée sur la couche texte                  |
| dirigeant 50/14    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | quantités « 1 » et « 2 » perdues (OCR) ; prouvée sur la couche texte                                            |
| dirigeant 50/40    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | timbre manuscrit lu « 7,000 » pour 1,000 (1↔7) ; lignes en TTC                                                  |
| synthetique 056    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par v6, qwen                                                                       |
| synthetique 059    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par v6, qwen                                                                       |
| synthetique 063    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par oracle, 1↔7, v6, qwen                                                          |
| synthetique 068    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par oracle, v6                                                                     |
| synthetique 089    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par v6, qwen                                                                       |
| synthetique 094    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par oracle, 1↔7, v6, qwen                                                          |
| synthetique 099    | aucune          | A — Lecture — montant mal lu, perdu ou collé      | montant mal lu ; récupérable par oracle, 1↔7, v6                                                                |
| algoria 086        | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin (oracle : prouvée)     |
| algoria 092        | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin                        |
| algoria 095        | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin (oracle : prouvée)     |
| algoria 118        | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin (oracle : prouvée)     |
| algoria 120        | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin (oracle : prouvée)     |
| synthetique 044    | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin (oracle : prouvée)     |
| synthetique 048    | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin (oracle : prouvée)     |
| synthetique 052    | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin (oracle : prouvée)     |
| synthetique 057    | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin (oracle : prouvée)     |
| synthetique 061    | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin                        |
| synthetique 066    | aucune          | B — Lecture — chiffres arabes orientaux           | chiffres arabes orientaux : refusés d’un lecteur d’image, et mal lus par le modèle latin                        |
| algoria 059        | aucune          | C — Lecture — libellés arabes perdus              | texte arabe (photo) : libellés/structure — Qwen la prouve (ses libellés arabes) ; scénario long                 |
| algoria 064        | aucune          | C — Lecture — libellés arabes perdus              | texte arabe (scan) : libellés/structure — Qwen la prouve (ses libellés arabes) ; scénario fodec                 |
| algoria 071        | aucune          | C — Lecture — libellés arabes perdus              | texte arabe (photo) : libellés/structure — Qwen la prouve (ses libellés arabes) ; scénario remise               |
| algoria 091        | aucune          | C — Lecture — libellés arabes perdus              | texte arabe (manuscrit) : libellés/structure ; scénario fodec                                                   |
| algoria 094        | aucune          | C — Lecture — libellés arabes perdus              | texte arabe (manuscrit) : libellés/structure ; scénario taux_7                                                  |
| algoria 097        | aucune          | C — Lecture — libellés arabes perdus              | texte arabe (manuscrit) : libellés/structure ; scénario fodec                                                   |
| algoria 098        | aucune          | C — Lecture — libellés arabes perdus              | texte arabe (manuscrit) : libellés/structure ; scénario exonere                                                 |
| algoria 119        | aucune          | C — Lecture — libellés arabes perdus              | texte arabe (manuscrit) : libellés/structure ; scénario plusieurs_taux                                          |
| dirigeant 50/24    | aucune          | C — Lecture — libellés arabes perdus              | facture en arabe : montants lus justes, libellés arabes perdus (« 51可1861% »)                                  |
| dirigeant 50/42    | aucune          | C — Lecture — libellés arabes perdus              | facture en arabe : libellés arabes perdus ; « 1890,00 » décimale perdue                                         |
| algoria 080        | aucune          | D — Moteur — forme de preuve de facture manquante | mise en page manuscrite : chaque total écrit AU-DESSUS de son libellé, une valeur raturée ; montants lus justes |
| algoria 111        | ambigue         | D — Moteur — forme de preuve de facture manquante | export sans TVA : HT = TTC, plusieurs affectations (ambiguë)                                                    |
| dirigeant 50/02    | aucune          | D — Moteur — forme de preuve de facture manquante | FODEC 1 % : TVA sur (HT + FODEC)                                                                                |
| dirigeant 50/17    | aucune          | D — Moteur — forme de preuve de facture manquante | exonération partielle : base TVA 80 850 ≠ HT 81 500 (ligne à 0 %)                                               |
| dirigeant 50/18    | aucune          | D — Moteur — forme de preuve de facture manquante | facture étrangère sans TVA (USD) : sous-total = total                                                           |
| dirigeant 50/19    | aucune          | D — Moteur — forme de preuve de facture manquante | facture UE autoliquidée (EUR, TVA 0) : sous-total = total                                                       |
| dirigeant 50/20    | aucune          | D — Moteur — forme de preuve de facture manquante | facture export FOB USD, format anglo-saxon « 7,108.00 », sans TVA                                               |
| dirigeant 50/21    | aucune          | D — Moteur — forme de preuve de facture manquante | débours hors champ TVA : TTC prestations + débours + timbre = net                                               |
| dirigeant 50/30    | aucune          | D — Moteur — forme de preuve de facture manquante | exonération partielle (ligne à 0 %, bases TVA ≠ HT) + total HT déplacé au-dessus de son libellé                 |
| dirigeant 50/35    | aucune          | D — Moteur — forme de preuve de facture manquante | régime forfaitaire, sans TVA : Σ lignes = total HT = net                                                        |
| dirigeant 50/38    | aucune          | D — Moteur — forme de preuve de facture manquante | exonération partielle : base TVA 58,500 ≠ HT 223,500                                                            |
| synthetique 046    | ambigue         | D — Moteur — forme de preuve de facture manquante | export sans TVA : HT = TTC, plusieurs affectations (ambiguë)                                                    |
| synthetique 054    | ambigue         | D — Moteur — forme de preuve de facture manquante | export sans TVA : HT = TTC, plusieurs affectations (ambiguë)                                                    |
| synthetique 070    | ambigue         | D — Moteur — forme de preuve de facture manquante | export sans TVA : HT = TTC, plusieurs affectations (ambiguë)                                                    |
| synthetique 098    | ambigue         | D — Moteur — forme de preuve de facture manquante | export sans TVA : HT = TTC, plusieurs affectations (ambiguë)                                                    |
| algoria 121        | aucune          | E — Moteur — type de pièce sans preuve exécutable | PV d’AGO : résultat + report = à affecter = réserve + dividendes + nouveau report                               |
| algoria 123        | ambigue         | E — Moteur — type de pièce sans preuve exécutable | statuts : capital = Σ apports = parts × nominal                                                                 |
| algoria 124        | aucune          | E — Moteur — type de pièce sans preuve exécutable | extrait RNE : un seul montant (capital)                                                                         |
| algoria 128        | aucune          | E — Moteur — type de pièce sans preuve exécutable | BL : prix par ligne, aucun total                                                                                |
| algoria 129        | aucune          | E — Moteur — type de pièce sans preuve exécutable | BL manuscrit arabe, sans montant                                                                                |
| algoria 130        | aucune          | E — Moteur — type de pièce sans preuve exécutable | virement : montant en chiffres = en lettres                                                                     |
| algoria 131        | aucune          | E — Moteur — type de pièce sans preuve exécutable | chèque : chiffres = lettres                                                                                     |
| algoria 132        | aucune          | E — Moteur — type de pièce sans preuve exécutable | reçu : chiffres = lettres (chiffres orientaux)                                                                  |
| algoria 133        | aucune          | E — Moteur — type de pièce sans preuve exécutable | reçu de loyer : loyer + TVA + charges − retenue = reçu                                                          |
| algoria 134        | ambigue         | E — Moteur — type de pièce sans preuve exécutable | note de frais : Σ lignes = total ; total − avance = net                                                         |
| algoria 135        | aucune          | E — Moteur — type de pièce sans preuve exécutable | note de frais : Σ lignes = total                                                                                |
| algoria 136        | aucune          | E — Moteur — type de pièce sans preuve exécutable | relevé : solde avant ± mouvement = solde après (chaîne)                                                         |
| algoria 137        | aucune          | E — Moteur — type de pièce sans preuve exécutable | relevé : solde initial + crédits − débits = solde final                                                         |
| algoria 138        | aucune          | E — Moteur — type de pièce sans preuve exécutable | ticket : Σ lignes = total ; reçu − total = rendu ; TVA incluse                                                  |
| algoria 139        | aucune          | E — Moteur — type de pièce sans preuve exécutable | ticket : Σ lignes = total ; ventilation TVA                                                                     |
| algoria 140        | aucune          | E — Moteur — type de pièce sans preuve exécutable | bulletin : base + indemnités = brut ; imposable − IRPP = net ; coût employeur                                   |
| algoria 141        | aucune          | E — Moteur — type de pièce sans preuve exécutable | bulletin : brut − retenues = net                                                                                |
| algoria 142        | aucune          | E — Moteur — type de pièce sans preuve exécutable | déclaration TVA : collectée − déductible = à payer ; + timbre = total                                           |
| algoria 143        | aucune          | E — Moteur — type de pièce sans preuve exécutable | déclaration TVA : déductible − collectée = crédit                                                               |
| algoria 144        | aucune          | E — Moteur — type de pièce sans preuve exécutable | CNSS : Σ des mois = trimestre, par salarié                                                                      |
| algoria 145        | aucune          | E — Moteur — type de pièce sans preuve exécutable | CNSS : Σ des mois = trimestre, par salarié                                                                      |
| algoria 146        | aucune          | E — Moteur — type de pièce sans preuve exécutable | IS : IS dû − acomptes − retenues = reste                                                                        |
| algoria 147        | aucune          | E — Moteur — type de pièce sans preuve exécutable | retenues : Σ RS = total ; + TFP + FOPROLOS = total à payer                                                      |
| algoria 148        | aucune          | E — Moteur — type de pièce sans preuve exécutable | acompte : brut − retenues = net                                                                                 |
| algoria 149        | aucune          | E — Moteur — type de pièce sans preuve exécutable | acompte : brut − retenues = net                                                                                 |
| algoria 152        | aucune          | E — Moteur — type de pièce sans preuve exécutable | certificat RS : brut − retenue = net servi                                                                      |
| algoria 154        | aucune          | E — Moteur — type de pièce sans preuve exécutable | contrat : un seul montant                                                                                       |
| algoria 155        | aucune          | E — Moteur — type de pièce sans preuve exécutable | CDI : un seul montant                                                                                           |
| algoria 156        | aucune          | E — Moteur — type de pièce sans preuve exécutable | bail : loyer, dépôt (un multiple du loyer)                                                                      |
| algoria 157        | aucune          | E — Moteur — type de pièce sans preuve exécutable | bail : loyer, dépôt                                                                                             |
| algoria 158        | aucune          | E — Moteur — type de pièce sans preuve exécutable | avis d’assurance : prime nette + accessoires + taxes = TTC                                                      |
| dirigeant 100/C-03 | aucune          | E — Moteur — type de pièce sans preuve exécutable | BL portant totaux HT/TVA/TTC : les preuves de la facture s’appliquent                                           |
| dirigeant 100/C-04 | aucune          | E — Moteur — type de pièce sans preuve exécutable | ticket portant totaux HT/TVA/TTC : les preuves de la facture s’appliquent                                       |
| dirigeant 100/C-11 | aucune          | E — Moteur — type de pièce sans preuve exécutable | reçu portant totaux (TVA 0) : les preuves de la facture s’appliquent                                            |
| dirigeant 100/C-18 | aucune          | E — Moteur — type de pièce sans preuve exécutable | bon de commande portant totaux HT/TVA/TTC : les preuves de la facture s’appliquent                              |
| dirigeant 50/05    | aucune          | E — Moteur — type de pièce sans preuve exécutable | ticket : HT par taux (19 %, 7 %) → TTC                                                                          |
| dirigeant 50/16    | aucune          | E — Moteur — type de pièce sans preuve exécutable | ticket : TOTAL TTC = HT + TVA du taux                                                                           |
| dirigeant 50/26    | aucune          | E — Moteur — type de pièce sans preuve exécutable | quittance d’assurance : prime nette + taxes + timbre = total                                                    |
| dirigeant 50/27    | aucune          | E — Moteur — type de pièce sans preuve exécutable | avis de débit : commission HT + TVA = total débité                                                              |
| dirigeant 50/29    | aucune          | E — Moteur — type de pièce sans preuve exécutable | ticket : TOTAL TTC (montant décroché du libellé) = HT + TVA 7 %                                                 |
| dirigeant 50/49    | aucune          | E — Moteur — type de pièce sans preuve exécutable | BL sans montant : quantités commandées = livrées                                                                |
| algoria 122        | aucune          | F — Rien à prouver (aucun montant)                | PV d’AGE sans montant                                                                                           |
| algoria 125        | aucune          | F — Rien à prouver (aucun montant)                | décision du gérant sans montant                                                                                 |
| algoria 150        | aucune          | F — Rien à prouver (aucun montant)                | carte d’identification fiscale                                                                                  |
| algoria 151        | aucune          | F — Rien à prouver (aucun montant)                | carte d’identification fiscale                                                                                  |
| algoria 153        | aucune          | F — Rien à prouver (aucun montant)                | attestation de travail sans montant                                                                             |
| algoria 159        | sans_grille     | F — Rien à prouver (aucun montant)                | document sans grille                                                                                            |
| algoria 160        | sans_grille     | F — Rien à prouver (aucun montant)                | document non comptable                                                                                          |
| algoria 161        | sans_grille     | F — Rien à prouver (aucun montant)                | document non comptable                                                                                          |
| dirigeant 100/E-01 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-02 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-03 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-04 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-05 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-06 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-07 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-08 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-09 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/E-10 | aucune          | F — Rien à prouver (aucun montant)                | formulaire vierge, aucun montant écrit                                                                          |
| dirigeant 100/D-01 | aucune          | G — Pièce incohérente par construction (piège)    | pièce incohérente par construction (piège du jeu) : non-preuve juste ; viser « signalée »                       |
| dirigeant 100/D-02 | aucune          | G — Pièce incohérente par construction (piège)    | pièce incohérente par construction (piège du jeu) : non-preuve juste ; viser « signalée »                       |
| dirigeant 100/D-03 | aucune          | G — Pièce incohérente par construction (piège)    | pièce incohérente par construction (piège du jeu) : non-preuve juste ; viser « signalée »                       |
| dirigeant 100/D-04 | signalee        | G — Pièce incohérente par construction (piège)    | pièce incohérente par construction (piège du jeu) : non-preuve juste ; viser « signalée »                       |
| dirigeant 100/D-08 | signalee        | G — Pièce incohérente par construction (piège)    | pièce incohérente par construction (piège du jeu) : non-preuve juste ; viser « signalée »                       |
| dirigeant 50/10    | aucune          | G — Pièce incohérente par construction (piège)    | pièce incohérente par construction (piège du jeu) : non-preuve juste ; viser « signalée »                       |
| dirigeant 50/13    | aucune          | G — Pièce incohérente par construction (piège)    | pièce incohérente par construction (piège du jeu) : non-preuve juste ; viser « signalée »                       |
| dirigeant 50/44    | aucune          | G — Pièce incohérente par construction (piège)    | pièce incohérente par construction (piège du jeu) : non-preuve juste ; viser « signalée »                       |
| synthetique 003    | aucune          | G — Pièce incohérente par construction (piège)    | piège du jeu (total_faux) : non-preuve juste                                                                    |
| synthetique 021    | aucune          | G — Pièce incohérente par construction (piège)    | piège du jeu (montant_illisible) : non-preuve juste                                                             |
| synthetique 043    | aucune          | G — Pièce incohérente par construction (piège)    | piège du jeu (total_faux) : non-preuve juste                                                                    |
| synthetique 073    | aucune          | G — Pièce incohérente par construction (piège)    | piège du jeu (tva_fausse) : non-preuve juste                                                                    |
| synthetique 084    | aucune          | G — Pièce incohérente par construction (piège)    | piège du jeu (montant_illisible) : non-preuve juste                                                             |
| synthetique 096    | aucune          | G — Pièce incohérente par construction (piège)    | piège du jeu (tva_fausse) : non-preuve juste                                                                    |
