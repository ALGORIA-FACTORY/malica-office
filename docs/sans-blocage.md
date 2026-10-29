# Malica sans blocage — la règle produit

Maquette validée par Wissem le 28 octobre 2026 (« Malica sans blocage »,
https://claude.ai/artifact/8YamofcLvQjmNM1pYuQZJp). Ce fichier est la source
des lots qui l'appliquent ; chaque lot y renvoie et ne la réécrit pas.

## 1. Un seul circuit, deux fois

Siège → propriétaire → comptable. À chaque passage : le même geste
« Envoyer », le même écran « Envoyé. » (`components/malica/envoye.tsx`), les
mêmes statuts. Le propriétaire est au siège ce que le comptable est au
propriétaire : il reçoit, voit, retourne avec un motif, accorde ou refuse les
demandes.

- La PME (siège, propriétaire) ne voit **aucune écriture comptable** et ne
  confirme rien. Elle voit : Envoyée · Vue · Retour · Prise en charge.
- **Un siège ne voit que les pièces qu'il a faites.** Le propriétaire voit
  tout, sauf le Mon espace des autres (privé = son auteur seul, même pour le
  patron — décision du 18 octobre maintenue).
- **Seul le propriétaire envoie au comptable.** Le siège envoie au
  propriétaire.
- Plusieurs propriétaires ont les mêmes droits ; le premier qui ouvre la
  pièce d'un siège donne « Vue par {prénom} ».
- Un siège qui quitte la société : ses pièces de la société restent à la
  société ; son Mon espace part avec son compte.

## 2. Les statuts (un mot, une couleur, partout)

Gris : rien à faire · Ambre : à vous · Bleu : chez l'autre · Rouge : à
corriger · Vert : pris en charge. `{X}` = le propriétaire, ou le cabinet.

| Statut | Qui le voit | Sens | Bouton principal |
|---|---|---|---|
| Mon espace | son auteur | privée, jamais lue | Mettre dans la société |
| En lecture | tous | Malica lit | — |
| Non lue | tous | lecture impossible (raison dans le i) | Reprendre la photo |
| À corriger | tous | montants qui ne se recoupent pas | Corriger |
| À envoyer | siège (au propriétaire) · propriétaire (au comptable) | lue, prête | Envoyer |
| Envoyée à {X} | l'expéditeur | en attente chez {X} | Voir |
| Vue par {X} | l'expéditeur | {X} l'a ouverte | Voir |
| Retour de {X} | l'expéditeur, et l'auteur si c'est un siège | {X} demande un geste | le geste du motif, puis Renvoyer |
| Prise en charge | siège, propriétaire | le comptable a validé ou forcé l'écriture | Voir |
| Gardée | propriétaire | il a décidé de ne pas l'envoyer | Envoyer finalement |
| Reçue | propriétaire (du siège) · comptable (du client) | à voir | Ouvrir |
| Retournée à {Y} | propriétaire · comptable | attend le geste de l'autre | Voir |
| Corrigée | celui qui l'a reçue | l'expéditeur a corrigé après envoi | Ouvrir |
| Validée · Forcée | comptable seulement | l'écriture est au journal du jour | Exporter le journal |

Une demande en cours (« Récupération demandée », « Suppression demandée ») est
un second badge bleu ; elle ne remplace jamais le statut.

## 3. Les cas, et leur sortie

| Cas | Ce qui se passe |
|---|---|
| Montants qui ne se recoupent pas | « À corriger ». L'auteur ou le propriétaire corrige les montants (précision datée, R7), ou reprend la photo. Le comptable peut forcer sans attendre. |
| Reprendre la photo | **Remplace** l'ancienne : la nouvelle prend sa place (retour, rattachements, file) et repart à la lecture ; l'ancienne reste attachée comme version précédente, jamais effacée. Une photo sans lien, c'est le bouton + de la barre. |
| Retour du propriétaire au siège | même carte que le retour du comptable : motif, note, un geste, puis « Renvoyer ». |
| Retour du comptable sur une pièce d'un siège | la carte apparaît chez le propriétaire ET chez le siège ; l'un ou l'autre fait le geste ; le propriétaire renvoie. |
| Retour d'une pièce prise en charge | contre-passation au journal du jour, puis même carte de retour. |
| Pièce retournée | supprimer, garder (Mon espace), reprendre la photo (remplace), répondre, renvoyer. Rien ne bloque. |
| « Renvoyer » | inscrit **la lecture courante** de la pièce (celle de la photo qui la remplace, ou corrigée), jamais l'ancienne. |
| Correction après envoi | possible tant que non prise en charge ; chez celui qui l'a reçue : « Corrigée ». |
| Demander à récupérer / supprimer | le siège demande au propriétaire, le propriétaire au comptable. Accordée : la pièce revient **dans la société** (jamais dans un espace privé), ou elle est supprimée. |
| Demande d'un siège sur une pièce chez le comptable | le propriétaire accorde, et la demande part d'elle-même au comptable ; le siège voit « Demande transmise à {cabinet} ». |
| Supprimer une pièce prise en charge | le comptable accorde : contre-passation, et la pièce est archivée, jamais effacée. Durée de conservation : INCERTAIN, à confirmer par un expert-comptable. |
| Lecture refusée (abonnement) | « Non lue », la raison dans le i, le lien pour régler ; le comptable peut saisir à la main. |

## 4. Le comptable

- Ouvrir une pièce = « Vue » (automatique).
- Valider l'écriture proposée, ou **forcer** : modifier ou saisir l'écriture,
  y compris quand le Socle ne propose rien. Nom et heure gardés.
- Retourner au client à toute étape (contre-passation si prise en charge).
- **Journal du jour** : toutes les écritures validées et forcées du jour, et
  les contre-passations ; achats, ventes, banque, caisse, OD ; contrôle
  débit = crédit ; **toujours modifiable**. Export Excel et CSV (le logiciel
  et l'API viendront dans une autre phase). Chaque export est numéroté et
  gardé ; le suivant dit ce qui a changé depuis le précédent.

## 5. L'interface

- Une **miniature** de la vraie photo à gauche de chaque pièce, dans toutes
  les listes ; Mon espace en grille de miniatures par mois.
- Deux boutons côte à côte, même hauteur (48 px), même largeur ; principal
  plein à gauche, secondaire en contour à droite.
- Une explication va dans le **i**, jamais dans une carte : l'écran montre un
  mot et un bouton.
- Messages en fr/en/ar ; RTL.
