/**
 * Ce que la route de la miniature répond, et ce que l'écran en comprend.
 *
 * Relu par Codex sur la PR #128 : un échec PASSAGER de fabrication rendait le
 * même 204 qu'un document sans miniature, et l'aperçu gardait la feuille
 * esquissée pour toujours. Trois sens, trois réponses distinctes :
 *
 *   200  la miniature ;
 *   204  ce document n'en a pas, par nature — `null`, et l'écran le garde ;
 *   404  pas d'octets (encore) — une erreur, que l'aperçu réessaie ;
 *   5xx  la fabrication a échoué un instant — une erreur, réessayée aussi.
 */
import { describe, expect, it, vi } from "vitest";

const reseau = vi.hoisted(() => ({ statut: 200 }));
vi.mock("@/lib/transport", () => ({
  transport: () => ({
    appeler: async () =>
      new Response(reseau.statut === 200 ? new Blob(["jpeg"], { type: "image/jpeg" }) : null, {
        status: reseau.statut,
      }),
  }),
}));

import { ErreurApi } from "@/lib/transport/erreurs";
import { creerCaptureHttp } from "../capture";

describe("la miniature, vue par l'adaptateur", () => {
  const capture = creerCaptureHttp();

  it("200 : la miniature", async () => {
    reseau.statut = 200;
    expect(await capture.miniature("p")).toBeInstanceOf(Blob);
  });

  it("204 : pas de miniature, par nature — null, définitif", async () => {
    reseau.statut = 204;
    expect(await capture.miniature("p")).toBeNull();
  });

  it("404 et 503 : des erreurs, jamais un null qui se garderait", async () => {
    for (const statut of [404, 503]) {
      reseau.statut = statut;
      const erreur = await capture.miniature("p").catch((e: unknown) => e);
      expect(erreur).toBeInstanceOf(ErreurApi);
      expect((erreur as ErreurApi).statut).toBe(statut);
    }
  });
});
