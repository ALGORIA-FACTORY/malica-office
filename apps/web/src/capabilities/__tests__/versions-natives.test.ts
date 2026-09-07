/**
 * La coque rend la version native comme un objet neuf — jamais la réponse du
 * greffon telle quelle, encore moins le greffon (voir coffre-preferences).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/app", () => ({
  App: {
    getInfo: async () => ({
      name: "Regalica Office",
      id: "com.algoriafactory.regalica",
      build: "6",
      version: "0.1.1",
    }),
    addListener: async () => ({ remove: async () => undefined }),
    exitApp: async () => undefined,
  },
}));

(globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };

const { coque } = await import("@/capabilities/coque");

describe("la version native", () => {
  it("dit la version du magasin et sa construction", async () => {
    await expect(coque().versions.native()).resolves.toEqual({ version: "0.1.1", build: "6" });
  });
});
