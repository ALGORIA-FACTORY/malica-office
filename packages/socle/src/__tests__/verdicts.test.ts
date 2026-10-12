import { describe, expect, it } from "vitest";

import { autoriseUneEcriture, codeDuVerdict, VERDICTS_COMPTABILISABLES } from "../verdicts.ts";

/**
 * Le verdict se branche sur un CODE, et non sur une phrase française.
 *
 * L'écran de la PME comparait `verdict === "à rejeter"` — un code écrit en
 * français, comparé accent par accent, dans un autre paquet que celui qui le
 * produit. Une reformulation aurait fait tomber l'écran sur sa phrase
 * générique, en silence et sans qu'aucune épreuve ne le voie.
 */
describe("le code d'un verdict", () => {
  it("reconnaît les cinq verdicts que le contrôle rend", () => {
    expect(codeDuVerdict("à comptabiliser")).toBe("comptabilisable");
    expect(codeDuVerdict("à comptabiliser avec réserve")).toBe("reserve");
    expect(codeDuVerdict("à rapprocher")).toBe("rapprocher");
    expect(codeDuVerdict("anomalie à signaler")).toBe("anomalie");
    expect(codeDuVerdict("à rejeter")).toBe("rejet");
  });

  it("survit à une casse ou à une espace de trop", () => {
    // La phrase traverse une base, un JSON et un réseau : elle peut revenir
    // avec une majuscule ou une espace. Le code ne doit pas s'y perdre.
    expect(codeDuVerdict("  À Rejeter ")).toBe("rejet");
  });

  it("rend null sur une phrase inconnue, et ne devine pas", () => {
    expect(codeDuVerdict("rejetée")).toBeNull();
    expect(codeDuVerdict(null)).toBeNull();
    expect(codeDuVerdict("")).toBeNull();
  });

  it("deux verdicts, et deux seulement, laissent passer une écriture", () => {
    // « Avec réserve » comptabilise : une mention manquante sur une facture
    // juste ne doit pas arrêter la comptabilité d'un dossier entier.
    expect([...VERDICTS_COMPTABILISABLES].sort()).toEqual(["comptabilisable", "reserve"]);
    expect(autoriseUneEcriture("à comptabiliser")).toBe(true);
    expect(autoriseUneEcriture("à comptabiliser avec réserve")).toBe(true);
    expect(autoriseUneEcriture("à rapprocher")).toBe(false);
    expect(autoriseUneEcriture("anomalie à signaler")).toBe(false);
    expect(autoriseUneEcriture("à rejeter")).toBe(false);
  });

  it("et un verdict INCONNU n'autorise rien", () => {
    /*
     * La règle qui compte. On ne comptabilise pas sur une phrase qu'on ne
     * comprend pas : le repli penche du côté qui refuse, parce qu'une écriture
     * passée par erreur se contre-passe, et qu'une écriture passée sans être
     * comprise ne se cherche pas.
     */
    expect(autoriseUneEcriture("verdict d'un futur pack")).toBe(false);
    expect(autoriseUneEcriture(null)).toBe(false);
  });
});
