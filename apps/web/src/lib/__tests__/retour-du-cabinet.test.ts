import { describe, expect, it } from "vitest";
import { LOCALES, MESSAGES } from "@malica/socle/messages";

import {
  dernierRetourParPiece,
  estCorrigee,
  FAIT_DU_GESTE,
  LIBELLE_DU_GESTE,
  reponsesAuDernierRetour,
  sortiesDuRetour,
} from "@/lib/retour-du-cabinet";

/** Maquette « Retours du cabinet et pièces à confirmer », 25 octobre 2026. */
describe("un retour du cabinet dit un geste", () => {
  it("chaque geste se dit, et ce qui le prouve aussi, dans les trois langues", () => {
    const cles = [...Object.values(LIBELLE_DU_GESTE), ...Object.values(FAIT_DU_GESTE)];
    for (const locale of LOCALES)
      for (const cle of cles) expect(MESSAGES[locale][cle], `${locale} ${cle}`).toBeTruthy();
  });

  it("une pièce retournée a toujours toutes ses sorties, le geste demandé d'abord", () => {
    const toutes = ["renvoyer", "reprendre_photo", "repondre", "garder", "supprimer"];
    for (const geste of Object.keys(LIBELLE_DU_GESTE) as Array<keyof typeof LIBELLE_DU_GESTE>)
      for (const fait of [false, true]) {
        const sorties = sortiesDuRetour(geste, fait);
        expect(new Set(sorties).size, `${geste} sans doublon`).toBe(sorties.length);
        for (const s of toutes) expect(sorties, `${geste} ${String(fait)}`).toContain(s);
      }
    expect(sortiesDuRetour("joindre_document", false).slice(0, 2)).toEqual(["geste", "renvoyer"]);
    expect(sortiesDuRetour("joindre_document", true).slice(0, 2)).toEqual(["renvoyer", "geste"]);
    // Le geste qu'une sortie porte déjà ne se dit pas deux fois.
    expect(sortiesDuRetour("reprendre_photo", false)[0]).toBe("reprendre_photo");
    expect(sortiesDuRetour("repondre", false)[0]).toBe("repondre");
    expect(sortiesDuRetour("demander_suppression", false)).not.toContain("geste");
    // Un doublon n'est jamais « corrigé » : supprimer reste en tête, même « fait ».
    expect(sortiesDuRetour("demander_suppression", true)[0]).toBe("supprimer");
    expect(estCorrigee("demander_suppression", true)).toBe(false);
    expect(estCorrigee("voir_reglement", true)).toBe(false);
    expect(estCorrigee("reprendre_photo", true)).toBe(true);
  });
});

describe("dernierRetourParPiece", () => {
  const n = (id: string, piece: string | undefined, createdAt: string) => ({
    id,
    piece,
    createdAt,
  });

  it("garde une seule carte par pièce : le retour le plus récent", () => {
    const r = dernierRetourParPiece(
      [
        n("a", "p1", "2026-10-20T10:00:00Z"),
        n("b", "p1", "2026-10-28T10:00:00Z"),
        n("c", "p2", "2026-10-25T10:00:00Z"),
      ],
      (x) => x.piece,
    );
    expect(r.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("écarte un retour sans pièce", () => {
    expect(
      dernierRetourParPiece([n("a", undefined, "2026-10-20T10:00:00Z")], (x) => x.piece),
    ).toEqual([]);
  });
});

/** Recette du 11 novembre 2026 : la réponse du client se lit sur la pièce. */
describe("la réponse du client au dernier retour", () => {
  const fait = (id: string, action: string, at: string, payload: unknown = {}) => ({
    id,
    action,
    at,
    payload,
  });

  it("rend le texte des réponses faites après le dernier retour, la plus récente d'abord", () => {
    const journal = [
      fait("5", "piece.renvoyee", "2026-11-11T12:00:00Z"),
      fait("4", "piece.reponse_client", "2026-11-11T11:00:00Z", { texte: "Il arrive lundi." }),
      fait("3", "piece.reponse_client", "2026-11-11T10:30:00Z", { texte: "Quel document ?" }),
      fait("2", "piece.retournee", "2026-11-11T10:00:00Z"),
      fait("1", "piece.reponse_client", "2026-11-10T09:00:00Z", { texte: "Ancienne réponse" }),
      fait("0", "piece.retournee", "2026-11-10T08:00:00Z"),
    ];
    expect(reponsesAuDernierRetour(journal).map((r) => [r.id, r.texte])).toEqual([
      ["4", "Il arrive lundi."],
      ["3", "Quel document ?"],
    ]);
  });

  it("ne rend ni la réponse d'un siège à son propriétaire, ni un fait sans texte", () => {
    const journal = [
      fait("3", "piece.reponse_client", "2026-11-11T11:00:00Z", {
        texte: "Pour Amel",
        chez: "proprietaire",
      }),
      fait("2", "piece.reponse_client", "2026-11-11T10:30:00Z", {}),
      fait("1", "piece.retournee", "2026-11-11T10:00:00Z"),
    ];
    expect(reponsesAuDernierRetour(journal)).toEqual([]);
  });
});
