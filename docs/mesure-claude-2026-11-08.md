# Ce que Claude apporte au Sudoku — bulletin du 8 novembre 2026

Passage : [Mesure Claude, run 42475726319](https://github.com/ALGORIA-FACTORY/malica-office/actions/runs/42475726319)
(artefact `mesure-claude` : mesures JSON, bulletin, journal, relevés OCR gardés).
Données : `docs/mesure-claude-2026-11-08.json`. Banc : `apps/api/tests/real/banc-designation.ts`.

## Le mode mesuré : « Sudoku d'abord »

Le moteur lit toutes les pièces. Haiku n'est appelé que sur les pièces que le moteur n'a pas
prouvées. Sonnet n'est appelé que sur celles qui restent non prouvées après Haiku. DeepSeek,
le repli de production, est mesuré sur les mêmes pièces que Haiku.

Le modèle reçoit l'invite de production : le plan de jetons, jamais l'image. Ce qu'il désigne
n'est affirmé que si le moteur le prouve. Pour cela, le moteur est rejoué sur le même relevé,
et seuls les montants que le modèle a désignés gardent leur lecture de montant.

Les corpus sont `algoria` (161 pièces), `synthetique` (100) et `dirigeant` (150), soit 411
pièces. Le relevé est fait par PaddleOCR v5 (le service `infra/ocr/`, CPU, relecture arabe
allumée).

## Résultat

| Chaîne                       | Pièces prouvées | Faux affirmés | Appels IA |  Coût par pièce (les 411) | Coût par appel | Secondes par appel (médiane) |
| ---------------------------- | --------------: | ------------: | --------: | ------------------------: | -------------: | ---------------------------: |
| Moteur seul                  |    283 (68,9 %) |             0 |         0 |                       0 $ |              — |   1,13 s par pièce (moyenne) |
| + Haiku 5.5                  |    283 (68,9 %) |             0 |       125 |                 0,00046 $ |       0,0015 $ |                        9,6 s |
| + Sonnet 5.5, second avis    |    283 (68,9 %) |             0 |       125 | 0,0038 $ (Haiku + Sonnet) |       0,0118 $ |                        3,2 s |
| DeepSeek à la place de Haiku |    283 (68,9 %) |             0 |       125 |                 0,00052 $ |       0,0017 $ |                        2,2 s |

- Sur `algoria` et `synthetique`, le moteur prouve 175 pièces sur 261, comme la référence. Le
  modèle n'en ajoute aucune.
- **286 pièces sur 411 (69,6 %) n'appellent aucun modèle** en mode « Sudoku d'abord » : les 283
  que le moteur prouve, et 3 sans grille. Haiku est appelé 125 fois au lieu de 411 si l'IA
  lisait chaque pièce, soit 286 appels évités ; Sonnet est appelé sur les mêmes 125. (Le bulletin
  brut du run annonce « 161 évitées » : le banc soustrayait les appels au lieu des pièces. C'est
  corrigé dans le code ; les autres chiffres ne changent pas.)
- **Aucune pièce n'est gagnée par un modèle.** Sur les 125 pièces non prouvées, le moteur ne
  trouve aucune solution pour 116 d'entre elles, même avec tous les jetons. Il en trouve
  plusieurs pour 7, et 2 sont signalées. Restreindre les montants à ceux que le modèle désigne
  ne peut pas créer une preuve que le relevé ne porte pas. Pour les 7 pièces ambiguës, la
  désignation ne tranche pas non plus : 5 restent ambiguës et 2 ne ferment plus.
- **Zéro faux affirmé.** C'est vrai dans chaque chaîne, puisque rien de ce que dit un modèle
  n'a été prouvé.

## Ce que l'écran montrerait sans la preuve

Voici, sur ces mêmes pièces, les totaux (HT, TVA, TTC) désignés par le modèle et relus dans le
plan, comparés à la vérité :

| Désignateur | justes | faux | part de faux |
| ----------- | -----: | ---: | -----------: |
| Haiku 5.5   |     93 |    8 |        7,9 % |
| Sonnet 5.5  |     77 |    6 |        7,2 % |
| DeepSeek    |     87 |   15 |       14,7 % |

La plupart des faux de Claude ne viennent pas de la désignation : le bon jeton est désigné,
mais l'OCR l'a mal lu (« 5780,238 » pour « 5723,008 », « 7971,744 » pour « 7971,144 »). Le
Sudoku les arrête justement parce que l'arithmétique ne ferme pas.

## Coût et jetons (tarif de `agents.model_pricing`)

| Désignateur | appels réussis |  entrée |  sortie | cache lu | cache écrit |     coût |
| ----------- | -------------: | ------: | ------: | -------: | ----------: | -------: |
| Haiku 5.5   |            124 | 420 805 | 280 348 |  351 960 |      11 732 | 0,1872 $ |
| Sonnet 5.5  |            118 | 406 910 |  51 052 |  334 362 |      11 732 | 1,3871 $ |
| DeepSeek    |            125 | 632 587 |  39 671 |        0 |           0 | 0,2144 $ |

- **Dépense du passage : 1,79 $ au tarif en base.** Le banc a aussi suivi une dépense « au prix
  de garde » (le tarif × 3, avec un plancher de 1 / 5 $ par million) : 25,28 $, sous le plafond
  de 45 $. Si les prix réels de Claude étaient plus élevés que ceux de la base, la console de la
  Claude Platform le dirait ; le prix de garde reste une borne haute.
- Haiku écrit en moyenne 2 261 jetons par appel, de la réflexion pour l'essentiel, contre 433
  pour Sonnet. C'est pourquoi il est le plus lent (9,6 s en médiane), bien qu'il reste le moins
  cher.

## Pannes relevées (défauts réels de la chaîne)

- **Haiku, 1 sur 125** : la réponse porte une `currency` objet au lieu d'une chaîne, et le
  contrat zod la refuse. En production, la pièce passerait au repli.
- **Sonnet, 7 sur 125** : le JSON est précédé ou suivi d'une phrase (« Le sens de… »,
  « Le texte d… »), et `parseJsonLoose` le refuse. Les sorties structurées
  (`output_config.format`) supprimeraient ces deux classes de pannes ; elles demandent de
  remodeler le contrat de désignation (voir « ce qui reste ouvert »).

## Non mesuré

- **La comparaison « IA sur toutes les pièces »** (Haiku aussi sur les 283 pièces déjà
  prouvées) : la clé Anthropic a été désactivée pendant le passage, après les étapes « Sudoku
  d'abord ». Les 283 appels sont revenus en 401. Ils ne sont pas comptés, et rien n'a été
  facturé. À relancer quand le secret sera renouvelé : pousser sur `claude/mesure-claude` un
  commit portant « [sans repli] », pour ne pas remesurer DeepSeek.

## Conclusion vers l'objectif de 90 %

En désignation, le modèle n'élève pas le taux de pièces prouvées. Il désigne des jetons ; il
ne lit pas. Les 116 pièces sans solution manquent de montants justes dans le relevé : mauvaise
lecture, chiffre collé ou perdu. Une désignation ne peut pas les y mettre. Pour gagner les
21 points qui séparent 68,9 % de 90 %, il faut un **meilleur relevé** et de **nouveaux
experts** du moteur, par exemple le second lecteur Qwen sur les pièces non prouvées (banc
`banc-ocr-qwen`). Changer de désignateur ne suffira pas. En mode « Sudoku d'abord », le rôle de
Claude est de proposer, pour les pièces non prouvées, des valeurs à vérifier, jamais affirmées.
Haiku le fait pour 0,0015 $ par appel, avec deux fois moins de faux que DeepSeek.
