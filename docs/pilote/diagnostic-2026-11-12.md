# Diagnostic de bout en bout : passage au pilote (12 novembre 2026)

**Objet.** Dire si Malica Office peut ouvrir le pilote avec des données réelles (un cabinet, deux PME), et à quelles conditions.
**Critère.** Les 12 critères de `docs/pilote/revue-go-no-go.md` et les contrôles de `docs/recette-client/README.md`, chacun prouvé par une exécution datée.
**Commit examiné.** main `80406d5` (version 0.2.109).

## 1. Synthèse

**Verdict : NO-GO aujourd'hui, mais GO conditionnel.** Le J0 est visé au **1er décembre 2026**, dès que les 8 portes P0 du § 5 sont fermées.

**Ce qui est solide :**

- Le code est sain : CI verte sur main (jobs api, web, atelier et epreuves).
- La chaîne réelle est vérifiée par l'épreuve de nuit d'aujourd'hui : photo → OCR → lecture → proposition → chat.
- Le staging répond `ok` en 0.2.109 (base, stockage et OCR ONNX).
- La règle « zéro valeur inventée » tient sur 411 pièces.

**Ce qui bloque n'est pas le code.** C'est l'exploitation, les appareils et la validation métier.

| Constat                               | Mesure                                                                                          | Bloquant                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Environnement `pilote` jamais déployé | `deployer.yml` n'a jamais tourné, il n'existe aucune étiquette `v*` et le domaine ne répond pas | **Oui**                                             |
| Dernière répétition de restauration   | 4 oct. 2026, il y a 39 jours, au-delà du seuil de 30                                            | **Oui** (critère 11, rouge)                         |
| Épreuves sur vrais téléphones         | relevé `docs/pilote/appareils.md` **vide** (0 point sur 27, 4 points bloquants jamais joués)    | **Oui**                                             |
| Validation fiscale de l'expert        | décisions ANO-010/015/020/021 absentes des preuves                                              | **Oui**                                             |
| Registre UX PME                       | 137 remarques sur 148 « à rejouer », dont 43 en P1                                              | Partiel                                             |
| Sécurité                              | S1–S4 fermés ; S5, S8, S9 et S10 ouverts                                                        | Partiel (S9 bloquant si mise à jour à chaud active) |

## 2. Analyse par expert

### Architecte / QA : le produit

- **CI.** main est vert : api, web, atelier et epreuves, plus Android sur émulateur (Maestro). La règle d'en-tête, l'ordre des migrations et les 12 règles d'architecture sont exécutées en CI.
- **Épreuve de nuit, run 43252861812 (f6734fe) : succès.** L'échec du chat à 09 h 51 venait d'un contrôle périmé, corrigé par #367. Ce n'était pas une régression.
- **Banc du moteur, 411 pièces, sans IA, à `OCR_COTE_MAX=1600` :**
  - 309 pièces prouvées par le Sudoku (75,2 %) ;
  - 7 120 champs justes, **0 faux, 0 inventé** ;
  - 60,0 % des champs imprimés sont rendus justes ;
  - 3 129 silences « à travailler ».

  Concrètement, une pièce sur quatre et environ 40 % des champs demanderont une saisie ou une précision. C'est honnête (Malica se tait plutôt que d'inventer), mais c'est lourd.

- **Hypothèse « qualité d'image » écartée.** Le banc à 2400 px fait moins bien que 1600 px :
  - 6 966 justes au lieu de 7 120 ;
  - **5 faux** au lieu de 0 ;
  - OCR plus lent : médiane 2 013 ms au lieu de 1 860 ms.

  On garde 1600 px. Le goulot est l'attribution des champs, pas l'OCR. L'outil de mesure est fusionné (#373).

- **INCERTAIN.** Le critère 3 (« ≥ 70 % de pièces lues sans précision ») n'est pas identique à « prouvée ». Les 75,2 % du banc en sont seulement un indicateur.

### DevOps / exploitation

- **Staging.** Déploiement continu fonctionnel ; `sante/profonde` est `ok` à 15 h 59 UTC.
- **Pilote.** Aucun déploiement, aucune étiquette `v*` : seules des étiquettes `web-v*` existent, et `deployer.yml` en exige une. Le domaine `pilote.malica-office.algoria-factory.com` ne s'ouvre pas.
- **Non vérifiable d'ici.** L'existence de la machine CX33 et de son volume, ainsi que les secrets `DEPLOI_*` : les API d'environnements et de secrets répondent 403 à cette session.
- **Sauvegardes.** Elles sont conçues correctement :
  - dump toutes les 6 h, restic chiffré, Storage Box en Allemagne ;
  - perte maximale de 6 h, restauration mesurée à 98–103 s sur le staging.

  En revanche, **aucune répétition sur la machine pilote**, et la dernière répétition date de plus de 30 jours.

- **Surveillance.** Elle est spécifiée (Uptime Kuma, push « sauvegardes » à 7 h, alerte certificat), mais sa mise en place n'est pas prouvée. Sentry est configuré dans les quatre coques, sans preuve de réception côté pilote.

### Sécurité / données personnelles

L'audit du 6 novembre a été revérifié dans le code aujourd'hui.

**Fermés :**

- S1 (XSS par pièce) ;
- S2 (la PME lisait les écritures) ;
- S3 et S4 (clé d'API et jeton révocables) ;
- S6 (texte technique à l'écran) ;
- S12 (`/exports` routé).

**Ouverts :**

- **S5.** Le mot de passe des comptes de parcours du staging est en clair dans `outils/comptes-de-parcours.json`. Il faut le tourner ; pas de donnée réelle exposée, puisque le staging ne contient que des données synthétiques.
- **S8.** Pas de limite de débit sur `/rpc` ni `/malica`. Seul `/auth` est limité ; le coût est borné par le quota, pas par le débit.
- **S9.** La mise à jour à chaud Capgo n'est pas signée (`autoUpdate: true` sans `publicKey`), et le jeton de 30 jours est stocké en clair dans les préférences. **Avec des données réelles, cela devient bloquant** : qui compromet le compte Capgo pousse du code dans l'application. Il faut signer, ou couper la mise à jour à chaud sur le canal `pilote`.
- **S10.** Les jeux d'essai portent des raisons sociales qui peuvent être réelles, comme « SOTUMAG ».
- **S7.** Partiellement traité (`jour_du_dossier`) ; le reste n'a pas été revérifié.

### Produit / fiscal

- **Fiscal.** Les décisions de l'expert (ANO-010/015/020/021 et le forfait) et la TVA du cabinet tirée du grand livre ne sont pas signées. C'est la règle R3 appliquée au pilote : sans validation métier, la proposition n'a pas d'autorité.
- **UX.** 137 remarques sur 148 sont à rejouer, dont 43 en P1. Il n'est pas nécessaire de tout fermer : il faut fermer les P1 **du parcours du pilote** (capture, transmission, validation par le cabinet).
- **Mesure des critères.**
  - `db/pilote/tableau-de-bord.sql` existe (136 lignes).
  - Le critère 9 n'avait ni étiquette ni projet : j'ai créé l'étiquette `bloquant-pilote` sur GitHub aujourd'hui.
  - Il n'y a aucune issue ouverte.
- **Play.** La piste fermée « Pilote » doit tenir 14 jours continus (critère 12). C'est une contrainte de calendrier, pas de code.

### Contre-expertise (je conteste ma conclusion)

**L'argument pour partir dès la semaine prochaine.** Le code est vert, la chaîne réelle passe chaque nuit, et un pilote sert précisément à trouver ce que le banc ne voit pas.

**Ma réponse.** Deux points ne se rattrapent pas après coup :

- une perte de données sans restauration éprouvée sur la machine ;
- un téléphone d'entrée de gamme qui perd des pièces hors ligne.

Ces points sont les seuls que les critères 1, 6, 9 et 11 marquent « rouge = arrêt ». Le reste, notamment l'UX et le taux de silence, peut s'apprendre pendant le pilote.

## 3. Scénarios (tous légaux)

|                      | Sûr                                                                                         | Optimisé (recommandé)                           | Agressif                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| J0 données réelles   | 8 décembre                                                                                  | **1er décembre**                                | 23 novembre                                                                                     |
| Préalable            | Les 8 portes P0, plus tous les P1 UX                                                        | Les 8 portes P0 et les P1 du parcours du pilote | Portes 1, 2, 3 et 5, plus la mise à jour à chaud coupée                                         |
| Du 17 au 28 novembre | Répétition générale **sur le staging**, pièces anonymisées ; la machine pilote reste vierge | Idem                                            | —                                                                                               |
| Risque               | Retard commercial                                                                           | Faible                                          | Saisie lourde et appareils non éprouvés : risque de perte de confiance de l'expert (critère 10) |

Le gel TVA s'étend du J-3 au jour de l'échéance mensuelle. **Aucun J0, rotation de secret ni déploiement du 25 au 28 novembre.**

## 4. Décision proposée

**Scénario Optimisé : J0 avec données réelles le 1er décembre 2026.** Il est conditionné aux 8 portes P0. Si une porte reste ouverte le 27 novembre, on bascule sur le scénario Sûr (8 décembre).

La décision et les signatures appartiennent à Wissem Barouni (CEO), hors conversation.

## 5. Plan d'action : les 8 portes P0

| #   | Porte                                                                                                                                                                                      | Preuve exigée                                    | Qui                                                                                                                       | Échéance     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Environnement `pilote` provisionné, secrets `DEPLOI_*` posés, étiquette `v0.2.110` posée, `deployer.yml` exécuté                                                                           | `sante/profonde` = ok sur le domaine pilote      | CEO (machine et secrets, étiquette : cette session ne peut créer ni étiquette ni secret) ; Claude (lancement et contrôle) | 18 nov.      |
| 2   | Sauvegarde prouvée en deux temps : à J-1, premier dump, `restic check` et restauration de la base vide à côté ; à J+7, restauration complète avec les vraies pièces, consignée au registre | deux lignes datées dans `docs/exploitation.md`   | Claude ou l'opérateur, avec SSH                                                                                           | J-1 puis J+7 |
| 3   | Surveillance active : Uptime Kuma (santé, site, push « sauvegardes »), Sentry qui reçoit depuis la coque pilote                                                                            | une alerte de test reçue                         | Opérateur                                                                                                                 | 19 nov.      |
| 4   | Points bloquants sur appareil (7 mode avion, 8 tuée pendant l'envoi, 12 retour, 18 reprise après une nuit) sur au moins 2 téléphones (Tecno ou Infinix, Redmi 13C)                         | relevé `appareils.md` rempli                     | Équipe terrain                                                                                                            | 21 nov.      |
| 5   | Décisions fiscales ANO-010/015/020/021 et forfait signées par l'expert                                                                                                                     | document signé                                   | Expert-comptable                                                                                                          | 24 nov.      |
| 6   | Sécurité : S9 (signature Capgo ou mise à jour à chaud coupée sur le canal `pilote`), S8 (limite de débit sur `/rpc` et `/malica`), S5 (rotation et retrait du dépôt)                       | PR fusionnées, test de débit                     | Claude (code), CEO (rotation)                                                                                             | 21 nov.      |
| 7   | Piste fermée Play « Pilote » ouverte, testeurs inscrits ; chaque bloquant porte l'étiquette `bloquant-pilote`                                                                              | Play Console ; 0 issue `bloquant-pilote` ouverte | CEO ; Claude                                                                                                              | 24 nov.      |
| 8   | P1 UX du parcours du pilote rejoués (capture → transmission → validation par le cabinet)                                                                                                   | registre mis à jour, contre-preuves              | Sessions produit                                                                                                          | 27 nov.      |

## 6. Mise en service du pilote à zéro : la pratique retenue

Le pilote démarre **vide** : schéma et référentiel seulement. Il deviendra la production sans être recopié, donc rien d'essai n'y entre jamais.

1. **Une seule version, figée.** On pose l'étiquette `v0.2.11x` sur le commit exact que le staging a fait tourner vert pendant au moins 48 h. Le pilote tire ces images-là, épinglées par leur empreinte (digest), et rien d'autre.
2. **Des secrets propres au pilote.** `JWT_SECRET`, `POSTGRES_PASSWORD`, `MALICA_API_PASSWORD`, `RESTIC_PASSWORD` et des clés de modèles dédiées sont générés pour le pilote. Aucun n'est recopié du staging. `RESTIC_PASSWORD` est aussi rangé dans le coffre.
3. **Une base vierge.** `deployer.sh <version>` monte le schéma ; les migrations ne posent que le référentiel. Un contrôle compare ensuite ce référentiel à une base de CI neuve (règle R11) : il doit être identique.
4. **Une sonde sans écriture.** On vérifie que `sante/profonde` = ok, que le site, le certificat et le lecteur OCR répondent. Aucun compte ni tenant de test n'est créé, parce qu'un tenant s'archive et ne se supprime pas (R7).
5. **La sauvegarde avant le premier client.** Premier dump, envoi chiffré, `restic check`, puis restauration à côté de la base, le tout à J-1. On refait une restauration complète à J+7, avec les vraies pièces.
6. **Surveillance branchée avant J0.** Uptime Kuma (santé, site, push « sauvegardes » à 7 h, certificat) et Sentry, avec l'étiquette de version. Une alerte de test doit être reçue par la personne d'astreinte.
7. **Le premier contenu est réel.** L'expert crée son cabinet (`/cabinet/mise-en-route`), puis invite chaque PME. L'équipe ne saisit rien à sa place.
8. **Retour arrière prêt.** Un dump de la base est fait juste avant chaque déploiement. Revenir en arrière consiste à redéployer la version précédente, et les migrations restent en « expansion puis contraction ».
9. **Calendrier tenu.** Les déploiements ont lieu le mardi matin ; aucun gel n'est levé du 25 au 28 novembre (échéance TVA). La première semaine est accompagnée : le tableau de bord est relu chaque jour.

**Écarts du dépôt avec cette pratique, à corriger avant J0 :**

- `images.yml` reconstruit les images sur l'étiquette au lieu de promouvoir celles que le staging a éprouvées. Il faut les promouvoir par empreinte.
- `deployer.sh` ne fait pas de dump avant de migrer.

Je prends ces deux corrections ; elles s'ajoutent à la porte 6 (sécurité et exploitation).

## 7. Ce qui n'a pas été vérifié

- **La machine pilote et ses secrets.** Accès 403, pas de SSH depuis cette session. Le domaine pilote ne s'ouvre pas, mais je n'ai pas pu établir si la machine existe.
- **L'état réel de Sentry, d'Uptime Kuma et de Play Console.** Pas d'accès.
- **Le staging lu directement aujourd'hui.** Le navigateur l'a refusé ; l'état « ok » vient du contrôle de santé du déploiement de 15 h 59 UTC.
- **S7, S11 et les constats du chat** (ordre du fil, latence journalisée) : non revérifiés un par un.

## Sources (dépôt, 12 nov. 2026)

- `docs/pilote/revue-go-no-go.md`, `docs/pilote/appareils.md`, `docs/pilote/kit-onboarding.md`
- `docs/recette-client/README.md`, `docs/recette-client/registre-ux-pme.md`
- `docs/exploitation.md` (§ Sauvegarder, Restaurer, Registre, Surveiller, Données)
- `docs/audit-2026-11-06/securite.md`, revérifié dans le code de `80406d5`
- Runs GitHub Actions :
  - épreuve de nuit 43252861812 ;
  - bancs 43250587401 (1600 px) et 43250608137 (2400 px) ;
  - Images 43253567704.
