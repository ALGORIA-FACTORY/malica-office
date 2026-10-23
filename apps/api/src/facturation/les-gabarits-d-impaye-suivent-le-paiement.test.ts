/**
 * Les gabarits de notification en vigueur (23 octobre 2026).
 *
 * R4 : aucun code devise écrit dans un texte — la devise passe en variable,
 * comme le montant. Et une notification POUSSÉE arrive dans l'application
 * Android : elle ne vend rien (aucune offre à prendre). Chaque gabarit
 * d'impayé parle les trois langues.
 *
 *   node --experimental-strip-types --test src/facturation/les-gabarits-d-impaye-suivent-le-paiement.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

/** La dernière version en vigueur de chaque gabarit, par canal et langue. */
const EN_VIGUEUR = `
  select distinct on (code, canal, locale) code, canal, locale,
         coalesce(sujet, '') || ' ' || titre || ' ' || corps || ' ' || coalesce(action_libelle, '') as texte
    from notif.gabarits
   where effective_from <= current_date
   order by code, canal, locale, effective_from desc`;

describe("les gabarits en vigueur", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("n'écrivent aucun code devise : la devise est une variable", async () => {
    const { rows: devises } = await pool!.query<{ code: string }>("select code from ref.devises");
    const { rows } = await pool!.query<{ code: string; locale: string; texte: string }>(EN_VIGUEUR);
    const fautes = rows.flatMap((g) =>
      devises
        .filter((d) => new RegExp(`\\b${d.code}\\b`).test(g.texte))
        .map((d) => `${g.code}/${g.locale} : ${d.code}`),
    );
    assert.deepEqual(fautes, []);
  });

  it("une notification poussée ne propose pas d'offre", async () => {
    const { rows } = await pool!.query<{ code: string; texte: string }>(
      `select code, texte from (${EN_VIGUEUR}) g where canal = 'push'`,
    );
    assert.deepEqual(
      rows.filter((g) => g.texte.includes("{{offre_suivante}}")).map((g) => g.code),
      [],
    );
  });

  it("chaque gabarit d'impayé existe en français, en anglais et en arabe", async () => {
    const { rows } = await pool!.query<{ code: string; locales: string }>(
      `select code, string_agg(locale, ',' order by locale) as locales
         from (${EN_VIGUEUR}) g where code like 'impaye.%' group by code`,
    );
    assert.ok(rows.length > 0);
    for (const g of rows) assert.equal(g.locales, "ar,en,fr", g.code);
  });
});
