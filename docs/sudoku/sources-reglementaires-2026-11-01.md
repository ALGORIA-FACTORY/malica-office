# Les points réglementaires fermés le 1er novembre 2026

Chaque réponse est lue dans le texte officiel quand il était accessible
(codes fiscaux consolidés 2026 et note commune de la DGI sur jibaya.tn, Code
des sociétés commerciales et décret 2006-1546 publiés par le CMF), sinon dans
deux reproductions concordantes. Texte, pratique, risque. Consulté le
1er novembre 2026.

## Droit de timbre sur facture

| Point | Texte | Ce que Malica en fait |
| --- | --- | --- |
| Droit standard | 1 D par facture : CDET art. 117-I n° 6, modifié par le décret-loi 2022-79 (LF 2023) art. 69, depuis le 1er janvier 2023 (NC 02/2023). | `ref.fiscal_charges` DROIT_TIMBRE. |
| Grandes surfaces | LF 2026 (loi 2025-17) art. 20 n° 6 : 1,500 D par facture « entre 50 et 100 dinars », 2,000 D au-delà de 100 dinars. Note commune DGI n° 11/2026. | `ref.baremes_des_droits` ; le lecteur admet ces montants à la date de la pièce. |
| Bornes | 50 D et 100 D appartiennent à la tranche de 1,500 D ; la seconde commence au-dessus de 100 D (« يفوق مبلغها 100 دينار »). | Tranches du barème. |
| Assiette | « مبلغها » : le montant de la facture, sans autre précision dans la loi ni dans la NC 11/2026. | Le Socle compare le total TTC imprimé (#164). |
| Grande surface | Surface commerciale autorisée dont la base de construction dépasse 3 000 m², ou la surface de vente 1 500 m² (CATU art. 5 bis et 11 bis ; décret 2013-664 modifié par le décret gouvernemental 2017-1253), d'après la NC 11/2026. | Le cabinet classe le tiers (`tiers.auxiliaires.categorie_de_bareme`). |
| Entrée en vigueur | 1er janvier 2026 (LF 2026 art. 110, cité par la NC 11/2026). | `valid_from` du barème. |
| Hors champ | Les factures de téléphone et d'internet ont leur propre régime (art. 117 n° 8). | — |
| Exonérations (art. 118, CDET 2026) | Droit supporté par l'État seul (n° 1) ; factures non acceptées ou non payées (n° 13) ; mandats de paiement publics et factures à leur appui (n° 19) ; factures STEG, SONEDE, ONP (n° 20). **L'exonération des factures d'exportation est abrogée.** | À appliquer par le Socle, pas par le lecteur : le lecteur lit ce qui est imprimé. |

## Contrôle fiscal (CDPF, éditions 2024 en français et 2026 en arabe)

- Réponse aux résultats d'une vérification préliminaire ou approfondie : **45 jours** (art. 43, tiret modifié par le décret-loi 2021-21 art. 48 ; art. 44, modifié par la loi 2014-59 art. 31). Vérification ponctuelle : **10 jours**.
- L'administration répond à l'opposition dans **90 jours** au plus (art. 44 bis, LF 2015 art. 30 et LF 2021 art. 30) ; le contribuable a ensuite **15 jours** pour répliquer.
- « 60 jours » n'est pas un délai de réponse : c'est le report possible du début d'une vérification, et la durée maximale d'une vérification ponctuelle hors comptabilité conforme.

## Retenues à la source (Code IRPP/IS 2026, art. 52-I)

- Rémunérations de la performance dans la prestation de services pour le compte d'autrui : **10 %** (art. 52-I-a, al. 2 ; LF 2015 art. 29-3, LF 2021 art. 14-5).
- 15 % : rémunérations et revenus servis aux non-résidents non établis (art. 52-I-b) — ce n'est pas la performance.
- Jetons de présence et rémunérations des membres des conseils : **20 %** (art. 52-I-c).

## TVA (Code de la TVA 2026)

- Art. 19-1 : le client tunisien retient **toute la TVA due** sur les opérations d'une personne sans établissement en Tunisie ; la retenue est libératoire.
- Art. 19 bis : l'État, les collectivités et les établissements publics retiennent **25 %** de la TVA sur les montants d'au moins 1 000 D, TVA comprise.

## Sociétés (Code des sociétés commerciales, édition de l'Imprimerie officielle publiée par le CMF ; décret 2006-1546)

- Réserve légale : 5 % du bénéfice jusqu'au dixième du capital — SA art. 287, SARL art. 140.
- Commissaire aux comptes : désigné pour **trois ans renouvelables**, pour toute société commerciale (art. 13 bis) ; au plus 3 mandats successifs pour une personne physique, 5 pour une société, quand un expert-comptable de l'OECT est exigé.
- Obligation de désigner un CAC (sociétés autres que par actions) : deux des trois seuils — bilan 100 000 D, produits HT 300 000 D, 10 employés (décret 2006-1546 art. 1). Le CAC doit être expert-comptable de l'OECT au-delà de deux des seuils de l'art. 2 : 1 500 000 D, 2 000 000 D, 30 employés.

## Travail

- Durée maximale : 48 heures par semaine ; une convention ou un texte réglementaire peut la réduire, sans descendre sous 40 heures (Code du travail art. 79).

## Les mots arabes des textes

- Bail (COC art. 742) : المكري (le bailleur), المكتري (le preneur). المسوّغ / المتسوّغ relèvent de l'usage des contrats, pas du code.
- Créancier et débiteur (COC art. 137, 145, 186) : الدائن، المدين.
- Code du travail art. 6 : العامل ou الأجير (le salarié), المؤجر (l'employeur).
- CDPF : المطالب بالأداء (le contribuable, le redevable).

## Matricule fiscal

La DGI ne publie pas l'algorithme de la lettre de contrôle. La formule
(somme pondérée 7 à 1 des sept chiffres, modulo 23, sur l'alphabet sans I, O,
U) retrouve la lettre de 146 des 150 matricules publics d'entreprises testés.
**Décision** : la forme du matricule bloque ; la lettre de contrôle ne fait
qu'avertir. Elle ne bloquera que si la DGI publie l'algorithme.
