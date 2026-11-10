// @vitest-environment jsdom
/**
 * Le bouton retour — revenir là d'où l'on vient — garanti par deux cas.
 *
 * Avec un historique, le retour recule (la bibliothèque si l'on venait d'elle). Sans
 * historique — lien ouvert directement, notification — il va à l'écran parent, en
 * remplaçant l'entrée courante pour ne pas empiler. Sans ce test, un dossier ouvert
 * depuis la bibliothèque ramènerait de nouveau à l'accueil.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const routeur = vi.hoisted(() => ({
  history: { canGoBack: vi.fn(), back: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => routeur }));

import { useRevenir } from "@/hooks/use-revenir";

describe("le retour revient là d'où l'on vient", () => {
  it("avec un historique : il recule (la bibliothèque, si l'on venait d'elle)", () => {
    routeur.history.canGoBack.mockReturnValue(true);
    renderHook(() => useRevenir()).result.current("/pme");
    expect(routeur.history.back).toHaveBeenCalledOnce();
    expect(routeur.navigate).not.toHaveBeenCalled();
  });

  it("sans historique (lien direct, notification) : l'écran parent, sans empiler", () => {
    routeur.history.canGoBack.mockReturnValue(false);
    renderHook(() => useRevenir()).result.current("/pme/list");
    expect(routeur.navigate).toHaveBeenCalledWith({ to: "/pme/list", replace: true });
  });
});
