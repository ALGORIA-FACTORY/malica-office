/**
 * Dire la vraie cause, jamais la plus commode.
 *
 * L'épreuve qui compte le plus est la première : sur un téléphone en HTTP, la
 * caméra existe. Dire le contraire envoie quelqu'un chercher une panne
 * matérielle qui n'existe pas.
 */
import { describe, expect, it } from "vitest";

import { cleDuMotif, motifCamera } from "../camera";

/** Une erreur du navigateur, telle que `getUserMedia` la rejette. */
function erreur(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe("la page en HTTP", () => {
  it("ne dit PAS que l'appareil n'a pas de caméra", () => {
    expect(motifCamera(erreur("NotFoundError"), false, false)).toBe("contexte_non_securise");
    expect(motifCamera(new TypeError("undefined"), false, false)).toBe("contexte_non_securise");
  });

  it("le dit aussi quand l'interface a simplement disparu", () => {
    // Hors contexte sécurisé, certains navigateurs retirent `mediaDevices` :
    // l'appel lève un TypeError qui ne dit rien de la caméra.
    expect(motifCamera(undefined, true, false)).toBe("contexte_non_securise");
  });

  it("range SecurityError avec le contexte : c'est la même chose vue d'ici", () => {
    expect(motifCamera(erreur("SecurityError"), true, true)).toBe("contexte_non_securise");
  });
});

describe("en contexte sécurisé, chaque cause a son nom", () => {
  it("distingue un refus de permission", () => {
    expect(motifCamera(erreur("NotAllowedError"), true, true)).toBe("refus");
    expect(motifCamera(erreur("PermissionDeniedError"), true, true)).toBe("refus");
  });

  it("reconnaît l'absence réelle de caméra — le seul cas où l'ancien message disait vrai", () => {
    expect(motifCamera(erreur("NotFoundError"), true, true)).toBe("absente");
    expect(motifCamera(erreur("DevicesNotFoundError"), true, true)).toBe("absente");
  });

  it("reconnaît une caméra déjà prise par une autre application", () => {
    expect(motifCamera(erreur("NotReadableError"), true, true)).toBe("occupee");
    expect(motifCamera(erreur("TrackStartError"), true, true)).toBe("occupee");
  });

  it("avoue son ignorance plutôt que d'inventer une cause", () => {
    expect(motifCamera(erreur("QuelqueChoseDInattendu"), true, true)).toBe("inconnu");
    expect(motifCamera("une chaîne", true, true)).toBe("inconnu");
    expect(motifCamera(null, true, true)).toBe("inconnu");
  });
});

describe("la clé de message", () => {
  it("suit le motif", () => {
    expect(cleDuMotif("contexte_non_securise")).toBe("scan.cam.contexte_non_securise");
    expect(cleDuMotif("absente")).toBe("scan.cam.absente");
  });
});
