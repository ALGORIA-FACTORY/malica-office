/**
 * Le registre se vérifie : la base de travail porte-t-elle les objets que
 * produisent les migrations — pas seulement leur nombre ?
 *
 *   node --test db/registre.test.mjs        (dans `npm test`)
 *
 * Le 8 septembre 2026, `malica_local` a été « adoptée » : 93 migrations
 * inscrites sans être jouées. Six objets y sont restés d'une autre époque
 * pendant une semaine, invisibles à toute vérification qui comptait des
 * migrations. Ces tests font deux choses : prouver que la comparaison VOIT
 * une dérive (un droit retiré, une fonction réécrite, une colonne déplacée),
 * puis dire si la base de travail en a une.
 *
 * Ils montent une base jetable depuis les migrations sur le serveur de la
 * base de travail (`DATABASE_URL_ADMIN` d'apps/api/.env), et la suppriment.
 * Sans ce fichier — la CI, un poste sans base — ils sont sautés, et le disent.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import {
  comparerCatalogues,
  ecartsDuRegistre,
  lireCatalogue,
  monterBaseDesMigrations,
  urlDeTravail,
  versCatalogue,
} from "./registre.mjs";

const ligne = (genre, objet, definition) => ({ genre, objet, definition });

describe("la comparaison de catalogues", () => {
  const reference = versCatalogue([
    ligne("fonction", "a.f()", "corps 1"),
    ligne("relation", "a.t", "droits=x"),
    ligne("vue", "a.v", "select 1"),
  ]);

  it("nomme l'objet différent, l'objet absent et l'objet en trop", () => {
    const base = versCatalogue([
      ligne("fonction", "a.f()", "corps 2"),
      ligne("relation", "a.t", "droits=x"),
      ligne("index", "a.i", "create index"),
    ]);
    const { ecarts } = comparerCatalogues(base, reference, []);
    assert.deepEqual(ecarts.map((e) => `${e.cle} : ${e.nature}`).sort(), [
      "fonction a.f() : différent",
      "index a.i : en trop dans la base",
      "vue a.v : absent de la base",
    ]);
  });

  it("ne voit aucun écart entre deux catalogues égaux, fins de ligne comprises", () => {
    const base = versCatalogue([
      ligne("fonction", "a.f()", "corps 1"),
      ligne("relation", "a.t", "droits=x"),
      ligne("vue", "a.v", "select 1"),
    ]);
    const crlf = versCatalogue([ligne("vue", "a.v", "select\r\n1")]);
    assert.equal(comparerCatalogues(base, reference, []).ecarts.length, 0);
    assert.equal(crlf.get("vue a.v"), "select\n1");
  });

  it("met à part un écart accepté nommément, et signale une acceptation périmée", () => {
    const base = versCatalogue([
      ligne("fonction", "a.f()", "corps 2"),
      ligne("relation", "a.t", "droits=x"),
      ligne("vue", "a.v", "select 1"),
    ]);
    const acceptes = [
      { genre: "fonction", objet: "a.f()", raison: "essai", date: "2026-09-15" },
      { genre: "vue", objet: "a.v", raison: "plus constaté", date: "2026-09-15" },
    ];
    const r = comparerCatalogues(base, reference, acceptes);
    assert.equal(r.ecarts.length, 0);
    assert.deepEqual(
      r.acceptes.map((e) => e.cle),
      ["fonction a.f()"],
    );
    assert.deepEqual(
      r.perimes.map((a) => a.objet),
      ["a.v"],
    );
  });

  it("refuse un catalogue qui relève deux fois le même objet", () => {
    assert.throws(
      () => versCatalogue([ligne("vue", "a.v", "1"), ligne("vue", "a.v", "2")]),
      /deux fois/,
    );
  });
});

const TRAVAIL = urlDeTravail();

describe(
  "le registre de la base de travail",
  { skip: TRAVAIL ? false : "apps/api/.env absent : pas de base de travail" },
  () => {
    let jetable;
    let reference;

    before(async () => {
      jetable = await monterBaseDesMigrations(TRAVAIL);
      const client = new pg.Client({ connectionString: jetable.url });
      await client.connect();
      try {
        reference = await lireCatalogue(client);
      } finally {
        await client.end();
      }
    });

    after(async () => {
      await jetable?.supprimer();
    });

    it("dit les fichiers du dépôt, nom pour nom, empreinte pour empreinte", async () => {
      const client = new pg.Client({ connectionString: TRAVAIL });
      await client.connect();
      try {
        assert.deepEqual(await ecartsDuRegistre(client), [], "node db/migrer.mjs, puis relancer");
      } finally {
        await client.end();
      }
    });

    it("porte exactement les objets que produisent les migrations", async () => {
      const client = new pg.Client({ connectionString: TRAVAIL });
      await client.connect();
      let resultat;
      try {
        resultat = comparerCatalogues(await lireCatalogue(client), reference);
      } finally {
        await client.end();
      }
      assert.ok(resultat.objets > 3000, `catalogue anormalement court : ${resultat.objets} objets`);
      assert.deepEqual(
        resultat.ecarts.map((e) => `${e.cle} — ${e.nature}`),
        [],
        "la base de travail dérive des migrations : node db/registre.mjs pour le détail",
      );
      assert.deepEqual(
        resultat.perimes,
        [],
        "une acceptation de db/registre.mjs n'est plus constatée : la retirer",
      );
    });

    // En dernier : ce test abîme la base jetable pour prouver que la comparaison le voit.
    it("voit un droit retiré, une fonction réécrite et une colonne déplacée", async () => {
      const client = new pg.Client({ connectionString: jetable.url });
      await client.connect();
      try {
        await client.query("revoke delete on capture.token_plan from authenticated");
        await client.query(`create or replace function legal.entete_de_fragment(
          p_corpus text, p_numero text, p_edition int, p_source text, p_statut text)
        returns text language sql stable as $fn$ select 'une autre époque' $fn$`);
        await client.query(`drop view public.reglages_cabinet_v;
        alter table collab.reglages_cabinet drop column seuil_certitude_conseil;
        alter table collab.reglages_cabinet add column seuil_certitude_conseil numeric(3,2) not null default 0.80`);
        const { ecarts } = comparerCatalogues(await lireCatalogue(client), reference, []);
        const cles = new Set(ecarts.map((e) => e.cle));
        assert.ok(cles.has("relation capture.token_plan"), "droit retiré non vu");
        assert.ok(
          [...cles].some((c) => c.startsWith("fonction legal.entete_de_fragment(")),
          "fonction réécrite non vue",
        );
        assert.ok(
          cles.has("colonne collab.reglages_cabinet.mise_en_route_terminee_le"),
          "colonne déplacée non vue",
        );
        assert.ok(cles.has("vue public.reglages_cabinet_v"), "vue retirée non vue");
      } finally {
        await client.end();
      }
    });
  },
);
