/**
 * 3B-4 et 3B-5 — Les contrôles, et le verdict qu'ils motivent.
 *
 * Chaque contrôle rend un STATUT MOTIVÉ, jamais un booléen : ce qu'il a vu,
 * ce qu'il en conclut, les preuves. Le verdict de la pièce est le plus grave
 * des statuts, et porte la liste des contrôles qui l'ont décidé. Un verdict
 * sans justification est un bug : un test le refuse.
 *
 *   node --experimental-strip-types --test src/scan/controles.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  controlerPiece,
  rendreVerdict,
  type ContexteControle,
  type PieceAControler,
} from "./controles.ts";
import { normaliserMontants } from "./normaliser-montants.ts";

const P = { decimales: 3, toleranceMineure: 1 };
const montantsJustes = normaliserMontants(
  {
    bases: [{ ht: "1 234,560", taux: "0.19" }],
    tva: "234,566",
    autres: ["1,000"],
    ttc: "1 470,126",
  },
  P,
);

/** Une facture d'achat irréprochable, adressée à ALGORIA FACTORY. */
function facture(modif: Partial<PieceAControler> = {}): PieceAControler {
  return {
    documentKind: "facture_achat",
    titre: "FACTURE",
    emetteur: { nom: "FOURNISSEUR SA", identifiantFiscal: "1234567/B/M/000" },
    destinataire: { nom: "ALGORIA FACTORY SARL", identifiantFiscal: "1856324/A/M/000" },
    numero: "F-2026-0042",
    date: "2026-09-10",
    montants: montantsJustes,
    confianceParChamp: { total_ttc: 0.95, numero: 0.9, date: 0.92 },
    reception: { doublonDe: null, recueLe: "2026-09-15" },
    ...modif,
  };
}

/** Le paramétrage — ici fixé par le test ; dans la vraie vie, lu en base, daté. */
const CONTEXTE: ContexteControle = {
  tenant: { nom: "ALGORIA FACTORY SARL", identifiantFiscal: "1856324/A/M/000" },
  typesDocument: [
    { code: "facture_achat", porteEcriture: true },
    { code: "facture_vente", porteEcriture: true },
    { code: "bon_livraison", porteEcriture: false },
  ],
  mentionsObligatoires: [
    { code: "IDENT_FISCAL_EMETTEUR", libelle: "Identifiant fiscal de l'émetteur" },
    { code: "IDENT_FISCAL_CLIENT", libelle: "Identifiant fiscal du client" },
    { code: "DATE_FACTURE", libelle: "Date de la facture" },
    { code: "NUMERO_SEQUENTIEL", libelle: "Numéro séquentiel" },
    { code: "TOTAL_TTC", libelle: "Total TTC" },
    { code: "DESIGNATION", libelle: "Désignation" },
  ],
  seuilConfianceReserve: 0.7,
  seuilConfianceBloquant: 0.4,
  autresPieces: [],
};

const statut = (p: PieceAControler, code: string, ctx = CONTEXTE) =>
  controlerPiece(p, ctx).find((c) => c.code === code)!;

describe("chaque contrôle rend un statut motivé, jamais un booléen", () => {
  it("les sept contrôles, tous présents, tous motivés", () => {
    const cs = controlerPiece(facture(), CONTEXTE);
    assert.deepEqual(
      cs.map((c) => c.code).sort(),
      [
        "coherence_arithmetique",
        "coherence_dates",
        "confiance_lecture",
        "destinataire",
        "doublon",
        "mentions_obligatoires",
        "nature_piece",
      ].sort(),
    );
    for (const c of cs) {
      assert.equal(typeof c.statut, "string");
      assert.ok(c.motif.trim().length > 10, `${c.code} : motif vide`);
    }
  });
});

describe("cohérence arithmétique", () => {
  it("tranchée : conforme, et le motif dit comment", () => {
    const c = statut(facture(), "coherence_arithmetique");
    assert.equal(c.statut, "conforme");
    assert.match(c.motif, /vérifi/);
  });
  it("la facture ne tient pas : anomalie", () => {
    const faux = normaliserMontants(
      { bases: [{ ht: "1 234,560", taux: "0.19" }], ttc: "1 500,000" },
      P,
    );
    assert.equal(statut(facture({ montants: faux }), "coherence_arithmetique").statut, "anomalie");
  });
  it("montants ambigus : anomalie — aucun chiffre ne sera inventé", () => {
    const ambigu = normaliserMontants(
      { bases: [{ ht: "1000000", taux: "0.19" }], ttc: "1190000" },
      P,
    );
    const c = statut(facture({ montants: ambigu }), "coherence_arithmetique");
    assert.equal(c.statut, "anomalie");
    assert.match(c.motif, /saisi|échelle/);
  });
});

describe("mentions obligatoires", () => {
  it("toutes là : conforme ; celles qu'on ne sait pas observer ne comptent pas contre", () => {
    const c = statut(facture(), "mentions_obligatoires");
    assert.equal(c.statut, "conforme");
    assert.deepEqual(c.preuves["non_observables"], ["DESIGNATION"]);
  });
  it("identifiant de l'émetteur absent : réserve, nommée", () => {
    const c = statut(
      facture({ emetteur: { nom: "FOURNISSEUR SA", identifiantFiscal: null } }),
      "mentions_obligatoires",
    );
    assert.equal(c.statut, "reserve");
    assert.deepEqual(c.preuves["manquantes"], ["IDENT_FISCAL_EMETTEUR"]);
  });
});

describe("nature de la pièce", () => {
  it("une facture : conforme", () => {
    assert.equal(statut(facture(), "nature_piece").statut, "conforme");
  });
  it("une proforma n'est pas une facture : rejet — même parfaitement lue", () => {
    const c = statut(facture({ titre: "FACTURE PROFORMA" }), "nature_piece");
    assert.equal(c.statut, "rejet");
    assert.match(c.motif, /proforma/i);
  });
  it("un devis, un bon de livraison : rejet", () => {
    assert.equal(statut(facture({ titre: "DEVIS N° 12" }), "nature_piece").statut, "rejet");
    assert.equal(
      statut(facture({ documentKind: "bon_livraison" }), "nature_piece").statut,
      "rejet",
    );
  });
  it("nature inconnue : réserve", () => {
    assert.equal(statut(facture({ documentKind: null }), "nature_piece").statut, "reserve");
  });
});

describe("destinataire", () => {
  it("adressée au tenant — matricule écrit autrement, même identité : conforme", () => {
    const c = statut(
      facture({ destinataire: { nom: "ALGORIA", identifiantFiscal: "1856324 A M 000" } }),
      "destinataire",
    );
    assert.equal(c.statut, "conforme");
  });
  it("adressée à un autre : rejet, et le motif dit à qui", () => {
    const c = statut(
      facture({ destinataire: { nom: "AUTRE SARL", identifiantFiscal: "9999999/Z/M/000" } }),
      "destinataire",
    );
    assert.equal(c.statut, "rejet");
    assert.match(c.motif, /9999999/);
  });
  it("destinataire non identifié : réserve", () => {
    assert.equal(
      statut(facture({ destinataire: { nom: null, identifiantFiscal: null } }), "destinataire")
        .statut,
      "reserve",
    );
  });
  it("une vente : c'est l'émetteur qui doit être le tenant", () => {
    const vente = facture({
      documentKind: "facture_vente",
      emetteur: { nom: "ALGORIA FACTORY SARL", identifiantFiscal: "1856324/A/M/000" },
      destinataire: { nom: "CLIENT SA", identifiantFiscal: "7654321/C/M/000" },
    });
    assert.equal(statut(vente, "destinataire").statut, "conforme");
  });
  it("le tenant n'a pas de matricule : non évaluable, dit tel", () => {
    const c = statut(facture(), "destinataire", {
      ...CONTEXTE,
      tenant: { nom: "X", identifiantFiscal: null },
    });
    assert.equal(c.statut, "non_evaluable");
  });
});

describe("doublon", () => {
  it("doublon strict, vu à la réception : rejet, et l'original est nommé", () => {
    const c = statut(
      facture({ reception: { doublonDe: "piece-1", recueLe: "2026-09-15" } }),
      "doublon",
    );
    assert.equal(c.statut, "rejet");
    assert.equal(c.preuves["original"], "piece-1");
  });
  it("même émetteur, même numéro qu'une autre pièce : à rapprocher", () => {
    const c = statut(facture(), "doublon", {
      ...CONTEXTE,
      autresPieces: [
        { id: "piece-7", emetteurIdentifiantFiscal: "1234567 B M 000", numero: "f-2026-0042" },
      ],
    });
    assert.equal(c.statut, "rapprocher");
    assert.equal(c.preuves["semblable"], "piece-7");
  });
});

describe("cohérence des dates", () => {
  it("datée après sa réception : anomalie", () => {
    assert.equal(statut(facture({ date: "2026-10-01" }), "coherence_dates").statut, "anomalie");
  });
  it("date illisible : réserve", () => {
    assert.equal(statut(facture({ date: null }), "coherence_dates").statut, "reserve");
  });
});

describe("confiance de lecture — seuils du paramétrage", () => {
  it("sous le seuil de réserve : réserve, et le champ est nommé", () => {
    const c = statut(
      facture({ confianceParChamp: { total_ttc: 0.6, numero: 0.9 } }),
      "confiance_lecture",
    );
    assert.equal(c.statut, "reserve");
    assert.deepEqual(c.preuves["champs"], ["total_ttc"]);
  });
  it("sous le seuil bloquant : anomalie", () => {
    assert.equal(
      statut(facture({ confianceParChamp: { total_ttc: 0.3 } }), "confiance_lecture").statut,
      "anomalie",
    );
  });
  it("les seuils viennent du contexte, pas du contrôle", () => {
    const p = facture({ confianceParChamp: { total_ttc: 0.6 } });
    assert.equal(
      statut(p, "confiance_lecture", { ...CONTEXTE, seuilConfianceReserve: 0.5 }).statut,
      "conforme",
    );
  });
});

describe("le verdict", () => {
  it("tout est conforme : à comptabiliser — et il dit pourquoi", () => {
    const v = rendreVerdict(controlerPiece(facture(), CONTEXTE));
    assert.equal(v.verdict, "à comptabiliser");
    assert.ok(v.motifs.length > 0);
  });
  it("des réserves : à comptabiliser avec réserve, motivé par chacune", () => {
    const v = rendreVerdict(controlerPiece(facture({ date: null }), CONTEXTE));
    assert.equal(v.verdict, "à comptabiliser avec réserve");
    // Une date illisible est deux choses : une mention obligatoire absente, et
    // une période qui reste à décider. Les deux contrôles le voient ; les deux motivent.
    assert.deepEqual(v.motifs.map((m) => m.code).sort(), [
      "coherence_dates",
      "mentions_obligatoires",
    ]);
  });
  it("une proforma parfaitement lue : à rejeter", () => {
    const v = rendreVerdict(controlerPiece(facture({ titre: "PROFORMA" }), CONTEXTE));
    assert.equal(v.verdict, "à rejeter");
    assert.deepEqual(
      v.motifs.map((m) => m.code),
      ["nature_piece"],
    );
  });
  it("à rapprocher", () => {
    const v = rendreVerdict(
      controlerPiece(facture(), {
        ...CONTEXTE,
        autresPieces: [
          { id: "p", emetteurIdentifiantFiscal: "1234567/B/M/000", numero: "F-2026-0042" },
        ],
      }),
    );
    assert.equal(v.verdict, "à rapprocher");
  });
  it("anomalie à signaler", () => {
    const v = rendreVerdict(controlerPiece(facture({ date: "2027-01-01" }), CONTEXTE));
    assert.equal(v.verdict, "anomalie à signaler");
  });
  it("le plus grave l'emporte, et TOUS les contrôles de ce rang motivent", () => {
    const v = rendreVerdict(
      controlerPiece(
        facture({
          titre: "PROFORMA",
          reception: { doublonDe: "x", recueLe: "2026-09-15" },
          date: null,
        }),
        CONTEXTE,
      ),
    );
    assert.equal(v.verdict, "à rejeter");
    assert.deepEqual(v.motifs.map((m) => m.code).sort(), ["doublon", "nature_piece"]);
  });
  it("un verdict sans motif est refusé", () => {
    assert.throws(() => rendreVerdict([]), /motif/);
  });
});
