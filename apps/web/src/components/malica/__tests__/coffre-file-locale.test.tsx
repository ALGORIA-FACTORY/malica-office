/**
 * Le coffre de la PME — une capture privée encore sur le téléphone n'est pas un coffre vide.
 *
 * Garantit que, tant qu'une pièce privée attend d'être envoyée dans la file locale, l'écran
 * la montre au lieu d'annoncer que le coffre est vide ; le vide ne s'annonce que si ni le
 * serveur ni la file n'ont de pièce privée. Sinon la personne croirait sa capture perdue.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const etat = vi.hoisted(() => ({ priveEnAttente: false }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => vi.fn(),
  // Le retour suit l'historique (`useRevenir`) : ici, rien derrière.
  useRouter: () => ({ history: { canGoBack: () => false, back: vi.fn() }, navigate: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  // Chaque requête rend la forme de son contrat : les droits sont une liste.
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === "mon-acces"
      ? { isSuccess: true, data: { droits: [] }, fetchStatus: "idle" }
      : queryKey[0] === "place-comptable"
        ? {
            isSuccess: true,
            data: { incluses: 1, engagees: 0, comptables: [], invitations: [] },
            fetchStatus: "idle",
          }
        : { isSuccess: true, data: [], fetchStatus: "idle" },
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
