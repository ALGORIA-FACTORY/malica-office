# Le jeu d'ALGORIA : cent vingt factures au plus près du réel

Cent vingt factures **inventées** — cent achats, vingt ventes — dont la seule partie réelle
est **ALGORIA FACTORY SARL**, la société du staging. Elles nourrissent le banc **sans IA ni
GPU** : OCR rapide sur CPU (ONNX PP-OCRv5) → moteur Sudoku (preuves au centre, rangées,
milieu vers les bords) → experts de champ menés par le dictionnaire des concepts en base.
L'objectif du dirigeant : 100 % — chaque champ imprimé lu juste ou dit « inconnu », jamais
faux, jamais posé sur la mauvaise partie. Chaque cas le dit (`synthetique: true`,
`provenance`).

Le jeu réutilise celui de `outils/jeu-synthetique/` : le même hasard graine
(`hasard.mjs`), la même arithmétique entière (`montants.mjs`), le même référentiel et la
même écriture attendue (`referentiel.mjs`), la même facture classique (`page.mjs`). Rien
n'est recopié.

## Les parties — la règle, et sa seule exception

- **Achats** (`type` `facture_achat`, `grille` `facture`) : le client est ALGORIA FACTORY
  SARL, matricule **1958330V/A/M/000** ; le fournisseur est une société inventée, au
  matricule fictif tiré par `matriculeDEssai` (`apps/api/src/matricule-d-essai.ts`).
- **Ventes** (`type` `facture_vente`) : l'émetteur est ALGORIA FACTORY SARL ; le client est
  inventé (l'export en dollars va à un client étranger, sans matricule tunisien).
- **L'exception, voulue par le dirigeant** : le nom et le matricule d'ALGORIA FACTORY SARL
  sont **réels**. C'est la seule donnée réelle du jeu. Le jeu synthétique dit « rien de
  réel » ; celui-ci dit « rien de réel, sauf la société du staging, à sa demande ». Les
  adresse, téléphone, RC et RIB d'ALGORIA sur ces pages sont inventés.
- Tout le reste est inventé : raisons sociales et enseignes (mots rares, mots-symboles en
  lettres, aucun logo), adresses, téléphones (préfixe `00`), RC, RIB (code banque `99`),
  banques, e-mails et sites (domaine réservé `.example`), vendeurs.
- **Jamais le matricule d'ALGORIA du côté de l'autre partie, jamais un matricule deux fois
  sur une page.** Le tampon d'une facture imprimée porte nom, ville et téléphone ; celui
  d'un carnet porte le matricule de l'émetteur, que l'en-tête pré-imprimé ne porte pas.
  Le compositeur et le banc de vérification le contrôlent.
- Le matricule d'ALGORIA s'imprime sous plusieurs formes : `1958330V/A/M/000` (71 cas),
  compact `1958330VAM000` (35), espacé `1958330 V/A/M/000` (7), en chiffres orientaux
  `١٩٥٨٣٣٠V/A/M/٠٠٠` dans des carnets arabes (7). La vérité garde la forme normalisée.
- Les matricules fictifs ont la forme tunisienne mais leur lettre de contrôle est tirée au
  hasard (`matriculeDEssai`) : le contrôle de clé du pack (« avertit ») peut le signaler.

## Les commandes

```sh
node --experimental-strip-types outils/jeu-algoria/composer.mjs   # cas/NNN.json
node outils/jeu-algoria/rendre.mjs [NNN …]                          # rendus/NNN.{pdf,jpg} + NNN.boites.json
# la grille, relevée dans une base migrée (node db/migrer.mjs --base <url>) :
DATABASE_URL_ADMIN=<url> node outils/jeu-algoria/relever-les-grilles.mjs [facture …]
```

Générateur graine (mulberry32, graine `20261103`), dessin par Chromium, dates des PDF
figées : deux passes successives (composer puis rendre) donnent les 360 fichiers
identiques à l'octet (SHA-256, vérifié le 3 novembre 2026). Les rendus pèsent 21 Mo
(3,4 Mo de PDF, 17 Mo de JPEG, 1,3 Mo de boîtes) ; les cas 2 Mo.

## Le schéma d'un cas — prêt pour les pièces qui ne sont pas des factures

Un cas porte `type` (le code de `ref.document_types`) et `grille` (le code de
`ref.grilles`). Sa vérité se clé par les champs de SA grille, relevée en base dans
`grilles/<code>.json` (code du champ, concept, rôle, type, obligation, famille d'experts).
Les 41 pièces qui ne sont pas des factures entreront dans `cas/` avec leur type et leur
grille, la grille relevée par `relever-les-grilles.mjs <code>`.

- `synthetique`, `provenance`, `type`, `grille`, `langue`, `rendu` (`pdf`, `pdf_image`,
  `photo`, `scan`, `manuscrit`), `capture` (photo ou scan), `gabarit` (A à F),
  `scenario`, `realisme` (les effets appliqués), `dossier` (ALGORIA FACTORY SARL et son
  matricule) ;
- `piece` : `sens`, l'`emetteur` et le `client` (matricule normalisé, forme imprimée,
  `role` : fournisseur, dossier ou client), ce qui s'imprime (`imprime`, par chemin de la
  page) et le passage de chaque chemin à son champ de grille (`versConcept`) ;
- `attendu` :
  - les noms du jeu synthétique, à l'identique : `champs` (`document_kind`, `issuer`,
    `references.*`, `totals.*`, `lines[i].*`, `other_charges[k].*`, `articles[k].*`),
    `ecriture` (comptes du référentiel), `issue`, `aTrancher` (ventes : la réserve
    `nature_de_vente`), `cours` (devise), `referentiel`, `notes` ;
  - `concepts` : chaque champ de la grille `facture` IMPRIMÉ sur la page, clé par son code
    en base — montants en décimal (`"288.491"`), dates ISO, matricules normalisés ;
    `base_tva_par_taux` et `montant_tva_par_taux` par taux (`{"19": "…"}`), `lignes` par
    article (`designation`, `quantite`, `prix_unitaire_ht` ou `prix_unitaire_ttc`,
    `remise_ligne`, `montant_ligne_ht`, `taux_tva_ligne`, `reference_article`) ;
    `cachet_emetteur`, `signature_emetteur`, `visa_client` valent `true` quand ils sont sur
    la page. Le compositeur refuse toute clé que la grille ne porte pas ;
  - `confondus` : un seul imprimé pour deux codes — la seule « Date » vaut
    `date_operation` et `date_emission` ; le bloc « Livré à » du ticket est
    `adresse_client` et `adresse_livraison` ; le code TVA / catégorie / établissement se lit
    dans le matricule ;
  - `non_imprimes` : les champs de la grille délibérément absents. Un « absent » juste y
    est un succès.
- `rendus/NNN.boites.json` : `champs` (boîte de chaque chemin imprimé), `concepts` (boîte
  de chaque champ de grille), `lignesImprimees`. Boîtes en fractions de la feuille (PDF)
  ou de l'image (photo, scan, PDF-image).

## La matrice produite

| achats (100)                | PDF texte | PDF-image | scan JPEG | photo JPEG | total  |
| --------------------------- | --------- | --------- | --------- | ---------- | ------ |
| A ticket « BL/Facture »     | 11        | 4         | 10        | 10         | **35** |
| B facture classique FR      | 6         | 2         | 3         | 4          | **15** |
| C arabe imprimée (RTL)      | 6         | 1         | 4         | 4          | **15** |
| D bilingue FR/AR            | 4         | 1         | 2         | 3          | **10** |
| E carnet manuscrit FR       | —         | —         | 4         | 6          | **10** |
| F carnet manuscrit AR (RTL) | —         | —         | 6         | 9          | **15** |

| ventes (20)               | PDF texte | scan | photo | total |
| ------------------------- | --------- | ---- | ----- | ----- |
| A ticket / B classique FR | 2 + 3     | —    | —     | **5** |
| C arabe imprimée          | 3         | 1    | 1     | **5** |
| D bilingue                | 2         | 1    | 1     | **4** |
| E carnet FR               | —         | 1    | 2     | **3** |
| F carnet AR               | —         | 1    | 2     | **3** |

Les 4 PDF-image du gabarit A comptent parmi ses « 15 PDF » : un scan ou une photo
enveloppé dans un PDF, sans couche de texte, comme le ticket réel reçu par le dirigeant.

Contenus : 93 factures à un taux, 27 à plusieurs (19 / 13 / 7 / 0 %) ; 18 exonérées (EXO,
avec la mention) ; remise globale 7, remise par ligne (colonne « R. ») 6 ; FODEC 1 % 8 ;
timbre sur 118 (toutes celles en dinars) ; un achat en euros, une vente export en dollars
(mention export) ; montant en toutes lettres sur 52 (43 %) ; séparateur de milliers espace
(60), point (42), aucun (17), virgule (1, dollars) ; de 2 à 25 lignes d'articles.

Lignes imprimées (lignes de texte distinctes, regroupées par ordonnée — deux blocs côte à
côte comptent une) : gabarit A min 23, médiane 31, max 126 ; tout le jeu min 15, médiane
23, max 126 ; 9 pages denses à 125 lignes ou plus (gabarit A, 20 à 25 articles et leurs
numéros de série ; le corps descend par pas de 0,1 pt pour tenir l'A4, jamais sous 5 pt).

## Le gabarit A, d'après le ticket réel

Fournisseur en haut à gauche (nom, adresse, Tél, Fax, Email, Site web) ; « Livré à: » en
haut à droite (client, adresse, Tel, puis sur UNE ligne « MF/CIN: », « RC », « Mode de
règlement: ») ; « Bon de Livraison/Facture » et son numéro (`FAC-26M12LIV-261003`) ;
tableau d'en-tête « Date | Numéro pièce | Client | Votre référence | Chargé(e) » ;
articles « Référence | Code à Barre | Désignation | Qtité | PU TTC | R. | Montant | T » (PU
TTC, montant HT, T = taux), numéros de série sous les lignes ; récapitulatif par taux à
plusieurs taux ; « TOTAL HT », « TVA », « Timbre fiscal », « Total avec Timbre », « TTC …
DNT », « Arrêtée la présente pièce à la somme de: … » ; mentions légales, et en bas à droite
le RIB, le MF et le RC du fournisseur. Arithmétique en millimes : ligne HT = arrondi(PU TTC
× quantité × (1 − remise) ÷ (1 + taux)), base = Σ HT par taux, TVA par taux, TTC = base +
TVA + timbre (`horsTaxe`, `montants.mjs`).

## Les pièges, voulus

- La date jouxte le numéro dans le tableau d'en-tête (« Date | Numéro pièce »).
- « Total avec Timbre » vaut HT + timbre : ce n'est jamais le TTC.
- Le « RC » du bloc « Livré à » est celui du CLIENT ; `registre_commerce_emetteur` est celui
  du pied.
- Le titre « Bon de Livraison/Facture » contient « bon de livraison », que
  `ref.titres_de_piece` range en rejet : la pièce EST une facture (TVA, timbre, matricules),
  son issue attendue est une écriture. Un refus sur le titre est un refus injuste (noté
  dans chaque cas du gabarit A).
- Les numéros de série (« S N : 322911304202613 »), les codes-barres EAN-13 et
  « D1 **1.00 » sous les lignes : ni quantités, ni montants.
- La TVA totale d'une facture à plusieurs taux n'est pas un champ de la grille : seuls
  `montant_tva_par_taux` le sont.
- L'annotation manuscrite (« Payé le 20/03 », « Réglé chq n° … ») porte une date et un
  numéro qui ne sont ni la date ni le numéro de la pièce ; « Reçu… » vaut `visa_client`.
- Les ratures d'un carnet : la valeur barrée n'est jamais la valeur attendue.
- Le tampon d'une facture imprimée porte un téléphone, celui d'un carnet le matricule de
  l'émetteur (sa seule occurrence sur la page) ; la signature le frôle.

## Le réel simulé

Tiré de la graine du cas, dessiné par Chromium (CSS, SVG, canevas), reproductible :

- **photo de téléphone** (45 cas) : bureau autour de la page (bois, gris, clair, sombre),
  perspective en trapèze, rotation, lumière inégale et vignettage, flou, ombre de la main
  et du téléphone (25), papier froissé en relief (19), pli marqué d'une ombre et d'un
  reflet (15), grain du papier ;
- **scan** (38) : biais, grain, page passée (11), photocopie — gris dur, points de toner,
  traînée verticale, bord noir du couvercle (14) ;
- **sur le papier** : tampon rond à l'encre irrégulière (58), signature (53), annotation
  manuscrite (14) ;
- **carnets** (31) : souche détachable et numéro rouge pré-imprimé, papier carbone, encre
  bleue estompée, ratures (17), deux écritures sur la même page (10), arabe de droite à
  gauche en écriture ruqʿa, chiffres orientaux (7) ;
- **PDF** : de logiciel, avec couche de texte (37) ; PDF-image sans texte (8).

Les deux écritures sont la Caveat (500 et 700, penchée) et l'Aref Ruqaa (400 et 700) des
paquets déjà déclarés : deux mains distinctes, pas deux scripteurs réels. Aucun ticket
thermique n'est produit dans cette étape.

## INCERTAIN

- Les taux par article (livres et revues à 7 %, hébergement et transport à 13 %,
  formation agréée exonérée) sont des choix du banc, comme dans le jeu synthétique.
- Le timbre de 1,000 DT (droit fixe du référentiel) sur les tickets de magasin : le barème
  des grandes surfaces (1,500 / 2,000 DT, `ref.baremes_des_droits`) ne s'applique pas à ces
  enseignes fictives.
- Le code banque `99` d'un RIB fictif : la nomenclature des codes de la BCT n'a pas été
  relue.
- Les écritures attendues des ventes (705 / 706 / 707, repli au 701) et du FODEC : voir
  les INCERTAIN du jeu synthétique, qui les calcule de la même façon.
