# Convention de pilote — Regalica Office

Entre **Algoria Factory** (l'éditeur), le **cabinet** signataire, et chaque
**entreprise** que le cabinet inscrit au pilote. Ce document est signé par
l'éditeur et le cabinet ; chaque entreprise reçoit et accepte l'annexe qui
la concerne à sa mise en route. Il dit ce qui est fait des données réelles,
par qui, où, et ce que chacun peut exiger. Rien ici n'est une promesse
commerciale.

## 1. Objet et durée

Le pilote éprouve l'application Regalica Office (Android pour les
entreprises, web pour le cabinet) sur des dossiers réels, du **J0** à la
**revue de fin de pilote** (six à huit semaines), prolongeable par écrit.
Une seule phase : les données saisies pendant le pilote **restent** dans
l'application si elle passe en production — c'est l'environnement du pilote
qui devient la production, sans recopie.

## 2. Les rôles

| Rôle                      | Qui                      | Responsabilité                                                                                                     |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Responsable de traitement | l'entreprise, le cabinet | chacun pour ses données : l'entreprise pour ses pièces, le cabinet pour son dossier de travail                     |
| Sous-traitant             | Algoria Factory          | héberge, exploite, sauvegarde ; n'accède aux données que pour exploiter, réparer, et sur demande écrite du cabinet |
| Sous-traitants ultérieurs | ci-dessous, § 4          | nommés, avec leur pays                                                                                             |

## 3. Les données

- **Comptes** : nom, adresse e-mail, mot de passe (haché, jamais lisible),
  appareil et version de l'application.
- **Pièces** : les photos et PDF déposés, le texte qui en est lu, les
  montants, dates, tiers et numéros qui en sont extraits, les écritures
  proposées et validées.
- **Dossier** : la situation fiscale déclarée (régime, TVA, matricule), les
  échéances, les échanges avec Regalica et avec le cabinet.
- **Technique** : journaux d'accès (adresse IP, date, chemin) 30 jours ;
  plantages (pile d'exécution, écran, version, identifiant du dossier —
  jamais le contenu d'une pièce) ; signalements volontaires.

## 4. Où vont les données, et qui les traite

| Traitement                              | Prestataire                | Pays             | Ce qui y passe                                                                                     |
| --------------------------------------- | -------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| Hébergement (serveur, disque)           | Hetzner Online             | Allemagne        | tout, chiffré en transit ; disque du serveur                                                       |
| Sauvegardes hors site                   | Hetzner Storage Box        | Allemagne        | tout, chiffré avant d'y arriver (restic) ; l'hébergeur ne peut pas lire                            |
| Lecture des pièces (OCR)                | Alibaba Cloud Model Studio | Singapour        | l'image de la page, le temps de la lecture ; non conservée par le prestataire selon ses conditions |
| Compréhension et proposition d'écriture | DeepSeek                   | Chine            | le texte lu de la pièce et le contexte fiscal du dossier, le temps de la réponse                   |
| Plantages                               | Sentry                     | Union européenne | pile, écran, version, identifiant de dossier — jamais une pièce                                    |
| Mises à jour de l'application           | Capgo                      | Union européenne | aucune donnée de dossier ; l'identifiant de l'appareil                                             |
| Distribution                            | Google Play                | selon Google     | le compte Google du dirigeant, pour installer                                                      |

**Le point à dire clairement** : la lecture et la compréhension des pièces
passent par des modèles hors de Tunisie. Une entreprise qui ne l'accepte pas
ne participe pas au pilote. L'hébergement, lui, peut être déplacé chez un
hébergeur tunisien sur demande du cabinet (`infra/` est portable) ; le flux
de lecture restera étranger.

## 5. Ce que l'éditeur s'engage à faire

- Déclarer le traitement à l'**INPDP** avant le J0 (loi organique 2004-63),
  et tenir le registre des traitements.
- Chiffrer en transit (TLS) et au repos hors site ; isoler chaque dossier
  par la base elle-même (politiques de lignes) ; ne jamais exposer la base.
- Sauvegarder toutes les six heures ; répéter une restauration avant le J0
  puis chaque mois ; consigner le temps de restauration
  (`docs/exploitation.md`).
- Prévenir le cabinet **sous 72 heures** de tout incident touchant des
  données, avec ce qui est su, ce qui est fait, et ce qui est demandé.
- N'utiliser aucune donnée du pilote pour entraîner un modèle, ni la céder.
- Donner accès, sur demande écrite du cabinet ou de l'entreprise, à
  l'export complet d'un dossier (`/cabinet/export`) sous 7 jours.

## 6. Conservation et suppression

- Les pièces et écritures validées sont des documents comptables : elles
  sont conservées **dix ans** par archivage, même après la fin du pilote, à
  moins que l'entreprise n'en demande l'export puis la purge par écrit.
- La purge des fichiers d'une entreprise se fait par
  `db/pilote/purger-pieces.mjs <tenant>` : les fichiers sont effacés du
  disque et des sauvegardes à venir ; les sauvegardes déjà prises expirent
  selon leur rétention (au plus douze mois).
- Les comptes qui n'ont plus de dossier sont supprimés à la fin du pilote.

## 7. Ce que le cabinet s'engage à faire

- N'inscrire que des entreprises qui ont reçu et accepté l'annexe.
- Traiter les pièces transmises dans la semaine pendant le pilote (sinon le
  pilote ne mesure rien).
- Participer à la revue hebdomadaire de 30 minutes et à la revue finale.
- Signaler tout défaut par l'application ou le groupe, jamais en envoyant
  une pièce par un autre canal.

## 8. Fin du pilote

À la revue finale, trois issues : **go** (l'environnement devient la
production, le domaine change, rien n'est recopié), **prolongation** écrite,
ou **arrêt** — l'export complet de chaque dossier est remis au cabinet sous
15 jours, puis les données sont purgées, sauf demande écrite de conservation.

## Annexe — acceptation par l'entreprise

> J'ai lu la fiche « Ce que Regalica fait de vos documents ». Je comprends
> que mes pièces sont lues par des services à l'étranger (Singapour, Chine)
> pour en extraire les montants, que rien ne part au cabinet sans mon geste,
> et que je peux demander l'export et la purge de mon dossier par écrit.

Nom, entreprise, date, signature.

---

Signatures : pour Algoria Factory · pour le cabinet · date.
