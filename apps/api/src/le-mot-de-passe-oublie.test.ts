/**
 * Le mot de passe oublié (20 octobre 2026).
 *
 * Un lien, une heure, une fois. Le nouveau mot de passe ouvre le compte,
 * l'ancien ne l'ouvre plus, et les sessions longues du compte tombent.
 *
 *   node --experimental-strip-types --test src/le-mot-de-passe-oublie.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import {
  creerCompte,
  demanderReinitialisation,
  emettreJetonDeRafraichissement,
  rafraichir,
  reinitialiser,
  verifierCompte,
} from "./auth.ts";
import { courrielReinitialisation } from "./courriel/reinitialisation.ts";
import { fermerLePool } from "./db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le mot de passe oublié", { skip: !BASE_CONFIGUREE }, () => {
  const email = `oubli-${Date.now()}@essai.local`;
  const ancien = "AncienMotDePasse2026!";
  const nouveau = "NouveauMotDePasse2026!";

  after(async () => {
    const admin = process.env["DATABASE_URL_ADMIN"];
    if (admin) {
      const pool = new pg.Pool({ connectionString: admin });
      try {
        await pool.query(`delete from auth.users where email = $1`, [email]);
      } finally {
        await pool.end();
      }
    }
    await fermerLePool();
  });

  it("une adresse inconnue ne produit aucun lien", async () => {
    assert.equal(await demanderReinitialisation(`inconnu-${Date.now()}@essai.local`), null);
  });

  it("le lien change le mot de passe une fois, et fait tomber les sessions longues", async () => {
    const compte = await creerCompte(email, ancien);
    assert.ok(compte);
    const long = await emettreJetonDeRafraichissement(compte, "essai/1");

    const demande = await demanderReinitialisation(email.toUpperCase());
    assert.ok(demande);
    assert.equal(demande.email, email);

    const ouvert = await reinitialiser(demande.secret, nouveau);
    assert.equal(ouvert?.id, compte.id);

    assert.equal(await verifierCompte(email, ancien), null, "l'ancien mot de passe n'ouvre plus");
    assert.equal((await verifierCompte(email, nouveau))?.id, compte.id);
    assert.equal(await rafraichir(long, "essai/1"), null, "la session longue est tombée");
    assert.equal(await reinitialiser(demande.secret, "EncoreUnAutre2026!"), null, "une seule fois");
  });

  it("un secret inconnu ne change rien", async () => {
    assert.equal(await reinitialiser("x".repeat(43), nouveau), null);
  });
});

describe("le courriel du mot de passe oublié", () => {
  it("porte le lien, échappé, et le dit en texte", () => {
    const c = courrielReinitialisation("https://exemple.test/reinitialiser#abc&def");
    assert.ok(c.html.includes("https://exemple.test/reinitialiser#abc&amp;def"));
    assert.ok(c.texte.includes("https://exemple.test/reinitialiser#abc&def"));
    assert.throws(() => courrielReinitialisation("javascript:alert(1)"));
  });
});
