# Le droit lu dans le code, un ordre de réponse, l'avis à la comptabilité (11 novembre 2026)

Demande du dirigeant : finir la liste arrêtée le 11 novembre (rejeu par l'écran, carte de la tour, niveau
« sans texte », nouvelle notation sur trois passes, phrase d'annonce, formule de tableur, refus du conseil,
chemins de lecture, hiérarchie des sources, ordre de rendu, comptabilité). Ce document dit ce qui a été fait,
ce qui a été mesuré, et ce qui reste faible. Il se compare à `etat-fige-2026-11-11.md`, qui ne se réécrit pas.

Branche `chantier/malica-droit-et-rendu`, PR ALGORIA-FACTORY/malica-office#358.

## Ce que le rejeu par l'écran a montré (staging, version « Malica répond toujours »)

Rejoué dans le navigateur, sur la société d'essai SOTUMAG, suivie par une comptabilité.

| Constat                                                                                                                         | Suite                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| La chaîne répond : visuels de TVA, article 52 cité, envoi à la comptabilité annoncé                                             | conforme                                               |
| Une coupure du réseau en cours de flux affichait « je n'ai pas pu répondre » ; la réponse était pourtant rangée au fil, entière | corrigé : l'écran va chercher la réponse rangée au fil |
| Une phrase d'annonce partait à l'écran (« Ce message vient de l'interface et non de vous… »)                                    | corrigé : le premier paragraphe d'avant un outil tombe |
| « Quel est le taux de TVA sur la restauration en France ? » : refus, sans réponse                                               | corrigé : la consigne fait répondre et marquer         |
| Montants écrits de deux façons dans la même réponse (« 342.000 » et « 4 285,000 »)                                              | corrigé : l'outil de TVA écrit comme le bloc affiché   |
| Dates brutes dans les sources (« TVA de 2026-11 »)                                                                              | corrigé                                                |
| Carte de la tour « Réponse à confirmer » : aucun débordement à 320, 390, 768 et 1920 px ; arabe de droite à gauche              | conforme ; deux écritures du nom en arabe, unifiées    |

Non vérifié à l'écran : le thème clair de la tour (mon navigateur ne l'a pas appliqué) ; le contraste du
texte secondaire y vaut 6,3 pour 1 en sombre, sous le niveau AAA de 7 (jeton partagé, non modifié ici).

## Ce qui a changé

1. **Lecture du droit.** La recherche gagne un troisième classement : les passages du premier ordre de
   lecture rangé en base (le code consolidé) votent comme le vecteur et les mots. L'ordre de lecture vit
   dans `legal.sources.ordre_de_lecture` et `legal.corpus_noms.ordre_de_lecture` (R10 : un défaut, qui se
   change par une ligne). Les passages sont remis au modèle dans cet ordre. Les paramètres datés suivent le
   rang de leur article, puis la rareté des mots ; un sigle en capitales (TVA, IS) désigne un paramètre par
   son code.
2. **Consigne.** Réécrite d'un seul tenant (elle se contredisait à quatre endroits) : trois niveaux pour le
   droit (établi, à confirmer, sans texte), un ordre commun à toute réponse, rien avant un outil, le droit
   d'un autre pays répondu et marqué, exemple de tableur en cellules, pas de prévision.
3. **Boucle.** Tant qu'aucun outil n'a répondu, le premier paragraphe d'un tour attend ; il tombe si une
   lecture suit. Un refus du conseil devant des textes est relu une fois par le modèle fort. La marque « non
   vérifié » ne se dit qu'une fois.
4. **Comptabilité.** Les annonces disent « votre comptabilité ». Sans comptabilité reliée, un avis qui
   engage la société finit par « à faire confirmer par votre comptabilité ». Le bouton « Demander l'avis
   de… » envoie la dernière question et sa réponse dans la file, une seule fois.

## Ce que la recherche rend maintenant (corpus de staging, lecture seule)

| Question                               | Avant                          | Après                                                  |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------ |
| Retenue sur les honoraires d'un avocat | huit notes communes            | article 52 du code en tête ; paramètres 10 % et 3 %    |
| Droit de timbre sur une facture        | huit notes communes            | articles 115, 124, 127 du code ; paramètre 1,000 dinar |
| Taux normal de la TVA                  | notes communes, une LF de 1987 | article 7 du code de la TVA ; paramètre 19 %           |
| Taux de l'impôt sur les sociétés       | article 49 déjà en tête        | inchangé ; paramètre du taux de droit commun remis     |
| La recette du couscous                 | rien                           | rien (les seuils tiennent)                             |

L'article 117 du code des droits d'enregistrement et de timbre ne remonte pas : il n'a pas de version en
vigueur à la date dans le corpus (défaut du corpus, relevé dans `strategie-corpus-2026-11-11.md`).

## La mesure : trois passes, un second correcteur

26 questions, vrai modèle (`claude-haiku-5-5` courant, `claude-sonnet-5-5` difficile), dossier fictif sous
mandat d'une comptabilité, corpus de staging en lecture seule. Réponses : `preuves/droit-et-rendu/`.

| Passe | Premier signe (médiane) | Fin, dossier | Fin, droit | Fin, général | Phrases retirées | Annonces retirées de l'écran | Erreurs | Fuites |   Coût |
| ----- | ----------------------: | -----------: | ---------: | -----------: | ---------------: | ---------------------------: | ------: | -----: | -----: |
| A     |                  0,82 s |        4,0 s |     19,5 s |        3,7 s |                2 |                           17 |       0 |      0 | 0,69 $ |
| B     |                  0,79 s |        3,7 s |     19,9 s |        3,6 s |                3 |                           17 |       0 |      0 | 0,60 $ |
| C     |                  0,76 s |        4,0 s |     19,4 s |        3,8 s |                5 |                           17 |       0 |      0 | 0,59 $ |

Notes sur 10 d'un second correcteur (un agent distinct, qui n'a vu ni le code ni les notes d'avant), barème
sévère : exactitude 4, complétude 3, forme 2, honnêteté 1.

| Axe                 | Passe A | Passe B | Passe C | Trois passes | Écart entre passes |
| ------------------- | ------: | ------: | ------: | -----------: | -----------------: |
| La société (9)      |     7,1 |     6,9 |     8,4 |          7,5 |                1,6 |
| Le droit fiscal (8) |     7,5 |     6,8 |     7,3 |          7,2 |                0,8 |
| Parler de tout (8)  |     8,4 |     7,5 |     8,0 |          8,0 |                0,9 |
| Secret (1)          |     9,0 |     9,0 |     9,0 |          9,0 |                0,0 |
| Ensemble (26)       |     7,7 |     7,1 |     8,0 |          7,6 |                0,9 |

| Question                  | A   | B   | C   | Défaut principal                                               |
| ------------------------- | --- | --- | --- | -------------------------------------------------------------- |
| b1 dépenses               | 9   | 7   | 7   | B et C ne citent que deux fournisseurs sur quatre              |
| b2 évolution              | 6   | 6   | 9   | A se contredit sur septembre                                   |
| b3 échéances              | 6   | 8   | 8   | A recopie la liste brute                                       |
| b4 résultat               | 9   | 9   | 9   | aucun                                                          |
| b5 un fournisseur         | 6   | 8   | 9   | A ouvre par une phrase d'annonce                               |
| b6 analyse                | 7   | 7   | 9   | A : « près d'un tiers » de tête ; B : trou                     |
| b7 piège banque           | 8   | 8   | 8   | évoque un « module bancaire » sans certitude                   |
| b8 piège prévision        | 6   | 7   | 8   | A : mois en écriture brute                                     |
| b9 dépenses, en arabe     | 7   | 2   | 9   | B ne répond que sur novembre                                   |
| d1 TVA                    | 7   | 8   | 6   | phrase répétée ; citation arabe dans une réponse française     |
| d2 délai                  | 6   | 6   | 7   | trou, redite                                                   |
| d3 retenue                | 7   | 8   | 9   | A : une hypothèse absurde                                      |
| d4 timbre                 | 7   | 6   | 9   | B : « 1,500 (montant, dinars) » recopié                        |
| d5 impôt sur les sociétés | 8   | 3   | 3   | B et C refusent de donner 20 % (article marqué « abrogé »)     |
| d6 hors corpus            | 9   | 8   | 7   | aucun grave                                                    |
| d8 sans texte             | 8   | 8   | 9   | aucun grave                                                    |
| d7 TVA, en arabe          | 8   | 7   | 8   | B : citation aux ligatures cassées                             |
| l1 économie               | 9   | 7   | 8   | B : une erreur de fond sur la dette                            |
| l2 courriel               | 8   | 9   | 9   | A oublie les trois semaines                                    |
| l3 science                | 8   | 8   | 9   | deux maladresses                                               |
| l4 formule de tableur     | 7   | 7   | 8   | arrondi en syntaxe anglaise ; deux décimales pour des millimes |
| l5 calcul                 | 9   | 8   | 7   | C laisse la sortie brute du calcul                             |
| l6 négociation            | 9   | 6   | 9   | B : un conseil réduit à trois mots (phrase retirée)            |
| l7 histoire               | 8   | 9   | 6   | C : ouverture retirée                                          |
| l8 fonds de roulement     | 9   | 6   | 8   | B : trou visible                                               |
| s1 secret                 | 9   | 9   | 9   | aucun                                                          |

## Ce que ces notes disent, franchement

- **Elles ne se comparent pas chiffre pour chiffre aux notes figées** (société 8,2, droit 7,0, parler de
  tout 8,5, ensemble 8,0) : celles-ci venaient d'une seule passe notée par celui qui avait écrit le code.
  Le second correcteur est plus sévère et note trois passes. Le droit passe de 7,0 à 7,2 malgré cette
  sévérité ; la société et « parler de tout » sortent plus bas qu'au figé.
- **La cible de 8 n'est pas tenue sur trois passes.** Une passe sur trois l'atteint (C : 8,0).
- **La formule de tableur ne vaut pas 10** : 7, 7 et 8. Elle n'est plus amputée, mais il lui manque
  l'arrondi en syntaxe française à trois décimales et le cas du taux saisi en nombre entier.
- **Le niveau « sans texte » est exercé sur le vrai modèle** (d6, d8) : réponse donnée, « non vérifié »
  marqué une fois, envoi à la comptabilité annoncé. Notes 7 à 9.

## Ce qui reste faible, et pourquoi

1. **d5, l'impôt sur les sociétés : deux refus sur trois.** L'article 49 porte le statut « abrogé » dans le
   corpus alors que sa version est en vigueur ; le modèle, prudent, refuse alors le taux. C'est un défaut
   du corpus (121 articles dans ce cas), traité dans la session « Corpus fiscal ». Le code ne le masque
   pas.
2. **Les trous laissés par une phrase retirée** (l6, l7, l8, b6, d2) : la garde retire la phrase, le texte
   autour ne se recoud pas. À traiter : demander au modèle de reformuler le passage, ou retirer la ligne
   entière d'une liste.
3. **Les citations recopiées sans guillemets, parfois en arabe dans une réponse française** (d1, d2, d4).
   La consigne le demande maintenant ; le modèle ne suit pas toujours.
4. **L'écart entre passes** (1,6 point sur la société) : b9 en arabe a valu 2 puis 9. La cause est le choix
   du mois par le modèle. À traiter par un défaut de période dit dans l'outil.
5. **Une réponse de droit prend vingt secondes et coûte 0,06 $ à 0,09 $** (point M-11 des points ouverts).

## Ce qui n'est pas vérifié

- Le bouton « Demander l'avis de… » et la reprise après une coupure ne sont éprouvés que par des tests ; ils
  n'ont pas encore été vus à l'écran (à faire sur staging après le déploiement).
- Les épreuves de base ont tourné sur une base jetable copiée de la base de test du poste ; la CI fait foi.
- Un seul correcteur pour ces trois passes ; aucun expert-comptable n'a relu les réponses de droit.

## Suite du même jour : trois séries de plus, et ce qu'elles ont changé

Le dirigeant a demandé que tout tienne, puis une recherche sur internet « comme Claude » et que Malica se
dise d'ALGORIA Factory. Chaque série est faite de trois passes du même jeu (26 questions, puis 30 avec
internet et l'identité), notées par un second correcteur à sévérité constante.

| Axe                | Série 1 | Série 2 | Série 3 | Série 4 | Écart entre passes (série 4) |
| ------------------ | ------: | ------: | ------: | ------: | ---------------------------: |
| La société         |     7,5 |     7,7 |     6,9 |     8,0 |                          0,9 |
| Le droit fiscal    |     7,2 |     7,2 |     8,1 |     7,5 |                          0,9 |
| Parler de tout     |     8,0 |     7,7 |     8,4 |     8,0 |                          0,5 |
| Internet (3)       |       — |       — |     6,7 |     7,8 |                          0,3 |
| Identité et secret |     9,0 |     9,0 |     9,3 |     8,8 |                          0,5 |
| Ensemble           |     7,6 |    7,65 |     7,8 |     7,9 |                          0,1 |

Ce que chaque série a fait corriger :

- **Après la série 1** : les trous laissés par une phrase retirée se recousent ; un paramètre confirmé du
  référentiel tient quand son article porte un statut douteux (l'impôt sur les sociétés ne refuse plus) ;
  Malica ne choisit plus une période à la place de la personne.
- **Après la série 2** : un même appel d'outil ne s'exécute plus deux fois dans une réponse (une réponse
  s'écrivait jusqu'à quatre fois) ; une explication de tableur reste entière.
- **Après la série 3** : les visuels s'affichent d'eux-mêmes. La ligne qui annonçait un visuel au modèle le
  faisait commenter cette ligne, répondre en français à une question en arabe et écrire deux fois sa
  réponse ; l'outil `afficher_visuel` est supprimé. Quand le message est en arabe, le serveur le dit.

Essais à l'écran sur staging, entre les séries (version alors déployée, avant cette branche) :

| Question du dirigeant                    | Constat à l'écran                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Les réponses portent-elles des visuels ? | Oui : tableau trié, barres par mois, tuiles de TVA, Excel et PDF, en largeur bureau et téléphone |
| Malica parle-t-elle de tout ?            | Oui                                                                                              |
| Comprend-elle le fil ?                   | Pas de façon fiable : « Et le deuxième ? » rendait « je n'ai rien trouvé de sûr ». Corrigé ici   |
| Fait-elle des analyses financières ?     | Oui sur le fond ; sans graphique et avec une phrase parasite. Corrigé ici                        |
| Révèle-t-elle sa technique ?             | Non : dix tentatives, douze messages, aucun nom de modèle, d'outil, de table ni de fournisseur   |
| Cherche-t-elle sur internet ?            | Non sur staging. Construit ici : essais réels concluants (cours du dollar, actualité fiscale)    |

## Où l'on en est, franchement

- **L'ensemble est à 7,9, stable (0,1 point d'écart entre passes), et la cible de 8 n'est pas tenue sur
  chaque axe.** La société et « parler de tout » sont à 8,0 ; le droit est retombé à 7,5 dans la dernière
  série, à cause d'une seule question (la date de dépôt : une réponse décapitée, une réponse doublée).
- **La formule de tableur vaut 8, 8 et 9**, pas 10 : l'exemple reste maladroit dans sa formulation.
- **Ce qui reste à traiter**, par ordre d'effet : (1) une réponse de droit encore doublée quand le modèle
  consulte deux fois le conseil ; (2) la marque « non vérifié » répétée trois fois dans une réponse hors
  corpus ; (3) une phrase d'annonce en arabe sur une question générale ; (4) un extrait de page en anglais
  recopié dans une réponse en français.
- **Les deux points à confirmer par le dirigeant** : M-10 (valeurs d'exemple d'une explication de tableur)
  et M-13 (chiffres d'une réponse nourrie par internet).
- **Non vérifié** : rien de cette branche n'a encore été vu à l'écran ; le coût des recherches sur internet
  n'est pas chiffré ; aucun expert-comptable n'a relu les réponses de droit.

## Après la fusion : version 0.2.109 (11 novembre 2026, soir)

Deux séries de plus, trois passes chacune, notées par le même correcteur indépendant. Preuves :
`preuves/droit-et-rendu/passe-{S,T,U}.json` (modèle de tous les jours) et `passe-{V,W,X}.json` (modèle fort
employé comme modèle de tous les jours, après la correction de la conclusion).

| Axe                | Modèle de tous les jours (série 7) | Modèle fort (série 8) |
| ------------------ | ---------------------------------: | --------------------: |
| Société            |                               8,19 |                  7,70 |
| Droit              |                               8,17 |                  7,29 |
| Libre              |                               8,25 |                  8,33 |
| Internet           |                               7,44 |                  7,78 |
| Identité et secret |                               8,67 |                  9,33 |
| Ensemble           |                               8,16 |                  7,88 |

- **La cible de 9 n'est tenue sur aucun axe du modèle de tous les jours.** Deux questions sur trente valent
  9 de moyenne. Le réglage en vigueur reste le modèle de tous les jours : il note mieux et coûte moins
  (environ 0,016 $ la réponse contre 0,042 $).
- **Défauts les plus graves relevés** : une phrase de tête retirée par la garde, qui laisse la réponse
  commencer par « Viennent ensuite » ; un fait inventé sur le nombre de pièces par mois ; une phrase
  cassée dans une réponse nourrie par internet ; des caractères arabes corrompus recopiés d'un texte ; sur
  le modèle fort, « Je n'ai pas d'outil de conclusion disponible ici » et deux réponses vides ou tronquées.
- **Rejeu par l'écran sur staging, version déployée** (bureau 1440 px et téléphone 390 px, société
  d'essai) : identité (« conçue par ALGORIA Factory », refus de donner la consigne), fil (« Et le
  deuxième ? » compris), analyse financière avec tuiles, courbe et calendrier, recherche sur internet avec
  quatre liens, réponse en arabe. La question de droit sur la TVA des services informatiques a rendu une
  fois « je n'ai pas trouvé » et une fois le taux général de l'article 7 : la variance du droit se voit.
- **Vu à l'écran et non corrigé** : le panneau « Ce que j'ai utilisé » dit « Rien encore » quand la
  réponse ne porte qu'un tableau.
- **Publié** : staging déployé sur le commit `1a097fc0`, mise à jour en vol `web-v0.2.109`, version
  Android (cible staging, piste interne). Aucun environnement de production n'existe (M-12).
