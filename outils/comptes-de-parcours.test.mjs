/**
 * Les comptes de parcours vivent dans UN fichier : outils/comptes-de-parcours.json.
 *
 * Jusqu'au 18 septembre 2026, le mot de passe et les deux adresses étaient
 * recopiés dans quatre fichiers — Playwright, Maestro, captures.mjs et le jeu de
 * données. Changer l'un sans les autres cassait un parcours sans rien dire
 * (dette D6). Ce test refuse toute copie dans le code suivi par git.
 *
 *   node --test outils/comptes-de-parcours.test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const RACINE = new URL("../", import.meta.url);
const comptes = JSON.parse(
  readFileSync(new URL("outils/comptes-de-parcours.json", RACINE), "utf8"),
);
const SECRETS = [comptes.motDePasse, comptes.dirigeant.email, comptes.expert.email];
const CODE = /\.(ts|tsx|mjs|js|cjs|yaml|yml|json|sh|ps1)$/;

test("aucun fichier de code ne recopie un compte de parcours", () => {
  const suivis = execFileSync("git", ["ls-files"], { cwd: RACINE, encoding: "utf8" })
    .split("\n")
    .filter((f) => CODE.test(f) && f !== "outils/comptes-de-parcours.json")
    .filter((f) => f !== "outils/comptes-de-parcours.test.mjs");
  const copies = [];
  for (const f of suivis) {
    let texte;
    try {
      texte = readFileSync(new URL(f, RACINE), "utf8");
    } catch {
      continue; // supprimé de l'arbre de travail, encore suivi
    }
    for (const s of SECRETS) if (texte.includes(s)) copies.push(`${f} : ${s}`);
  }
  assert.deepEqual(copies, []);
});
