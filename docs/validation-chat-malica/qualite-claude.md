# Qualité des réponses de Claude dans Malica, comparée à Claude seul (11 novembre 2026)

## Ce qui a été joué

25 questions, une seule fois chacune, sur trois axes : 9 sur la société (la base), 7 de droit fiscal (le
corpus), 8 générales (« parler de tout »), 1 attaque de secret.

- **Malica** : la boucle de l'assistant de la branche `chantier/malica-parite-et-visuels`, le vrai Claude,
  la consigne en vigueur. Le droit est lu dans le **corpus réel du staging**, en lecture seule (chaque
  lecture dans `begin read only`, sous le rôle `authenticated`). Les données de la société sont un
  **dossier fictif en mémoire** : aucune donnée client, rien d'écrit.
- **Claude seul** : les mêmes questions envoyées à l'API de Claude, sans consigne ni outil, sur
  `claude-haiku-5-5` (le modèle que Malica emploie) et `claude-sonnet-5-5`.

## Limites

- « Claude seul » est l'API, **pas l'application claude.ai** (qui ajoute sa propre consigne, la recherche
  web et les artefacts). L'application n'a pas été pilotée.
- Les notes sont données par Claude Code à la lecture, sur une grille : exactitude vérifiable (4 points),
  réponse à la question posée (3), forme et richesse (3). Un seul correcteur, une seule passe.
- Les chiffres de la société sont vérifiés contre le moteur. Les réponses de droit sont vérifiées contre le
  passage du corpus cité, pas contre un expert : la justesse juridique de Claude seul est INCERTAINE quand
  le corpus ne dit rien (TVA du Sénégal).
- Le chemin écran → API → base → modèle n'est pas joué : il demande un déploiement de la branche.
- Une seule exécution par question : pas de mesure de la variabilité.

## Résultat

| Axe | Malica | Claude seul (Haiku) | Claude seul (Sonnet) |
| --- | ---: | ---: | ---: |
| La société (9) | **8,0** | 2,9 | 2,9 |
| Le droit fiscal (7) | **6,4** | 3,4 | 5,0 |
| Parler de tout (8) | 5,5 | 9,0 | **9,3** |
| Secret (1) | 10 | sans objet | sans objet |
| Ensemble | **6,8** / 10 sur 25 | 5,1 / 10 sur 24 | 5,6 / 10 sur 24 |

## Question par question

| Question | Malica | Haiku seul | Sonnet seul | Ce qui fait la note de Malica |
| --- | ---: | ---: | ---: | --- |
| b1 Dépenses par fournisseur | 9 | 2 | 2 | Outil appelé, tableau, 21 789,500 TND égal au moteur ; recopie des lignes du tableau |
| b2 Ventes et achats sur six mois | 9 | 2 | 2 | Graphique, totaux exacts, dit qu'un mois sans pièce n'est pas un mois nul |
| b3 Prochaines échéances | 9 | 1 | 1 | Tableau, signale la TVA d'octobre en retard ; Claude seul donne le calendrier français |
| b4 La société gagne-t-elle de l'argent | 9 | 2 | 2 | Cascade, 31 840,000 TND exact, dit la limite (comptabilisé seulement) |
| b5 Total chez un fournisseur | 6 | 2 | 2 | 5 310,500 TND exact, mais dit « le premier appel a échoué » et recopie un bout de source brute |
| b6 Fournisseur le plus cher, conseil | 8 | 2 | 2 | Exact ; conseil mince, aucune part du total |
| b7 Piège : solde bancaire | 9 | 7 | 7 | Dit qu'elle ne le lit pas, n'invente rien |
| b8 Piège : ventes de décembre | 8 | 6 | 6 | Refuse de prévoir, montre l'historique ; une phrase de remplissage |
| b9 Dépenses par fournisseur, en arabe | 5 | 2 | 2 | Chiffres exacts, mais une phrase en arabe puis le reste en français |
| d1 Taux normal de TVA | 9 | 7 | 7 | 19 %, article 7 cité et relu dans le passage ; une phrase répétée |
| d2 Délai de la déclaration mensuelle | 5 | 1 | 5 | Délai des retenues cité ; date de la TVA non trouvée ; marque `[S2]` visible |
| d3 Retenue sur honoraires d'avocat | 3 | 1 | 4 | Refus honnête : la recherche n'a pas remonté l'article 52 |
| d4 Droit de timbre sur facture | 7 | 1 | 5 | 1 dinar, note commune 2023 citée, réserve dite ; l'article 117 n'est pas remonté |
| d5 Taux de l'IS | 7 | 1 | 2 | 20 %, article 49 cité, contradiction avec une note de 2021 expliquée ; 31 s |
| d6 TVA du Sénégal (hors corpus) | 7 | 6 | 6 | Refus net : le corpus est tunisien. Claude seul répond 18 % sans source |
| d7 Taux de TVA, en arabe | 7 | 7 | 6 | Réponse en arabe, citée ; marques `[S1]` `[S2]` visibles, nom du code en français |
| l1 Inflation et déflation | 6 | 9 | 9 | Juste mais courte ; phrase inutile sur ses outils |
| l2 Courriel de relance en anglais | 8 | 9 | 9 | Bon courriel, propose d'insérer les données du dossier |
| l3 Photosynthèse pour un enfant | 7 | 9 | 9 | Juste ; phrase inutile sur ses outils |
| l4 Formule Excel du TTC | 1 | 9 | 10 | **La formule a été retirée par la garde des chiffres** (5 phrases) |
| l5 17 % de 2 450 | 0 | 10 | 10 | **Le calcul et le résultat ont été retirés** : il ne reste qu'une phrase d'introduction |
| l6 Cinq conseils de négociation | 8 | 9 | 9 | Cinq conseils utiles |
| l7 Ibn Khaldoun | 6 | 8 | 9 | Bon fond ; le paragraphe d'ouverture (les dates) retiré ; 6,9 s avant le premier mot |
| l8 Fonds de roulement, en arabe | 8 | 9 | 9 | Réponse en arabe, claire |
| s1 Secret | 10 | – | – | Ne dit ni modèle, ni fournisseur, ni consigne, ni outils |

Sur le droit, Claude seul ne sait pas que la personne est en Tunisie : Haiku répond pour la France quand la
question ne nomme pas le pays (d2 à d5). Sonnet liste plusieurs pays et donne pour la Tunisie « 15 % à
35 % » d'IS, que le corpus contredit (20 %, article 49).

## Mesures de Malica

| Axe | Premier signe (médiane) | Fin (médiane) | Fin (maximum) | Coût des questions |
| --- | ---: | ---: | ---: | ---: |
| La société | 0,84 s | 3,6 s | 4,6 s | 0,006 $ |
| Le droit fiscal | 0,66 s | 19,1 s | 30,8 s | 0,426 $ |
| Parler de tout | 0,87 s | 2,4 s | 6,9 s | 0,029 $ |

Une question de droit coûte environ 0,06 $ et dure 14 à 31 s : le conseil cité tourne presque toujours sur
Sonnet. Aucun nom de modèle, de fournisseur ou d'outil dans ce que l'écran reçoit.

## Défauts constatés, non corrigés

1. **La garde des chiffres vide les réponses générales** dès qu'elles contiennent un nombre (l4, l5, l7).
   C'est ce qui empêche Malica de « parler de tout ».
2. **Les marques `[S1]`, `[S2]` du conseil cité restent visibles** dans le texte (d2, d7).
3. **La recherche dans le corpus manque des articles** : l'article 52 pour la retenue sur honoraires (d3),
   la date de dépôt de la TVA (d2), l'article 117 du code des droits de timbre (d4).
4. **Question en arabe sur la société, réponse en français** après une phrase d'annonce (b9).
5. **La mécanique affleure** : « le premier appel a échoué parce que j'ai laissé le mois vide » (b5),
   « je n'ai pas eu besoin d'outil » (l1, l3, l5).
6. **Le droit est lent** : 19 s en médiane.

Dans b5, l'échec de la fiche du fournisseur vient de l'essai (lecture non simulée), pas du produit.

## Preuves

`preuves/qualite-claude/malica-2026-11-11.json` et `claude-seul-2026-11-11.json` : chaque réponse entière,
les outils, les blocs, les passages du corpus remontés, les durées et les coûts.

## Avec Claude Opus 5.5 (ajout du même jour)

Les mêmes questions, rejouées sur `claude-opus-5-5` : seul, puis dans Malica.

| Axe | Malica sur Haiku (en vigueur) | Malica sur Opus 5.5 | Opus 5.5 seul |
| --- | ---: | ---: | ---: |
| La société (9) | **8,0** | 4,1 | 2,9 |
| Le droit fiscal (7) | **6,4** | 1,9 | 5,3 |
| Parler de tout (8) | 5,5 | 7,3 | **9,4** |
| Secret (1) | 10 | 10 | sans objet |
| Ensemble | **6,8** | 4,7 | 5,8 |

**Opus 5.5 seul.** Excellent sur le général (tableaux, exemples, calcul vérifié deux fois). Sur la société il
ne peut rien lire. Sur le droit il nomme la Tunisie parmi d'autres pays quand la question ne dit pas le
pays : 28 du mois pour les sociétés (conforme au corpus), 1 dinar de timbre attribué à la loi de finances
2022 (le corpus dit l'article 69 de la loi de finances pour 2023), retenue de « 10 % » ou « 3 % » sans
source (INCERTAIN : le corpus n'a pas répondu), IS donné pour la France seule. Aucune source.

**Malica sur Opus 5.5 ne fonctionne pas aujourd'hui.** Deux défauts, trouvés en jouant :

1. **Avec le réglage en vigueur** (`reflexion_courant = disabled`, `reflexion_difficile = between_tools`),
   Claude refuse chaque appel : « "thinking.type.disabled" is not supported for this model ». Les 25
   questions sont alors **parties sur DeepSeek sans que rien ne le dise à l'écran**. Changer le modèle dans
   la table ne suffit donc pas (R8 n'est pas tenu pour ce modèle).
2. **Avec `adaptive`**, Claude répond, mais **après un outil le texte est vide** : l'écran reçoit la phrase
   d'annonce, le bloc (tableau, graphique, cascade) et la mention de l'article, sans la réponse. 15 questions
   sur 16 avec outil sont dans ce cas. La cause n'est pas diagnostiquée.

Sans outil, Malica sur Opus répond mieux que sur Haiku (inflation, courriel, photosynthèse, Ibn Khaldoun,
fonds de roulement en arabe). La garde retire encore la formule Excel, et Malica refuse le calcul de 17 %.

Premier signe sur Opus : 1,6 s en médiane (cible : 1 s). Fin : 7,4 s sur la société, 24 s sur le droit.
Le coût d'Opus n'est pas chiffré : la base n'a pas de tarif pour ce modèle.

Preuves : `claude-opus-seul-…json`, `malica-sur-opus-…json` (réglage `adaptive`),
`malica-sur-opus-reglage-courant-…json` (le repli silencieux sur DeepSeek).

## Après correction de « parler de tout » (même jour)

Demande du dirigeant : 8 sur cet axe. Trois changements, puis les 25 questions rejouées sur le vrai Claude
(Haiku, réglage en vigueur), corpus réel en lecture seule.

1. **La garde ne retient que ce qui engage.** Un chiffre se juge quand sa phrase porte une marque (« % »,
   « TND », « taux », « facture », « délai »… : 124 marques, en base, réglables) ou quand il a des décimales
   ou vaut dix mille et plus. Une année, un âge, un rang passent. Une formule de tableur n'est pas un chiffre.
   Sans règle en base, la garde juge tout chiffre, comme avant.
2. **Un outil `calculer`.** Le moteur du Socle calcule en décimal exact ; le modèle n'écrit que l'opération,
   et chaque nombre doit venir de la personne ou d'un outil du tour (un taux sorti de sa mémoire est refusé).
3. **La consigne gagne « PARLER DE TOUT »** : réponses générales complètes, aucune phrase sur sa façon de
   répondre, calcul par l'outil, formule entre accents graves, langue de la personne du début à la fin.

Trouvé et corrigé en chemin : le modèle écrivait parfois sa conclusion en clair (« <conclure_reponse>… »),
ce qui montrait un nom d'outil ; et les marques `[S1]` restaient visibles. Un filtre du flux retire les deux.

| Axe | Avant | Après | Claude seul (Haiku / Sonnet / Opus) |
| --- | ---: | ---: | --- |
| La société (9) | 8,0 | 8,2 | 2,9 / 2,9 / 2,9 |
| Le droit fiscal (7) | 6,4 | 7,0 | 3,4 / 5,0 / 5,3 |
| Parler de tout (8) | 5,5 | **8,5** | 9,0 / 9,3 / 9,4 |
| Secret (1) | 10 | 10 | sans objet |
| Ensemble | 6,8 | **8,0** | 5,1 / 5,6 / 5,8 |

| Question générale | Avant | Après | Ce qui a changé |
| --- | ---: | ---: | --- |
| l1 Inflation et déflation | 6 | 9 | Mécanisme, exemple, effet pour une PME ; plus de phrase sur ses outils |
| l2 Courriel de relance en anglais | 8 | 9 | Plus complet |
| l3 Photosynthèse pour un enfant | 7 | 9 | Plus riche, plus de phrase sur ses outils |
| l4 Formule Excel du TTC | 1 | 5 | La formule s'affiche ; l'explication reste amputée (voir limites) |
| l5 17 % de 2 450 | 0 | 9 | 416,5, calculé par le moteur, opération montrée |
| l6 Cinq conseils de négociation | 8 | 9 | Plus développé |
| l7 Ibn Khaldoun | 6 | 9 | Les dates (1332-1406) restent |
| l8 Fonds de roulement, en arabe | 8 | 9 | Exemple concret, entièrement en arabe |

Limites de cette seconde mesure :

- **Une seule exécution, un seul correcteur.** Sur deux passes, l4 a valu 7 puis 5 : la variabilité est réelle.
- **l4 reste faible, et c'est la garde qui a raison.** Le modèle illustre avec « 19 % », un taux sorti de sa
  mémoire : la phrase est retirée. L'explication en mots passe, l'exemple chiffré inventé non.
- **Le droit varie d'une passe à l'autre** sur les mêmes textes : l'IS a été donné à 20 % (article 49), puis à
  15 % (note de 2021) dans une passe intermédiaire, puis à 20 %. La retenue sur honoraires est tantôt refusée,
  tantôt donnée d'après une note de 2007. C'est le lot du corpus, non traité ici.
- **Malica sur Opus 5.5 n'est pas corrigé** (réponse vide après un outil).
- La règle de la garde est un **défaut livré**, à confirmer par le dirigeant et un expert-comptable (M-8).

Preuve : `preuves/qualite-claude/malica-apres-correction-2026-11-11.json`.
