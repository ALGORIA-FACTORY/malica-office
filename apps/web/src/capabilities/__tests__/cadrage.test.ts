import { describe, expect, it } from "vitest";

import { cadrerAvec, CERTITUDE_MIN, type Detecteur } from "../cadrage";
import type { Point } from "../scanner";

const COINS: Point[] = [
  { x: 10, y: 10 },
  { x: 90, y: 10 },
  { x: 90, y: 90 },
  { x: 10, y: 90 },
];

const IMAGE = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData;

function detecteur(
  nom: Detecteur["nom"],
  resultat: { coins: Point[]; certitude: number | null } | null | "panne",
  appels: string[] = [],
): Detecteur {
  return {
    nom,
    async trouver() {
      appels.push(nom);
      if (resultat === "panne") throw new Error("indisponible");
      return resultat;
    },
  };
}

describe("cadrage — la cascade des détecteurs", () => {
  it("s'arrête au premier qui trouve", async () => {
    const appels: string[] = [];
    const r = await cadrerAvec(IMAGE, [
      detecteur("modele", { coins: COINS, certitude: 0.9 }, appels),
      detecteur("algorithme", { coins: COINS, certitude: null }, appels),
    ]);
    expect(r.origine).toBe("modele");
    expect(r.certitude).toBe(0.9);
    // Le second n'a pas été dérangé.
    expect(appels).toEqual(["modele"]);
  });

  it("passe au suivant quand le premier ne trouve rien", async () => {
    const appels: string[] = [];
    const r = await cadrerAvec(IMAGE, [
      detecteur("modele", null, appels),
      detecteur("algorithme", { coins: COINS, certitude: null }, appels),
    ]);
    expect(r.origine).toBe("algorithme");
    expect(appels).toEqual(["modele", "algorithme"]);
  });

  it("un détecteur en panne ne fait pas échouer la cascade", async () => {
    // Le modèle se charge par le réseau : sur un téléphone hors couverture, il
    // n'existe pas. Ce n'est pas une raison pour ne plus savoir cadrer.
    const appels: string[] = [];
    const r = await cadrerAvec(IMAGE, [
      detecteur("modele", "panne", appels),
      detecteur("maison", { coins: COINS, certitude: null }, appels),
    ]);
    expect(r.origine).toBe("maison");
    expect(r.coins).toEqual(COINS);
    expect(appels).toEqual(["modele", "maison"]);
  });

  /*
   * LE DÉFAUT QUE CECI VERROUILLE
   *
   * « La tasse de café est dans la photo. » Un détecteur qui rend des coins
   * avec une faible probabilité de présence a trouvé QUELQUE CHOSE — le bord
   * du sous-main, l'ombre de la tasse — mais pas un document. L'accepter,
   * c'est recadrer sur un objet quelconque, ce qui est pire que ne rien faire.
   */
  it("refuse des coins quand la présence d'un document n'est pas assurée", async () => {
    const r = await cadrerAvec(IMAGE, [
      detecteur("modele", { coins: COINS, certitude: CERTITUDE_MIN - 0.01 }),
    ]);
    expect(r.origine).toBe("aucune");
    expect(r.coins).toBeNull();
  });

  it("accepte tout juste au seuil", async () => {
    const r = await cadrerAvec(IMAGE, [
      detecteur("modele", { coins: COINS, certitude: CERTITUDE_MIN }),
    ]);
    expect(r.origine).toBe("modele");
  });

  it("laisse passer un détecteur qui ne sait pas dire sa certitude", async () => {
    // Un algorithme ne rend pas de probabilité de présence. L'exiger
    // reviendrait à n'accepter que le modèle, donc à n'avoir aucun recours
    // hors ligne.
    const r = await cadrerAvec(IMAGE, [detecteur("algorithme", { coins: COINS, certitude: null })]);
    expect(r.origine).toBe("algorithme");
    expect(r.certitude).toBeNull();
  });

  it("quand aucun ne trouve, elle le dit — elle n'invente pas un cadre", async () => {
    const r = await cadrerAvec(IMAGE, [
      detecteur("modele", null),
      detecteur("algorithme", null),
      detecteur("maison", null),
    ]);
    expect(r).toEqual({ coins: null, certitude: null, origine: "aucune" });
  });

  it("sans aucun détecteur, elle ne rend rien plutôt que de se plaindre", async () => {
    const r = await cadrerAvec(IMAGE, []);
    expect(r.coins).toBeNull();
  });
});
