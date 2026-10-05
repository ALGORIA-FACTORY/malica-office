/**
 * Le sens d'une pièce se déduit, il ne se devine pas.
 *
 * ================================================================= POURQUOI
 *
 * Le 5 octobre 2026, un modèle de désignation a rendu « facture_vente » sur une
 * facture d'achat, avec les deux matricules inversés — faux, et cohérent dans
 * son inversion, donc invisible au contrôle du destinataire qui ne regarde
 * qu'une partie. La pièce serait partie en vente dans les comptes du client.
 *
 * Le dossier connaît son propre matricule : le sens n'a donc pas à être
 * deviné. Les cas ci-dessous disent la déduction, et surtout les trois
 * situations où elle refuse de trancher — parce qu'un défaut silencieux sur le
 * sens d'une pièce vaut une écriture fausse.
 */
import { describe, expect, it } from "vitest";

import { lireLeSens } from "../sens-de-la-piece.ts";

/** Le dossier d'essai : ALGORIA FACTORY, matricule fictif mais bien formé. */
const DOSSIER = "1876543W/A/M/000";
/** Un tiers : le bailleur de la facture de loyer du 4 octobre. */
const TIERS = "1456987L/A/P/000";

describe("le sens déduit des matricules", () => {
  it("le dossier côté client : c'est un achat", () => {
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: TIERS,
      matriculeClient: DOSSIER,
      sensDuModele: "facture_achat",
    });
    expect(r.sens).toBe("facture_achat");
    expect(r.origine).toBe("matricule_client");
    expect(r.signalement).toBeNull();
  });

  it("le dossier côté émetteur : c'est une vente", () => {
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: DOSSIER,
      matriculeClient: TIERS,
      sensDuModele: "facture_vente",
    });
    expect(r.sens).toBe("facture_vente");
    expect(r.origine).toBe("matricule_emetteur");
    expect(r.signalement).toBeNull();
  });

  it("la déduction gagne contre le modèle, et la divergence se dit", () => {
    /*
     * LE CAS DU 5 OCTOBRE, exactement. Le modèle dit « vente », les matricules
     * disent « achat ». La comparaison tranche, et le signalement avertit que
     * le reste de la lecture est probablement inversé aussi — c'est cela qui
     * manquait : l'erreur ne portait pas sur un champ, mais sur tous.
     */
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: TIERS,
      matriculeClient: DOSSIER,
      sensDuModele: "facture_vente",
    });
    expect(r.sens).toBe("facture_achat");
    expect(r.origine).toBe("matricule_client");
    expect(r.signalement).toMatch(/matricule qui tranche/);
    expect(r.signalement).toMatch(/à relire/);
  });

  it("déduit même quand le modèle n'a rien proposé", () => {
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: TIERS,
      matriculeClient: DOSSIER,
      sensDuModele: null,
    });
    expect(r.sens).toBe("facture_achat");
    expect(r.signalement).toBeNull();
  });

  it("reconnaît le dossier quelle que soit l'écriture du matricule", () => {
    // La pièce imprime « MF : ١٨٧٦٥٤٣W A M 000 », la fiche « 1876543W/A/M/000 ».
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: TIERS,
      matriculeClient: "MF : ١٨٧٦٥٤٣W A M 000",
      sensDuModele: null,
    });
    expect(r.sens).toBe("facture_achat");
  });

  it("un établissement secondaire est le même dossier", () => {
    // Une facture adressée à la succursale concerne bien l'entreprise.
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: TIERS,
      matriculeClient: "1876543W/A/E/042",
      sensDuModele: null,
    });
    expect(r.sens).toBe("facture_achat");
    expect(r.origine).toBe("matricule_client");
  });
});

describe("les trois situations qui ne se tranchent pas toutes seules", () => {
  it("le dossier des DEUX côtés : à confirmer", () => {
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: DOSSIER,
      matriculeClient: DOSSIER,
      sensDuModele: "facture_achat",
    });
    expect(r.sens).toBeNull();
    expect(r.origine).toBe("a_confirmer");
    expect(r.signalement).toMatch(/deux côtés/);
  });

  it("le dossier d'AUCUN des deux, alors que les deux sont lus : à confirmer", () => {
    // La pièce concerne peut-être une autre entreprise. On ne choisit pas un
    // sens par défaut sur une pièce qui n'est peut-être pas la nôtre.
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: TIERS,
      matriculeClient: "1234567B/B/M/000",
      sensDuModele: "facture_achat",
    });
    expect(r.sens).toBeNull();
    expect(r.origine).toBe("a_confirmer");
    expect(r.signalement).toMatch(/autre entreprise/);
  });

  it("un matricule INCOMPLET : à confirmer, jamais comparé sur sept chiffres", () => {
    /*
     * « 1856324/A/M/000 » n'a pas de lettre de contrôle. Comparer sur les sept
     * chiffres seuls ferait coïncider deux entreprises différentes, et une
     * coïncidence silencieuse sur le sens d'une pièce vaut une écriture fausse.
     *
     * Sur une pièce lue, cela produit une QUESTION — jamais un rejet du
     * document, qui n'y est pour rien.
     */
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: TIERS,
      matriculeClient: "1856324/A/M/000",
      sensDuModele: "facture_achat",
    });
    expect(r.sens).toBeNull();
    expect(r.origine).toBe("a_confirmer");
    expect(r.signalement).toMatch(/lettre de contrôle manque/);
    expect(r.signalement).toMatch(/client/);
  });
});

describe("quand le modèle est le seul recours", () => {
  it("aucun matricule lu : le modèle tranche, et c'est tracé", () => {
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: null,
      matriculeClient: null,
      sensDuModele: "facture_achat",
    });
    expect(r.sens).toBe("facture_achat");
    expect(r.origine).toBe("modele");
    expect(r.signalement).toBeNull();
  });

  it("aucun matricule lu ET le modèle muet : à confirmer", () => {
    const r = lireLeSens({
      matriculeDossier: DOSSIER,
      matriculeEmetteur: null,
      matriculeClient: null,
      sensDuModele: null,
    });
    expect(r.sens).toBeNull();
    expect(r.signalement).toMatch(/Aucun matricule/);
  });

  it("le dossier sans matricule : le modèle tranche, et on DIT qu'on n'a pas vérifié", () => {
    /*
     * Une entreprise en cours d'immatriculation s'inscrit sans matricule
     * (R10 : un défaut n'est pas un blocage). Le sens repose alors entièrement
     * sur le modèle — ce qui est acceptable, à condition que ce ne soit pas
     * confondu avec une vérification.
     */
    const r = lireLeSens({
      matriculeDossier: null,
      matriculeEmetteur: TIERS,
      matriculeClient: DOSSIER,
      sensDuModele: "facture_achat",
    });
    expect(r.sens).toBe("facture_achat");
    expect(r.origine).toBe("modele");
    expect(r.signalement).toMatch(/n'a pas de matricule fiscal enregistré/);
  });

  it("le dossier avec un matricule INCOMPLET est traité comme sans", () => {
    // Une fiche mal saisie ne doit pas produire une déduction qui a l'air sûre.
    const r = lireLeSens({
      matriculeDossier: "1856324/A/M/000",
      matriculeEmetteur: TIERS,
      matriculeClient: "1856324/A/M/000",
      sensDuModele: "facture_achat",
    });
    expect(r.origine).toBe("modele");
    expect(r.signalement).toMatch(/pas de matricule fiscal enregistré/);
  });
});
