# La recherche du corpus, mesurée — 2 septembre 2026

Ce document ne dit pas ce que la recherche devrait faire. Il dit ce qu'elle
fait, mesuré sur 800 questions dont la bonne réponse est connue d'avance.

## Le banc de mesure

`legal.sondages` porte **12 101 questions dont l'article attendu est connu par
construction**. Aucune n'a demandé le jugement d'un expert, et aucune ne porte
de réponse rédigée : elles mesurent une seule chose, la seule qui se mesure sans
personne — _la recherche ramène-t-elle le bon article ?_

| famille      | nombre | ce qu'elle éprouve                                                                                                               |
| ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **identité** | 11 434 | « article 84 nonies — code des droits et procédures fiscaux ». La façon dont un praticien désigne un texte.                      |
| **objet**    | 667    | l'objet de chaque note commune, écrit par la DGELF, privé de son numéro. La question n'a presque aucun mot commun avec le texte. |

`db/corpus/sonder.mjs` rejoue un échantillon tiré de façon reproductible et
compare trois classements sur le même périmètre : le **sens** (vecteurs seuls,
ce que faisait la recherche jusqu'ici), les **mots** (index lexical seul), et la
**fusion** des deux par rang réciproque.

## Le résultat

800 sondages, 400 par famille.

| famille  | classement | rang 1 | rang 5  | rang 20     |
| -------- | ---------- | ------ | ------- | ----------- |
| identité | sens       | 34,0 % | 60,5 %  | 77,8 %      |
| identité | mots       | 99,3 % | 100,0 % | 100,0 %     |
| identité | **fusion** | 84,8 % | 99,5 %  | **100,0 %** |
| objet    | sens       | 43,0 % | 58,5 %  | 69,5 %      |
| objet    | mots       | 65,3 % | 69,3 %  | 75,8 %      |
| objet    | **fusion** | 65,3 % | 82,3 %  | **87,3 %**  |

**Ce que la journée a gagné, en une ligne :** à vingt résultats — le nombre que
la recherche rend désormais — le bon article passe de **77,8 % à 100 %** sur les
questions d'identité et de **69,5 % à 87,3 %** sur les questions descriptives.
C'est l'écart entre les vecteurs seuls, l'état d'hier, et la recherche hybride
d'aujourd'hui.

## Trois réglages essayés, et pourquoi celui-là

Le classement lexical de PostgreSQL, `ts_rank_cd`, compte les occurrences mais
**ne pondère pas par la rareté des mots** — c'est ce qui le sépare de BM25. La
conséquence s'est vue tout de suite.

**Premier essai — les mots reliés par OU.** L'arme lexicale rendait le bon
article **0 fois sur 40** sur les questions d'identité : « article » pèse autant
que « 84 », et « article » est dans tous les en-têtes.

**Deuxième essai — le ET d'abord, le OU en secours.** 0 % → 93,5 %. Le ET est
exigeant, donc précis ; le OU ne sert que quand le ET ne rend rien, c'est-à-dire
sur les questions longues dont tous les mots ne peuvent pas tenir dans un même
fragment.

**Troisième essai — l'en-tête pèse plus que le corps.** L'en-tête est rangée en
poids A, le texte en poids D. Appliqué partout, cela portait l'identité à 99,3 %
mais faisait tomber les questions descriptives de 82,8 % à 73,5 % au rang 5 : le
corps du texte ne pesait plus rien. Le réglage retenu applique donc la
pondération **forte à l'arme stricte** — celle qui cherche une identité — et une
pondération **modérée à l'arme large** — celle qui cherche un sujet. Les deux
gains tiennent ensemble.

## Le français atteint enfin l'arabe

Mesure faite avant : à la question française _« convention fiscale entre la
Tunisie et l'Arabie saoudite : imposition des dividendes »_, la recherche rendait
cinq articles du code de l'impôt sur le revenu. **Pas un fragment arabe**, alors
que cette convention n'existe qu'en arabe dans la base.

Deux causes, toutes deux corrigées :

1. **Une convention n'était pas dans le périmètre par défaut.** Le code
   distinguait « code consolidé » et « le reste », et rangeait donc les
   conventions avec l'historique. Or une convention ratifiée est du droit en
   vigueur — la Constitution la place au-dessus de la loi interne. Le périmètre
   par défaut porte désormais les codes, **les conventions et les normes
   comptables**.
2. **L'en-tête de contexte est bilingue.** Chaque fragment porte le nom de son
   corpus en français _et_ en arabe. Le nom français colle maintenant au
   fragment arabe.

Résultat : la convention Tunisie–Arabie saoudite remonte, en arabe, sur son
**article 10 — celui des dividendes**, à partir d'une question posée en français.

## Ce qui reste faible, et ce qu'il faudrait

**Le classement lexical n'a pas d'IDF.** C'est la limite de fond, rencontrée
deux fois dans la même journée. Un nom propre rare dans l'en-tête ne peut pas
l'emporter sur des mots courants répétés dans les corps de texte. La pondération
par position que nous avons mise y supplée sur ce corpus, parce que l'identité
est dans l'en-tête — elle n'y supplée pas partout. Le vrai remède est un BM25,
qui pondère par rareté : une extension PostgreSQL, une dépendance de plus, et un
gain qu'il faudra mesurer avant de l'adopter.

**Le banc ne mesure pas le translingue.** Les 12 101 sondages posent des
questions françaises sur des textes majoritairement français. La seule preuve
que le français atteint l'arabe est le cas de l'Arabie saoudite ci-dessus, et un
cas n'est pas une mesure. Il manque une troisième famille de sondages.

**La recherche est lente sur les questions longues** : environ 300 ms quand
l'arme stricte suffit, jusqu'à trois secondes quand il faut passer au OU, qui
balaie l'index entier. C'est acceptable pour un praticien, ce ne l'est pas pour
un banc de 12 000 sondages — la passe de 800 prend vingt minutes.

**Il n'y a toujours pas de reclassement**, ni de découpage respectant la
structure du texte. Ce sont les deux prochains gains, dans cet ordre.

## L'index vectoriel

Un index HNSW est un graphe de voisinages construit vecteur par vecteur.
Remplacer les 31 863 empreintes — ce qu'a fait le réencodage — laisse un graphe
tracé pour des vecteurs qui n'existent plus : il répond encore, et il répond mal,
sans rien signaler. Il a donc été **reconstruit** (18 secondes), avec ses
paramètres écrits explicitement plutôt que laissés au défaut.

La règle est désormais dans la migration : _tout réencodage du corpus se termine
par une reconstruction de l'index._

## Chiffres de la journée

|                                         |                                                          |
| --------------------------------------- | -------------------------------------------------------- |
| Fragments réencodés                     | 31 863, avec en-tête de contexte et encodage asymétrique |
| Coût du réencodage                      | 0,49 USD                                                 |
| Jetons                                  | ~14,5 millions                                           |
| Sondages disponibles                    | 12 101                                                   |
| Cas amorcés dans la banque de référence | 667, en attente de la réponse de l'expert                |
