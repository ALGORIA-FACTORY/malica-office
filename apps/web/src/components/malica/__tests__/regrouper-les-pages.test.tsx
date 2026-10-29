// @vitest-environment jsdom
/**
 * Plusieurs feuilles d'un scan, plusieurs factures.
 *
 * 29 octobre 2026, premier essai sur un vrai téléphone : deux factures de
 * deux fournisseurs, scannées dans le même passage, devenaient UNE pièce, et
 * la seconde n'était jamais lue. Cette épreuve tient les trois gestes de
 * l'écran qui le corrige : par défaut une feuille = une facture, un toucher
 * relie deux pages, un autre relie tout.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";

import { regrouper } from "@/lib/regrouper-les-pages";

import { RegrouperLesPages } from "../regrouper-les-pages";

beforeAll(() => {
  URL.createObjectURL = vi.fn((b: Blob) => `blob:${(b as Blob & { nom?: string }).nom ?? "x"}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

function page(nom: string): Blob {
  return Object.assign(new Blob([nom], { type: "image/jpeg" }), { nom });
}

describe("regrouper", () => {
  it("une feuille = une facture, tant que rien n'est relié", () => {
    expect(regrouper(["a", "b", "c"], [false, false])).toEqual([["a"], ["b"], ["c"]]);
  });
  it("relie la page à la suivante", () => {
    expect(regrouper(["a", "b", "c"], [true, false])).toEqual([["a", "b"], ["c"]]);
    expect(regrouper(["a", "b", "c"], [false, true])).toEqual([["a"], ["b", "c"]]);
  });
  it("tout relié : une seule facture", () => {
    expect(regrouper(["a", "b", "c"], [true, true])).toEqual([["a", "b", "c"]]);
  });
});

describe("RegrouperLesPages", () => {
  function monter() {
    const onValider = vi.fn();
    const pages = [page("p1"), page("p2"), page("p3")];
    render(
      <I18nProvider>
        <RegrouperLesPages pages={pages} onValider={onValider} />
      </I18nProvider>,
    );
    return { onValider, pages };
  }

  it("par défaut, trois feuilles partent en trois factures", () => {
    const { onValider, pages } = monter();
    fireEvent.click(screen.getByRole("button", { name: /3 factures/ }));
    expect(onValider).toHaveBeenCalledWith([[pages[0]], [pages[1]], [pages[2]]]);
  });

  it("« Même facture » relie deux pages, et le bouton le dit avant l'envoi", () => {
    const { onValider, pages } = monter();
    const liens = screen.getAllByRole("button", { name: /Même facture/ });
    expect(liens).toHaveLength(2);
    fireEvent.click(liens[0]!);
    expect(liens[0]!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /2 factures/ }));
    expect(onValider).toHaveBeenCalledWith([[pages[0], pages[1]], [pages[2]]]);
  });

  it("« Tout est une seule facture » relie toutes les pages", () => {
    const { onValider, pages } = monter();
    fireEvent.click(screen.getByRole("button", { name: /seule facture/ }));
    fireEvent.click(screen.getByRole("button", { name: /1 facture/ }));
    expect(onValider).toHaveBeenCalledWith([pages]);
  });
});
