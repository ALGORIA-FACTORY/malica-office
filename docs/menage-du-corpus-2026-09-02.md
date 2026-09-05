# Ménage dans la base — 2 septembre 2026

Ce document dit ce qui a été trouvé, ce qui a été corrigé, et ce qui reste
ouvert. Tous les chiffres se rejouent avec `db/verification/proprete_corpus.sql`
et `db/verification/qualite_corpus.sql`.

## En un mot

La base ne se contredit plus. Les six contrôles de propreté rendent zéro sur
toutes leurs lignes, et les cinq documents qui n'ont rien produit portent chacun
la raison, vérifiée sur le document lui-même.

| | Avant | Après |
|---|---|---|
| Versions en double (même texte, deux fois) | 7 | **0** |
| Notes rangées sous une année qui n'est pas la leur | 13 | **0** |
| Notes dont l'en-tête contredit l'identité en base | 17 | **0** |
| Versions sans l'adresse du fichier d'origine | 2 265 | **0** |
| Documents de la file au statut faux | 96 | **0** |
| Documents « n'a rien produit » sans motif écrit | 8 | **0** |

## Ce qui n'allait pas, et pourquoi

### 1. Le portail de la DGELF indexe la même note sous deux années

Sa page 2010 renvoyait, pour ses numéros 1 à 12, aux PDF des notes 1 à 12 de
**2009** ; sa page 2020 renvoyait, pour le numéro 28, au PDF de la note 28/2019 ;
le lien de la note 29/2005 sert le PDF de la note 28/2005.

L'année d'une note était lue sur la page d'index, pas sur la note. Résultat :
douze notes fantômes — le même texte rangé sous deux identités, dont une qui
n'existe pas. Une recherche « note commune 11 de 2010 » rendait un texte de 2009
en le présentant comme un texte de 2010.

**Corrigé à la cause** : `db/corpus/notes.mjs` lit désormais l'identité dans
l'en-tête de la note elle-même (« NOTE COMMUNE N° 11/2009 ») ; le titre du
portail n'est plus qu'un secours. **Corrigé dans les données** : les fantômes ont
été retirés, non pas nommés un par un, mais *dérivés* — un article dont le texte
est identique à celui d'un autre, et dont l'identité contredit son propre
en-tête quand celle de l'autre le confirme, est le fantôme. La note 8 de 2009,
qui n'existait que sous 2010, est retournée à son millésime.

### 2. Dix-sept notes dont les chiffres sortaient faux du PDF

La couche de texte de certains PDF rend les suites de chiffres à l'envers :
« NOTE COMMUNE N° 82/2012 » pour la note 28, « N° 1/3122 » pour 2011, « N° 32/2018 »
pour la note 23. Ce n'est pas seulement l'en-tête : dans ces documents, **tous**
les nombres sont suspects — et un texte fiscal dont les nombres sont suspects ne
vaut rien.

Les dix-sept PDF ont été **relus par reconnaissance optique**. Les en-têtes
retombent juste, et ces versions sont marquées `incertain` — l'OCR est lisible,
il n'est pas fiable au caractère près, et la base le dit.

Au passage, une identité fausse est apparue en pleine lumière : la note que le
portail annonce « 26/2008 » porte, sur elle-même comme dans le nom de son
fichier, le numéro **27**. Elle a été remise à sa place.

`notes.mjs` détecte désormais ce défaut tout seul : une année impossible ou un
numéro qui est celui du portail à l'envers font retomber la note sur l'identité
du portail et lui retirent la mention « verbatim ».

### 3. Chaque loi de finances arabe perdait son article premier

En arabe, « الفصل الأول » — article premier. À l'extraction, « لأ » sort comme
**une seule ligature** (U+FEF7) là où le motif de recherche attendait deux
lettres. L'article premier de chaque édition arabe n'était donc jamais reconnu.

Le segmenteur accepte maintenant les huit ligatures lam-alif partout où un mot
en porte. Gain immédiat, sans aucune perte : +9 articles sur les lois de
finances arabes, +4 sur les lois complémentaires, +1 sur le code des sociétés.

### 4. Une passe qui ne savait pas lire effaçait ce qu'une autre avait lu

En reconstruisant les éditions arabes, quinze d'entre elles — lois de finances
2000 à 2013 — n'ont pas pu être relues : leurs PDF sont numérisés, ou portent
une police sans table de correspondance. Or le script vidait le corpus sur la
seule foi de la file : **936 versions arabes, lues jadis par reconnaissance
optique, ont disparu**. Elles ont été reprises depuis la sauvegarde prise avant
l'opération.

`reconstruire.mjs` ne remplace plus que les corpus qu'il a **réellement relus**.
Une édition illisible laisse désormais intact ce qu'on avait d'elle.

### 5. Une version ne disait pas de quel fichier elle venait

`reconstruire.mjs` n'écrivait pas l'adresse de la source. 2 265 versions
citaient leur article, leur page au Journal Officiel, leur empreinte — et pas le
document lu. Devant un contrôle, c'est la pièce justificative qui manque.

C'est écrit désormais ; et les 2 265 versions déjà en base ont retrouvé leur
adresse, non pas devinée, mais **retrouvée** dans la file par corpus, millésime
et langue, et seulement quand cette édition y est unique.

### 6. La file d'ingestion mentait sur son propre état

Quatre-vingt-seize documents restaient « à faire » alors que leurs articles
étaient en base ; une vingtaine se disaient « ingérés » sans rien avoir produit.
Le statut se **déduit** maintenant de la base :

- `ingéré` — le document a produit du texte, et ce texte est encore là ;
- `ignoré` — le portail sert ici un PDF déjà lu sous une autre adresse (20 cas) ;
- `échec` — le document n'a rien produit, **et on dit pourquoi**.

Deux garde-fous refusent la migration si un document se dit ingéré sans rien
avoir produit, ou si un échec n'a pas de motif.

## Ce qui a été gagné en chemin

| | |
|---|---|
| Conventions Égypte et Arabie saoudite | **+56 articles** |
| Code des sociétés commerciales, édition française | **+490 versions** |
| Lois de finances arabes 2014-2022 et complémentaires 2013-2016 | **+816 articles** |
| Décret-loi de finances de novembre 2022 | **+6 articles** |

La convention avec l'Arabie saoudite méritait son détour : sa couche de texte
rendait « 2111 » là où le papier porte 2010, et l'édition entière était écartée
faute de date. Relue par reconnaissance optique, elle donne ses 27 articles et
son millésime.

Le millésime d'une édition arabe se lit maintenant même quand il est écrit en
chiffres arabo-indiens — « ١٩٩٤ » vaut 1994.

## Ce qui reste ouvert, et pourquoi

Cinq documents n'ont rien produit. Chacun porte son motif dans la file :

| Document | Pourquoi |
|---|---|
| Convention Tunisie–Côte d'Ivoire (arabe) | PDF numérisé et trop dégradé : la reconnaissance optique n'en tire ni numéros d'articles ni date |
| Convention Tunisie–Singapour (arabe) | l'édition du portail ne porte aucune date, ni de signature ni de ratification |
| Convention Tunisie–Vietnam | le PDF du portail est un **projet non signé** : il porte « Fait à ……… le ……… » en blanc |
| Loi de finances 1979 | microfilm du Journal Officiel trop dégradé |
| Loi de finances complémentaire 2008 | le PDF est un numéro entier du Journal Officiel, pas le texte de la loi |

Restent aussi, connus et mesurés :

- **Quinze éditions arabes de lois de finances (2000-2013)** dont la couche de
  texte est inexploitable. Le texte qu'on en détient vient d'une reconnaissance
  optique ancienne, marquée `incertain` ; une relecture page à page les
  améliorerait.
- **Les trous de numérotation** des codes non fiscaux (code de commerce 71 %
  couvert, code des obligations et contrats 92 %) : ce sont les articles absents
  des éditions officielles elles-mêmes — abrogés, ou déplacés ailleurs.
