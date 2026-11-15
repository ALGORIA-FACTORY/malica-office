# Le moteur de notifications

Un seul chemin pour tout ce qui notifie : `notif.emettre`. Il remplace l'ancien fil
(`collab.notifications`), dans lequel vingt-cinq fonctions écrivaient chacune de
leur côté, sans retenue ni destinataire.

## Ce que c'est

| Objet | Rôle |
|---|---|
| `notif.envois` | une ligne par destinataire et par canal (`app`, `email`, `push`), en ajout seul (R7) |
| `notif.remises` | ce qu'il est advenu d'un envoi : remis, échoué, refusé. L'état se déduit (`notif.envois_v`) |
| `notif.suites` | ce que la personne en a fait : `lue`, ou `tranchee` avec son issue. Un fait par personne |
| `notif.diffusions` | quel genre part sur quel canal, avec quel gabarit, daté. Livré : les quatre paliers de relance d'impayé, par courriel |
| `notif.gabarits`, `notif.preferences` | les textes, versionnés ; ce que la personne a demandé (cadence, silence, canaux) |

| Fonction | Rôle |
|---|---|
| `notif.emettre(société, genre, données, personne?, sujet?, fenêtre?)` | la porte. Aucun client ne l'appelle : seuls les propriétaires des producteurs |
| `notif.audience(société, données, personne?)` | qui reçoit, décidé une fois à l'écriture |
| `notif.candidats(société)` | l'ensemble large des personnes qui pourraient la lire |
| `notif.poster(…)` | les quatre verrous (droit, cadence, silence, doublon) et le canal fermé, pour le courriel et le push |
| `notif.centre(sociétés)` | la lecture : le centre de la personne, bornée à ses accès d'aujourd'hui |
| `public.notification_marquer_lue(id)` | la personne marque SA ligne lue, et elle seule |

## Qui reçoit

La règle de lecture de l'ancien fil n'est pas réécrite : `notif.audience` la
**rejoue pour chaque candidat** (membres, cabinets engagés, collaborateurs
affectés) en prenant tour à tour son identité (`auth.uid()` lit un réglage de la
transaction, rendu en sortie, même sur erreur). Conséquences assumées :

- l'accès **perdu** cache le centre aussitôt (`notif.centre` exige l'accès actuel) ;
- l'accès **acquis plus tard** ne rend pas les notifications passées ;
- les opérateurs de la plateforme ne reçoivent pas de copie par société : ils lisent la table, sous leur politique.

## Ce qui part au-delà de l'application

L'application reçoit tout. Le courriel et le push ne partent que si
`notif.diffusions` le dit — jamais déduit de « un gabarit existe » : `facture.emise`
a un modèle de courriel, et l'événement du même nom ne doit pas partir par courriel.
Ajouter un canal à un genre est une ligne datée. Un canal qui échoue ne défait
jamais l'opération qui notifie : il se dit au journal du serveur.

Le travailleur (`apps/api/src/relances/travailleur.ts`) remet par Brevo les envois
`email` décidés, un par transaction, et inscrit chaque tentative.

**Le push n'est pas livré.** Aucun code n'enregistre d'appareil dans `collab.push_devices`,
et aucun émetteur APNs ou FCM n'existe. `notif.poster` abandonne donc chaque push en
`canal_absent`, et la ligne le dit. Ouvrir le push demande une décision produit, un
enregistrement d'appareil côté mobile (`android/`, Capacitor) et des identifiants APNs/FCM
tenus par la plateforme.

## Ce qui a été retiré

`collab.notifications`, `collab.notification_lectures`, `public.notifications_v`,
`app.notifications_des_societes`, `app.notification_lisible`, la copie que
`notif.poster` y déposait, et les droits d'insertion du portier sur l'ancienne table.
La reprise (`20261226160000`) a rejoué chaque ligne pour la personne qui la lirait
aujourd'hui, avec sa lecture et sa décision.

## Éprouvé

`apps/api/src/le-moteur-de-notifications.test.ts` : qui reçoit quoi (dirigeant, cabinet
engagé, tiers) pour une société sans pièce, « chez le propriétaire », une pièce
personnelle, d'entité, partagée, disparue ; l'adressage à une personne ; l'identité
rendue ; une ligne `app` remise par destinataire ; l'accès perdu.
Pendant la bascule, le moteur a été comparé à l'ancien lecteur sur ces six scénarios :
mêmes destinataires. Mesuré : 19 ms par émission pour six candidats. Sur un client engagé avec un cabinet de
cinquante membres, 495 ms avant de restreindre les candidats aux experts et aux
collaborateurs affectés (ce que la règle d'engagement retient seul), 26 ms après.

Le collaborateur affecté et le comptable interne sont éprouvés comme destinataires. Les
épreuves des relances passent (9 sur 9) avec le changement de rôle neutralisé, car
`set role malica_api` est refusé sur le serveur partagé du poste.

**Non éprouvé** : l'envoi réel par Brevo, faute de clé et d'expéditeur sur le poste.

## Remise des courriels : réserver, envoyer, inscrire

Le travailleur remet les courriels en trois temps, chacun dans sa propre
transaction (`apps/api/src/relances/travailleur.ts`) :

1. `notif.reserver_courriels(limite, durée)` pose une réservation
   (`notif.reservations`, ajout seul, échéance) et rend les lignes. Le verrou de
   la ligne ne dure que cette transaction.
2. L'envoi Brevo se fait **hors de toute transaction** : aucun verrou ne tient
   pendant un appel lent. Une épreuve le vérifie (`la-file-reserve-sans-verrou.test.ts`).
3. `notif.remettre` inscrit le résultat (`remis` ou `echoue`).

Une réservation sans résultat à son échéance repart au tour suivant. Le plafond
d'essais est le réglage de relances de l'exploitant : **absent, la file lève
`refus.relances.reglage_absent`** et rien ne part, relances comprises, jusqu'à
ce que `plateforme.relances_regler` ait été appelé.
