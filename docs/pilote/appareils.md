# Relevé des épreuves sur appareil

Le protocole est `docs/protocole-appareils.md`. Une colonne par appareil,
une ligne par point ; en tête de colonne, la version de la coque (Réglages)
et la date. OK / KO / NA ; un KO renvoie à un signalement.

## Relevé courant

| Point                                   | Tecno / Infinix | Redmi 13C | Galaxy A15 / A54 | Huawei (sans Google) | Émulateur API 34 |
| --------------------------------------- | --------------- | --------- | ---------------- | -------------------- | ---------------- |
| version · date                          |                 |           |                  |                      |                  |
| 1 ticket à bout de bras ◆               |                 |           |                  | NA (navigateur)      | NA               |
| 2 facture de biais ◆                    |                 |           |                  | NA (navigateur)      | NA               |
| 3 carte fiscale ◆                       |                 |           |                  | NA (navigateur)      | NA               |
| 4 abandon du scanner                    |                 |           |                  |                      | CI               |
| 5 permission refusée puis accordée      |                 |           |                  |                      |                  |
| 6 cinq pages                            |                 |           |                  |                      |                  |
| 7 mode avion, trois pièces ◆ (bloquant) |                 |           |                  |                      |                  |
| 8 tuée pendant l'envoi ◆ (bloquant)     |                 |           |                  |                      |                  |
| 9 réseau lent                           |                 |           |                  |                      |                  |
| 10 hors ligne, les autres gestes        |                 |           |                  |                      |                  |
| 11 données du cache                     |                 |           |                  |                      |                  |
| 12 bouton retour ◆ (bloquant)           |                 |           |                  |                      | CI               |
| 13 zone sûre ◆                          |                 |           |                  |                      |                  |
| 14 sombre ◆                             |                 |           |                  |                      |                  |
| 15 arabe ◆                              |                 |           |                  |                      | CI               |
| 16 police 130 %                         |                 |           |                  |                      |                  |
| 17 rotation                             |                 |           |                  |                      |                  |
| 18 reprise après une nuit (bloquant)    |                 |           |                  |                      | NA               |
| 19 économiseur de batterie              |                 |           |                  |                      | NA               |
| 20 disque presque plein                 |                 |           |                  |                      |                  |
| 21 mise à jour en vol                   |                 |           |                  |                      | NA               |
| 22 retour arrière                       |                 |           |                  |                      | NA               |
| 23 mise à jour par Play                 |                 |           |                  |                      | NA               |
| 24 démarrage à froid (s)                |                 |           |                  |                      |                  |
| 25 scanner → aperçu, 1 page (s)         |                 |           |                  |                      |                  |
| 26 scanner → aperçu, 5 pages (s)        |                 |           |                  |                      |                  |
| 27 photo → proposition (s)              |                 |           |                  |                      |                  |

« CI » : le point est joué chaque nuit par `android-e2e.yml` (Maestro) ; le
relevé manuel n'est refait que si la CI est rouge.

## Historique

| Date | Appareil | Version | KO relevés | Signalements | Rejoué le |
| ---- | -------- | ------- | ---------- | ------------ | --------- |
|      |          |         |            |              |           |
