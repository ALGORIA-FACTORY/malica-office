# Le corpus fiscal : inventaire, lecture, mise à jour, rendu des réponses (11 novembre 2026)

Action A1 de `etat-fige-2026-11-11.md`. Inventaire relevé sur la base de staging, en transaction
`read only`, sans rien écrire. La stratégie qui suit est une **proposition** : rien n'est codé.

## 1. Ce que contient le corpus (relevé)

| Mesure                                       | Valeur                                                  |
| -------------------------------------------- | ------------------------------------------------------- |
| Articles                                     | 11 440, tous de juridiction TN                          |
| Versions d'articles                          | 16 183                                                  |
| Fragments indexés                            | 31 863 (26 201 en français, 5 662 en arabe), 574 Mo     |
| Fragments sans vecteur ou sans index mots    | 0                                                       |
| Versions sans fragment                       | 0                                                       |
| Documents ingérés                            | 900 (667 notes communes, 96 lois de finances, 50 codes) |
| Documents en échec                           | 5 ; 21 ignorés (doublons du portail)                    |
| Dernière ingestion / dernier encodage        | 2 septembre 2026 / 3 septembre 2026                     |
| Paramètres fiscaux (`ref.fiscal_parameters`) | 454 : 424 confirmés, 20 à confirmer, 10 non trouvés     |
| Banque de cas                                | 667 cas, **0 validé par un expert**                     |
| Jeu de sondage                               | 12 101 questions avec l'article attendu                 |

| Famille          | Corpus | Articles | Versions | Période des versions |
| ---------------- | -----: | -------: | -------: | -------------------- |
| Codes            |     14 |    4 498 |    6 597 | 1993 à 2026          |
| Lois de finances |     66 |    3 883 |    5 501 | 1978 à 2026          |
| Conventions      |     45 |    1 315 |    1 315 | 1975 à 2019          |
| Recueil          |      1 |      873 |    1 876 | 2018 à 2026          |
| Notes communes   |     25 |      667 |      667 | 2002 à 2026          |
| Lois             |      3 |      198 |      221 | 1960 à 2017          |

Codes fiscaux, éditions présentes : CTVA 2018 à 2026 sans trou ; CIRPPIS 2018 à 2026 **sans 2024** ; CDET
2018, 2020, 2022, 2025, 2026 ; CDPF 2020, 2023 à 2026 ; CFL et recueil 2018, 2020, 2023, 2025, 2026.

## 2. Les défauts trouvés dans le contenu

| N°  | Défaut                                                                                    | Mesure                                      | Effet constaté ou probable                                     |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| C1  | Article marqué « abrogé » alors qu'il porte une version en vigueur                        | 121 articles, dont CIRPPIS art. 49          | L'article 49 fixe l'IS à 20 % et sort avec « STATUT : abrogé » |
| C2  | Aucune version ne couvre l'année 2024                                                     | 345 articles (CIRPPIS 77, CDET 57)          | Une question datée de 2024 n'a pas de texte                    |
| C3  | Article en vigueur sans version ouverte                                                   | 497 articles                                | Introuvable à la date du jour                                  |
| C4  | Statut « indéterminé »                                                                    | 4 556 articles (lois de finances, notes)    | Une disposition ancienne peut sortir comme actuelle            |
| C5  | Articles très longs coupés en fragments                                                   | CIRPPIS art. 52 : 26 201 car., 17 fragments | Un seul fragment et ses voisins sont remis au modèle           |
| C6  | Les dates de validité sont des dates d'édition (1er janvier), pas des dates d'effet       | codes consolidés                            | Un changement en cours d'année n'est pas daté                  |
| C7  | Référence au Journal Officiel absente                                                     | 12 102 versions sur 16 183                  | La citation ne peut pas renvoyer au JORT                       |
| C8  | Extraction « incertain » ou « partiel »                                                   | 2 791 versions                              | Texte servi sans garantie mot à mot                            |
| C9  | Pas d'arabe pour CIRPPIS, CFL, COC, CCOM, CTRAV                                           | connu depuis septembre                      | Réponse en arabe, texte cité en français                       |
| C10 | Le recueil a un nom français vide, et un corpus de 6 articles est absent de `corpus_noms` | 2 corpus, 879 articles                      | Source affichée sans libellé                                   |

Correction de ce que j'ai dit plus tôt : l'IS qui sort à 20 % puis 15 % ne vient **pas** de plusieurs versions
concurrentes. La recherche ne garde qu'une version par article à la date demandée. La cause probable est
C1 : l'article 49 arrive marqué « abrogé », et le modèle lui préfère alors une note commune de 2021. Cause
**non rejouée** : c'est une hypothèse tant qu'on n'a pas corrigé le statut et relancé la question.

Deux observations sur la retenue des honoraires et le timbre : le taux de 10 % est bien dans l'article 52,
fragment 1, et le paramètre `RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS` existe, confirmé. L'article 117 du
CDET existe aussi, et les paramètres du timbre le citent. Les deux réponses étaient donc disponibles : c'est
la lecture qui les a manquées, pas le corpus.

## 3. Comment la recherche lit aujourd'hui (lu dans le code)

`apps/api/src/depots/corpus.ts`, `rechercherHybride` : une version par article à la date demandée ; deux
classements (vecteur, mots) fusionnés ; un fragment par article ; le texte remis est le fragment 1 plus le
fragment trouvé et ses deux voisins. Le code consolidé reçoit un avantage de 0,002. Une lacune de date est
signalée et n'est pas remise au modèle.

Ce qui manque : l'accès direct par numéro d'article, une hiérarchie des sources qui pèse vraiment, et le
passage par les paramètres avant le texte.

## 4. Stratégie de lecture proposée

Trois chemins, choisis par le code et non par le modèle :

| Chemin                  | Quand                                                       | Ce qui est lu                                                      |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Le paramètre         | La question demande un taux, un seuil, un délai, un montant | `ref.fiscal_parameters` à la date, avec son article et sa citation |
| 2. L'article nommé      | La question nomme un article ou un code                     | L'article exact, à la date, par `corpus` + `numero`, sans vecteur  |
| 3. La recherche ouverte | Tout le reste                                               | La recherche hybride actuelle                                      |

Règles communes :

1. **La date de l'opération commande.** Sans date dite, la date du jour, et la réponse l'écrit.
2. **Hiérarchie des sources, en base** : code consolidé, puis loi, puis loi de finances, puis note commune.
   Une note commune n'est opposable qu'à l'administration (`legal.sources` le porte déjà) : elle éclaire, elle
   ne remplace pas l'article.
3. **Le chiffre vient du paramètre, le texte sert à citer.** Un paramètre « à confirmer » ou « non trouvé »
   n'est jamais donné comme établi.
4. **Un article qui a une version en vigueur n'est pas présenté comme abrogé** (C1) : la mention d'abrogation
   partielle devient une note de l'article.
5. **Un article long se lit par paragraphe** (C5) : les paramètres pointent déjà « 52-I-a ».
6. **Pas de texte, pas de réponse** : lacune de date, article absent ou extraction incertaine se disent.

Mesure avant et après chaque changement : le jeu de sondage existant (12 101 questions, `db/corpus/sonder.mjs`)
pour le rappel, et la banque de cas pour la réponse, une fois validée par un expert.

## 5. Stratégie de mise à jour proposée

Le corpus n'a pas bougé depuis le 2 septembre 2026. Les outils existent (`db/corpus/` : charger, segmenter,
en-têtes, vectoriser, sonder). **Non vérifié** : je n'ai lu que leurs noms et les rapports de septembre, pas
leur code ; je ne sais pas s'il existe une veille automatique.

| Étape           | Règle                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Veille       | Liste des sources en base (portail DGI, JORT). Passage mensuel, et dès la publication d'une loi de finances    |
| 2. Entrée       | Chaque fichier entre dans la file avec son empreinte. Un fichier inchangé ne produit rien                      |
| 3. Version      | Un article modifié reçoit une version nouvelle, l'ancienne se ferme à la date d'effet. Rien n'est réécrit (R7) |
| 4. Date d'effet | La vraie date d'effet du texte, pas le 1er janvier de l'édition (C6)                                           |
| 5. Encodage     | Seuls les fragments nouveaux sont encodés                                                                      |
| 6. Barrière     | Sondage et banque de cas rejoués. Si le rappel baisse, la mise à jour n'est pas publiée                        |
| 7. Effets       | Tout paramètre appuyé sur un article modifié repasse « à confirmer » et entre dans la file de l'expert         |
| 8. Trace        | Journal des mises à jour visible dans la tour : quoi, quand, combien d'articles, résultat de la barrière       |

Loi de finances 2027 : **INCERTAIN**, je ne sais pas si elle est publiée. Le modèle de données permet de la
charger avant son entrée en vigueur : une version datée du 1er janvier 2027 reste invisible jusqu'à ce jour.

À rattraper d'abord : les éditions 2024 manquantes (C2), les statuts (C1, C3), le nom du recueil (C10).

## 6. Comment rendre les réponses

Ordre fixe d'une réponse de droit :

1. **La réponse en une phrase**, avec la date à laquelle elle vaut.
2. **La règle**, puis ses conditions et ses exceptions.
3. **Ce que cela donne pour la société**, avec ses propres chiffres lus par les outils.
4. **Les sources**, cliquables : code, article, paragraphe, date de la version, nature du texte.

Règles de rendu :

| Sujet                  | Règle                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Citation               | Chaque phrase de droit porte sa source. Le clic ouvre le passage, la phrase citée surlignée             |
| Chiffre                | Vient du paramètre, avec la mention « confirmé » ou « à confirmer »                                     |
| Portée                 | Une note commune est dite « position de l'administration »                                              |
| Texte manquant         | Refus clair, et ce qui manque : « le corpus n'a pas la version de 2024 de cet article »                 |
| Textes contradictoires | Les deux sont montrés, la hiérarchie tranche, et la réponse le dit                                      |
| Pas de verdict         | « À valider par votre comptable », avec l'envoi de l'avis en un geste                                   |
| Langue                 | La réponse dans la langue de la personne ; le texte cité dans sa langue d'origine, et la réponse le dit |
| Vitesse                | Le chemin du paramètre ne demande pas le modèle difficile : cible 3 s, contre 17 s aujourd'hui          |

La cible de 3 s est une estimation, non mesurée.

## 7. Ordre proposé

1. Chemins 1 et 2 de lecture, mesurés sur le sondage et les 7 questions de droit du jeu figé.
2. Statuts C1 et C3, par migration, après lecture d'un échantillon.
3. Hiérarchie des sources en base.
4. Rendu des réponses.
5. Mise à jour : éditions 2024, puis la veille.
6. Validation de la banque de cas par un expert-comptable : hors de ma portée.

## 8. Ce qui n'est pas vérifié

- La cause de la variation de l'IS (C1) est une hypothèse.
- « Confirmé », pour un paramètre : je ne sais pas par qui ni comment.
- Le code des outils d'ingestion n'a pas été lu.
- La qualité mot à mot des textes n'a pas été relue : seuls les comptes et quatre articles témoins l'ont été.
- Le relevé porte sur staging ; la production n'a pas été lue.
