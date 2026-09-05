/**
 * Ce que la coque dit d'elle : hors de toute coque, un navigateur qui se
 * présente comme tel, avec la version du dépôt.
 */
import { afterEach, describe, expect, it } from "vitest";

import { estNatif, versionClient } from "../coque";

const global = globalThis as { Capacitor?: unknown };

describe("la coque, vue d'un navigateur", () => {
  afterEach(() => {
    delete global.Capacitor;
  });

  it("n'est pas native sans le pont de Capacitor", () => {
    expect(estNatif()).toBe(false);
  });

  it("est native quand la coque pose son pont, et seulement alors", () => {
    global.Capacitor = { isNativePlatform: () => true };
    expect(estNatif()).toBe(true);
    global.Capacitor = { isNativePlatform: () => false };
    expect(estNatif()).toBe(false);
  });

  it("se présente comme un client web, avec une version de la forme attendue par l'API", () => {
    expect(versionClient()).toMatch(/^web\/\d+(\.\d+)*$/);
  });
});
