/**
 * Une comptabilité qui a seulement DEMANDÉ un mandat ne lit, sur sa page
 * Clients, que « mandat demandé · en attente de la société » (recette du
 * 11 novembre 2026, 3.3) — jamais le nom du dirigeant ni « a rejoint ».
 *
 * La base ne rend plus rien de la société pour un mandat proposé
 * (`changer-de-comptabilite-en-un-geste.test.ts`, côté API) ; l'écran, lui,
 * ne l'affiche pas même si une donnée lui parvenait.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const donnees: Record<string, unknown> = {
  "cab-clients": [
    {
      tenantId: "pme",
      name: "Société Demandée",
      legalId: "1234567A",
      engagementStatus: "propose",
      parStatut: {},
      aTraiter: 0,
    },
  ],
  "cab-etat-clients": [
    {
      tenantId: "pme",
      dirigeantPresent: true,
      titulaireNom: "Samia Ben Salah",
      invitationEmail: null,
    },
  ],
  "cab-hono-mandats": [],
};
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
  useNavigate: () => vi.fn(),
  Link: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: donnees[queryKey[0]!],
    isPending: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
  }),
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

describe("un mandat demandé", () => {
  it("ne montre que « mandat demandé · en attente de la société »", () => {
    const html = renderToStaticMarkup(
      createElement((Route as unknown as { options: { component: () => null } }).options.component),
    );
    expect(html).toContain("Société Demandée");
    expect(html).toContain("cab.cli.mandat.demande");
    expect(html).toContain("cab.cli.mandat.attenteSociete");
    expect(html).not.toContain("Samia Ben Salah");
    expect(html).not.toContain("cab.cli.dir.rejoint");
  });
});
