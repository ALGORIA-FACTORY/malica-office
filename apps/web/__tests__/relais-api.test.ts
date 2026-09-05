/**
 * Ce que le relais transmet à l'API.
 *
 * Ces épreuves viennent d'un défaut trouvé sur un vrai téléphone, pas d'une
 * intuition : la page servie en HTTPS parlait HTTP/2, dont les en-têtes de
 * contrôle commencent par deux-points. Passés à une requête HTTP/1.1, Node les
 * refuse et toute l'application tombe.
 *
 * Mes essais en curl parlaient HTTP/1.1 et ne pouvaient donc pas le voir.
 */
import { describe, expect, it } from "vitest";

import { entetesRelayees, estPourLApi, sansEntetesDeConnexion } from "../relais-api";

const HOTE = "localhost:3000";

describe("qui relaie quoi", () => {
  it("laisse /auth a l application : c est l ecran de connexion", () => {
    // Relaye, il repartait avec « Cannot GET /auth » et l application devenait
    // inaccessible depuis le telephone.
    expect(estPourLApi("/auth")).toBe(false);
  });

  it("relaie les sous-chemins de /auth, qui sont ceux de l API", () => {
    expect(estPourLApi("/auth/connexion")).toBe(true);
    expect(estPourLApi("/auth/session")).toBe(true);
    expect(estPourLApi("/auth/deconnexion")).toBe(true);
  });

  it("relaie les routes qui n ont pas d equivalent dans l application", () => {
    expect(estPourLApi("/rpc")).toBe(true);
    expect(estPourLApi("/moi")).toBe(true);
    expect(estPourLApi("/pieces")).toBe(true);
    expect(estPourLApi("/pieces/abc/contenu")).toBe(true);
    // Le journal d'atelier. Sans ce relais, la pile d'appels d'une erreur reste
    // sur l'appareil qui l'a produite, et le défaut se corrige à l'aveugle —
    // ce qui a coûté trois corrections inutiles.
    expect(estPourLApi("/journal-atelier")).toBe(true);
    // Regalica : la lecture, la réponse, la rédaction — sur leurs propres routes.
    expect(estPourLApi("/regalica/lectures/abc")).toBe(true);
    expect(estPourLApi("/regalica/demander")).toBe(true);
  });

  it("ne relaie aucune page de l application", () => {
    for (const p of ["/", "/pme", "/pme/fiche", "/office", "/cabinet", "/onboarding"]) {
      expect(estPourLApi(p), p).toBe(false);
    }
  });

  it("ne se laisse pas piéger par un préfixe qui ressemble", () => {
    expect(estPourLApi("/moidechose")).toBe(false);
    expect(estPourLApi("/rpcextra")).toBe(false);
    expect(estPourLApi("/authentification")).toBe(false);
  });

  it("ignore la chaîne de requête", () => {
    expect(estPourLApi("/auth/session?x=1")).toBe(true);
    expect(estPourLApi("/pme?x=1")).toBe(false);
  });
});

describe("les pseudo-en-têtes de HTTP/2", () => {
  it("ne franchissent jamais le relais", () => {
    const propres = entetesRelayees(
      {
        ":method": "POST",
        ":path": "/rpc",
        ":authority": "192.168.1.192:8080",
        ":scheme": "https",
        "content-type": "application/json",
      },
      HOTE,
    );
    expect(Object.keys(propres).some((n) => n.startsWith(":"))).toBe(false);
    expect(propres["content-type"]).toBe("application/json");
  });
});

describe("ce qui décrit la connexion reste à la porte", () => {
  it("retire les en-têtes saut-à-saut", () => {
    const propres = entetesRelayees(
      {
        connection: "keep-alive",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        upgrade: "websocket",
        te: "trailers",
        "proxy-authorization": "Basic xxx",
        accept: "application/json",
      },
      HOTE,
    );
    for (const n of [
      "connection",
      "keep-alive",
      "transfer-encoding",
      "upgrade",
      "te",
      "proxy-authorization",
    ]) {
      expect(propres[n], n).toBeUndefined();
    }
    expect(propres["accept"]).toBe("application/json");
  });

  it("réécrit l'hôte vers l'API", () => {
    const propres = entetesRelayees({ host: "192.168.1.192:8080" }, HOTE);
    expect(propres["host"]).toBe(HOTE);
  });
});

describe("le retour de l API", () => {
  it("retire ce que HTTP/2 interdit dans une reponse", () => {
    // Sans cela : « HTTP/1 Connection specific headers are forbidden », et le
    // serveur s arrete au premier appel relaye.
    const propres = sansEntetesDeConnexion({
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "content-type": "application/json",
      "set-cookie": ["regalica_session=abc; Path=/"],
    });
    expect(propres["connection"]).toBeUndefined();
    expect(propres["keep-alive"]).toBeUndefined();
    expect(propres["content-type"]).toBe("application/json");
  });

  it("laisse passer le cookie que l API pose", () => {
    const propres = sansEntetesDeConnexion({ "set-cookie": ["regalica_session=abc; Path=/"] });
    expect(propres["set-cookie"]).toEqual(["regalica_session=abc; Path=/"]);
  });

  it("laisse passer un statut numerique tel quel", () => {
    const propres = sansEntetesDeConnexion({ "content-length": 42 });
    expect(propres["content-length"]).toBe(42);
  });
});

describe("ce qui DOIT passer", () => {
  it("laisse le cookie de session, qui porte l'identité", () => {
    const propres = entetesRelayees({ cookie: "regalica_session=abc" }, HOTE);
    expect(propres["cookie"]).toBe("regalica_session=abc");
  });

  it("laisse l'autorisation et le type de contenu", () => {
    const propres = entetesRelayees(
      { authorization: "Bearer jeton", "content-type": "application/json" },
      HOTE,
    );
    expect(propres["authorization"]).toBe("Bearer jeton");
    expect(propres["content-type"]).toBe("application/json");
  });

  it("laisse un en-tête répété tel quel", () => {
    const propres = entetesRelayees({ "accept-encoding": ["gzip", "br"] }, HOTE);
    expect(propres["accept-encoding"]).toEqual(["gzip", "br"]);
  });

  it("écarte une valeur absente plutôt que d'envoyer undefined", () => {
    const propres = entetesRelayees({ "x-vide": undefined, accept: "*/*" }, HOTE);
    expect("x-vide" in propres).toBe(false);
    expect(propres["accept"]).toBe("*/*");
  });
});
