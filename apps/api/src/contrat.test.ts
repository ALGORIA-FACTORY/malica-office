/**
 * Le contrat servi est celui du dépôt.
 *
 * `contrat/rpc.json` est relevé depuis les dépôts et commité avec le code.
 * S'ils divergent, une méthode a été ajoutée, renommée ou retirée sans que
 * la frontière soit relue : le test dit laquelle, et comment relever.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { contratRpc } from "./rpc.ts";

const FICHIER = new URL("../../../contrat/rpc.json", import.meta.url);

test("contrat/rpc.json est exactement ce que l'API sert", () => {
  const fige = JSON.parse(readFileSync(FICHIER, "utf8")) as Record<string, string[]>;
  const servi = contratRpc();

  const ecarts: string[] = [];
  for (const depot of new Set([...Object.keys(fige), ...Object.keys(servi)])) {
    const a = new Set(fige[depot] ?? []);
    const b = new Set(servi[depot] ?? []);
    for (const m of b) if (!a.has(m)) ecarts.push(`+ ${depot}.${m} (servie, absente du contrat)`);
    for (const m of a) if (!b.has(m)) ecarts.push(`- ${depot}.${m} (au contrat, plus servie)`);
  }

  assert.deepEqual(
    ecarts,
    [],
    "le contrat a bougé : node --experimental-strip-types contrat/relever.mjs --ecrire, puis commiter",
  );
});
