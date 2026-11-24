// @vitest-environment jsdom
/**
 * Les raccourcis N et M n'agissent qu'à la largeur de bureau, et jamais quand ils sont coupés
 * (pas de société ouverte, une capture en cours) : le téléphone garde son comportement.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRaccourcisDuBureau } from "../use-raccourcis-du-bureau";

function largeur(bureau: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: bureau,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as typeof window.matchMedia;
}

function taper(code: string, cible: EventTarget = document.body) {
  const e = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true });
  cible.dispatchEvent(e);
  return e;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useRaccourcisDuBureau", () => {
  it("N et M déclenchent leur action sur le poste de bureau", () => {
    largeur(true);
    const ajouter = vi.fn();
    const malica = vi.fn();
    renderHook(() => useRaccourcisDuBureau({ ajouter, malica }, true));
    expect(taper("KeyN").defaultPrevented).toBe(true);
    taper("KeyM");
    expect(ajouter).toHaveBeenCalledTimes(1);
    expect(malica).toHaveBeenCalledTimes(1);
  });

  it("ignore la touche quand le focus est dans un champ", () => {
    largeur(true);
    const ajouter = vi.fn();
    renderHook(() => useRaccourcisDuBureau({ ajouter, malica: vi.fn() }, true));
    const champ = document.createElement("input");
    document.body.append(champ);
    taper("KeyN", champ);
    expect(ajouter).not.toHaveBeenCalled();
  });

  it("ne fait rien sous la largeur de bureau", () => {
    largeur(false);
    const ajouter = vi.fn();
    renderHook(() => useRaccourcisDuBureau({ ajouter, malica: vi.fn() }, true));
    expect(taper("KeyN").defaultPrevented).toBe(false);
    expect(ajouter).not.toHaveBeenCalled();
  });

  it("ne fait rien tant qu'ils sont coupés, et se retire au démontage", () => {
    largeur(true);
    const ajouter = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ actifs }) => useRaccourcisDuBureau({ ajouter, malica: vi.fn() }, actifs),
      { initialProps: { actifs: false } },
    );
    taper("KeyN");
    expect(ajouter).not.toHaveBeenCalled();
    rerender({ actifs: true });
    taper("KeyN");
    expect(ajouter).toHaveBeenCalledTimes(1);
    unmount();
    taper("KeyN");
    expect(ajouter).toHaveBeenCalledTimes(1);
  });
});
