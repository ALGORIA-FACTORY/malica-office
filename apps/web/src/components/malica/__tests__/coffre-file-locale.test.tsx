import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const etat = vi.hoisted(() => ({ priveEnAttente: false }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isSuccess: true, data: [], fetchStatus: "idle" }),
  useMutation: () => ({}),
  useQueryClient: () => ({}),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    tenantId: "dossier",
    file: { elements: etat.priveEnAttente ? [{ vis: "personnel" }] : [] },
  }),
}));
vi.mock("@/components/malica/file-locale", () => ({
  FileLocale: () => (etat.priveEnAttente ? "CAPTURE_PRIVEE_EN_ATTENTE" : null),
}));
vi.mock("@/verticals/malica-office/composition", () => ({ office: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));

import { Route } from "@/routes/_authenticated/pme.coffre";

describe("l'état vide du coffre", () => {
  beforeEach(() => {
    etat.priveEnAttente = false;
  });

  it("montre la capture locale sans annoncer que le coffre est vide", () => {
    etat.priveEnAttente = true;
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toContain("CAPTURE_PRIVEE_EN_ATTENTE");
    expect(html).not.toContain("pme.prive.vide");
  });

  it("annonce le vide quand ni le serveur ni la file n'ont de pièce privée", () => {
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toContain("pme.prive.vide");
  });
});
