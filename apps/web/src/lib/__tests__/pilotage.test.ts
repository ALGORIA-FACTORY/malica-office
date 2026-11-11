/**
 * Le pilotage du cabinet — charge d'un collaborateur et santé d'un mandat.
 *
 * Garantit que l'état de charge se lit sur la capacité réglée et non sur un seuil écrit
 * dans le code, que la santé d'un mandat se compare au taux moyen de retour du cabinet,
 * et que le taux de retour est vide plutôt que faux quand il n'y a aucune pièce.
 */
import { describe, expect, it } from "vitest";

import { etatDeCharge, santeDuMandat, tauxDeRetour } from "../pilotage";

describe("etatDeCharge", () => {
  it("se lit sur la capacité réglée, pas sur un seuil écrit", () => {
    expect(etatDeCharge(0, 8)).toBe("cab.pil.etat.aucun");
    expect(etatDeCharge(3, 8)).toBe("cab.pil.etat.disponible");
    expect(etatDeCharge(8, 8)).toBe("cab.pil.etat.capacite");
    expect(etatDeCharge(9, 8)).toBe("cab.pil.etat.surcharge");
    // Une autre capacité change tout — c'est le réglage qui décide.
    expect(etatDeCharge(3, 2)).toBe("cab.pil.etat.surcharge");
  });
});

describe("santeDuMandat", () => {
  it("compare au taux moyen du cabinet, et nomme l'absence de retour", () => {
    expect(santeDuMandat(null, 0.1)).toBe("cab.pil.sante.sans");
    expect(santeDuMandat(0, 0.1)).toBe("cab.pil.sante.sans");
    expect(santeDuMandat(0.05, 0.1)).toBe("cab.pil.sante.saine");
    expect(santeDuMandat(0.1, 0.1)).toBe("cab.pil.sante.saine");
    expect(santeDuMandat(0.2, 0.1)).toBe("cab.pil.sante.suivre");
  });
});

describe("tauxDeRetour", () => {
  it("rapporte les retours aux pièces, ou rien sans pièce", () => {
    expect(tauxDeRetour({ pieces: 10, retournees: 2 })).toBe(0.2);
    expect(tauxDeRetour({ pieces: 0, retournees: 0 })).toBeNull();
    expect(tauxDeRetour(undefined)).toBeNull();
  });
});
