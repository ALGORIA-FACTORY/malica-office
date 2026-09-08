/**
 * L'apparence emmène la barre d'état du téléphone avec elle.
 *
 * Sous Android 15, l'écran passe sous la barre d'état ; ses icônes (heure,
 * batterie) sont dessinées par le système dans la couleur qu'on lui demande.
 * Passer en Ink sans les éclaircir les rend invisibles sur le fond sombre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const setStyle = vi.fn(async () => undefined);

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: { setStyle, setOverlaysWebView: async () => undefined },
  Style: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
}));

// La coque native : `Capacitor` sur la fenêtre, comme le pont le pose.
(globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };

const { coque } = await import("@/capabilities/coque");

describe("l'apparence et la barre d'état", () => {
  beforeEach(() => setStyle.mockClear());

  it("éclaircit les icônes en sombre, les assombrit en clair", async () => {
    coque().apparence.appliquer(true);
    await vi.waitFor(() => expect(setStyle).toHaveBeenCalledWith({ style: "DARK" }));
    coque().apparence.appliquer(false);
    await vi.waitFor(() => expect(setStyle).toHaveBeenCalledWith({ style: "LIGHT" }));
  });
});
