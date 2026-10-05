# Lecture, base de correction, archive couleur — note de conception

5 octobre 2026. Une page, avant le prototype sur onze factures réelles.

Les chiffres marqués **(relevé)** viennent de `agents.agent_runs` sur le
staging. Ceux marqués **(projeté)** sont des calculs à vérifier sur le
prototype : ils décident de l'architecture, donc ils ne doivent pas rester des
estimations longtemps.

---

## Ce que coûte la lecture aujourd'hui — et le vrai problème

| | modèle | jetons entrée → sortie | latence | coût/appel |
|---|---|---|---|---|
| Désignation | `deepseek-reasoner` | 5 256 → **9 022** | **36 472 ms** | **0,0182 $** |

**(relevé)**, sur 4 appels. Le raisonneur produit neuf mille jetons de
raisonnement pour rendre une vingtaine de `page/ordinal`. C'est quatre fois le
budget visé (0,0047 $) et trente-six secondes d'attente pour la personne qui
tient son téléphone.

Le relevé de l'œil, lui, **n'apparaît pas au journal** : zéro ligne
`malica.lecture.releve`, alors que le tarif de `qwen-vl-ocr-2025-11-20` est
en base depuis le 4 octobre et que le nom du modèle configuré correspond
exactement. Le coût de l'œil n'est donc pas mesuré — à instruire à la
prochaine lecture réelle (dette ouverte).

**Conclusion** : remplacer le raisonneur par Qwen3-VL n'est pas une
optimisation, c'est la correction du poste de coût ET de latence dominant.

| | modèle | tarif entrée / sortie |
|---|---|---|
| aujourd'hui | `deepseek-reasoner` | 0,56 / 1,68 $ par Mtok |
| visé | `qwen3-vl-flash` | **0,05 / 0,40** $ par Mtok |

Soit onze fois moins cher en entrée, quatre fois en sortie — et surtout plus
aucun jeton de raisonnement. **(projeté)** : ~0,0007 $ pour la compréhension,
~0,0004 $ pour l'œil, **~0,0011 $ par pièce**, sous le budget visé, avec une
latence de quelques secondes au lieu de trente-six.

---

## A. La lecture en six étapes

**0 · Capture.** Déclenchement automatique sur netteté, quatre coins détectés,
rafale de trois avec sélection de la plus nette. *Aujourd'hui : un tap, une
photo.*

**1 · Deux témoins littéraux, en parallèle.** `qwen-vl-ocr` et PaddleOCR
PP-OCRv5 (processeur, sur notre serveur). Fusion en un plan de lecture, et
**recollage des nombres coupés par l'espace des milliers dès l'OCR** — même
ligne, écart horizontal faible.

> C'est le point le plus important de toute la note. Le 4 octobre,
> « 2 800,000 » a été lu `2,000` parce que le plan le découpe en deux jetons et
> que la consigne interdisait d'en citer deux. L'interdiction est levée depuis
> ce matin et le vrai modèle rend désormais la plage — mais la garantie repose
> sur l'obéissance d'un modèle. Recoller au niveau de l'OCR la rend
> **structurelle** : le montant n'est plus jamais coupé, donc plus jamais
> citable à moitié.

Un second témoin a un autre effet, moins évident et plus précieux : deux
lectures qui divergent sur un chiffre désignent la zone à relire. C'est une
mesure de doute qui ne vient pas d'un modèle.

**2 · Compréhension.** `qwen3-vl-flash` voit l'image **et** le plan, et rend
les champs d'`extract.v1` en citant les jetons. R2 est tenue autrement
qu'aujourd'hui : le modèle voit la pièce, mais il ne transcrit toujours aucune
valeur — il désigne, et la valeur est relue dans le plan. Qu'il voie l'image
est ce qui lui permet de ne plus se tromper de colonne.

**3 · Solveur « lecture prouvée ».** Candidats des deux témoins, plus les
confusions d'OCR connues (3/8, 1/7, 5/6, virgule/point). Contraintes : les
équations de la facture, les paramètres fiscaux **datés à la date de la pièce**,
le montant en toutes lettres (fr et ar), le format du matricule. Une seule
solution survit, ou on pose une question.

*Acquis ce matin* : le solveur vérifie désormais TOUJOURS ses contraintes et
nomme celle qui tombe, avec les deux nombres. Il sortait auparavant sans rien
regarder dès qu'aucun champ n'était ambigu — et un montant tronqué n'est pas
ambigu.

**4 · Relecture en gros plan.** Les zones où les témoins divergent sont
redécoupées et relues par `qwen-vl-ocr` seul. Coût marginal, gain direct sur le
seul cas qui reste.

**5 · Décision.** Trois sorties, jamais deux : **prouvé** (avec certificat de
lecture : qui a lu, avec quel modèle, quelles contraintes ont bouclé), **une
question ciblée en un tap** avec la zone découpée sous les yeux, ou **facture
incohérente signalée**.

**6 · Apprentissage.** Mémoire fournisseur, corrections versées au jeu d'or,
puis entraînement mensuel d'un Qwen-VL sur Model Studio.

**À mesurer sur le prototype** : champs justes, **erreurs silencieuses (cible
zéro)**, latence, coût par pièce. L'erreur silencieuse est la seule métrique
qui compte vraiment : c'est celle qui a coûté le 4 octobre.

---

## B. La base de correction — quatre couches, datées et sourcées

| couche | contenu | où |
|---|---|---|
| 1 · Règles fiscales | taux, droits, seuils, échéances — **chacune citant son article** | `ref.fiscal_parameters` |
| 2 · Référentiel métier | plan comptable, dossiers, mots-clés de nature → compte, mentions obligatoires | `ref.accounts`, `ref.account_mappings`, `ref.mentions` |
| 3 · Mémoire fournisseurs | matricule, noms fr/ar, repères de mise en page, taux habituel, retenue, compte | nouvelle, **collective** |
| 4 · Dictionnaires de lecture | mois fr/ar, chiffres arabes, nombres en lettres, confusions d'OCR, format du matricule | nouvelle |

Les couches 1 et 2 ne sont modifiables que par ALGORIA et l'expert-comptable
partenaire, avec historique. Les couches 3 et 4 s'enrichissent des corrections.

Deux pierres sont déjà posées ce matin, et elles valident le principe : le
**format du matricule** vit dans `ref.identifiant_formats` (daté, par
juridiction, avec son exemple et sa référence légale) au lieu d'être une
expression régulière en TypeScript ; et les **mois en toutes lettres**, fr et
ar, les deux séries arabes comprises, sont lus. La couche 4 est donc commencée —
mais les mois vivent encore dans le code, et devront descendre en base comme le
format l'a fait.

**Réserve de conception, à trancher avant d'écrire la couche 3.** Une mémoire
fournisseurs *collective* fait traverser une frontière de tenant à une donnée.
Elle ne doit porter que ce qui est **public par nature** — matricule, raison
sociale, mise en page d'une facture type — et jamais un montant, une habitude
d'achat ou un volume. R6 porte l'isolation par la base : une table partagée est
une exception qui doit être nommée, motivée et bornée par sa politique, pas une
table de plus.

---

## C. L'archive couleur

**Une seule copie**, PDF/A couleur, hors base, dédoublonnée par SHA-256. La
photo maître est supprimée après lecture ; le plan de jetons, compressé, vit à
côté du PDF.

**Niveau 1.** JPEG via mozjpeg, côté long 1 800–2 000 px, budget ~250 Ko/page,
couche de texte invisible. *Acquis le 4 octobre : la couleur est conservée (le
gain est appliqué par pixel), budget porté à 340 Ko.*

**Niveau 2.** Compression MRC : fond couleur basse résolution, calque texte
haute résolution **sans perte** (CCITT G4, ou JBIG2 génériquement sans perte).

> **Interdit, et ce n'est pas une précaution de principe** : JBIG2 avec
> substitution de motifs. En 2013, des photocopieurs Xerox ont silencieusement
> remplacé des chiffres par d'autres chiffres visuellement proches — sur des
> plans de construction. Sur une pièce comptable conservée dix ans, c'est la
> faute la plus grave qu'une archive puisse commettre : elle est invisible,
> elle est plausible, et elle est irréversible.

**Stockage.** Hetzner Object Storage 24 mois, puis Storage Box ; copie chiffrée
restic ; audit d'intégrité annuel par empreinte.

**Ordre de grandeur** pour 1 000 PME × 100 pages/mois :

| | par mois | sur 1 an (cumul) | sur 10 ans (cumul) |
|---|---|---|---|
| Niveau 1 (~250 Ko) | 25 Go | 300 Go | 3,0 To |
| Niveau 2 (~125 Ko) | 12,5 Go | 150 Go | 1,5 To |

**(projeté)**, à confirmer par le poids réel mesuré sur les onze factures du
prototype. Le chiffre à dix ans est celui qui décide : une rétention légale de
dix ans sans palier froid rend le niveau 2 obligatoire, pas optionnel.

---

## Ce qui bloque le prototype

Le prototype demandé porte sur **la facture de loyer et dix factures du jeu
d'or**. Je n'ai qu'une pièce : la facture de loyer, dont le plan de jetons réel
(177 jetons) est au banc depuis ce matin. **Les dix autres n'existent pas
encore.**

Ce qu'il me faut, et qui ne demande aucune manipulation technique : les
photographier avec l'application. Je relève moi-même ce que la machine a lu, et
l'expert-comptable valide les montants attendus.

Deux autres dépendances, à décider :

1. **PaddleOCR PP-OCRv5** demande un service sur le serveur (processeur). Le
   staging est une CX23 : 2 vCPU et 3,8 Go partagés avec PostgreSQL, l'API, le
   site et les sauvegardes. Un OCR sur processeur à côté de cela ne tiendra pas.
   Le second témoin demande donc une machine, ou un report.
2. **Qwen3-VL** n'a pas de ligne de tarif en base. R8 veut que le modèle vienne
   de la table qui le tarife : la bascule passe par une migration, pas par un
   déploiement.

---

## Ce que je recommande, dans cet ordre

1. **Le recollage à l'OCR** (étape 1), sur le plan réel que j'ai déjà. C'est la
   garantie structurelle contre le défaut du 4 octobre, et elle ne dépend
   d'aucun modèle ni d'aucune machine. Prototypable aujourd'hui.
2. **Qwen3-VL à la place du raisonneur** (étape 2). Un tarif en migration, une
   bascule, et la mesure côte à côte sur la facture de loyer : coût, latence, et
   surtout si la désignation reste juste.
3. **Les onze factures**, dès que vous les avez photographiées. Sans elles, tout
   le reste se mesure sur une pièce, et une pièce ne prouve pas un taux de 98 %.
4. **Le second témoin et l'archive niveau 2**, qui demandent tous deux une
   décision d'infrastructure.
