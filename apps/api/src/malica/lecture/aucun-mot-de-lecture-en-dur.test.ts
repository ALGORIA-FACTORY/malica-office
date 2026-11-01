/**
 * R4, étendu au vocabulaire de lecture : aucun nom de mois, aucun mot de nombre,
 * aucune unité monétaire, aucune étiquette arabe n'est écrite dans le code qui lit.
 *
 * ================================================================= POURQUOI
 *
 * Les noms de mois vivaient dans `normalizeDate`, la forme du matricule fiscal
 * tunisien et ses étiquettes (« المعرف الجبائي ») dans `matricule.ts`. Ils sont
 * descendus en base le 16 novembre 2026 (`ref.mois_en_lettres`,
 * `ref.identifiant_formats`, `ref.nombres_en_lettres`, `ref.devises_en_lettres`) :
 * un autre pack apporte les siens sans fork (R5), et l'expert les corrige sans
 * migration de code (R10). Cette épreuve empêche qu'ils reviennent.
 *
 * Le code est relu SANS ses commentaires : un commentaire peut citer « 1er
 * septembre 2026 » pour expliquer, le code ne peut pas le porter.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const RACINE = new URL("../../../../../", import.meta.url);

/** Les modules qui lisent une date, un identifiant ou un montant en lettres. */
const LECTEURS = [
  "apps/api/src/malica/lecture/token-plan.ts",
  "apps/api/src/malica/lecture/experts.ts",
  "apps/api/src/malica/lecture/sudoku.ts",
  "apps/api/src/malica/lecture/regles-de-lecture.ts",
  "packages/socle/src/matricule.ts",
  "packages/socle/src/montant-en-lettres.ts",
  "packages/socle/src/mot-comparable.ts",
  "packages/socle/src/sens-de-la-piece.ts",
];

/** Des mots que seule la base peut porter (une liste d'épreuve, pas de production). */
const MOTS = [
  "janvier",
  "fevrier",
  "février",
  "mars",
  "avril",
  "juin",
  "juillet",
  "aout",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "decembre",
  "décembre",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "vingt",
  "trente",
  "quarante",
  "cinquante",
  "soixante",
  "cent",
  "cents",
  "mille",
  "million",
  "dinar",
  "dinars",
  "millime",
  "millimes",
  "euro",
  "euros",
  "centime",
];

/** Les étiquettes d'un identifiant : un nom de propriété peut les porter, un motif non. */
const ETIQUETTES = ["matricule", "fiscal", "identifiant"];

/** Le code sans ses commentaires (les chaînes restent : c'est elles qu'on juge). */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1 ");
}

describe("R4 — aucun mot de lecture dans le code qui lit", () => {
  for (const fichier of LECTEURS) {
    const code = sansCommentaires(readFileSync(new URL(fichier, RACINE), "utf8"));

    it(`${fichier} : aucune lettre arabe`, () => {
      // Les lettres (U+0621–U+064A) ; les marques combinantes que `comparable` retire, non.
      const lettre = /[ء-ي]/u.exec(code);
      assert.equal(lettre, null, `lettre arabe en dur : « ${lettre?.[0]} »`);
    });

    it(`${fichier} : aucun mois, nombre, unité ni étiquette écrit comme vocabulaire`, () => {
      const alternance = MOTS.join("|");
      // Une chaîne qui EST le mot (« "mars" »), une clé d'objet (« janvier: 1 »), ou une
      // expression régulière qui le cherche (« /matricule\s*fiscal/ ») — pas une phrase
      // d'un message, qui le dit à une personne.
      const mot = `(?:${alternance})`;
      const etiquette = `(?:${[...MOTS, ...ETIQUETTES].join("|")})`;
      const formes = [
        // une chaîne qui est le mot
        new RegExp(String.raw`["'\x60]${mot}["'\x60]`, "iu"),
        // une clé d'objet
        new RegExp(String.raw`(?:^|[{,\s])${mot}\s*:`, "imu"),
        // une expression régulière littérale qui le contient
        new RegExp(
          String.raw`(?:^|[=(,:\s\[])\/(?![/*])(?:\\.|[^/\n\\])*?\b${etiquette}\b(?:\\.|[^/\n\\])*\/[dgimsuy]*`,
          "imu",
        ),
      ];
      const trouves = formes.flatMap((f) => {
        const m = f.exec(code);
        return m ? [m[0].trim()] : [];
      });
      assert.deepEqual(trouves, []);
    });
  }
});
