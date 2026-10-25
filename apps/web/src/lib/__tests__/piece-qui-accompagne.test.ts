import { describe, expect, it } from "vitest";

import type { PieceQuiAccompagne, ReglementAccompagne } from "@malica/socle/ports/repositories";

import { ficheQuiAccompagne, repriseRefusee, totalAtteste } from "../piece-qui-accompagne";

const reglement = (id: string, autre: Partial<ReglementAccompagne> = {}): ReglementAccompagne => ({
  id,
  moyenCode: "cheque",
  moyen: "Chèque",
  moyenPar: "par chèque",
  nomDeLaPreuve: "Talon de chèque",
  montantMineur: 1_969_610,
  devise: "TND",
  payeLe: "2026-10-13",
  eteint: false,
  ...autre,
});

const piece = (autre: Partial<PieceQuiAccompagne> = {}): PieceQuiAccompagne => ({
  genre: "recu",
  vis: "personnel",
  creeLe: "2026-10-25T09:00:00.000Z",
  mere: null,
  reglements: [reglement("p1")],
  vaut: true,
  annulation: null,
  candidats: [],
  ...autre,
});

describe("la fiche d'un reçu", () => {
  it("valide : vert, « Supprimer ce reçu » seul, ni rattacher ni reprendre", () => {
    const f = ficheQuiAccompagne(piece());
    expect(f.cas).toBe("recu");
    expect(f.ton).toBe("ok");
    expect(f.etat).toBe("pme.accompagne.etat.valide");
    expect(f.tampon).toBe(false);
    expect(f.nouveauRecu).toBe(false);
    expect(f.peutRattacher).toBe(false);
    expect(f.peutReprendre).toBe(false);
    expect(f.supprimer).toBe("pme.accompagne.supprimer.recu");
    expect(f.expliqueSuppression).toBe("pme.accompagne.feuille.supprimer.recu.explique");
    expect(f.note).toBe("pme.accompagne.note.recu");
  });

  it("dont un règlement est annulé : ambre, tampon, nouveau reçu, et la phrase cite l'ANNULÉ", () => {
    const f = ficheQuiAccompagne(
      piece({
        reglements: [reglement("vivant"), reglement("annule", { eteint: true })],
        vaut: false,
        annulation: {
          paiementId: "annule",
          le: "2026-10-25T10:00:00Z",
          motif: "Inscrit en double",
        },
      }),
    );
    expect(f.cas).toBe("recuPerime");
    expect(f.ton).toBe("am");
    expect(f.etat).toBe("pme.accompagne.etat.neVautPlus");
    expect(f.tampon).toBe(true);
    expect(f.nouveauRecu).toBe(true);
    expect(f.cite?.id).toBe("annule");
    expect(f.expliqueSuppression).toBe("pme.accompagne.feuille.supprimer.recuPerime.explique");
    expect(f.note).toBe("pme.accompagne.note.recuPerime");
  });

  it("ancien, sans lien : il compte — pas de tampon, rien de deviné", () => {
    const f = ficheQuiAccompagne(piece({ reglements: [] }));
    expect(f.cas).toBe("recu");
    expect(f.tampon).toBe(false);
    expect(f.cite).toBeNull();
  });
});

describe("la fiche d'un justificatif", () => {
  it("joint : vert, ses trois gestes, jamais « Lire »", () => {
    const f = ficheQuiAccompagne(piece({ genre: "justificatif" }));
    expect(f.cas).toBe("justificatif");
    expect(f.ton).toBe("ok");
    expect(f.etat).toBe("pme.accompagne.etat.joint");
    expect(f.peutRattacher).toBe(true);
    expect(f.peutReprendre).toBe(true);
    expect(f.supprimer).toBe("pme.accompagne.supprimer.justificatif");
    expect(f.titreSuppression).toBe("pme.accompagne.feuille.supprimer.justificatif");
    expect(f.nouveauRecu).toBe(false);
    expect(f.tampon).toBe(false);
  });

  it("d'un règlement annulé, ou de rien : ambre, et « Rattacher » reste la sortie", () => {
    const perime = ficheQuiAccompagne(
      piece({
        genre: "justificatif",
        reglements: [reglement("p1", { eteint: true })],
        vaut: false,
        annulation: { paiementId: "p1", le: "2026-10-25T10:00:00Z", motif: "Autre" },
      }),
    );
    expect(perime.cas).toBe("justificatifPerime");
    expect(perime.ton).toBe("am");
    expect(perime.peutRattacher).toBe(true);

    const seul = ficheQuiAccompagne(piece({ genre: "justificatif", reglements: [] }));
    expect(seul.cas).toBe("justificatifSeul");
    expect(seul.etat).toBe("pme.accompagne.etat.sansReglement");
    expect(seul.peutRattacher).toBe(true);
  });
});

describe("ce qu'atteste un reçu", () => {
  it("somme les règlements, et ne somme pas un inconnu", () => {
    expect(totalAtteste([reglement("a"), reglement("b", { montantMineur: 30_390 })])).toBe(
      2_000_000,
    );
    expect(totalAtteste([reglement("a"), reglement("b", { montantMineur: null })])).toBeNull();
  });
});

describe("reprendre la photo", () => {
  it("d'une pièce transmise est refusé AVANT d'ouvrir l'appareil", () => {
    expect(repriseRefusee({ vis: "partage" })).toBe("refus.accompagne.transmise");
    expect(repriseRefusee({ vis: "personnel" })).toBeNull();
    expect(repriseRefusee({ vis: "entite" })).toBeNull();
  });
});
