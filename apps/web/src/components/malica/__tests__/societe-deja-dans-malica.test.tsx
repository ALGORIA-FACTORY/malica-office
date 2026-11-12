// @vitest-environment jsdom
/**
 * « Ajouter un client » : une société déjà dans Malica se reconnaît dès que
 * le matricule est complet (recette du 11 novembre 2026, 3.8) — un seul
 * message, puis « Envoyer une demande de mandat », sans autre champ.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MatriculeExamine } from "@malica/socle/ports/repositories";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", jurisdiction: "TN", currency: "TND" } }),
}));
vi.mock("@/hooks/use-superposition", () => ({ useSuperposition: () => undefined }));

let examen: (v: string) => MatriculeExamine = () => ({ complet: false });
const proposer = vi.fn(async () => ({
  id: "m",
  pmeTenantId: "p",
  pmeName: "Société",
  status: "propose",
  deja: false,
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    identity: {
      examinerMatricule: async (_c: string, v: string) => examen(v),
      proposerMandat: proposer,
    },
  }),
}));

import { NouveauClient } from "../clients/fiche-client";

const ouvrir = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NouveauClient fermer={() => undefined} ouvrir={() => undefined} annoncer={() => undefined} />
    </QueryClientProvider>,
  );

afterEach(cleanup);

describe("ajouter un client déjà dans Malica", () => {
  it("se reconnaît au matricule complet, sans raison sociale ni clic", async () => {
    examen = (v) =>
      v === "1234567A/A/M/000"
        ? { complet: true, lettre: "conforme", societe: "existante" }
        : { complet: false };
    ouvrir();
    const mf = screen.getAllByRole("textbox")[0]!;
    fireEvent.change(mf, { target: { value: "1234567" } });
    expect(screen.queryByText("cab.cli.nouveau.existant")).toBeNull();
    fireEvent.change(mf, { target: { value: "1234567A/A/M/000" } });
    expect(await screen.findByText("cab.cli.nouveau.existant")).toBeTruthy();
    // Un seul message, et plus aucun autre champ.
    expect(screen.getAllByText("cab.cli.nouveau.existant")).toHaveLength(1);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByText("cab.cli.nouveau.creer.sans")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "cab.cli.nouveau.demander" }));
    await waitFor(() => expect(proposer).toHaveBeenCalledWith("cabinet", "1234567A/A/M/000"));
  });

  it("une lettre de contrôle fausse se signale, sans fermer la saisie", async () => {
    examen = () => ({ complet: true, lettre: "discordante", societe: "nouvelle" });
    ouvrir();
    fireEvent.change(screen.getAllByRole("textbox")[0]!, {
      target: { value: "1234567B/A/M/000" },
    });
    expect(await screen.findByText("cab.cli.matricule.lettre")).toBeTruthy();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(1);
  });
});
