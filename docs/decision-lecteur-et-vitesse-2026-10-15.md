# Quel lecteur en premier, et à quelle vitesse — décidé le 15 octobre 2026

Ce document tranche une question posée par le dirigeant : « 36 secondes c'est
trop, pourquoi la conception est mauvaise ? Paddle peut nous faire gagner,
non ? »

Il ne raisonne pas : il rapporte des mesures faites sur **ses** pièces, par la
chaîne réelle, sur la machine de production, et il en tire une décision.

## Ce que j'avais dit de faux, et qu'il faut corriger d'abord

J'ai affirmé que la désignation prenait **36 secondes** et qu'elle était le
goulot. C'était vrai **le 4 octobre 2026**, et faux depuis.

Le dépôt avait déjà quitté le modèle de raisonnement le **5 octobre**, pour
cette raison exacte — le commentaire de `modeles.ts` dit « trente-six secondes
d'attente pour quelqu'un qui tient son téléphone ». J'ai repris la dernière
ligne du journal sans regarder sa date.

Et le journal s'était tu depuis, pour une raison qui est elle-même un défaut :
le rôle y était écrit en dur (« reasoner ») alors que l'appel passait en
« chat ». `agents.model_pricing` cherche un tarif par le COUPLE (modèle,
rôle) ; ce couple n'existait pas, l'écriture était refusée **en silence**, et
l'étape la plus coûteuse n'était plus mesurée depuis dix jours. Corrigé le
14 octobre : le rôle voyage avec le modèle, et une épreuve refuse tout rôle
littéral à cet endroit.

**La désignation prend aujourd'hui 3 secondes.** Mesuré sur quatre pièces.

## La mesure qui décide

Chaque pièce lue deux fois par la chaîne réelle, sur la machine de staging :
une fois avec PaddleOCR en premier, une fois avec le modèle de vision.

| Pièce | Lecteur | Relevé | Total | Contrat | TTC lu | Base HT |
|---|---|---|---|---|---|---|
| `6a2d49aa` | **paddle** | 32 s | 35 s | partiel | **4 134,183** | 3 561,300 |
| `6a2d49aa` | qwen | 16 s | 19 s | partiel | **135,183** ✗ | 3 561,300 |
| `6ddc6804` | **paddle** | 26 s | 30 s | complet | 326,370 | 273,420 |
| `6ddc6804` | qwen | — | — | **ÉCHEC** | — | — |
| `53144e64` | paddle | 29 s | 32 s | complet | 8 772,728 | 7 300,000 |
| `53144e64` | qwen | 14 s | 17 s | complet | 8 772,728 | 7 300,000 |
| `8888a12d` | paddle | 27 s | 30 s | complet | 13 690,165 | 11 503,500 |
| `8888a12d` | qwen | 12 s | 14 s | complet | 13 690,165 | 11 503,500 |

L'échec de `6ddc6804` est net : « Qwen a tronqué le relevé (plafond de jetons
atteint) ». Il ne rend rien du tout.

### Ce que ça dit, en trois lignes

Sur quatre factures réelles :

- **deux où PaddleOCR gagne franchement** — un total faux (135,183 au lieu de
  4 134,183, le défaut qui bloquait l'écriture comptable) et un échec complet ;
- **deux où les deux s'accordent**, au centime ;
- **zéro où le modèle de vision gagne.**

Le prix : **quatorze secondes de plus par pièce**, en moyenne.

## La décision

**PaddleOCR reste en première couche.** Quatorze secondes ne pèsent rien
contre un total faux qui entre en comptabilité — et sur `6a2d49aa`, c'est
exactement ce qui se produisait.

L'ordre reste :

1. la couche de texte d'un PDF — exacte, gratuite, instantanée ;
2. PaddleOCR ;
3. le modèle de vision, en rattrapage.

## Ce qui ne se règle plus

Le plancher du relevé sur cette machine est de **vingt-sept secondes**, et il
a été cherché :

- la taille de l'image : 300 dpi 46 s, 200 dpi 34 s, 150 dpi 28 s, 100 dpi
  26 s — et tous les montants lus à chaque résolution. D'où la borne à
  1600 pixels, déjà posée. En dessous, le gain s'éteint ;
- le nombre de fils : 1 → 37 s, **2 → 28 s**, 4 → 30 s. Deux processeurs ;
- le modèle : PP-OCRv6 tiny → 31 s, small → 30 s, contre 28 s pour
  PP-OCRv5 mobile. Les plus récents ne sont pas les plus rapides ici.

Le temps ne vient plus des pixels mais du **nombre de lignes à reconnaître** —
quatre-vingt-six sur cette facture — et celui-là ne dépend d'aucun réglage.

**Le seul levier restant est du processeur dédié**, c'est-à-dire une autre
machine. Il n'est pas retenu : le dirigeant a tranché, et vingt-sept secondes
sur une pièce photographiée est un prix acceptable pour une lecture juste.

## Une réserve, à rouvrir quand le journal aura parlé

Le rattrapage PaddleOCR → modèle de vision **n'a jamais été observé utile**.
Sur `6a2d49aa`, la seule pièce où le contrat de PaddleOCR sort incomplet, le
modèle de vision fait pire — et le rattrapage coûte alors dix-neuf secondes
pour rien, portant l'attente à près d'une minute.

On le garde pour l'instant : une mesure sur une pièce ne suffit pas à retirer
un filet. Mais le journal des exécutions enregistre de nouveau depuis le
14 octobre ; dans quelques semaines, il dira combien de fois ce rattrapage a
été déclenché et combien de fois il a servi. S'il n'a jamais servi, il doit
partir — c'est dix-neuf secondes rendues aux pièces les plus difficiles.

## Ce qui n'a pas été essayé, et pourquoi

**PP-StructureV3** — l'analyse de tableaux de PaddleOCR — pourrait structurer
le récapitulatif de TVA et rendre la désignation plus facile. Non essayé : la
désignation prend trois secondes. Il n'y a plus rien à y gagner.

C'est la vraie conclusion de ces mesures : la question posée portait sur une
étape qui n'était plus le problème.
