# Mesure du jeu synthétique

Produit par `node --experimental-strip-types outils/jeu-synthetique/mesurer.mjs`. Ne pas
éditer à la main : relancer.

Chaîne mesurée : relevé de production (`relever`) → désignation ATTENDUE (désignateur
idéal, voir le README) → relecture au plan → jugement → proposition du Socle.

**55 cas non mesurés** : image : PaddleOCR non joignable (OCR_URL absente).

## Tableau

| | cas | mesurés | champs exacts | écritures exactes | **fausses** | refus justes | refus mal nommés | refus injustes |
|---|---|---|---|---|---|---|---|---|
| **tous** | 100 | 45 | 1011/1069 (95 %) | 26/37 (70 %) | 4 | 7/8 (88 %) | 0 | 8 |
| langue = ar | 30 | 13 | 232/290 (80 %) | 6/11 (55 %) | 1 | 1/2 (50 %) | 0 | 5 |
| langue = fr | 40 | 18 | 451/451 (100 %) | 12/15 (80 %) | 1 | 3/3 (100 %) | 0 | 2 |
| langue = hybride | 30 | 14 | 328/328 (100 %) | 8/11 (73 %) | 2 | 3/3 (100 %) | 0 | 1 |
| rendu = manuscrit | 25 | 0 | — | — | 0 | — | 0 | 0 |
| rendu = pdf | 45 | 45 | 1011/1069 (95 %) | 26/37 (70 %) | 4 | 7/8 (88 %) | 0 | 8 |
| rendu = photo | 30 | 0 | — | — | 0 | — | 0 | 0 |
| scenario = achat_13 | 7 | 3 | 62/63 (98 %) | 3/3 (100 %) | 0 | — | 0 | 0 |
| scenario = achat_eur | 7 | 3 | 62/63 (98 %) | 3/3 (100 %) | 0 | — | 0 | 0 |
| scenario = achat_exonere | 6 | 3 | 47/63 (75 %) | 2/3 (67 %) | 0 | — | 0 | 1 |
| scenario = achat_fodec | 10 | 4 | 102/104 (98 %) | 0/4 (0 %) | 0 | — | 0 | 4 |
| scenario = achat_immobilisation | 8 | 4 | 59/72 (82 %) | 0/4 (0 %) | 3 | — | 0 | 1 |
| scenario = achat_plusieurs_taux | 9 | 4 | 125/126 (99 %) | 4/4 (100 %) | 0 | — | 0 | 0 |
| scenario = achat_remise | 10 | 5 | 109/111 (98 %) | 5/5 (100 %) | 0 | — | 0 | 0 |
| scenario = achat_un_taux | 15 | 8 | 189/192 (98 %) | 4/4 (100 %) | 0 | 4/4 (100 %) | 0 | 0 |
| scenario = avoir_achat | 6 | 3 | 62/63 (98 %) | — | 1 | 2/3 (67 %) | 0 | 0 |
| scenario = vente_plusieurs_taux | 8 | 3 | 99/99 (100 %) | 3/3 (100 %) | 0 | — | 0 | 0 |
| scenario = vente_un_taux | 8 | 3 | 59/75 (79 %) | 1/2 (50 %) | 0 | 1/1 (100 %) | 0 | 1 |
| scenario = vente_usd_export | 6 | 2 | 36/38 (95 %) | 1/2 (50 %) | 0 | — | 0 | 1 |
| defaut = date_absente | 2 | 1 | 24/24 (100 %) | — | 0 | 1/1 (100 %) | 0 | 0 |
| defaut = montant_illisible | 2 | 1 | 27/27 (100 %) | — | 0 | 1/1 (100 %) | 0 | 0 |
| defaut = null | 92 | 40 | 886/943 (94 %) | 26/37 (70 %) | 4 | 2/3 (67 %) | 0 | 8 |
| defaut = total_faux | 2 | 2 | 53/54 (98 %) | — | 0 | 2/2 (100 %) | 0 | 0 |
| defaut = tva_fausse | 2 | 1 | 21/21 (100 %) | — | 0 | 1/1 (100 %) | 0 | 0 |

« fausses » : une écriture proposée qui n'est pas l'écriture attendue, ou une écriture
proposée là où un refus était attendu — le pire résultat. « refus mal nommés » : la pièce
est refusée, mais pas pour la raison attendue. « refus injustes » : aucune écriture,
alors qu'une écriture juste était attendue.

## Écarts

- **005** (fr, pdf, achat_fodec) — refus_injuste : coherence_arithmetique/incoherent
- **007** (fr, pdf, achat_immobilisation) — fausse : lignes 401|0.000000|8439.831000| ; 4366|1347.376000|0.000000|TVA19 ; 601|7091.455000|0.000000| ; 6654|1.000000|0.000000| ≠ 2282|7091.455000|0.000000| ; 401|0.000000|8439.831000| ; 4366|1347.376000|0.000000|TVA19 ; 6654|1.000000|0.000000|
- **017** (fr, pdf, achat_fodec) — refus_injuste : coherence_arithmetique/incoherent
- **041** (ar, pdf, achat_remise) — exacte
  - champ issuer : lu "ﺢ\u0000 \u0000 \u0000 ﺴ \u0000 \u0000 ﻠ ﻟ \u0000 ں ﺎ \u0000 ﺣ ﺮ \u0000 \u0000", attendu "برجان للنسيج"
- **042** (ar, pdf, achat_fodec) — refus_injuste : coherence_arithmetique/incoherent
  - champ issuer : lu "ں\u0000 وادرا \u0000 ٮ ﺎ \u0000 ﺳ ور", attendu "ورشات وادران"
  - champ references.numero : lu "٢٠٢٦ / ٥٠٣٦", attendu "٢٠٢٦/٥٠٣٦"
- **043** (ar, pdf, achat_un_taux, défaut total_faux) — refus_juste : coherence_arithmetique/incoherent
  - champ issuer : lu "ﻪ\u0000 ﺣ لا \u0000 \u0000 ﻠ ﻟ \u0000 ں ا ﺮ \u0000 \u0000 \u0000 ر د", attendu "دزيران للفلاحة"
- **044** (ar, pdf, achat_immobilisation) — refus_injuste : coherence_arithmetique/taux_non_lu
  - champ issuer : lu "ں\u0000 وادرا \u0000 ٮ ﺎ \u0000 ﺳ ور", attendu "ورشات وادران"
  - champ references.numero : lu "٢٠٢٦ / ٨٠٥١", attendu "٢٠٢٦/٨٠٥١"
  - champ totals.base_ht : lu null, attendu "4387.269"
  - champ totals.vat : lu null, attendu "833.581"
  - champ totals.ttc : lu null, attendu "5221.850"
  - champ lines[0].tax_code : lu null, attendu "TVA19"
  - champ lines[0].base_ht : lu null, attendu "4387.269"
  - champ lines[0].vat_amount : lu null, attendu "833.581"
  - champ other_charges[0].code : lu null, attendu "DROIT_TIMBRE"
  - champ other_charges[0].amount : lu null, attendu "1.000"
  - champ articles[0].quantity : lu null, attendu "1.000"
  - champ articles[0].unit_price_ht : lu null, attendu "4387.269"
  - champ articles[0].total_ht : lu null, attendu "4387.269"
- **045** (ar, pdf, achat_eur) — exacte
  - champ issuer : lu "ٮ\u0000 ﺎ ﻣ ﺪ \u0000 ﺤ ﻠ ﻟ \u0000 ٮ ﺮ \u0000 \u0000 \u0000 ﺮ ﻤ \u0000 \u0000", attendu "تمزيرت للخدمات"
- **046** (ar, pdf, vente_usd_export) — refus_injuste : sens_de_la_piece
  - champ issuer : lu "ﻪ\u0000 \u0000 \u0000 \u0000 \u0000 \u0000 \u0000 ﺮ \u0000 ﺤ \u0000 \u0000 ﻟ ا \u0000 ں ﺎ \u0000 \u0000 ﺮ \u0000 \u0000 \u0000 ﻪ ﻛ ﺮ \u0000 ﺳ", attendu "شركة نرفان التجريبية"
  - champ references.numero : lu "٢٠٢٦ / ٦٠٤٢", attendu "٢٠٢٦/٦٠٤٢"
- **047** (ar, pdf, avoir_achat) — fausse : proposée alors que le refus « nature_piece » était attendu
  - champ issuer : lu "ٮ\u0000 ﺎ ﻣ ﺪ \u0000 ﺤ ﻠ ﻟ \u0000 ٮ ﺮ \u0000 \u0000 \u0000 ﺮ ﻤ \u0000 \u0000", attendu "تمزيرت للخدمات"
- **048** (ar, pdf, achat_exonere) — refus_injuste : coherence_arithmetique/taux_non_lu
  - champ issuer : lu "ﻊ \u0000 \u0000 \u0000 ر ﻮ \u0000 \u0000 ﻠ ﻟ \u0000 ە ﺮ \u0000 \u0000 ﻤ ﻟ و", attendu "ولميرة للتوزيع"
  - champ references.numero : lu "٢٠٢٦ / ٤٢٢٨", attendu "٢٠٢٦/٤٢٢٨"
  - champ totals.base_ht : lu null, attendu "5820.320"
  - champ totals.vat : lu null, attendu "0.000"
  - champ totals.ttc : lu null, attendu "5821.320"
  - champ lines[0].tax_code : lu null, attendu "EXO"
  - champ lines[0].base_ht : lu null, attendu "5820.320"
  - champ lines[0].vat_amount : lu null, attendu "0.000"
  - champ other_charges[0].code : lu null, attendu "DROIT_TIMBRE"
  - champ other_charges[0].amount : lu null, attendu "1.000"
  - champ articles[0].quantity : lu null, attendu "2.000"
  - champ articles[0].unit_price_ht : lu null, attendu "2908.747"
  - champ articles[0].total_ht : lu null, attendu "5817.494"
  - champ articles[1].quantity : lu null, attendu "1.000"
  - champ articles[1].unit_price_ht : lu null, attendu "2.826"
  - champ articles[1].total_ht : lu null, attendu "2.826"
- **049** (ar, pdf, achat_13) — exacte
  - champ issuer : lu "ٮ\u0000 ﺎ \u0000 \u0000 \u0000 \u0000 \u0000 \u0000 ﻜ ﻤ ﻠ ﻟ \u0000 ە ﺮ \u0000 \u0000 ﺼ \u0000 \u0000", attendu "قصيرة للمكتبيات"
- **050** (ar, pdf, achat_un_taux) — exacte
  - champ issuer : lu "ٮ\u0000 ﺎ ﻣ ﺪ \u0000 ﺤ ﻠ ﻟ \u0000 ٮ ﺮ \u0000 \u0000 \u0000 ﺮ ﻤ \u0000 \u0000", attendu "تمزيرت للخدمات"
  - champ references.numero : lu "٢٠٢٦ / ٩١٨٣", attendu "٢٠٢٦/٩١٨٣"
- **051** (ar, pdf, achat_plusieurs_taux) — exacte
  - champ issuer : lu "ں\u0000 ﺎ \u0000 \u0000 ﻠ ﺳ \u0000 ﻪ ﻌ \u0000 \u0000 ﻄ ﻣ", attendu "مطبعة سلفان"
- **052** (ar, pdf, vente_un_taux) — refus_injuste : coherence_arithmetique/taux_non_lu+sens_de_la_piece
  - champ issuer : lu "ﻪ\u0000 \u0000 \u0000 \u0000 \u0000 \u0000 \u0000 ﺮ \u0000 ﺤ \u0000 \u0000 ﻟ ا \u0000 ں ﺎ \u0000 \u0000 ﺮ \u0000 \u0000 \u0000 ﻪ ﻛ ﺮ \u0000 ﺳ", attendu "شركة نرفان التجريبية"
  - champ references.numero : lu "٢٠٢٦ / ٣٥٤٢", attendu "٢٠٢٦/٣٥٤٢"
  - champ totals.base_ht : lu null, attendu "3229.094"
  - champ totals.vat : lu null, attendu "613.528"
  - champ totals.ttc : lu null, attendu "3843.622"
  - champ lines[0].tax_code : lu null, attendu "TVA19"
  - champ lines[0].base_ht : lu null, attendu "3229.094"
  - champ lines[0].vat_amount : lu null, attendu "613.528"
  - champ other_charges[0].code : lu null, attendu "DROIT_TIMBRE"
  - champ other_charges[0].amount : lu null, attendu "1.000"
  - champ articles[0].quantity : lu null, attendu "2.000"
  - champ articles[0].unit_price_ht : lu null, attendu "1431.741"
  - champ articles[0].total_ht : lu null, attendu "2863.482"
  - champ articles[1].quantity : lu null, attendu "4.000"
  - champ articles[1].unit_price_ht : lu null, attendu "91.403"
  - champ articles[1].total_ht : lu null, attendu "365.612"
- **053** (ar, pdf, achat_remise) — exacte
  - champ issuer : lu "ﻪ\u0000 ﺣ لا \u0000 \u0000 ﻠ ﻟ \u0000 ں ا ﺮ \u0000 \u0000 \u0000 ر د", attendu "دزيران للفلاحة"
- **071** (hybride, pdf, achat_immobilisation) — fausse : lignes 401|0.000000|12139.055000| ; 4366|1938.009000|0.000000|TVA19 ; 601|10200.046000|0.000000| ; 6654|1.000000|0.000000| ≠ 2282|10200.046000|0.000000| ; 401|0.000000|12139.055000| ; 4366|1938.009000|0.000000|TVA19 ; 6654|1.000000|0.000000|
- **081** (hybride, pdf, achat_fodec) — refus_injuste : coherence_arithmetique/incoherent
- **083** (hybride, pdf, achat_immobilisation) — fausse : lignes 401|0.000000|8474.537000| ; 4366|1352.918000|0.000000|TVA19 ; 601|7120.619000|0.000000| ; 6654|1.000000|0.000000| ≠ 2282|7120.619000|0.000000| ; 401|0.000000|8474.537000| ; 4366|1352.918000|0.000000|TVA19 ; 6654|1.000000|0.000000|
