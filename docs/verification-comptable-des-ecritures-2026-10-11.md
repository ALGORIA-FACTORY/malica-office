# Vérification comptable des écritures proposées — 11 octobre 2026

Commande : « vérifie profondément comme un expert-comptable les écritures
comptables proposées par Malica du Socle du côté cabinet ».

Objet de la revue : `packages/socle/src/engines/p4/balance.ts` (le moteur qui
construit le pivot), `packages/socle/src/use-cases/propose-ecriture.ts` (ce qui
en est persisté), et ce que l'écran du cabinet en montre.

Méthode : lecture ligne à ligne du moteur, puis fabrication d'une facture
ordinaire que le produit n'avait jamais rencontrée dans ses épreuves — deux
taux de TVA sur la même pièce.

---

## Ce qui est juste, et qu'il faut dire

Un moteur comptable se juge d'abord sur ce qu'il refuse. Celui-ci refuse bien :

- **le taux est résolu à la date de la pièce**, par ligne, et un taux
  inapplicable à cette date bloque l'écriture (`resolveTaxRate`) ;
- **la cohérence taux ↔ montants est vérifiée ligne par ligne** : `base × taux`
  doit retrouver la TVA lue, à la tolérance d'arrondi près ;
- **le résidu de pied de facture est calculé** — TTC imprimé moins HT, TVA et
  droits déclarés — et un résidu inexpliqué **bloque**. Il n'est attribué à un
  droit du pack que si le montant correspond exactement à un montant fixe du
  référentiel ;
- **la contrepartie est déduite des faits comptables** (HT + TVA + droits), et
  ne recopie jamais un TTC dont l'écart ne serait pas justifié ;
- **l'équilibre est vérifié strictement** avant de rendre le pivot ;
- **aucun compte n'est inventé** : une charge sans compte au pack bloque ;
- **les lignes nulles ne sont pas persistées** (TVA à zéro sur pièce exonérée).

C'est une base saine. Le défaut trouvé n'est pas un défaut de rigueur : c'est
un cas que personne n'avait posé.

---

## Défaut 1 — La TVA à deux taux était déclarée à un seul **(corrigé)**

**Gravité : élevée.** Fausse la ventilation de TVA, donc la déclaration.

Le moteur posait **une seule ligne de TVA**, portant la somme de tous les taux
(`totalVAT = sum(lines.map(vat_amount))`), et la proposition la timbrait du
code de taxe de la **première ligne** de la pièce :

```ts
tax_code: l.account_code === mapping.vatAccount ? firstTaxCode : null
```

Sur une facture de restaurant tunisienne — 7 % sur les plats, 19 % sur les
boissons — la totalité de la TVA se retrouvait donc déclarée à 7 %, ou à 19 %
selon l'ordre des lignes.

**Pourquoi rien ne le signalait**, et c'est le point qui compte :

| Garde existante | Verdict sur la facture fautive |
|---|---|
| cohérence taux ↔ montants | **passe** — elle travaille ligne par ligne, et chaque ligne est juste |
| résidu de pied de facture | **passe** — HT + TVA + droits = TTC, exactement |
| équilibre débit = crédit | **passe** — au millime |

L'écriture était donc parfaitement équilibrée et parfaitement fausse en
ventilation. Le défaut n'apparaissait qu'au moment de ventiler la TVA par taux,
c'est-à-dire chez l'expert, un mois plus tard, sans aucun moyen de savoir d'où
venait l'écart.

**Second biais, même cause.** Le choix de l'imputation se fait par
`mappings.find(m => m.taxCode === firstTaxCode)`. Le jour où un pack distingue
le compte de TVA par taux, celui du second taux n'était jamais lu.

**Correction.** Une ligne de TVA par code, dans l'ordre d'apparition sur la
pièce (R11 : deux bases doivent rendre la même écriture), chacune timbrée de
son code et imputée au compte que le pack donne pour ce code
(`vat_accounts_by_tax_code`, facultatif — le pack tunisien impute les deux taux
au même compte). La somme ne change pas, l'équilibre non plus.

_Épreuve_ : `packages/socle/src/__tests__/tva-a-deux-taux.test.ts`, six cas,
dont celui qui vérifie qu'un taux unique donne toujours **une** ligne : la
correction ne doit pas transformer le cas ordinaire, qui est la très grande
majorité des factures.

---

## Défaut 2 — Les codes de journal sont écrits en TypeScript **(dette, non corrigé)**

```ts
journal: extract.document_kind === "facture_achat" ? "ACH" : "VEN"
```

R4 interdit la constante réglementaire dans le code, et un code de journal en
est une : il appartient au plan de l'organisation, pas au produit. Deux cabinets
tunisiens peuvent nommer leurs journaux autrement, et la première juridiction
qui impose une autre nomenclature demandera un déploiement.

**Ce qui limite le risque aujourd'hui** : `document_kind` est un énuméré de
deux valeurs dans `extract.v1`, donc la branche `else` ne peut pas attraper un
relevé bancaire ou un avoir par surprise. Le défaut est une dette de
paramétrage, pas une écriture fausse.

À traiter avec les familles de comptes (`account_class` absent du contrat
`AccountRow`), au même endroit du référentiel.

---

## Défaut 3 — La date de l'écriture est pré-remplie au jour du scan **(visible, à surveiller)**

L'écran de la pièce propose le jour du scan quand la date n'a pas été lue, dans
un champ **affiché et modifiable**, et la date ne devient celle de l'écriture
qu'à la confirmation.

Ce n'est donc pas le repli implicite que R4 interdit — il est visible et
surchargeable, c'est-à-dire un défaut livré au sens de R10. Mais le risque
comptable est réel : une facture de janvier scannée en mars et confirmée sans
regarder part dans la déclaration de mars.

**Ce qui a été corrigé le 11 octobre** : la date saisie n'était enregistrée
**nulle part**. L'écriture était datée, et la pièce restait sans mois — elle
figurait encore dans « ces pièces attendent leur date » après que la personne
ait répondu, et son montant restait hors des charges. La saisie pose désormais
une précision, qui reprojette les articles.

Reste à faire : un signalement quand l'écart entre la date confirmée et la date
de réception dépasse un seuil du pack. Aujourd'hui, rien ne distingue une date
confirmée d'une date acceptée sans la lire.

---

## Ce que le cabinet ne voyait pas, et qu'il voit désormais

Trois choses manquaient à son écran, et la troisième touche directement la
qualité de l'imputation :

1. **le moyen de paiement**. La donnée était lisible par lui — sa RLS couvre les
   dossiers sous mandat — et aucun écran ne la demandait. L'expert imputait donc
   une facture sans savoir si elle avait été réglée en espèces ou par chèque,
   alors que **c'est cela qui décide du compte de trésorerie**. L'erreur ne se
   voit qu'au rapprochement bancaire ;
2. **le justificatif de paiement**, photographié par la PME, désormais
   téléchargeable ;
3. **le reçu de dépense ou de revenu**, et tout document issu de la pièce.

---

## Ce qu'une revue comptable ne peut pas conclure seule

Deux limites, qu'il faut écrire pour ne pas se croire couvert :

- **aucune épreuve ne part d'une liasse réelle** portant plusieurs taux, un
  droit de timbre et un acompte à la fois. Les six épreuves ajoutées sont
  fabriquées ; elles tiennent le défaut trouvé, pas ceux qu'on n'a pas imaginés.
  C'est le jeu de 50 factures réelles qui répondra, et rien d'autre ;
- **le plan comptable utilisé est celui du pack livré**. R10 dit que l'expert
  arrête ce qui fait foi chez lui : une imputation « juste » ici peut être
  fausse dans un cabinet qui loge le droit de timbre ailleurs. La vérification
  porte sur le MOTEUR, pas sur le choix des comptes.
