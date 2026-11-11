// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));

import { ZoneDeLaPhoto } from "../zone-de-la-photo";

const citation = {
  field: "totals.vat",
  page: 1,
  bbox: { x0: 0.5, y0: 0.4, x1: 0.7, y1: 0.43 },
  zone: "totaux",
};
const octets = (texte: string) => new TextEncoder().encode(texte).buffer as ArrayBuffer;

describe("la zone de la photo d'un champ", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:zone");
    URL.revokeObjectURL = vi.fn();
    // Une page de 900 × 1200 pixels : la zone se mesure en fractions, le cadre en pixels.
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 900;
        naturalHeight = 1200;
        set src(_: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("recadre la photo sur la zone citée, avec sa marge, et la cerne", async () => {
    render(<ZoneDeLaPhoto contenu={octets("JFIF")} citation={citation} onVoirLaPhoto={vi.fn()} />);
    const cadre = await screen.findByTestId("zone-de-la-photo");
    const image = await waitFor(() => {
      const i = cadre.querySelector("img");
      if (!i) throw new Error("pas encore");
      return i;
    });
    expect(image.getAttribute("src")).toBe("blob:zone");
    // La zone fait 0,2 de large + 2 × 0,06 de marge : la photo est agrandie 1 / 0,32 fois.
    expect(parseFloat(image.style.width)).toBeCloseTo(100 / 0.32, 3);
    // Le cadre a les proportions de la fenêtre en PIXELS : (0,32 × 900) / (0,07 × 1200).
    const [num, den] = cadre.style.aspectRatio.split("/").map(Number) as [number, number];
    expect(num / den).toBeCloseTo((0.32 * 900) / (0.07 * 1200), 3);
    expect(cadre.querySelectorAll("span[aria-hidden]")).toHaveLength(1);
  });

  it("dit qu'un champ n'a pas de zone quand la lecture n'en a pas cité", () => {
    render(<ZoneDeLaPhoto contenu={octets("JFIF")} citation={undefined} onVoirLaPhoto={vi.fn()} />);
    expect(screen.getByText("pme.crayon.sansZone")).toBeTruthy();
    expect(screen.queryByTestId("zone-de-la-photo")).toBeNull();
  });

  it("renvoie à la photo entière quand le PDF n'a pas d'image à recadrer", () => {
    const voir = vi.fn();
    render(
      <ZoneDeLaPhoto contenu={octets("%PDF-1.7 texte")} citation={citation} onVoirLaPhoto={voir} />,
    );
    expect(screen.queryByTestId("zone-de-la-photo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "pme.crayon.voirLaPhoto" }));
    expect(voir).toHaveBeenCalled();
  });
});
