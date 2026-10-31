# Le sudoku — contrat entre les grilles, le moteur et l'adaptateur

_31 octobre 2026. PR 1 de la lecture prouvée pour tous les documents._

Le sudoku ne lit aucun montant lui-même (règle ① de la fabrique de lecteurs) et
ne porte aucune constante réglementaire (R4). Il reçoit trois choses : le plan de
jetons avec les lectures déjà faites par la chaîne, la grille du type de
document, et les paramètres du pack. Il rend, champ par champ, une valeur citée
et un statut. Tout le reste — la grille, les preuves, les taux — vit en base.

## 1. Les trois couches, en base (schéma `ref`, daté par le pack)

| Table                  | Couche | Ce qu'elle porte                                                                                                                                                                                         |
| ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref.grilles`          | —      | un type de document : `code`, `famille`, `nom`, `document_type` (lien vers `ref.document_types`, nullable), `statut`                                                                                     |
| `ref.grille_champs`    | 1      | `grille_id`, `parcelle`, `code`, `libelle`, `type`, `obligatoire`, `condition`, `reperes_fr[]`, `reperes_ar[]`, `format_code` (nullable), `groupe` (nullable), `fondement`, `source_fondement`, `statut` |
| `ref.grille_relations` | 2      | `grille_id`, `vers`, `nature`, `cle`                                                                                                                                                                     |
| `ref.grille_preuves`   | 3      | `grille_id`, `code`, `regle` (texte d'origine), `genre`, `expression` (jsonb, nullable), `statut`                                                                                                        |

`statut` vaut `defaut_a_valider` pour tout ce que Malica livre (R10) ; seule
l'expertise le passe à `arrete`. `source_fondement` vaut `texte`, `pratique` ou
`incertain`. Une preuve sans `expression` n'est pas exécutée : son `statut` vaut
`a_traduire`.

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
| `charge`      | `{"op":"charge","montant":"m","code":"DROIT_TIMBRE","base":"b?"}`                                     | m = montant fixe du pack, ou arrondi(base × taux) de la charge                 |
| `egal`        | `{"op":"egal","a":"x","b":"y"}`                                                                       | x = y                                                                          |
| `format`      | `{"op":"format","champ":"c","format":"matricule_fiscal"}`                                             | la valeur respecte le motif nommé, fourni en entrée                            |
| `ordre`       | `{"op":"ordre","avant":"d1","apres":"d2"}`                                                            | d1 ≤ d2 (dates)                                                                |

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
- **Anneau 2 — les parties** (`{"op":"parties", …}`, preuve E01). Un seul des
  matricules lus est celui du dossier, et un indice imprimé (« client »,
  « émetteur ») dit le sens. La contrepartie est rapprochée des tiers du dossier,
  et son nom est comparé sans la forme juridique (`ref.formes_juridiques`). La
  géométrie confirme, mais ne décide jamais seule.
- Les dates (E02 : émission ≤ échéance) et le numéro sont lus par leurs repères,
  au statut `conforme`. Seul ce qui est **prouvé** remplace la désignation de la
  chaîne.

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
           "charges":[{"code":"DROIT_TIMBRE","montant_fixe":1000,"taux_ppm":null,"assiette_tva":false}],
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
- `date` : la date ISO rendue par `normalizeDate`, ou `null`.
- Les taux sont en parties par million : aucun flottant.

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
  et au moins une preuve arithmétique), `ambigue` (plusieurs), `aucune`.
- `statut` d'un champ : `prouve` (il entre dans une preuve vérifiée), `conforme`
  (format et repère, sans preuve arithmétique), `signale` (ambigu), `absent`.
- Une valeur n'est jamais émise sans citation, et jamais sans statut.
- Un champ de groupe rend ses `instances` (une par taux du barème, citée).
- La sortie porte aussi `combinaisons` (explorées) et `raison` (pourquoi rien
  n'est prouvé) ; une preuve peut valoir `echec`, `indeterminee` ou `non_fermee`.

## 5. Ce que fait l'adaptateur TypeScript

1. Lit la grille et le pack par une vue (`security_invoker`), jamais en dur.
2. Construit `jetons` avec `treillisMontant` et `normalizeDate`.
3. Appelle le moteur WebAssembly, sans état.
4. Pour une facture, convertit le résultat en `VisionSelection` (page/ordinal) :
   l'aval de R2 relit les valeurs dans le plan.
5. Pour toute pièce relevée, inscrit les champs dans `capture.champs_lus`.

Dans cette première livraison (`apps/api/src/malica/lecture/sudoku.ts`) :

- la lecture citée lit des factures : elle joue la grille `facture`. Les autres
  grilles sont en base avec leurs preuves traduites ; leur routage par type de
  document vient famille par famille, chacune avec son banc ;
- **par défaut, il observe** : il lit chaque pièce et inscrit ce qu'il a lu dans
  `capture.champs_lus`, mais la lecture de la chaîne ressort à l'identique. Rien ne
  change pour personne tant que le dirigeant ne le branche pas ;
- **branché** (`SUDOKU_DESIGNE=1` dans l'environnement de l'API, comme `OCR_URL`
  branche PaddleOCR), quand la pièce est prouvée, il remplace la désignation des **montants**
  (totaux, lignes de TVA, droits que la grille prouve). L'émetteur, la date et le
  sens restent désignés par la chaîne : aucune arithmétique ne les prouve ;
- non prouvée, la lecture ressort à l'identique. Un échec du sudoku (moteur
  absent, grille illisible) crie dans le journal et ne prive personne de sa
  lecture.

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

**Les deux jeux de factures fictives du dirigeant** (31 octobre 2026), avec la
couche de texte du PDF, le recollage, le lecteur de montants et la grille en base :

| Jeu                                                                 | Factures lues | Prouvées justes           | Fausses preuves |
| ------------------------------------------------------------------- | ------------- | ------------------------- | --------------- |
| 100 pièces en 5 lots (socle, fiscalité, nature, pièges, manuscrits) | 86            | 63 (4 sans les variantes) | 0               |
| 50 achats                                                           | 36            | 24                        | 0               |

Restent signalées, sans faux positif : la retenue à la source, l'acompte, la TVA
suspendue ou exonérée, l'avoir, les débours, les totaux volontairement faux, le
timbre de 2,000 (INCERTAIN : il n'est pas dans le pack) et les imprimés
manuscrits. Seize pièces sans couche de texte demandent un OCR.

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

Moteur seul (`cargo test`, grille d'essai) : 60/60, 0 fausse preuve,
0,45 ms médian par facture.
