// @vitest-environment jsdom
/**
 * L'en-tête d'un écran du cabinet : le chapeau ne s'affiche plus sous le
 * titre, il s'ouvre par le ⓘ (Wissem, 5 novembre 2026 : « les explications
 * doivent être dans le i »). La phrase ne se perd pas.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));

import { EnTeteCabinet } from "../office-ui";

afterEach(cleanup);

describe("EnTeteCabinet", () => {
  it("met le chapeau derrière le ⓘ, nommé par le titre", () => {
    render(<EnTeteCabinet titre={<>Échéances</>} chapeau={<>Les dates viennent du pack.</>} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Échéances");
    expect(screen.queryByText("Les dates viennent du pack.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "common.aide — Échéances" }));
    expect(screen.getByRole("dialog", { name: "Échéances" }).textContent).toContain(
      "Les dates viennent du pack.",
    );
  });

  it("ne pose aucun ⓘ sans chapeau", () => {
    render(<EnTeteCabinet titre="Plan comptable" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
