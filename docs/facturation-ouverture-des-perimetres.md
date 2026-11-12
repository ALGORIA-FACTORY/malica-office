# Ouvrir la facturation « PME » et « Comptabilités » : ce que ça change, chiffres à l'appui

Note pour le dirigeant (décision 7.6 du 12 novembre 2026). **Rien n'a été ouvert.** Les deux interrupteurs de
la tour restent coupés. Cette note montre seulement, sur une base de test, ce que leur ouverture changerait.

## D'où viennent les chiffres

Tous les montants ci-dessous ont été **produits par les fonctions de la base**, le 12 novembre 2026, sur la base
de test `malica_r_abonnement` (avec les corrections de la demande de fusion #365). Personne ne les a calculés de
tête. Chaque cas a été joué dans une transaction annulée : rien n'est resté en base.

- Grille en vigueur : Basic 9, Solo 19, Team 34, Premium 59 DT HT par mois. TVA 19 %, timbre 1 DT par facture.
- La société est abonnée depuis le **1er novembre 2026**. Le geste a lieu le **12 novembre** (il reste 19 jours
  sur 30 en novembre).
- « Coupé » = la situation d'aujourd'hui. « Ouvert » = l'interrupteur « PME » ouvert (et « Comptabilités »
  ouvert pour le dernier cas).

## En une phrase

- **Coupé** : la PME reçoit **une facture par mois**, en fin de mois, au prorata des jours passés à chaque offre.
  Une montée se paie par un acompte (sans timbre) qui se déduit de cette facture.
- **Ouvert** : la PME paie **d'avance, à sa date anniversaire**, sans prorata. Ce qui s'ajoute en cours de
  période (une montée, une place) part **le jour même** sur une petite facture complémentaire, avec son propre
  timbre. Une descente ne rend rien : elle prend effet à l'échéance suivante.
- La comptabilité, elle, est facturée **au mois, à terme échu**, dans les deux cas. Ouvrir « Comptabilités »
  change seulement **qui émet** la facture : la machine, chaque jour, au lieu d'une émission à la main.

## 1. Une montée Solo → Premium le 12 novembre

| | Coupé | Ouvert |
|---|---|---|
| Le jour de la montée | Acompte à régler : **25,333 HT · 30,146 TTC** (40 × 19/30, sans timbre) | Facture complémentaire : **25,333 HT · 31,146 TTC** (même écart, plus 1 DT de timbre) |
| Facture de novembre | **44,333 HT · 53,756 TTC** (Solo du 1er au 11, Premium du 12 au 30 ; l'acompte s'y déduit) | Déjà payée d'avance le 1er : **19,000 HT · 23,610 TTC** (Solo, le mois entier) |
| Facture de décembre | **59,000 HT · 71,210 TTC** | **59,000 HT · 71,210 TTC**, émise le 1er décembre, d'avance |

Ce que la PME paie pour novembre : coupé, 53,756 TTC ; ouvert, 23,610 + 31,146 = **54,756 TTC**. La
différence (1 DT) est le timbre de la facture complémentaire.

## 2. Une descente Premium → Team le 12 novembre

| | Coupé | Ouvert |
|---|---|---|
| Facture de novembre | **43,167 HT · 52,369 TTC** (Premium du 1er au 11, Team du 12 au 30) | **59,000 HT · 71,210 TTC**, payée d'avance le 1er ; **rien n'est rendu** |
| Facture de décembre | **34,000 HT · 41,460 TTC** | **34,000 HT · 41,460 TTC** |

Ouvert, la descente coûte à la PME les 19 jours de Premium déjà payés (18,841 TTC de plus qu'en coupé) : c'est la
règle E du 4 novembre (« la période déjà facturée reste due, sans avoir »). **À confirmer juridiquement**
(noté INCERTAIN dans `docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md`).

## 3. Une recharge de 25 lectures (10 DT HT) achetée le 12 novembre, en Solo

| | Coupé | Ouvert |
|---|---|---|
| Où elle est facturée | Sur la facture de **novembre** : **29,000 HT · 35,510 TTC** (19 + 10) | Sur l'échéance suivante, le **1er décembre** : **29,000 HT · 35,510 TTC** (19 de décembre + 10) |
| Décembre | **19,000 HT · 23,610 TTC** | (déjà compris ci-dessus) |

Ouvert, la recharge n'a pas de facture le jour même : elle attend l'échéance suivante (ou se paie en ligne par
son acompte, qui s'impute sur cette échéance).

## 4. La comptabilité couvre Team depuis le 1er novembre, puis arrête le 12

| | Coupé | Ouvert |
|---|---|---|
| Comptabilité, novembre | 11 jours sur 30 de Team : **12,467 HT · 15,836 TTC** — à émettre à la main | **12,467 HT · 15,836 TTC**, émise **par la machine** au passage du 1er décembre |
| PME, novembre | 19 jours de Team : **21,533 HT · 26,624 TTC** | Une nouvelle suite commence le 12 : **34,000 HT · 41,460 TTC** pour le 12 novembre → 11 décembre, payée d'avance |
| PME, ensuite | Décembre : **34,000 HT · 41,460 TTC** | Prochaine échéance le **12 décembre** : 34,000 HT |

Ouvert, la date anniversaire de la PME devient le jour où elle recommence à payer (ici le 12) : elle paie un mois
entier d'avance ce jour-là, au lieu de 19 jours en fin de mois.

## Ce qu'il faut décider

1. **Ouvrir « PME »** : la PME paie d'avance et chaque complément a son timbre ; une descente ne rend rien sur
   la période payée. C'est plus simple à encaisser, mais un peu plus cher pour la PME qui change souvent d'offre.
2. **Ouvrir « Comptabilités »** : ne change aucun montant ; la facture du mois part toute seule le 1er.
3. Les deux interrupteurs sont **indépendants** et se coupent à nouveau à tout moment, avec un motif daté.

## Ce qui n'a pas été vérifié

- Les dates d'émission des factures de comptabilité de l'essai « ouvert » portent le jour où l'essai a tourné
  (12 novembre) ; en vrai, la machine les date du jour de son passage (le 1er du mois).
- Le cas d'une PME dont la licence est née un autre jour que le 1er (son anniversaire tombe alors ce jour-là) n'est
  pas chiffré ici ; il est couvert par les épreuves `la-pme-paie-d-avance-a-sa-date-anniversaire.test.ts`.
