# Les notes communes de la DGELF

_1er septembre 2026_

## Pourquoi elles comptent plus qu'il n'y paraît

Une note commune n'est pas une loi. Elle n'oblige **que l'administration
fiscale** — article 54 de la loi de finances complémentaire 2012 — ni le
contribuable, ni le juge.

C'est précisément ce qui la rend précieuse. Elle dit **comment l'administration
lira le texte**. Un contribuable peut donc s'en prévaloir contre le fisc, alors
que le fisc ne peut pas la lui opposer comme une loi. C'est un avantage
asymétrique, et il ne vaut que si l'on sait de quel type de texte on parle —
d'où le rattachement de chaque note à `legal.sources`.

## Le modèle retenu : une note = un texte

Une note commune n'est pas découpée en articles : c'est un texte suivi qui
commente un ou plusieurs articles d'une loi. La découper serait **inventer une
structure qu'elle n'a pas**. Le modèle est donc celui des lois de finances :

```
corpus  NC-<année>        numero  <numéro de la note>
```

L'article 10 de la loi de finances 1995 n'a rien à voir avec celui de 2026 ; la
note commune n° 5 de 2016 n'a rien à voir avec celle de 2024. Le fragmenteur
découpe ensuite le texte en morceaux de lecture, si bien que la recherche remonte
au **passage exact**, dans la **note exacte**.

Le numéro est lu sur le titre (« NC 5/2026 — … »). Sans numéro lisible, la note
serait écartée et signalée plutôt que rangée sous un numéro inventé — le cas ne
s'est pas présenté.

## La publication officielle

Une note commune ne paraît pas au Journal Officiel : elle paraît au **Bulletin
Officiel des Douanes et des Impôts**, et porte en plus son numéro de texte à la
Direction générale des impôts. Les deux sont imprimés en tête de la note et sont
relevés tels quels :

> `BODI n° 2002/08/02, texte n° DGI 2002/10`

C'est la même exigence que pour une loi : pouvoir montrer où le texte a paru, et
pas seulement le citer.

## Ce qu'il a fallu pour les avoir toutes

687 notes en file, de 2002 à 2026.

| Étape                                             | Résultat      |
| ------------------------------------------------- | ------------- |
| Téléchargées                                      | 687 / 687     |
| Texte extrait directement du PDF                  | 585           |
| PDF numérisés, passés à la reconnaissance optique | 102           |
| **Exploitables au total**                         | **687 / 687** |

Les 102 notes numérisées — surtout les millésimes 2015 à 2023 — ont été
rasterisées puis lues par Tesseract, en français ou en arabe selon l'édition.
Elles portent `extraction_confiance = 'incertain'` : lisibles, pas fiables au
caractère près. La correspondance est dans `db/corpus/provenance-nc.json`.

## Ce que ça change dans une réponse

Une recherche qui remonte une note commune affiche désormais :

```
— NC-2016 art. 12
  Note commune DGELF (interpretative) — opposable a : administration
  statut : indetermine
  publication : BODI n° 2016/…, texte n° DGI 2016/… | texte incertain
```

La ligne « opposable à : administration » est ce qui distingue Malica d'un
moteur de recherche : elle dit, sans que l'utilisateur ait à le savoir, que ce
texte engage le fisc et pas lui.

## Où c'est fait

`db/corpus/notes.mjs` — reprenable : les PDF déjà téléchargés ne le sont pas deux
fois, et une note déjà écrite est mise à jour, pas dupliquée. Le script ne touche
qu'aux corpus `NC-*` ; `reconstruire.mjs`, de son côté, ne vide que les corpus
qu'il reconstruit, pour ne pas emporter les notes au passage.
