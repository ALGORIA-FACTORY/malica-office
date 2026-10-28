// @vitest-environment jsdom
/**
 * La carte d'une pièce retournée : rien ne bloque (« Malica sans blocage »,
 * maquette validée le 28 octobre 2026). Avant, « Renvoyer » restait éteint tant
 * que le geste n'était pas fait, et il inscrivait l'écriture ; ni supprimer ni
 * garder n'étaient offerts.
 */
import type { RetourDuCabinet } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ capture: { repondreAuCabinet: vi.fn() } }),
}));

import { CarteDuRetour } from "../retour-du-cabinet";

const RETOUR: RetourDuCabinet = {
  le: "2026-10-28T09:15:00.000Z",
  note: "Merci de joindre le bon de livraison.",
  motif: "justificatif_manquant",
  motifLibelle: "Justificatif manquant",
  geste: "joindre_document",
  cabinet: "COMPTA ESSAI",
  fait: false,
};

function monter(retour: Partial<RetourDuCabinet> = {}) {
  const gestes = {
    onGeste: vi.fn(),
    onReprendreLaPhoto: vi.fn(),
    onVoirLeFait: vi.fn(),
    renvoyer: { action: vi.fn(), enCours: false },
    garder: { action: vi.fn(), enCours: false },
    supprimer: { action: vi.fn(), enCours: false },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CarteDuRetour pieceId="p1" retour={{ ...RETOUR, ...retour }} {...gestes} />
    </QueryClientProvider>,
  );
  return gestes;
}

/** Les boutons de sortie, dans l'ordre de l'écran. */
const boutonsDeSortie = () =>
  within(document.querySelector<HTMLElement>(".f-ret-sorties")!).getAllByRole("button");
const sorties = () => boutonsDeSortie().map((b) => b.textContent);

describe("une pièce retournée ne bloque jamais", () => {
  afterEach(cleanup);

  it("toutes les sorties sont là, le geste du motif d'abord, et aucune n'est éteinte", () => {
    monter();
    expect(sorties()).toEqual([
      "pme.retour.geste.joindre_document",
      "pme.retour.renvoyer",
      "pme.retour.geste.reprendre_photo",
      "pme.retour.geste.repondre",
      "pme.garder.action",
      "pme.supprimer.action",
    ]);
    const boutons = boutonsDeSortie();
    for (const b of boutons) expect((b as HTMLButtonElement).disabled).toBe(false);
    expect(boutons[0]!.classList.contains("pr")).toBe(true);
  });

  it("« Renvoyer » se fait sans que le geste soit fait : le cabinet décidera", () => {
    const g = monter();
    fireEvent.click(screen.getByRole("button", { name: "pme.retour.renvoyer" }));
    expect(g.renvoyer.action).toHaveBeenCalledOnce();
  });

  it("le geste fait, « Renvoyer » passe en tête, et ce qui est fait se voit", () => {
    monter({ geste: "reprendre_photo", fait: true });
    expect(sorties()[0]).toBe("pme.retour.renvoyer");
    expect(screen.getByText("pme.retour.fait.photo")).toBeTruthy();
  });

  it("reprendre la photo et garder sont des gestes directs", () => {
    const g = monter();
    fireEvent.click(screen.getByRole("button", { name: "pme.retour.geste.reprendre_photo" }));
    fireEvent.click(screen.getByRole("button", { name: "pme.garder.action" }));
    expect(g.onReprendreLaPhoto).toHaveBeenCalledOnce();
    expect(g.garder.action).toHaveBeenCalledOnce();
  });

  it("supprimer se confirme, puis part ; « Annuler » rend les sorties", () => {
    const g = monter();
    fireEvent.click(screen.getByRole("button", { name: "pme.supprimer.action" }));
    const sur = screen.getByRole("alertdialog");
    expect(within(sur).getByText("pme.retour.supprimer.sur")).toBeTruthy();
    expect(g.supprimer.action).not.toHaveBeenCalled();
    fireEvent.click(within(sur).getByRole("button", { name: "common.cancel" }));
    expect(sorties()).toContain("pme.retour.renvoyer");

    fireEvent.click(screen.getByRole("button", { name: "pme.supprimer.action" }));
    fireEvent.click(screen.getByRole("button", { name: "pme.supprimer.oui" }));
    expect(g.supprimer.action).toHaveBeenCalledOnce();
  });

  it("le motif « demander la suppression » se fait par la suppression directe", () => {
    const g = monter({ geste: "demander_suppression", motif: "doublon" });
    expect(sorties()[0]).toBe("pme.supprimer.action");
    expect(sorties()).not.toContain("pme.retour.geste.demander_suppression");
    fireEvent.click(screen.getAllByRole("button", { name: "pme.supprimer.action" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "pme.supprimer.oui" }));
    expect(g.supprimer.action).toHaveBeenCalledOnce();
  });

  it("ce que fait chaque sortie est dans le ⓘ, pas dans la carte", () => {
    monter();
    expect(screen.queryByText(/pme\.retour\.aide\.renvoyer/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /pme\.retour\.aide\.titre/ }));
    const aide = screen.getByRole("dialog");
    for (const cle of ["renvoyer", "reprendre", "repondre", "garder", "supprimer"])
      expect(within(aide).getByText(new RegExp(`pme\\.retour\\.aide\\.${cle}`))).toBeTruthy();
  });

  it("une sortie en cours éteint les autres : un seul geste à la fois", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CarteDuRetour
          pieceId="p1"
          retour={RETOUR}
          onGeste={vi.fn()}
          onReprendreLaPhoto={vi.fn()}
          onVoirLeFait={vi.fn()}
          renvoyer={{ action: vi.fn(), enCours: true }}
          garder={{ action: vi.fn(), enCours: false }}
          supprimer={{ action: vi.fn(), enCours: false }}
        />
      </QueryClientProvider>,
    );
    expect(
      (screen.getByRole("button", { name: "common.loading" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "pme.garder.action" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
