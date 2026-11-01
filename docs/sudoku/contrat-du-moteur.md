# Le sudoku — contrat entre les grilles, le moteur et l'adaptateur

_31 octobre 2026. PR 1 de la lecture prouvée pour tous les documents._

Le sudoku ne lit aucun montant lui-même (règle ① de la fabrique de lecteurs) et
ne porte aucune constante réglementaire (R4). Il reçoit trois choses : le plan de
jetons avec les lectures déjà faites par la chaîne, la grille du type de
document, et les paramètres du pack. Il rend, champ par champ, une valeur citée
et un statut. Tout le reste — la grille, les preuves, les taux — vit en base.

## 1. Les trois couches, en base (schéma `ref`, daté par le pack)

| Table                  | Couche | Ce qu'elle porte                                                                                                                                                                                                                                                |
| ---------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref.grilles`          | —      | un type de document : `code`, `famille`, `nom`, `document_type` (lien vers `ref.document_types`, nullable), `statut`                                                                                                                                            |
| `ref.grille_champs`    | 1      | `grille_id`, `parcelle`, `code`, `libelle`, `type`, `obligatoire`, `condition`, `reperes_fr[]`, `reperes_ar[]`, `format_code` (nullable), `groupe` (nullable), `fondement`, `source_fondement`, `statut`, `concept_id`, `role` (nullable, clé vers `ref.roles`) |
| `ref.concepts`         | 1      | le dictionnaire : `code`, `libelle`, `expert` (clé vers `ref.experts`), `porte_sur_une_partie`, `statut`                                                                                                                                                        |
| `ref.experts`          | 1      | les neuf familles d'experts ; `ref.expert_types` dit quels types de champ chacune sait lire                                                                                                                                                                     |
| `ref.roles`            | 1      | les 34 rôles d'une partie sur la pièce, libellés en fr, en, ar (`ref.labels`, espace `concept_role`)                                                                                                                                                            |
| `ref.grille_relations` | 2      | `grille_id`, `vers`, `nature`, `cle`                                                                                                                                                                                                                            |
| `ref.grille_preuves`   | 3      | `grille_id`, `code`, `regle` (texte d'origine), `genre`, `expression` (jsonb, nullable), `statut`                                                                                                                                                               |

`statut` vaut `defaut_a_valider` pour tout ce que Malica livre (R10) ; seule
l'expertise le passe à `arrete`. `source_fondement` vaut `texte`, `pratique` ou
`incertain`. Une preuve sans `expression` n'est pas exécutée : son `statut` vaut
`a_traduire`.

Le **concept** relie les champs de grilles différentes qui portent la même
notion : `raison_sociale_emetteur` (facture), `employeur_raison_sociale`
(bulletin de paie) et `tireur_nom` (chèque) sont tous le concept
`raison_sociale`, avec les rôles `fournisseur`, `employeur` et `tireur`. L'expert
du concept lit et vérifie tous ses champs. Un champ sans jumeau a un concept à
lui. Le lien est livré en défaut (`20261115100000`), et l'expertise le corrige.

### Le dictionnaire

1 181 concepts ; 222 sont partagés et couvrent 1 174 des 2 133 champs. Chaque
concept est lu par une famille d'experts, et une famille ne lit que certains
types de champ :

| Famille       | Types lus                   | Concepts |
| ------------- | --------------------------- | -------- |
| `montant`     | `montant`                   | 424      |
| `nombre`      | `nombre`                    | 69       |
| `taux`        | `taux`                      | 27       |
| `date`        | `date`, `periode`           | 67       |
| `identifiant` | `identifiant`               | 42       |
| `reference`   | `identifiant`, `liste`      | 35       |
| `tiers`       | `texte`, `adresse`, `liste` | 25       |
| `libelle`     | `texte`, `liste`            | 433      |
| `presence`    | `booleen`                   | 59       |

`reference` est le numéro d'une pièce, la sienne (`numero_piece`) ou une autre
qu'elle cite (`ref_*`) ; `identifiant` est attribué par un registre ou un
organisme (matricule fiscal, CIN, RIB, numéro de série) ; `tiers` lit le nom,
l'adresse ou la qualité d'une personne, et un lieu ; `presence` constate une
signature, un cachet ou une mention.

**Le rôle.** Un rôle nul a un seul sens : le champ ne porte sur aucune partie
(un total, une date de la pièce, un lieu). Un concept qui porte sur une partie
(`porte_sur_une_partie`) exige un rôle sur chacun de ses champs ; les autres le
refusent. Une pièce nomme chaque partie par un seul rôle. Le vendeur est
`fournisseur` et l'acheteur `client`, quel que soit le nom que la pièce leur
donne ; `emetteur` et `destinataire` sont l'expéditeur et le destinataire d'un
envoi ou d'un message (bon de livraison, enveloppe TEIF) ; en douane,
l'expéditeur est l'`exportateur` et le destinataire l'`importateur`. Les autres
règles sont dans l'en-tête de la migration.

**La garde est permanente.** Des déclencheurs différés refusent, au commit, un
champ sans concept, un concept d'un autre pack que sa grille, un type que la
famille ne sait pas lire, un rôle manquant ou de trop ;
`ref.champs_hors_dictionnaire()` rend ces écarts, et le test d'intégrité
(`la-base-tient-son-integrite.test.ts`) exige qu'il soit vide et qu'aucun
concept ne reste sans champ.

## 2. Le langage des preuves (`expression`)

Un objet JSON par preuve. Les noms de champs sont des `code` de
`ref.grille_champs` de la même grille. Un nom suffixé par `?` est **facultatif** :
absent, il vaut zéro dans une somme et la preuve reste évaluable.

| `op`          | Forme                                                                                                 | Sens                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `somme`       | `{"op":"somme","total":"t","parties":["a","b?","-c"]}`                                                | t = a + b − c, **exactement** (préfixe `-` : soustraction)                     |
| `produit`     | `{"op":"produit","total":"t","facteurs":["q","pu"]}`                                                  | t = q × pu, à la tolérance d'arrondi du pack près                              |
| `taux`        | `{"op":"taux","montant":"m","base":"b","bareme":"tva"}`                                               | m = arrondi(b × r) pour un taux r du barème du pack                            |
| `groupe_taux` | `{"op":"groupe_taux","base":"b","montant":"m","total_base":"tb","total_montant":"tm","bareme":"tva"}` | une à trois instances (b, m) de taux distincts ; Σb = tb et Σm = tm exactement |
| `charge`      | `{"op":"charge","montant":"m","code":"DROIT_TIMBRE","base":"b?","assiette":"tva"}`                    | m = un montant admis par le pack au jour dit, ou arrondi(base × taux)          |
| `egal`        | `{"op":"egal","a":"x","b":"y"}`                                                                       | x = y                                                                          |
| `format`      | `{"op":"format","champ":"c","format":"matricule_fiscal"}`                                             | la valeur respecte le motif nommé, fourni en entrée                            |
| `lettres`     | `{"op":"lettres","champ":"montant_en_lettres","egal_a":["total_ttc","net_a_payer?"]}`                 | le montant lu en lettres égale (sans signe) la valeur prouvée d'un `egal_a`    |
| `ordre`       | `{"op":"ordre","avant":"d1","apres":"d2"}`                                                            | d1 ≤ d2 (dates)                                                                |

Les attributs que l'adaptateur et le moteur lisent dans les preuves — aucun code
de champ n'est écrit dans le code (15 novembre 2026, `20261115110000`) :

- `role` d'une `somme` : `"ttc"` nomme le total que la chaîne reçoit comme TTC,
  variante par variante (P04 : `total_ttc` ; M04 : `net_a_payer`, quand le TTC
  est imprimé avant le timbre) ;
- `assiette` d'une `charge` : le barème dont la base est majorée de cette charge,
  quand le pack la dit `assiette_tva` (le FODEC : `"tva"`). Une charge d'assiette
  sans cette clé n'est pas traduite ;
- le HT, la base et le montant par taux se lisent dans `groupe_taux`
  (`total_base`, `base`, `montant`), et les cellules d'un tableau dans `lignes`.

Deux clés facultatives de `groupe_taux`, ajoutées à l'exécution :

- `exoneration` : un champ dont la **mention lue** autorise zéro instance (facture
  exonérée ou en suspension) — sur des lectures fortes seulement ;
- `instances_max` : le nombre maximal de taux distincts (3 par défaut).

`total_base` et `total_montant` sont facultatifs : une facture n'imprime pas
toujours le total de TVA ; dans une `somme`, un champ de groupe vaut alors la
somme de ses instances.

**Variantes d'une grille.** Une même pièce s'imprime de plusieurs façons. Une
preuve porte alors un nom de `variante` (colonne de `ref.grille_preuves`, nulle
pour une preuve commune). L'adaptateur joue chaque variante seule, avec les
preuves communes. La pièce est prouvée si toutes les variantes qui la prouvent
s'accordent sur ses montants, et ambiguë sinon. Pour la facture :

- `ttc_avec_timbre` : le timbre est compris dans le TTC (P04) ;
- `ttc_hors_timbre` : le TTC est imprimé avant le timbre, et le net à payer
  après lui (M03, M04).

Dans ce second cas, la chaîne reçoit le net à payer comme TTC : c'est lui qui
ferme HT + TVA + droits.

**Asymétrie de tolérance** (mesurée, non négociable) : les sommes et les égalités
sont exactes ; seuls `produit`, `taux` et `charge` à taux arrondissent, d'au plus
la tolérance du pack (une unité mineure).

### Les anneaux autour du centre

Le centre, ce sont les totaux. Les anneaux s'y appuient sans le modifier : ils
ont leur propre statut, et l'issue de la pièce reste celle du centre.

- **Anneau 1 — les lignes** (`{"op":"lignes", …}`, preuve L01). Une rangée est
  une ligne d'article quand quantité × prix (− remise) = montant. La somme exacte
  des montants doit égaler le total HT prouvé au centre (ou le total brut). Les
  lignes prouvées remplacent les articles de la chaîne ; leur rubrique se résout
  ensuite en base, comme avant (`charge_famille_resolve`).
- **Anneau 1, lecture « middle-out »** (quand la lecture rangée par rangée ne
  prouve pas les lignes, en général sur un scan où l'OCR a perdu les petits
  nombres isolés) :
  1. On part de la rangée la plus sûre (quantité × prix = montant, lus), ou, à
     défaut, d'une rangée sous les étiquettes de l'en-tête.
  2. On en apprend les colonnes et le pas vertical.
  3. On s'étend vers le haut et vers le bas.
  4. Une quantité ou un prix absent est **trouvé** par le calcul (statut
     `deduit`, sans citation, avec la `case` où il devrait être imprimé, pour
     une relecture ciblée). Un montant de ligne ne se déduit que pour une seule
     rangée, par l'écart au total.
  5. Le tableau doit fermer exactement sur le total HT prouvé.

  Une cellule déduite ne remplace jamais une désignation de la chaîne.

  Trois cas s'ajoutent (1er novembre 2026) :

  - **Tableau sur plusieurs pages.** Chaque page apprend ses colonnes depuis sa
    propre graine ; les segments s'enchaînent tant qu'une page ne s'est pas
    close sur un total du centre. Une rangée qui ne porte qu'un montant est un
    report (« À reporter ») : elle n'est pas un article, et doit valoir la somme
    courante, au millime.
  - **Remise globale.** Quand le total brut n'est pas prouvé, les lignes
    ferment sur Σ montants − remise = total HT, avec une remise imprimée (montant
    fort, ou taux lu) sur une rangée du bloc des totaux qui porte un repère du
    champ `remise_globale`. Un total brut lu doit valoir Σ. Le centre n'est pas
    touché. La sortie porte `lignes.remise_globale` (valeur et citation).
  - **Deux cases collées par l'OCR** (« 1 » et « 2400,000 » lus « 12400,000 »).
    L'adaptateur propose les coupes du jeton (`decoupes`, lues par le lecteur
    de production) ; le moteur n'en retient une que si la boîte du jeton est à
    cheval sur les colonnes quantité et prix apprises, à l'endroit de la coupe,
    et que gauche × droite = montant de la rangée. Les deux cellules citent le
    même jeton, au statut `coupe`, avec la coupe retenue ; la chaîne ne les
    relit pas dans ce jeton.

- **Anneau 2 — les parties** (`{"op":"parties", …}`, preuve E01). Un seul des
  matricules lus est celui du dossier, et un indice imprimé (« client »,
  « émetteur ») dit le sens. La contrepartie est rapprochée des tiers du dossier,
  et son nom est comparé sans la forme juridique (`ref.formes_juridiques`). La
  géométrie confirme, mais ne décide jamais seule.
- Les dates (E02 : émission ≤ échéance) et le numéro sont lus par leurs repères,
  au statut `conforme`. Seul ce qui est **prouvé** remplace la désignation de la
  chaîne.
- **Deux matricules au même format** (émetteur et client) ne s'attribuent qu'à
  l'anneau 2 : leurs repères sont communs (« Matricule fiscal »), et une valeur au
  format ne dit pas à quelle partie elle appartient. Hors E01, ils sont
  `signale` (16 novembre 2026 : au banc des 150 factures, le matricule du client
  sortait « conforme » comme celui d'un émetteur étranger — 6 fois sur la couche
  de texte, 15 fois en OCR).
- **Anneau 3 — les champs nommés** (16 novembre 2026). Un champ que nulle preuve
  ne lit est lu par l'expert de sa famille (`ref.concepts.expert`, transmis en
  entrée avec la `parcelle` du champ), piloté par ses seuls repères et son
  format : `reference` et `identifiant` sans format au pack (la valeur à
  chiffres derrière son libellé, à droite ou dessous — le lecteur du numéro de
  l'anneau 2, rendu paramétrable), `libelle`, `nombre`, `taux` (la phrase
  derrière le libellé), une `liste` par son vocabulaire (ses repères), une
  `presence` seulement `signale` (un cachet ne se constate pas dans un texte).
  Au mieux `conforme` ; `signale` si deux valeurs, si le libellé est partagé
  par deux champs, ou s'il n'est lu que collé dans le jeton de la valeur
  (« N°DV-PX-2026-091111 » : l'OCR y colle autre chose). Il ne lit ni les
  cellules d'un tableau (la parcelle des champs de `lignes`), ni le champ d'une
  preuve `lettres`, ni un champ déjà lu.
- **Les lettres** (preuve `lettres`, P13 de la facture, P04 du chèque), après
  tout le reste. L'adaptateur lit le montant en toutes lettres qui suit un repère
  du champ (lexique du pack : `ref.nombres_en_lettres`, `ref.devises_en_lettres`)
  et le porte sur le premier mot de la phrase. Égal (sans signe : un avoir) au
  total prouvé : `verifiee`, et le champ est `prouve`. Différent : `echec`, et
  **la pièce n'est plus prouvée, elle est signalée** (`issue = "signalee"`) ; ses
  champs prouvés passent `signale`, valeurs et citations gardées. C'est la seule
  preuve non arithmétique qui change l'issue : sans elle, 100/D-04 (« trois mille
  deux cents dinars » sous un net de 9 676,890) sortait prouvée. Aucune lettre
  lue, ou un mot illisible dans la phrase : `non_evaluable`, rien ne change.

L'entrée gagne `connus` : le dossier, ses tiers et les formes juridiques, lus
en base par l'adaptateur.

## 3. L'entrée du moteur (JSON)

```json
{
  "jetons": [{"page":1,"ordinal":12,"texte":"3 020,000","x0":0.6,"y0":0.71,"x1":0.8,"y1":0.73,
              "montants":[{"v":3020000,"forte":true}], "date":null}],
  "grille": {"code":"facture","champs":[...],"preuves":[...]},
  "pack": {"decimales":3,"tolerance":1,
           "baremes":{"tva":[{"code":"TVA19","ppm":190000}]},
           "charges":[{"code":"DROIT_TIMBRE","montant_fixe":1000,"montants_admis":[1000,1500,2000],
                       "taux_ppm":null,"assiette_tva":false}],
           "formats":{"matricule_fiscal":"[0-9]{7}[A-Za-z]/[ABPDN]/[MCPNE]/[0-9]{3}"}}
}
```

- `montants` : les lectures du **treillis existant** (`treillisMontant`), en unités
  mineures ; `forte` vaut vrai pour une lecture décimale **dont le séparateur est
  imprimé** (« 16000 » lu 16,000 par virgule perdue reste faible). Le moteur ne
  relit jamais le texte d'un montant.
- Le plan est celui que la chaîne donne au désignateur : **recollé**
  (`recollerLesMilliers`). Sur le plan brut, « 3 » et « 020,000 » sont deux jetons
  et la facture réelle du jeu d'or n'est pas prouvée.
- Un taux nul n'entre pas au barème : l'exonération passe par la mention, jamais
  par une instance « 0 % » que n'importe quel zéro imprimé fermerait.
- `date` : la date ISO rendue par `normalizeDate` avec la convention du pack
  (`ref.conventions_de_date`, `ref.mois_en_lettres`), ou `null`. Une date en
  plusieurs jetons d'une rangée (« 13 | mai | 2026 ») est portée par le premier,
  et `date_fin` nomme l'ordinal du dernier : la citation couvre la plage.
- `identifiants` (facultatif) : ce que `normaliserMatricule` lit dans le jeton
  (étiquette collée, chiffres arabes, « l » pour « 1 »), avec la forme du pack
  (`ref.identifiant_formats`) — `[{"format","valeur","fin"}]`. Le moteur les
  préfère au motif brut.
- `lettres` (facultatif) : `{"v","fin"}`, le montant en lettres qui commence au
  jeton, en unités mineures de la devise de la pièce.
- Un champ de la grille porte aussi `expert` (sa famille) et `parcelle`.
- `decoupes` (facultatif) : pour un nombre sans espace dont la partie entière a
  au moins quatre chiffres, les coupes possibles
  `[{"coupe":k,"gauche":<entier>,"droite":[{"v","forte"}]}]` — k caractères
  lus comme un entier, le reste comme un montant. Le moteur ne relit pas le texte.
- Les taux sont en parties par million : aucun flottant.
- `montants_admis` (facultatif) : tout montant que le pack admet pour la charge
  au jour de la pièce — le droit standard (`ref.fiscal_charges`) et les tranches
  de toutes catégories de son barème (`ref.baremes_des_droits`). Le lecteur ne
  juge pas la conformité : le Socle le fait ensuite, selon la catégorie de
  l'émetteur (`bareme-du-timbre.ts`). `montant_fixe` reste lu, et compte parmi
  les admis. Seul le droit standard imprimé en lecture forte rend la charge
  présente sans son libellé ; une tranche l'exige.
- Tout se lit **au jour de la pièce** : la date que la chaîne a lue, à défaut sa
  date de réception — la règle du jugement (`analyse.ts`). Le contexte est gardé
  par jour.

## 4. La sortie du moteur (JSON)

```json
{
  "issue": "prouvee",
  "solutions": 1,
  "champs": {
    "total_ttc": {
      "valeur": "3594800",
      "refs": [{ "page": 1, "ordinal": 115 }],
      "statut": "prouve"
    }
  },
  "preuves": { "ttc": "verifiee", "lettres": "non_evaluable" }
}
```

- `issue` : `prouvee` (une seule affectation ferme toutes les preuves évaluables,
  et au moins une preuve arithmétique), `signalee` (une seule, mais les lettres la
  contredisent), `ambigue` (plusieurs), `aucune`.
- `statut` d'un champ : `prouve` (il entre dans une preuve vérifiée), `conforme`
  (format et repère, sans preuve arithmétique), `signale` (ambigu), `absent`.
- Une valeur n'est jamais émise sans citation, et jamais sans statut.
- Un champ de groupe rend ses `instances` (une par taux du barème, citée).
- La sortie porte aussi `combinaisons` (explorées) et `raison` (pourquoi rien
  n'est prouvé) ; une preuve peut valoir `echec`, `indeterminee` ou `non_fermee`.

## 5. Ce que fait l'adaptateur TypeScript

1. Lit la grille et le pack par une vue (`security_invoker`), jamais en dur.
2. Construit `jetons` avec `treillisMontant`, et les experts qui lisent le texte
   avec les règles du pack (`lireLesReglesDeLecture`, `experts.ts`) :
   `normalizeDate`, `normaliserMatricule`, `lireLeMontantEnLettres`.
3. Appelle le moteur WebAssembly, sans état.
4. Pour une facture, convertit le résultat en `VisionSelection` (page/ordinal) :
   l'aval de R2 relit les valeurs dans le plan.
5. Pour toute pièce relevée, inscrit les champs dans `capture.champs_lus`, par la
   porte `capture_champs_lus_inscrire` (au `portier`, serveur seul) : la grille et
   ses champs résolus à la date de la pièce (un champ inconnu est refusé), le rang
   d'une ligne de tableau et le taux d'une instance dans leurs colonnes, toutes les
   lignes d'une inscription sous un même `lecture_id`. Une valeur sans citation
   s'inscrit nulle ; la table refuse une valeur non citée et un statut nul.
   Un matricule dont la lettre de contrôle ne tient pas la règle du pack
   (`ref.identifiant_controles`, non publiée par la DGI : `defaut_a_valider`)
   s'inscrit avec `avertissement = 'lettre_de_controle_discordante'` : il
   avertit, il ne bloque pas (décision du 1er novembre 2026). La famille et le
   rôle d'un champ ne sont pas recopiés : `grille_champ_id` y mène.

Dans cette première livraison (`apps/api/src/malica/lecture/sudoku.ts`) :

- la lecture citée lit des factures : elle joue la grille `facture`. Les autres
  grilles sont en base avec leurs preuves traduites ; leur routage par type de
  document vient famille par famille, chacune avec son banc ;
- **par défaut, il est branché** depuis le 1er novembre 2026 (décision du
  dirigeant, sur la mesure du staging : pièce prouvée lue en 5,8 s au lieu de
  19,5 s, aucun montant faux). Le mode se résout **au jour de la lecture**, pas à
  la date de la pièce : une facture de 2025 lue aujourd'hui suit le réglage
  d'aujourd'hui ;
- **en observation** — `lecture.sudoku` = `observe`, au choix du cabinet ou du
  dossier —, il lit chaque pièce et inscrit ce qu'il a lu dans
  `capture.champs_lus`, mais la lecture de la chaîne ressort à l'identique ;
- **branché** — le réglage `lecture.sudoku` = `designe` (sujet « Lecture prouvée
  des pièces » de « Réglages comptabilité », résolu par `app.reglage_comptable` :
  le dossier, son cabinet, le pack) —, quand la pièce est prouvée, il remplace la désignation des **montants**
  (totaux, lignes de TVA, droits que la grille prouve). L'émetteur, la date et le
  sens restent désignés par la chaîne : aucune arithmétique ne les prouve ;
- non prouvée, la lecture ressort à l'identique. Un échec du sudoku (moteur
  absent, grille illisible) crie dans le journal et ne prive personne de sa
  lecture.
- **la relecture de nuit** (`lecture.relecture_nuit` = `active`, 17 novembre 2026) : le rattrapage par un autre lecteur ne part plus dans la requête ; il
  s'inscrit en travail `relecture_piece`, pas avant la lecture + le délai du
  dossier, et repasse par le sudoku comme le rattrapage
  (`lire` = `sudoku.lire(lecteurs.lire(p))`). Retenue (strictement meilleure),
  la relecture est une lecture NOUVELLE : ses champs s'inscrivent sous un
  nouveau `lecture_id`, et leurs citations pointent dans SON plan de jetons
  (`capture.token_plan.extraction_id`). Une pièce prouvée en `designe` ne
  s'inscrit pas : elle ne se rattrape pas. Voir `docs/exploitation.md`.

## 6. Ce qui est mesuré (31 octobre 2026)

Par le chemin de production — treillis TypeScript, grille et pack lus en base,
moteur (`apps/api/src/malica/lecture/sudoku.test.ts`) :

| Banc                                               | Résultat                                                 |
| -------------------------------------------------- | -------------------------------------------------------- |
| Facture réelle du jeu d'or (loyer, septembre 2026) | prouvée ; extrait identique à la désignation enregistrée |
| Banc 3 : 60 factures fictives lues par OCR         | 59 prouvées justes, 1 signalée, **0 fausse preuve**      |
| Banc 3 : 6 tickets                                 | 0 prouvé                                                 |
| Banc 3 : 3 000 lectures corrompues                 | **0 fausse preuve**                                      |

La facture signalée (F008) imprime son total HT « 165.747.027 » : l'OCR a mis un
point à la place de la virgule, et le treillis n'en tire que la lecture en
milliers. Elle n'est pas prouvée fausse : elle est rendue à la chaîne.

**Les vraies pièces du staging** (31 octobre 2026, lecture seule, sur le poste du
dirigeant ; aucune valeur sortie, seulement des comptes) — 457 pièces relevées,
même code que la branche :

| Issue                                     | Pièces                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Prouvées, identiques à la chaîne          | 344, dont les 132 dont l'écriture est inscrite                                  |
| Prouvées, la chaîne n'avait pas de totaux | 43 (44 avec les variantes)                                                      |
| Prouvées, différentes de la chaîne        | 1 — le HT de la chaîne ne ferme pas sa propre arithmétique ; le sudoku la ferme |
| Non prouvées, rendues à la chaîne         | 69                                                                              |

Moteur : 0,7 ms par pièce.

**Le jeu de 100 factures fictives du dirigeant** (31 octobre 2026), lu par la
couche de texte du PDF, avec le recollage, le lecteur de montants et la grille en
base : 76 factures prouvées justes sur les 86 lisibles, et 0 fausse preuve.

D-08 compte parmi ces justes : elle imprime ses montants à deux décimales, et le
sudoku rend les valeurs imprimées, arrondies, alors que la vérité du jeu note les
valeurs exactes.

Correctifs apportés après lecture des pièces :

- Un montant négatif (« -1 560,000 ») et une devise collée (« 980,000DT ») sont
  recollés.
- Le net à payer ferme avec la retenue à la source et les acomptes déduits,
  imprimés en négatif.
- Un champ facultatif hors charge (retenue, acompte) n'est exigé que sur une
  rangée chiffrée, et non sur une mention de bas de page ou un titre.
- Une pièce imprimée à deux décimales a, pour ses taux, une tolérance d'un
  demi-centime ; ses sommes restent exactes.

Restent signalées :

- les pièges que le jeu attend signalés (total faux, TVA fausse, imprimés vierges
  manuscrits) ;
- le timbre de 2,000 (INCERTAIN, absent du pack) ;
- les débours et les montants hors TVA ;
- l'espace pris comme séparateur décimal ;
- la facture d'acompte et le reçu d'acompte.

Le jeu de 50 achats donne 24 factures prouvées justes, et 0 fausse.

**Anneaux 1 et 2 sur les vraies pièces du staging** (lecture seule, comptes
seulement) :

- **Lignes prouvées : 302.** 277 sont identiques aux articles de la chaîne,
  25 concernent des pièces où la chaîne n'en avait pas, 0 diffère.
- **Parties prouvées : 302.** Pour 279, le sens est identique à celui de la
  chaîne ; pour 23, la chaîne n'avait pas de sens ; 0 diffère.
- **Centre** : inchangé.

Sur les jeux du dirigeant, 84 pièces ont leurs lignes prouvées, avec 0 ligne
fausse, y compris sur 1 871 mutations. Il n'y a ni sens, ni matricule, ni tiers
faux.

**Lecture middle-out, sur les images des 150 factures fictives** (OCR rapide) :
les pièces aux lignes prouvées passent de 3 à 70. Elles comptent 162
quantités trouvées par le calcul, et 0 ligne fausse. Les mutations donnent
aussi 0 fausse : 1 358 montants changés, 219 prix effacés, 273 paires de
montants effacées. Sur la couche de texte et sur le staging, les lignes
restent inchangées : 0 différence avec les articles de la chaîne.

**Tableaux sur deux pages, remises globales, cases collées** (1er novembre 2026) :

| Lecture                           | Lignes prouvées                                     | Fausses |
| --------------------------------- | --------------------------------------------------- | ------- |
| OCR rapide, 150 factures fictives | 76 (70 avant), 199 quantités trouvées par le calcul | **0**   |
| Couche de texte, 134 pièces       | 90 (84 avant)                                       | **0**   |

- Deux pages : 50/37 (45 lignes) et 100/D-19 prouvées justes.
- Remise globale : 100/A-05, A-20 et 50/22 prouvées justes.
- Case collée : la coupe est retenue sur 50/11 ; la pièce reste signalée, car
  la quantité « 1 » de sa première rangée est imprimée au-delà de la frontière
  des colonnes. Aucune pièce réelle du jeu ne se ferme encore par une coupe.
- Mutations, 0 fausse : 1 732 chiffres changés, 284 prix effacés, 1 295 paires
  de montants effacées ; un report changé d'un millime, une remise fausse ou
  absente, une case collée ramenée dans une seule colonne ne prouvent plus rien.
- Centre et anneau 2 inchangés : 284 pièces, 568 lectures, 0 écart au témoin.
- Staging : non rejoué pour ce lot (poste du dirigeant non relié).

Moteur seul (`cargo test`, grille d'essai) : 60/60, 0 fausse preuve,
0,45 ms médian par facture.

## 7. Les experts de lecture, famille par famille (16 novembre 2026)

Banc des 150 factures fictives du dirigeant, par le chemin de production (règles
du pack en base, adaptateur, moteur natif) ; vérité : `jeux_dirigeant.json`.
Un champ compte juste, faux (valeur rendue fausse), signalé ou absent ; **aucun
faux au statut `conforme` ou `prouve`**.

| Famille (champs)             | Couche de texte (134) j / f / s / a | OCR rapide (150) j / f / s / a |
| ---------------------------- | ----------------------------------- | ------------------------------ |
| reference (numéro)           | 113 / 0 / 0 / 20                    | 7 / 0 / 111 / 25 ¹             |
| date (émission, échéance)    | 128 / 0 / 0 / 33                    | 97 / 0 / 0 / 79                |
| identifiant (matricules)     | 42 / 0 / 38 / 184                   | 24 / 0 / 74 / 192              |
| tiers (noms, par E01)        | 26 / 0 / 0 / 238                    | 7 / 0 / 0 / 283                |
| libellé : montant en lettres | 117 / 0 / 0 / 13                    | 77 / 0 / 0 / 63                |
| libellé : devise             | 111 / 0 / 2 / 7                     | 110 / 0 / 1 / 19               |
| présence (cachet)            | 0 / 0 / 0 / 4                       | 0 / 0 / 0 / 10                 |

¹ 104 des 111 numéros signalés portent la bonne valeur, lue derrière un libellé
collé (« N°… ») : signalés parce que l'OCR y colle parfois autre chose (7 fois).

Avant ces experts (même banc, code du 1er novembre, grille de cette migration) :
dates justes 32 (texte) et 36 (OCR) — une date en plusieurs jetons n'était pas
lue ; matricules justes 51 et 35, mais 6 et 15 faux au statut `conforme` ; aucun
montant en lettres ni devise lus. Les 3 numéros faux de l’OCR venaient du repère
« Réf. », retiré par la migration.

Le centre : couche de texte 76 factures prouvées justes, OCR rapide 73 ; **0
fausse preuve**. 100/D-04 est signalée par ses lettres ; 100/D-08 aussi — ses
montants sont imprimés à deux décimales, ses lettres au millime : c'était la
seule fausse preuve connue (le sudoku rendait les valeurs arrondies).
