# Les vingt-sept éditions que la base ne savait pas lire

_1er septembre 2026_

## Le problème

Sur les cent éditions de la file d'ingestion, vingt-sept ne rendaient aucun texte.
Elles n'étaient pas défectueuses : elles étaient illisibles **de deux façons
différentes**, et il a fallu deux remèdes différents.

| Type                | Éditions                           | Ce que rendait l'extraction       |
| ------------------- | ---------------------------------- | --------------------------------- |
| Microfilms du JORT  | 19 (LF 1978-1994, LFC 1980-1991)   | rien du tout : ce sont des images |
| PDF à police maison | 8 (LF 2000-2005, LFC 2002 et 2004) | `75$'8&7,21)5$1d$,6(`             |

## Remède 1 — les microfilms : reconnaissance optique

Dix-neuf numéros du Journal Officiel, scannés dans les années 1980, ne contiennent
aucune couche de texte. Ils sont passés à la reconnaissance optique (Tesseract 5,
modèle français, 150 points par pouce, niveaux de gris) :

```
pdftoppm -f 1 -l 30 -r 150 -gray -png <edition>.pdf p
tesseract p-NN.png p-NN -l fra --psm 3
```

**On ne traite que les trente premières pages.** Un numéro du JORT, c'est la loi de
finances puis cent pages de tableaux budgétaires ; les articles de droit fiscal
sont au début. Reconnaître les tableaux aurait coûté dix fois plus cher pour un
contenu qui n'a pas sa place dans un corpus juridique.

**Résultat : 18 éditions sur 19.** Elles rendent de 6 à 129 articles chacune.

La dix-neuvième, **LF-1979**, résiste : son microfilm est trop dégradé. La
reconnaissance rend « Art, &, — Est et demeure autorisée » là où le papier porte
« Art. 3. — Est et demeure autorisée ». Les numéros d'articles eux-mêmes sont
illisibles ; sans eux, il n'y a rien à découper. Passer à 300 points par pouce
n'a pas amélioré le résultat — il l'a dégradé. Cette édition reste écartée, et le
dira.

## Remède 2 — les polices maison : déchiffrement

Huit lois de finances sont publiées avec une police sous-ensemble sans table de
correspondance Unicode. Ce n'est pas du bruit : c'est une **substitution**, où
chaque code du fichier vaut toujours le même caractère.

Le déchiffrement se fait en deux étages, et **aucun des deux ne devine** :

1. **Un décalage de +29** rend les lettres, chiffres et ponctuations ASCII. On le
   lit sans rien supposer : le caractère le plus fréquent d'un texte est l'espace,
   et il vaut ici `0x03`.
2. **Une table** pour la trentaine de codes restants — accents, guillemets,
   apostrophe. Chaque entrée est adossée à une preuve relevée dans le texte
   lui-même et citée en commentaire dans `db/corpus/dechiffrer.mjs` : « impts » ne
   peut être que « impôts », « exerant » que « exerçant », « en uvre » que
   « en œuvre ».

Le résultat est ensuite **vérifié** par une déduction indépendante, fondée sur
quarante mots français dont la forme accentuée est certaine (« décembre »,
« arrêté », « bénéfice »...). Les deux méthodes doivent tomber sur la même table.
Sur les huit éditions : **zéro désaccord**, et de 0 à 19 caractères non résolus par
document — remplacés par une espace, jamais devinés.

**Résultat : 8 éditions sur 8**, de 7 à 99 articles chacune.

## Ce que la base dit du texte qu'elle sert

Un texte issu de la reconnaissance optique ne doit jamais se faire passer pour le
Journal Officiel. La colonne `legal.article_versions.extraction_confiance` porte
donc trois valeurs :

| Valeur      | Ce que ça veut dire                                                                 |
| ----------- | ----------------------------------------------------------------------------------- |
| `verbatim`  | texte extrait tel quel du PDF officiel                                              |
| `partiel`   | PDF à police maison, déchiffré : lettres sûres, quelques signes perdus              |
| `incertain` | microfilm passé à la reconnaissance optique : lisible, pas fiable au caractère près |

La correspondance est portée par `db/corpus/pdf/provenance.json`, lu par
`reconstruire.mjs`. Tout ce qui n'y figure pas est du `verbatim`. Quand une même
version d'article provient de plusieurs éditions, elle prend la **moins sûre**
d'entre elles.

## Ce qui reste écarté, et pourquoi

| Édition  | Raison                                                                                                                                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LF-1979  | microfilm trop dégradé : les numéros d'articles sont illisibles                                                                                                                                                                                                                                                  |
| LFC-2008 | ce PDF n'est pas une loi mais un numéro entier du JORT : lois, décrets et arrêtés mêlés, chacun renumérotant à partir de 1. Le découpage y trouvait auparavant les huit articles d'un décret sur une unité de gestion, et les étiquetait « LFC 2008 ». Rendre zéro est plus honnête que rendre le mauvais texte. |
