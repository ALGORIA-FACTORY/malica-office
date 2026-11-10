# Registre des dépenses des essais payants

Budget de la mission : **100 $**. Chaque appel payant s'inscrit ici, avec sa date, son objet et son coût
mesuré au tarif du fournisseur. Quand le total atteint le budget, les essais s'arrêtent et le compte rendu
le dit.

| Date       | Objet                                        | Fournisseur          | Appels |   Coût mesuré |
| ---------- | -------------------------------------------- | -------------------- | -----: | ------------: |
| 2026-11-09 | Revérification des constats (n° 6 et n° 13)  | DeepSeek             |      2 |     < 0,001 $ |
| 2026-11-09 | Revérification des constats (n° 2, encodage) | Qwen (Model Studio)  |      1 | ≈ 0,000 001 $ |
| 2026-11-09 | Liste des modèles servis                     | DeepSeek (`/models`) |      2 |       gratuit |
| 2026-11-09 | Mesure de référence, 24 questions (staging)  | DeepSeek             |     24 |      0,2294 $ |
| 2026-11-10 | Lot A : parité Claude et DeepSeek, 6 questions (staging) | Claude (Haiku, Sonnet) et DeepSeek | 12 | 0,2262 $ |
| 2026-11-10 | Lot I : boucle de l'assistant sur trois moteurs, 78 réponses (dossier fictif) | Claude (Haiku), DeepSeek (chat, flash) | 78 | 0,0668 $ + flash non chiffré |
| 2026-11-10 | Sondes du point d'accès DeepSeek au format Messages (lot B) | DeepSeek | 8 | non chiffré, < 0,01 $ estimé |

**Total engagé : 0,53 $ chiffrés sur 100 $**, plus les appels à `deepseek-flash` (22 réponses et 4 sondes), que la base ne sait pas chiffrer faute de tarif (M-4) : estimés à moins de 0,05 $, INCERTAIN.
