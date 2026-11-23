// @vitest-environment jsdom
/**
 * La prise de vue — une seule caméra pour les pièces et pour la carte fiscale.
 *
 * Ce qui est éprouvé : l'aiguillage (scanner de l'appareil, puis notre cadrage,
 * puis l'appareil photo natif) et ce que chaque branche rend à l'écran. Le
 * cadrage lui-même a sa propre épreuve (`CameraScanner.test.tsx`) : ici il est
 * remplacé par un double qui expose ses trois issues.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fermerLaDerniereSuperposition } from "@/lib/superpositions";

import { usePriseDeVue, type SuiteDeLaPrise } from "../use-prise-de-vue";

const natif = vi.hoisted(() => ({
  numeriseur: null as null | { origine: "natif"; capturer: (max?: number) => Promise<Blob[]> },
}));

vi.mock("@/capabilities/files", () => ({
  files: { scannerDeLAppareil: () => natif.numeriseur },
}));

const prise = new Blob(["page"], { type: "image/jpeg" });

vi.mock("@/components/malica/CameraScanner", () => ({
  CameraScanner: ({
    onDone,
    onCancel,
    onFallback,
  }: {
    onDone: (pages: Blob[]) => void;
    onCancel: () => void;
    onFallback: () => void;
  }) => (
    <div data-testid="cadrage">
      <button type="button" onClick={() => onDone([prise])}>
        prendre
      </button>
      <button type="button" onClick={onCancel}>
        annuler
      </button>
      <button type="button" onClick={onFallback}>
        repli
      </button>
    </div>
  ),
}));

function Banc(suite: SuiteDeLaPrise) {
  const p = usePriseDeVue(suite);
  return (
    <>
      <button type="button" onClick={p.photographier}>
        photographier
      </button>
      {p.ecran}
    </>
  );
}

function monter(extra: Partial<SuiteDeLaPrise> = {}) {
  const suite = {
    surPages: vi.fn(),
    surRepli: vi.fn(),
    surAbandon: vi.fn(),
    ...extra,
  };
  render(<Banc {...suite} />);
  return suite;
}

beforeEach(() => {
  natif.numeriseur = null;
});
afterEach(cleanup);

describe("usePriseDeVue : le scanner de l'appareil d'abord", () => {
  it("dans la coque, les pages du scanner partent déjà cadrées, sans ouvrir notre cadrage", async () => {
    const capturer = vi.fn(async () => [prise]);
    natif.numeriseur = { origine: "natif", capturer };
    const suite = monter({ pagesMax: 1 });

    fireEvent.click(screen.getByText("photographier"));

    await waitFor(() => expect(suite.surPages).toHaveBeenCalledWith([prise], true));
    // La carte borne le scanner à une page ; les pièces lui laissent son maximum.
    expect(capturer).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId("cadrage")).toBeNull();
  });

  it("un abandon dans le scanner de l'appareil ne rend rien, et le dit", async () => {
    natif.numeriseur = { origine: "natif", capturer: vi.fn(async () => []) };
    const suite = monter();

    fireEvent.click(screen.getByText("photographier"));

    await waitFor(() => expect(suite.surAbandon).toHaveBeenCalledTimes(1));
    expect(suite.surPages).not.toHaveBeenCalled();
  });

  it("un téléphone sans scanner ouvre notre cadrage au lieu d'un bouton mort", async () => {
    natif.numeriseur = {
      origine: "natif",
      capturer: vi.fn(async () => {
        throw new Error("Document scanner is not supported");
      }),
    };
    monter();

    fireEvent.click(screen.getByText("photographier"));

    expect(await screen.findByTestId("cadrage")).toBeTruthy();
  });
});

describe("usePriseDeVue : notre cadrage, dans un navigateur", () => {
  it("les pages de notre cadrage partent non cadrées, et le cadrage se ferme", async () => {
    const suite = monter();

    fireEvent.click(screen.getByText("photographier"));
    fireEvent.click(await screen.findByText("prendre"));

    expect(suite.surPages).toHaveBeenCalledWith([prise], false);
    expect(screen.queryByTestId("cadrage")).toBeNull();
  });

  it("« Annuler » ferme le cadrage et annonce l'abandon", async () => {
    const suite = monter();

    fireEvent.click(screen.getByText("photographier"));
    fireEvent.click(await screen.findByText("annuler"));

    expect(suite.surAbandon).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("cadrage")).toBeNull();
  });

  it("sans caméra, le repli passe la main à l'appareil photo natif", async () => {
    const suite = monter();

    fireEvent.click(screen.getByText("photographier"));
    fireEvent.click(await screen.findByText("repli"));

    expect(suite.surRepli).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("cadrage")).toBeNull();
  });

  it("le retour d'Android ferme le cadrage comme « Annuler »", async () => {
    const suite = monter();

    fireEvent.click(screen.getByText("photographier"));
    await screen.findByTestId("cadrage");
    // Le retour d'Android et `Échap` passent par la pile des superpositions.
    act(() => {
      expect(fermerLaDerniereSuperposition()).toBe(true);
    });

    await waitFor(() => expect(screen.queryByTestId("cadrage")).toBeNull());
    expect(suite.surAbandon).toHaveBeenCalledTimes(1);
  });
});
