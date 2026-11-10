/**
 * La page Clients du cabinet quand une lecture échoue — jamais un portefeuille vide à tort.
 *
 * Garantit que la panne de l'une des trois lectures (clients, état des clients, mandats)
 * s'annonce avec un moyen de réessayer, au lieu de dire à l'expert qu'il n'a aucun client ;
 * que l'attente ne conclut rien ; et que seul le tout premier jour propose d'importer ou
 * d'ajouter des clients.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const etat = vi.hoisted(() => ({ cle: "", pending: false, error: false }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
  useNavigate: () => vi.fn(),
  Link: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const cible = queryKey[0] === etat.cle;
    return {
      data: [],
      isPending: cible && etat.pending,
      isSuccess: !(cible && (etat.pending || etat.error)),
      error: cible && etat.error ? new Error("Réseau indisponible") : null,
      refetch: vi.fn(),
    };
  },
  useQueries: () => [],
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", jurisdiction: "pack", currency: "TND" } }),
  useMalicaPanel: vi.fn(),
}));
vi.mock("@/hooks/use-mon-acces", () => ({ useMonAcces: () => ({ data: { role: "expert" } }) }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));
vi.mock("@/verticals/malica-office/composition", () => ({ office: vi.fn() }));

import { Route } from "@/routes/_authenticated/cabinet.clients";

const rendre = () =>
  renderToStaticMarkup(
    createElement((Route as unknown as { options: { component: () => null } }).options.component),
  );

describe("la page Clients indisponible", () => {
  beforeEach(() => Object.assign(etat, { cle: "", pending: false, error: false }));

  for (const cle of ["cab-clients", "cab-etat-clients", "cab-hono-mandats"]) {
    it(`ne présente pas un portefeuille vide quand ${cle} échoue`, () => {
      Object.assign(etat, { cle, error: true });
      const html = rendre();
      expect(html).toContain('role="alert"');
      expect(html).toContain("doc.retry");
      expect(html).not.toContain("cab.cli.vide.titre");
    });
  }

  it("attend l'état des clients avant de dire quoi que ce soit", () => {
    Object.assign(etat, { cle: "cab-etat-clients", pending: true });
    const html = rendre();
    expect(html).toContain("common.loading");
    expect(html).not.toContain("cab.cli.vide.titre");
  });

  it("le tout premier jour propose d'importer ou d'ajouter, rien d'autre", () => {
    const html = rendre();
    expect(html).toContain("cab.cli.vide.titre");
    expect(html).toContain("cab.cli.importer");
    expect(html).toContain("cab.cli.ajouter");
    expect(html).not.toContain('role="alert"');
  });
});
