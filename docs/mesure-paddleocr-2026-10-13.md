# PaddleOCR mesuré sur une vraie facture — 13 octobre 2026

Ce document n'argumente pas : il rapporte une mesure, sur une pièce réelle,
avec les chiffres bruts. Il existe parce que la question « PaddleOCR
lirait-il mieux ? » ne se tranche pas en lisant de la documentation.

## La question

Le 13 octobre 2026, la pièce `6a2d49aa` — une facture d'achat tunisienne,
scannée en PDF — ne produisait aucune écriture comptable. Le plan de jetons
de la chaîne actuelle (couche texte puis Qwen) disait pourquoi :

```
158 | 3     159 | 561,300     ← Total HT, lu juste
162 | 4     163 | 134,183     ← Total TTC, lisible
169 | +     170 | 135,183     ← NET À PAYER, le « 4 » perdu
```

La ligne « NET À PAYER » est imprimée en blanc sur bande noire. Le « 4 »
y a été reconnu « + ». Le total recollé donnait « + 135,183 », illisible.

Par ailleurs, l'extraction ne portait **aucune base par taux** : le
récapitulatif de la TVA (7 % et 19 %) n'avait pas été relevé.

## Le protocole

Conteneur jetable sur le staging, le 13 octobre 2026 :

- image `python:3.11-slim`, `paddleocr 3.7.0`, `paddlepaddle 3.3.1` ;
- modèles `PP-OCRv5_mobile_det` + `latin_PP-OCRv5_mobile_rec` ;
- `enable_mkldnn=False`, redressement et classification d'orientation
  désactivés ;
- page 1 rendue par `pypdfium2` à 200 dpi, soit 1275 × 1800 pixels ;
- `--memory=1800m`, `--cpus=1.5`.

La pièce est celle du dirigeant, prise telle quelle dans le stockage du
staging. Rien n'a été recadré, redressé ni retouché.

## Ce qui a été lu

Le bloc des totaux, avec la confiance rendue par le modèle :

```
[0.97] Récapitulatif de la TVA
[1.00] Taux          [0.99] Base HT      [1.00] TVA
[0.99] 7 %           [0.97] 864,700      [1.00] 60,529
[1.00] 19 %          [0.97] 2 696,600    [0.97] 512,354
[1.00] Total HT      [0.97] 3 561,300
[0.93] TVA 7 %       [1.00] 60,529
[1.00] TVA 19 %      [1.00] 512.354
[0.95] Total TTC     [0.99] 4 134,183
[1.00] Timbre fiscal [1.00] 1,000
[1.00] NET À PAYER (DT)                  [1.00] 4 135,183
```

**Les deux défauts tombent.**

1. `4 135,183` est lu **entier**, avec une confiance de 1,00, là où la
   chaîne actuelle rendait `+ 135,183`. Le texte blanc sur bande noire ne
   l'a pas gêné.
2. Les **bases par taux** — 864,700 à 7 % et 2 696,600 à 19 % — sont
   relevées, avec leurs TVA. C'est précisément ce que l'extraction
   actuelle laissait vide, et ce qui faisait conclure « aucune base par
   taux n'a été lue ».

Une seule réserve, sans conséquence ici : la ligne 98 rend `512.354` avec
un point là où la facture imprime une virgule. La normalisation du Socle
traite les deux conventions, et la même valeur est rendue correctement
deux lignes plus haut.

## Ce que ça coûte

| | |
|---|---|
| Rendu de la page (200 dpi) | 0,3 s |
| Chargement des modèles | 9,5 s |
| **Reconnaissance** | **48,6 s** |
| Lignes rendues | 84 |

Sur 1,5 vCPU partagé. C'est **lent** : trop lent pour la lecture courante
d'une pièce que quelqu'un attend, téléphone en main.

### Et la mémoire a mordu

Première tentative, avec les modèles **medium** (`PP-OCRv6_medium`) :
tuée par le noyau à **1,81 Go** de mémoire résidente, limite du conteneur
atteinte.

```
Memory cgroup out of memory: Killed process (python)
total-vm:4201164kB, anon-rss:1809708kB
```

La limite `--memory=1800m` a fait exactement son travail : **le conteneur
est mort, pas la base de données**. C'est la disposition à conserver si ce
service entre en production. Les modèles `mobile` tiennent, eux, dans la
même limite.

Le staging est une CX23 : 2 vCPU partagés, 4 Go, dont ~2 Go libres une
fois Postgres (`shared_buffers=1GB`), l'API, le site, Caddy et la
sauvegarde servis. **Un service PaddleOCR n'y tient pas sans risque.**

## Ce que cette mesure établit, et ce qu'elle n'établit pas

**Établi :** sur cette facture, PaddleOCR lit ce que la chaîne actuelle ne
lit pas, et il le lit bien. La question « est-ce que ça sert à quelque
chose » est tranchée par l'affirmative.

**Non établi :**

- ce qu'il donne sur les **autres** pièces — notamment celles que la
  chaîne actuelle lit déjà correctement. Une amélioration sur un cas ne
  dit rien des régressions sur les autres : il faut rejouer le jeu d'or
  (`apps/api/src/malica/lecture/jeu-d-or.ts`), pièce par pièce, jeton par
  jeton ;
- l'**ordre de lecture en arabe**, que rien ici n'exerce ;
- le comportement sur une **photo prise de travers**, alors que la pièce
  mesurée est un scan droit ;
- si les **48 secondes** tiennent sur une machine dédiée, ou si elles
  s'effondrent.

## Ce qui en découle

Le rôle à lui donner est celui d'un **second lecteur, appelé en
rattrapage** — jamais un remplacement. Trois raisons, dans l'ordre de
force :

1. Une couche texte de PDF natif est **exacte** ; la remplacer par un OCR
   serait remplacer de l'exact par de l'approché.
2. Les 48 secondes sont inacceptables sur le cas courant, et parfaitement
   acceptables sur une pièce qui, autrement, ne donne rien du tout.
3. Le déclencheur existe déjà et il est **prouvé, pas deviné** : une
   lecture dont l'arithmétique ne boucle pas, ou dont le contrat sort
   `extract.v1.partiel`. On ne suppose pas qu'une lecture est douteuse —
   la facture le démontre.

Et il faudra, avant d'écrire la moindre ligne de production : une machine
plus grande (CX33, ~+3 €/mois), une image **épinglée par empreinte** avec
les poids embarqués (R8 : un conteneur qui se met à jour seul change le
relevé sans qu'une ligne de code bouge), une ligne de tarif dans
`agents.model_pricing` avec un `valid_from` littéral (R11), et une limite
mémoire explicite sur le conteneur.

## Reproduire

Le conteneur de mesure a été retiré du serveur, sans résidu. Pour
refaire la mesure : rendre la page à 200 dpi, puis

```python
from paddleocr import PaddleOCR
ocr = PaddleOCR(lang="fr",
                text_detection_model_name="PP-OCRv5_mobile_det",
                text_recognition_model_name="latin_PP-OCRv5_mobile_rec",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                enable_mkldnn=False)
res = ocr.predict("page1.png")
```

`enable_mkldnn=False` n'est pas un détail : avec l'accélérateur activé,
`paddle 3.3.1` échoue sur
`ConvertPirAttribute2RuntimeAttribute not support`.

---

# La mesure sur TOUTES les pièces réelles — 13 octobre 2026, le soir

La première mesure portait sur une facture. Celle-ci porte sur les **treize
pièces** du staging, prises telles quelles : factures d'achat et de vente,
reçus produits par Malica, photos de justificatifs.

Même protocole, même conteneur borné à 1,8 Go et 1,5 vCPU, mêmes modèles
`PP-OCRv5_mobile`. Treize pièces lues, de 5 à 45 secondes chacune.

## La méthode de comparaison, et sa première version fausse

Pour chaque pièce, on compare l'ensemble des **montants** trouvés par la
chaîne actuelle (le plan de jetons en base) et par PaddleOCR.

Un premier comparateur cherchait les montants par une expression régulière
qui autorisait les espaces — pour attraper les milliers coupés. Elle
franchissait les espaces entre DEUX nombres voisins et collait « 13 » et
« 1969.610 » en « 131969.610 », inventant des écarts des deux côtés. Elle
annonçait 52 contre 4 ; elle mesurait surtout son propre défaut.

Le comparateur retenu lit **jeton par jeton**, comme la chaîne réelle, et ne
recolle que le motif précis qu'on cherche à mesurer : un groupe de un à trois
chiffres suivi d'un groupe de trois avec décimales.

## Le résultat

| | |
|---|---|
| Pièces comparées | 12 (la treizième n'a pas de plan de jetons) |
| Montants trouvés **par PaddleOCR seul** | **20** |
| Montants trouvés **par la chaîne actuelle seule** | **4** |

Le détail des quatre, parce que c'est la seule partie qui peut coûter cher :

- `bfb52a45` — **deux vraies pertes**, « 3,897 » et « 12,360 », sur une
  facture de câblerie aux montants faibles et serrés. PaddleOCR n'a pas lu
  ces deux lignes-là ;
- `53144e64` et `6a2d49aa` — les deux autres ne sont pas des pertes : ce sont
  des recollages de milliers que les deux lectures écrivent différemment.

Et le cas qui a tout déclenché reste tranché : sur `6a2d49aa`, la chaîne
actuelle relève **1** montant, PaddleOCR en relève **24**.

## Ce que ça décide, et ce que ça ne décide pas

**Décidé** : le rôle de second lecteur en rattrapage est justifié par la
mesure, pas par la réputation. Cinq montants gagnés pour un perdu, sur des
pièces réelles, dont le défaut précis qui bloquait une écriture comptable.

**Non décidé** : PaddleOCR n'est pas meilleur partout — `bfb52a45` le
montre. Un remplacement reste exclu, et le déclencheur arithmétique garde
tout son sens : on n'appelle le second lecteur que là où le premier a échoué,
et on garde la lecture dont la facture boucle.

**Toujours en attente** : la machine. Au 13 octobre au soir, la CX23 est
revenue en stock à Nuremberg mais la **CX33 reste indisponible** dans les
trois centres européens. Le stock se reconstitue ; rien ne presse, puisque
la mesure est faite et qu'elle ne demandait aucune machine neuve.
