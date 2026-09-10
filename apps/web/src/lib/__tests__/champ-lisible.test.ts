import { describe, expect, it } from "vitest";

import {
  libelleDeLAction,
  libelleDuChamp,
  libelleDuCode,
  valeurDuChamp,
  valeurLisible,
} from "../champ-lisible";

describe("valeurLisible", () => {
  it("met un montant dans les séparateurs de la langue", () => {
    expect(valeurLisible("totals.ttc", "404.600", "fr")).toBe("404,600");
    expect(valeurLisible("articles[0].unit_price_ht", "14.000", "en")).toBe("14.000");
  });

  it("met une date au format de la langue", () => {
    expect(valeurLisible("document_date", "2026-09-30", "fr")).toBe("30/09/2026");
  });

  it("laisse un texte tel quel, et un montant qui n'en est pas un", () => {
    expect(valeurLisible("issuer", "GROSSISTE DU SUD", "fr")).toBe("GROSSISTE DU SUD");
    expect(valeurLisible("totals.ttc", "quatre cents", "fr")).toBe("quatre cents");
    expect(valeurLisible("references.numero", "4488", "fr")).toBe("4488");
  });
});

/** Un traducteur d'épreuve : rend la clé, avec ses variables, pour lire ce qui a été choisi. */
const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}(${Object.values(vars).join(",")})` : key;

describe("libelleDuChamp", () => {
  it("nomme un article par son rang et sa feuille", () => {
    expect(libelleDuChamp("articles[3].designation", t as never)).toBe(
      "cab.champ.article(4) · pme.extract.designation",
    );
    expect(libelleDuChamp("lines[0].vat_amount", t as never)).toBe(
      "cab.champ.ligne(1) · pme.extract.vat",
    );
    expect(libelleDuChamp("other_charges[0].amount", t as never)).toBe(
      "cab.champ.droit(1) · pme.extract.charges",
    );
  });

  it("efface les conteneurs sans sens pour la personne", () => {
    expect(libelleDuChamp("totals.base_ht", t as never)).toBe("pme.extract.base");
    expect(libelleDuChamp("references.matricule_fiscal", t as never)).toBe("cab.champ.matricule");
    expect(libelleDuChamp("issuer", t as never)).toBe("pme.extract.issuer");
  });

  it("ne rend jamais un chemin brut, même inconnu", () => {
    expect(libelleDuChamp("nouveau_champ", t as never)).toBe("nouveau champ");
    expect(libelleDuChamp("bidules[1].truc_machin", t as never)).toBe("bidules 2 · truc machin");
  });
});

describe("valeurDuChamp", () => {
  const payload = {
    issuer: "MYTEK",
    totals: { ttc: "510.000" },
    articles: [{ designation: "Office 365", quantity: 1 }, { designation: "Encre" }],
  };

  it("suit le chemin jusqu'à la valeur", () => {
    expect(valeurDuChamp(payload, "issuer")).toBe("MYTEK");
    expect(valeurDuChamp(payload, "totals.ttc")).toBe("510.000");
    expect(valeurDuChamp(payload, "articles[1].designation")).toBe("Encre");
    expect(valeurDuChamp(payload, "articles[0].quantity")).toBe("1");
  });

  it("rend rien quand le chemin ne mène nulle part", () => {
    expect(valeurDuChamp(payload, "articles[7].designation")).toBeNull();
    expect(valeurDuChamp(payload, "totals.vat")).toBeNull();
    expect(valeurDuChamp(null, "issuer")).toBeNull();
    expect(valeurDuChamp(payload, "articles")).toBeNull();
  });
});

describe("codes et actions", () => {
  it("traduit un code connu et retombe sur une phrase générique", () => {
    expect(libelleDuCode("direction.incertaine", t as never)).toBe("cab.code.direction");
    expect(libelleDuCode("inconnu", t as never)).toBe("cab.code.autre");
  });

  it("nomme l'hésitation sur un montant, et la décision qui l'a levée", () => {
    // « Signalement de lecture » ne dit pas quoi faire. Ces deux-là, si :
    // l'un demande une confirmation, l'autre explique pourquoi il n'y en a pas.
    expect(libelleDuCode("SEPARATEUR_AMBIGU", t as never)).toBe("cab.code.separateur");
    expect(libelleDuCode("DECIDE_PAR_ARITHMETIQUE", t as never)).toBe("cab.code.arithmetique");
  });

  it("traduit une action d'audit et retombe sur une phrase générique", () => {
    expect(libelleDeLAction("extract.v1", t as never)).toBe("cab.audit.extract");
    expect(libelleDeLAction("ecriture.booked", t as never)).toBe("cab.notif.kind.ecriture.booked");
    expect(libelleDeLAction("immo.prorata", t as never)).toBe("cab.audit.autre");
  });
});
