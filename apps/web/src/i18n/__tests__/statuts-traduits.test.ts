import { describe, expect, it } from "vitest";

import { MESSAGES, LOCALES } from "../messages";

/**
 * ============================================== LE DÉFAUT QUE CECI VERROUILLE
 *
 * La base autorise sept statuts de pièce ; le front n'en traduisait que six.
 * `confirmee` n'avait aucun libellé. Une pièce qui l'aurait atteint aurait
 * affiché sa CLÉ à l'écran — « pme.status.confirmee » —, c'est-à-dire du
 * jargon technique sous les yeux d'un dirigeant de PME.
 *
 * Personne ne l'avait vu parce que ce statut est rare. C'est précisément le
 * genre d'écart qu'une épreuve attrape et qu'une relecture manque.
 *
 * La liste ci-dessous est celle de la contrainte `check` de `capture.pieces`.
 * Si un statut y est ajouté un jour, cette épreuve tombe tant qu'il n'a pas
 * ses trois traductions.
 */
const STATUTS_DE_LA_BASE = [
  "capturee",
  "lue",
  "proposee",
  "confirmee",
  "comptabilisee",
  "supervisee",
  "retournee",
] as const;

describe("les statuts de pièce, vus par l'écran", () => {
  for (const langue of LOCALES) {
    it(`chaque statut a son libellé en ${langue}`, () => {
      const catalogue = MESSAGES[langue] as Record<string, string>;
      const manquants = STATUTS_DE_LA_BASE.filter((s) => !catalogue[`pme.status.${s}`]);
      expect(manquants, `statuts sans libellé en ${langue}`).toEqual([]);
    });

    it(`aucun libellé de statut ne laisse passer sa clé en ${langue}`, () => {
      const catalogue = MESSAGES[langue] as Record<string, string>;
      for (const s of STATUTS_DE_LA_BASE) {
        const libelle = catalogue[`pme.status.${s}`]!;
        expect(libelle.startsWith("pme."), `${s} : la clé sert de libellé`).toBe(false);
        expect(libelle.trim().length, `${s} : libellé vide`).toBeGreaterThan(0);
      }
    });
  }
});
