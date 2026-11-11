// @vitest-environment jsdom
/**
 * Le texte replié — un long texte se lit en quatre lignes et s'ouvre sur demande.
 *
 * Garantit qu'un long texte est replié avec « Lire la suite », que le bouton le déplie puis
 * le replie, et qu'un texte court reste tel quel, sans bouton inutile.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));

import { TexteReplie } from "../texte-replie";

afterEach(cleanup);

describe("TexteReplie", () => {
  it("replie un long texte et l'ouvre sur demande", () => {
    const long = "mot ".repeat(120);
    const { container } = render(<TexteReplie texte={long} />);
    expect(container.querySelector("p")!.className).toContain("line-clamp-4");
    fireEvent.click(screen.getByRole("button", { name: "common.lireLaSuite" }));
    expect(container.querySelector("p")!.className).not.toContain("line-clamp");
    expect(screen.getByRole("button", { name: "common.reduire" })).toBeTruthy();
  });

  it("laisse un court texte tel quel, sans bouton", () => {
    render(<TexteReplie texte="Bref." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
