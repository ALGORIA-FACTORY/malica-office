// Une clé d'API, un jeton ou un mot de passe ne se lit jamais dans `vars.*`
// d'un workflow : GitHub imprime les variables en clair dans le journal
// d'Actions, et le journal de ce dépôt est public. Le 16 novembre 2026, la clé
// Brevo du staging y était lisible depuis plus de cent déploiements.
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const DOSSIER = new URL("../.github/workflows/", import.meta.url);
const SENSIBLE = /\bvars\.([A-Z0-9_]*(?:KEY|CLE|TOKEN|JETON|SECRET|PASSWORD|MOT_DE_PASSE)[A-Z0-9_]*)\b/g;

test("aucun workflow ne lit une clé dans une variable", () => {
  const fautes = [];
  for (const nom of readdirSync(DOSSIER).filter((f) => /\.ya?ml$/.test(f))) {
    readFileSync(new URL(nom, DOSSIER), "utf8")
      .split("\n")
      .forEach((ligne, i) => {
        if (ligne.trimStart().startsWith("#")) return;
        for (const m of ligne.matchAll(SENSIBLE)) fautes.push(`${nom}:${i + 1} vars.${m[1]}`);
      });
  }
  assert.deepEqual(fautes, [], "à poser comme secret de l'environnement GitHub");
});
