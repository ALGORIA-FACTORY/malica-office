// @vitest-environment jsdom
/**
 * Une langue dont le dictionnaire n'a pas pu se charger (hors ligne) reste
 * choisissable : la choisir de nouveau relance le chargement, sans devoir
 * passer par une autre langue ni recharger la page.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const essais = vi.hoisted(() => ({ en: 0 }));

vi.mock("@malica/socle/messages-en", async (original) => {
  essais.en += 1;
  if (essais.en === 1) throw new Error("hors ligne");
  return original();
});

import { I18nProvider, useI18n, type Locale } from "@/i18n";

let choisir: (l: Locale) => void = () => undefined;

function Sonde() {
  const { locale, setLocale } = useI18n();
  choisir = setLocale;
  return createElement("p", null, locale);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("la langue à la demande", () => {
  it("un échec de chargement garde l'écran lisible, et le même choix réessaie", async () => {
    render(createElement(I18nProvider, null, createElement(Sonde)));
    expect(screen.getByText("fr")).toBeTruthy();

    act(() => choisir("en"));
    await waitFor(() => expect(essais.en).toBe(1));
    expect(screen.getByText("fr")).toBeTruthy();

    act(() => choisir("en"));
    await waitFor(() => expect(screen.getByText("en")).toBeTruthy());
  });
});
