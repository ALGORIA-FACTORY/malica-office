// @vitest-environment jsdom
/**
 * La carte d'identification fiscale se prend comme une pièce.
 *
 * ================================================================= POURQUOI
 *
 * 23 novembre 2026, sur Android : la carte ouvrait l'ancien écran de cadrage
 * de la page (« Cadrez la facture entière dans l'écran »), quand « Ajouter des
 * pièces » ouvrait le scanner de l'appareil. « Je veux tous comme 2. »
 *
 * Trois choses sont éprouvées :
 *   1. la fiche montre les trois sources d'« Ajouter des pièces », et rien
 *      d'autre pour photographier ;
 *   2. chacune nourrit la MÊME lecture qu'avant (`malica.lireCarte`), et ce
 *      qui est lu reste marqué « lu » — distinct de ce qui est saisi ;
 *   3. une seule caméra dans le produit : aucun écran n'importe le cadrage
 *      de la page en direct, tous passent par `usePriseDeVue`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  lireCarte: vi.fn(),
  etablirFiche: vi.fn(),
  choisir: vi.fn(),
  capturer: vi.fn(),
  natif: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/hooks/use-revenir", () => ({ useRevenir: () => vi.fn() }));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({ tenantId: "t1", jurisdiction: "TN" }),
}));
vi.mock("@/capabilities/files", () => {
  class FichierNonPdf extends Error {
    constructor(readonly noms: readonly string[]) {
      super("pas un PDF");
    }
  }
  return {
    FichierNonPdf,
    files: {
      scannerDeLAppareil: () =>
        api.natif ? { origine: "natif", capturer: (max?: number) => api.capturer(max) } : null,
      choisir: (moyen: string, plusieurs?: boolean) => api.choisir(moyen, plusieurs),
    },
  };
});
vi.mock("@/components/malica/CameraScanner", () => ({
  CameraScanner: ({ onDone }: { onDone: (pages: Blob[]) => void }) => (
    <button type="button" onClick={() => onDone([prise])}>
      cadrage-de-la-page
    </button>
  ),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    identity: {
      regimesDisponibles: async () => [
        { axe: "imposition", code: "reel", libelle: "Réel", fondement: null },
        { axe: "tva", code: "assujetti", libelle: "Assujetti", fondement: null },
      ],
      formesDisponibles: async () => [],
      ficheCourante: async () => null,
      etablirFiche: api.etablirFiche,
    },
    malica: { lireCarte: api.lireCarte },
  }),
}));

const prise = new Blob(["recto"], { type: "image/jpeg" });

import { Route } from "../routes/_authenticated/pme.fiche";

const Ecran = (Route as unknown as { options: { component: ComponentType } }).options.component;

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Ecran />
    </QueryClientProvider>,
  );
}

const lecture = {
  contract: "carte-fiscale.v1",
  carte: {
    contract: "carte-fiscale.v1",
    raison_sociale: null,
    matricule_fiscal: null,
    adresse: null,
    activite: null,
    debut_activite: null,
    etablissement: null,
    regime_imposition: "reel",
    regime_tva: null,
    cloture_exercice: null,
    field_confidence: {},
  },
  citations: [],
  flags: [],
  valid: true,
  model: "essai",
  latencyMs: 1,
  tokensIn: null,
  tokensOut: null,
};

beforeEach(() => {
  api.natif = false;
  api.lireCarte.mockReset().mockResolvedValue(lecture);
  api.etablirFiche.mockReset().mockResolvedValue(undefined);
  api.choisir.mockReset();
  api.capturer.mockReset();
});
afterEach(cleanup);

describe("la fiche : les trois sources d'« Ajouter des pièces »", () => {
  it("montre Photographier, Importer des images et Importer des PDF", () => {
    monter();
    expect(screen.getByRole("button", { name: "pme.capture.photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "pme.capture.galerie" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "pme.doc.importer" })).toBeTruthy();
    // L'ancien bouton, qui ouvrait l'autre caméra, n'existe plus.
    expect(screen.queryByText("fiche.photographier")).toBeNull();
  });

  it("dans la coque, Photographier ouvre le scanner de l'appareil, borné à une page, et la lecture reçoit l'image", async () => {
    api.natif = true;
    api.capturer.mockResolvedValue([prise]);
    monter();

    fireEvent.click(screen.getByRole("button", { name: "pme.capture.photo" }));

    await waitFor(() =>
      expect(api.lireCarte).toHaveBeenCalledWith({ jurisdiction: "TN", fichier: prise }),
    );
    expect(api.capturer).toHaveBeenCalledWith(1);
    expect(screen.queryByText("cadrage-de-la-page")).toBeNull();
  });

  it("dans un navigateur, Photographier ouvre le cadrage des pièces, et la lecture reçoit la prise", async () => {
    monter();

    fireEvent.click(screen.getByRole("button", { name: "pme.capture.photo" }));
    fireEvent.click(await screen.findByText("cadrage-de-la-page"));

    await waitFor(() =>
      expect(api.lireCarte).toHaveBeenCalledWith({ jurisdiction: "TN", fichier: prise }),
    );
  });

  it.each([
    ["pme.capture.galerie", "images"],
    ["pme.doc.importer", "pdf"],
  ])(
    "« %s » choisit UN fichier par `files.choisir`, et la lecture le reçoit",
    async (bouton, moyen) => {
      const fichier = new Blob(["%PDF-1.7"], { type: "application/pdf" });
      api.choisir.mockResolvedValue([{ blob: fichier, name: "carte.pdf", source: "pdf" }]);
      monter();

      fireEvent.click(screen.getByRole("button", { name: bouton }));

      await waitFor(() =>
        expect(api.lireCarte).toHaveBeenCalledWith({ jurisdiction: "TN", fichier }),
      );
      expect(api.choisir).toHaveBeenCalledWith(moyen, false);
    },
  );

  it("un fichier qui n'est pas un PDF est refusé avec son nom, et rien n'est lu", async () => {
    const { FichierNonPdf } = await import("@/capabilities/files");
    api.choisir.mockRejectedValue(new FichierNonPdf(["note.txt"]));
    monter();

    fireEvent.click(screen.getByRole("button", { name: "pme.doc.importer" }));

    expect((await screen.findByRole("alert")).textContent).toBe("pme.file.pasUnPdf");
    expect(api.lireCarte).not.toHaveBeenCalled();
  });
});

describe("la fiche : ce qui est lu reste distinct de ce qui est saisi", () => {
  it("sans lecture, la fiche s'inscrit comme saisie", async () => {
    monter();
    expect(screen.getByText("pme.fiche.fixeSourceSaisie")).toBeTruthy();
    expect(screen.queryByText(/fiche\.marqueLue/)).toBeNull();
  });

  it("après lecture, le champ lu est marqué, et la fiche s'inscrit comme lue sur la carte", async () => {
    api.natif = true;
    api.capturer.mockResolvedValue([prise]);
    monter();

    fireEvent.click(screen.getByRole("button", { name: "pme.capture.photo" }));

    expect(await screen.findByText("pme.fiche.fixeSourceCarte")).toBeTruthy();
    expect(screen.getAllByText(/fiche\.marqueLue/).length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "fiche.enregistrer" }));
    await waitFor(() => expect(api.etablirFiche).toHaveBeenCalledTimes(1));
    expect(api.etablirFiche.mock.calls[0]?.[0]).toMatchObject({
      regimeImposition: "reel",
      source: "carte",
    });
  });
});

describe("une seule caméra dans le produit", () => {
  it("seul `usePriseDeVue` importe le cadrage de la page", () => {
    const src = join(__dirname, "..");
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) {
          if (nom !== "__tests__") parcourir(chemin);
        } else if (/\.tsx?$/.test(nom)) fichiers.push(chemin);
      }
    };
    parcourir(src);

    const importeurs = fichiers
      .filter((f) => /components\/malica\/CameraScanner["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f).replace(/\\/g, "/"));
    expect(importeurs).toEqual(["hooks/use-prise-de-vue.tsx"]);
  });
});
