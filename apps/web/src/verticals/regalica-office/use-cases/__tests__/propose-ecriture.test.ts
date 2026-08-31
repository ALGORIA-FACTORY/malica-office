import { describe, expect, it } from "vitest";

import {
  factureAchatSimple,
  factureVenteSimple,
  TAX_RATES_TN,
} from "../../socle/__tests__/fixtures";
import type { AccountMapping, TaxRate } from "../../ports/repositories";
import { buildProposal } from "../propose-ecriture";

const taxRates: TaxRate[] = TAX_RATES_TN.map((r) => ({
  code: r.code,
  label: r.label,
  rate: r.rate,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  jurisdiction: r.jurisdiction,
}));

const mappings: AccountMapping[] = [
  {
    documentKind: "facture_achat",
    taxCode: null,
    mainAccount: "6071",
    vatAccount: "43661",
    counterpartyAccount: "4011",
  },
  {
    documentKind: "facture_vente",
    taxCode: null,
    mainAccount: "7071",
    vatAccount: "43671",
    counterpartyAccount: "4111",
  },
];

function proposer(payload: unknown) {
  return buildProposal({
    pieceId: "11111111-1111-1111-1111-111111111111",
    payload,
    taxRates,
    mappings,
    currency: "TND",
  });
}

describe("l'écriture proposée", () => {
  it("porte un libellé qui identifie l'opération sans ouvrir la pièce", () => {
    // Il portait le seul nom de l'émetteur : deux factures du même fournisseur
    // dans le même mois donnaient deux écritures indiscernables en balance.
    expect(proposer(factureAchatSimple()).libelle).toBe(
      "Achat — Fournisseur SARL — Réf. F-2026-042 du 15/07/2026",
    );
  });

  it("ne met jamais de montant dans le libellé", () => {
    // Un montant recopié devient faux dès la première correction — c'est la
    // source d'incohérence la plus fréquente dans un grand livre.
    const { libelle, pivot } = proposer(factureAchatSimple());
    expect(pivot.totals.debit).toBeTruthy();
    expect(libelle).not.toContain(pivot.totals.debit);
    expect(libelle).not.toMatch(/TND|DT/);
  });

  it("omet la référence absente au lieu d'inventer", () => {
    expect(proposer(factureVenteSimple()).libelle).toBe("Vente — Client SA — du 10/07/2026");
  });
});
