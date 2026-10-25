import { describe, expect, it } from "vitest";
import { MESSAGES } from "@malica/socle/messages";

import {
  apresLaReponse,
  laReponseAEffaceLaPiece,
  phraseDeLaDemande,
  phraseDeLaReponse,
} from "@/lib/demande-sur-piece";

/** Audit du 25 octobre 2026 : l'objet et le verdict d'une demande se disent. */
describe("les demandes sur une pièce, notifiées", () => {
  it("côté cabinet, une suppression ne se dit pas « retour »", () => {
    expect(phraseDeLaDemande({ objet: "suppression" })).toBe(
      "cab.notif.kind.piece.demande.suppression",
    );
    expect(phraseDeLaDemande({ objet: "rappel" })).toBe("cab.notif.kind.piece.demande");
  });

  it("côté PME, la réponse dit l'objet ET le verdict", () => {
    expect(phraseDeLaReponse({ objet: "rappel", accorde: false })).toBe(
      "notif.kind.piece.demande_tranchee.rappel.refuse",
    );
    expect(phraseDeLaReponse({ objet: "rappel", accorde: true })).toBe(
      "notif.kind.piece.demande_tranchee.rappel.accorde",
    );
    expect(phraseDeLaReponse({ objet: "suppression", accorde: true })).toBe(
      "notif.kind.piece.demande_tranchee.suppression.accorde",
    );
    expect(phraseDeLaReponse({ objet: "suppression", accorde: false })).toBe(
      "notif.kind.piece.demande_tranchee.suppression.refuse",
    );
  });

  it("une notification ancienne, sans verdict, garde la phrase générique : rien ne se devine", () => {
    expect(phraseDeLaReponse({ objet: "rappel" })).toBe("notif.kind.piece.demande_tranchee");
    expect(phraseDeLaReponse({})).toBe("notif.kind.piece.demande_tranchee");
  });

  it("chaque phrase existe dans les trois langues", () => {
    const cles = [
      phraseDeLaDemande({ objet: "suppression" }),
      ...(["rappel", "suppression"] as const).flatMap((objet) =>
        [true, false].map((accorde) => phraseDeLaReponse({ objet, accorde })),
      ),
    ];
    for (const langue of ["fr", "en", "ar"] as const)
      for (const cle of cles) expect(MESSAGES[langue][cle], `${langue} ${cle}`).toBeTruthy();
  });

  it("une suppression accordée n'a plus de pièce à ouvrir", () => {
    expect(
      laReponseAEffaceLaPiece("piece.demande_tranchee", { objet: "suppression", accorde: true }),
    ).toBe(true);
    expect(
      laReponseAEffaceLaPiece("piece.demande_tranchee", { objet: "suppression", accorde: false }),
    ).toBe(false);
    expect(
      laReponseAEffaceLaPiece("piece.demande_tranchee", { objet: "rappel", accorde: true }),
    ).toBe(false);
  });

  it("le cabinet quitte une pièce qu'il vient d'effacer : la suivante, sinon la file", () => {
    expect(apresLaReponse("suppression", true, "p2")).toEqual({ piece: "p2" });
    expect(apresLaReponse("suppression", true, null)).toBe("file");
    expect(apresLaReponse("suppression", false, "p2")).toBeNull();
    expect(apresLaReponse("rappel", true, "p2")).toBeNull();
  });
});
