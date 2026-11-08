// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const donnees = vi.hoisted(() => ({ actifs: false, panne: false }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/cabinet",
  Link: ({
    to,
    params,
    children,
    ...props
  }: ComponentProps<"a"> & { to: string; params?: Record<string, string> }) =>
    createElement(
      "a",
      {
        ...props,
        href: Object.entries(params ?? {}).reduce((s, [k, v]) => s.replace(`$${k}`, v), to),
      },
      children,
    ),
  Outlet: () => createElement(Journee.options.component!),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const k = queryKey[0];
    let data: unknown = [];
    if (k === "my-cabinets") data = [{ id: "cabinet", name: "Comptabilité", jurisdiction: "TN" }];
    if (k === "cab-clients")
      data = donnees.actifs
        ? [{ tenantId: "client", name: "Dossier de test", engagementStatus: "actif" }]
        : [];
    if (k === "cab-queue" && donnees.actifs)
      // Le statut d'envoi est dérivé à l'API ; la file l'affiche tel quel.
      data = (
        [
          ["comptabilisee", "recue"],
          ["retournee", "retournee"],
          ["supervisee", "validee"],
        ] as const
      ).map(([status, statut], i) => ({
        pieceId: `piece-${i}`,
        tenantId: "client",
        clientName: "Dossier de test",
        libelle: `Pièce de test ${i}`,
        status,
        statut,
        createdAt: new Date().toISOString(),
        ecritureId: `ecriture-${i}`,
        montant: null,
      }));
    if (k === "cab-acces") data = { role: "expert", plateforme: false };
    if (k === "cab-conseil-stats") data = { totaux: { enAttente: 0 } };
    if (k === "cab-honoraires-synthese") data = { nbRetard: 0 };
    if (k === "ref-pack") data = null;
    // La miniature de chaque ligne de la file : rien à montrer, la feuille esquissée.
    if (k === "apercu") data = null;
    return {
      data,
      isPending: false,
      isSuccess: true,
      error: donnees.panne && k === "cab-queue" ? new Error("Service indisponible") : null,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@/components/malica/dossier-courant", () => ({ useDossierCourant: () => null }));
vi.mock("@/components/malica/se-deconnecter", () => ({ SeDeconnecter: () => null }));

import { I18nProvider } from "@/i18n";
import { Route as Journee } from "@/routes/_authenticated/cabinet.index";
import { Route as Espace } from "@/routes/_authenticated/cabinet";

const interfaceReelle = () =>
  createElement(I18nProvider, null, createElement(Espace.options.component!));

describe("une journée de comptabilité compréhensible et actionnable", () => {
  beforeEach(() => {
    Object.assign(donnees, { actifs: false, panne: false });
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);
  it("la file se lit en piles, et le filtre retrouve toute la file", () => {
    donnees.actifs = true;
    render(interfaceReelle());
    expect(screen.getAllByRole("button", { expanded: false }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Filtrer client ou libellé" }), {
      target: { value: "introuvable" },
    });
    expect(screen.getByText("Aucune pièce ne correspond")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Afficher toute la file" }));
    expect(screen.queryByText("Aucune pièce ne correspond")).toBeNull();
  });
  it("sans mandat, propose le portefeuille et ne propose aucune revue factice", () => {
    render(interfaceReelle());
    expect(
      screen.getByRole("heading", { name: "Votre prochain dossier commence ici" }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Commencer la revue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fermer le fil de Malica" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Outils et réglages" }).getAttribute("aria-expanded"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Outils et réglages" }));
    expect(screen.getByRole("link", { name: "Réglages" })).toBeTruthy();
  });
  it("une panne n'affiche pas une file à jour", () => {
    donnees.panne = true;
    render(interfaceReelle());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Votre file est à jour")).toBeNull();
  });
  it("le rendu serveur reprend les composants de production pour la revue visuelle", async () => {
    const html = renderToStaticMarkup(interfaceReelle());
    expect(html).toContain('data-surface="comptabilite"');
    expect(html).toContain("Votre journée, en clair.");
    if (process.env["MALICA_VISUAL_DIR"]) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const dir = process.env["MALICA_VISUAL_DIR"];
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/interface.html`, html);
    }
  });
});
