// @vitest-environment jsdom
/**
 * Les photos des sièges : la base dit qui en a une (et sa version), puis chaque
 * photo se lit une fois par version. Une personne sans photo n'est pas lue ;
 * une photo changée se relit ; une photo inchangée non.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ versions: vi.fn(), lire: vi.fn() }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ identity: { photosDesProfils: api.versions } }),
}));
vi.mock("@/lib/photo-de-profil", () => ({ lirePhoto: api.lire }));

import { usePhotosDeProfil } from "../use-photos-de-profil";

const AMEL = "00000000-0000-4000-8000-000000000001";
const BILEL = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  api.versions.mockReset();
  api.lire.mockReset();
  URL.createObjectURL = vi.fn((b: Blob) => `blob:test/${b.size}`);
  URL.revokeObjectURL = vi.fn();
});

function monter(ids: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const enveloppe = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => usePhotosDeProfil(ids), { wrapper: enveloppe }) };
}

describe("les photos de profil des sièges", () => {
  it("ne lit que la photo de qui en a une", async () => {
    api.versions.mockResolvedValue({ [AMEL]: "v1" });
    api.lire.mockResolvedValue(new Blob(["abc"]));
    const { result } = monter([AMEL, BILEL]);
    await waitFor(() => expect(result.current[AMEL]).toBe("blob:test/3"));
    expect(result.current[BILEL]).toBeUndefined();
    expect(api.lire).toHaveBeenCalledTimes(1);
    expect(api.lire).toHaveBeenCalledWith(AMEL);
  });

  it("sans personne, ne demande rien", () => {
    const { result } = monter([]);
    expect(result.current).toEqual({});
    expect(api.versions).not.toHaveBeenCalled();
  });

  it("une photo que le serveur ne rend plus (null) n'a pas de pastille", async () => {
    api.versions.mockResolvedValue({ [AMEL]: "v1" });
    api.lire.mockResolvedValue(null);
    const { result } = monter([AMEL]);
    await waitFor(() => expect(api.lire).toHaveBeenCalled());
    expect(result.current[AMEL]).toBeUndefined();
  });
});
