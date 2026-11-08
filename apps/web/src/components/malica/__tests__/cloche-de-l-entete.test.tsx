// @vitest-environment jsdom
/**
 * La cloche de l'en-tête (planche 12, approuvée le 7 novembre 2026).
 *
 *   — elle compte les non lues et mène à l'écran des notifications ;
 *   — l'ouverture de l'application ne la fait PAS sonner ;
 *   — une arrivée la fait sonner et l'île dit ce qui arrive, puis se tait ;
 *   — tout lu : plus de pastille, une coche passe.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) =>
    createElement("a", { href: to, ...rest }, children),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: Record<string, unknown>) =>
      vars && "count" in vars ? `${cle}:${String(vars["count"])}` : cle,
    locale: "fr",
  }),
}));

import { ClocheDeLEntete, type ClocheProps } from "../cloche-de-l-entete";

const retour = {
  id: "n1",
  kind: "piece.retournee",
  payload: { note: "Justificatif manquant" },
};

function monter(props: ClocheProps) {
  const vue = render(createElement(ClocheDeLEntete, props));
  return {
    ...vue,
    changer: (p: ClocheProps) => vue.rerender(createElement(ClocheDeLEntete, p)),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("la cloche de l'en-tête", () => {
  it("compte les non lues et mène aux notifications", () => {
    const { container } = monter({ nonLues: 34, derniere: retour });
    const lien = screen.getByRole("link", { name: "pme.cloche.nonLues:34" });
    expect(lien.getAttribute("href")).toBe("/pme/notifications");
    expect(container.querySelector(".pas")?.textContent).toBe("34");
  });

  it("au-delà de 99, la pastille dit 99+", () => {
    const { container } = monter({ nonLues: 250, derniere: retour });
    expect(container.querySelector(".pas")?.textContent).toBe("99+");
  });

  it("l'ouverture de l'application ne la fait pas sonner", () => {
    const { container, changer } = monter({ nonLues: null, derniere: null });
    changer({ nonLues: 12, derniere: retour });
    expect(container.querySelector("[data-sonne]")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("une arrivée la fait sonner, l'île dit ce qui arrive, puis tout se tait", () => {
    const { container, changer } = monter({ nonLues: 3, derniere: null });
    changer({ nonLues: 4, derniere: retour });
    expect(container.querySelector(".cl[data-sonne]")).not.toBeNull();
    expect(container.querySelector(".pas[data-pop]")).not.toBeNull();
    const ile = screen.getByRole("status");
    expect(ile.textContent).toContain("notif.kind.piece.retournee");
    expect(ile.textContent).toContain("Justificatif manquant");

    act(() => vi.advanceTimersByTime(1400));
    expect(container.querySelector("[data-sonne]")).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("une seconde arrivée pendant la première relance la sonnerie sans la figer", () => {
    const { container, changer } = monter({ nonLues: 1, derniere: null });
    changer({ nonLues: 2, derniere: retour });
    act(() => vi.advanceTimersByTime(800));
    changer({ nonLues: 3, derniere: retour });
    act(() => vi.advanceTimersByTime(1400));
    expect(container.querySelector("[data-sonne]")).toBeNull();
  });

  it("tout lu : la pastille part, une coche passe", () => {
    const { container, changer } = monter({ nonLues: 2, derniere: retour });
    changer({ nonLues: 0, derniere: null });
    expect(container.querySelector(".pas")).toBeNull();
    expect(container.querySelector(".vu")).not.toBeNull();
    expect(container.querySelector(".cloche[data-calme]")).not.toBeNull();
    act(() => vi.advanceTimersByTime(2300));
    expect(container.querySelector(".vu")).toBeNull();
  });
});
