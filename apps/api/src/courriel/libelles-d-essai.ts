/**
 * Pour les épreuves sans base : les textes du courriel tels que les migrations
 * les écrivent dans `notif.libelles_courriel`. Une seule source — le dépôt —
 * et la même règle que `notif.libelles_du_courriel` : la version la plus
 * récente dans la langue, sinon en français.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Libelles } from "./libelles.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../../db/migrations", import.meta.url));
const LIGNE =
  /^\s*\('([a-zA-Z0-9_.]+)', '(fr|en|ar)', '((?:[^']|'')*)', date '(\d{4}-\d{2}-\d{2})'\)/gm;

interface Version {
  cle: string;
  locale: string;
  texte: string;
  effet: string;
}

function versions(): Version[] {
  const toutes: Version[] = [];
  for (const f of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    if (!sql.includes("notif.libelles_courriel")) continue;
    for (const m of sql.matchAll(LIGNE))
      toutes.push({ cle: m[1]!, locale: m[2]!, texte: m[3]!.replaceAll("''", "'"), effet: m[4]! });
  }
  return toutes;
}

export function libellesDEssai(locale: string): Libelles {
  const choisi = new Map<string, Version>();
  for (const v of versions()) {
    if (v.locale !== locale && v.locale !== "fr") continue;
    const deja = choisi.get(v.cle);
    const meilleur =
      !deja ||
      (v.locale === locale && deja.locale !== locale) ||
      (v.locale === deja.locale && v.effet > deja.effet);
    if (meilleur) choisi.set(v.cle, v);
  }
  return Object.fromEntries([...choisi].map(([cle, v]) => [cle, v.texte]));
}
