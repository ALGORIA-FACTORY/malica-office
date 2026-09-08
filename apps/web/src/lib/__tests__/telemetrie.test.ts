/**
 * Ce qui ne part jamais vers Sentry : un corps, un en-tête, un cookie, un
 * message de console, un utilisateur. La promesse est tenue par le code.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import { describe, expect, it } from "vitest";

import { demarrerLaTelemetrie, preparerEvenement, preparerFilDAriane } from "../telemetrie";

describe("un fil d'Ariane, avant de partir", () => {
  it("réduit un appel réseau à l'adresse, la méthode et le statut", () => {
    const fil: Breadcrumb = {
      category: "fetch",
      data: {
        url: "/rpc",
        method: "POST",
        status_code: 200,
        request_body_size: 1200,
        response_body_size: 300,
        body: '{"montant":"1200"}',
      },
    };
    expect(preparerFilDAriane(fil)).toEqual({
      category: "fetch",
      data: { url: "/rpc", method: "POST", status_code: 200 },
    });
  });

  it("ne laisse passer aucun message de console", () => {
    expect(preparerFilDAriane({ category: "console", message: "montant 1200" })).toBeNull();
  });

  it("laisse une navigation ou un clic tels quels", () => {
    const fil: Breadcrumb = { category: "navigation", data: { from: "/pme", to: "/pme/list" } };
    expect(preparerFilDAriane(fil)).toBe(fil);
  });
});

describe("un événement, avant de partir", () => {
  it("garde l'adresse de la requête et rien d'autre", () => {
    const evenement = {
      type: undefined,
      request: {
        url: "https://pilote.malica.tn/pme",
        headers: { Authorization: "Bearer x", Cookie: "session=y" },
        cookies: { session: "y" },
        data: { pieces: ["…"] },
        query_string: "a=1",
      },
      user: { ip_address: "1.2.3.4", id: "u" },
      breadcrumbs: [
        { category: "console", message: "secret" },
        { category: "fetch", data: { url: "/rpc", method: "POST", status_code: 500, body: "x" } },
      ],
    } as unknown as ErrorEvent;

    const prepare = preparerEvenement(evenement);

    expect(prepare.request).toEqual({ url: "https://pilote.malica.tn/pme" });
    expect(prepare.user).toBeUndefined();
    expect(prepare.breadcrumbs).toEqual([
      { category: "fetch", data: { url: "/rpc", method: "POST", status_code: 500 } },
    ]);
  });

  it("ne touche pas à un événement sans requête ni fils", () => {
    const evenement = { type: undefined, message: "x" } as unknown as ErrorEvent;
    expect(preparerEvenement(evenement)).toEqual({ type: undefined, message: "x" });
  });
});

describe("le démarrage", () => {
  it("ne démarre pas hors de la coque", async () => {
    expect(await demarrerLaTelemetrie()).toBe(false);
  });
});
