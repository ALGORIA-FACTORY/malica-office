// @vitest-environment jsdom
/**
 * La facture de Malica Office en PDF (23 novembre 2026) : la préparation des textes
 * (`factureImprimable`) et le dessin (`rendreFactureEnPdf`).
 *
 * Le canevas de jsdom ne dessine pas : un double enregistre ce qui s'écrit, et l'encodeur du
 * numériseur est remplacé. Ce qu'on éprouve : chaque texte du modèle est posé (numéro, net à
 * payer, lettres, banque), le PDF sort sous le nom du numéro, l'arabe est en miroir, une
 * facture longue continue sur une seconde page, et une facture sans émetteur ne s'imprime pas.
 * Données manifestement fictives.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const scanner = vi.hoisted(() => ({ buildImagesPdf: vi.fn() }));
vi.mock("../scanner", () => ({ buildImagesPdf: scanner.buildImagesPdf }));

import type { FactureDetaillee } from "@malica/socle/ports/repositories";

import { factureImprimable, pourcentDuTaux } from "@/lib/facture-imprimable";

import { rendreFactureEnPdf } from "../facture-pdf";

/** Un texte écrit sur la page : ce qu'il dit, où, et dans quel alignement. */
interface Ecrit {
  texte: string;
  x: number;
  aligne: string;
  page: number;
}

let ecrits: Ecrit[] = [];
let pages = 0;

/** Un canevas qui enregistre au lieu de dessiner. */
function faux(): HTMLCanvasElement {
  const page = ++pages;
  const ctx = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    direction: "ltr",
    textBaseline: "alphabetic",
    letterSpacing: "0px",
    fillRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    drawImage: () => undefined,
    measureText: (t: string) => ({ width: t.length * 14 }),
    fillText(texte: string, x: number) {
      ecrits.push({ texte, x, aligne: this.textAlign, page });
    },
  };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: BlobCallback) => cb(new Blob([new Uint8Array([1])])),
  } as unknown as HTMLCanvasElement;
}

/** La marque se lit au dictionnaire ; le reste rend sa clé, suivie de ses valeurs. */
const t = (cle: string, v?: Record<string, string | number>) =>
  cle === "facture.pdf.marque"
    ? "ALGORIA | FACTORY"
    : v
      ? `${cle} ${Object.values(v).join(" ")}`
      : cle;

const DETAIL: FactureDetaillee = {
  facture_id: "00000000-0000-0000-0000-000000000001",
  numero: "MO-TN-I11-2026-000001",
  emise_le: "2026-11-23",
  echeance_le: "2026-12-08",
  couvre_du: "2026-11-23",
  couvre_au: "2026-12-23",
  periode: "2026-11-01",
  payeur_type: "titulaire",
  offre_code: "solo",
  offre_libelle: "Solo",
  reference_abonne: null,
  montant_ht: "100.000",
  taux_tva: "0.190000",
  montant_tva: "19.000",
  timbre: "1.000",
  montant_ttc: "120.000",
  devise: "TND",
  etat: "a_echoir",
  reste_du: "120.000",
  client: {
    nom: "Société d'essai",
    destinataire: "Dirigeante d'essai",
    matricule: "0000000/X/A/M/000",
    adresse: "Rue de l'essai\n0000 Ville",
  },
  lignes: [
    {
      ordinal: 1,
      libelle: "Abonnement Solo — du 23/11/2026 au 22/12/2026",
      quantite: "1.00",
      prix_unitaire: "100.000",
      montant_ht: "100.000",
    },
  ],
  reglements: [],
  entete: {
    emetteur: {
      nom: "Émetteur d'essai",
      matricule: "1111111/Y/A/M/000",
      adresse: "1 rue de l'Essai\n1000 Ville d'essai",
      rne: "RNE-ESSAI",
      site_web: "essai.example",
    },
    conditions_paiement: "Par virement (essai).",
    banque: {
      titulaire: "TITULAIRE D'ESSAI",
      banque: "BANQUE D'ESSAI",
      agence: null,
      rib: "00 000 0000000000000 00",
      iban: "XX00 0000",
      bic: "ESSAIXXX",
      devise: null,
    },
    exposant: 3,
    lettres: {
      fr: {
        majeure: { singulier: "dinar", pluriel: "dinars", duel: null, accusatif: null },
        mineure: { singulier: "millime", pluriel: "millimes", duel: null, accusatif: null },
      },
    },
  },
};

beforeEach(() => {
  ecrits = [];
  pages = 0;
  scanner.buildImagesPdf.mockReset();
  scanner.buildImagesPdf.mockReturnValue(new Blob(["%PDF"], { type: "application/pdf" }));
  vi.spyOn(document, "createElement").mockImplementation(() => faux() as never);
});

describe("la facture prête à dessiner", () => {
  it("le taux se dit en pour cent, sans flottant", () => {
    expect(pourcentDuTaux("0.190000")).toBe("19");
    expect(pourcentDuTaux("0.070000")).toBe("7");
    expect(pourcentDuTaux("0.185000")).toBe("18.5");
  });

  it("porte les totaux du modèle et le montant en lettres", () => {
    const f = factureImprimable(DETAIL, t as never, "fr");
    expect(f.totaux.map((x) => x.libelle)).toEqual([
      "facture.pdf.totalHt",
      "facture.pdf.tva 19",
      "facture.pdf.totalTtc",
      "facture.pdf.timbre",
      "facture.pdf.netAPayer TND",
    ]);
    // HT + TVA, somme exacte du Socle : « Total TTC hors timbre ».
    expect(f.totaux[2]!.valeur.replace(/\s/g, "")).toMatch(/^119[,.]000$/);
    expect(f.arretee).toBe("facture.pdf.arretee cent vingt dinars");
    expect(f.signal).toBe("alerte");
    expect(f.fichier).toBe("MO-TN-I11-2026-000001.pdf");
    expect(f.banque?.lignes.map((l) => l.libelle)).not.toContain("facture.pdf.banque.agence");
    expect(f.a.lignes[0]).toBe("facture.pdf.attention Dirigeante d'essai");
  });

  it("sans noms de la devise dans la langue, pas de lettres plutôt qu'une phrase fausse", () => {
    expect(factureImprimable(DETAIL, t as never, "ar").arretee).toBeNull();
  });

  it("réglée par carte : elle le dit, et n'imprime ni RIB ni échéance", () => {
    const f = factureImprimable(
      {
        ...DETAIL,
        etat: "payee",
        reste_du: "0.000",
        reglements: [
          { moyen: "carte", reference: "flouci ESSAI-1", le: "2026-11-23", montant: "120.000" },
        ],
      },
      t as never,
      "fr",
    );
    expect(f.banque).toBeNull();
    expect(f.signal).toBe("succes");
    expect(f.conditions.lignes).toHaveLength(1);
    expect(f.conditions.lignes[0]).toMatch(
      /^facture\.pdf\.reglee\.ref .+ facture\.pdf\.moyen\.carte flouci ESSAI-1$/,
    );
  });

  it("à régler (la facture du mois d'une comptabilité) : le RIB, l'échéance, l'objet du mois", () => {
    const f = factureImprimable(
      { ...DETAIL, payeur_type: "cabinet", couvre_du: null, couvre_au: null, offre_code: null },
      t as never,
      "fr",
    );
    expect(f.banque?.lignes.map((l) => l.libelle)).toContain("facture.pdf.banque.rib");
    expect(f.conditions.lignes.at(-1)).toMatch(/^facture\.pdf\.conditions\.echeance /);
    expect(f.objet.texte).toMatch(/^facture\.pdf\.objet\.mois .*2026/);
  });

  it("sans émetteur au jour de la facture, elle ne s'imprime pas", () => {
    expect(() =>
      factureImprimable(
        { ...DETAIL, entete: { ...DETAIL.entete, emetteur: null } },
        t as never,
        "fr",
      ),
    ).toThrow("facture.pdf.sans_emetteur");
  });
});

describe("la facture en PDF", () => {
  it("pose chaque bloc du modèle et rend un PDF au nom du numéro", async () => {
    const rendu = await rendreFactureEnPdf(factureImprimable(DETAIL, t as never, "fr"), "ltr");
    expect(rendu.blob).toBeInstanceOf(Blob);
    expect(rendu.name).toBe("MO-TN-I11-2026-000001.pdf");
    const textes = ecrits.map((e) => e.texte);
    for (const attendu of [
      "ALGORIA",
      "FACTORY",
      "facture.pdf.surtitre",
      "facture.pdf.titre",
      "MO-TN-I11-2026-000001",
      "facture.pdf.net",
      "facture.pdf.de",
      "facture.pdf.a",
      "Émetteur d'essai",
      "Société d'essai",
      "facture.pdf.designation",
      "facture.pdf.objet",
      "facture.pdf.conditions",
      "facture.pdf.banque",
      "00 000 0000000000000 00",
      "facture.pdf.signature",
    ]) {
      expect(textes, attendu).toContain(attendu);
    }
    expect(textes.some((x) => x.startsWith("facture.pdf.arretee"))).toBe(true);
    expect(scanner.buildImagesPdf).toHaveBeenCalledTimes(1);
    expect(pages).toBe(1);
  });

  it("en arabe, la page est en miroir : le titre part de la droite", async () => {
    await rendreFactureEnPdf(factureImprimable(DETAIL, t as never, "ar"), "rtl");
    const titre = ecrits.find((e) => e.texte === "facture.pdf.titre")!;
    expect(titre.aligne).toBe("right");
    expect(titre.x).toBeGreaterThan(1000);
  });

  it("une facture longue continue sur une seconde page, sous son numéro", async () => {
    const lignes = Array.from({ length: 40 }, (_, i) => ({
      ...DETAIL.lignes[0]!,
      ordinal: i + 1,
      libelle: `Recharge d'essai ${i + 1}`,
    }));
    await rendreFactureEnPdf(factureImprimable({ ...DETAIL, lignes }, t as never, "fr"), "ltr");
    expect(pages).toBeGreaterThan(1);
    expect(ecrits.some((e) => e.page === 2 && e.texte.includes("MO-TN-I11-2026-000001"))).toBe(
      true,
    );
    expect(ecrits.filter((e) => e.texte === "facture.pdf.signature")).toHaveLength(pages);
  });

  it("un aperçu de la tour porte son filigrane", async () => {
    await rendreFactureEnPdf(factureImprimable(DETAIL, t as never, "fr", true), "ltr");
    expect(ecrits.map((e) => e.texte)).toContain("facture.pdf.specimen");
  });
});
