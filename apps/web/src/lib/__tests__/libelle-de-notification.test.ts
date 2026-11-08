import { describe, expect, it } from "vitest";

import { attendUnGeste, cleDuGenre, seMontreIci } from "../libelle-de-notification";

describe("ce qu'une notification dit, et ce qu'elle demande", () => {
  it("la cloche compte ce qui attend un geste, pas tout le non lu", () => {
    expect(attendUnGeste({ kind: "piece.retournee", readAt: null })).toBe(true);
    expect(attendUnGeste({ kind: "piece.demande", readAt: null })).toBe(true);
    expect(attendUnGeste({ kind: "piece.supprimee", readAt: null })).toBe(false);
    expect(attendUnGeste({ kind: "piece.retournee", readAt: "2026-11-07T10:00:00Z" })).toBe(false);
  });

  it("dans la coque, rien ne parle d'abonnement", () => {
    expect(seMontreIci("acces.propose", true)).toBe(false);
    expect(seMontreIci("acces.accepte", true)).toBe(false);
    expect(seMontreIci("acces.propose", false)).toBe(true);
    expect(seMontreIci("piece.retournee", true)).toBe(true);
  });

  it("un genre inconnu a sa phrase par défaut", () => {
    expect(cleDuGenre("genre.inconnu")).toBe("cab.notif.kind.autre");
    expect(cleDuGenre("piece.retournee")).toBe("notif.kind.piece.retournee");
  });
});
