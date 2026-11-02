# Les mentions légales d'une facture d'ALGORIA — état au 2 novembre 2026

Ce document accompagne le moteur commercial (migrations `20261119090000` à
`20261119090700`). Il sépare, pour chaque point, **le texte**, **la
pratique** et **le risque en cas de contrôle**, avec la source et sa date.

**Ce n'est pas un avis juridique.** Les textes officiels n'ont pas tous pu
être relus dans leur version consolidée : le site de la DGI (jibaya.tn)
refuse la lecture automatique (`robots`), et le JORT de la loi de finances
2026 n'a pas été consulté en texte intégral. Tout ce qui n'est pas confirmé
est marqué **INCERTAIN**, et reste un réglage en base que la tour ou le
référentiel change sans migration de code (R4, R10).

## 1. Ce que la facture porte, et d'où vient chaque valeur

| Mention | Sur la facture | Source en base |
|---|---|---|
| Numéro séquentiel ininterrompu | `ALG-FA-2026-0001`, par émetteur, par année, par série | `facturation.compteurs_documents`, verrou de ligne |
| Date d'émission | jour civil de l'émetteur (fuseau de sa juridiction) | `facturation.jour_de_l_emetteur` |
| Identité de l'émetteur : nom, matricule fiscal, adresse | recopiée à l'émission | `identity.organizations` de l'émetteur désigné |
| Identité du client : nom, matricule (cabinet), adresse | recopiée à l'émission | `identity.organizations` ou `identity.profiles` |
| Désignation, quantité, prix unitaire HT | une ligne par prestation, remise et mois offert compris | `facturation.facture_lignes` |
| Total HT, taux et montant de TVA, TTC | taux lu dans le pack (`facture.code_tva` → `ref.tva_rates`) | `ref.socle_params`, `ref.tva_rates` |
| Droit de timbre | `facture.droit_de_timbre` du pack | `ref.socle_params` |
| Échéance | émission + `jours_echeance` | `plateforme.reglages_facturation` |
| Avoir : référence de la facture d'origine et motif | « Avoir sur la facture … du … », motif | `facturation.factures.avoir_de`, `motif` |

Une facture émise ne change plus (déclencheur `deny_mutation`). Une erreur
se corrige par un avoir numéroté dans sa propre série (`ALG-AV-2026-0001`).

## 2. Les mentions obligatoires (Code de la TVA, art. 18)

- **Texte.** L'article 18-II du Code de la TVA oblige l'assujetti non
  forfaitaire à délivrer une facture ; l'article 18-III autorise la facture
  électronique. Source : circulaire fiscale KPMG Tunisie, février 2026, qui
  cite ces paragraphes. La liste exacte des mentions de l'article 18 n'a
  **pas** été relue dans le texte consolidé : **INCERTAIN**.
- **Pratique.** Le référentiel du dépôt (`ref.mentions`, pack TN, semé avant
  ce travail) attribue à l'article 18 : identifiant fiscal de l'émetteur et du
  client, date, numéro séquentiel ininterrompu, désignation, base HT, taux et
  montant de TVA, total TTC ; le droit de timbre au Code des droits
  d'enregistrement et de timbre. Le PDF porte toutes ces mentions.
- **Risque.** Une facture adressée à un titulaire **personne physique** ne
  porte pas le matricule fiscal de sa société (le modèle actuel facture la
  personne, décision du 20 octobre 2026). Pour un client assujetti qui veut
  déduire la TVA, l'absence de son matricule est le risque principal. **À
  trancher** : facturer la société (son nom, son matricule, son adresse) quand
  le titulaire paie pour elle.

## 3. Le droit de timbre

- **Texte.** Droit de timbre par facture : le pack porte **1,000 DT** depuis
  le 1er janvier 2026 (`facture.droit_de_timbre`). La loi de finances 2026
  (loi n° 2025-17 du 12 décembre 2025, art. 20, CDET art. 117-I-6 bis) fixe
  pour les **grandes surfaces** 1,500 DT de 50 à 100 DT et 2,000 DT au-delà ;
  ALGORIA n'est pas une grande surface. Sources : circulaire fiscale KPMG
  Tunisie, avril 2026 ; migration `20261111090000` du dépôt, qui cite l'extrait
  arabe de l'article 20.
- **Pratique.** Un timbre par facture émise ; **aucune facture, donc aucun
  timbre**, quand le mois est offert, en essai ou couvert par l'année.
- **Risque / INCERTAIN.**
  - Le montant de 1,000 DT du droit standard n'a pas été relu dans le CDET
    consolidé 2026.
  - Le timbre d'un **avoir** : le pack porte `avoir.droit_de_timbre = 0`,
    marqué INCERTAIN ; un avoir total ne laisse pas le timbre dû au client
    (`facturation.encours_v`). À confirmer par un fiscaliste.
  - Une **facture électronique** (TEIF) est-elle soumise au même timbre ? Non
    vérifié.

## 4. La facture électronique (TEIF / El Fatoora) — le point le plus sensible

- **Texte.** L'**article 53 de la LF 2026** élargit, **à compter du 1er
  janvier 2026**, le champ de la facturation électronique aux **prestations
  de services** ; la **Note commune n° 2/2026** de la DGI la commente (en
  arabe seulement). Cadre d'exécution : décret gouvernemental n° 2016-1066 du
  15 août 2016, plateforme El Fatoora de Tunisie TradeNet. Sources : KPMG
  Tunisie, circulaire fiscale de février 2026 ; Deloitte Société d'Avocats,
  9 avril 2026 ; La Presse de Tunisie, 7 janvier 2026 ; titre de la Note
  commune n° 2/2026 sur jibaya.tn (contenu non lu).
- **Pratique.** Selon KPMG, l'obligation s'applique « aux prestataires ayant
  adhéré au réseau », avec des mesures d'assouplissement ; une proposition de
  loi de janvier 2026 vise à la limiter aux grandes entreprises (Webmanager
  Center, 23 janvier 2026). **INCERTAIN**.
- **Risque.** ALGORIA vend une prestation de services soumise à la TVA : si
  l'obligation s'applique à elle, un PDF ne suffit plus, et KPMG cite une
  amende de **100 à 500 DT par facture non conforme** (plafond de 50 000 DT
  par contrôle) — chiffres à vérifier sur le texte officiel. **Décision n° 15
  du dirigeant** : à vérifier avec un fiscaliste avant la première émission
  réelle. Le modèle le permet (numéro, identités, lignes et montants figés,
  empreinte du document) ; **rien n'est branché** vers El Fatoora.

## 5. Conservation

- **Texte.** **INCERTAIN** : la base légale de la durée (10 ans est l'usage
  du dépôt) n'a pas été relue.
- **Pratique.** Rien ne se purge : factures, avoirs, lignes, encaissements,
  gestes et empreintes sont en ajout seul (décision n° 13).

## 6. Ce que la tour doit faire confirmer avant la première vraie facture

1. La liste des mentions de l'article 18 dans sa version consolidée, et la
   facturation de la société plutôt que de la personne (§ 2).
2. Le droit de timbre standard 2026, et le sort du timbre d'un avoir (§ 3).
3. L'assujettissement d'ALGORIA à la facture électronique en 2026 (§ 4).
4. La durée de conservation (§ 5) et le traitement comptable du stock de
   lectures dues (produit constaté d'avance, décision n° 9).

## Sources

- KPMG Tunisie, « Extension du champ d'application de la facture
  électronique », circulaire fiscale de février 2026 :
  https://kpmg.com/tn/fr/insights/circulaires-fiscales/extension-champ-application-facture-electronique.html
  et son PDF :
  https://assets.kpmg.com/content/dam/kpmgsites/tn/pdf/circulaires-fiscales/Circulaire%20fiscale%20f%C3%A9vrier%202026%20final.pdf.coredownload.inline.pdf
  (lus le 2 novembre 2026).
- KPMG Tunisie, « Les nouveautés en matière de droit d'enregistrement et de
  timbre », circulaire fiscale d'avril 2026 :
  https://kpmg.com/tn/fr/insights/circulaires-fiscales/les-nouveautes-en-matiere-de-droit-denregistrement-et-de-timbre.html
  (lue le 2 novembre 2026).
- Deloitte Société d'Avocats, « Tunisie : les principales mesures de la loi de
  finances pour 2026 », 9 avril 2026 :
  https://blog.avocats.deloitte.fr/tunisie-les-principales-mesures-de-la-loi-de-finances-pour-2026/
- La Presse de Tunisie, « Tout comprendre à la facture électronique qui
  s'impose en Tunisie en 2026 », 7 janvier 2026 :
  https://www.lapresse.tn/2026/01/07/tout-comprendre-a-la-facture-electronique-qui-simpose-en-tunisie-en-2026/
- DGI, Note commune n° 02/2026 (titre seulement, contenu non lu) :
  https://jibaya.tn/docs/note-commune-n02-2026/
- Webmanager Center, « Réforme fiscale : une proposition de loi pour limiter
  la facturation électronique aux grandes entreprises », 23 janvier 2026 :
  https://www.webmanagercenter.com/2026/01/23/560433/reforme-fiscale-une-proposition-de-loi-pour-limiter-la-facturation-electronique-aux-grandes-entreprises/
