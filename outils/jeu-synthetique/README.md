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

Depuis la correction 3 ci-dessous, la production relit en image les 27 PDF arabes et
hybrides dont la couche de texte a perdu ses glyphes (`laCoucheSeCroit`). Sans PaddleOCR
ici, ils ne sont plus mesurés sur la chaîne : `RAPPORT.md` les juge à part, sur leur
couche telle quelle (« diagnostic du Socle »). Les deux tableaux de `RAPPORT.md` se
lisent donc ensemble ; leur somme couvre les mêmes 45 PDF qu'au premier relevé.

| 45 PDF (chaîne + diagnostic)            | champs exacts    | écritures exactes | à trancher | **fausses** | refus justes | refus injustes |
| --------------------------------------- | ---------------- | ----------------- | ---------- | ----------- | ------------ | -------------- |
| premier relevé (avant toute correction) | 1005/1069 (94 %) | 25/37 (68 %)      | —          | **4**       | 7/8          | 9              |
| reprise (commit 8dba4f5)                | 1011/1069 (95 %) | 26/37 (70 %)      | 3          | **0**       | 8/8          | 8              |
| après (cette reprise)                   | 1050/1069 (98 %) | 33/37 (89 %)      | 4          | **0**       | 8/8          | **0**          |
| — chaîne : français (18 PDF)            | 451/451 (100 %)  | 14/15             | 1          | 0           | 3/3          | 0              |
| — diagnostic : arabe (13)               | 271/290 (93 %)   | 10/11             | 1          | 0           | 2/2          | 0              |
| — diagnostic : hybride (14)             | 328/328 (100 %)  | 9/11              | 2          | 0           | 3/3          | 0              |

« à trancher » : les quatre immobilisations (007, 044, 071, 083), proposées au compte du
paramétrage avec la réserve nommée `immobilisation_a_trancher` — ni exactes, ni fausses.

Depuis le 1er novembre 2026 (ventes par nature d'article) : la chaîne garde 14/15
exactes, 1 à trancher, 0 fausse ; le diagnostic passe à 17/22 exactes et 5 à trancher —
les deux ventes arabes au texte perdu (046, 052) vont au repli avec la réserve
`nature_de_vente`, faute de désignation lisible. Toujours 0 fausse.
Les 19 champs inexacts restants sont tous dans des PDF arabes au texte perdu : le nom
de l'émetteur (glyphes sans Unicode) et le numéro relu espacé (« ٢٠٢٦ / ٥٠٣٦ »), sans
effet sur l'écriture. Le détail par contenu et cas par cas est dans `RAPPORT.md`. La toute
première passe donnait 985 champs exacts : 20 écarts venaient du banc lui-même (son
désignateur citait le deux-points de « MF client : »), corrigé dans le banc.

### Causes racines corrigées dans cette PR

Chacune est reproduite par une épreuve qui échoue avant et passe après.

1. **Une date aux séparateurs espacés ne se lisait pas** (`normalizeDate`). La couche de
   texte d'un PDF arabe rend « ٢٠٢٦/١٠/٠٧ » en cinq jetons ; la plage se relit
   « ٢٠٢٦ / ١٠ / ٠٧ ». Épreuve `token-plan.test.ts`. Cas 050.
2. **Un avoir arabe se proposait en achat** : `ref.titres_de_piece` ne portait que des
   titres français. Migration `20261106090000_un_avoir_se_dit_aussi_en_arabe.sql`.
3. **Une couche de texte aux glyphes perdus était crue** (cas 047) : elle se relit en
   image, et un titre illisible n'est jamais « facture » (`texteSansUnicode`).
4. **Une immobilisation partait en charge en silence** (007, 071, 083) : réserve
   `immobilisation_a_trancher`, familles datées `ref.biens_immobilisables` (INCERTAIN).
   Puis (044) : une désignation PERDUE pose la même question au lieu de passer.
5. **Le FODEC n'entrait pas dans la base de la TVA** (005, 017, 042, 081). Le
   référentiel le dit (`ref.fiscal_charges.taxable`, Code de la TVA art. 6-I cité par la
   migration `20261019150000`) ; rien ne le lisait. `taxable` va du port `FiscalCharge`
   au jugement et au moteur P4 ; la normalisation essaie la base imprimée comme HT (droit
   ajouté) et comme base de la TVA (droit compris). Une pièce qui laisse le droit hors
   de la base tient encore, telle qu'imprimée, avec une réserve qui le nomme
   (`droitsHorsAssiette`). Épreuves `normaliser-montants.test.ts`, `controles.test.ts`,
   `balance.test.ts`, cas du témoin.
6. **Une vente arabe se refusait sur le nom** (046, 052) : `sens_de_la_piece` décide
   d'abord par le MATRICULE de l'émetteur, identifiant légal ; le nom ne décide que sans
   lui, et le contredit quand il se compare (l'inversion du 5 octobre reste une anomalie).
   Aucun nom arabe n'existe à la fiche du dossier : il n'en faut pas.
7. **Les montants en chiffres orientaux étaient refusés quel que soit le lecteur** (044,
   048, 052). La politique (`treillisMontant`) venait d'une MESURE, pas d'une décision : le
   modèle de vision les rend inversés (« ١٢ » lu « ٢١ », 18 octobre 2026). La couche de
   texte d'un PDF porte les codes des chiffres eux-mêmes : elle est crue
   (`litLesChiffresOrientaux`), la vision et PaddleOCR (non mesuré) ne le sont pas. Les
   séparateurs « ٫ » « ٬ » ne sont pas en cause : le lecteur unique (`montant-imprime`) en
   rend toutes les lectures et l'arithmétique tranche.
8. **Un numéro en chiffres orientaux n'avait pas de clé de doublon** (`normNumero` les
   effaçait avec la ponctuation) : aucune facture arabe n'était rapprochée d'un doublon.

### Ce qui reste

- **Rien de faux, aucun refus injuste** sur les 45 PDF. Les quatre immobilisations
  restent « à trancher » par construction : le Socle ne choisit pas entre charge et
  immobilisation sans critère daté au référentiel (seuil de capitalisation — INCERTAIN).
- **Les 27 PDF au texte perdu ne sont mesurés que par le diagnostic** : en production
  ils passent par PaddleOCR, qui ne lit pas les montants en chiffres orientaux (non
  mesuré). Les cas 044, 048, 052 y resteront refusés tant que PaddleOCR n'est pas
  mesuré sur ces chiffres.

## Ce qui n'a pas tourné ici

- **PaddleOCR.** Installé dans un environnement Python (paddlepaddle 3.3.1, paddleocr
  3.7.0, épinglés comme `infra/ocr/Dockerfile`), il n'a pas pu télécharger ses poids : les
  quatre hôtes de modèles (Hugging Face, AI Studio, ModelScope, BOS) sont refusés par le
  proxy de l'atelier (403). Les 55 images (30 photos, 25 carnets) sont donc **non
  mesurées** ; la mesure ne simule aucun OCR depuis la spécification. Elles se mesurent
  telles quelles avec `OCR_URL` pointant sur le service.

## INCERTAIN — à confirmer par un expert-comptable

- Le compte d'une immobilisation (2282 pour du matériel informatique et de bureau) et sa
  TVA (4366 du paramétrage, ou 43662 « TVA sur immobilisations » du plan NC 01).
- Le FODEC à l'achat au 6652 (non récupérable) et dans la base de TVA ; à la vente au 4374.
- Le compte de vente par nature d'article (1er novembre 2026, `ventes.compte` =
  `par_nature_article`, défaut du CEO) : 705 prestations, 706 activités annexes (une
  location), 707 marchandises. La nature de chaque article est celle de la
  spécification (`composer.mjs`, catalogue) ; les comptes viennent du référentiel
  (`naturesDeVente` du relevé). Une vente que le Socle ne prouve pas (mot non reconnu,
  désignation perdue) va au repli (701) avec la réserve `nature_de_vente` : elle se compte
  « à trancher », jamais exacte. Les motifs (`ref.motifs_de_nature_de_vente`) sont à
  confirmer.
- Le timbre : posé sur chaque facture en dinars, jamais sur une pièce en devise ni sur un
  avoir ; les exemptions réelles sont à relever.
- L'avoir (1er novembre 2026, `avoirs.traitement` = `lie_facture`) : il se propose en
  contre-passation de sa facture d'origine, que le banc n'a pas (aucune base) ; l'issue
  attendue est le refus nommé `proposition/facture_d_origine` (« facture d'origine à
  rattacher »), ou `nature_piece` quand le titre est perdu. L'écriture du comptable
  (l'achat contre-passé, `attendu.ecritureDuComptable`) reste notée.
- Les titres arabes d'un avoir autres que « إشعار دائن » (« فاتورة تعديلية »…).
- La facture en euros soumise à la TVA tunisienne (choix du banc, comme le témoin du Socle).
