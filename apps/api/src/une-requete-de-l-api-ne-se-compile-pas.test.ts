/**
 * Une requête de l'API ne se compile pas à la volée (JIT).
 *
 * Trouvé le 31 octobre 2026 par la campagne Playwright de la PR #146 : la
 * liste des pièces du propriétaire (`capture.listAvecLecture`, dix pièces)
 * mettait 2 s, et l'écran de capture n'avait pas sa bande à temps. La cause :
 * les politiques RLS et les colonnes du circuit appellent des fonctions, dont
 * le coût ESTIMÉ (100 par appel et par ligne) dépasse `jit_above_cost` ;
 * PostgreSQL compilait alors la requête avec LLVM, à chaque appel — 1,9 s de
 * compilation pour 80 ms d'exécution. Ces requêtes sont courtes : la
 * compilation ne se rembourse jamais.
 *
 *   node --experimental-strip-types --test src/une-requete-de-l-api-ne-se-compile-pas.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { BASE_CONFIGUREE } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite } from "./db.ts";

describe("une requête de l'API ne se compile pas", { skip: !BASE_CONFIGUREE }, () => {
  after(() => fermerLePool());

  it("toute session du pool a le JIT éteint", async () => {
    const reglage = await sousIdentite("00000000-0000-0000-0000-000000000000", async (db) => {
      const { rows } = await db.query<{ jit: string }>("show jit");
      return rows[0]?.jit;
    });
    assert.equal(reglage, "off");
  });
});
