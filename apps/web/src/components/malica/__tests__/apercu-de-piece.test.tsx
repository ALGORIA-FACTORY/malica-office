// @vitest-environment jsdom
/**
 * L'aperçu d'une pièce : une miniature légère, demandée seulement quand elle
 * approche de l'écran, et la feuille esquissée quand il n'y a rien à montrer.
 *
 * Le défaut qui l'a fait naître : chaque aperçu de liste chargeait les octets
 * COMPLETS de la pièce (`capture.apercu`, un à trois mégaoctets), vingt à cent
 * fois par liste. Ces épreuves verrouillent que la liste demande la miniature,
 * et rien d'autre.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ miniature: vi.fn(), apercu: vi.fn() }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ capture: { miniature: api.miniature, apercu: api.apercu } }),
}));

import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { rafraichirLApercu } from "@/lib/rafraichir-l-apercu";
import { ErreurApi } from "@/lib/transport/erreurs";

/** Un `IntersectionObserver` que l'épreuve déclenche à la main. */
class ObservateurDEssai {
  static tous: ObservateurDEssai[] = [];
  constructor(readonly rappel: IntersectionObserverCallback) {
    ObservateurDEssai.tous.push(this);
  }
  observe() {}
  disconnect() {}
  approcher() {
    this.rappel(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function monter(enfant: ReactNode, dir: "ltr" | "rtl" = "ltr") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <div dir={dir}>{enfant}</div>
      </QueryClientProvider>,
    ),
  };
}

describe("l'aperçu d'une pièce", () => {
  beforeEach(() => {
    ObservateurDEssai.tous = [];
    vi.stubGlobal("IntersectionObserver", ObservateurDEssai);
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:mini", revokeObjectURL: () => {} }),
    );
    api.miniature.mockReset();
    api.apercu.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("ne demande rien tant qu'il n'approche pas de l'écran", () => {
    const { container } = monter(<ApercuDePiece pieceId="p1" className="vignette" />);
    expect(api.miniature).not.toHaveBeenCalled();
    expect(api.apercu).not.toHaveBeenCalled();
    // La feuille esquissée tient la place, sans rien inventer.
    expect(container.querySelector(".apercu .esq")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("demande la MINIATURE, jamais les octets complets, et la montre", async () => {
    api.miniature.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    const { container } = monter(<ApercuDePiece pieceId="p1" className="vignette" />);
    act(() => ObservateurDEssai.tous[0]!.approcher());
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(api.miniature).toHaveBeenCalledWith("p1");
    expect(api.apercu).not.toHaveBeenCalled();
    expect(container.querySelector("img")!.getAttribute("src")).toBe("blob:mini");
  });

  it("garde la feuille esquissée quand le serveur n'en tire pas de miniature", async () => {
    api.miniature.mockResolvedValue(null);
    const { container } = monter(<ApercuDePiece pieceId="p2" />);
    act(() => ObservateurDEssai.tous[0]!.approcher());
    await waitFor(() => expect(api.miniature).toHaveBeenCalledWith("p2"));
    expect(container.querySelector(".esq")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("garde aussi la feuille quand la demande échoue", async () => {
    api.miniature.mockRejectedValue(new Error("réseau"));
    const { container } = monter(<ApercuDePiece pieceId="p3" />);
    act(() => ObservateurDEssai.tous[0]!.approcher());
    await waitFor(() => expect(api.miniature).toHaveBeenCalled());
    expect(container.querySelector(".esq")).not.toBeNull();
  });

  it("une pièce seule affichée en grand garde la page entière", async () => {
    api.apercu.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    const { container } = monter(<ApercuDePiece pieceId="p4" taille="page" />);
    act(() => ObservateurDEssai.tous[0]!.approcher());
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(api.apercu).toHaveBeenCalledWith("p4");
    expect(api.miniature).not.toHaveBeenCalled();
  });

  it("est décoratif : le nom de la pièce est toujours écrit à côté", async () => {
    api.miniature.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    const { container } = monter(<ApercuDePiece pieceId="p5" />);
    const cadre = container.querySelector(".apercu")!;
    expect(cadre.getAttribute("aria-hidden")).toBe("true");
    expect(cadre.getAttribute("role")).toBeNull();
    act(() => ObservateurDEssai.tous[0]!.approcher());
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("un « contenu absent » (404) n'est pas définitif : il se réessaie", async () => {
    // La pièce photographiée hors ligne : la ligne existe, les octets arrivent.
    api.miniature
      .mockRejectedValueOnce(new ErreurApi("contenu absent", 404))
      .mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    const { container } = monter(<ApercuDePiece pieceId="p6" />);
    act(() => ObservateurDEssai.tous[0]!.approcher());
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull(), {
      timeout: 5000,
    });
    expect(api.miniature).toHaveBeenCalledTimes(2);
  });

  it("une autre erreur ne se réessaie pas : la feuille reste", async () => {
    api.miniature.mockRejectedValue(new ErreurApi("refusé", 403));
    monter(<ApercuDePiece pieceId="p6b" />);
    act(() => ObservateurDEssai.tous[0]!.approcher());
    await waitFor(() => expect(api.miniature).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 2500));
    expect(api.miniature).toHaveBeenCalledTimes(1);
  });

  it("la file hors ligne relance l'aperçu quand elle a déposé les octets", async () => {
    api.miniature.mockResolvedValueOnce(null);
    const { client, container } = monter(<ApercuDePiece pieceId="p6c" />);
    act(() => ObservateurDEssai.tous[0]!.approcher());
    await waitFor(() => expect(api.miniature).toHaveBeenCalledTimes(1));
    expect(container.querySelector("img")).toBeNull();
    api.miniature.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    await act(() => rafraichirLApercu(client, "p6c"));
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
  });

  it("porte le point d'état seulement quand on lui en donne un", () => {
    const sans = monter(<ApercuDePiece pieceId="p7" />);
    expect(sans.container.querySelector(".pt")).toBeNull();
    cleanup();
    const avec = monter(<ApercuDePiece pieceId="p7" ton="am" />);
    expect(avec.container.querySelector(".pt")!.getAttribute("data-ton")).toBe("am");
  });

  it("en arabe, le point se place par sa propriété logique, au début de la lecture", () => {
    const { container } = monter(<ApercuDePiece pieceId="p8" ton="az" />, "rtl");
    expect(container.querySelector('[dir="rtl"] .apercu .pt')).not.toBeNull();
    // jsdom ne calcule pas la mise en page : on vérifie la règle elle-même.
    // Une propriété physique (`right:`) laisserait le point du mauvais côté.
    const feuille = readFileSync(path.resolve(__dirname, "../../../styles.css"), "utf8");
    const regle = /\.apercu \.pt \{([^}]*)\}/.exec(feuille)?.[1] ?? "";
    expect(regle).toContain("inset-inline-end");
    expect(regle).not.toMatch(/(^|[\s;])(left|right):/);
  });
});
