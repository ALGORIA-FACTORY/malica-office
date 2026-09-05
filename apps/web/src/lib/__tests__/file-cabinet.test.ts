import { describe, expect, it } from "vitest";

import { joursDAttente, toneForStatus } from "../file-cabinet";

describe("joursDAttente", () => {
  const maintenant = Date.parse("2026-09-04T10:00:00Z");

  it("compte des jours entiers depuis le dépôt", () => {
    expect(joursDAttente("2026-09-04T08:00:00Z", maintenant)).toBe(0);
    expect(joursDAttente("2026-09-03T09:59:00Z", maintenant)).toBe(1);
    expect(joursDAttente("2026-08-25T10:00:00Z", maintenant)).toBe(10);
  });

  it("n'est jamais négative, ni absurde sur une date illisible", () => {
    expect(joursDAttente("2026-09-05T10:00:00Z", maintenant)).toBe(0);
    expect(joursDAttente("pas une date", maintenant)).toBe(0);
  });
});

describe("toneForStatus", () => {
  it("colore ce qui attend, ce qui est réglé, ce qui est retourné", () => {
    expect(toneForStatus("comptabilisee")).toBe("warn");
    expect(toneForStatus("supervisee")).toBe("ok");
    expect(toneForStatus("retournee")).toBe("stop");
    expect(toneForStatus("lue")).toBe("neutral");
  });
});
