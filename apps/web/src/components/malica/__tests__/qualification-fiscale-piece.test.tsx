// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MESSAGES } from "@malica/socle/messages";
import type { ContexteQualificationFiscale } from "@malica/socle/ports/qualification-fiscale";
const { contexte, sauver, role } = vi.hoisted(() => ({
  contexte: vi.fn(),
  sauver: vi.fn(),
  role: vi.fn(),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (k: keyof typeof MESSAGES.fr) => MESSAGES.fr[k] }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    office: { contexteQualificationFiscale: contexte, qualifierFiscalite: sauver },
    acces: { monAcces: role },
  }),
}));
import { QualificationFiscalePiece } from "../qualification-fiscale-piece";
const uuid = "00000000-0000-4000-8000-000000000001";
function donnees(): ContexteQualificationFiscale {
  return {
    extractionId: uuid,
    profilVersionId: null,
    documentKind: "facture_achat",
    dateLue: "2026-10-25",
    decimales: 3,
    prorata: "60",
    regimeTva: "partiel",
    qualification: null,
    comptes: [{ code: "stock", libelle: "Stocks du scénario" }],
    lignes: [
      {
        index: 0,
        libelle: "Produits",
        codeTva: "Test",
        htLu: "1000,000",
        baseProposee: "1000.000",
      },
    ],
    droits: [
      {
        code: "TAXE",
        libelle: "Droit du scénario",
        taux: "0.01",
        referenceLegale: "Source du scénario",
        taxable: true,
      },
    ],
  };
}
function monter(c = donnees(), r = "expert") {
  contexte.mockResolvedValue(c);
  role.mockResolvedValue({ role: r });
  sauver.mockResolvedValue({ id: uuid });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <QualificationFiscalePiece pieceId={uuid} cabinetId={uuid} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: MESSAGES.fr["fq.title"] }));
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("ne permet pas l'enregistrement avant qualification de l'assiette, de l'usage et de l'imputation", async () => {
  monter();
  const bouton = await screen.findByRole("button", { name: MESSAGES.fr["fq.save"] });
  expect(bouton.matches(":disabled")).toBe(true);
  expect((screen.getByLabelText(MESSAGES.fr["fq.deduction"]) as HTMLSelectElement).value).toBe("");
  expect(
    (screen.getByLabelText(`TAXE · ${MESSAGES.fr["fq.taxBase"]}`) as HTMLInputElement).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText(MESSAGES.fr["fq.operator"]), {
    target: { value: "fabricant" },
  });
  fireEvent.change(screen.getByLabelText(MESSAGES.fr["fq.account"]), {
    target: { value: "stock" },
  });
  fireEvent.change(screen.getByLabelText(MESSAGES.fr["fq.deduction"]), {
    target: { value: "prorata" },
  });
  fireEvent.change(screen.getByLabelText(`TAXE · ${MESSAGES.fr["fq.taxBase"]}`), {
    target: { value: "1000" },
  });
  fireEvent.change(screen.getByLabelText(MESSAGES.fr["fq.justification"]), {
    target: { value: "Usage commun et produit soumis justifiés" },
  });
  expect(bouton.matches(":disabled")).toBe(false);
  fireEvent.click(bouton);
  await waitFor(() =>
    expect(sauver).toHaveBeenCalledWith(
      expect.objectContaining({
        lignes: [
          expect.objectContaining({
            baseHt: "1000.000",
            deduction: "prorata",
            compteCout: "stock",
          }),
        ],
      }),
    ),
  );
});
it("une nouvelle lecture réinitialise la ventilation ancienne et conserve le lien d'historique", async () => {
  const c = donnees();
  c.qualification = {
    pieceId: uuid,
    extractionId: "00000000-0000-4000-8000-000000000002",
    profilVersionId: null,
    precedentId: null,
    documentKind: "facture_achat",
    dateOperation: "2026-10-25",
    contexte: "interieur",
    qualiteOperateur: "fabricant",
    justification: "Ancienne qualification",
    lignes: [
      { index: 5, baseHt: "999", compteCout: "ancien", deduction: "deductible", droits: [] },
    ],
    id: uuid,
    creePar: uuid,
    creeLe: "2026-10-25T00:00:00Z",
  };
  monter(c);
  await screen.findByRole("alert");
  expect((screen.getByLabelText(MESSAGES.fr["fq.base"]) as HTMLInputElement).value).toBe(
    "1000.000",
  );
  expect((screen.getByLabelText(MESSAGES.fr["fq.account"]) as HTMLSelectElement).value).toBe("");
  expect(screen.getByRole("button", { name: MESSAGES.fr["fq.save"] }).matches(":disabled")).toBe(
    true,
  );
});
it("un collaborateur consulte sans pouvoir modifier", async () => {
  monter(donnees(), "collaborateur");
  const champ = await screen.findByLabelText(MESSAGES.fr["fq.base"]);
  expect(champ.matches(":disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: MESSAGES.fr["fq.save"] })).toBeNull();
});
