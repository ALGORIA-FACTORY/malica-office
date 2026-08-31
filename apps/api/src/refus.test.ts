/**
 * La frontière entre un refus rédigé et une fuite.
 *
 * Ce test vaut surtout pour ce qu'il INTERDIT. Renvoyer à l'appelant le message
 * d'une contrainte PostgreSQL non interceptée lui livrerait un nom de table et
 * un nom d'index ; le masquer tous lui retirerait les messages que nous avons
 * écrits pour lui. La règle doit donc trancher juste dans les deux sens, et
 * c'est ce qui se vérifie ici.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refusLisible } from "./refus.ts";

describe("refus lisible", () => {
  it("rend le message d'un refus écrit par un déclencheur", () => {
    // Ce que produit `raise exception ... using errcode = 'check_violation'` :
    // un code, un message, et aucun champ de localisation.
    const erreur = {
      code: "23514",
      message:
        "Le compte 411 (Clients) est un compte collectif : il reçoit des TIERS, pas des sous-comptes.",
    };
    assert.match(refusLisible(erreur) ?? "", /compte collectif/);
  });

  it("tait le message d'une contrainte détectée par PostgreSQL", () => {
    // Même code d'erreur, mais les champs de localisation sont peuplés : c'est
    // le moteur qui parle, et son message nomme un index.
    const erreur = {
      code: "23505",
      message:
        "la valeur d'une clé dupliquée rompt la contrainte unique « auxiliaires_tenant_id_nature_code_key »",
      constraint: "auxiliaires_tenant_id_nature_code_key",
      table: "auxiliaires",
    };
    assert.equal(refusLisible(erreur), null);
  });

  it("tait tout ce qui n'est pas un code de refus", () => {
    for (const code of ["42P01", "42601", "08006", "57014"]) {
      assert.equal(refusLisible({ code, message: "relation « x » n'existe pas" }), null, code);
    }
  });

  it("tait ce qui n'est pas une erreur PostgreSQL", () => {
    assert.equal(refusLisible(new Error("réseau")), null);
    assert.equal(refusLisible("chaîne"), null);
    assert.equal(refusLisible(null), null);
    assert.equal(refusLisible(undefined), null);
  });

  it("tait un refus sans message plutôt que de rendre une chaîne vide", () => {
    assert.equal(refusLisible({ code: "23514", message: "   " }), null);
    assert.equal(refusLisible({ code: "23514" }), null);
  });
});
