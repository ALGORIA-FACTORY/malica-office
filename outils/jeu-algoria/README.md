# Le jeu d'ALGORIA : cent soixante et une pièces au plus près du réel

Cent vingt factures **inventées** — cent achats, vingt ventes — et quarante et une autres
pièces (cas 121 à 161 : gouvernance, paiements, banque, caisse, paie, déclarations, contrats,
baux, documents sans grille), dont la seule partie réelle est **ALGORIA FACTORY SARL**, la
société du staging. Elles nourrissent le banc **sans IA ni GPU** : OCR rapide sur CPU
(ONNX PP-OCRv5) → moteur Sudoku (preuves au centre, rangées, milieu vers les bords) →
experts de champ menés par le dictionnaire des concepts en base.
L'objectif du dirigeant : 100 % — chaque champ imprimé lu juste ou dit « inconnu », jamais
faux, jamais posé sur la mauvaise partie. Chaque cas le dit (`synthetique: true`,
`provenance`).

Le jeu réutilise celui de `outils/jeu-synthetique/` : le même hasard graine
(`hasard.mjs`), la même arithmétique entière (`montants.mjs`), le même référentiel et la
même écriture attendue (`referentiel.mjs`), la même facture classique (`page.mjs`). Rien
n'est recopié. Les autres pièces sont composées par `pieces.mjs` et dessinées par
`mises-en-page.mjs` ; elles reprennent les poses de la vérité, la prise de vue et la main
qui écrit des factures (`lesPoses`, `effetsDeLaPriseDeVue`, `uneMain`).

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

### Le rôle d'ALGORIA dans les autres pièces

Chaque pièce dit ses parties (`piece.parties` : le rôle de la grille, et `est` : `dossier`
pour ALGORIA, `tiers`, `administration`), avec `piece.emetteur` (qui l'émet) et
`piece.client` (l'autre). Le matricule d'ALGORIA n'est imprimé qu'aux chemins de
`piece.cheminsDuDossier` ; le compositeur refuse toute page où il paraît ailleurs, ou dans un
texte hors champ, et toute page où un matricule paraît deux fois (`controlerLesMatricules`).

| ALGORIA est…                           | pièces                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------- |
| la société                             | PV d'AGO, PV d'AGE, statuts, extrait du RNE, décision du gérant         |
| cliente d'un fournisseur               | avoir reçu (126) ; émettrice de l'avoir 127, à un client inventé        |
| destinataire, payeuse                  | bons de livraison, ordre de virement, chèque, reçus, tickets (anonymes) |
| employeur                              | notes de frais, bulletins, CNSS, attestation de travail, CDI            |
| titulaire du compte                    | relevés (banques inventées, code 99)                                    |
| contribuable                           | déclarations, acomptes, carte et attestation d'immatriculation          |
| bénéficiaire d'une retenue             | certificat de retenue à la source (le payeur est son client inventé)    |
| prestataire / preneuse / souscriptrice | contrat de prestation, baux (ALGORIA locataire), avis d'assurance       |

Les associés, le gérant, les salariés, les bailleurs, l'assureur, les banques, les commerces
sont inventés (`catalogue.mjs`) : ce ne sont pas les associés réels d'ALGORIA. Aucun numéro
de CIN ; les matricules CNSS des salariés commencent par `99`. Les administrations (DGI,
CNSS, RNE) sont nommées en clair, sans logo ; l'extrait du RNE, la carte et l'attestation
d'immatriculation portent la mention imprimée « Spécimen fictif — jeu d'essai ».

## Les commandes

```sh
node --experimental-strip-types outils/jeu-algoria/composer.mjs   # cas/NNN.json
node outils/jeu-algoria/rendre.mjs [NNN …]                          # rendus/NNN.{pdf,jpg} + NNN.boites.json
# la grille, relevée dans une base migrée (node db/migrer.mjs --base <url>) :
DATABASE_URL_ADMIN=<url> node outils/jeu-algoria/relever-les-grilles.mjs facture pv_ago pv_age \
  statuts extrait_rne decision_gerant avoir bon_livraison virement cheque recu_quittance \
  note_frais releve_bancaire ticket_caisse bulletin_paie declaration_mensuelle \
  declaration_cnss_trimestrielle declaration_annuelle_is_irpp acompte_provisionnel \
  carte_identification_fiscale certificat_retenue_source attestation_travail \
  contrat_commercial contrat_cdi bail_commercial avis_echeance_assurance
```

Le relevé écrit aussi `parametres.json` : les taux et seuils que les pièces lisent (IS,
minimum d'impôt, acomptes, CNSS, TFP, FOPROLOS, retenues à la source, barème de l'IRPP,
frais professionnels), pris dans `ref.fiscal_parameters` avec leur confiance. Aucun taux
n'est écrit dans le compositeur.

Générateur graine (mulberry32, graine `20261103` ; chaque pièce a son propre générateur,
tiré de la graine et de son numéro), dessin par Chromium, dates des PDF figées : deux passes
successives (composer puis rendre) donnent les 483 fichiers identiques à l'octet (SHA-256,
vérifié le 3 novembre 2026), et les 360 fichiers des factures sont ceux d'avant les autres
pièces, à l'octet. Les rendus pèsent 27 Mo (dont, pour les 41 pièces, 1,9 Mo de PDF,
3,7 Mo de JPEG, 0,3 Mo de boîtes) ; les cas 2,4 Mo.

## Le schéma d'un cas

Un cas porte `type` (le code de `ref.document_types`) et `grille` (le code de
`ref.grilles`, ou `null`). Sa vérité se clé par les champs de SA grille, relevée en base
dans `grilles/<code>.json` (code du champ, concept, rôle, type, obligation, famille
d'experts). Le compositeur refuse toute clé — et toute clé de `confondus` — que la grille
du cas ne porte pas, et toute valeur pour une pièce sans grille.

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
  ou de l'image (photo, scan, PDF-image). Pour une pièce, un champ imprimé en plusieurs
  morceaux (les points d'un ordre du jour) a la boîte qui les couvre ; le tampon et la
  signature vont au code de LEUR champ (`piece.marques` : `cachet_signature`,
  `signature_gerant`, `employeur_signature_cachet`…).

### Les autres pièces, en plus

- `mise_en_page` (gabarit G à K, style, police), `piece.blocs` (la page entière : en-tête,
  titre, champs, tableau, texte d'acte, cases d'un formulaire, cadre, rouleau, signatures),
  `piece.parties`, `piece.marques`, `piece.cheminsDuDossier`, `piece.souche`,
  `piece.ratures` ;
- `attendu.concepts` : seulement ce qui est imprimé, aux codes de la grille. Une occurrence
  répétée (article, mouvement, résolution, associé, salarié, partie d'un contrat) est une
  ligne de `lignes`, clé par les codes de la grille. Écritures normalisées : montants en
  décimal à trois chiffres, dates ISO, date-heure `2026-10-14T17:42`, heure `10:00`,
  période `2026-09-01/2026-09-30`, durée ISO (`P3Y`, `P12M`), clôture annuelle `--12-31`,
  taux en pourcentage décimal (`"9.18"`, `"19"`), listes en tableaux, booléens `true`
  quand la mention ou la marque est sur la page ; la TVA d'un ticket par taux
  (`ventilation_tva: {"19": …}`), le reçu et le rendu d'un paiement en espèces
  (`montant_recu_rendu: {recu, rendu}`) ;
- `attendu.confondus` : la carte d'identification fiscale imprime le matricule en clair
  (identifiant, clé, code TVA, catégorie, établissement s'y lisent) ; l'attestation
  d'immatriculation l'imprime en cinq cases (le matricule complet s'y reconstitue) ;
- `attendu.non_imprimes` : les champs de la grille absents de la page ; une pièce sans
  grille n'en a aucun, et son issue juste est de ne RIEN extraire (zéro valeur fausse).

## La matrice produite (les factures)

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

## Les 41 autres pièces

| cas | type                         | grille                         | mise en page | langue | rendu           | ALGORIA             |
| --- | ---------------------------- | ------------------------------ | ------------ | ------ | --------------- | ------------------- |
| 121 | pv_ago                       | pv_ago                         | H            | FR     | pdf             | la société          |
| 122 | pv_age                       | pv_age                         | H-machine    | FR     | scan            | la société          |
| 123 | statuts                      | statuts                        | H-machine    | FR     | pdf_image/scan  | la société          |
| 124 | extrait_rne                  | extrait_rne                    | G-encadre    | FR/AR  | pdf             | la société          |
| 125 | document_gouvernance         | decision_gerant                | H            | FR     | photo           | la société          |
| 126 | avoir                        | avoir                          | G-encadre    | FR     | pdf             | cliente (reçu)      |
| 127 | avoir                        | avoir                          | G-bande      | AR     | scan            | émettrice           |
| 128 | bon_livraison                | bon_livraison                  | G-bande      | FR     | pdf             | destinataire        |
| 129 | bon_livraison                | bon_livraison                  | J            | AR     | manuscrit/photo | destinataire        |
| 130 | justificatif_paiement        | virement                       | G-encadre    | FR     | pdf             | donneur d'ordre     |
| 131 | justificatif_paiement        | cheque                         | K            | FR     | manuscrit/photo | tireur              |
| 132 | recu_de_paiement             | recu_quittance                 | J            | AR     | manuscrit/scan  | débiteur            |
| 133 | recu_de_paiement             | recu_quittance                 | G-bande      | FR     | pdf             | débiteur            |
| 134 | note_frais                   | note_frais                     | G-bande      | FR     | pdf             | employeur           |
| 135 | note_frais                   | note_frais                     | J            | FR     | manuscrit/photo | employeur           |
| 136 | releve_bancaire              | releve_bancaire                | G-encadre    | FR     | pdf             | titulaire           |
| 137 | releve_bancaire              | releve_bancaire                | G-bande      | FR/AR  | scan            | titulaire           |
| 138 | ticket_caisse                | ticket_caisse                  | I            | FR     | photo           | acheteuse (anonyme) |
| 139 | ticket_caisse                | ticket_caisse                  | I            | AR     | pdf_image/scan  | acheteuse (anonyme) |
| 140 | bulletin_paie                | bulletin_paie                  | G-encadre    | FR     | pdf             | employeur           |
| 141 | bulletin_paie                | bulletin_paie                  | G-bande      | FR/AR  | scan            | employeur           |
| 142 | declaration_tva              | declaration_mensuelle          | G-encadre    | FR     | pdf             | contribuable        |
| 143 | declaration_tva              | declaration_mensuelle          | G-bande      | AR     | pdf_image/photo | contribuable        |
| 144 | declaration_cnss             | declaration_cnss_trimestrielle | G-encadre    | FR     | pdf             | employeur           |
| 145 | declaration_cnss             | declaration_cnss_trimestrielle | G-bande      | FR/AR  | scan            | employeur           |
| 146 | declaration_impot            | declaration_annuelle_is_irpp   | G-encadre    | FR     | pdf             | contribuable        |
| 147 | declaration_impot            | declaration_mensuelle          | G-bande      | FR     | scan            | contribuable        |
| 148 | acompte_provisionnel         | acompte_provisionnel           | G-encadre    | FR     | pdf             | contribuable        |
| 149 | acompte_provisionnel         | acompte_provisionnel           | G-bande      | AR     | photo           | contribuable        |
| 150 | carte_identification_fiscale | carte_identification_fiscale   | K            | FR/AR  | photo           | contribuable        |
| 151 | carte_identification_fiscale | carte_identification_fiscale   | G-encadre    | FR     | scan            | contribuable        |
| 152 | document_fiscal_social       | certificat_retenue_source      | G-encadre    | FR     | pdf             | bénéficiaire        |
| 153 | document_fiscal_social       | attestation_travail            | H            | AR     | scan            | employeur           |
| 154 | contrat                      | contrat_commercial             | H            | FR     | pdf             | prestataire         |
| 155 | contrat                      | contrat_cdi                    | H-machine    | FR     | scan            | employeur           |
| 156 | bail                         | bail_commercial                | H            | FR     | pdf             | preneuse            |
| 157 | bail                         | bail_commercial                | H            | AR     | scan            | preneuse            |
| 158 | autre_document               | avis_echeance_assurance        | G-bande      | FR     | pdf             | souscriptrice       |
| 159 | autre_document               | — (null)                       | H            | FR     | photo           | (citée)             |
| 160 | non_comptable                | — (null)                       | G-bande      | FR     | photo           | —                   |
| 161 | non_comptable                | — (null)                       | H            | AR     | scan            | —                   |

**Du type à la grille.** La base relie chaque grille à un type (`ref.grilles.document_type`).
Le jeu en suit le lien partout où il existe, et le dit quand il ne le suit pas :

- `declaration_tva` : **aucune** grille en base ; la déclaration mensuelle tunisienne porte la
  TVA, donc `declaration_mensuelle` (que la base relie à `declaration_impot`) ;
- `document_gouvernance` : sept grilles en base ; `decision_gerant`, la plus proche d'une
  décision de SARL (`pv_conseil_administration` vise une SA) ;
- `justificatif_paiement` : `virement` et `cheque` parmi sept ; `document_fiscal_social` :
  `certificat_retenue_source` et `attestation_travail` parmi onze ; `contrat` :
  `contrat_commercial` et `contrat_cdi` parmi sept ; `declaration_impot` : les deux grilles
  de la base ; `autre_document` : `avis_echeance_assurance` (une des treize grilles reliées)
  pour l'un, aucune pour l'autre ;
- `non_comptable` : aucune grille en base, `grille: null`.

Les gabarits des pièces (`mises-en-page.mjs`) : **G** document de gestion imprimé (style
`encadre` ou `bande`), **H** acte (police `machine` pour l'acte dactylographié), **I** ticket
de caisse sur rouleau, **J** formulaire pré-imprimé rempli à la main (souche, numéro rouge,
ratures, chiffres orientaux), **K** petite pièce posée seule (chèque, carte). Les deux pièces
d'un même type ont deux mises en page différentes.

**Les montants se répondent**, en millimes (`montants.mjs`) : l'avoir 126 reprend la facture
050, l'avoir 127 la vente 107, le virement 130 règle la facture 041, le chèque 131 la 047,
le certificat 152 retient sur la vente 103 ; le relevé d'octobre 136 porte ces paiements, le
loyer de la quittance 133 (bail 156), les cotisations de la déclaration CNSS 144 et la
déclaration 142 — solde initial + crédits − débits = solde final. Bulletins : brut − CNSS −
IRPP = net (IRPP au barème relevé, annualisé, frais professionnels plafonnés) ; le brut de
septembre du bulletin 141 est celui de la déclaration CNSS 144. TVA : collectée − déductible
= à payer (142), ou − crédit à reporter (143). L'IS de 2025 (146) est la base des acomptes
148 et 149. Toutes les dates des pièces sont de 2026 (sauf l'immatriculation de 2024, les
entrées des salariés et l'exercice 2025 déclaré).

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
- Pièces : les taux CNSS (9,18 % salarial, 16,57 % patronal, 25,75 % global) sont relevés en
  base avec la confiance « a_confirmer » ; la contribution sociale de solidarité sur salaires
  n'est pas appliquée (`CSS_PERSONNES` « non trouvé ») ; la réserve légale à 5 % (art. 287
  CSC) et la majorité des trois quarts d'une AGE de SARL sont des choix du banc, non relevés
  en base ; l'assiette de la retenue sur loyers (HT) n'a pas été relue.
- La forme réelle d'une carte d'identification fiscale, d'un extrait du RNE et de la formule
  de chèque (date de validité, plafond, code QR) n'a pas été relue : les pages suivent les
  champs des grilles. L'identifiant unique du RNE est pris pour les huit premiers caractères
  du matricule.
- Titres : « BON DE LIVRAISON » (128) est rangé en rejet par `ref.titres_de_piece`, et c'est
  l'issue juste ; « AVOIR » et « إشعار دائن » en anomalie (avoir), l'issue attendue. « وصل
  تسليم » (129) n'est couvert par aucun motif (ils sont français) : l'issue que le banc en
  tirera n'est pas tranchée.
