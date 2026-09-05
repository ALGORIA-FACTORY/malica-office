# Le corpus juridique tunisien — état au 1er septembre 2026

*Ce document remplace la note du matin. Les chiffres qu'il porte sont mesurés,
pas estimés : ils sortent de `db/verification/qualite_corpus.sql`, qui se rejoue.*

## Où l'on en est

| | Avant | Après |
|---|---|---|
| Articles | 2 221 | **9 014** |
| Versions | 3 045 | **11 262** |
| Fragments encodés | 6 150 | **22 762** (aucun manquant) |
| Vérités connues vérifiées | 2/5 | **10/10** |
| Années couvertes | 2016-2026 | **1978-2026** |
| Codes | 8, tous fiscaux | **13**, dont le droit des sociétés, des contrats, du commerce, du travail et le système comptable |
| Notes communes DGELF | 0 | **680** |
| Articles rattachés à leur autorité | 0 | **9 014 sur 9 014** |
| Versions portant leur référence de publication | 0 | **4 030** (JORT ou Bulletin officiel des douanes et des impôts) |
| Articles dont on connaît le statut | 0 | **4 585** (4 489 en vigueur, 96 abrogés) |

## Les huit défauts corrigés

### 1. L'arabe ne se découpait pas

L'arabe fait foi en Tunisie autant que le français. Le découpeur ne le lisait
qu'à moitié : il ignorait les rangs écrits en toutes lettres — *مكرر*, *ثالثا*,
*رابعا* — si bien que les huit articles 13 du code de la TVA se confondaient en
un seul. L'édition arabe rendait **11 articles là où le français en rendait 30**.

Trois pièges propres à l'arabe ont été traités : l'extraction colle les mots
(`الفصل13مكرر`), elle intervertit parfois les lettres de *الأول* (article
premier), et les rangs s'écrivent en toutes lettres. Résultat : le code des
droits et procédures fiscaux est **intégralement bilingue (170 articles sur
170)**, le code de la TVA aussi (30/30), le code d'enregistrement à 103 sur 144.

### 2. Le corps du code se confondait avec ses annexes

Un fascicule de la DGELF n'est jamais « un code » : il enchaîne un sommaire, la
loi de promulgation, le corps du code, puis des décrets annexes — chacun
renumérotant ses articles à partir de 1. L'ancienne règle prenait le décret sur
les vins (46 articles) pour le code de la TVA (30).

La nouvelle règle tient en quatre temps : on coupe à chaque « article premier »,
on garde dans chaque bloc la plus longue suite croissante (une citation en tête
de ligne ne casse plus le découpage, elle est contournée), on recoud les blocs
que seule une citation avait séparés, et l'on choisit entre les candidats par le
nombre d'articles **puis** par l'étendue en caractères. Prises séparément, ces
deux mesures se trompent ; ensemble, elles ne se trompent plus sur aucun code.

### 3. Le code de la TVA avait perdu ses articles 1 et 2

Conséquence directe du point précédent : le décret de promulgation du 25 août
1989 tenait lieu d'articles 1 et 2, et « le ministre est chargé de l'exécution du
présent décret » figurait dans la base comme **article 2 du code de la TVA**. Le
vrai article premier — celui qui définit ce qui est soumis à la TVA — était
avalé. Il est revenu.

### 4. Le recueil écrasait quarante textes en un seul

Le *Recueil des textes relatifs aux droits et taxes non incorporés dans les codes
fiscaux* n'est pas un code : il compile des dizaines d'arrêtés, décrets et lois,
chacun renumérotant à partir de 1. Les confondre donnait cinquante « article
premier » dont un seul survivait, et huit articles pesant plus de douze mille
caractères.

Chaque article y est désormais rattaché à son texte d'origine, par une référence
prise sur des **chiffres** — numéro, année, date — et non sur des mots : ils sont
identiques en français et en arabe, si bien qu'un même texte porte la même
référence dans les deux éditions. Le recueil passe de 115 à **797 articles**.

### 5. Vingt-sept éditions étaient illisibles

Dix-neuf microfilms du JORT (1978-1994) et huit PDF à police maison (2000-2005).
Voir `docs/textes-illisibles-2026-09-01.md` pour le détail. **Vingt-cinq ont été
récupérées**, ce qui fait entrer 1 710 articles et fait remonter le corpus de
2016 à **1978**.

### 6. Trois cent cinq articles disparaissaient en silence

Le code de la comptabilité publique est publié sans millésime. À l'écriture, les
éditions sans année étaient ignorées — sans message, sans trace. On date
désormais une telle édition par le texte le plus récent qu'elle cite : une
compilation ne peut pas être antérieure à ce qu'elle contient. C'est une borne
inférieure, et elle est dite comme telle.

### 7. Les en-têtes du Journal Officiel se faisaient encoder comme du droit

« N° 148 Journal Officiel de la République Tunisienne — 12 décembre 2025 Page
3343 », répété trois cents fois dans une loi de finances, se retrouvait au milieu
des articles et partait dans les fragments. **422 457 caractères** d'en-tête ont
été retirés, sans qu'aucun article ne change.

Mais on les **lit avant de les retirer** : ce sont eux qui portent la référence
au Journal Officiel (voir plus bas).

### 8. Le dernier article de chaque texte portait toute l'annexe

L'article 21 du code de la TVA — abrogé, deux lignes — pesait 41 325 caractères,
dont les tableaux A et B qui donnent les taux réduits. L'annexe est détachée sous
son propre nom, et l'on coupe là où elle s'annonce (« TABLEAU », « ANNEXE »,
« DÉCRET »…) plutôt qu'au caractère près.

## Les trois manques signalés, et ce qu'ils sont devenus

### La hiérarchie des textes n'était reliée à rien

`legal.sources` dit, pour chaque type de texte, son autorité et à qui il est
opposable — une note commune de la DGELF n'oblige que l'administration, ni le
contribuable ni le juge, en vertu de l'article 54 de la LFC 2012. Cette table
était juste et **débranchée** : aucun article n'y renvoyait.

Chaque article porte désormais `source_code`. Le rattachement n'est pas déclaré à
la main : il se lit sur le type de document pour les codes et les lois de
finances, et **texte par texte** dans le recueil, à la lecture du titre qui ouvre
chaque bloc (« ARRÊTÉ DU 15 MAI 1992 PRIS EN APPLICATION DU DÉCRET DU 25 MAI
1950 » est un arrêté, pas un décret : on lit le premier mot d'une ligne, pas le
dernier mot de l'entête).

| Type | Articles |
|---|---|
| Loi de finances | 3 644 |
| Loi ordinaire | 1 048 |
| Décret | 391 |
| Arrêté ministériel | 238 |
| Décret-loi | 113 |
| **Non rattaché** | **0** |

Le décret-loi manquait au référentiel : les lois de finances 2011, 2021, 2022 et
2023 ont été prises sous cette forme. Il a été ajouté.

### Aucune référence au Journal Officiel

Elle est maintenant relevée sur l'en-tête de page, avant que celui-ci ne soit
retiré : numéro du journal, date, et **page où commence l'article**.

- Textes publiés au JORT : **3 749 versions sur 3 749** en portent une, sur 520
  numéros distincts du journal.
- Éditions consolidées de la DGELF : elles n'en portent pas, et c'est exact — ce
  sont des compilations administratives, pas des numéros du Journal Officiel.
  Leur absence de référence n'est pas un défaut, c'est un fait.

Exemple de ce qu'une réponse affiche désormais : *LFC-1988 art. 7 — publication :
JORT n° 39 du 10 juin 1988, p. 828*.

### Le statut de chaque article

Le vocabulaire n'est pas interchangeable, et les effets non plus :

| Statut | Ce que ça veut dire |
|---|---|
| `en_vigueur` | l'article s'applique |
| `abroge` | une loi postérieure l'a supprimé — **pour l'avenir** : les faits antérieurs restent régis par lui |
| `annule` | le juge administratif l'a effacé **rétroactivement** : réputé n'avoir jamais existé |
| `caduc` | il s'est éteint seul, son terme étant échu |
| `non_entre_en_vigueur` | publié, mais sa date d'effet n'est pas atteinte |
| `indetermine` | nous ne savons pas — et nous le disons |

L'information était déjà dans nos textes : « ARTICLE 21 (Abrogé par l'article 7
de la loi n°2000-82 du 9 août 2000) ». On la relève **verbatim**, en français
comme en arabe, et une contrainte de base interdit de déclarer un article abrogé
sans porter la citation qui le prouve.

**63 articles abrogés, tous justifiés. 1 622 en vigueur. 3 749 indéterminés** —
ce sont les articles des lois de finances anciennes : le texte a modifié un code
il y a trente ans, nous ne détenons pas de quoi dire s'il tient encore. Écrire
« en vigueur » serait une invention.

## La recherche répond maintenant à une date

```
bun db/corpus/rechercher.mjs "taux de la taxe sur la valeur ajoutée" --au 1990-12-31
```

> **LFC-1988 art. 7** (depuis 1988-01-01)
> Loi de finances (normative) — opposable à : administration, contribuable, juge
> statut : indéterminé
> publication : JORT n° 39 du 10 juin 1988, p. 828 — texte incertain
> *« Sont soumis à la taxe sur la valeur ajoutée au taux de 17%, les opérations
> portant sur les biens et les services non soumis à un autre taux. »*

Au 31 décembre 2019, la même question rend le code de la TVA article 7 dans son
édition 2019 : *« au taux de 19% »*. Sans date, elle rend le dernier état.

**Ce que `--au` sait et ne sait pas.** Les bornes de validité viennent des
éditions détenues : un texte identique en 2018 et en 2020, différent en 2022,
vaut « du 1er janvier 2018 au 1er janvier 2021 ». La réponse est juste à
l'édition près, jamais au jour près, et le résultat affiche toujours ses bornes.

**Un code consolidé DIT l'état du droit ; une loi de finances dit ce qui a changé
cette année-là.** Quand on détient le code pour la date demandée, c'est lui qui
répond. Avant 2016, où nous n'avons que les lois de finances, ce sont elles.

## Ce que vaut le texte que l'on sert

| | Versions | Ce que ça veut dire |
|---|---|---|
| `verbatim` | 5 474 | extrait tel quel du PDF officiel |
| `incertain` | 1 204 | microfilm passé à la reconnaissance optique |
| `partiel` | 506 | PDF à police maison, déchiffré : lettres sûres, quelques signes perdus |

Servir de l'OCR sans le dire serait mentir. La provenance s'affiche dans chaque
résultat de recherche.

## Les cinq codes qui manquaient

Le corpus était purement fiscal : huit codes, tous des impôts. Or un cabinet
comptable travaille d'abord sur ce qu'on a le **droit** de faire.

| Code | Articles | Couverture de la numérotation |
|---|---|---|
| COC — obligations et contrats (1907) | 1 409 | 92 % (le reste abrogé) |
| CCOM — code de commerce | 538 | 71 % (le livre sur la faillite a été remplacé en 1995) |
| CSC — sociétés commerciales | 492, **dont 489 en arabe** | 100 % |
| CTRAV — code du travail (édition 2020) | 441 | 95 % |
| SCE — loi 96-112, système comptable | 27 | 100 % |

Ce qui change concrètement : à la question *« délai de dépôt des comptes annuels
de la SARL »*, la base répond maintenant CSC art. 14 (immatriculation dans le
mois), SCE art. 21 (états financiers dans les trois mois de la clôture) et
CIRPPIS art. 57 (dépôt au centre de contrôle). Trois codes différents, une seule
question. Ce matin, aucun des trois n'était dans la base.

### L'arabe des présentations de police

Le code des sociétés commerciales en arabe rendait **zéro article**. La raison
n'était pas le découpage : ce PDF écrit les lettres dans leurs **formes de
présentation** — « اﻟفصل » au lieu de « الفصل », visuellement identiques, et
aucune recherche ne trouve l'un en cherchant l'autre. Le segmenteur déduit
désormais d'Unicode, pour chaque lettre, toutes les formes qui s'y ramènent. Le
CSC est passé de 0 à 489 articles en arabe.

## Les 680 notes communes de la DGELF

687 notes en file, de 2002 à 2026, **toutes récupérées** : 585 par extraction
directe, 102 par reconnaissance optique. Voir
`docs/notes-communes-2026-09-01.md`.

Elles portent `source_code = 'NOTE_COMMUNE'`, donc l'autorité
« interprétative » et l'opposabilité « administration » seule. C'est ce qui
distingue Regalica d'un moteur de recherche : à la question *« retenue à la
source sur les honoraires des avocats »*, la réponse remonte la note commune
n° 12 de 2015 **et dit qu'elle engage le fisc, pas le contribuable**.

La recherche a donc trois périmètres :

| Commutateur | Ce qu'il ouvre |
|---|---|
| *(par défaut)* | les codes consolidés — le droit en vigueur |
| `--doctrine` | + les notes communes de la DGELF |
| `--historique` | + les lois de finances |
| `--au AAAA-MM-JJ` | l'état du droit à cette date (ouvre l'historique) |

## Aucun article sauté : la vérification

La question n'est pas rhétorique. Pour chaque code, on compte les numéros
absents entre le premier et le dernier article, **puis on vérifie si ces numéros
figurent quand même en tête de ligne dans le PDF** — c'est-à-dire si le découpage
les a ratés.

| Code | Numéros absents | Dont réellement présents dans le PDF |
|---|---|---|
| CCOM | 215 | **0** |
| COC | 124 | **0** |
| CTRAV | 21 | **0** |
| CDET | 18 | **0** |
| CIRPPIS | 8 | 2 — vérifiés un par un : ce sont des citations, pas des articles |
| CCP | 6 | **0** |
| CSC, CDPF, CTVA, CFL, SCE, INCITATIONS | 0 | — |

Autrement dit : **sur 9 014 articles, tout ce que les sources contiennent est
dans la base.** Les numéros absents sont ceux que les éditions officielles ne
contiennent pas — abrogés, ou transférés vers un autre code.

## Ce qui reste ouvert, et ce que ça coûterait

1. **L'arabe des codes CIRPPIS, CFL, COC, CCOM, CTRAV.** Ce n'est plus un
   problème de découpage — le CSC arabe est entré aujourd'hui. Il n'existe
   simplement pas d'édition arabe accessible pour ces codes dans notre file. Il
   faut aller la chercher à la source. Le corpus est bilingue partout où
   l'édition arabe existe : CDPF 170/170, CSC 489/492, CTVA 31/34, CDET 103/144.
2. **LF-1979 et LFC-2008.** Le microfilm de 1979 est trop dégradé — les numéros
   d'articles eux-mêmes sont illisibles. Le PDF « LFC-2008 » n'est pas une loi
   mais un numéro entier du JORT ; rendre zéro article est plus honnête que
   rendre le mauvais texte.
3. **Le statut des 4 429 articles indéterminés.** Il faudrait suivre chaque
   disposition d'une loi de finances jusqu'au code qu'elle a modifié. Faisable,
   long, et à ne faire qu'avec une règle vérifiable.
4. **Les normes comptables tunisiennes (NCT 1 à 42)** : la loi 96-112 est entrée,
   les normes qu'elle institue ne le sont pas encore.

## Où sont les choses

| Fichier | Rôle |
|---|---|
| `db/corpus/segmenter.mjs` | découpage d'un fascicule en articles, français et arabe |
| `db/corpus/entetes.mjs` | retrait des en-têtes de page du JORT |
| `db/corpus/dechiffrer.mjs` | déchiffrement des PDF à police maison |
| `db/corpus/reconstruire.mjs` | PDF → texte → articles → versions, et l'écriture en base |
| `db/corpus/vectoriser.mjs` | encodage des fragments, modèle lu dans `agents.model_pricing` |
| `db/corpus/notes.mjs` | ingestion des notes communes de la DGELF |
| `db/corpus/rechercher.mjs` | recherche, avec `--au`, `--doctrine`, `--historique` |
| `db/corpus/provenance.json` | d'où vient le texte de chaque édition |
| `db/verification/qualite_corpus.sql` | les douze contrôles ci-dessus, rejouables |
| `db/migrations/20260901143000_…sql` | autorité, statut, référence au Journal Officiel |
