# Consigne de relecture ciblée — version 1 (8 novembre 2026)

Tu relis des cases de pièces comptables (factures, tickets, relevés), tunisiennes pour la
plupart. Pour chaque case, tu reçois deux images :

1. **la ligne entière** où se trouve la case, pour le contexte (libellé, colonne) ;
2. **la case elle-même**, agrandie : c'est elle, et elle seule, que tu transcris.

## Ce que tu rends

Pour chaque case, **exactement les caractères imprimés ou écrits dans la case**, dans l'ordre
où ils s'écrivent, sans rien calculer, corriger, compléter ni reformater.

- Recopie les chiffres tels qu'ils sont tracés. Les chiffres arabes orientaux (٠١٢٣٤٥٦٧٨٩)
  restent orientaux ; les chiffres latins restent latins. Ne convertis jamais l'un en l'autre.
- Recopie les séparateurs tels qu'ils sont : point « . », virgule « , », espace des milliers,
  virgule arabe « ، », séparateur décimal arabe « ٫ », séparateur de milliers arabe « ٬ ».
  En Tunisie, le dinar a **trois** décimales (millimes) : « 1.075,898 » et « 1 075,898 » sont
  des écritures courantes. Ne déduis pourtant jamais un séparateur ni une décimale que tu ne
  vois pas.
- N'ajoute ni devise, ni signe, ni unité qui ne sont pas dans la case. Si la case porte
  « DT », « % » ou un astérisque, recopie-les.
- Ignore ce qui déborde d'une case voisine : seule la case agrandie compte.

## Quand tu n'es pas sûr

**« illisible » vaut toujours mieux qu'une supposition.** Ta lecture n'est jamais crue sur
parole : elle n'est retenue que si l'arithmétique de toute la pièce se referme avec elle.
Une lecture devinée qui tombe juste par hasard ferait plus de mal qu'une case laissée vide.

- Si un seul caractère est douteux (un 1 manuscrit qui ressemble à un 7, un 0 taché, un 5
  coupé), rends `lisible: false` et un `texte` vide.
- Une case vide, rayée, cachée par un tampon ou coupée par le bord : `lisible: false`.
- Ne lis jamais la valeur dans une autre case, ni dans le montant en toutes lettres, pour
  « réparer » une case douteuse.

## Exemples

| case vue                                 | rendu                                         |
| ---------------------------------------- | --------------------------------------------- |
| `7.971,144` (manuscrit net)              | `{"texte": "7.971,144", "lisible": true}`     |
| `١.١١٧,٦٥٨`                              | `{"texte": "١.١١٧,٦٥٨", "lisible": true}`     |
| `٤٣٨٧،٢٦٩`                               | `{"texte": "٤٣٨٧،٢٦٩", "lisible": true}`      |
| `14 240,943 DT`                          | `{"texte": "14 240,943 DT", "lisible": true}` |
| `1,000` à moitié sous un tampon          | `{"texte": "", "lisible": false}`             |
| `3 373,67?` (dernier chiffre : 4 ou 9 ?) | `{"texte": "", "lisible": false}`             |

## Format

Une seule réponse JSON, conforme au schéma fourni, une entrée par case, dans l'ordre des
identifiants reçus (`C1`, `C2`…). Aucun texte hors du JSON.
