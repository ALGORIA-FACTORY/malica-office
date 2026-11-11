# Malica répond toujours : ce qui a été fait, mesuré et ce qui reste (11 novembre 2026)

Suite de `etat-fige-2026-11-11.md`. Branche `chantier/malica-repond-toujours`, PR #352 (brouillon), partie de
la version figée `40fefdad`. Rien n'est fusionné ni déployé ; staging n'a été que lu.

## La cause trouvée

Le dirigeant constatait que Malica « ne répond presque jamais ». Deux causes, relevées par exécution :

1. **La règle du 4 octobre 2026.** Pour une société suivie par un cabinet, un avis qui engage son dossier
   était retenu : la personne lisait « Votre comptable relit ma réponse », et rien d'autre.
2. **Le modèle oublie de conclure.** Sur le vrai modèle, cinq réponses générales sur huit finissaient sans
   l'outil de conclusion. Leur portée restait « incertaine », et la règle 1 les retenait aussi : une
   explication de l'inflation attendait le comptable.

La mesure figée (8,0) ne le voyait pas : elle tournait sans cabinet rattaché.

## Ce qui change

| Sujet                                    | Avant                                             | Après                                                                                                       |
| ---------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Avis à relire                            | Retenu ; la personne lit le message de relecture  | Affiché en entier, au fil de l'eau, marqué « à confirmer », et envoyé au cabinet                            |
| L'envoi au cabinet échoue                | L'erreur remonte, la réponse est perdue           | La réponse reste ; Malica dit de la faire confirmer, sans annoncer un envoi qui n'a pas eu lieu             |
| Réponse sans conclusion                  | Portée incertaine, donc retenue                   | La conclusion est demandée une fois au modèle ; sans elle, la portée reste incertaine                       |
| Les textes ne répondent pas              | « Rapporte-le, sans ajouter de règle de mémoire » | Malica répond quand même ; un chiffre de mémoire porte la marque « non vérifié » (M-9)                      |
| Montant du dossier sans source           | Retiré                                            | Retiré, inchangé (R2) : la marque ne vaut que si le corpus, consulté, s'est tu                              |
| Chemin de secours (DeepSeek hors boucle) | Retient                                           | Annonce aussi, par le même réglage                                                                          |
| Phrase qui nomme un outil                | Partait à l'écran si le modèle l'écrivait         | Tue par la garde                                                                                            |
| Réglage                                  | En code                                           | En base (`plateforme.assistant_relectures`), carte dans la tour, retour à l'ancienne règle sans déploiement |

Ce qui ne change pas : la règle qui dit quelle réponse est à relire (`doitEtreRelue`), et le fait qu'un
chiffre de mémoire n'entre ni dans un calcul ni dans une écriture.

## Mesure sur le vrai modèle

Deux passes de 25 puis 26 questions, Claude (Haiku courant, Sonnet pour le conseil cité), société fictive
**sous mandat d'un cabinet**, corpus réel de staging en lecture seule. Preuves :
`preuves/qualite-claude/malica-repond-toujours-passe-1-2026-11-11.json` et `…-passe-2-…`.

| Mesure                                                 | Passe 1 (avant la conclusion demandée) |  Passe 2 |
| ------------------------------------------------------ | -------------------------------------: | -------: |
| Réponses affichées à la personne                       |                                25 / 25 |  26 / 26 |
| Réponses retenues                                      |                                      0 |        0 |
| Réponses sans rapport avec le dossier annoncées à tort |                                      5 |        0 |
| Avis annoncés et envoyés au cabinet                    |                       1 (taux de l'IS) |        0 |
| Premier mot, médiane                                   |                                 0,76 s |   0,76 s |
| Fin d'une réponse sur la société, médiane              |                                  3,6 s |    3,8 s |
| Fin d'une réponse de droit, médiane                    |                                 18,1 s |   17,5 s |
| Coût de la passe                                       |                               0,5704 $ | 0,5259 $ |

Sous l'ancienne règle, avec le même cabinet, les six réponses annoncées en passe 1 (cinq sans rapport avec le dossier et
l'avis sur l'IS) auraient été retenues, et aucune réponse n'aurait commencé avant sa fin.

### Notes de l'axe droit, passe 2 (un seul correcteur : Claude Code)

| Question                  |                Figé | Passe 2 | Pourquoi                                                                                      |
| ------------------------- | ------------------: | ------: | --------------------------------------------------------------------------------------------- |
| d1 Taux normal de TVA     |                   9 |       9 | 19 %, article 7, exceptions                                                                   |
| d2 Délai de déclaration   |                   5 |       6 | 28 jours, 20 en télédéclaration, tirés des paramètres ; une ligne de paramètre recopiée brute |
| d3 Retenue sur honoraires |                   3 |       4 | Répond 5 % et 15 % d'après des notes de 2005 et 2007, le dit ; l'article 52 n'est pas lu      |
| d4 Droit de timbre        |                   7 |       8 | 1 dinar, article 117 nommé, portée de la note dite                                            |
| d5 Taux de l'IS           |                   7 |       8 | Donne les deux lectures, retient 20 %, dit ce qu'il faut confirmer                            |
| d6 TVA du Sénégal         |                   7 |       7 | Refus net, propose le côté tunisien                                                           |
| d7 Taux de TVA, en arabe  |                   7 |       2 | Le conseil cité a refusé cette fois ; réponse en français, sans le taux                       |
| **Moyenne**               | 7,0 (moyenne figée) | **6,3** |                                                                                               |

Les notes « figé » par question sont celles d'avant la correction de « parler de tout » (`qualite-claude.md`) ;
seule la moyenne d'après (7,0) avait été consignée.

**La moyenne du droit n'a pas progressé : 6,3 contre 7,0.** La baisse tient à une seule question (d7) : le
conseil cité a refusé alors que dix passages étaient remis, ce qui arrive d'une passe à l'autre. Rejouée deux
fois après un correctif de langue, d7 a répondu en arabe avec 19 % les deux fois. Avec d7 à sa note figée, la
moyenne serait 7,0. Le droit ne montera pas par ce chantier : il dépend de la lecture du corpus (chemins
« paramètre » et « article nommé ») et du corpus lui-même.

Les axes « société » et « parler de tout » n'ont pas été renotés question par question. Constaté sans noter :
les mêmes outils appelés, aucun chiffre retiré sur la société, et la formule de tableur toujours amputée
(trois phrases retirées).

## Défauts vus pendant la mesure

| N°  | Défaut                                                                           | État                                                                       |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Réponse générale sans conclusion, annoncée au comptable                          | corrigé (conclusion demandée), rejoué                                      |
| 2   | Phrase de raisonnement nommant un outil (`afficher_visuel`) affichée             | corrigé (la garde la tait), épreuve                                        |
| 3   | Question en arabe, textes muets : réponse en français                            | consigne de l'outil corrigée ; rejoué 2 fois sans que le cas se reproduise |
| 4   | Phrase de raisonnement en anglais avant un outil, sans nom d'outil               | **non corrigé**                                                            |
| 5   | Article 49 (IS) servi avec une mention d'abrogation ; le modèle hésite           | corpus (défaut C1), non traité ici                                         |
| 6   | Retenue sur honoraires lue dans des notes de 2005 et 2007, pas dans l'article 52 | lecture du corpus, non traité ici                                          |
| 7   | Le conseil cité refuse parfois alors que les passages sont remis                 | non traité ici                                                             |

## Ce qui n'est pas vérifié

- **Le niveau « sans texte » n'a pas été exercé sur le vrai modèle.** La question choisie pour cela (licence
  de débit de boissons) a trouvé ses textes. Le comportement n'est prouvé que par les épreuves simulées.
- **La carte de la tour n'a pas été regardée à l'écran** : ni aux cinq largeurs, ni en arabe, ni en sombre.
  Elle reprend les classes de la carte du plafond ; types, lint et épreuves de la tour passent.
- **Rien n'est joué de bout en bout par l'écran** : le harnais appelle la boucle de l'assistant directement.
- Le retour du comptable dans le fil (confirmé, corrigé, écarté) est le circuit existant : non rejoué ici.
- Une seule passe par état, un seul correcteur.

## Épreuves

- Assistant et conseil, simulées : 89 sur 89 pour l'assistant et la garde, dont 24 nouvelles ; 4 nouvelles sur base pour la carte de la tour.
- Sur une base à part (copie de la base de test, migrations de la branche jouées) : contrat, intégrité,
  portes, section 11, file du cabinet, carte de la tour — tout passe, sauf l'épreuve « portier endossé »,
  qui échoue sur ce poste depuis avant ce chantier.
- Socle 540 sur 540, types, lint, code mort, ordre et reproductibilité des migrations.
