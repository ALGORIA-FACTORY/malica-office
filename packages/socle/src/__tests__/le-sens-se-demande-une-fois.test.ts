/**
 * Le sens d'une pièce se demande une fois, pas deux.
 *
 * Le 13 octobre 2026, le dirigeant répondait « une facture que j'ai reçue » à
 * la capture, puis l'écran lui reposait la question quelques secondes plus
 * tard. Vérifié en base : deux de ses pièces portent à la fois le type
 * déclaré ET une précision. Il avait bien répondu deux fois.
 */
import { describe, expect, it } from "vitest";

import { leSensResteADemander } from "../sens-de-la-piece.ts";

describe("le sens se demande une fois", () => {
  it("la lecture a tranché : on ne demande rien", () => {
    expect(leSensResteADemander({ sensLu: "facture_vente", typeDeclare: null })).toBe(false);
  });

  it("le défaut du 13 octobre : déclaré à la capture, non lu — on ne redemande pas", () => {
    expect(leSensResteADemander({ sensLu: null, typeDeclare: "facture_achat" })).toBe(false);
  });

  it("ni lu ni déclaré : la question se pose, et c'est la seule fois", () => {
    expect(leSensResteADemander({ sensLu: null, typeDeclare: null })).toBe(true);
  });

  it("un type déclaré qui n'est pas une facture ne répond pas à la question", () => {
    // « Un relevé bancaire » dit ce que ce n'est pas, jamais si c'est un
    // achat ou une vente.
    expect(leSensResteADemander({ sensLu: null, typeDeclare: "releve_bancaire" })).toBe(true);
  });

  it("la lecture l'emporte sur la déclaration, et clôt la question dans tous les cas", () => {
    expect(leSensResteADemander({ sensLu: "facture_achat", typeDeclare: "facture_vente" })).toBe(
      false,
    );
  });
});
