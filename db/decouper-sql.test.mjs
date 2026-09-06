/**
 * Le découpeur envoie une instruction à la fois : un point-virgule dans une
 * chaîne, un commentaire ou un corps de fonction n'en est pas la fin.
 *
 *   node --test db/decouper-sql.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { decouperSql } from "./decouper-sql.mjs";

test("deux instructions simples", () => {
  assert.deepEqual(decouperSql("select 1;\nselect 2;"), ["select 1", "select 2"]);
});

test("un point-virgule dans une chaîne reste dans la chaîne", () => {
  assert.deepEqual(decouperSql("insert into t values ('a;b');"), ["insert into t values ('a;b')"]);
});

test("une apostrophe doublée n'ouvre ni ne ferme rien", () => {
  assert.deepEqual(decouperSql("select 'l''été;';"), ["select 'l''été;'"]);
});

test("un commentaire de ligne ou de bloc ne coupe pas", () => {
  assert.deepEqual(decouperSql("select 1 -- pas ici ; non\n; /* ni ; là */ select 2;"), [
    "select 1 -- pas ici ; non",
    "/* ni ; là */ select 2",
  ]);
});

test("un corps de fonction entre $$ ou $tag$ reste entier", () => {
  const fonction =
    "create function f() returns void as $$ begin perform 1; end; $$ language plpgsql";
  const etiquetee =
    "create function g() returns void as $corps$ begin perform 2; end; $corps$ language plpgsql";
  assert.deepEqual(decouperSql(`${fonction};\n${etiquetee};`), [fonction, etiquetee]);
});

test("une instruction faite seulement de commentaires n'existe pas", () => {
  assert.deepEqual(decouperSql("-- rien\n/* rien */\n;\nselect 1;\n-- fin"), ["select 1"]);
});

test("la dernière instruction n'a pas besoin de point-virgule", () => {
  assert.deepEqual(decouperSql("select 1;\nselect 2"), ["select 1", "select 2"]);
});
