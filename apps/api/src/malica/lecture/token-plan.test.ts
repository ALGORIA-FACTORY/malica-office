import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeAmount,
  normalizeDate,
  resolveFromTokenPlan,
  type PageToken,
} from "./token-plan.ts";

const tokens: PageToken[] = [
  { page: 1, ordinal: 0, text: "SOTUMAG", x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.12 },
  { page: 1, ordinal: 1, text: "12/03/2026", x0: 0.6, y0: 0.1, x1: 0.8, y1: 0.12 },
  { page: 1, ordinal: 2, text: "1 234,560", x0: 0.6, y0: 0.5, x1: 0.8, y1: 0.52 },
  { page: 1, ordinal: 3, text: "TND", x0: 0.82, y0: 0.5, x1: 0.9, y1: 0.52 },
];

describe("normalizeAmount", () => {
  it("relit les montants tunisiens à trois décimales", () => {
    assert.equal(normalizeAmount("1 234,560"), "1234.560");
    assert.equal(normalizeAmount("1.234,56 TND"), "1234.56");
    assert.equal(normalizeAmount("12345.678"), "12345.678");
    assert.equal(normalizeAmount("(123,45)"), "-123.45");
  });

  it("refuse ce qui n'est pas un nombre plutôt que de deviner", () => {
    assert.equal(normalizeAmount("Total"), null);
    assert.equal(normalizeAmount("—"), null);
  });
});

describe("normalizeDate", () => {
  it("lit les deux ordres usuels", () => {
    assert.equal(normalizeDate("12/03/2026"), "2026-03-12");
    assert.equal(normalizeDate("2026-03-12"), "2026-03-12");
    assert.equal(normalizeDate("mars"), null);
  });
});

describe("resolveFromTokenPlan — R2", () => {
  it("relit la valeur depuis le token, jamais depuis le modèle", () => {
    const r = resolveFromTokenPlan(tokens, "totals.ttc", { page: 1, ordinal: 2 }, "amount");
    assert.equal(r.value, "1234.560");
    assert.partialDeepStrictEqual(r.citation, { field: "totals.ttc", page: 1, ordinal: 2 });
    assert.equal(r.flag, null);
  });

  it("drapeaute une désignation orpheline sans produire de valeur", () => {
    const r = resolveFromTokenPlan(tokens, "totals.vat", { page: 1, ordinal: 99 }, "amount");
    assert.equal(r.value, null);
    assert.equal(r.citation, null);
    assert.equal(r.flag?.code, "TOKEN_NOT_FOUND");
  });

  it("drapeaute l'absence de citation", () => {
    const r = resolveFromTokenPlan(tokens, "issuer", null, "text");
    assert.equal(r.value, null);
    assert.equal(r.flag?.code, "MISSING_CITATION");
  });

  it("refuse un token non numérique désigné comme montant", () => {
    const r = resolveFromTokenPlan(tokens, "totals.base_ht", { page: 1, ordinal: 3 }, "amount");
    assert.equal(r.value, null);
    assert.notEqual(r.citation, null);
    assert.equal(r.flag?.code, "VALUE_NOT_A_NUMBER");
  });
});
