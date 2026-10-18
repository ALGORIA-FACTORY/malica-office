/**
 * L'état d'une licence s'affiche en mots, et la base dit lesquels.
 *
 * ==================================================================== LE DÉFAUT
 *
 * 18 octobre 2026 : l'écran des réglages imprimait `f.statut` tel quel sous
 * « État de la licence » — `active`, `suspendue`, `resiliee`. Le spécialiste
 * des langues a refusé de le traduire, et il avait raison : `champ-lisible.ts`
 * note que ces codes ne forment pas une énumération fermée du côté de l'écran
 * (`lecture_autorisee` compose `'licence_' || statut`), et inventer la table
 * dans le code aurait été la constante que R4 interdit.
 *
 * Or la base, elle, SAIT. `facturation.licences` porte
 * `check (statut in ('active','suspendue','resiliee'))` : l'énumération est
 * fermée là où elle est écrite. Il ne restait qu'à la lire et à poser ses
 * libellés dans le référentiel, comme les motifs de rejet le sont depuis le
 * 24 août 2026.
 *
 * ================================================================ CE QU'ON TIENT
 *
 * L'épreuve ne recopie PAS la liste des trois statuts : elle la relève dans la
 * contrainte `check` elle-même. Le jour où un quatrième statut y entre sans son
 * libellé, elle rougit — ce qui est tout l'intérêt. Une liste recopiée ici
 * serait un second endroit où la vérité vit, donc un endroit où elle se périme.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { facturation } from "./depots/facturation.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

/** Les valeurs d'une contrainte `check (colonne in (…))`, relevées dans le catalogue. */
async function valeursDuCheck(pool: pg.Pool, table: string, colonne: string) {
  const { rows } = await pool.query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def
       from pg_constraint
      where conrelid = $1::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%' || $2 || '%'
        and pg_get_constraintdef(oid) like '%ANY (ARRAY[%'`,
    [table, colonne],
  );
  const def = rows.find((r) => new RegExp(`\\(${colonne}\\s*=\\s*ANY`).test(r.def))?.def;
  assert.ok(def, `aucune contrainte d'énumération sur ${table}.${colonne}`);
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!).sort();
}

describe("les libellés des statuts de licence", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  });

  after(async () => {
    await pool.end();
  });

  for (const [colonne, ns] of [
    ["statut", "licence_statut"],
    ["motif_suspension", "licence_motif_suspension"],
  ] as const) {
    it(`chaque valeur de ${colonne} a son libellé en fr, en et ar`, async () => {
      const attendues = await valeursDuCheck(pool, "facturation.licences", colonne);
      assert.ok(attendues.length > 0);

      const { rows } = await pool.query<{ key: string; locales: string[] }>(
        `select key, array_agg(locale order by locale) as locales
           from ref.labels where ns = $1 group by key order by key`,
        [ns],
      );
      const dits = new Map(rows.map((r) => [r.key, r.locales]));

      const manquants: string[] = [];
      for (const code of attendues) {
        const locales = dits.get(code);
        if (!locales) manquants.push(`${code} : aucun libellé`);
        else if (locales.join(",") !== "ar,en,fr")
          manquants.push(`${code} : ${locales.join(",")} seulement`);
      }
      assert.deepEqual(
        manquants,
        [],
        `un statut sans libellé s'affiche en code brut sous « État de la licence »`,
      );

      // L'inverse compte autant : un libellé pour un code que la base n'émet
      // plus est un mot qui ne sera jamais lu, et R9 l'interdit.
      const orphelins = [...dits.keys()].filter((k) => !attendues.includes(k));
      assert.deepEqual(orphelins, [], "un libellé sans statut correspondant est mort");
    });
  }

  it("le dépôt rend la liste traduite, et se replie sur le français", async () => {
    const client = await pool.connect();
    try {
      const ar = await facturation.libellesDesStatuts(client, "ar");
      const attendues = await valeursDuCheck(pool, "facturation.licences", "statut");
      assert.deepEqual(
        ar.statuts.map((s) => s.code).sort(),
        attendues,
        "le dépôt rend exactement ce que la base accepte",
      );
      for (const s of ar.statuts) {
        assert.ok(s.libelle.trim().length > 0);
        assert.notEqual(s.libelle, s.code, "un code brut n'est pas un libellé");
      }

      // Une locale que le référentiel ne porte pas : le français s'affiche, et
      // l'écran ne se vide pas. Le repli est EXPLICITE, il n'est pas implicite —
      // il ne choisit pas une juridiction, il choisit une langue de secours.
      const inconnue = await facturation.libellesDesStatuts(client, "it");
      const fr = await facturation.libellesDesStatuts(client, "fr");
      assert.deepEqual(inconnue.statuts, fr.statuts);
    } finally {
      client.release();
    }
  });
});
