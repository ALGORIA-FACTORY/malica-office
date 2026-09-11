import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { valeursNonReproductibles } from "./reproductibilite.mjs";

/**
 * R11 — une migration donne le même référentiel, quel que soit le jour où on la joue.
 *
 * Trouvé le 11 septembre 2026 en comparant `ref` à une base vierge, sous deux
 * formes :
 *   - écrite : la migration 20260826163000 clôt un tarif par
 *     `effective_to = current_date` ;
 *   - cachée : la migration 20260824132104 sème `ref.rejet_motifs` sans
 *     donner `valid_from`, dont le défaut est `current_date` — la date du jour
 *     où l'on joue la migration entre dans le référentiel sans être écrite
 *     nulle part.
 * Jouées le 31 août sur un poste et le 11 septembre sur un autre, elles
 * donnent deux contenus. Or la base de test et le témoin vierge supposent
 * exactement le contraire : que le dépôt décrit une base, et une seule.
 */

const jetons = (sql) => valeursNonReproductibles(sql).map((x) => x.jeton);

describe("valeursNonReproductibles — ce qui est refusé", () => {
  it("une date du jour écrite dans une table du référentiel", () => {
    const v = valeursNonReproductibles(
      "insert into ref.tva_rates (code, valid_from) values ('TVA_7', current_date);",
    );
    assert.deepEqual(
      v.map((x) => [x.table, x.jeton]),
      [["ref.tva_rates", "current_date"]],
    );
  });

  it("une clôture de tarif datée du jour où l'on joue la migration", () => {
    const v = valeursNonReproductibles(
      "update agents.model_pricing set effective_to = current_date where model = 'x';",
    );
    assert.equal(v.length, 1);
  });

  it("now(), random() et gen_random_uuid() au même titre", () => {
    const sql = [
      "insert into ref.labels (id, value) values (gen_random_uuid(), 'a');",
      "update ref.socle_params set value_num = random() where code = 'x';",
      "insert into storage.buckets (id, name, created_at) values ('b', 'b', now());",
    ].join("\n");
    assert.deepEqual(jetons(sql), ["gen_random_uuid()", "random()", "now()"]);
  });

  it("un bloc DO qui écrit dans le référentiel", () => {
    const v = valeursNonReproductibles(
      "do $$ begin insert into ref.mentions (code, valid_from) values ('m', current_date); end $$;",
    );
    assert.deepEqual(
      v.map((x) => x.table),
      ["ref.mentions"],
    );
  });

  it("la forme cachée : une insertion qui laisse une colonne prendre son défaut daté", () => {
    const sql = [
      "create table if not exists ref.rejet_motifs (",
      "  id uuid primary key default gen_random_uuid(),",
      "  code text not null,",
      "  valid_from date not null default current_date",
      ");",
      "insert into ref.rejet_motifs (code) values ('PIECE_ILLISIBLE');",
    ].join("\n");
    assert.deepEqual(
      valeursNonReproductibles(sql).map((x) => [x.table, x.jeton]),
      [["ref.rejet_motifs", "défaut de valid_from"]],
    );
  });

  it("la forme cachée, quand la colonne datée est ajoutée plus tard", () => {
    const sql = [
      "create table ref.x (code text);",
      "alter table ref.x add column valid_from date not null default current_date;",
      "insert into ref.x (code) values ('a');",
    ].join("\n");
    assert.equal(valeursNonReproductibles(sql).length, 1);
  });

  it("la forme cachée, d'une migration à la suivante", () => {
    const defauts = new Map();
    valeursNonReproductibles(
      "create table ref.x (code text, valid_from date default current_date);",
      defauts,
    );
    assert.equal(
      valeursNonReproductibles("insert into ref.x (code) values ('a');", defauts).length,
      1,
    );
  });
});

describe("valeursNonReproductibles — ce qui reste permis", () => {
  it("une donnée métier datée du jour : ce n'est pas du référentiel", () => {
    assert.deepEqual(
      valeursNonReproductibles("update capture.pieces set updated_at = now() where id = 'x';"),
      [],
    );
  });

  it("un défaut de colonne : c'est le schéma, pas une donnée", () => {
    assert.deepEqual(
      valeursNonReproductibles(
        "create table ref.x (id uuid default gen_random_uuid(), created_at timestamptz default now());",
      ),
      [],
    );
  });

  it("une insertion qui laisse un identifiant ou un horodatage à leur défaut", () => {
    const sql = [
      "create table ref.x (id uuid default gen_random_uuid(), code text, created_at timestamptz default now());",
      "insert into ref.x (code) values ('a');",
    ].join("\n");
    assert.deepEqual(valeursNonReproductibles(sql), []);
  });

  it("une insertion qui donne la colonne datée", () => {
    const sql = [
      "create table ref.x (code text, valid_from date not null default current_date);",
      "insert into ref.x (code, valid_from) values ('a', date '2026-01-01');",
    ].join("\n");
    assert.deepEqual(valeursNonReproductibles(sql), []);
  });

  it("le corps d'une fonction : il s'exécute plus tard, pas pendant la migration", () => {
    assert.deepEqual(
      valeursNonReproductibles(
        "create or replace function f() returns void language sql as $$ insert into ref.labels (value) values (now()::text) $$;",
      ),
      [],
    );
  });

  it("une valeur littérale", () => {
    assert.deepEqual(
      valeursNonReproductibles(
        "insert into ref.tva_rates (code, valid_from) values ('TVA_19', date '2026-01-01');",
      ),
      [],
    );
  });
});

describe("les migrations du dépôt", () => {
  /**
   * Les exceptions ACQUISES : des migrations déjà appliquées, qu'on ne réécrit
   * pas (une migration se corrige par une migration nouvelle). Elles sont
   * nommées une par une, avec leur nombre d'instructions fautives ; toute
   * autre violation fait échouer ce test. Défauts connus, consignés dans
   * AGENTS.md (R11) et docs/verification-referentiel.md.
   */
  const ACQUISES = {
    // ref.rejet_motifs semé sans valid_from : son défaut current_date s'applique.
    "20260824132104_dcac6c1d-10f5-4eef-a0e5-8b3965864670.sql": 1,
    // Clôt le tarif Gemini et date le tarif pdf-text du jour où on la joue.
    "20260826163000_tarifs_lecture_apres_bascule_qwen.sql": 2,
  };

  it("aucune n'écrit dans le référentiel une valeur qui dépend du jour ou du hasard", () => {
    const dossier = join(dirname(fileURLToPath(import.meta.url)), "migrations");
    // Dans l'ordre d'application : un défaut posé par une migration vaut pour
    // les insertions des suivantes.
    const defauts = new Map();
    const trouvees = {};
    for (const f of readdirSync(dossier)
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const v = valeursNonReproductibles(readFileSync(join(dossier, f), "utf8"), defauts);
      if (v.length) trouvees[f] = v.length;
    }
    assert.deepEqual(trouvees, ACQUISES);
  });
});
