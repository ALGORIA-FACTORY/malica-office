/**
 * Une ligne de relevé règle sa facture (recette du 11 novembre 2026, point
 * 2.5) : « VIR … −100,000 » ne proposait qu'« Ignorer » ; la facture d'achat
 * ouverte de 100,000 attendait son règlement.
 *
 * Le moteur du Socle désigne la facture et l'écriture de règlement qu'il
 * propose (tiers de la facture, compte de la banque), sous l'identité de
 * l'expert.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-ligne-de-releve-regle-sa-facture.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  lignesDuReglement,
  reglementsDesLignes,
  type FactureOuverte,
} from "@malica/socle/engines/banque/reglement-de-ligne";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

describe("une ligne de relevé règle sa facture", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  let facture: string;
  let ligne: string;
  let compte: { id: string; accountCode: string };

  before(async () => {
    s = await monterUneSociete(`releve-${Date.now()}`);
    facture = await s.deposer("amel", "entite");
    await s.lire("amel", facture);
    await s.fait("amel", "collab.envoyer", facture);
    await s.priseEnCharge(facture);

    // Le compte de la banque : celui où les moyens bancaires du pack règlent.
    const moyens = (await s.fait(
      "expert",
      "referentiel.moyensDePaiement",
      s.pack,
      "fr",
      "2026-10-10",
    )) as Array<{
      code: string;
      tresorerieAccount: string | null;
    }>;
    const bancaire = moyens.find(
      (m) =>
        m.tresorerieAccount &&
        moyens.filter((x) => x.tresorerieAccount === m.tresorerieAccount).length > 1,
    )!;
    const id = (await s.fait("expert", "banque.createAccount", {
      tenantId: s.pme,
      entityId: null,
      label: "Banque essai",
      devise: "TND",
      accountCode: bancaire.tresorerieAccount,
    })) as string;
    compte = { id, accountCode: bancaire.tresorerieAccount! };
    await s.fait("expert", "banque.importLines", {
      tenantId: s.pme,
      compteId: id,
      batchId: `releve-${Date.now()}`,
      lines: [
        {
          at: "2026-10-10",
          label: "VIR FOURNISSEUR ESSAI",
          montant: "-100.000",
          reference: null,
          idempotencyKey: `l-${Date.now()}`,
        },
      ],
    });
    ligne = ((await s.fait("expert", "banque.lines", s.pme, id)) as Array<{ id: string }>)[0]!.id;
  });
  after(async () => {
    await s.fermer();
    await fermerLePool();
  });

  it("la facture inscrite est ouverte, et le moteur la désigne pour la ligne", async () => {
    const ouvertes = (await s.fait("expert", "banque.facturesOuvertes", s.pme)) as FactureOuverte[];
    const f = ouvertes.find((x) => x.pieceId === facture);
    assert.ok(f, "la facture est ouverte");
    assert.equal(Number(f.reste), 100);
    const lignes = (await s.fait("expert", "banque.lines", s.pme, compte.id)) as Array<{
      id: string;
      at: string;
      label: string;
      montant: string;
      reference: string | null;
    }>;
    const proposes = reglementsDesLignes(lignes, ouvertes);
    assert.deepEqual(
      proposes.map((p) => [p.ligneId, p.facture.pieceId]),
      [[ligne, facture]],
    );
  });

  it("la PME ne lit pas les factures ouvertes d'un dossier confié", async () => {
    const ouvertes = (await s.fait("amel", "banque.facturesOuvertes", s.pme)) as FactureOuverte[];
    assert.equal(
      ouvertes.some((x) => x.pieceId === facture),
      false,
    );
  });

  it("l'écriture proposée solde le tiers de la facture contre la banque", async () => {
    const ouvertes = (await s.fait("expert", "banque.facturesOuvertes", s.pme)) as FactureOuverte[];
    const f = ouvertes.find((x) => x.pieceId === facture)!;
    // Le tiers est celui que l'écriture de la facture a crédité.
    assert.equal(f.compteTiers, "401");
    const lignes = (await s.fait("expert", "banque.lines", s.pme, compte.id)) as Array<{
      id: string;
      at: string;
      label: string;
      montant: string;
      reference: string | null;
    }>;
    assert.deepEqual(
      lignesDuReglement(lignes[0]!, f, compte.accountCode).map((l) => [
        l.account_code,
        Number(l.debit),
        Number(l.credit),
      ]),
      [
        ["401", 100, 0],
        [compte.accountCode, 0, 100],
      ],
    );
  });
});
