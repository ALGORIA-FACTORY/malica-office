/**
 * Une version précédente, ouverte par le cabinet : l'avis et le chemin vers la
 * photo qui fait foi — aucune action, toutes refusées par la base.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const dossier = vi.hoisted(() => ({
  piece: {
    id: "A",
    tenantId: "pme",
    status: "retournee",
    remplace: null,
    remplaceePar: "B",
    versionCourante: "C",
  },
  contenu: new ArrayBuffer(1),
  extraction: null,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ pieceId: "A" }),
  }),
  Link: ({ children }: { children: unknown }) => createElement("a", null, children as never),
  useCanGoBack: () => false,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (o: { queryKey: unknown[] }) =>
    o.queryKey[0] === "piece"
      ? { isPending: false, data: dossier }
      : { isPending: false, data: undefined },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet" } }),
  useMalicaPanel: () => ({ setContext: vi.fn(), open: vi.fn() }),
}));
vi.mock("@/components/malica/document-view", () => ({ DocumentView: () => "DOCUMENT" }));
vi.mock("@/verticals/malica-office/composition", () => ({ office: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));

import { Route } from "@/routes/_authenticated/cabinet.piece.$pieceId";

describe("le cabinet devant une version précédente", () => {
  it("dit qu'elle est remplacée, mène à la courante, et n'offre aucune action", () => {
    const html = renderToStaticMarkup(createElement(Route.options.component!));
    expect(html).toContain("piece.versionPrecedente.titre");
    expect(html).toContain("piece.versionPrecedente.remplacee");
    expect(html).toContain("piece.versionPrecedente.voir");
    expect(html).toContain("DOCUMENT");
    // Ni valider, ni retourner, ni corriger, ni proposer : la base refuserait.
    expect(html).not.toMatch(/cab\.review\.(motif|correct|ecriture|prev|next)/);
    expect(html).not.toContain("statut.cab.");
  });
});
