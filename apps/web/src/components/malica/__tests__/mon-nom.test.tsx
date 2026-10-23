// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ lire: vi.fn(), ecrire: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ identity: { monProfil: api.lire, ecrireMonProfil: api.ecrire } }),
}));

import { MonNom } from "../abonnement-pilote";

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MonNom />
    </QueryClientProvider>,
  );
  return client;
}
async function editer() {
  fireEvent.click(await screen.findByRole("button", { name: "pme.reglages.profil.editer" }));
}

describe("le profil du compte", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.lire.mockResolvedValue({
      prenom: "Wissem",
      nom: "Barouni",
      display_name: "Wissem Barouni",
    });
    api.ecrire.mockImplementation(async (prenom: string, nom: string) => ({
      prenom: prenom.trim(),
      nom: nom.trim(),
      display_name: `${prenom.trim()} ${nom.trim()}`,
    }));
  });
  afterEach(cleanup);

  it("affiche les valeurs en lecture seule et un bouton Éditer", async () => {
    monter();
    await screen.findByRole("button", { name: "pme.reglages.profil.editer" });
    expect(screen.getByText("Wissem")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(api.ecrire).not.toHaveBeenCalled();
  });

  it("referme les champs seulement après l'enregistrement confirmé par l'API", async () => {
    monter();
    await editer();
    fireEvent.change(screen.getByLabelText("pme.reglages.profil.prenom"), {
      target: { value: " Wissem actualisé " },
    });
    fireEvent.click(screen.getByRole("button", { name: "pme.reglages.profil.enregistrer" }));
    await screen.findByRole("button", { name: "pme.reglages.profil.editer" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Wissem actualisé")).toBeTruthy();
    expect(api.ecrire).toHaveBeenCalledWith(" Wissem actualisé ", "Barouni");
    expect(screen.getByRole("status").textContent).toContain("pme.reglages.profil.enregistre");
  });

  it("annule le brouillon sans écrire et retrouve les valeurs enregistrées", async () => {
    monter();
    await editer();
    fireEvent.change(screen.getByLabelText("pme.reglages.profil.nom"), {
      target: { value: "Brouillon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    await editer();
    expect((screen.getByLabelText("pme.reglages.profil.nom") as HTMLInputElement).value).toBe(
      "Barouni",
    );
    expect(api.ecrire).not.toHaveBeenCalled();
  });

  it("garde les champs et le brouillon ouverts si la sauvegarde échoue", async () => {
    api.ecrire.mockRejectedValue(new Error("Échec réseau"));
    monter();
    await editer();
    fireEvent.change(screen.getByLabelText("pme.reglages.profil.nom"), {
      target: { value: "Conserver" },
    });
    fireEvent.click(screen.getByRole("button", { name: "pme.reglages.profil.enregistrer" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("pme.reglages.profil.nom") as HTMLInputElement).value).toBe(
      "Conserver",
    );
    expect(screen.queryByRole("button", { name: "pme.reglages.profil.editer" })).toBeNull();
  });

  it("ne remplace pas la saisie en cours lors d'une actualisation du profil", async () => {
    const client = monter();
    await editer();
    fireEvent.change(screen.getByLabelText("pme.reglages.profil.nom"), {
      target: { value: "En cours" },
    });
    await act(async () =>
      client.setQueryData(["mon-profil"], {
        prenom: "Autre",
        nom: "Actualisation",
        display_name: "Autre Actualisation",
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("pme.reglages.profil.nom") as HTMLInputElement).value).toBe(
        "En cours",
      ),
    );
  });
});
