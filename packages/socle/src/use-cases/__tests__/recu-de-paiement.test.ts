/**
 * Le reçu de dépense ou de revenu.
 *
 * ================================================================= POURQUOI
 *
 * 10 octobre 2026 : « Malica génère le reçu de dépense ou de revenu et le
 * moyen de paiement. »
 *
 * Le type `recu_de_paiement` existait en base depuis le 11, avec
 * `porte_ecriture = false`, et rien ne le produisait.
 *
 * ====================================== POURQUOI LE CONTENU VIT DANS LE SOCLE
 *
 * Un reçu est un document qui porte des chiffres, remis à un tiers. S'il
 * était composé dans un écran, la première juridiction à deux décimales en
 * aurait fait un document faux — et un document faux signé est pire qu'un
 * document absent.
 *
 * Le Socle construit donc le CONTENU, de façon pure et testable ; un
 * dessinateur le met en page. Tout ce qui pouvait se tromper est ici.
 */
import { describe, expect, it } from "vitest";

import { construireRecu, type EntreeRecu } from "../recu-de-paiement.ts";

const BASE: EntreeRecu = {
  sens: "depense",
  decimales: 3,
  devise: "TND",
  dossier: { nom: "ALGORIA FACTORY SUARL", matricule: "1876543W/A/M/000" },
  tiers: "SOTUPAP",
  piece: { reference: "FA-2026-0147", date: "2026-09-01" },
  paiements: [
    { moyen: "Chèque", montant: "500.000", date: "2026-10-09" },
    { moyen: "Espèces", montant: "113.493", date: "2026-10-03" },
  ],
  mentions: ["Identifiant fiscal de l'émetteur"],
  libelles: {
    titreDepense: "Reçu de dépense",
    titreRevenu: "Reçu de revenu",
    dossier: "Dossier",
    matricule: "Matricule fiscal",
    tiers: "Tiers",
    piece: "Pièce",
    date: "Date",
    moyen: "Moyen",
    montant: "Montant",
    total: "Total payé",
    emisLe: "Émis le",
  },
  emisLe: "2026-10-11",
};

describe("le reçu de paiement", () => {
  it("additionne les paiements dans la plus petite unité, pas en flottant", () => {
    // 500,000 + 113,493. En flottant, ce genre de somme rend 613,4929999.
    // Un reçu remis à un tiers ne porte pas une décimale fantôme.
    expect(construireRecu(BASE).total).toBe("613.493");
  });

  it("un acompte et un solde font DEUX lignes : le reçu dit comment on a payé", () => {
    const r = construireRecu(BASE);
    expect(r.paiements.map((p) => p.moyen)).toEqual(["Chèque", "Espèces"]);
    expect(r.paiements.map((p) => p.montant)).toEqual(["500.000", "113.493"]);
  });

  it("le titre suit le sens, et il n'y a pas de sens par défaut", () => {
    expect(construireRecu(BASE).titre).toBe("Reçu de dépense");
    expect(construireRecu({ ...BASE, sens: "revenu" }).titre).toBe("Reçu de revenu");
  });

  it("les décimales viennent du pack : deux ne rendent pas trois", () => {
    /*
     * La raison d'être de ce module. « 500.000 » lu à deux décimales vaut
     * 500,00 — pas 500,000 — et un reçu qui affiche une décimale de trop sur
     * un montant juste est un document qu'un contrôleur refuse.
     */
    const r = construireRecu({
      ...BASE,
      decimales: 2,
      devise: "EUR",
      paiements: [{ moyen: "Virement", montant: "500.00", date: "2026-10-09" }],
    });
    expect(r.total).toBe("500.00");
  });

  it("un reçu SANS paiement est refusé", () => {
    // Il n'atteste de rien. Le produire laisserait croire qu'un règlement a
    // eu lieu, et c'est le genre de document qu'on retrouve dans un dossier
    // de contrôle.
    expect(() => construireRecu({ ...BASE, paiements: [] })).toThrow(/aucun paiement/);
  });

  it("un paiement sans montant est refusé, « pas encore payé » compris", () => {
    // `non_paye` s'inscrit sans montant ni date : c'est une réponse valable
    // sur une facture à trente jours, et ce n'est pas un reçu.
    expect(() =>
      construireRecu({
        ...BASE,
        paiements: [{ moyen: "Pas encore payé", montant: null, date: null }],
      }),
    ).toThrow(/sans montant/);
  });

  it("un dossier sans matricule est refusé : la mention est obligatoire", () => {
    // R4 : la liste des mentions vient du pack. Mais quand le pack EXIGE
    // l'identifiant fiscal et que le dossier ne l'a pas, le reçu ne se
    // fabrique pas à moitié — il lève.
    expect(() => construireRecu({ ...BASE, dossier: { nom: "ALGORIA", matricule: null } })).toThrow(
      /matricule/,
    );
  });

  it("les mentions obligatoires sont RECOPIÉES du pack, jamais écrites ici", () => {
    const r = construireRecu({ ...BASE, mentions: ["Mention A", "Mention B"] });
    expect(r.mentions).toEqual(["Mention A", "Mention B"]);
  });

  it("et le reçu ne porte AUCUNE écriture comptable", () => {
    /*
     * Un reçu transmis au cabinet et comptabilisable une seconde fois est la
     * façon la plus simple de compter une charge deux fois. Le module ne rend
     * donc ni compte, ni taux, ni imputation : la forme même de son résultat
     * l'en empêche.
     */
    const r = construireRecu(BASE) as unknown as Record<string, unknown>;
    for (const interdit of ["compte", "account", "taux", "tva", "ecriture"]) {
      expect(Object.keys(r)).not.toContain(interdit);
    }
  });
});
