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
    emetteur: { nom: "FOURNISSEUR SA", identifiantFiscal: "1234567B/B/M/000" },
    destinataire: { nom: "ALGORIA FACTORY SARL", identifiantFiscal: "1856324K/A/M/000" },
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
  tenant: { nom: "ALGORIA FACTORY SARL", identifiantFiscal: "1856324K/A/M/000" },
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
  // Soixante jours, comme le pack tunisien : au-delà, l'écart entre la date de
  // la pièce et celle de sa réception est signalé.
  ecartDateJours: 60,
  autresPieces: [],
};

const statut = (p: PieceAControler, code: string, ctx = CONTEXTE) =>
  controlerPiece(p, ctx).find((c) => c.code === code)!;

describe("chaque contrôle rend un statut motivé, jamais un booléen", () => {
  it("les huit contrôles, tous présents, tous motivés", () => {
    /*
     * La liste est écrite en entier, exprès : un contrôle qui disparaîtrait
     * d'un refactoring ne se verrait nulle part ailleurs, et le produit
     * continuerait à rendre des verdicts — avec un garde en moins.
     *
     * `sens_de_la_piece` est le huitième, ajouté le 5 octobre 2026.
     */
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
        "sens_de_la_piece",
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

  /**
   * ============== UN MONTANT INCOHÉRENT N'EST PAS UN MONTANT ABSENT
   *
   * Relevé le 5 octobre 2026 sur la facture de loyer du 4. Elle imprimait très
   * lisiblement sa base, sa TVA et son total — et le produit a répondu :
   *
   *   « Mentions obligatoires absentes ou illisibles : Date de la facture,
   *     Base imposable hors taxes, Montant de la TVA, Total toutes taxes
   *     comprises. »
   *
   * Trois de ces quatre reproches étaient faux. La cause est en amont : quand
   * la normalisation conclut `incoherent`, `vide()` met tous les montants à
   * `null`, et ce contrôle lisait la SORTIE de la normalisation au lieu de ce
   * que la pièce porte.
   *
   * C'est la pire espèce de message : vérifiable, et faux. La personne regarde
   * un total imprimé en gras et lit qu'il est absent — après quoi elle ne croit
   * plus aucun message du produit, y compris les justes.
   */
  it("une mention imprimée reste présente, même quand la facture ne tient pas", () => {
    const incoherent = normaliserMontants(
      // Les valeurs exactes sorties en production : les montants coupés par
      // l'espace des milliers réduits à leur premier jeton.
      { bases: [{ ht: "3", taux: "0.19" }], tva: "573,800", ttc: "3" },
      P,
    );
    const c = statut(facture({ montants: incoherent }), "mentions_obligatoires");
    assert.deepEqual(
      c.preuves["manquantes"],
      [],
      "la pièce imprime son total : il n'est pas « absent ou illisible »",
    );
    assert.equal(c.statut, "conforme");
  });

  it("et une mention vraiment absente le reste", () => {
    // La correction ne doit pas rendre ce contrôle complaisant : un TTC que la
    // pièce ne porte pas manque toujours.
    const sansTtc = normaliserMontants({ bases: [{ ht: "1 000,000", taux: "0.19" }] }, P);
    const c = statut(facture({ montants: sansTtc }), "mentions_obligatoires");
    assert.deepEqual(c.preuves["manquantes"], ["TOTAL_TTC"]);
    assert.equal(c.statut, "reserve");
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
      facture({ destinataire: { nom: "ALGORIA", identifiantFiscal: "1856324K A M 000" } }),
      "destinataire",
    );
    assert.equal(c.statut, "conforme");
  });
  it("adressée à un autre : rejet, et le motif dit à qui", () => {
    const c = statut(
      facture({ destinataire: { nom: "AUTRE SARL", identifiantFiscal: "9999999Z/Z/M/000" } }),
      "destinataire",
    );
    assert.equal(c.statut, "rejet");
    assert.match(c.motif, /9999999/);
  });
  it("un matricule SANS lettre de contrôle ne se confond pas avec un autre", () => {
    /*
     * ============================ LE PIÈGE QUE CE CONTRÔLE PORTAIT EN PRODUCTION
     *
     * Ce fichier avait sa propre version du normaliseur : elle compactait la
     * chaîne puis prenait la première lettre venue pour la lettre de
     * contrôle. Sur « 1856324/A/M/000 » — qui n'en porte PAS — elle rendait
     * « 1856324A », fabriquant une identité à partir du CODE DE TVA.
     *
     * Le dossier porte « 1856324K/A/M/000 », de lettre de contrôle K. La
     * pièce ci-dessous porte les mêmes sept chiffres sans lettre : on ne sait
     * donc PAS si c'est la même entreprise, et l'ancienne version répondait
     * « 1856324A ≠ 1856324K », donc REJET — pour une raison inventée.
     *
     * Le Socle, lui, sait dire qu'un matricule est partiel. Le verdict ne
     * doit pas être un rejet : on ne rejette pas sur ce qu'on n'a pas lu.
     */
    const c = statut(
      facture({ destinataire: { nom: "ALGORIA", identifiantFiscal: "1856324/A/M/000" } }),
      "destinataire",
    );
    assert.notEqual(
      c.statut,
      "rejet",
      "un matricule incomplet ne prouve rien, ni dans un sens ni dans l'autre",
    );
  });

  it("et deux entreprises que l'ancienne version confondait restent distinctes", () => {
    /*
     * « 1856324A/B/M/000 » : lettre de contrôle A, code de TVA B. L'ancienne
     * version la compactait en « 1856324AB... » et en tirait « 1856324A »,
     * exactement la clé qu'elle fabriquait pour « 1856324/A/M/000 ». Deux
     * entreprises différentes, une seule clé.
     *
     * Ici le dossier est « 1856324K/… » : les deux sont étrangères au
     * dossier, et c'est bien un rejet — mais pour la bonne raison.
     */
    const c = statut(
      facture({ destinataire: { nom: "AUTRE", identifiantFiscal: "1856324A/B/M/000" } }),
      "destinataire",
    );
    assert.equal(c.statut, "rejet");
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
      emetteur: { nom: "ALGORIA FACTORY SARL", identifiantFiscal: "1856324K/A/M/000" },
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

/**
 * ================ LE SENS DE LA PIÈCE DOIT TENIR AVEC CE QU'ELLE PORTE
 *
 * Trouvé le 5 octobre 2026 en mesurant les modèles de désignation.
 * `deepseek-chat` a rendu, sur la facture de loyer :
 *
 *   document_kind              "facture_vente"
 *   issuer                     « Mme Leila BEN SALEM »
 *   matricule_fiscal           celui d'ALGORIA  (le dossier)
 *   matricule_fiscal_client    celui du bailleur
 *
 * Tout est inversé, et COHÉRENT dans son inversion. Le contrôle `destinataire`
 * ne regarde qu'UNE partie — l'émetteur pour une vente — y trouve le matricule
 * du dossier, et conclut « conforme ». La pièce partirait donc en VENTE dans
 * les comptes du client, sur une facture d'achat.
 *
 * Aucune arithmétique ne rattrape cela : le sens n'est pas un montant. C'est la
 * définition même de l'erreur silencieuse.
 *
 * Ce qui la trahit est à l'intérieur de la pièce : une vente émise par le
 * dossier porte le NOM du dossier comme émetteur. Ici, l'émetteur s'appelle
 * « Mme Leila BEN SALEM ». La contradiction se voit sans modèle, sans
 * référentiel, et sans arithmétique.
 */
describe("le sens de la pièce, confronté à ce qu'elle porte", () => {
  it("une vente dont l'émetteur n'est pas le dossier est une contradiction", () => {
    const c = statut(
      facture({
        documentKind: "facture_vente",
        // Le matricule du dossier mis du côté de l'émetteur : l'inversion.
        emetteur: { nom: "Mme Leila BEN SALEM", identifiantFiscal: "1856324K/A/M/000" },
        destinataire: { nom: null, identifiantFiscal: "1234567B/B/M/000" },
      }),
      "sens_de_la_piece",
    );
    assert.equal(c.statut, "anomalie");
    assert.match(c.motif, /Mme Leila BEN SALEM/, "le motif nomme l'émetteur lu");
  });

  it("une vente réellement émise par le dossier est conforme", () => {
    const c = statut(
      facture({
        documentKind: "facture_vente",
        emetteur: { nom: "ALGORIA FACTORY SARL", identifiantFiscal: "1856324K/A/M/000" },
        destinataire: { nom: "CLIENT SA", identifiantFiscal: "1234567B/B/M/000" },
      }),
      "sens_de_la_piece",
    );
    assert.equal(c.statut, "conforme");
  });

  it("un achat dont l'émetteur est le dossier est la même contradiction, à l'envers", () => {
    const c = statut(
      facture({
        documentKind: "facture_achat",
        emetteur: { nom: "ALGORIA FACTORY SARL", identifiantFiscal: "1234567B/B/M/000" },
      }),
      "sens_de_la_piece",
    );
    assert.equal(c.statut, "anomalie");
  });

  it("un achat ordinaire est conforme", () => {
    assert.equal(statut(facture(), "sens_de_la_piece").statut, "conforme");
  });

  it("sans nom d'émetteur lu, le contrôle ne se prononce pas", () => {
    // Ne rien pouvoir vérifier n'est pas une anomalie. Une pièce dont le nom de
    // l'émetteur est illisible a déjà sa réserve au contrôle des mentions.
    const c = statut(
      facture({ documentKind: "facture_vente", emetteur: { nom: null, identifiantFiscal: null } }),
      "sens_de_la_piece",
    );
    assert.equal(c.statut, "non_evaluable");
  });

  it("sans sens déterminé, le contrôle ne se prononce pas non plus", () => {
    // `document_kind` null veut dire « la personne tranchera » : on ne lui
    // reproche pas une contradiction qu'elle n'a pas encore eu l'occasion de
    // lever.
    const c = statut(facture({ documentKind: null }), "sens_de_la_piece");
    assert.equal(c.statut, "non_evaluable");
  });

  it("reconnaît le dossier malgré la forme juridique et la casse", () => {
    /*
     * « ALGORIA FACTORY SARL » dans la fiche, « Algoria Factory » sur la pièce :
     * c'est la même entreprise. Un contrôle qui exigerait l'égalité stricte
     * crierait sur toutes les ventes, et on apprendrait à l'ignorer.
     */
    const c = statut(
      facture({
        documentKind: "facture_vente",
        emetteur: { nom: "Algoria Factory", identifiantFiscal: "1856324K/A/M/000" },
      }),
      "sens_de_la_piece",
    );
    assert.equal(c.statut, "conforme");
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
          { id: "p", emetteurIdentifiantFiscal: "1234567B/B/M/000", numero: "F-2026-0042" },
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

/**
 * Une date trop ancienne se signale.
 *
 * ================================================================= POURQUOI
 *
 * Vérification comptable du 11 octobre 2026. L'écran de la pièce propose le
 * jour du scan quand la date n'a pas été lue — affiché et modifiable, donc pas
 * le repli implicite que R4 interdit. Mais rien ne distinguait une date
 * VÉRIFIÉE d'une date acceptée sans la lire, et une facture de janvier
 * confirmée en mars part dans la déclaration de mars.
 */
describe("l'écart entre la date de la pièce et sa réception", () => {
  const dateDe = (r: ReturnType<typeof controlerPiece>) =>
    r.find((c) => c.code === "coherence_dates")!;

  it("un écart ordinaire ne dit rien", () => {
    const c = dateDe(
      controlerPiece(
        facture({ date: "2026-09-01", reception: { doublonDe: null, recueLe: "2026-09-15" } }),
        CONTEXTE,
      ),
    );
    assert.equal(c.statut, "conforme");
    assert.equal(c.preuves["ecartJours"], 14);
  });

  it("au-delà du seuil du pack, la pièce est SIGNALÉE — pas refusée", () => {
    /*
     * Signalée, parce qu'un dirigeant qui rattrape six mois de factures saisit
     * des dates de six mois, et c'est légitime. Refuser rendrait le rattrapage
     * impossible, et c'est le cas d'usage le plus courant.
     */
    const c = dateDe(
      controlerPiece(
        facture({ date: "2026-01-10", reception: { doublonDe: null, recueLe: "2026-09-15" } }),
        CONTEXTE,
      ),
    );
    assert.equal(c.statut, "reserve");
    assert.equal(c.preuves["seuilJours"], 60);
    assert.ok(Number(c.preuves["ecartJours"]) > 60);
  });

  it("et le seuil vient du PACK, pas du code", () => {
    // Le même écart, un seuil plus large : plus de signalement. C'est la
    // preuve que le nombre est lu et non écrit (R4).
    const c = dateDe(
      controlerPiece(
        facture({ date: "2026-01-10", reception: { doublonDe: null, recueLe: "2026-09-15" } }),
        { ...CONTEXTE, ecartDateJours: 400 },
      ),
    );
    assert.equal(c.statut, "conforme");
  });

  it("une date À VENIR reste une anomalie, et non une réserve", () => {
    // Elle ne s'explique par aucun rattrapage : une pièce ne peut pas être
    // datée après le jour où on l'a reçue.
    const c = dateDe(
      controlerPiece(
        facture({ date: "2026-10-01", reception: { doublonDe: null, recueLe: "2026-09-15" } }),
        CONTEXTE,
      ),
    );
    assert.equal(c.statut, "anomalie");
  });
});
