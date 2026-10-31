# Le jeu synthétique : cent factures fictives, et ce qu'elles doivent produire

Cent factures **inventées** — français, arabe, hybride ; PDF tapés, photos, carnets
remplis à la main — avec, pour chacune, les champs qu'elle imprime et l'écriture (ou le
refus nommé) qu'elle doit produire. Elles mesurent la chaîne de lecture et le Socle de
bout en bout. Le jeu d'or (`apps/api/src/malica/lecture/jeu-d-or.ts`) porte les pièces
réelles ; celui-ci complète ce qu'elles ne couvrent pas encore, et chaque cas le dit
(`synthetique: true`, `provenance`).

## Rien de réel, rien de circulaire

- **Rien de réel.** Raisons sociales, adresses, téléphones (préfixe `00`) et matricules
  sont inventés ; les matricules ont la forme tunisienne, tirée par `matriculeDEssai`
  (`apps/api/src/matricule-d-essai.ts`), avec un tirage graine.
- **Rien de circulaire.** Les valeurs et les écritures attendues se calculent dans
  `composer.mjs` / `montants.mjs`, en entiers (`BigInt`), sans rien importer du moteur
  mesuré. Seuls les **comptes, taux et timbre** viennent du référentiel, comme le Socle
  les lit : l'instantané relevé en base (`apps/api/src/scan/referentiel-d-essai.json`,
  vérifié par `le-referentiel-d-essai-dit-vrai.test.ts`) et, pour ce qu'il ne porte pas,
  `referentiel-complementaire.json` (FODEC, compte d'immobilisation, cours fictifs),
  relu en base par `le-jeu-synthetique-dit-le-referentiel.test.ts`. Chaque cas écrit
  dans `attendu.referentiel` le relevé dont il vient.
- **Le même jeu à chaque fois.** Générateur graine (mulberry32, graine `20261031`) ;
  rendu dessiné par Chromium, dates du PDF figées. Deux passes successives donnent des
  fichiers identiques à l'octet (vérifié le 31 octobre 2026 : `cas/` et `rendus/`).

## Les commandes

```sh
node --experimental-strip-types outils/jeu-synthetique/composer.mjs   # cas/NNN.json
node outils/jeu-synthetique/rendre.mjs [NNN …]                          # rendus/NNN.{pdf,jpg} + NNN.boites.json
node --experimental-strip-types outils/jeu-synthetique/mesurer.mjs      # RAPPORT.md + mesure.json
OCR_URL=http://127.0.0.1:8000 node --experimental-strip-types outils/jeu-synthetique/mesurer.mjs  # avec PaddleOCR
```

Les rendus (11 Mo : 1,6 Mo de PDF, 8,2 Mo de JPEG, et les boîtes) sont commités : ils
se régénèrent à l'identique, mais l'épreuve `jeu-synthetique.test.ts` (dans `npm test`)
les lit sans navigateur.

## La matrice

| langue \ rendu | PDF tapé | photo / scan | manuscrit (carnet) | total  |
| -------------- | -------- | ------------ | ------------------ | ------ |
| français       | 18       | 12           | 10                 | **40** |
| arabe (RTL)    | 13       | 9            | 8                  | **30** |
| hybride        | 14       | 9            | 7                  | **30** |
| total          | **45**   | **30**       | **25**             | 100    |

Contenus (tournés dans chaque groupe pour que chaque rendu les voie tous) :

| contenu                                                    | cas | dont PDF |
| ---------------------------------------------------------- | --- | -------- |
| achat, un taux (19 %)                                      | 15  | 8        |
| achat, plusieurs taux (19/13/7/0 %)                        | 9   | 4        |
| vente, un taux                                             | 8   | 3        |
| vente, plusieurs taux dont exonéré                         | 8   | 3        |
| achat avec remise (5 ou 10 %)                              | 10  | 5        |
| achat avec FODEC 1 % (dans la base de TVA)                 | 10  | 4        |
| achat d'immobilisation (serveur, photocopieur)             | 8   | 4        |
| achat en euros (cours fictif 3,4125)                       | 7   | 3        |
| vente export en dollars (cours fictif 3,1072, code EXPORT) | 6   | 2        |
| avoir d'achat (« FACTURE D'AVOIR », « إشعار دائن »)        | 6   | 3        |
| achat exonéré (EXO)                                        | 6   | 3        |
| achat à 13 %                                               | 7   | 3        |

Et, en travers : 78 achats et 22 ventes ; 17 factures à plusieurs taux ; timbre sur 81
(chaque facture en dinars sauf l'avoir) ; séparateur de milliers espace (49), point
(25), virgule à l'anglaise en dollars (6), aucun (20) ; dinar à trois décimales ;
35 montants en toutes lettres (« Arrêtée la présente facture à la somme de … », français
et hybride) ; 14 dates et numéros en chiffres arabes orientaux (٠١٢٣), 6 factures arabes
dont les MONTANTS sont en chiffres orientaux.

Les huit factures défectueuses, dont l'issue juste est un **refus nommé** :

| cas | langue / rendu      | défaut                                      | refus attendu                                                           |
| --- | ------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| 003 | fr / PDF            | total TTC faux (+10,000)                    | `coherence_arithmetique`                                                |
| 043 | ar / PDF            | total TTC faux                              | `coherence_arithmetique`                                                |
| 073 | hybride / PDF       | TVA fausse (+5,000), TTC cohérent avec elle | `coherence_arithmetique`                                                |
| 096 | hybride / manuscrit | TVA fausse                                  | `coherence_arithmetique`                                                |
| 015 | fr / PDF            | date absente                                | `mentions_obligatoires`, `coherence_dates` ou `proposition/a_completer` |
| 056 | ar / photo          | date absente                                | idem                                                                    |
| 084 | hybride / PDF       | TVA et TTC illisibles                       | `coherence_arithmetique` ou `normalisation`                             |
| 021 | fr / photo          | TVA et TTC illisibles                       | idem                                                                    |

`proposition/a_completer` a été admis pour la date absente après la première mesure :
le produit ne la refuse pas par un contrôle, il dit « à compléter — document_date ». C'est
le refus juste et nommé ; la liste du premier jet ne le prévoyait pas (écrit dans
`composer.mjs`).

## Ce que la mesure mesure — et ce qu'elle ne mesure pas

`apps/api/src/malica/lecture/jeu-synthetique.ts` fait passer chaque cas par la chaîne de
production : `relever()` (couche de texte du PDF, ou PaddleOCR pour une image, puis le
recollage des milliers) → **désignation attendue** → `buildExtractFromTokenPlan` →
`jugerLaLecture` → `composerLaProposition` (par `jouer` de
`scan/mesure-des-propositions.ts`, la même mesure que le témoin du Socle).

- **La désignation est celle d'un désignateur idéal**, au sens du jeu d'or : les jetons
  du plan RÉELLEMENT relevé dont le centre tombe dans la boîte où le rendu a posé le
  champ (`rendus/NNN.boites.json`). Aucune valeur n'en vient : un montant mal relevé se
  relit mal. Le désignateur de production (DeepSeek, payant) et les recettes de la
  fabrique (aucune pour ces émetteurs) **ne sont pas mesurés**.
- **La nature des articles n'est pas résolue** (`compteDeNature: null`, comme le
  témoin) : la mesure pure n'a pas de base. En service, une famille reconnue
  (`ref.charge_familles`) peut changer le compte de charge proposé.
- **Les images ne sont pas mesurées ici** : voir plus bas.

## Résultats (31 octobre 2026, 45 PDF mesurés)

|                       | champs exacts    | écritures exactes | **fausses** | refus justes | refus injustes |
| --------------------- | ---------------- | ----------------- | ----------- | ------------ | -------------- |
| avant les corrections | 1005/1069 (94 %) | 25/37 (68 %)      | **4**       | 7/8          | 9              |
| après                 | 1011/1069 (95 %) | 26/37 (70 %)      | **4**       | 7/8          | 8              |
| — français (18)       | 451/451 (100 %)  | 12/15             | 1           | 3/3          | 2              |
| — arabe (13)          | 232/290 (80 %)   | 6/11              | 1           | 1/2          | 5              |
| — hybride (14)        | 328/328 (100 %)  | 8/11              | 2           | 3/3          | 1              |

Le détail par contenu et cas par cas est dans `RAPPORT.md`. La toute première passe
donnait 985 champs exacts : 20 écarts venaient du banc lui-même (son désignateur citait
le deux-points de « MF client : »), corrigé dans le banc, pas dans le produit.

### Causes racines corrigées dans cette PR

1. **Une date aux séparateurs espacés ne se lisait pas** (`normalizeDate`). La couche de
   texte d'un PDF arabe rend « ٢٠٢٦/١٠/٠٧ » en cinq jetons ; la plage se relit
   « ٢٠٢٦ / ١٠ / ٠٧ », la date était perdue, la pièce sortait « à compléter ». Épreuve
   `token-plan.test.ts` (échoue avant, passe après). Cas 050 : refus injuste → exacte.
2. **Un avoir arabe se proposait en achat** : `ref.titres_de_piece` ne portait que des
   titres français. Migration `20261106090000_un_avoir_se_dit_aussi_en_arabe.sql`
   (« إشعار دائن », statut `anomalie`), instantané `referentiel-d-essai.json` mis à jour,
   cas ajouté au témoin `mesure-des-propositions.ts` (échoue avant : « fausse » ; passe
   après). `REGLES_DU_JUGEMENT` suit l'empreinte.

### Les quatre écritures fausses qui restent, et leur cause

- **007, 071, 083 — l'immobilisation part en charge (601).** Le Socle ne sait pas
  immobiliser : sans famille reconnue, il prend le compte par défaut du paramétrage, et
  la famille la plus proche (`PETIT_EQUIPEMENT`) est déclarée « du matériel, pas une
  immobilisation ». Correction à concevoir, hors de cette PR : un critère d'immobilisation
  au référentiel (familles d'articles rattachées à `ref.immo_categories`, seuil de
  capitalisation daté — **INCERTAIN**, à fixer par un expert-comptable), et, faute de
  critère, une proposition qui **refuse** (« nature à confirmer ») au-dessus du seuil.
  Au sens de R10, la 601 est un défaut que l'expert corrige ; au sens du banc, c'est une
  écriture fausse.
- **047 — l'avoir arabe en PDF se propose encore en achat**, malgré la correction 2 : la
  couche de texte de ce PDF (imprimé par Chromium) ne porte AUCUN texte arabe exploitable
  — les glyphes liés n'ont pas de correspondance Unicode (`\u0000`), le titre se lit en
  lettres isolées. Correction à concevoir : quand la couche de texte porte des glyphes
  sans correspondance, relire la page en image (rastériser par pdf.js et
  `@napi-rs/canvas`, comme `miniature-pdf.ts`, puis PaddleOCR) au lieu de croire la
  couche. Elle touche la chaîne que R2 protège ; elle n'est pas faite à moitié ici.

### Les refus injustes qui restent (aucun n'écrit faux)

- **FODEC (005, 017, 042, 081)** : `coherence_arithmetique/incoherent`. L'équation de la
  normalisation (Σ HT × (1 + taux) + autres = TTC) et celle de la relecture
  (Σ bases des lignes = HT) ignorent qu'un droit **taxable** (`ref.fiscal_charges.taxable`,
  vrai pour le FODEC) entre dans la base de TVA. Correction : porter `taxable` du
  référentiel jusqu'au jugement (port `FiscalCharge`, relevé, instantané), l'admettre
  dans les deux équations, et composer l'écriture avec le HT hors droit. Moyenne, pas
  faite ici.
- **Ventes arabes (046, 052)** : `sens_de_la_piece`. Le contrôle confronte le NOM de
  l'émetteur au nom du dossier, qui n'existe qu'en français ; une facture de vente en
  arabe porte le nom arabe. Il faut un nom arabe à la fiche de la société
  (`identity.organizations`), lu par le contrôle. Ici, le nom arabe est de toute façon
  illisible (glyphes sans Unicode, voir 047).
- **Montants en chiffres orientaux (044, 048, 052)** : refusés par politique
  (`treillisMontant`), parce qu'un modèle de vision les inverse. Une couche de texte, elle,
  est exacte : la politique pourrait les admettre selon le lecteur, si le jeton portait
  son lecteur. Décision à prendre, pas un défaut.

## Ce qui n'a pas tourné ici

- **PaddleOCR.** Installé dans un environnement Python (paddlepaddle 3.3.1, paddleocr
  3.7.0, épinglés comme `infra/ocr/Dockerfile`), il n'a pas pu télécharger ses poids : les
  quatre hôtes de modèles (Hugging Face, AI Studio, ModelScope, BOS) sont refusés par le
  proxy de l'atelier (403). Les 55 images (30 photos, 25 carnets) sont donc **non
  mesurées** ; la mesure ne simule aucun OCR depuis la spécification. Elles se mesurent
  telles quelles avec `OCR_URL` pointant sur le service.
- **La base.** Le serveur Postgres de l'atelier était arrêté et ne pouvait pas être
  relancé depuis cette session : les épreuves en base
  (`le-jeu-synthetique-dit-le-referentiel.test.ts`, `le-referentiel-d-essai-dit-vrai.test.ts`
  avec le nouveau titre) n'ont pas tourné localement ; la CI les joue.

## INCERTAIN — à confirmer par un expert-comptable

- Le compte d'une immobilisation (2282 pour du matériel informatique et de bureau) et sa
  TVA (4366 du paramétrage, ou 43662 « TVA sur immobilisations » du plan NC 01).
- Le FODEC à l'achat au 6652 (non récupérable) et dans la base de TVA ; à la vente au 4374.
- Le compte de vente 701 pour des biens comme pour des services (706 possible).
- Le timbre : posé sur chaque facture en dinars, jamais sur une pièce en devise ni sur un
  avoir ; les exemptions réelles sont à relever.
- L'avoir : l'écriture du comptable (l'achat contre-passé, `attendu.ecritureDuComptable`)
  est notée, mais l'issue attendue est le refus du pack (`nature_piece`, « à saisir par le
  cabinet »).
- Les titres arabes d'un avoir autres que « إشعار دائن » (« فاتورة تعديلية »…).
- La facture en euros soumise à la TVA tunisienne (choix du banc, comme le témoin du Socle).
