# Lire dans toutes les langues — quatre voies, chiffrées, et celle qu'on prend

Étude du 18 octobre 2026, sur la branche `integration/abonnement-et-tour-de-controle`.

Le dirigeant pose une question nette : **peut-on porter la lecture au niveau d'un
modèle Claude, dans toutes les langues ?**

La réponse courte, et le reste du document l'établit : **oui comme producteur de
jetons, non comme premier lecteur** — et ce n'est pas la voie qui ouvre l'arabe le
moins cher. Le manque d'arabe se ferme pour huit mégaoctets et zéro dollar au
jeton, dans le lecteur qu'on a déjà.

Ce document ne remplace pas `docs/decision-lecteur-et-vitesse-2026-10-15.md` : il
rouvre une seule de ses lignes — « ce qui n'a pas été essayé » — et il garde sa
décision sur l'ordre des lecteurs.

---

## Ce qui est mesuré ici, et ce qui ne l'est pas

Cette distinction commande la lecture du reste. Une étude dont chaque ligne est
marquée vaut dix fois une étude confiante.

**Mesuré par exécution, dans cette session :**

- l'existence du modèle de reconnaissance arabe dans le PaddleOCR **installé** (§ 1) ;
- la mémoire réellement disponible au conteneur OCR de la recette, et son
  occupation au repos (§ 1) ;
- la taille sur disque des modèles déjà chargés (§ 1) ;
- la résolution à laquelle les pages d'un PDF scanné entrent dans la chaîne (§ 2.3).

**Lu, et nommé comme tel :**

- le contrat de coordonnées des modèles Claude, leur tarif et leurs identifiants —
  lus dans la documentation d'Anthropic le 18 octobre 2026, pas éprouvés (§ 2) ;
- les chiffres de latence et de justesse du relevé actuel, repris du rapport du
  spécialiste OCR (`.superpowers/sdd/00-LISEZ-MOI/specialiste-ocr-report.md`,
  18 octobre) et du document de décision du 15 octobre.

**Ce que je n'ai PAS pu éprouver, et qu'il faut dire haut :**

1. **La justesse d'un relevé Claude sur une facture tunisienne bilingue.** Les
   pièces réelles vivent sur la recette ; les copier en atelier pour les soumettre
   à un modèle a été **refusé** (données personnelles), et c'est un refus que je
   n'ai pas cherché à contourner. J'ai construit une facture synthétique bilingue
   pour tenir un banc à géométrie connue ; la coque de rendu ne m'a pas donné une
   image lisible à la résolution voulue, et j'ai arrêté là plutôt que de rendre un
   chiffre fabriqué. **Aucun appel payant n'a donc été passé : dépense 0 $.**
2. **La mémoire de deux chaînes PaddleOCR chargées ensemble.** La seule façon de
   la mesurer était de charger un second modèle dans le conteneur du dirigeant,
   c'est-à-dire d'agir sur sa machine. Le § 1.3 dit donc ce qu'on sait, et borne
   le coût de se tromper au lieu de prétendre le savoir.
3. **La latence d'un relevé Claude.** Elle est dominée par les jetons de sortie,
   et je n'ai pas de débit mesuré pour ces modèles. Le § 2.4 donne le nombre de
   jetons — qui, lui, est ancré sur une mesure réelle — et laisse les secondes en
   blanc.

---

## 1. Un modèle de reconnaissance arabe pour PaddleOCR

### 1.1 Il existe, et il est déjà dans l'image déployée

C'est le fait qui décide de cette voie, et il n'était écrit nulle part. La
documentation publique de PaddleOCR que j'ai consultée ne liste **que** des
modèles multilingues PP-OCRv3 — elle ne connaît ni
`latin_PP-OCRv5_mobile_rec`, qui tourne pourtant en production chez nous, ni rien
d'arabe en v5. Elle est en retard sur le paquet.

Alors j'ai regardé dans le paquet. En lecture seule, sur la recette, dans le
conteneur `malica-ocr-1` (`paddleocr 3.7.0`) :

```
arabic_PP-OCRv3_mobile_rec
arabic_PP-OCRv5_mobile_rec      <-- il est là
cyrillic_PP-OCRv5_mobile_rec
devanagari_PP-OCRv5_mobile_rec
el_PP-OCRv5_mobile_rec
en_PP-OCRv5_mobile_rec
eslav_PP-OCRv5_mobile_rec
korean_PP-OCRv5_mobile_rec
latin_PP-OCRv5_mobile_rec
ta_PP-OCRv5_mobile_rec
te_PP-OCRv5_mobile_rec
th_PP-OCRv5_mobile_rec
```

**`arabic_PP-OCRv5_mobile_rec` est disponible, dans la version exacte qui tourne
aujourd'hui.** Aucune mise à jour d'image n'est nécessaire pour y accéder : une
variable d'environnement suffit, puisque `infra/ocr/service.py` lit déjà
`OCR_MODELE_RECONNAISSANCE` et `OCR_LANGUE`.

C'est aussi la première fois qu'on constate que la famille v5 couvre douze
écritures. Le grec, le cyrillique, le thaï et le tamoul sont du même coup à une
ligne de configuration — ce qui n'intéresse personne aujourd'hui, mais répond
« oui » à « et les autres langues ? » sans rien changer au moteur (R5).

### 1.2 Deux modèles chargés, ou deux passes ?

PaddleOCR 3.x construit **une chaîne complète par instance** : la détection et la
reconnaissance sont liées dans le même objet `PaddleOCR`. Il n'existe pas de
commutateur « change de reconnaisseur pour cette page ». Les deux formes possibles
sont donc :

| Forme | Ce qu'elle demande | Ce qu'elle coûte par pièce |
|---|---|---|
| **Deux instances** en mémoire, on choisit par page | un détecteur de langue par page — **qui n'existe pas dans le dépôt** | 26–32 s (une seule passe) |
| **Deux passes**, la seconde en arabe, et on fusionne les lignes | rien de nouveau à décider | **+26 à +32 s**, soit 52 à 64 s |

La première forme a l'air meilleure et elle ne l'est pas : pour choisir, il faut
déjà savoir quelle écriture porte la page, et le seul organe capable de le dire
est… un lecteur. Une facture tunisienne porte en outre **les deux écritures sur
la même page** — c'est le cas que le dirigeant a nommé —, si bien que « choisir »
n'a pas de sens : il faut les deux relevés, fusionnés.

Donc : **deux passes, et seulement là où la première a échoué.** C'est exactement
la place que `read-flow.ts` donne déjà au rattrapage, et elle a une propriété qui
vaut d'être dite : la seconde passe ne se paie que sur les pièces qui, sans elle,
ne donnent rien. Sur une pièce qui sort `extract.v1`, le coût est nul.

### 1.3 La mémoire, et le prix de se tromper

Mesuré sur la recette, en lecture seule :

| | |
|---|---|
| Plafond du conteneur `malica-ocr-1` | **2 GiB** (et non 1,8 Go : 1,8 Go est le **pic mesuré**, pas la borne) |
| Occupation au repos, modèles chargés | **231,9 MiB**, soit 11,3 % |
| `latin_PP-OCRv5_mobile_rec` sur disque | **8 Mo** |
| `PP-OCRv5_mobile_det` sur disque | **5 Mo** |
| Mémoire de l'hôte | 3 819 Mo au total, **2 441 Mo disponibles** |

Le modèle arabe pèse le même ordre que le latin : **huit mégaoctets sur disque ne
sont pas le sujet.** Le sujet est le pic d'inférence. Une chaîne au repos coûte
232 MiB ; le pic d'une chaîne en inférence a été mesuré à 1,8 Go le 13 octobre.
Il reste donc **environ 200 MiB de marge** sous le plafond, avec une seule
chaîne.

**Je n'ai pas mesuré deux chaînes**, et je refuse de l'affirmer. Mais le coût de
me tromper est borné, et c'est ce qui rend la voie prenable :

- la seconde chaîne se charge **paresseusement**, à la première page arabe, et pas
  au démarrage : le service reste sain pour tout le trafic actuel même si le
  chargement échoue ;
- les deux ne doivent **jamais** inférer en même temps — le service est déjà
  séquentiel par requête, et `OCR_FILS=2` borne les fils de Paddle, pas les
  chaînes ;
- si le conteneur est malgré tout tué, `paddle.ts` rend `null` sur un service
  injoignable, `releverDesPages` renonce, et **une lecture partielle reste une
  lecture partielle** — jamais une panne. Le filet est déjà écrit, et il a été
  écrit pour cette raison exacte.

Si la marge ne suffit pas, le recours est une ligne de `docker-compose` : le
plafond du conteneur à 3 GiB sur un hôte qui en a 2,4 de libre. C'est une décision
d'exploitation, pas d'architecture.

### 1.4 Ce qu'il faut écrire, et le piège qui s'y cache

Trois endroits, et le troisième est celui qu'on oublie :

1. `infra/ocr/service.py` — une seconde chaîne, chargée paresseusement, et un
   paramètre de requête qui dit laquelle employer. La réponse porte déjà le nom
   du modèle (`"modele": f"{DETECTION}+{RECONNAISSANCE}"`) : il suffit qu'il dise
   la vérité.
2. `apps/api/src/malica/lecture/paddle.ts` et `vision.ts` — passer l'écriture
   voulue, et fusionner deux relevés d'une même page. La fusion existe déjà pour
   les bandes (`fusionnerBandes`, pure et éprouvée) ; celle-ci n'est pas la même
   et demande sa propre épreuve.
3. **Une ligne de migration, sans quoi le relevé arabe se journalise en silence
   — c'est-à-dire pas du tout.** `agents.model_pricing` cherche un tarif par le
   couple (modèle, rôle). Le nom composite change :
   `PP-OCRv5_mobile_det+arabic_PP-OCRv5_mobile_rec` n'est **pas** celui que
   tarife `20261014090000`. Sans sa ligne, l'écriture du journal est refusée sans
   bruit, et on ne saura pas combien de pièces ont déclenché l'arabe — c'est très
   exactement le défaut D47, et le défaut du suffixe `+pdf-scan` du 15 octobre.
   Deux fois la même faute dans ce dépôt ; la troisième serait de notre faute à
   nous.

```sql
insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign, effective_from)
values
  ('interne', 'PP-OCRv5_mobile_det+arabic_PP-OCRv5_mobile_rec', 'vision',
   0, 0, 'EUR', true, date '2026-10-20')
on conflict do nothing;
```

`effective_from` en littéral (R11), prix nul au jeton comme les deux autres
lecteurs internes, et la devise explicite — son défaut a été retiré le 31 août.

---

## 2. Un modèle Claude comme relevé

C'est la question du dirigeant, et elle se décompose en quatre : **où**, **quelle
qualité**, **quel prix**, **quoi écrire**.

### 2.1 Où il peut entrer sans violer R2 — et l'endroit est précis

R2 pose deux choses, et il faut les séparer :

- **le désignateur ne voit jamais la pièce.** Un modèle Claude ne peut donc
  **jamais** prendre la place de `deepseek-chat` dans la passe 2, quelle que soit
  sa qualité. Cette frontière n'est pas négociable, et aucune des quatre voies ne
  la touche.
- **tout montant pointe vers le jeton qui le porte.** Le relevé, lui, est
  précisément l'organe qui fabrique ces jetons.

Un modèle Claude entre donc **en producteur de jetons, au même rang que
Qwen-VL-OCR**, et nulle part ailleurs. Techniquement, cela veut dire : un module
frère de `qwen.ts`, qui rend des `PageToken[]` par `decouperEnMots`, appelé depuis
`relever()` dans `vision.ts`. L'interface à remplir tient en une ligne :

```ts
(image, page) => { tokens: PageToken[]; model: string; tokensIn: number|null; tokensOut: number|null }
```

Il faut dire ce que cela ne garantit pas. Un modèle qui transcrit **peut**
halluciner un nombre qui n'est pas sur la page, et R2 ne l'arrête pas à ce
niveau-là : R2 garantit que la **valeur retenue** vient du plan de jetons, pas que
le plan soit fidèle. C'est déjà vrai de Qwen aujourd'hui — c'est le défaut du
13 octobre, « 4 135,183 » lu « + 135,183 ». Un relevé Claude n'aggrave donc pas la
garantie, mais il ne l'améliore pas non plus : il échange une famille d'erreurs
contre une autre. **PaddleOCR est le seul des trois lecteurs dont l'erreur reste
une erreur de caractère, parce qu'il ne génère pas de texte — il en reconnaît.**

### 2.2 La géométrie : ce qu'Anthropic promet, et ce qu'il ne promet pas

**Lu, pas éprouvé.** Anthropic documente les boîtes englobantes dans une page
dédiée, et nomme explicitement « les chaînes d'OCR, l'extraction de formulaires »
parmi les usages visés. Le contrat :

- les coordonnées sont **absolues, en pixels**, origine en haut à gauche ;
- il faut les **demander en pixels**, et la documentation dit que demander des
  coordonnées normalisées de 0 à 1000 ne marche pas bien — ce qui est exactement
  le repère que nous rend Qwen aujourd'hui, et exactement ce que
  `token-plan.ts` attend après division ;
- la précision est annoncée **approximative**. La page des limites dit que « les
  sorties de coordonnées et de localisation de Claude sont approximatives », et la
  page des coordonnées demande de vérifier à l'œil avant de passer à l'échelle.

Trois conséquences concrètes, et la troisième est un piège qui coûte cher :

1. **Les boîtes approximatives ne cassent pas R2, elles dégradent la
   désignation.** La valeur se relit dans le texte du jeton, pas dans sa boîte.
   Mais la passe 2 raisonne en lignes et en colonnes pour distinguer « base HT » de
   « TVA » dans un tableau : des boîtes molles rendent un récapitulatif de TVA
   ambigu. C'est le cœur du risque, et il est non mesuré.
2. **Les PDF passés en bloc `document` sont inutilisables ici.** Anthropic
   rasterise les pages côté serveur à des dimensions qu'on ne contrôle pas, et le
   dit : les coordonnées rendues « ne peuvent pas être remises en correspondance
   avec la page ». Il faut donc continuer à extraire l'image nous-mêmes, comme le
   fait déjà `pdf-image.ts`.
3. **Le redimensionnement silencieux déplace toutes les coordonnées.** L'API
   redimensionne toute image qui dépasse ses bornes (bord long, et un budget de
   jetons visuels de `⌈l/28⌉ × ⌈h/28⌉`) **avant** que le modèle ne la voie, et les
   coordonnées sont celles de l'image redimensionnée. Il faut soit pré-redimensionner
   nous-mêmes, soit remettre à l'échelle, et dans les deux cas connaître la règle
   exacte.

Sur ce troisième point, le dépôt a de la chance et un défaut. La chance :
`infra/ocr/service.py` borne déjà à 1 600 pixels, et une A4 à 1 131 × 1 600 tient
dans le palier haute résolution sans être redimensionnée (2 378 jetons visuels
contre 4 784 permis). Le défaut, **vérifié en lisant le code** : cette borne vit
dans le service Python, et `pdf-image.ts` rend l'image **embarquée du PDF, à sa
taille native**. Une photo de téléphone arrive donc à 2 000 ou 3 000 pixels, et
serait redimensionnée par l'API sans que rien ne le dise.

Il existe une parade, et elle est exactement dans la doctrine du dépôt : le champ
`transformations: { oversized_image: "error" }` sur le bloc image fait **refuser**
la requête au lieu de redimensionner en silence. C'est le corollaire de R4 —
« aucun repli implicite » — appliqué à une API tierce. Si un relevé Claude entre un
jour, ce champ entre avec lui, sans discussion.

### 2.3 Le prix, calculé

Les identifiants et les tarifs sont **lus** dans la documentation d'Anthropic,
le 18 octobre 2026. Ils changent ; la date compte.

| Modèle | Identifiant | Entrée $/Mjeton | Sortie $/Mjeton |
|---|---|---|---|
| Claude Haiku 5.5 | `claude-haiku-5-5` | 0,10 | 0,50 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2,00 | 10,00 |
| Claude Opus 5.5 | `claude-opus-5-5` | 4,00 | 20,00 |

Les jetons d'une image sont documentés : **un jeton par pavé de 28 × 28 pixels**,
soit `⌈largeur/28⌉ × ⌈hauteur/28⌉`. Pour une A4 bornée à 1 600 pixels de grand
côté — 1 131 × 1 600 — cela fait `41 × 58 = `**2 378 jetons visuels**, non
redimensionnés sur les modèles courants (palier haute résolution, 2 576 pixels de
bord et 4 784 jetons).

La sortie est le poste qui décide, et elle s'ancre sur une mesure réelle plutôt
que sur une intuition. Le rapport du spécialiste OCR donne, sur deux vraies
factures :

| Pièce | Jetons du plan | Jetons de sortie | Rapport |
|---|---|---|---|
| `6a2d49aa` | 235 | 3 152 | 13,4 |
| `53144e64` | 200 | 2 425 | 12,1 |

**Un jeton de plan coûte douze à treize jetons de sortie.** Le format JSON d'un
relevé Claude serait un peu plus bavard que celui de DashScope ; je compte
quinze, et une facture dense de 86 lignes / ~400 mots demande donc de l'ordre de
**3 500 à 6 000 jetons de sortie**. Je retiens 3 500 pour une facture de la taille
de celles mesurées.

Avec 2 378 jetons visuels + ~600 de consigne en entrée, et 3 500 en sortie :

| Lecteur | $/page (relevé seul) | Rapport au relevé actuel |
|---|---|---|
| **PaddleOCR** (aujourd'hui, 1er rang) | **0** au jeton (loyer Hetzner) | — |
| `qwen-vl-ocr-2025-11-20` (mesuré) | **0,00067** | ×1 |
| **Claude Haiku 5.5** | **≈ 0,0021** | ×3 |
| Claude Sonnet 5.5 | ≈ 0,041 | ×61 |
| Claude Opus 5.5 | ≈ 0,082 | ×122 |

Pour mémoire, la chaîne complète d'aujourd'hui coûte **≈ 0,0035 $ par pièce**
(relevé + désignation, mesuré). Haiku ajouterait 0,002 ; Sonnet multiplierait la
facture de lecture par douze ; Opus par vingt-quatre.

Et un détail qui n'en est pas un : **sur Opus 5.5 et Sonnet 5.5, le raisonnement
ne peut plus être coupé** — `thinking: {type:"disabled"}` est refusé par l'API.
Chaque relevé paierait donc des jetons de réflexion, en sortie, pour une tâche
qui est une transcription. **Haiku 5.5 l'accepte encore**, à effort `high` ou en
dessous. Pour un relevé, c'est l'argument qui tranche entre les trois, avant même
le prix.

### 2.4 La latence : non mesurée, et bornée par la sortie

Je n'ai pas de débit mesuré pour ces modèles, et je n'en invente pas. Ce que je
peux dire avec certitude : **le relevé est borné par les jetons de sortie**, pas
par l'image. Trois mille cinq cents jetons de sortie, c'est le même ordre que ce
que Qwen produit en 15,6 à 18,4 secondes. Haiku est le plus rapide des trois ;
Opus le plus lent, et il réfléchit en plus, par obligation.

**Le premier appel réel donnera ce chiffre**, et c'est la première chose à
mesurer si cette voie est prise.

### 2.5 Ce que Claude apporte vraiment, et ce n'est pas la langue

Il faut nommer le gain honnête, parce qu'il n'est pas celui qu'on attend :

**Le plafond de sortie.** La pièce `6ddc6804` a **échoué entièrement** avec Qwen
— « Qwen a tronqué le relevé (plafond de jetons atteint) » — et c'est pour cela
que `vision.ts` porte toute une stratégie de bandes (`decouperEnBandes`,
`BANDES_MAX`, jusqu'à quatre appels par page). Les modèles Claude courants
plafonnent à 128 000 jetons de sortie. **Ce mode de panne disparaît**, et avec
lui la raison d'être de la mécanique des bandes sur le chemin Claude.

Pour le reste : l'arabe, Qwen-VL-OCR le lit déjà — `qwen.ts` porte un commentaire
qui dit que l'ordre de lecture « a été vérifié correct sur une pièce en arabe ».
**Le trou d'arabe n'est pas au troisième rang, il est au premier**, et aucun
modèle Claude ne vient au premier rang (§ 3 de la recommandation).

### 2.6 Ce qu'il faudrait écrire

| Où | Quoi |
|---|---|
| `db/migrations/` | une ligne de tarif, `('anthropic','claude-haiku-5-5','vision',0.10,0.50,'USD',false, date '2026-10-20')` |
| `apps/api/src/malica/modeles.ts` | le nom, à côté de `modeleOcr()` — et la réserve ci-dessous |
| `apps/api/src/malica/lecture/claude.ts` *(nouveau)* | le client : image en base64, consigne demandant des **pixels**, `transformations: { oversized_image: "error" }`, sortie structurée, `thinking` coupé |
| le même fichier | le redimensionnement **avant** envoi, par la règle des pavés de 28 — sans quoi toutes les coordonnées glissent |
| `apps/api/src/malica/lecture/vision.ts` | une branche dans `relever()`, au rang du rattrapage |
| une épreuve | que les boîtes rendues soient dans la page et que la division par les dimensions **redimensionnées** — pas rembourrées — donne bien du 0..1 |

**Et une réserve que je ne sais pas lever.** `modeles.ts` explique longuement
pourquoi le millésime est figé : « `qwen-vl-ocr-2025-11-20`, jamais `-latest` : une
mise à jour silencieuse du modèle changerait le relevé sans qu'une ligne de code
bouge, et une pièce relue ne donnerait plus ce qu'elle donnait à sa
comptabilisation ». Les identifiants Claude de la génération courante **n'ont pas
de suffixe de date** — la documentation est formelle : on ne les date pas. Il
n'existe donc, pour ces modèles-là, **aucun équivalent du verrou que `modeles.ts`
exige.** Ce n'est pas rédhibitoire au rang du rattrapage, où le relevé n'est
retenu que s'il remplit le contrat ; ce le serait au premier rang. Je le signale
et je ne le tranche pas : c'est une propriété du fournisseur, pas du dépôt.

---

## 3. PP-StructureV3 — la question a changé, la réponse non

Le 15 octobre l'avait écartée pour une raison de vitesse : « la désignation prend
trois secondes, il n'y a plus rien à y gagner ». Le dirigeant demande si cette
raison tient quand le sujet devient la **justesse** d'un récapitulatif de TVA.

**Elle ne tient plus, et la réponse reste non** — pour une autre raison, et elle
est meilleure.

Regardons les deux défauts réellement mesurés le 18 octobre :

- `6a2d49aa` : `totals.vat` faux. **La facture n'imprime aucun total de TVA.** Elle
  imprime « TVA 7 % : 60,529 » et « TVA 19 % : 512,354 », séparément. Aucun jeton
  ne porte 572,883, et R2 interdit de le fabriquer. **Aucune analyse de tableau au
  monde ne produit un jeton pour un nombre qui n'est pas sur la page.**
- `53144e64` : l'arithmétique ne boucle pas, à 71,200 près. **Le FODEC manque au
  pack TN** (`ref.fiscal_charges` ne porte que `DROIT_TIMBRE`). C'est un trou de
  référentiel, R10, l'affaire de l'expert. Le tableau était parfaitement lu.

**PP-StructureV3 ne répond à aucun des deux.** Elle répondrait à un troisième
défaut — une colonne confondue avec une autre dans un tableau dense — dont on n'a
**aucune occurrence mesurée**. Construire pour un défaut qu'on n'a jamais vu,
quand on en a deux qu'on a vus, est le mauvais ordre.

À quoi s'ajoute la mémoire : PP-StructureV3 empile une analyse de mise en page,
une reconnaissance de structure de tableau et une classification d'orientation
par-dessus la détection et la reconnaissance. Le conteneur plafonne à 2 GiB et le
pic d'une seule chaîne est à 1,8 Go. Les modèles `medium` y ont déjà été tués.
**Non mesuré, mais hors de portée à vue d'œil.**

Et la troisième raison, qui est la plus simple : ce que `6a2d49aa` demande n'est
pas une meilleure lecture, c'est **une addition**. Reconnaître que deux lignes de
TVA s'additionnent en un total non imprimé est le travail d'un moteur du Socle sur
des valeurs déjà citées, pas d'un lecteur. R3 le dit : Malica appelle, ne calcule
pas — mais le Socle, lui, calcule.

---

## 4. Ne rien changer

C'est une voie, et elle a de vrais arguments :

- la chaîne **lit juste** sur les pièces mesurées : sur les deux factures du
  18 octobre, aucun montant faux n'est sorti sans son drapeau ;
- elle coûte **0,0035 $ par pièce** et 18 à 21 secondes (relevé par modèle de
  vision) ou 30 à 35 (relevé PaddleOCR) ;
- le travail qu'elle demande est **nul**, et dans un dépôt où deux agents écrivent,
  cela compte ;
- surtout : **les deux défauts mesurés ne sont pas des défauts de lecture.** L'un
  est structurel (un total non imprimé), l'autre réglementaire (le FODEC absent du
  pack). Toucher au lecteur ne ferme ni l'un ni l'autre.

Ce qu'elle laisse ouvert, et qui est réel : **une facture écrite en arabe seul
n'est pas lue au premier rang.** `latin_PP-OCRv5_mobile_rec` ne reconnaît pas
cette écriture ; le relevé revient avec les seules parties latines, le plan de
jetons est amputé, et la désignation travaille sur une pièce incomplète. Le
rattrapage par Qwen la rattrape — il lit l'arabe —, au prix de dix-neuf secondes
et d'un aléa de modèle, et seulement si le contrat sort partiel. Si la partie
latine suffit à remplir le schéma Zod, **le contrat sort `extract.v1` et le
rattrapage ne se déclenche jamais** : la pièce est annoncée complète alors que
l'arabe n'a pas été lu. C'est le même angle mort que celui que le spécialiste OCR
a nommé pour l'arithmétique incohérente, et c'est ce qui fait pencher contre
« ne rien changer ».

---

## La recommandation, et son ordre

**Je tranche, dans cet ordre, et je dis ce que coûte mon erreur.**

### Premier — l'arabe dans PaddleOCR, en seconde passe (voie 1)

C'est la seule voie qui ferme le trou **à l'endroit où il est** : le premier
lecteur. Elle coûte **zéro dollar au jeton**, huit mégaoctets sur disque, et
vingt-six à trente-deux secondes **uniquement sur les pièces dont le contrat sort
partiel**. Sur une pièce qui lit juste, son coût est exactement nul. Le modèle
existe déjà dans l'image déployée : c'est de la configuration et une fusion de
deux relevés, pas un nouveau fournisseur.

Trois choses à écrire, et la troisième d'abord parce qu'on l'oublie :
`infra/ocr/service.py` (seconde chaîne paresseuse), la fusion côté
`vision.ts`/`paddle.ts`, et **la ligne de tarif du § 1.4** — sans quoi on ne
saura jamais combien de pièces l'ont déclenchée.

**Si je me trompe :** le conteneur OOM sous deux chaînes. Coût borné par
construction — `paddle.ts` rend `null`, la lecture partielle reste partielle, rien
ne tombe. Recours : le plafond du conteneur à 3 GiB, sur un hôte qui a 2,4 Go de
libre. Perte sèche : une demi-journée, et une ligne de migration à refermer par
`effective_to`.

### Deuxième — Claude Haiku 5.5 remplace Qwen au rattrapage (voie 2, forme étroite)

Pas au premier rang, pas en désignateur. **À la place exacte de Qwen**, et pour
une raison mesurée : le mode de panne de Qwen au rattrapage est la **troncature**
— `6ddc6804` n'a rien rendu du tout —, et c'est le seul mode de panne que Claude
supprime par construction. Le prix est de **0,0021 $ la page** contre 0,00067, soit
deux millièmes de dollar de plus, et seulement sur les pièces qui échouent déjà.

Haiku et pas Sonnet ni Opus, pour deux raisons dans cet ordre : c'est le seul des
trois où l'on peut encore **couper le raisonnement**, et payer un modèle à
réfléchir pour transcrire est une absurdité ; et il coûte vingt à quarante fois
moins cher pour une tâche qui n'est pas un jugement.

**Si je me trompe :** les boîtes de Claude sont trop molles pour que la
désignation distingue les colonnes, et le rattrapage rend un contrat partiel là où
Qwen rendait un contrat complet. Coût : un pas en arrière sur les pièces difficiles
— environ 0,002 $ et quelques secondes par pièce rattrapée — et un `git revert`.
Le garde de `read-flow.ts` ne retient la seconde lecture que si elle remplit le
contrat, donc **aucun montant faux n'entre en comptabilité par cette erreur-là.**
C'est pour cela que je la prends : elle est réversible et elle ne salit rien.

**Avant de la prendre, un appel.** Un seul, sur une vraie facture bilingue, qui
rend trois chiffres : la latence, les jetons de sortie, et la justesse des boîtes
vérifiée à l'œil sur l'image. Je n'ai pas pu le passer — les pièces sont des
données personnelles et la copie m'a été refusée. **Il faut qu'il soit passé sur la
recette, où les pièces vivent déjà, avant d'écrire la ligne de tarif.**

### Troisième — PP-StructureV3 : non, et on ferme la ligne

Elle ne répond à aucun des deux défauts mesurés, et le dépôt n'a aucune occurrence
du défaut auquel elle répondrait. La raison du 15 octobre était la mauvaise ;
celle-ci tient. La ligne « ce qui n'a pas été essayé » peut être refermée.

### Et ce qui ferme plus de drapeaux que les trois réunies

**Le FODEC dans `ref.fiscal_charges`.** Sur `53144e64`, quatre lignes sur cinq y
sont soumises, et son absence lève à elle seule le drapeau arithmétique d'une
facture par ailleurs lue au millime près. Ce n'est pas du lecteur, c'est du
référentiel livré — R10, l'expert, et le spécialiste OCR l'a déjà porté. Je le
remets ici parce qu'une étude qui recommande d'aller chercher l'arabe sans dire
que le défaut le plus coûteux est à neuf lignes de SQL serait malhonnête.

---

## Ce que cette étude n'a pas fait

Aucun fichier de la chaîne de lecture n'est modifié. Aucune migration n'est
ajoutée. **Rien n'a été écrit sur la machine de recette** — seulement lu :
`docker stats`, `docker exec … grep` sur les fichiers du paquet installé, `ls` sur
le stockage des pièces, `free`. Aucun redémarrage, aucun chargement de modèle.

**Dépense en appels payants : 0 $, 0 appel.** Le budget de dix m'était ouvert et je
ne l'ai pas employé, pour une raison et une seule : la seule mesure qui l'aurait
mérité — un relevé Claude sur une vraie facture bilingue — demandait de sortir une
pièce client de la recette, et ce transfert a été refusé. Mesurer sur une facture
synthétique aurait donné un chiffre flatteur et faux. Le § 2.4 reste donc en blanc,
et c'est le seul endroit de ce document où un chiffre manque.
