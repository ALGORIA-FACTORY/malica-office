/**
 * Un bloc de réponse s'exporte en classeur Excel, par la vraie route.
 *
 * La route met en forme la feuille que l'écran lui envoie : un tableur doit y
 * trouver des NOMBRES là où le bloc porte des montants, et du texte ailleurs.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { strFromU8, unzipSync } from "fflate";

import { emettreJeton } from "../../auth.ts";
import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "../../circuit-d-essai.ts";

describe("un bloc s'exporte en classeur", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let base = "";
  let jeton = "";
  let arret: (() => Promise<void>) | null = null;

  before(async () => {
    s = await monterUneSociete(`bloc-classeur-${Date.now()}`);
    jeton = emettreJeton(s.gens.amel, new Date());
    const { app } = await import("../../app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));
  });

  after(async () => {
    await arret?.();
    await s.fermer();
  });

  const exporter = (corps: unknown, avecJeton = true) =>
    fetch(`${base}/malica/blocs/classeur`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(avecJeton ? { authorization: `Bearer ${jeton}` } : {}),
      },
      body: JSON.stringify(corps),
    });

  const BLOC = {
    titre: "Achats par fournisseur",
    feuille: {
      entete: ["Fournisseur", "Montant TTC (TND)", "Pièces"],
      lignes: [
        [{ texte: "Sismara & Fils <SA>" }, { montant: "7872.677" }, { montant: "2" }],
        [{ texte: "Electro Import" }, { montant: "4999.000" }, { montant: "1" }],
      ],
      totaux: [[{ texte: "Total" }, { montant: "12871.677" }, { montant: "3" }]],
    },
  };

  it("rend un vrai classeur : les montants en nombres, le texte échappé, le total", async () => {
    const r = await exporter(BLOC);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /spreadsheetml\.sheet/);
    const fichiers = unzipSync(new Uint8Array(await r.arrayBuffer()));
    const feuille = strFromU8(fichiers["xl/worksheets/sheet1.xml"]!);
    assert.match(strFromU8(fichiers["xl/workbook.xml"]!), /name="Achats par fournisseur"/);
    // Un montant est une valeur numérique, à ses décimales ; jamais une chaîne.
    assert.match(feuille, /<v>7872\.677<\/v>/);
    assert.match(feuille, /<v>12871\.677<\/v>/);
    assert.match(feuille, /Sismara &amp; Fils &lt;SA&gt;/);
    assert.match(feuille, /Fournisseur/);
  });

  it("une feuille en arabe se lit de droite à gauche", async () => {
    const r = await exporter({ ...BLOC, titre: "المشتريات", droiteAGauche: true });
    assert.equal(r.status, 200);
    const fichiers = unzipSync(new Uint8Array(await r.arrayBuffer()));
    assert.match(strFromU8(fichiers["xl/worksheets/sheet1.xml"]!), /rightToLeft="1"/);
  });

  it("refuse sans identité, et refuse ce qui n'est pas une feuille", async () => {
    assert.equal((await exporter(BLOC, false)).status, 401);
    for (const mauvais of [
      {},
      { titre: "x", feuille: { entete: [], lignes: [] } },
      { titre: "x", feuille: { entete: ["a"], lignes: [[{ montant: "=1+1" }]] } },
      { titre: "x", feuille: { entete: ["a"], lignes: [[{ texte: "a", montant: "1" }]] } },
      { titre: "x".repeat(200), feuille: { entete: ["a"], lignes: [] } },
    ]) {
      const r = await exporter(mauvais);
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { erreur: "refus.saisie.mal_formee" });
    }
  });
});
