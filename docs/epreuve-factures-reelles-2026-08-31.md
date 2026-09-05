# Épreuve de la capture sur factures réelles — 31 août 2026

**Jeu** : `bouzekriranim/factures-pfe-tns` (Kaggle, public, aucune clé requise) — 516 factures
tunisiennes réelles, 209 Mo, réparties en « facture achat » et « facture vente ». Le dossier
DREAM OPTIC du jeu d'essai porte d'ailleurs le nom de l'émetteur des factures de vente : le jeu
de démonstration du dépôt a été modelé sur ce corpus.

**Échantillon** : 20 documents (10 achats, 10 ventes), rasterisés page 1 en JPEG 200 dpi
(pdf.js + `@napi-rs/canvas`, déjà présents dans les dépendances).

**Chaîne exercée** : passe 1 telle qu'elle est en production — `runVisionRead` (Qwen-VL-OCR
`qwen-vl-ocr-2025-11-20`) pour l'œil, DeepSeek `deepseek-reasoner` pour la désignation, puis
`buildExtractFromTokenPlan` pour le filtre. Aucune valeur du modèle n'est acceptée telle quelle.

---

## 1. Le résultat qui compte : R2 tient sur du réel

**Zéro citation orpheline sur 18 documents lus.** Pas une seule valeur produite hors du plan de
tokens. La règle « tout montant pointe vers le token qui le porte, ou vaut `null` accompagné d'un
drapeau » n'est pas une intention : elle se vérifie sur des factures que personne n'avait
préparées.

Deux comportements de refus, tous deux corrects :

- **`ACHAT00154` : `valide = false`.** Le lecteur n'a pas pu citer les totaux ni les lignes
  d'articles. Il a posé onze drapeaux `MISSING_CITATION` et n'a rien inventé.
- **`ACHAT00150` et `ACHAT00152` : lecture refusée** — « Qwen a tronqué le relevé (plafond de
  jetons atteint) ». Le système préfère échouer bruyamment plutôt que travailler sur un plan de
  tokens incomplet. C'est exactement la doctrine du dépôt.

Vérification manuelle de `ACHAT00149` (BEST VIEW → TAREK ZOUAOUI, facture 20260197), ligne à
ligne contre l'image : émetteur, date, numéro, matricule fiscal, quantités (60 et 24), prix
unitaires HT (7,549 et 18,350), prix TTC nets (6,288 et 15,286), montants HT (317,058 et
308,280), assiette (625,338) et TVA (118,814) — **tout est exact**. Y compris le piège du
document : le prix TTC est inférieur au prix HT parce qu'il est net d'une remise de 30 %, et le
modèle ne s'est pas laissé prendre.

Le TTC de ligne, lui, n'était pas citable : il a été dérivé par le Socle et marqué comme tel
(`DERIVED_BY_SOCLE` + `MISSING_CITATION`). L'écart avec le « Net à Payer » du document vaut
exactement 1,000 DT — le timbre fiscal. Le système n'a pas comblé le trou, il l'a signalé.

---

## 2. Le défaut structurel : le sens du document n'a pas de propriétaire

| Famille | Documents | Classés conformément | Classés à l'envers |
|---|---|---|---|
| facture achat | 8 | **1** | **7** |
| facture vente | 10 | 10 | 0 |

**7 des 8 factures d'achat sont classées `facture_vente`.** Et les dix ventes sont « justes ».
Cette répartition n'est pas un défaut de qualité du modèle : c'est la signature d'une erreur de
conception.

Une facture d'achat et une facture de vente sont **le même document**. Ce qui les distingue n'est
pas sur le papier : c'est de savoir dans les livres de qui on l'enregistre. Le modèle répond
toujours du point de vue de l'émetteur — donc « vente » — et il a raison du point de vue de
l'émetteur. Il ne peut pas faire autrement : on ne lui a pas dit qui est le tenant.

Les conséquences sont graves parce que `document_kind` gouverne tout l'aval, dans
`buildProposal` :

```ts
journal: extract.document_kind === "facture_achat" ? "ACH" : "VEN",
```

et le choix de l'imputation :

```ts
params.mappings.find((m) => m.documentKind === extract.document_kind && m.taxCode === firstTaxCode)
```

Une facture d'achat mal classée part donc au **journal des ventes**, avec un **compte de produit**
au lieu d'un compte de charge et de la **TVA collectée** au lieu de TVA déductible. L'écriture
reste équilibrée — donc aucun contrôle ne la refuse — et elle est entièrement fausse.

**La donnée nécessaire est pourtant sur le document et dans la base.** `ACHAT00149` porte le code
TVA de l'émetteur (`1920665Q/A/M/000`) et celui du client (`1128882F/P/C/000`) ; les factures de
vente de DREAM OPTIC portent `1128882/F`. `identity.organizations` porte déjà `legal_id`.

**Correction** : `document_kind` ne doit pas être demandé au modèle. Il doit être **résolu** en
comparant le matricule fiscal de l'émetteur et celui du client à celui du tenant :

- matricule du tenant = émetteur → `facture_vente` ;
- matricule du tenant = client → `facture_achat` ;
- aucun des deux → drapeau, et aucune écriture proposée. Pas de repli implicite (R4).

L'extrait doit donc porter `issuer_legal_id` et `customer_legal_id` comme champs cités de premier
plan, et la résolution doit vivre dans le Socle, à un seul endroit.

---

## 3. Deux montants que l'extrait ne sait pas voir

Mesuré sur les 18 documents lus :

| Élément | Capté |
|---|---|
| Articles (désignation, quantité, prix) | **18 / 18** |
| Timbre fiscal | **0 / 18** — `other_charges` est vide partout |
| Remise commerciale | **0 / 18** — aucun champ de remise dans le contrat d'extrait |

**Le timbre fiscal.** Il figure explicitement sur les factures (`Timbre Fiscal : 1,000`,
`TIM 2023`). Il n'entre nulle part. C'est une charge fiscale réelle, avec son propre compte, et
c'est aussi l'écart systématique entre le TTC calculé et le net à payer. `ref.fiscal_charges`
existe et `buildProposal` sait déjà consommer des `fiscal_charges` — la place est prête, l'extrait
ne l'alimente pas.

**La remise.** `ACHAT00149` porte `Total H.T Brut 893,340` et `Remise Articles 268,002` pour un
net de 625,338. L'extrait ne connaît que le net. La remise est une mention obligatoire sur
facture, et sa disparition rend le contrôle du prix unitaire impossible : c'est précisément ce qui
explique qu'un prix TTC net paraisse inférieur à un prix HT brut.

---

## 4. Coût et tenue de charge

| Mesure | Valeur |
|---|---|
| Latence moyenne par document | **139 s** (min 74 s, max 225 s) |
| Jetons modèle sur 18 documents | 127 237 en entrée, 321 249 en sortie |
| Documents refusés pour plafond de jetons | 2 sur 20 (10 %) |

Deux points à retenir. **Deux minutes par facture** est tenable pour un dépôt à l'unité, pas pour
une reprise d'exercice : un cabinet qui charge 2 000 pièces attendrait 77 heures en séquentiel. Il
faudra du parallélisme et une file, avec le budget par tenant que `agents.budgets` prévoit déjà
sans le contrôler.

**Un document sur dix dépasse le plafond de jetons.** Sur les factures denses, l'œil tronque et la
lecture est refusée. C'est le bon comportement, mais ce sont 10 % de pièces qu'un cabinet devra
saisir à la main. Piste : découper la page en bandes et relever bande par bande, ce qui préserve
la géométrie des tokens.

---

## 5. Ce qu'il faut faire avant de déposer ces lectures en base

La passe 2 (`tests/real/ingest-push.ts`) est prête et la base est saine. Mais la déposer en
l'état écrirait **7 écritures fausses sur 18** — factures d'achat au journal des ventes, en
produits et en TVA collectée. Le grand livre serait faux sans qu'aucun contrôle ne bronche, ce
qui est exactement la classe de défaut que ce produit existe pour empêcher.

Trois corrections, dans cet ordre :

1. **Résoudre `document_kind` contre le matricule fiscal du tenant**, jamais le demander au
   modèle (§2). C'est bloquant.
2. **Porter le timbre fiscal dans `other_charges`** et le brancher sur `ref.fiscal_charges` (§3).
3. **Porter la remise** dans le contrat d'extrait, au niveau ligne et au niveau pied (§3).

Le corpus lu est conservé dans `~/jeux-de-donnees/factures-pfe-tns/reads.json` : il est rejouable
en passe 2 sans repayer un seul appel de modèle, dès que les corrections sont faites.

---

## Reproductibilité

```
~/jeux-de-donnees/factures-pfe-tns/
  facture achat/   258 PDF
  facture vente/   258 PDF
  rasteriser.mjs   PDF → JPEG 200 dpi + selection.tsv   (hors dépôt : ni knip ni eslint)
  selection.tsv    source / raster / famille
  taxcodes.json    les 5 codes du pack TN 2026.1, lus en base
  tenants.json     émetteur → tenant
  reads.json       les 18 lectures, avec tokens, citations et drapeaux
```

Passe 1 : `bun tests/real/ingest-read.ts <selection.tsv> <reads.json> <taxcodes.json>` depuis
`apps/web`. Passe 2 : `bun tests/real/ingest-push.ts <reads.json> <tenants.json>`, avec
`REGALICA_EMAIL`, `REGALICA_MOTDEPASSE` et `REGALICA_API_URL=http://127.0.0.1:3000` (l'API écoute
en IPv4 ; `localhost` se résout en `::1` sous Node et la connexion échoue).
