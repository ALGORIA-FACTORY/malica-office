# Lecture, base de correction, archive couleur — note de conception

5 octobre 2026. Une page, avant le prototype sur onze factures réelles.

Les chiffres marqués **(relevé)** viennent de `agents.agent_runs` sur le
staging. Ceux marqués **(projeté)** sont des calculs à vérifier sur le
prototype : ils décident de l'architecture, donc ils ne doivent pas rester des
estimations longtemps.

---

## Ce que coûte la lecture aujourd'hui — et le vrai problème

|             | modèle              | jetons entrée → sortie | latence       | coût/appel   |
| ----------- | ------------------- | ---------------------- | ------------- | ------------ |
| Désignation | `deepseek-reasoner` | 5 256 → **9 022**      | **36 472 ms** | **0,0182 $** |

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

### Ce qui a été fait le jour même, et mesuré

La désignation a quitté le raisonneur pour **`deepseek-chat`**, après mesure sur
la facture réelle — trois passages par modèle,
`tests/real/designation-cout.ts` :

|                     | champs justes | valeurs fausses | silencieuses | sortie  | coût/appel   |
| ------------------- | ------------- | --------------- | ------------ | ------- | ------------ |
| `deepseek-reasoner` | 27/28         | 0               | 0            | 3 792 j | 0,0097 $     |
| `deepseek-chat`     | 23–25/28      | 1               | **1**        | 414 j   | **0,0020 $** |

**(relevé)**, prompt mis en cache côté fournisseur — donc les latences de ce
banc ne valent rien, seuls les jetons et le coût comptent.

La seule valeur fausse du chat était un `document_kind` lu « vente » sur un
achat. **Aucune arithmétique ne rattrape un sens faux**, et les matricules
s'inversent avec lui, si bien que le contrôle `destinataire` — qui ne regarde
qu'UNE partie — conclut « conforme ». La pièce serait partie en vente dans les
comptes du client.

On n'a donc pas basculé pour économiser : on a d'abord posé le contrôle
**`sens_de_la_piece`**, qui confronte le sens lu au NOM de l'émetteur. Une
vente émise par un tiers est une contradiction, et elle se voit sans modèle,
sans référentiel et sans arithmétique.

### Le modèle visé

|             | modèle              | tarif entrée / sortie  |
| ----------- | ------------------- | ---------------------- |
| hier        | `deepseek-reasoner` | 0,56 / 1,68 $ par Mtok |
| aujourd'hui | `deepseek-chat`     | 0,27 / 1,10 $ par Mtok |
| visé        | **`qwen3.8-flash`** | à relever              |

**`qwen3-vl-flash` est écarté : il est retiré le 10 octobre 2026.** Sont
également écartés `qwen3-vl-plus`, `qwen-vl-max` et `qwen-vl-plus`. La cible est
`qwen3.8-flash`, et pour le second témoin **PaddleOCR PP-OCRv6** si disponible,
sinon v5. _(Décision du commanditaire, note de projet
« decisions-paddleocr-modeles-alibaba-infra-2026-10-05 » — que je n'ai pas eue
sous les yeux : je l'applique sur son énoncé.)_

Son tarif n'est pas encore en base, donc son coût par pièce reste à mesurer, et
la bascule passera par une migration (R8 : le modèle vient de la table qui le
tarife).

---

## A. La lecture en six étapes

**0 · Capture.** Déclenchement automatique sur netteté, quatre coins détectés,
rafale de trois avec sélection de la plus nette. _Aujourd'hui : un tap, une
photo._

**1 · Deux témoins littéraux, en parallèle.** `qwen-vl-ocr` et PaddleOCR
**PP-OCRv6** si disponible, sinon v5 (processeur, sur notre serveur). Fusion en un plan de lecture, et
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

**2 · Compréhension.** `qwen3.8-flash` voit l'image **et** le plan, et rend
les champs d'`extract.v1` en citant les jetons. R2 est tenue autrement
qu'aujourd'hui : le modèle voit la pièce, mais il ne transcrit toujours aucune
valeur — il désigne, et la valeur est relue dans le plan. Qu'il voie l'image
est ce qui lui permet de ne plus se tromper de colonne.

**3 · Solveur « lecture prouvée ».** Candidats des deux témoins, plus les
confusions d'OCR connues (3/8, 1/7, 5/6, virgule/point). Contraintes : les
équations de la facture, les paramètres fiscaux **datés à la date de la pièce**,
le montant en toutes lettres (fr et ar), le format du matricule. Une seule
solution survit, ou on pose une question.

_Acquis ce matin_ : le solveur vérifie désormais TOUJOURS ses contraintes et
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

| couche                       | contenu                                                                                | où                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1 · Règles fiscales          | taux, droits, seuils, échéances — **chacune citant son article**                       | `ref.fiscal_parameters`                                |
| 2 · Référentiel métier       | plan comptable, dossiers, mots-clés de nature → compte, mentions obligatoires          | `ref.accounts`, `ref.account_mappings`, `ref.mentions` |
| 3 · Mémoire fournisseurs     | matricule, noms fr/ar, repères de mise en page, taux habituel, retenue, compte         | nouvelle, **collective**                               |
| 4 · Dictionnaires de lecture | mois fr/ar, chiffres arabes, nombres en lettres, confusions d'OCR, format du matricule | nouvelle                                               |

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
fournisseurs _collective_ fait traverser une frontière de tenant à une donnée.
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
couche de texte invisible. _Acquis le 4 octobre : la couleur est conservée (le
gain est appliqué par pixel), budget porté à 340 Ko._

**Niveau 2.** Compression MRC : fond couleur basse résolution, calque texte
haute résolution **sans perte** (CCITT G4, ou JBIG2 génériquement sans perte).

> **Interdit, et ce n'est pas une précaution de principe** : JBIG2 avec
> substitution de motifs. En 2013, des photocopieurs Xerox ont silencieusement
> remplacé des chiffres par d'autres chiffres visuellement proches — sur des
> plans de construction. Sur une pièce comptable conservée dix ans, c'est la
> faute la plus grave qu'une archive puisse commettre : elle est invisible,
> elle est plausible, et elle est irréversible.

**Stockage : Google Cloud Storage**, projet `malica-office-algoria`, région
`europe-west1`. Cycle de vie Standard → Nearline (30 j) → Coldline (90 j) →
Archive (365 j), verrou de conservation de 10 ans, et une copie de sécurité
séparée. _Hetzner reste la production en attendant ; rien n'est créé sur Google
Cloud avant votre accord sur ce qui suit._

### Le plan chiffré — et il renverse la conclusion

Tarifs `europe-west1` : Standard 0,020 · Nearline 0,010 · Coldline 0,004 ·
Archive 0,0012 $ par Go et par mois. Pour 1 000 PME × 100 pages/mois :

|                         | stock à 10 ans | **cumul sur 10 ans** | facture du 120ᵉ mois |
| ----------------------- | -------------- | -------------------- | -------------------- |
| Niveau 1 (~250 Ko/page) | 3 000 Go       | **398 $**            | 5,14 $               |
| Niveau 2 (~125 Ko/page) | 1 500 Go       | **199 $**            | 2,57 $               |

Copie de sécurité séparée, 3 000 Go : **3,60 $/mois** en Archive sur une
seconde région, contre 12,00 $/mois sur une Storage Box Hetzner.

**Ce que ces nombres disent, et ce n'est pas ce qu'on attendait : l'archive
n'est pas un problème de coût.** Quatre cents dollars sur dix ans pour mille PME,
soit **quarante cents par PME et par an**. La compression MRC du niveau 2
économiserait 199 $ _sur dix ans_ — vingt dollars l'an.

Or le niveau 2 porte un risque sérieux : c'est la famille de compression où
l'affaire Xerox s'est produite, et un calque mal réglé altère des chiffres de
façon invisible et irréversible. **Vingt dollars par an ne paient pas ce
risque.** Si le niveau 2 se justifie, ce sera pour la bande passante et le
temps de chargement sur un téléphone — pas pour le stockage. Je recommande de
le remettre après le pilote, et de mesurer d'abord le poids réel sur les onze
factures.

### Deux réserves avant de créer quoi que ce soit

**1. Le verrou de conservation de 10 ans empêche la purge que le produit
promet.** Un `retention lock` GCS rend un objet indestructible avant son
échéance — par nous aussi. Or le dépôt porte `db/pilote/purger-pieces.mjs`,
« purge des fichiers sur demande écrite », dont je me suis servi ce matin même.
Avec le verrou, cette demande deviendrait impossible à honorer, et une demande
d'effacement de données personnelles avec elle. Les deux exigences sont
contradictoires : il faut trancher laquelle prime, ou distinguer deux
compartiments — les pièces comptables sous verrou, le reste non.

**2. Le coût réel n'est pas le stockage, c'est la RELECTURE.** Archive facture
0,05 $ par Go restitué, avec 365 jours de durée minimale. Un cabinet qui
reparcourt les pièces d'un exercice clos déclenche des frais de restitution et
de sortie qui dépassent vite les quelques dollars de stockage. Il faut donc
savoir à quelle fréquence une pièce de plus d'un an est relue — je ne le sais
pas, et aucune mesure du produit ne le dit aujourd'hui. À instrumenter avant de
poser le cycle de vie, sans quoi on optimise 400 $ et on en dépense 4 000.

**Crédits ou argent réel** : je ne connais pas l'état de vos crédits Google
Cloud. Les montants ci-dessus sont en argent réel, hors crédits — dites-moi ce
qu'ils couvrent et sur quelle durée, et je referai le calcul.

## Ce qui bloque le prototype

Le prototype demandé porte sur **la facture de loyer et dix factures du jeu
d'or**. Je n'ai qu'une pièce : la facture de loyer, dont le plan de jetons réel
(177 jetons) est au banc depuis ce matin. **Les dix autres n'existent pas
encore.**

Ce qu'il me faut, et qui ne demande aucune manipulation technique : les
photographier avec l'application. Je relève moi-même ce que la machine a lu, et
l'expert-comptable valide les montants attendus.

Trois autres dépendances, à décider :

1. **PaddleOCR PP-OCRv6** (sinon v5) demande un service sur le serveur
   (processeur). Le staging est une CX23 : 2 vCPU et 3,8 Go partagés avec
   PostgreSQL, l'API, le site et les sauvegardes. Un OCR sur processeur à côté
   de cela ne tiendra pas. Le second témoin demande donc une machine, ou un
   report.
2. **`qwen3.8-flash`** n'a pas de ligne de tarif en base. R8 veut que le modèle
   vienne de la table qui le tarife : la bascule passe par une migration, pas
   par un déploiement.
3. **Le verrou de conservation de 10 ans contre la purge sur demande** : les
   deux exigences se contredisent, et il faut trancher avant de créer le seau.

---

## Ce que je recommande, dans cet ordre

1. ~~Le recollage à l'OCR~~ **fait** (prototype non branché, 21 cas), et il a
   trouvé qu'un numéro de téléphone a la même forme qu'un montant tunisien.
2. ~~Sortir du raisonneur~~ **fait** : `deepseek-chat`, après mesure, et avec le
   contrôle `sens_de_la_piece` posé AVANT la bascule parce que la mesure avait
   montré une erreur de sens silencieuse.
3. **Les onze factures**, dès que vous les aurez photographiées. C'est le
   bloquant principal : tout se mesure aujourd'hui sur une pièce, et une pièce
   ne prouve pas un taux de 98 %.
4. **Instrumenter la fréquence de relecture** d'une pièce de plus d'un an. Sans
   ce chiffre, poser un cycle de vie Archive revient à optimiser 400 $ de
   stockage en risquant 4 000 $ de restitution.
5. **`qwen3.8-flash`** : relever son tarif, le mettre en base, puis le mesurer
   contre `deepseek-chat` sur les onze factures.
6. **Le second témoin et le niveau 2 d'archive**, qui demandent tous deux une
   décision d'infrastructure — et le niveau 2 n'est plus justifié par le coût.
