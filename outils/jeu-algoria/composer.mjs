/**
 * Composer le jeu d'ALGORIA : cent vingt factures FICTIVES — cent achats, vingt
 * ventes — dont la seule partie réelle est ALGORIA FACTORY SARL.
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
 * ne sont pas des factures entreront dans le même dossier avec leur type et
 * leur grille, et leur vérité se clé par les champs de LEUR grille
 * (`grilles/<code>.json`, relevée en base par `relever-les-grilles.mjs`).
 *
 * Le hasard est graine (mulberry32, `../jeu-synthetique/hasard.mjs`) : relancer
 * réécrit des fichiers identiques à l'octet.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mulberry32, tirages } from "../jeu-synthetique/hasard.mjs";

import { composerFacture, lesParties } from "./factures.mjs";

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

const GRILLE = JSON.parse(readFileSync(join(ICI, "grilles", "facture.json"), "utf8"));
const CODES = new Set(GRILLE.champs.map((c) => c.code));

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

/** Les clés de la vérité sont des codes de la grille, ou le cas est refusé. */
function verifierLesCles(cas) {
  const cles = new Set();
  for (const [cle, valeur] of Object.entries(cas.attendu.concepts)) {
    cles.add(cle);
    if (cle === "lignes") for (const l of valeur) for (const k of Object.keys(l)) cles.add(k);
  }
  cles.delete("lignes");
  const inconnues = [...cles].filter((c) => !CODES.has(c));
  if (inconnues.length > 0)
    throw new Error(
      `${cas.id} : clés hors de la grille ${GRILLE.grille.code} — ${inconnues.join(", ")}`,
    );
  return cles;
}

/* ------------------------------------------------------------------ l'écriture */

const SORTIE = join(ICI, "cas");
rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(SORTIE, { recursive: true });

const t = tirages(mulberry32(GRAINE));
const parties = lesParties(t);
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
    cas.attendu.non_imprimes = GRILLE.champs
      .map((c) => c.code)
      .filter((c) => !cles.has(c) && !(c in cas.attendu.confondus));
    writeFileSync(join(SORTIE, `${cas.id}.json`), `${JSON.stringify(cas, null, 2)}\n`);
    rang += 1;
  }
  groupe += 1;
}
console.log(`${readdirSync(SORTIE).length} cas écrits dans ${SORTIE}`);
