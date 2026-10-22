import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const etat = vi.hoisted(() => ({ cle: "", pending: false, error: false }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const cible = queryKey[0] === etat.cle;
    return {
      data: queryKey[0] === "compte" ? { email: "expert@example.test" } : [],
      isPending: cible && etat.pending,
      error: cible && etat.error ? new Error("Réseau indisponible") : null,
      refetch: vi.fn(),
    };
  },
  useQueries: () => [],
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", jurisdiction: "pack" } }),
  useMalicaPanel: vi.fn(),
}));
vi.mock("@/components/malica/OuvrirDossier", () => ({ OuvrirDossier: () => null }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));
vi.mock("@/verticals/malica-office/composition", () => ({ office: vi.fn() }));

import { Route } from "@/routes/_authenticated/cabinet.clients";

describe("le portefeuille indisponible du cabinet", () => {
  beforeEach(() => Object.assign(etat, { cle: "", pending: false, error: false }));

  for (const cle of ["cab-clients", "cab-queue", "cab-members", "cab-assignments", "compte"]) {
    it(`ne présente pas un portefeuille vide quand ${cle} échoue`, () => {
      Object.assign(etat, { cle, error: true });
      const html = renderToStaticMarkup(createElement(Route.options.component!));
      expect(html).toContain('role="alert"');
      expect(html).toContain("doc.retry");
      expect(html).not.toContain("cab.clients.empty");
      expect(html).not.toContain("cab.clients.kpi.mandats");
    });
  }

  it("attend les affectations avant d'annoncer des dossiers sans collaborateur", () => {
    Object.assign(etat, { cle: "cab-assignments", pending: true });
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toContain("common.loading");
    expect(html).not.toContain("cab.clients.kpi.sans");
    expect(html).not.toContain("cab.clients.empty");
  });

  it("annonce le vrai vide après les lectures réussies", () => {
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toContain("cab.clients.empty");
    expect(html).not.toContain('role="alert"');
  });
});
