# Espace de comptabilité pour le comptable interne

Décisions du dirigeant (12 novembre 2026, point 7, complétées le même jour).

## Règles

1. **Sans comptabilité externe à mandat actif (cas A)** : le comptable interne ouvre `/cabinet`, sur les
   sociétés qui lui sont affectées. Il tient les livres : inscrit, valide, force, retourne.
2. **Plusieurs sociétés** : chaque propriétaire affecte sa société à un comptable interne (révocable). Le
   comptable voit un sélecteur limité aux seules sociétés affectées. Une société non affectée n'apparaît
   ni dans le sélecteur, ni par une adresse (le paramètre `societe` n'est retenu que s'il figure dans la
   liste renvoyée par le serveur), ni dans une réponse serveur.
3. **Affectation** : la ligne de rôle `comptable` (`identity.memberships`) donne l'accès ; chaque
   affectation et chaque retrait s'inscrivent dans `identity.affectations_comptable` (ajout seul, R7). Le
   retrait (`public.comptable_interne_retirer`, porte réservée au propriétaire) efface la ligne d'accès,
   mais l'historique reste.
4. **Gratuit** : rien de la grille ne change pour lui (la place « comptable » reste celle de l'offre).
   **À confirmer** : le siège PME pris par le comptable interne compte-t-il dans les places de l'offre,
   ou est-il gratuit ? Voir la section « Ouvert ».
5. **Avec comptabilité externe à mandat actif (cas B, règle C-1 remplacée)** : la comptabilité externe fait
   tout. Le comptable interne ne prépare, ne propose, ne valide, ne force plus. Il n'a **aucun espace de
   comptabilité** : `/cabinet` le refuse et il reste dans l'espace PME. Son rôle de propriétaire non
   principal ne lui sert qu'à transmettre les pièces à la comptabilité externe.
6. **Grisé, visible mais inactif, avec la raison** : honoraires et abonnement. Le texte est
   « Réservé à la comptabilité externe : les honoraires et l'abonnement se gèrent avec elle. »
7. **Réglages, collaborateurs, reste** : réglages comptables de sa société (même écran, même droits que
   l'externe sur cette société) ; collaborateurs = membres au rôle `comptable` de sa société ; le reste de
   l'espace (file, pièces, conseil, pilotage, bibliothèque, export, journal, propositions, écritures,
   échéances, TVA, notifications, plan) passe par les lectures bornées à la société.

## Mise en œuvre

| Élément                                                | Où                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Espace ouvert pour le comptable interne                | `supervision.listMyCabinets` (union avec `app.dossiers_du_comptable_interne()`), `apps/api/src/depots/supervision.ts` |
| Société tenue en interne = mandat de sa propre société | `app.mandats_du_cabinet`, `app.mandats_visibles` (migration `20261222090000`)                                         |
| Sociétés tenues : seulement sans mandat externe        | `app.dossiers_du_comptable_interne` (migration `20261222110000`)                                                      |
| Affectations, retrait porté, historique                | migration `20261222100000`                                                                                            |
| Collaborateurs de sa comptabilité                      | `collab.members` (rôle `comptable` seul, pour le comptable interne)                                                   |
| Grisé honoraires / abonnement                          | `apps/web/src/components/malica/clients/fiche-client.tsx`, `cabinet.clients.tsx`                                      |
| Sélecteur de sociétés                                  | `apps/web/src/routes/_authenticated/cabinet.tsx` (validateSearch + liste serveur)                                     |
| Helper                                                 | `apps/web/src/lib/comptabilite-interne.ts`                                                                            |

Honoraires et abonnement sont des onglets de la page Clients (`cabinet.honoraires` et `cabinet.abonnements`
redirigent vers `cabinet.clients?vue=facturation`). Le grisé porte donc sur ces onglets, pas sur des routes.

## Cartographie (écran → résultat)

Les lignes « vérifié » sont tenues par une épreuve. Les lignes « constaté » ont été lues avant le
changement, par une sonde (pas d'épreuve). Les autres ne sont pas vérifiées.

| Écran / appel                                                                  | Résultat                                                                                               | Preuve                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `/cabinet` file (`supervision.queue`)                                          | Ne porte que la société lue ; pièce transmise présente                                                 | vérifié, `le-comptable-interne-lit-son-espace.test.ts`                                                         |
| Clients (`supervision.listClients`)                                            | Une ligne par société affectée ; société non affectée : vide                                           | vérifié, idem                                                                                                  |
| Société non affectée (liste, file)                                             | Refusée (vide)                                                                                         | vérifié, idem                                                                                                  |
| Affectation retirée                                                            | Ferme la société (liste, file, espace) ; historique affectee + retiree ; réécriture du journal refusée | vérifié, idem                                                                                                  |
| Plan (`parametrage.plan`) et réglages (`parametrage.reglagesCabinet`), lecture | Lisibles sur la société                                                                                | vérifié, idem                                                                                                  |
| Conseil (`conseil.statistiques`)                                               | Lisible                                                                                                | vérifié, idem                                                                                                  |
| Collaborateurs (`collab.members`)                                              | Seuls les membres au rôle `comptable`                                                                  | vérifié, idem                                                                                                  |
| Propriétaire : tous ses membres                                                | Inchangé                                                                                               | vérifié, idem                                                                                                  |
| Cas B : pas d'espace, pas de préparation                                       | `listMyCabinets` ne liste pas la société ; `office.propose` refusé ; retour refusé                     | vérifié, `le-comptable-interne-tient-les-livres.test.ts` (test 11), `la-matrice-des-droits.test.ts` (ligne 12) |
| Honoraires (`honoraires.mandats`)                                              | Grisé côté écran. Côté API, **non refusé** : renvoie `[]` faute de mandat. À durcir                    | constaté, sonde                                                                                                |
| Abonnement                                                                     | Grisé côté écran. Aucune lecture API ajoutée                                                           | à vérifier                                                                                                     |
| Catalogue des offres (`facturation.catalogueDesOffres`)                        | Public, lisible                                                                                        | constaté                                                                                                       |
| Pièce (`cabinet.piece`, `capture.dossier`)                                     | **Non vérifié**                                                                                        |                                                                                                                |
| Bibliothèque (`supervision.documents`)                                         | Refusée avant le changement (`refus.introuvable.dossier`). **Non re-vérifié**                          | constaté avant                                                                                                 |
| Journal, exports (`journalDuJour.lire`, `exports.*`)                           | Lus avant le changement ; **non re-vérifiés**                                                          | constaté avant                                                                                                 |
| Propositions, écritures (`office.*`)                                           | Couvert par les épreuves existantes du rôle (cas A) ; non re-vérifié pour le sélecteur                 |                                                                                                                |
| Échéances, TVA, pilotage, notifications, PV                                    | **Non vérifiés**                                                                                       |                                                                                                                |
| Réglages : écritures (`parametrage.definirReglagesCabinet`)                    | **Non vérifié**                                                                                        |                                                                                                                |
| Sélecteur de sociétés et grisé (écran)                                         | Test de composant (`comptabilite-interne-grise-honoraires.test.tsx`), **pas de rendu de la coque**     |                                                                                                                |

## Ouvert (à trancher par le dirigeant)

- **Siège PME du comptable interne** : compte-t-il dans les places de l'offre, ou est-il gratuit ? Le modèle
  du 19 octobre (`20261022110000`) fait du propriétaire non principal un siège payé ; le message du dirigeant
  dit « gratuit ». Le rôle de propriétaire non principal n'est **pas** accordé au comptable interne tant que
  ce point n'est pas tranché.
- **Transmission (cas B)** : aucune porte ni droit n'a été ajouté. Le comptable ne transmet pas encore.
- **Lecture des écritures (cas B)** : il ne lit plus les écritures de la société sous mandat externe.
  Propriétaire non principal lit-il les livres ? Décision à confirmer ; les épreuves l'enregistrent en l'état.
- **Honoraires côté API** : pas de refus explicite pour le comptable interne (renvoie vide).
- **Ce qui n'est pas dans cette livraison** : écran propriétaire pour affecter et retirer (la porte existe,
  l'écran non), rendu de la coque au clic, vérification des écrans « non vérifiés » ci-dessus.
