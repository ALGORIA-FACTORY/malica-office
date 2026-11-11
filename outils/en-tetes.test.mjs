/**
 * Tout fichier de code s'ouvre sur un en-tête qui dit ce qu'il fait et pourquoi.
 *
 * Le dépôt se lit par ses en-têtes : un développeur qui arrive, un relecteur
 * métier, la documentation par public (`docs/`) partent de là. Le 10 novembre
 * 2026, 1 514 fichiers sur 1 584 en portaient un ; les 70 autres ont été écrits,
 * et ce test empêche qu'il en manque de nouveau. Comme pour les autres règles
 * d'AGENTS.md : une règle qu'aucune commande ne vérifie n'est qu'un souhait.
 *
 * Ce qui compte comme en-tête : un commentaire d'au moins une phrase (40 lettres
 * au moins, directives d'outils exclues), placé avant la première ligne de code
 * qui n'est ni un import ni un `export … from`. Les imports peuvent donc le
 * précéder, comme dans `apps/api/src/app.ts`.
 *
 * Une seule famille d'exceptions, nommée fichier par fichier : les migrations
 * déjà appliquées qui n'en ont pas. `db/migrer.mjs` tient l'empreinte SHA-256 de
 * chaque migration jouée et s'arrête si elle change : leur ajouter un
 * commentaire casserait le déploiement. Une migration nouvelle n'y entre pas.
 *
 *   node --test outils/en-tetes.test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));

/** Les extensions de code lues, et la syntaxe de commentaire de chacune. */
const SYNTAXES = {
  ts: "c",
  tsx: "c",
  js: "c",
  mjs: "c",
  css: "c",
  rs: "c",
  sql: "sql",
  py: "dièse",
  sh: "dièse",
};

/** Le nombre minimal de lettres pour qu'un commentaire dise quelque chose. */
const LETTRES_MIN = 40;

/** Migrations jouées avant la règle : leur empreinte est figée (voir l'en-tête). */
const MIGRATIONS_FIGEES = new Set([
  "db/migrations/20260824130408_4a4b1d5e-d4f5-4e63-a4cb-4b571130db63.sql",
  "db/migrations/20260824130456_f04d6c50-4a8a-4c43-8be9-fc7ec62552fa.sql",
  "db/migrations/20260824130649_30b9c679-779a-4a3d-9fe1-10fdabdb2868.sql",
  "db/migrations/20260824130810_06d1474a-70b7-4c08-86ef-5ce29012d70a.sql",
  "db/migrations/20260825211034_f1679589-efa1-400f-adfe-644f2ee8a026.sql",
  "db/migrations/20260825213940_b3402a18-8ca3-49e9-b015-29ba54dc4297.sql",
  "db/migrations/20260825221225_1e864905-ce83-48f2-a5f2-5cc1ea863eab.sql",
  "db/migrations/20260825235433_dd96aeb8-fee2-49dd-a5ea-86f489af7c1b.sql",
]);

/** Directives d'outils : elles occupent un commentaire sans rien expliquer. */
const DIRECTIVE =
  /eslint-|@ts-|prettier-ignore|biome-ignore|istanbul|c8 ignore|noqa|type:\s*ignore/;

const lettres = (texte) => (texte.match(/\p{L}/gu) ?? []).length;

/**
 * Le texte des commentaires qui précèdent la première ligne de code, ou `null`
 * si le fichier n'a pas de code (il est alors tout commentaire, donc lisible).
 */
export function enTete(source, syntaxe) {
  const lignes = source.replace(/^﻿/, "").split(/\r?\n/);
  let texte = "";
  let dansBloc = false; // à l'intérieur d'un /* … */ ou d'une docstring
  let dansImport = false; // import réparti sur plusieurs lignes
  for (let i = 0; i < lignes.length; i++) {
    const brute = lignes[i];
    const l = brute.trim();
    if (i === 0 && l.startsWith("#!")) continue;
    if (dansBloc) {
      const fin = syntaxe === "dièse" ? l.includes('"""') : l.includes("*/");
      texte += " " + l.replace(/\*\/.*$|"""/g, "");
      if (fin) dansBloc = false;
      continue;
    }
    if (dansImport) {
      if (/from\s+["'][^"']+["'];?$|^["'][^"']+["'];?$|;$/.test(l)) dansImport = false;
      continue;
    }
    if (l === "") continue;
    if (syntaxe === "c") {
      if (l.startsWith("//")) {
        texte += " " + l.replace(/^\/\/[/!]?/, "");
        continue;
      }
      if (l.startsWith("/*")) {
        texte += " " + l.replace(/^\/\*+|\*\/.*$/g, "");
        if (!l.includes("*/")) dansBloc = true;
        continue;
      }
      if (/^["']use (client|server|strict)["'];?$/.test(l)) continue;
      // Un import, ou une réexportation `export … from` : complet sur la ligne,
      // ou ouvert sur plusieurs lignes jusqu'à son `from "…"`.
      const reexport = /^export\s+(\*|\{|type\s*\{)/.test(l);
      if (/^import\b/.test(l) || reexport) {
        const complet = /from\s+["'][^"']+["'];?$/.test(l) || /^import\s*["'][^"']+["'];?$/.test(l);
        if (!complet) dansImport = true;
        continue;
      }
    } else if (syntaxe === "sql") {
      if (l.startsWith("--")) {
        texte += " " + l.replace(/^--+/, "");
        continue;
      }
      if (l.startsWith("/*")) {
        texte += " " + l.replace(/^\/\*+|\*\/.*$/g, "");
        if (!l.includes("*/")) dansBloc = true;
        continue;
      }
    } else {
      if (l.startsWith("#")) {
        texte += " " + l.replace(/^#+/, "");
        continue;
      }
      if (l.startsWith('"""')) {
        const reste = l.slice(3);
        texte += " " + reste.replace(/"""/g, "");
        if (!reste.includes('"""')) dansBloc = true;
        continue;
      }
      if (/^(from\s+\S+\s+)?import\b/.test(l)) continue;
    }
    return texte;
  }
  return null;
}

/** Vrai si le texte d'en-tête dit quelque chose (directives d'outils retirées). */
export function enTeteSuffisant(texte) {
  if (texte === null) return true;
  const utile = texte
    .split(/\s{2,}|\n/)
    .filter((morceau) => !DIRECTIVE.test(morceau))
    .join(" ");
  return lettres(utile) >= LETTRES_MIN;
}

function fichiersDeCode() {
  return execFileSync("git", ["ls-files"], { cwd: racine, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.startsWith("docs/"))
    .map((f) => ({ chemin: f, syntaxe: SYNTAXES[f.split(".").pop()] }))
    .filter((f) => f.syntaxe);
}

describe("enTete — ce qui compte comme en-tête", () => {
  it("un bloc /** */ en tête de fichier", () => {
    assert.ok(
      enTeteSuffisant(
        enTete(
          "/**\n * Le moteur de TVA : il rend la base et le taux appliqué.\n */\nexport const x = 1;\n",
          "c",
        ),
      ),
    );
  });
  it("un bloc placé après les imports, y compris un import sur plusieurs lignes", () => {
    const source =
      'import a from "a";\nimport {\n  b,\n  c,\n} from "b";\n\n/**\n * La page des charges : elle liste les dépenses du mois par famille.\n */\nexport function Page() {}\n';
    assert.ok(enTeteSuffisant(enTete(source, "c")));
  });
  it("un en-tête SQL en commentaires --, une docstring Python, un //! Rust", () => {
    assert.ok(
      enTeteSuffisant(
        enTete(
          "-- La vue des pièces en attente, filtrée par le tenant de l'appelant.\nselect 1;\n",
          "sql",
        ),
      ),
    );
    assert.ok(
      enTeteSuffisant(
        enTete(
          '"""\nLe lecteur OCR derrière une porte HTTP, sur le réseau interne.\n"""\nimport os\n',
          "dièse",
        ),
      ),
    );
    assert.ok(
      enTeteSuffisant(
        enTete(
          "//! Le sudoku : attribuer les valeurs lues aux champs de la grille.\nmod a;\n",
          "c",
        ),
      ),
    );
  });
});

describe("enTete — ce qui ne compte pas", () => {
  it("un fichier qui commence par du code", () => {
    assert.equal(enTeteSuffisant(enTete('import a from "a";\nexport const x = 1;\n', "c")), false);
  });
  it("une directive d'outil seule", () => {
    assert.equal(
      enTeteSuffisant(
        enTete(
          "/* eslint-disable react-refresh/only-export-components */\nexport const x = 1;\n",
          "c",
        ),
      ),
      false,
    );
  });
  it("un commentaire placé après la première ligne de code", () => {
    assert.equal(
      enTeteSuffisant(
        enTete(
          "export const x = 1;\n/** Une explication bien trop tardive pour servir d'en-tête au fichier. */\n",
          "c",
        ),
      ),
      false,
    );
  });
});

describe("le dépôt", () => {
  const fichiers = fichiersDeCode();

  it("chaque fichier de code a un en-tête", () => {
    const sans = fichiers
      .filter((f) => !MIGRATIONS_FIGEES.has(f.chemin))
      .filter(
        (f) => !enTeteSuffisant(enTete(readFileSync(`${racine}/${f.chemin}`, "utf8"), f.syntaxe)),
      )
      .map((f) => f.chemin);
    assert.deepEqual(
      sans,
      [],
      `Fichiers sans en-tête (rôle et raison, ${LETTRES_MIN} lettres au moins) :\n${sans.join("\n")}`,
    );
  });

  it("chaque exception nomme une migration qui existe encore", () => {
    const presents = new Set(fichiers.map((f) => f.chemin));
    for (const m of MIGRATIONS_FIGEES) assert.ok(presents.has(m), `exception périmée : ${m}`);
  });
});
