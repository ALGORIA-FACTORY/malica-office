/**
 * Une transition d'écran que le navigateur saute n'est pas une erreur : elle
 * ne doit pas remonter comme un rejet non géré (Sentry, 11 novembre 2026).
 */
import { describe, expect, it } from "vitest";

import { taireLesTransitionsSautees } from "./mouvement";

/** Un document dont la transition rejette `ready` avec l'erreur donnée. */
function documentQuiSaute(erreur: unknown) {
  const transition = {
    ready: Promise.reject(erreur),
    finished: Promise.resolve(),
    updateCallbackDone: Promise.resolve(),
    skipTransition: () => undefined,
  };
  const doc = { startViewTransition: () => transition } as unknown as Document;
  return { doc, transition };
}

const erreurNommee = (name: string) => Object.assign(new Error(name), { name });

describe("une transition sautée n'est pas une erreur", () => {
  const laisserPasser = () => new Promise((suite) => setTimeout(suite, 10));

  it("le rejet « la taille de l'écran a changé » n'est pas signalé", async () => {
    const signales: unknown[] = [];
    const { doc, transition } = documentQuiSaute(erreurNommee("InvalidStateError"));
    taireLesTransitionsSautees(doc, (e) => signales.push(e));
    expect(doc.startViewTransition(() => undefined)).toBe(transition);
    await laisserPasser();
    expect(signales).toEqual([]);
  });

  it("une autre erreur reste signalée", async () => {
    const signales: unknown[] = [];
    const autre = erreurNommee("TypeError");
    const { doc } = documentQuiSaute(autre);
    taireLesTransitionsSautees(doc, (e) => signales.push(e));
    doc.startViewTransition(() => undefined);
    await laisserPasser();
    expect(signales).toEqual([autre]);
  });

  it("rend le navigateur comme il était, et ne fait rien sans l'API", () => {
    const { doc } = documentQuiSaute(erreurNommee("AbortError"));
    const origine = doc.startViewTransition;
    const rendre = taireLesTransitionsSautees(doc, () => undefined);
    doc.startViewTransition(() => undefined);
    expect(doc.startViewTransition).not.toBe(origine);
    rendre();
    expect(doc.startViewTransition).toBe(origine);
    expect(() => taireLesTransitionsSautees({} as Document)()).not.toThrow();
  });
});
