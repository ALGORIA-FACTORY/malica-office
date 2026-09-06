/**
 * Le coffre natif ne rend jamais le greffon à travers une promesse.
 *
 * Le greffon Capacitor est un Proxy : lire une propriété devient un appel
 * natif. Résoudre une promesse avec lui fait lire `.then` — et la coque
 * appelait une méthode native « then » qui n'existe pas : écran blanc au
 * démarrage. Ce greffon factice explose de la même façon, pour que le coffre
 * ne retombe jamais dans ce piège.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const memoire = new Map<string, string>();

vi.mock("@capacitor/preferences", () => {
  const greffon = new Proxy(
    {},
    {
      get(_cible, propriete) {
        if (propriete === "then") {
          throw new Error('"Preferences.then()" is not implemented on web');
        }
        if (propriete === "get") {
          return async ({ key }: { key: string }) => ({ value: memoire.get(key) ?? null });
        }
        if (propriete === "set") {
          return async ({ key, value }: { key: string; value: string }) => {
            memoire.set(key, value);
          };
        }
        if (propriete === "remove") {
          return async ({ key }: { key: string }) => {
            memoire.delete(key);
          };
        }
        return undefined;
      },
    },
  );
  return { Preferences: greffon };
});

import { coffrePreferences } from "../jetons";

describe("le coffre natif des jetons", () => {
  beforeEach(() => memoire.clear());

  it("écrit, lit et efface sans jamais faire lire « then » au greffon", async () => {
    const coffre = coffrePreferences();
    expect(await coffre.lire()).toBeNull();
    await coffre.ecrire("jeton-long");
    expect(await coffre.lire()).toBe("jeton-long");
    await coffre.effacer();
    expect(await coffre.lire()).toBeNull();
  });
});
