# Mesure du jeu synthétique

Produit par `node --experimental-strip-types outils/jeu-synthetique/mesurer.mjs`. Ne pas
éditer à la main : relancer.

Chaîne mesurée : relevé de production (`relever`) → désignation ATTENDUE (désignateur
idéal, voir le README) → relecture au plan → jugement → proposition du Socle.

**82 cas non mesurés** : image : PaddleOCR non joignable (OCR_URL absente) ; PDF au texte perdu (glyphes sans Unicode), relu en image : PaddleOCR non joignable (OCR_URL absente).

## Tableau

| | cas | mesurés | champs exacts | écritures exactes | à trancher | **fausses** | refus justes | refus mal nommés | refus injustes |
|---|---|---|---|---|---|---|---|---|---|
| **tous** | 100 | 18 | 451/451 (100 %) | 14/15 (93 %) | 1 | 0 | 3/3 (100 %) | 0 | 0 |
| langue = ar | 30 | 0 | — | — | 0 | 0 | — | 0 | 0 |
| langue = fr | 40 | 18 | 451/451 (100 %) | 14/15 (93 %) | 1 | 0 | 3/3 (100 %) | 0 | 0 |
| langue = hybride | 30 | 0 | — | — | 0 | 0 | — | 0 | 0 |
| rendu = manuscrit | 25 | 0 | — | — | 0 | 0 | — | 0 | 0 |
| rendu = pdf | 45 | 18 | 451/451 (100 %) | 14/15 (93 %) | 1 | 0 | 3/3 (100 %) | 0 | 0 |
| rendu = photo | 30 | 0 | — | — | 0 | 0 | — | 0 | 0 |
| scenario = achat_13 | 7 | 1 | 21/21 (100 %) | 1/1 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_eur | 7 | 1 | 25/25 (100 %) | 1/1 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_exonere | 6 | 1 | 21/21 (100 %) | 1/1 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_fodec | 10 | 2 | 55/55 (100 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_immobilisation | 8 | 1 | 18/18 (100 %) | 0/1 (0 %) | 1 | 0 | — | 0 | 0 |
| scenario = achat_plusieurs_taux | 9 | 2 | 63/63 (100 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_remise | 10 | 2 | 45/45 (100 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_un_taux | 15 | 4 | 99/99 (100 %) | 2/2 (100 %) | 0 | 0 | 2/2 (100 %) | 0 | 0 |
| scenario = avoir_achat | 6 | 1 | 19/19 (100 %) | — | 0 | 0 | 1/1 (100 %) | 0 | 0 |
| scenario = vente_plusieurs_taux | 8 | 2 | 66/66 (100 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = vente_un_taux | 8 | 0 | — | — | 0 | 0 | — | 0 | 0 |
| scenario = vente_usd_export | 6 | 1 | 19/19 (100 %) | 1/1 (100 %) | 0 | 0 | — | 0 | 0 |
| defaut = date_absente | 2 | 1 | 24/24 (100 %) | — | 0 | 0 | 1/1 (100 %) | 0 | 0 |
| defaut = montant_illisible | 2 | 0 | — | — | 0 | 0 | — | 0 | 0 |
| defaut = null | 92 | 16 | 400/400 (100 %) | 14/15 (93 %) | 1 | 0 | 1/1 (100 %) | 0 | 0 |
| defaut = total_faux | 2 | 1 | 27/27 (100 %) | — | 0 | 0 | 1/1 (100 %) | 0 | 0 |
| defaut = tva_fausse | 2 | 0 | — | — | 0 | 0 | — | 0 | 0 |

« à trancher » : l'écriture du paramétrage, proposée avec la réserve qui nomme la question
que le Socle ne tranche pas (une immobilisation : `immobilisation_a_trancher`) — ni exacte, ni
fausse, et jamais en silence. « fausses » : une écriture proposée qui n'est pas l'écriture
attendue, ou une écriture proposée là où un refus était attendu — le pire résultat. « refus mal nommés » : la pièce
est refusée, mais pas pour la raison attendue. « refus injustes » : aucune écriture,
alors qu'une écriture juste était attendue.

## Écarts

- **007** (fr, pdf, achat_immobilisation) — a_trancher : proposée avec la réserve « immobilisation_a_trancher » : à trancher par le cabinet

## Diagnostic du Socle : les PDF au texte perdu, jugés sur leur couche telle quelle

La production relit ces 27 PDF en image (glyphes sans Unicode : `laCoucheSeCroit`).
Sans second lecteur ici, ils ne sont pas mesurés plus haut. Ce diagnostic les juge sur leur
couche de texte telle quelle — montants, matricules et dates y sont exacts, les mots arabes
perdus — pour garder le jugement et la proposition du Socle sous mesure. Seul le titre, perdu
lui aussi, est celui que le rendu a imprimé : sans lui, le contrôle de la nature bloquerait
tout, à bon droit. Ce n'est pas une mesure de la chaîne.

| | cas | mesurés | champs exacts | écritures exactes | à trancher | **fausses** | refus justes | refus mal nommés | refus injustes |
|---|---|---|---|---|---|---|---|---|---|
| **tous** | 27 | 27 | 599/618 (97 %) | 17/22 (77 %) | 5 | 0 | 5/5 (100 %) | 0 | 0 |
| langue = ar | 13 | 13 | 271/290 (93 %) | 8/11 (73 %) | 3 | 0 | 2/2 (100 %) | 0 | 0 |
| langue = hybride | 14 | 14 | 328/328 (100 %) | 9/11 (82 %) | 2 | 0 | 3/3 (100 %) | 0 | 0 |
| rendu = pdf | 27 | 27 | 599/618 (97 %) | 17/22 (77 %) | 5 | 0 | 5/5 (100 %) | 0 | 0 |
| scenario = achat_13 | 2 | 2 | 41/42 (98 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_eur | 2 | 2 | 37/38 (97 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_exonere | 2 | 2 | 40/42 (95 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_fodec | 2 | 2 | 47/49 (96 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_immobilisation | 3 | 3 | 52/54 (96 %) | 0/3 (0 %) | 3 | 0 | — | 0 | 0 |
| scenario = achat_plusieurs_taux | 2 | 2 | 62/63 (98 %) | 2/2 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_remise | 3 | 3 | 64/66 (97 %) | 3/3 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = achat_un_taux | 4 | 4 | 90/93 (97 %) | 2/2 (100 %) | 0 | 0 | 2/2 (100 %) | 0 | 0 |
| scenario = avoir_achat | 2 | 2 | 43/44 (98 %) | — | 0 | 0 | 2/2 (100 %) | 0 | 0 |
| scenario = vente_plusieurs_taux | 1 | 1 | 33/33 (100 %) | 1/1 (100 %) | 0 | 0 | — | 0 | 0 |
| scenario = vente_un_taux | 3 | 3 | 73/75 (97 %) | 1/2 (50 %) | 1 | 0 | 1/1 (100 %) | 0 | 0 |
| scenario = vente_usd_export | 1 | 1 | 17/19 (89 %) | 0/1 (0 %) | 1 | 0 | — | 0 | 0 |
| defaut = montant_illisible | 1 | 1 | 27/27 (100 %) | — | 0 | 0 | 1/1 (100 %) | 0 | 0 |
| defaut = null | 24 | 24 | 525/543 (97 %) | 17/22 (77 %) | 5 | 0 | 2/2 (100 %) | 0 | 0 |
| defaut = total_faux | 1 | 1 | 26/27 (96 %) | — | 0 | 0 | 1/1 (100 %) | 0 | 0 |
| defaut = tva_fausse | 1 | 1 | 21/21 (100 %) | — | 0 | 0 | 1/1 (100 %) | 0 | 0 |

- **041** (ar, pdf, achat_remise) — exacte
  - champ issuer : lu "ﺢ\u0000 \u0000 \u0000 ﺴ \u0000 \u0000 ﻠ ﻟ \u0000 ں ﺎ \u0000 ﺣ ﺮ \u0000 \u0000", attendu "برجان للنسيج"
- **042** (ar, pdf, achat_fodec) — exacte
  - champ issuer : lu "ں\u0000 وادرا \u0000 ٮ ﺎ \u0000 ﺳ ور", attendu "ورشات وادران"
  - champ references.numero : lu "٢٠٢٦ / ٥٠٣٦", attendu "٢٠٢٦/٥٠٣٦"
- **043** (ar, pdf, achat_un_taux, défaut total_faux) — refus_juste : coherence_arithmetique/incoherent
  - champ issuer : lu "ﻪ\u0000 ﺣ لا \u0000 \u0000 ﻠ ﻟ \u0000 ں ا ﺮ \u0000 \u0000 \u0000 ر د", attendu "دزيران للفلاحة"
- **044** (ar, pdf, achat_immobilisation) — a_trancher : proposée avec la réserve « immobilisation_a_trancher » : à trancher par le cabinet
  - champ issuer : lu "ں\u0000 وادرا \u0000 ٮ ﺎ \u0000 ﺳ ور", attendu "ورشات وادران"
  - champ references.numero : lu "٢٠٢٦ / ٨٠٥١", attendu "٢٠٢٦/٨٠٥١"
- **045** (ar, pdf, achat_eur) — exacte
  - champ issuer : lu "ٮ\u0000 ﺎ ﻣ ﺪ \u0000 ﺤ ﻠ ﻟ \u0000 ٮ ﺮ \u0000 \u0000 \u0000 ﺮ ﻤ \u0000 \u0000", attendu "تمزيرت للخدمات"
- **046** (ar, pdf, vente_usd_export) — a_trancher : proposée avec la réserve « nature_de_vente » : à trancher par le cabinet
  - champ issuer : lu "ﻪ\u0000 \u0000 \u0000 \u0000 \u0000 \u0000 \u0000 ﺮ \u0000 ﺤ \u0000 \u0000 ﻟ ا \u0000 ں ﺎ \u0000 \u0000 ﺮ \u0000 \u0000 \u0000 ﻪ ﻛ ﺮ \u0000 ﺳ", attendu "شركة نرفان التجريبية"
  - champ references.numero : lu "٢٠٢٦ / ٦٠٤٢", attendu "٢٠٢٦/٦٠٤٢"
- **047** (ar, pdf, avoir_achat) — refus_juste : proposition/facture_d_origine
  - champ issuer : lu "ٮ\u0000 ﺎ ﻣ ﺪ \u0000 ﺤ ﻠ ﻟ \u0000 ٮ ﺮ \u0000 \u0000 \u0000 ﺮ ﻤ \u0000 \u0000", attendu "تمزيرت للخدمات"
- **048** (ar, pdf, achat_exonere) — exacte
  - champ issuer : lu "ﻊ \u0000 \u0000 \u0000 ر ﻮ \u0000 \u0000 ﻠ ﻟ \u0000 ە ﺮ \u0000 \u0000 ﻤ ﻟ و", attendu "ولميرة للتوزيع"
  - champ references.numero : lu "٢٠٢٦ / ٤٢٢٨", attendu "٢٠٢٦/٤٢٢٨"
- **049** (ar, pdf, achat_13) — exacte
  - champ issuer : lu "ٮ\u0000 ﺎ \u0000 \u0000 \u0000 \u0000 \u0000 \u0000 ﻜ ﻤ ﻠ ﻟ \u0000 ە ﺮ \u0000 \u0000 ﺼ \u0000 \u0000", attendu "قصيرة للمكتبيات"
- **050** (ar, pdf, achat_un_taux) — exacte
  - champ issuer : lu "ٮ\u0000 ﺎ ﻣ ﺪ \u0000 ﺤ ﻠ ﻟ \u0000 ٮ ﺮ \u0000 \u0000 \u0000 ﺮ ﻤ \u0000 \u0000", attendu "تمزيرت للخدمات"
  - champ references.numero : lu "٢٠٢٦ / ٩١٨٣", attendu "٢٠٢٦/٩١٨٣"
- **051** (ar, pdf, achat_plusieurs_taux) — exacte
  - champ issuer : lu "ں\u0000 ﺎ \u0000 \u0000 ﻠ ﺳ \u0000 ﻪ ﻌ \u0000 \u0000 ﻄ ﻣ", attendu "مطبعة سلفان"
- **052** (ar, pdf, vente_un_taux) — a_trancher : proposée avec la réserve « nature_de_vente » : à trancher par le cabinet
  - champ issuer : lu "ﻪ\u0000 \u0000 \u0000 \u0000 \u0000 \u0000 \u0000 ﺮ \u0000 ﺤ \u0000 \u0000 ﻟ ا \u0000 ں ﺎ \u0000 \u0000 ﺮ \u0000 \u0000 \u0000 ﻪ ﻛ ﺮ \u0000 ﺳ", attendu "شركة نرفان التجريبية"
  - champ references.numero : lu "٢٠٢٦ / ٣٥٤٢", attendu "٢٠٢٦/٣٥٤٢"
- **053** (ar, pdf, achat_remise) — exacte
  - champ issuer : lu "ﻪ\u0000 ﺣ لا \u0000 \u0000 ﻠ ﻟ \u0000 ں ا ﺮ \u0000 \u0000 \u0000 ر د", attendu "دزيران للفلاحة"
- **071** (hybride, pdf, achat_immobilisation) — a_trancher : proposée avec la réserve « immobilisation_a_trancher » : à trancher par le cabinet
- **083** (hybride, pdf, achat_immobilisation) — a_trancher : proposée avec la réserve « immobilisation_a_trancher » : à trancher par le cabinet
