/**
 * Les notifications — ce qu'elles disent, et ce qu'elles demandent.
 *
 * Garantit que la cloche compte ce qui attend un geste et non tout le non lu, que la
 * coque mobile ne parle jamais d'abonnement, et qu'un genre de notification inconnu
 * reçoit sa phrase par défaut plutôt qu'une clé brute.
 */
import { describe, expect, it } from "vitest";

import {
  attendUnGeste,
  cleDuGenre,
  gesteDeLaQuestion,
  seMontreIci,
} from "../libelle-de-notification";

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

  it("une prise en charge qui a démarré ne se dit plus « proposée »", () => {
    expect(cleDuGenre("acces.propose", { acces_id: "a" })).toBe("notif.kind.acces.propose");
    expect(cleDuGenre("acces.propose", { acces_id: "a", tranchee: "actif" })).toBe(
      "notif.kind.acces.accepte",
    );
  });

  it("« Voir la proposition » ne s'offre que sur une proposition encore ouverte", () => {
    expect(gesteDeLaQuestion("acces.propose", {})).toBe("proposition");
    expect(gesteDeLaQuestion("acces.descente_demandee", {})).toBe("proposition");
    expect(gesteDeLaQuestion("acces.propose", { tranchee: "actif" })).toBe("abonnement");
    // Une simple information : l'offre a été montée, ou arrêtée.
    expect(gesteDeLaQuestion("acces.monte", {})).toBe("abonnement");
    expect(gesteDeLaQuestion("acces.arrete", {})).toBe("abonnement");
    expect(gesteDeLaQuestion("mandat.propose", {})).toBe("mandat");
    expect(gesteDeLaQuestion("mandat.propose", { tranchee: "actif" })).toBeNull();
    expect(gesteDeLaQuestion("piece.retournee", {})).toBeNull();
  });
});
