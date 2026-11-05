/**
 * Une sortie ne dépasse pas le stock (staging, 5 novembre 2026) : la porte
 * tient la règle du moteur du Socle, dans son ordre — la date, les entrées du
 * jour avant ses sorties, l'ordre d'inscription.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-sortie-ne-depasse-pas-le-stock.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite } from "./db.ts";

describe("une sortie ne dépasse pas le stock", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let article: string;

  const mouvement = (sens: "entree" | "sortie", at: string, quantite: number, cout?: number) =>
    sousIdentite(s.gens.amel.id, (db) =>
      db.query(
        `select public.stocks_mouvement_inscrire($1, $2, $3, $4::date, $5, $6, null, null)`,
        [s.pme, article, sens, at, quantite, cout ?? null],
      ),
    );

  before(async () => {
    s = await monterUneSociete(`stock-${Date.now()}`);
    const { rows } = await s.admin.query<{ id: string; stock: string; variation: string }>(
      `select id, account_stock as stock, account_variation as variation
         from ref.stock_categories where pack_version_id = $1 and code = 'marchandises'`,
      [s.pack],
    );
    const cat = rows[0]!;
    article = await sousIdentite(s.gens.amel.id, async (db) => {
      const r = await db.query<{ id: string }>(
        `select public.stocks_article_creer($1, null, $2, 'ART-1', 'Article d''essai', 'u',
                                            'cump', $3, $4, 'TND', $5) as id`,
        [s.pme, cat.id, cat.stock, cat.variation, s.pack],
      );
      return r.rows[0]!.id;
    });
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  it("refuse une sortie sur un stock vide", async () => {
    await assert.rejects(mouvement("sortie", "2026-10-01", 1), /refus\.stocks\.stock_insuffisant/);
  });

  it("accepte la sortie du jour couverte par l'entrée du même jour", async () => {
    await mouvement("entree", "2026-10-01", 2, 1);
    await mouvement("sortie", "2026-10-01", 2);
  });

  it("refuse une sortie antidatée, et celle qui dépasse ce qui reste", async () => {
    await mouvement("entree", "2026-10-05", 1, 1);
    await assert.rejects(mouvement("sortie", "2026-09-30", 1), /refus\.stocks\.stock_insuffisant/);
    await assert.rejects(mouvement("sortie", "2026-10-06", 2), /refus\.stocks\.stock_insuffisant/);
    await mouvement("sortie", "2026-10-06", 1);
  });
});
