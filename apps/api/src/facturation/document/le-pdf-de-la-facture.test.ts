/**
 * Le PDF de la facture — rendu par le vrai chemin, relu par le premier
 * lecteur de Malica (la couche de texte).
 *
 *   * il est DÉTERMINISTE : mêmes données, mêmes octets (l'empreinte inscrite
 *     à l'émission se vérifie en rendant de nouveau) ;
 *   * il se LIT : numéro, rubriques, montants aux espaces fines, dans la
 *     langue demandée, arabe compris, sans glyphe perdu ;
 *   * il porte ses polices, et se pagine quand les lignes débordent ;
 *   * l'empreinte s'inscrit une fois, et l'original déclenche le courriel.
 *
 * Une facture fictive est émise dans une transaction annulée
 * (`scenario-d-exemple.ts`). Les PDF d'exemple de docs/facturation/exemples
 * viennent du même scénario (`outils/factures-d-exemple.mjs`).
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { readPdfTextLayer } from "../../malica/lecture/pdf-text.ts";
import type { DocumentDeFacture, Langue } from "./document.ts";
import { empreinte, GABARIT_DU_RENDU, montant, rendreLaFacture } from "./rendu.ts";
import { emettreUneFactureDExemple } from "./scenario-d-exemple.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

async function aBlanc<T>(corps: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    return await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

const texte = async (pdf: Buffer) => {
  const couche = await readPdfTextLayer(new Uint8Array(pdf));
  return { couche, mots: couche.tokens.map((t) => t.text).join(" ") };
};

describe("le montant d'une facture", () => {
  it("espaces fines entre les milliers, décimales de la devise, vrai signe moins", () => {
    const dinar = { exposant: 3, separateur: "," };
    assert.equal(montant(1234567.5, dinar), "1 234 567,500");
    assert.equal(montant(-6.8, dinar), "−6,800");
    assert.equal(montant(0, dinar), "0,000");
    assert.equal(montant(1999.9995, { exposant: 2, separateur: "." }), "2 000.00");
    assert.equal(montant(12000, { exposant: 0, separateur: "," }), "12 000");
  });
});

describe("le PDF de la facture", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  for (const langue of ["fr", "en", "ar"] as const satisfies readonly Langue[]) {
    it(`en ${langue} : déterministe, lisible, ses montants et ses rubriques`, async () => {
      await aBlanc(async (db) => {
        const exemple = await emettreUneFactureDExemple(db);
        const d = await exemple.documents(langue, "facture");
        const un = rendreLaFacture(d, { lienPaiement: "https://app.essai.local/pme/reglages" });
        const deux = rendreLaFacture(d, { lienPaiement: "https://app.essai.local/pme/reglages" });
        assert.equal(empreinte(un), empreinte(deux), "mêmes données, mêmes octets");
        assert.equal(un.subarray(0, 5).toString(), "%PDF-");
        assert.ok(un.toString("latin1").includes("/FontFile2"), "les polices sont embarquées");

        const { couche, mots } = await texte(un);
        assert.equal(couche.pages, 1);
        // L'arabe s'IMPRIME juste (formes liées, droite à gauche, miroir) ; sa
        // couche de texte, elle, perd les formes contextuelles : Skia n'écrit
        // pas de correspondance Unicode pour un glyphe lié (Chromium non plus,
        // 31 octobre 2026). Malica relit donc une facture arabe en image ; le
        // numéro et les montants, en chiffres latins, restent dans le texte.
        if (langue !== "ar") {
          assert.deepEqual(couche.pagesSansUnicode, [], "aucun glyphe sans correspondance Unicode");
        }
        assert.ok(mots.includes(d.facture.numero), "le numéro");
        assert.ok(mots.includes(d.facture.destinataire_nom.split(" ")[0]!), "le client");
        const ttc = montant(Number(d.facture.montant_ttc), d.devise!);
        assert.ok(
          mots.replaceAll(" ", "").includes(ttc.replaceAll(" ", "")),
          `le total TTC ${ttc}`,
        );
        if (langue !== "ar") {
          for (const r of ["total_ttc", "reste_a_payer", "droit_de_timbre"]) {
            const premier = d.rubriques[r]!.split(" ")[0]!;
            assert.ok(mots.includes(premier), `la rubrique ${r} (${premier})`);
          }
        }
      });
    });
  }

  it("un avoir se rend avec sa facture d'origine et son motif", async () => {
    await aBlanc(async (db) => {
      const exemple = await emettreUneFactureDExemple(db);
      const d = await exemple.documents("fr", "avoir");
      assert.equal(d.facture.nature, "avoir");
      const { mots } = await texte(rendreLaFacture(d, { lienPaiement: null }));
      assert.ok(mots.includes(d.avoir_de!.numero), "la facture d'origine");
      assert.ok(mots.includes(d.facture.numero), "le numéro de l'avoir");
    });
  });

  it("des lignes qui débordent se paginent, et chaque page dit son rang", async () => {
    await aBlanc(async (db) => {
      const exemple = await emettreUneFactureDExemple(db);
      const d = await exemple.documents("fr", "facture");
      const longue: DocumentDeFacture = {
        ...d,
        lignes: Array.from({ length: 70 }, (_, i) => ({
          ...d.lignes[i % d.lignes.length]!,
          ordinal: i + 1,
        })),
      };
      const { couche, mots } = await texte(rendreLaFacture(longue, { lienPaiement: null }));
      assert.ok(couche.pages >= 3, `${couche.pages} pages`);
      const derniere = d.rubriques["page"]!.replace("{n}", String(couche.pages))
        .replace("{total}", String(couche.pages))
        .split(" ")
        .at(-1)!;
      assert.ok(mots.includes(derniere));
    });
  });

  it("l'empreinte de l'original s'inscrit une fois ; l'original pose le courriel de la facture", async () => {
    await aBlanc(async (db) => {
      const exemple = await emettreUneFactureDExemple(db);
      const d = await exemple.documents("fr", "facture");
      const pdf = rendreLaFacture(d, { lienPaiement: null });
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [exemple.operateur]);
      const inscrire = () =>
        db
          .query<{ r: { version: number; deja: boolean; envois: number } }>(
            "select plateforme.document_inscrire($1, $2, $3, 'fr') as r",
            [exemple.facture, empreinte(pdf), GABARIT_DU_RENDU],
          )
          .then((r) => r.rows[0]!.r);
      const premier = await inscrire();
      assert.deepEqual([premier.version, premier.deja, premier.envois], [1, false, 1]);
      const second = await inscrire();
      assert.deepEqual(
        [second.version, second.deja],
        [1, true],
        "la même empreinte ne s'inscrit pas deux fois",
      );
      await db.query("reset role");
      const envoi = await db.query<{ code: string; canal: string; decision: string }>(
        `select e.code, e.canal, e.decision from facturation.facture_envois fe
           join notif.envois e on e.id = fe.envoi_id where fe.facture_id = $1`,
        [exemple.facture],
      );
      assert.deepEqual(envoi.rows, [
        { code: "facture.emise", canal: "email", decision: "a_remettre" },
      ]);
      // Le travailleur des courriels relit la même facture, par son envoi, sous
      // le rôle de l'API (qui ne lit pas le schéma de la facturation).
      const envoiId = (
        await db.query<{ id: string }>(
          "select envoi_id as id from facturation.facture_envois where facture_id = $1",
          [exemple.facture],
        )
      ).rows[0]!.id;
      await db.query("set local role malica_api");
      const jointe = await db.query<{ d: DocumentDeFacture | null }>(
        "select notif.facture_de_l_envoi($1) as d",
        [envoiId],
      );
      await db.query("reset role");
      assert.equal(
        empreinte(rendreLaFacture(jointe.rows[0]!.d!, { lienPaiement: null })),
        empreinte(pdf),
      );
    });
  });
});
