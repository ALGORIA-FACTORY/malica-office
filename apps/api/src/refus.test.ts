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

import { introuvableLisible, refusLisible } from "./refus.ts";

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

  it("tait le message d'une contrainte détectée par PostgreSQL — sans taire le refus", () => {
    // Même code d'erreur, mais les champs de localisation sont peuplés : c'est
    // le moteur qui parle, et son message nomme un index. Depuis le 20 octobre
    // 2026, le doublon reste un refus lisible : notre phrase, pas la sienne.
    const erreur = {
      code: "23505",
      message:
        "la valeur d'une clé dupliquée rompt la contrainte unique « auxiliaires_tenant_id_nature_code_key »",
      constraint: "auxiliaires_tenant_id_nature_code_key",
      table: "auxiliaires",
    };
    assert.equal(refusLisible(erreur), "cet élément existe déjà");
    // Une autre violation détectée par le moteur reste tue.
    assert.equal(refusLisible({ ...erreur, code: "23503" }), null);
  });

  it("dit un refus de RLS sans nommer la table", () => {
    const rendu = refusLisible({
      code: "42501",
      message: 'new row violates row-level security policy for table "invitations"',
    });
    assert.equal(rendu, "ce geste ne vous est pas permis sur ce dossier");
  });

  it("un code « introuvable » d'un dépôt devient un 404 lisible, pas une panne", () => {
    assert.match(introuvableLisible(new Error("piece.not_found")) ?? "", /introuvable/);
    assert.match(introuvableLisible(new Error("organisation.introuvable")) ?? "", /introuvable/);
    assert.equal(introuvableLisible(new Error("réseau coupé")), null);
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

  describe("les refus que PostgreSQL rédige lui-même", () => {
    // Relevés le 4 octobre 2026 en ouvrant un cabinet : l'un et l'autre
    // rendaient « erreur interne » pour une faute de saisie.
    const ENUM_FR = {
      code: "22P02",
      message: "valeur en entrée invalide pour le enum app.validation_mode_t : « assistee »",
    };
    const ENUM_EN = {
      code: "22P02",
      message: 'invalid input value for enum app.validation_mode_t: "assistee"',
    };
    const CHEVAUCHEMENT = {
      code: "23P01",
      message:
        "la valeur d'une clé en conflit rompt la contrainte d'exclusion « fiches_sans_chevauchement »",
      constraint: "fiches_sans_chevauchement",
      table: "fiches_fiscales",
    };

    it("rend la valeur refusée, et elle seule", () => {
      assert.equal(refusLisible(ENUM_FR), "cette valeur n'est pas admise : « assistee »");
    });

    it("lit aussi la ponctuation anglaise : la locale du serveur n'est pas la nôtre", () => {
      assert.equal(refusLisible(ENUM_EN), "cette valeur n'est pas admise : « assistee »");
    });

    it("ne livre ni le schéma, ni le type, ni la contrainte", () => {
      for (const erreur of [ENUM_FR, ENUM_EN, CHEVAUCHEMENT]) {
        const rendu = refusLisible(erreur) ?? "";
        assert.doesNotMatch(rendu, /app\.|_t\b|fiches_sans_chevauchement|fiches_fiscales/, rendu);
      }
    });

    it("traduit un chevauchement bien que PostgreSQL ait nommé la contrainte", () => {
      // Le filtre `constraint || table || column` tairait ce message ; la
      // traduction passe avant lui, justement parce qu'elle n'en répète rien.
      assert.match(refusLisible(CHEVAUCHEMENT) ?? "", /couvre déjà cette période/);
    });

    it("se replie sur une phrase sans valeur quand il n'y en a pas à citer", () => {
      assert.equal(
        refusLisible({ code: "22P02", message: "entrée invalide" }),
        "une des valeurs envoyées n'est pas admise",
      );
    });
  });
});
