# Préparation à la recette client — PME et comptabilité

Demande de Wissem du 22 octobre 2026 : rendre l'application prévue prête à
la recette client sur Android, web et PWA, pour la PME et la comptabilité.
Base de ce travail : main `787cb8d`, version 0.2.65. Candidate : 0.2.66.

## Décision actuelle

**Pas encore de GO global.** La CI de 0.2.65 était verte et le staging sain ;
cela ne démontre ni la fermeture des 148 remarques UX, ni les parcours Android
sur appareil, ni l'installation PWA, ni les validations comptables/fiscales.
Les seuils de sortie du pilote (six semaines d'observation) dans
`docs/pilote/revue-go-no-go.md` ne sont pas des prérequis à six semaines pour
ouvrir une recette client : les deux décisions restent distinctes.

## Périmètre de recette

| Surface      | Plateformes                      | Parcours inclus                                                                                                                                                                                                                                       |
| ------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PME          | Android, web desktop/mobile, PWA | Accès, société, fiche fiscale, capture caméra et imports, multipage, lecture, corrections, bibliothèque, privé, transmission, règlements, échéances, charges/TVA, assistant, notifications, réglages et invitations                                   |
| Comptabilité | Web desktop/mobile, PWA          | Mise en route, clients et mandats, équipe/affectations, file de pièces, contrôle/validation/supervision, règlements, plan, TVA, banque/rapprochement, immobilisations, stocks, honoraires, abonnements clients, FEC/exports, conseil et notifications |
| Transversal  | Toutes les surfaces applicables  | Isolation, rôles, audit, idempotence, sessions, langues FR/EN/AR, thèmes, clavier, responsive, erreurs, reprise réseau et mise à jour                                                                                                                 |
| Exploitation | Services et administration       | Référentiel versionné, coût IA, licences/quotas, sauvegarde/restauration, supervision et versions distribuées                                                                                                                                         |

La comptabilité reste web/PWA. Android n'affiche ni achat d'abonnement,
ni recharge commerciale, ni lien ou redirection de paiement. L'enregistrement
du règlement d'une facture de l'entreprise reste une fonction métier distincte.

Les maquettes sont des propositions visuelles, jamais la preuve d'une fonction
livrée. Une mention « à venir » ne vaut pas une fonction acceptée en recette.
Toute fonction historiquement différée doit rester listée comme telle et être
arbitrée explicitement ; on ne l'efface pas de la couverture pour obtenir un GO.

## Premier lot de corrections

- Le bouton central « Ajouter une pièce » ouvre le parcours `/pme/capturer`,
  où les trois sources sont disponibles avant toute demande de caméra.
- Les trois choix sont placés AVANT l'aperçu ; leur présence dans le premier
  écran visible est vérifiée. Des captures de preuve sont jointes aux tests.
- L'import d'images utilise `files.pickImages()` (plusieurs images, sans
  capture caméra imposée). Le bouton Galerie appelait `takePhoto()`.
- Un nouvel ajout depuis une étape déjà ouverte réinitialise les seuls états
  de vue. Les pièces déposées et la file durable sont conservées. Un test
  importe deux PDF réels via le site et l'API puis vérifie ce nouveau départ.
- Les services de préparation, de file locale, de dépôt, de quota et de lecture
  restent les services existants ; aucun second circuit de dépôt n'est ajouté.
- Les noms des espaces du portail ne les limitent plus artificiellement au
  mobile ou au web ; les libellés concernés sont fournis en FR/EN/AR.
- Tests navigateur : sélecteurs de fichiers réels (types, multi-sélection,
  annulation), faux PDF refusé, retour à l'accueil, ouverture des routes
  PME/comptabilité à 390 et 1440 px et absence de débordement de page.
- La TVA nulle et la TVA inconnue sont distinguées d'un crédit, sur l'accueil
  et le détail ; une TVA collectée nulle ne remplit plus sa barre. Aucun
  montant du moteur n'est recalculé.
- Le flux Android d'abandon du scanner suit désormais les deux étapes
  Ajouter une pièce puis Photographier. La CI Android est aussi déclenchée
  sur les PR qui modifient ce parcours, au lieu d'attendre la nuit.

Le dépôt des deux PDF teste l'import réel, mais pas la lecture OCR réelle ni
la transmission et la comptabilisation intégrales d'une facture. Les parcours d'ouverture ne
prouvent pas les écritures, calculs ou permissions de tous les rôles.

## Conditions de GO pour remettre la candidate au client

| Contrôle                 | Preuve exigée                                                                                                                                          | État à l'ouverture de ce lot                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Candidate figée          | Commit et versions API/web/coque/bundle relevés                                                                                                        | À consolider après CI                                               |
| Technique                | CI complète verte sur le commit candidat                                                                                                               | 0.2.65 verte ; candidate à exécuter                                 |
| PME ↔ comptabilité       | Pièce → lecture citée → correction → transmission → validation/supervision → règlement → restitution/export réconciliés, deux comptes réels de recette | À rejouer sur candidate                                             |
| Rôles et isolation       | Expert, collaborateur affecté/non affecté, dirigeant, siège, mandats révoqués ; refus API et téléchargement                                            | Tests API existants, contre-recette candidate requise               |
| OCR et IA réels          | Corpus français dont énergie/assurance, noms fournisseurs, montants et lignes ; vraie chaîne avec clés de l'environnement, abstention explicite        | Réserves connues à reproduire, pas clôturées ici                    |
| Fiscal/comptable         | Décisions Mondher ANO-010/015/020/021 et forfait, TVA cabinet issue du grand livre, résultat attendu signé                                             | Validation métier manquante dans les preuves disponibles            |
| Android                  | APK/bundle correspondant, flux émulateur verts et points bloquants du protocole sur appareil                                                           | Émulateur à relancer ; appareil non accessible ici                  |
| Web/PWA                  | Desktop/mobile, installation réelle, redémarrage, mise à jour, hors ligne cohérent sans succès trompeur                                                | Tests d'ouverture ajoutés ; installation réelle à exécuter          |
| Commercial               | Web/PWA jusqu'au résultat du prestataire, échec/annulation/reprise ; Android sans accès commercial                                                     | Paiement intégral non prouvé ici                                    |
| Langues/accessibilité/UX | FR/EN/AR, RTL, tailles, thèmes et clavier ; chaque remarque reliée à sa contre-preuve                                                                  | 148 remarques conservées dans le registre, pas clôturées par défaut |
| Exploitation             | Restauration récente exécutée, alertes, dossier d'essai et scénario client préparés                                                                    | Preuves à relever, sans supposer qu'une ancienne note est actuelle  |

**GO** : chaque contrôle applicable prouvé, aucun défaut bloquant/critique ou
majeur sur le périmètre prévu, aucun écart métier non expliqué. Une preuve
absente reste « non exécuté » ou « bloqué », jamais « réussi ».

## Suivi sans perte de périmètre

- `registre-ux-pme.md` conserve les 148 remarques et leur capture d'origine.
- `ecrans.md` conserve les routes du dépôt, y compris les détails avec paramètres.
- `docs/protocole-appareils.md` et `docs/pilote/appareils.md` portent les épreuves
  qui nécessitent un téléphone. Les cases vierges ne valent pas des réussites.
- `docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md` conserve les décisions
  et dettes ; les notes historiques doivent être reproduites avant correction.

Pour Claude : partir de la branche/PR de ce lot, conserver le registre, ne pas
remplacer le code livré par une maquette. Les règles fiscales, taux et prix ne
sont pas modifiés. Toute nouvelle correction se rattache à une reproduction,
un test approprié, une version et une preuve de contre-recette.

## Lot suivant — 0.2.68

La totalité d'un règlement n'est plus présélectionnée. La personne choisit
la totalité ou une partie, puis le moyen ; le choix est remis à vide après
inscription. « Non payé » reste possible sans montant fictif. Les fractions
arrondies à zéro et les montants hors entier sûr sont refusés dans la vue.

L'historique des paiements doit avoir répondu avant toute nouvelle inscription.
Sa panne est visible et relançable. Le même `totalDesPaiements` que le dossier
conserve un montant inconnu comme inconnu : on ne repropose pas toute la facture
sur la base d'un ancien règlement sans montant. Un reçu ne peut pas être proposé
sur cet historique incomplet. Ce lot ne change ni les règles comptables, ni
le calcul de l'API, ni les montants déjà enregistrés.

Au cabinet, les compteurs et les filtres du portefeuille attendent leurs cinq
sources (clients, file, membres, affectations, compte). Une panne remplace le
résultat par une erreur relançable ; elle n'annonce plus « aucun mandat actif »
ou zéro dossier affecté. Les fiches fiscales restent distinctes et continuent de
signaler leur régime inconnu si leur lecture n'est pas disponible.

Les tests de composants reproduisent les défauts avant correction. Un parcours
navigateur provoque une indisponibilité ciblée de `listClients`, puis relance
la vraie API pour retrouver les dossiers du jeu d'essai. Ce test de reprise ne
vaut pas validation des mandats, des écritures ou de la fiscalité. La recette
client globale et le registre des 148 remarques restent ouverts.
