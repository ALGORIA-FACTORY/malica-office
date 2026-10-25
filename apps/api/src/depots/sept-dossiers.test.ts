/**
 * Sept dossiers, les mêmes de la capture à la bibliothèque.
 *
 * Maquette validée par Wissem le 25 octobre 2026. L'épreuve tient ce que les
 * écrans supposent : sept dossiers dans l'ordre, chaque type rangé dans l'un
 * d'eux, le type par défaut de chaque dossier proposé à la capture (donc
 * accepté par une correction), et un nom dans chaque langue.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/depots/sept-dossiers.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

interface Dossier {
  code: string;
  libelle: string;
  teinte: string;
  periode: string;
  typeParDefaut: string;
}
interface Type {
  code: string;
  proposeALaCapture: boolean;
  dossier: string;
  dossierSiVente: string | null;
}

describe("sept dossiers", { skip: !BASE_CONFIGUREE }, () => {
  let personne: Utilisateur;

  before(async () => {
    const u = await creerCompte(`dossiers-${Date.now()}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u, "le compte doit être créé");
    personne = u;
  });

  after(async () => {
    await fermerLePool();
  });

  const lire = <T>(methode: string, locale: string) =>
    sousIdentiteDuServeur(
      personne.id,
      async (db) =>
        (await executerRpc(db, { depot: "referentiel", methode, args: [locale] })) as T[],
    );

  it("sept, dans l'ordre validé", async () => {
    const dossiers = await lire<Dossier>("dossiers", "fr");
    assert.deepEqual(
      dossiers.map((d) => d.libelle),
      [
        "Achats",
        "Ventes",
        "Banque",
        "Tickets et reçus",
        "Gouvernance",
        "Fiscal et social",
        "Autres",
      ],
    );
    assert.deepEqual(
      dossiers.map((d) => d.periode),
      ["mois", "mois", "mois", "mois", "annee", "annee", "mois"],
    );
    assert.equal(new Set(dossiers.map((d) => d.teinte)).size, 7, "une teinte par dossier");
  });

  it("chaque type est rangé, et le type de chaque dossier se choisit à la capture", async () => {
    const dossiers = await lire<Dossier>("dossiers", "fr");
    const types = await lire<Type>("typesDeDocument", "fr");
    const codes = new Set(dossiers.map((d) => d.code));
    for (const t of types) {
      assert.ok(codes.has(t.dossier), `${t.code} doit appartenir à un dossier`);
      if (t.dossierSiVente) assert.ok(codes.has(t.dossierSiVente));
    }
    const proposes = types.filter((t) => t.proposeALaCapture).map((t) => t.code);
    assert.deepEqual(
      [...proposes].sort(),
      dossiers.map((d) => d.typeParDefaut).sort(),
      "la capture propose exactement le type par défaut de chaque dossier",
    );
    for (const d of dossiers) {
      const t = types.find((x) => x.code === d.typeParDefaut);
      assert.equal(t?.dossier, d.code, `le type par défaut de ${d.code} doit y être rangé`);
    }
  });

  it("un nom dans chaque langue, jamais le code", async () => {
    for (const locale of ["en", "ar"]) {
      const dossiers = await lire<Dossier>("dossiers", locale);
      for (const d of dossiers) assert.notEqual(d.libelle, d.code, `${d.code} en ${locale}`);
    }
  });
});
