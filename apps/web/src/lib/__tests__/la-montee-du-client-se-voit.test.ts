/**
 * La comptabilité voit la montée faite par le client (recette du
 * 11 novembre 2026, point 1.2).
 *
 * Couvert en Team, monté en Premium à sa charge : « offre actuelle » désigne
 * Premium, et la comptabilité ne « monte » pas vers une offre qu'il a déjà.
 */
import { describe, expect, it } from "vitest";

import type { EtatDuClient } from "@malica/socle/ports/repositories";

import { effetDuChoix, offreActuelle } from "../etat-des-clients";

const OFFRES = [
  { code: "basic", rang: 1 },
  { code: "solo", rang: 2 },
  { code: "team", rang: 3 },
  { code: "premium", rang: 4 },
];

function etat(accesOffre: string, forfaitOffre: string): EtatDuClient {
  return {
    tenantId: "pme",
    adresse: null,
    dirigeantPresent: true,
    invitationEmail: null,
    invitationEnvoyee: null,
    invitationExpiree: false,
    accesId: "a-1",
    accesStatut: "actif",
    accesOffre,
    descenteOffre: null,
    licenceId: "l-1",
    titulaireNom: "Samia Ben Salah",
    forfaitOffre,
    organisations: 1,
    organisationsIncluses: 1,
    siegesOccupes: 0,
    siegesInclus: 2,
    placesEnAttente: 0,
  };
}

describe("la montée du client se voit côté comptabilité", () => {
  it("couvert en Team, monté en Premium : l'offre actuelle est Premium", () => {
    expect(offreActuelle(etat("team", "premium"), OFFRES)).toBe("premium");
    expect(offreActuelle(etat("team", "team"), OFFRES)).toBe("team");
  });

  it("choisir Premium, monté à sa charge, c'est le prendre en charge (B7) ; Team reste l'offre payée", () => {
    const e = etat("team", "premium");
    expect(effetDuChoix(e, "premium", OFFRES)).toBe("prise_en_charge");
    expect(effetDuChoix(e, "team", OFFRES)).toBe("actuelle");
    expect(effetDuChoix(e, "solo", OFFRES)).toBe("descente");
  });

  it("sans montée du client, rien ne change", () => {
    const e = etat("team", "team");
    expect(effetDuChoix(e, "premium", OFFRES)).toBe("montee");
    expect(effetDuChoix(e, "team", OFFRES)).toBe("actuelle");
  });
});

describe("la proposition de couverture dit son effet (recette 3.7)", () => {
  it("le dirigeant est là : la proposition attend sa réponse, pas son arrivée", () => {
    const present = { ...etat("team", "team"), accesStatut: "propose" };
    expect(effetDuChoix(present, "team", OFFRES)).toBe("attente_reponse");
    expect(effetDuChoix({ ...present, dirigeantPresent: false }, "team", OFFRES)).toBe(
      "attente_dirigeant",
    );
  });
});
