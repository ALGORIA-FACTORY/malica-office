import { describe, expect, it } from "vitest";

import { normalizeAmount, normalizeDate, resolveFromTokenPlan, type PageToken } from "../token-plan";

const tokens: PageToken[] = [
  { page: 1, ordinal: 0, text: "SOTUMAG", x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.12 },
  { page: 1, ordinal: 1, text: "12/03/2026", x0: 0.6, y0: 0.1, x1: 0.8, y1: 0.12 },
  { page: 1, ordinal: 2, text: "1 234,560", x0: 0.6, y0: 0.5, x1: 0.8, y1: 0.52 },
  { page: 1, ordinal: 3, text: "TND", x0: 0.82, y0: 0.5, x1: 0.9, y1: 0.52 },
];

describe("normalizeAmount", () => {
  it("relit les montants tunisiens à trois décimales", () => {
    expect(normalizeAmount("1 234,560")).toBe("1234.560");
    expect(normalizeAmount("1.234,56 TND")).toBe("1234.56");
    expect(normalizeAmount("12345.678")).toBe("12345.678");
    expect(normalizeAmount("(123,45)")).toBe("-123.45");
  });

  it("refuse ce qui n'est pas un nombre plutôt que de deviner", () => {
    expect(normalizeAmount("Total")).toBeNull();
    expect(normalizeAmount("—")).toBeNull();
  });
});

describe("normalizeDate", () => {
  it("lit les deux ordres usuels", () => {
    expect(normalizeDate("12/03/2026")).toBe("2026-03-12");
    expect(normalizeDate("2026-03-12")).toBe("2026-03-12");
    expect(normalizeDate("mars")).toBeNull();
  });
});

describe("resolveFromTokenPlan — R2", () => {
  it("relit la valeur depuis le token, jamais depuis le modèle", () => {
    const r = resolveFromTokenPlan(tokens, "totals.ttc", { page: 1, ordinal: 2 }, "amount");
    expect(r.value).toBe("1234.560");
    expect(r.citation).toMatchObject({ field: "totals.ttc", page: 1, ordinal: 2 });
    expect(r.flag).toBeNull();
  });

  it("drapeaute une désignation orpheline sans produire de valeur", () => {
    const r = resolveFromTokenPlan(tokens, "totals.vat", { page: 1, ordinal: 99 }, "amount");
    expect(r.value).toBeNull();
    expect(r.citation).toBeNull();
    expect(r.flag?.code).toBe("TOKEN_NOT_FOUND");
  });

  it("drapeaute l'absence de citation", () => {
    const r = resolveFromTokenPlan(tokens, "issuer", null, "text");
    expect(r.value).toBeNull();
    expect(r.flag?.code).toBe("MISSING_CITATION");
  });

  it("refuse un token non numérique désigné comme montant", () => {
    const r = resolveFromTokenPlan(tokens, "totals.base_ht", { page: 1, ordinal: 3 }, "amount");
    expect(r.value).toBeNull();
    expect(r.citation).not.toBeNull();
    expect(r.flag?.code).toBe("VALUE_NOT_A_NUMBER");
  });
});
