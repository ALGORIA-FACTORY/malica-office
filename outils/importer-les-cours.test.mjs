/**
 * L'import des cours de change lit le fichier de l'exploitation sans rien
 * deviner : tout ou rien, chaque faute avec son numéro de ligne.
 *
 *   node --test outils/importer-les-cours.test.mjs
 *
 * Les cours ci-dessous sont FICTIFS : ce sont des valeurs de forme.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { lireLesCours } from "./importer-les-cours.mjs";

const ENTETE = "date,devise,vers_devise,taux,unite,source";

test("un fichier juste se lit tel quel, taux en chaîne, unité en nombre", () => {
  const { cours, fautes } = lireLesCours(
    `﻿${ENTETE}\r\n2026-09-10,EUR,TND,3.3456,1,BCT\r\n2026-09-10,JPY,TND,20.1234,1000,BCT\r\n\r\n`,
  );
  assert.deepEqual(fautes, []);
  assert.deepEqual(cours, [
    { date: "2026-09-10", devise: "EUR", versDevise: "TND", taux: "3.3456", unite: 1, source: "BCT" },
    { date: "2026-09-10", devise: "JPY", versDevise: "TND", taux: "20.1234", unite: 1000, source: "BCT" },
  ]);
});

test("chaque ligne fautive est nommée, et le fichier ne s'importe pas à moitié", () => {
  const { fautes } = lireLesCours(
    [
      ENTETE,
      "2026-02-30,EUR,TND,3.3,1,BCT",
      "2026-09-10,eur,TND,3.3,1,BCT",
      "2026-09-10,TND,TND,1,1,BCT",
      "2026-09-10,EUR,TND,3,3456,1,BCT",
      "2026-09-10,EUR,TND,3.3,1,BCT,en trop",
      "2026-09-10,EUR,TND,0.000,1,BCT",
      "2026-09-10,EUR,TND,3.3,12,BCT",
      "2026-09-10,EUR,TND,3.3,1,bct",
      "2026-09-10,EUR,TND,3.3,1,BCT",
    ].join("\n"),
  );
  assert.deepEqual(
    fautes.map((f) => f.split(" : ")[0]),
    ["ligne 2", "ligne 3", "ligne 4", "ligne 5", "ligne 6", "ligne 7", "ligne 8", "ligne 9"],
  );
});

test("un fichier sans l'en-tête attendu ne se lit pas", () => {
  const { cours, fautes } = lireLesCours("date;devise;taux\n2026-09-10;EUR;3.3\n");
  assert.deepEqual(cours, []);
  assert.equal(fautes.length, 1);
  assert.match(fautes[0], /^ligne 1 : en-tête attendu/);
});
