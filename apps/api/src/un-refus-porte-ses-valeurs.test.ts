/**
 * Un refus porte ses valeurs, et l'écran les relit telles quelles.
 *
 * La base lève une CLÉ (« refus.plan.compte_collectif ») ; les valeurs qu'elle
 * cite la suivent, encodées par `app.refus_avec_valeurs` comme une requête
 * d'URL, et l'écran les relit par `lireUnRefus` (`@malica/socle/refus-a-dire`).
 * Les deux côtés doivent s'entendre octet pour octet : un libellé de compte qui
 * porte « & », « = », « + » ou « % » couperait sinon la requête, et la phrase
 * citerait une valeur fausse.
 *
 *   node --experimental-strip-types --test src/un-refus-porte-ses-valeurs.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { lireUnRefus } from "@malica/socle/refus-a-dire";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

describe("un refus porte ses valeurs", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;

  before(() => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  });

  after(async () => {
    await pool.end();
  });

  const encoder = async (...paires: (string | null)[]) => {
    const { rows } = await pool.query<{ m: string }>(
      `select app.refus_avec_valeurs('refus.plan.compte_collectif', variadic $1::text[]) as m`,
      [paires],
    );
    return rows[0]!.m;
  };

  it("relit chaque valeur à l'identique, quels que soient ses caractères", async () => {
    const valeurs = {
      compte: "401",
      libelle: "Fournisseurs & co + 5% = « effets » / الموردون",
      espaces: "  deux  espaces  ",
    };
    const message = await encoder(...Object.entries(valeurs).flat());
    assert.deepEqual(lireUnRefus(message), { cle: "refus.plan.compte_collectif", valeurs });
  });

  it("dit une valeur absente vide, sans perdre la clé", async () => {
    const message = await encoder("compte", null);
    assert.deepEqual(lireUnRefus(message), {
      cle: "refus.plan.compte_collectif",
      valeurs: { compte: "" },
    });
  });
});
