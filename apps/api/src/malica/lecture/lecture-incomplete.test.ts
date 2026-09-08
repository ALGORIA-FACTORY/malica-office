import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDate, resolveFromTokenPlan, type PageToken } from "./token-plan.ts";
import {
  buildProposal,
  champMetier,
  LectureIncomplete,
} from "@malica/socle/use-cases/propose-ecriture";

/**
 * ============================================== LE DÉFAUT QUE CECI VERROUILLE
 *
 * L'utilisateur a vu ceci à l'écran, en anglais, au milieu d'une interface
 * française :
 *
 *   [{"validation":"regex","code":"invalid_string",
 *     "message":"Date ISO YYYY-MM-DD requise","path":["document_date"]}]
 *
 * C'était le message brut d'un `ZodError` levé par `ExtractV1.parse`. La
 * facture avait pourtant été lue : émetteur, lignes et totaux étaient là.
 * Seule la date manquait, et la pièce restait bloquée sans explication.
 */

const FACTURE_SANS_DATE = {
  contract: "extract.v1",
  issuer: "ATLAS DISTRIBUTION",
  document_date: "",
  currency: "TND",
  lines: [
    { label: "Marchandises", tax_code: "TVA_19", base_ht: "1000", vat_amount: "190", ttc: "1190" },
  ],
  articles: [],
  other_charges: [],
  totals: { base_ht: "1000", vat: "190", ttc: "1190" },
  references: {},
  field_confidence: {},
  document_kind: "facture_achat",
};

function proposer(payload: unknown) {
  return buildProposal({
    pieceId: "11111111-1111-1111-1111-111111111111",
    payload,
    taxRates: [],
    mappings: [],
    currency: "TND",
  });
}

describe("une lecture incomplète", () => {
  it("ne laisse plus échapper le message de la bibliothèque", () => {
    let attrape: unknown = null;
    try {
      proposer(FACTURE_SANS_DATE);
    } catch (e) {
      attrape = e;
    }
    assert.ok(attrape instanceof LectureIncomplete);
    // Ni JSON, ni « validation », ni « invalid_string », ni chemin de schéma.
    const message = (attrape as Error).message;
    assert.ok(!message.includes("invalid_string"));
    assert.ok(!message.includes("document_date"));
    assert.ok(!message.includes("[{"));
  });

  it("nomme le champ manquant en langage métier", () => {
    try {
      proposer(FACTURE_SANS_DATE);
      assert.fail("la proposition aurait dû être refusée");
    } catch (e) {
      assert.deepEqual((e as LectureIncomplete).champs, ["date"]);
    }
  });

  it("ne répète pas un champ manquant plusieurs fois", () => {
    // Plusieurs erreurs sur les lignes ne font qu'un seul manque à annoncer.
    try {
      proposer({ ...FACTURE_SANS_DATE, document_date: "2026-09-02", lines: [] });
      assert.fail("la proposition aurait dû être refusée");
    } catch (e) {
      const champs = (e as LectureIncomplete).champs;
      assert.equal(new Set(champs).size, champs.length);
      assert.ok(champs.includes("lignes"));
    }
  });

  it("traduit chaque chemin de schéma en nom métier", () => {
    assert.equal(champMetier(["document_date"]), "date");
    assert.equal(champMetier(["issuer"]), "emetteur");
    assert.equal(champMetier(["lines", 0, "base_ht"]), "lignes");
    // Un chemin inconnu n'est pas tu : mieux vaut un nom brut qu'un silence.
    assert.equal(champMetier(["quelque_chose"]), "quelque_chose");
  });
});

/**
 * ============================================== LE SECOND DÉFAUT
 *
 * `normalizeDate` assemblait trois nombres sans vérifier qu'ils formaient une
 * date. « 2026-13-45 » passe le format ISO du contrat : le Socle l'aurait
 * acceptée, et rangé la facture dans une période de TVA qui n'existe pas.
 */
describe("la normalisation d'une date", () => {
  it("lit le format tunisien, jour d'abord", () => {
    assert.equal(normalizeDate("02/09/2026"), "2026-09-02");
    assert.equal(normalizeDate("2/9/26"), "2026-09-02");
    assert.equal(normalizeDate("02.09.2026"), "2026-09-02");
  });

  it("lit aussi une date déjà en ISO", () => {
    assert.equal(normalizeDate("2026-09-02"), "2026-09-02");
  });

  it("refuse un mois qui n'existe pas", () => {
    assert.equal(normalizeDate("45/13/2026"), null);
    assert.equal(normalizeDate("2026-13-01"), null);
  });

  it("refuse un jour qui n'existe pas dans ce mois", () => {
    assert.equal(normalizeDate("31/02/2026"), null);
    assert.equal(normalizeDate("31/04/2026"), null);
  });

  it("accepte le 29 février d'une année bissextile, et refuse l'autre", () => {
    assert.equal(normalizeDate("29/02/2024"), "2024-02-29");
    assert.equal(normalizeDate("29/02/2026"), null);
  });

  it("ne devine pas une date américaine", () => {
    // « 12/25/2026 » serait le 25 décembre aux États-Unis. Basculer sur
    // mois/jour dès que le premier nombre dépasse 12 reviendrait à deviner la
    // provenance du document — et à dater une écriture au jugé.
    assert.equal(normalizeDate("12/25/2026"), null);
  });

  it("rend rien plutôt que n'importe quoi sur un texte quelconque", () => {
    assert.equal(normalizeDate("Facture"), null);
    assert.equal(normalizeDate(""), null);
  });
});

/**
 * ============================================== LE TROISIÈME DÉFAUT
 *
 * « Base HT 1 » à l'écran, alors que la facture portait 1 000,000 TND.
 *
 * En Tunisie comme en France, les milliers se séparent par une ESPACE. Le
 * découpage en jetons se fait sur les espaces : « 1 000,000 » arrive en deux
 * morceaux. Le schéma prévoit une plage de jetons pour ce cas — et elle
 * n'était honorée que pour le texte. Un total de mille dinars devenait un
 * dinar, sans aucun signalement.
 *
 * C'est le pire genre d'erreur pour un produit fiscal : elle a l'air d'un
 * montant.
 */
describe("un montant coupé par l'espace des milliers", () => {
  const jetons: PageToken[] = [
    { page: 1, ordinal: 0, text: "Total", x0: 0.1, y0: 0.5, x1: 0.2, y1: 0.52 },
    { page: 1, ordinal: 1, text: "1", x0: 0.3, y0: 0.5, x1: 0.32, y1: 0.52 },
    { page: 1, ordinal: 2, text: "000,000", x0: 0.33, y0: 0.5, x1: 0.4, y1: 0.52 },
    { page: 1, ordinal: 3, text: "TND", x0: 0.41, y0: 0.5, x1: 0.45, y1: 0.52 },
  ];

  it("recolle les jetons que le modèle a désignés", () => {
    const r = resolveFromTokenPlan(
      jetons,
      "totals.ttc",
      { page: 1, ordinal: 1, ordinalEnd: 2 },
      "amount",
    );
    assert.equal(r.value, "1000.000");
    assert.equal(r.flag, null);
  });

  it("ne recolle rien de sa propre initiative", () => {
    // Sans plage désignée, on lit le seul jeton cité. Joindre le voisin
    // reviendrait à fabriquer un montant — ce que la règle R2 interdit.
    const r = resolveFromTokenPlan(jetons, "totals.ttc", { page: 1, ordinal: 1 }, "amount");
    assert.equal(r.value, "1");
  });

  it("cite toujours le premier jeton de la plage, pour le surlignage", () => {
    const r = resolveFromTokenPlan(
      jetons,
      "totals.ttc",
      { page: 1, ordinal: 1, ordinalEnd: 2 },
      "amount",
    );
    assert.equal(r.citation?.ordinal, 1);
    assert.equal(r.citation?.ui_role, "montant");
  });
});
