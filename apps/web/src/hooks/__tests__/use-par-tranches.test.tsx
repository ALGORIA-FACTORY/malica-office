// @vitest-environment jsdom
/**
 * Une longue liste se dessine par tranches : la première aussitôt, la
 * suivante quand la sentinelle approche ; un autre groupe repart du début.
 */
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ParTranches } from "@/components/malica/par-tranches";

let rappels: Array<(e: Array<{ isIntersecting: boolean }>) => void> = [];

beforeEach(() => {
  rappels = [];
  class Observateur {
    constructor(rappel: (e: Array<{ isIntersecting: boolean }>) => void) {
      rappels.push(rappel);
    }
    observe() {}
    disconnect() {}
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = Observateur;
});
afterEach(() => {
  cleanup();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

const lignes = Array.from({ length: 250 }, (_, i) => `l${i}`);
const dessiner = (elements: string[]) =>
  createElement(ParTranches<string>, {
    elements,
    taille: 100,
    rendre: (x: string) => createElement("p", { key: x }, x),
  });

describe("une longue liste, par tranches", () => {
  it("dessine la première tranche, puis la suivante quand on approche", () => {
    const { container } = render(dessiner(lignes));
    expect(container.querySelectorAll("p")).toHaveLength(100);
    act(() => rappels.at(-1)!([{ isIntersecting: true }]));
    expect(container.querySelectorAll("p")).toHaveLength(200);
    act(() => rappels.at(-1)!([{ isIntersecting: true }]));
    expect(container.querySelectorAll("p")).toHaveLength(250);
    // Tout est là : plus de sentinelle.
    expect(container.querySelector("span")).toBeNull();
  });

  it("une liste courte s'affiche entière, sans sentinelle", () => {
    const { container } = render(dessiner(lignes.slice(0, 10)));
    expect(container.querySelectorAll("p")).toHaveLength(10);
    expect(container.querySelector("span")).toBeNull();
  });
});
