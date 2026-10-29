import { describe, expect, it } from "vitest";

import { MESSAGES, LOCALES } from "@malica/socle/messages";

import { MOT_CABINET, MOT_PME, MOT_PME_QUI } from "@/lib/statut";

/**
 * ============================================== LE DÉFAUT QUE CECI VERROUILLE
 *
 * Un statut sans libellé affiche sa CLÉ à l'écran — « statut.pme.vue » —,
 * c'est-à-dire du jargon technique sous les yeux d'un dirigeant de PME. C'est
 * arrivé une fois (`confirmee`, jamais traduit) ; un statut rare échappe à la
 * relecture, pas à une épreuve.
 *
 * Depuis « Malica sans blocage » (28 octobre 2026), l'écran ne montre plus le
 * statut brut de la base mais le vocabulaire unique des deux rives, dérivé au
 * Socle. Les tables `MOT_*` sont totales par leur type ; cette épreuve vérifie
 * que chaque mot qu'elles désignent existe bien dans les trois langues.
 */
const CLES = [
  ...Object.values(MOT_PME),
  ...Object.values(MOT_PME_QUI),
  ...Object.values(MOT_CABINET),
] as string[];

describe("les statuts d'envoi, vus par l'écran", () => {
  for (const langue of LOCALES) {
    it(`chaque statut a son libellé en ${langue}`, () => {
      const catalogue = MESSAGES[langue] as Record<string, string>;
      const manquants = CLES.filter((cle) => !catalogue[cle]);
      expect(manquants, `statuts sans libellé en ${langue}`).toEqual([]);
    });

    it(`aucun libellé de statut ne laisse passer sa clé en ${langue}`, () => {
      const catalogue = MESSAGES[langue] as Record<string, string>;
      for (const cle of CLES) {
        const libelle = catalogue[cle]!;
        expect(libelle.startsWith("statut."), `${cle} : la clé sert de libellé`).toBe(false);
        expect(libelle.trim().length, `${cle} : libellé vide`).toBeGreaterThan(0);
      }
    });
  }
});
