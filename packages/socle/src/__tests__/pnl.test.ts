import { describe, it, expect } from "vitest";
import { computePnl } from "../engines/pnl/snapshot.ts";
import { TND } from "./fixtures.ts";

describe("PnL / snapshot", () => {
  it("calcule produits, charges et résultat", () => {
    const r = computePnl({
      period: "2026-07",
      currency: TND,
      entries: [
        { account_code: "607", debit: "1000.000", credit: "0" },
        { account_code: "707", debit: "0", credit: "2000.000" },
        { account_code: "401", debit: "0", credit: "1190.000" }, // ni charge ni produit
      ],
      classes: [
        { prefix: "4", nature: "actif" },
        { prefix: "6", nature: "charge" },
        { prefix: "7", nature: "produit" },
      ],
      coa: [
        { account_code: "607", label: "Achats", parent_code: "60" },
        { account_code: "707", label: "Ventes", parent_code: "70" },
      ],
    });
    expect(r.charges).toBe("1000.000");
    expect(r.produits).toBe("2000.000");
    expect(r.resultat).toBe("1000.000");
    expect(r.by_account).toHaveLength(2);
  });
});
