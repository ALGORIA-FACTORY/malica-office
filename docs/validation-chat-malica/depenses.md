# Registre des dépenses des essais payants

Budget de la mission : **100 $**. Chaque appel payant s'inscrit ici, avec sa date, son objet et son coût
mesuré au tarif du fournisseur. Quand le total atteint le budget, les essais s'arrêtent et le compte rendu
le dit.

| Date       | Objet                                                                                                             | Fournisseur                            | Appels |                        Coût mesuré |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -----: | ---------------------------------: |
| 2026-11-09 | Revérification des constats (n° 6 et n° 13)                                                                       | DeepSeek                               |      2 |                          < 0,001 $ |
| 2026-11-09 | Revérification des constats (n° 2, encodage)                                                                      | Qwen (Model Studio)                    |      1 |                      ≈ 0,000 001 $ |
| 2026-11-09 | Liste des modèles servis                                                                                          | DeepSeek (`/models`)                   |      2 |                            gratuit |
| 2026-11-09 | Mesure de référence, 24 questions (staging)                                                                       | DeepSeek                               |     24 |                           0,2294 $ |
| 2026-11-10 | Lot A : parité Claude et DeepSeek, 6 questions (staging)                                                          | Claude (Haiku, Sonnet) et DeepSeek     |     12 |                           0,2262 $ |
| 2026-11-10 | Lot I : boucle de l'assistant sur trois moteurs, 78 réponses (dossier fictif)                                     | Claude (Haiku), DeepSeek (chat, flash) |     78 |       0,0668 $ + flash non chiffré |
| 2026-11-10 | Sondes du point d'accès DeepSeek au format Messages (lot B)                                                       | DeepSeek                               |      8 |       non chiffré, < 0,01 $ estimé |
| 2026-11-11 | Qualité de Claude dans Malica : 25 questions + 2 de sonde (dossier fictif, corpus réel en lecture seule)          | Claude (Haiku, Sonnet)                 |     27 |                           0,5279 $ |
| 2026-11-11 | Les mêmes 24 questions à Claude seul, sans Malica                                                                 | Claude (Haiku, Sonnet)                 |     48 |  0,1922 $ (calculé sur les jetons) |
| 2026-11-11 | Les 24 questions à Claude Opus 5.5 seul (825 jetons lus, 20 192 écrits)                                           | Claude (Opus)                          |     24 | non chiffré : pas de tarif en base |
| 2026-11-11 | Malica sur Opus 5.5, réglage en vigueur : repli sur DeepSeek, conseil cité sur Sonnet                             | DeepSeek, Claude (Sonnet)              |     25 |                           0,5190 $ |
| 2026-11-11 | Malica sur Opus 5.5, réflexion `adaptive` (25 questions)                                                          | Claude (Opus, Sonnet)                  |     25 | non chiffré : pas de tarif en base |
| 2026-11-11 | Correction de « parler de tout » : cinq passes (65 réponses), dossier fictif, corpus réel en lecture seule        | Claude (Haiku, Sonnet)                 |     65 |                           0,9578 $ |
| 2026-11-11 | « Malica répond toujours » : deux passes (51 réponses) sous mandat d'un cabinet, puis 4 réponses de contrôle      | Claude (Haiku, Sonnet)                 |     55 |                           1,1092 $ |
| 2026-11-11 | Rejeu par l'écran sur staging (6 questions, société d'essai), coût lu au journal des agents                       | Claude (Haiku, Sonnet)                 |      6 |                           0,1414 $ |
| 2026-11-11 | Lecture du droit et consigne unique : mise au point (11 puis 26 réponses) et trois passes de mesure (78 réponses) | Claude (Haiku, Sonnet)                 |    115 |                           3,0774 $ |

**Total engagé : 7,06 $ chiffrés sur 100 $.** Non chiffrés faute de tarif en base (INCERTAIN) : `deepseek-flash` (moins de 0,05 $ estimé) et les deux passes sur Opus 5.5 du 11 novembre, dont la part de conseil cité sur Sonnet est de l'ordre de 0,45 $.

Une troisième passe de contrôle du 11 novembre (2 questions) s'est interrompue sans rendre son coût : moins de 0,02 $ estimé (INCERTAIN).
