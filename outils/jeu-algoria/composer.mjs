/**
 * Composer le jeu d'ALGORIA : cent vingt factures FICTIVES — cent achats, vingt
 * ventes — et quarante et une autres pièces (cas 121 à 161 : gouvernance,
 * paiements, banque, paie, déclarations, contrats…), dont la seule partie
 * réelle est ALGORIA FACTORY SARL.
 *
 *   node --experimental-strip-types outils/jeu-algoria/composer.mjs   # cas/NNN.json
 *
 * ================================================================= POURQUOI
 *
 * Le banc sans IA ni GPU (OCR rapide sur CPU → moteur Sudoku → experts de champ
 * menés par le dictionnaire des concepts) doit lire 100 % des champs imprimés,
 * ou dire « inconnu », jamais faux, jamais du côté de la mauvaise partie. Ce
 * jeu lui donne des pièces au plus près du réel : le ticket de détail
 * « Bon de Livraison/Facture » d'un magasin, la facture classique, l'arabe, le
 * bilingue, le carnet à souche rempli à la main — photographiés, scannés,
 * tamponnés, annotés.
 *
 * ================================================================== LE SCHÉMA
 *
 * Un cas porte `type` (le code du type de document en base, `ref.document_types`)
 * et `grille` (le code de la grille de lecture, `ref.grilles`) : les pièces qui
 * ne sont pas des factures (`pieces.mjs`) sont dans le même dossier avec leur
 * type et leur grille, et leur vérité se clé par les champs de LEUR grille
 * (`grilles/<code>.json`, relevée en base par `relever-les-grilles.mjs`). Une
 * pièce sans grille (`grille: null`) n'attend rien : aucune valeur.
 *
 * Le hasard est graine (mulberry32, `../jeu-synthetique/hasard.mjs`) : relancer
 * réécrit des fichiers identiques à l'octet.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mulberry32, tirages } from "../jeu-synthetique/hasard.mjs";

import { composerFacture, lesParties } from "./factures.mjs";
import { composerPieces, controlerLesMatricules } from "./pieces.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const GRAINE = 20261103;

/* --------------------------------------------------------------- la matrice */

/*
 * [sens, gabarit, langue, rendu, capture, nombre]. Gabarits : A ticket de
 * détail « Bon de Livraison/Facture », B facture classique française, C arabe
 * imprimée, D bilingue, E carnet manuscrit français, F carnet manuscrit arabe.
 * `pdf` : PDF de logiciel, avec sa couche de texte ; `pdf_image` : une photo
 * ou un scan enveloppé dans un PDF, sans texte (comme le ticket réel reçu par
 * le dirigeant) ; `photo`, `scan` : JPEG ; `manuscrit` : un carnet, capturé
 * en photo ou au scanner.
 */
const MATRICE = [
  ["achat", "A", "fr", "pdf", null, 11],
  ["achat", "A", "fr", "pdf_image", null, 4],
  ["achat", "A", "fr", "scan", null, 10],
  ["achat", "A", "fr", "photo", null, 10],
  ["achat", "B", "fr", "pdf", null, 6],
  ["achat", "B", "fr", "pdf_image", null, 2],
  ["achat", "B", "fr", "photo", null, 4],
  ["achat", "B", "fr", "scan", null, 3],
  ["achat", "C", "ar", "pdf", null, 6],
  ["achat", "C", "ar", "pdf_image", null, 1],
  ["achat", "C", "ar", "photo", null, 4],
  ["achat", "C", "ar", "scan", null, 4],
  ["achat", "D", "hybride", "pdf", null, 4],
  ["achat", "D", "hybride", "pdf_image", null, 1],
  ["achat", "D", "hybride", "photo", null, 3],
  ["achat", "D", "hybride", "scan", null, 2],
  ["achat", "E", "fr", "manuscrit", "photo", 6],
  ["achat", "E", "fr", "manuscrit", "scan", 4],
  ["achat", "F", "ar", "manuscrit", "photo", 9],
  ["achat", "F", "ar", "manuscrit", "scan", 6],
  ["vente", "A", "fr", "pdf", null, 2],
  ["vente", "B", "fr", "pdf", null, 3],
  ["vente", "C", "ar", "pdf", null, 3],
  ["vente", "C", "ar", "photo", null, 1],
  ["vente", "C", "ar", "scan", null, 1],
  ["vente", "D", "hybride", "pdf", null, 2],
  ["vente", "D", "hybride", "photo", null, 1],
  ["vente", "D", "hybride", "scan", null, 1],
  ["vente", "E", "fr", "manuscrit", "photo", 2],
  ["vente", "E", "fr", "manuscrit", "scan", 1],
  ["vente", "F", "ar", "manuscrit", "photo", 2],
  ["vente", "F", "ar", "manuscrit", "scan", 1],
];

/** Les contenus, tournés dans chaque case pour que chaque rendu les voie. */
const CONTENUS = {
  achatDetail: [
    "un_taux",
    "dense",
    "plusieurs_taux",
    "remise_ligne",
    "un_taux",
    "dense",
    "un_taux",
  ],
  venteDetail: ["un_taux", "plusieurs_taux"],
  achat: ["un_taux", "plusieurs_taux", "remise", "fodec", "exonere", "taux_13", "taux_7", "long"],
  vente: ["un_taux", "plusieurs_taux", "exonere"],
};
/** Les contenus uniques, posés sur une case précise : [sens, gabarit, rendu, rang]. */
const UNIQUES = [
  ["achat", "B", "photo", 1, "devise_eur"],
  ["vente", "D", "pdf", 0, "export_usd"],
];

/* ----------------------------------------------------------------- la grille */

/** Les codes des champs d'une grille relevée (`grilles/<code>.json`), lus une fois. */
const GRILLES = new Map();
function codesDe(code) {
  if (!GRILLES.has(code))
    GRILLES.set(
      code,
      JSON.parse(readFileSync(join(ICI, "grilles", `${code}.json`), "utf8")).champs.map(
        (c) => c.code,
      ),
    );
  return GRILLES.get(code);
}

/**
 * Ce que la page imprime UNE fois pour deux champs de la grille : la seule
 * « Date » (la loi vise la date de l'opération, la pratique la confond avec
 * celle d'émission) ; le bloc « Livré à » du ticket, qui est l'adresse du
 * client ; le code TVA, la catégorie et l'établissement, qui se lisent dans le
 * matricule.
 */
function confondus(cas) {
  const c = { date_emission: "date_operation" };
  if (cas.gabarit === "A") c.adresse_livraison = "adresse_client";
  if (cas.attendu.concepts.matricule_fiscal_emetteur)
    c.code_tva_categorie_etablissement = "matricule_fiscal_emetteur";
  return c;
}

/**
 * Les clés de la vérité sont des codes de la grille du cas, ou le cas est
 * refusé ; une pièce sans grille n'attend aucune valeur.
 */
function verifierLesCles(cas) {
  const cles = new Set();
  for (const [cle, valeur] of Object.entries(cas.attendu.concepts)) {
    cles.add(cle);
    if (cle === "lignes") for (const l of valeur) for (const k of Object.keys(l ?? {})) cles.add(k);
  }
  cles.delete("lignes");
  if (cas.grille === null) {
    if (cles.size > 0) throw new Error(`${cas.id} : une pièce sans grille n'attend rien`);
    return cles;
  }
  const codes = new Set(codesDe(cas.grille));
  const inconnues = [...cles, ...Object.keys(cas.attendu.confondus ?? {})].filter(
    (c) => !codes.has(c),
  );
  if (inconnues.length > 0)
    throw new Error(`${cas.id} : clés hors de la grille ${cas.grille} — ${inconnues.join(", ")}`);
  if (cas.attendu.concepts.lignes?.some((l) => l === undefined || l === null))
    throw new Error(`${cas.id} : une ligne vide dans lignes`);
  return cles;
}

/* ------------------------------------------------------------------ l'écriture */

const SORTIE = join(ICI, "cas");
rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(SORTIE, { recursive: true });

const t = tirages(mulberry32(GRAINE));
const parties = lesParties(t);
const factures = {};
let rang = 0;
let groupe = 0;
for (const [sens, gabarit, langue, rendu, capture, n] of MATRICE) {
  const g = { sens, gabarit, langue, rendu, capture };
  const liste =
    gabarit === "A" ? CONTENUS[sens === "achat" ? "achatDetail" : "venteDetail"] : CONTENUS[sens];
  for (let j = 0; j < n; j += 1) {
    const unique = UNIQUES.find(
      (u) => u[0] === sens && u[1] === gabarit && u[2] === rendu && u[3] === j,
    )?.[4];
    const scenario = unique ?? liste[(j + groupe * 3) % liste.length];
    const cas = composerFacture({ rang, g, j, scenario, parties, tirages: t, graine: GRAINE });
    const cles = verifierLesCles(cas);
    cas.attendu.confondus = confondus(cas);
    cas.attendu.non_imprimes = codesDe(cas.grille).filter(
      (c) => !cles.has(c) && !(c in cas.attendu.confondus),
    );
    writeFileSync(join(SORTIE, `${cas.id}.json`), `${JSON.stringify(cas, null, 2)}\n`);
    factures[cas.id] = cas;
    rang += 1;
  }
  groupe += 1;
}

/* Les autres pièces, après les factures : leur hasard ne touche pas celui des factures. */
for (const cas of composerPieces({ parties, factures, graine: GRAINE })) {
  const cles = verifierLesCles(cas);
  controlerLesMatricules(cas);
  cas.attendu.non_imprimes =
    cas.grille === null
      ? []
      : codesDe(cas.grille).filter((c) => !cles.has(c) && !(c in cas.attendu.confondus));
  writeFileSync(join(SORTIE, `${cas.id}.json`), `${JSON.stringify(cas, null, 2)}\n`);
}
console.log(`${readdirSync(SORTIE).length} cas écrits dans ${SORTIE}`);
