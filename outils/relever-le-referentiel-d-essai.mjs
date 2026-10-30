/**
 * Relever le pack tunisien d'une base migrée, et en écrire l'instantané dont se
 * servent les épreuves pures (`apps/api/src/scan/referentiel-d-essai.json`).
 *
 * ===================================================================== USAGE
 *
 *   node db/migrer.mjs --base <url d'une base vide>
 *   DATABASE_URL_ADMIN=<même url> \
 *     node --experimental-strip-types outils/relever-le-referentiel-d-essai.mjs
 *
 * L'URL n'est jamais affichée. `le-referentiel-d-essai-dit-vrai.test.ts`
 * rejoue le même relevé en base et refuse tout écart avec l'instantané.
 */
import { writeFileSync } from "node:fs";

import pg from "pg";

import { releverLeReferentiel } from "../apps/api/src/scan/releve-du-referentiel.ts";

const url = process.env.DATABASE_URL_ADMIN;
if (!url) throw new Error("DATABASE_URL_ADMIN absente : la base migrée à relever.");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const releve = await releverLeReferentiel(client, "TN");
  const cible = new URL("../apps/api/src/scan/referentiel-d-essai.json", import.meta.url);
  writeFileSync(cible, `${JSON.stringify(releve, null, 2)}\n`);
  console.log(`instantané écrit : ${releve.taux.length} taux, ${releve.droits.length} droits`);
} finally {
  await client.end();
}
