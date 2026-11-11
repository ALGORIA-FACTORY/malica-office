/**
 * Le sens confirmé d'une pièce — ce que la personne a déclaré, jamais ce que l'OCR a deviné.
 *
 * Seule une facture d'achat ou de vente dont la personne a confirmé le sens entre au moteur
 * comme un fait connu, et place le dossier. Un sens seulement lu, un autre type de pièce ou
 * une absence de type ne sont pas une déclaration : le moteur ne reçoit rien.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sensConfirme } from "./sens.ts";

describe("le sens que la personne a confirmé", () => {
  it("passe au moteur ; un sens seulement lu, ou un autre type, n'est pas une déclaration", () => {
    assert.equal(sensConfirme("facture_achat", "confirme"), "achat");
    assert.equal(sensConfirme("facture_vente", "confirme"), "vente");
    assert.equal(sensConfirme("facture_achat", "a_confirmer"), undefined);
    assert.equal(sensConfirme("facture_vente", "a_determiner"), undefined);
    assert.equal(sensConfirme("avoir", "confirme"), undefined);
    assert.equal(sensConfirme(null, "confirme"), undefined);
  });
});
