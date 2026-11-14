/**
 * Le chiffre d'une société sous « Toutes les sociétés » : celui que le moteur rend pour CETTE
 * société, avec sa juridiction, sa devise et son mois — ou un état dit, jamais un zéro ni une
 * supposition (R3, R4).
 */
import { describe, expect, it, vi } from "vitest";

const o = vi.hoisted(() => ({
  referential: {
    activePack: vi.fn(),
    socleParams: vi.fn(),
    taxRates: vi.fn(),
    declarationTva: vi.fn(),
  },
  identity: { ficheCourante: vi.fn(), monCabinet: vi.fn() },
  office: { extraitsTransmis: vi.fn(), bookedExtracts: vi.fn() },
  charges: { familles: vi.fn(), anomalyThreshold: vi.fn(), articles: vi.fn() },
}));
vi.mock("@/verticals/malica-office/composition", () => ({ office: () => o }));

import { chiffreCharges, chiffreTva } from "../chiffre-par-societe";

const TN = { id: "soc-tn", jurisdiction: "TN", currency: "TND" };
const SN = { id: "soc-sn", jurisdiction: "SN", currency: "XOF" };

function pack(id: string) {
  o.referential.activePack.mockResolvedValue({ id });
}

describe("chiffreTva — une société à la fois, le moteur du Socle", () => {
  it("sans juridiction : un état, et aucune lecture (pas de repli tunisien)", async () => {
    const r = await chiffreTva({ id: "x", jurisdiction: "", currency: "TND" }, "2026-11", "fr");
    expect(r).toEqual({ etat: "sansJuridiction" });
    expect(o.referential.activePack).not.toHaveBeenCalled();
  });

  it("sans devise : un état, aucune devise de repli", async () => {
    vi.clearAllMocks();
    const r = await chiffreTva({ id: "x", jurisdiction: "TN", currency: "" }, "2026-11", "fr");
    expect(r).toEqual({ etat: "referentielIncomplet" });
    expect(o.referential.activePack).not.toHaveBeenCalled();
  });

  it("sans référentiel publié pour la juridiction : un état", async () => {
    o.referential.activePack.mockResolvedValue(null);
    expect(await chiffreTva(TN, "2026-11", "fr")).toEqual({ etat: "sansReferentiel" });
  });

  it("sans régime de TVA connu : un état, jamais un solde deviné", async () => {
    pack("p-tn");
    o.identity.ficheCourante.mockResolvedValue(null);
    expect(await chiffreTva(TN, "2026-11", "fr")).toEqual({ etat: "regimeAbsent" });
    o.identity.ficheCourante.mockResolvedValue({ regimeTva: null });
    expect(await chiffreTva(TN, "2026-11", "fr")).toEqual({ etat: "regimeAbsent" });
  });

  it("non assujettie : un état, pas de solde", async () => {
    pack("p-tn");
    o.identity.ficheCourante.mockResolvedValue({ regimeTva: "non_assujetti" });
    expect(await chiffreTva(TN, "2026-11", "fr")).toEqual({ etat: "nonAssujetti" });
    expect(o.office.extraitsTransmis).not.toHaveBeenCalled();
  });

  it("décimales du référentiel absentes : un état", async () => {
    pack("p-tn");
    o.identity.ficheCourante.mockResolvedValue({ regimeTva: "reel" });
    o.referential.socleParams.mockResolvedValue({ moneyDecimals: null });
    expect(await chiffreTva(TN, "2026-11", "fr")).toEqual({ etat: "referentielIncomplet" });
  });

  it("une erreur de lecture remonte : l'écran la dit, il ne la remplace pas par zéro", async () => {
    pack("p-tn");
    o.identity.ficheCourante.mockRejectedValue(new Error("refus.acces"));
    await expect(chiffreTva(TN, "2026-11", "fr")).rejects.toThrow("refus.acces");
  });

  it("lit les pièces de CETTE société, dans SON mois, avec SA juridiction et SA devise", async () => {
    vi.clearAllMocks();
    o.referential.activePack.mockResolvedValue({ id: "p-sn" });
    o.identity.ficheCourante.mockResolvedValue({ regimeTva: "reel" });
    o.referential.socleParams.mockResolvedValue({ moneyDecimals: 0 });
    o.referential.taxRates.mockResolvedValue([]);
    o.referential.declarationTva.mockResolvedValue({ natureParDefaut: "x", lignes: [] });
    o.identity.monCabinet.mockResolvedValue(null);
    o.office.bookedExtracts.mockResolvedValue([]);
    const r = await chiffreTva(SN, "2026-02", "ar");
    expect(o.referential.activePack).toHaveBeenCalledWith("SN");
    expect(o.referential.taxRates).toHaveBeenCalledWith("p-sn", "SN", "ar");
    // Sans mandat : les pièces comptabilisées ; la fin de février vient du Socle.
    expect(o.office.bookedExtracts).toHaveBeenCalledWith("soc-sn", "2026-02-01", "2026-02-28");
    expect(o.office.extraitsTransmis).not.toHaveBeenCalled();
    expect(r).toMatchObject({ etat: "calcule", devise: "XOF" });
  });

  it("avec un mandat : les pièces TRANSMISES, comme l'écran de la société", async () => {
    vi.clearAllMocks();
    o.referential.activePack.mockResolvedValue({ id: "p-tn" });
    o.identity.ficheCourante.mockResolvedValue({ regimeTva: "reel" });
    o.referential.socleParams.mockResolvedValue({ moneyDecimals: 3 });
    o.referential.taxRates.mockResolvedValue([]);
    o.referential.declarationTva.mockResolvedValue({ natureParDefaut: "x", lignes: [] });
    o.identity.monCabinet.mockResolvedValue({ id: "c", name: "C", tientLesLivres: false });
    o.office.extraitsTransmis.mockResolvedValue([]);
    await chiffreTva(TN, "2026-11", "fr");
    expect(o.office.extraitsTransmis).toHaveBeenCalledWith("soc-tn", "2026-11-01", "2026-11-30");
    expect(o.office.bookedExtracts).not.toHaveBeenCalled();
  });
});

describe("chiffreCharges — le total du mois rendu par le moteur du Socle", () => {
  it("sans juridiction ou sans référentiel : un état", async () => {
    vi.clearAllMocks();
    expect(await chiffreCharges({ ...TN, jurisdiction: "" }, "2026-11", "fr")).toEqual({
      etat: "sansJuridiction",
    });
    o.referential.activePack.mockResolvedValue(null);
    expect(await chiffreCharges(TN, "2026-11", "fr")).toEqual({ etat: "sansReferentiel" });
  });

  it("rend le total du moteur, à l'échelle de la devise de la société", async () => {
    vi.clearAllMocks();
    o.referential.activePack.mockResolvedValue({ id: "p-tn" });
    o.referential.socleParams.mockResolvedValue({ moneyDecimals: 3 });
    o.identity.ficheCourante.mockResolvedValue({ clotureExercice: null });
    o.charges.familles.mockResolvedValue([
      { code: "ACHATS", label: "Achats", isFallback: false, accounts: [] },
    ]);
    o.charges.anomalyThreshold.mockResolvedValue(null);
    o.charges.articles.mockResolvedValue([]);
    const r = await chiffreCharges(TN, "2026-11", "fr");
    expect(o.charges.articles).toHaveBeenCalledWith("soc-tn", "2026-01", "2026-12");
    expect(r).toMatchObject({ etat: "calcule", devise: "TND" });
  });
});
