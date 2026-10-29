/**
 * Un mot, une couleur, le même des deux côtés (« Malica sans blocage », §2).
 *
 * La PME ne lit jamais « Comptée » ni « À vérifier » : elle lit où la pièce
 * en est chez le cabinet. Le cabinet lit ce qu'il a à faire.
 */
import { describe, expect, it } from "vitest";

import {
  A_TRAITER,
  statutCabinet,
  statutPme,
  TON_CABINET,
  TON_PME,
  type SuiviDEnvoi,
} from "../statut-d-envoi.ts";

const envoi = "2026-10-29T08:00:00.000Z";
const suivi = (s: Partial<SuiviDEnvoi> = {}): SuiviDEnvoi => ({
  envoyeeLe: envoi,
  vueLe: null,
  vuePar: null,
  corrigeeLe: null,
  priseLe: null,
  prise: null,
  prisePar: null,
  ...s,
});

describe("le statut côté PME", () => {
  it("avant l'envoi : Mon espace, À envoyer, Gardée", () => {
    expect(statutPme({ vis: "personnel", status: "lue", suivi: null })).toBe("mon_espace");
    expect(statutPme({ vis: "entite", status: "lue", suivi: null })).toBe("a_envoyer");
    expect(statutPme({ vis: "entite", status: "lue", gardeeLe: envoi, suivi: null })).toBe(
      "gardee",
    );
  });

  it("envoyée, puis vue par le cabinet", () => {
    expect(statutPme({ vis: "partage", status: "lue", suivi: suivi() })).toBe("envoyee");
    const vue = suivi({ vueLe: "2026-10-29T09:00:00.000Z", vuePar: "CABINET D'ESSAI" });
    expect(statutPme({ vis: "partage", status: "lue", suivi: vue })).toBe("vue");
  });

  it("renvoyée après un retour, la vue d'avant ne compte plus", () => {
    const s = suivi({ envoyeeLe: "2026-10-29T10:00:00.000Z", vueLe: "2026-10-29T09:00:00.000Z" });
    expect(statutPme({ vis: "partage", status: "lue", suivi: s })).toBe("envoyee");
  });

  it("retour, puis prise en charge — validée ou forcée, la PME lit le même mot", () => {
    expect(statutPme({ vis: "partage", status: "retournee", suivi: suivi() })).toBe("retour");
    for (const prise of ["validee", "forcee"] as const)
      expect(
        statutPme({ vis: "partage", status: "supervisee", suivi: suivi({ prise, priseLe: envoi }) }),
      ).toBe("prise_en_charge");
  });

  it("une écriture inscrite par le client n'est pas une prise en charge", () => {
    expect(statutPme({ vis: "partage", status: "comptabilisee", suivi: suivi() })).toBe("envoyee");
  });
});

describe("le statut côté cabinet", () => {
  it("reçue, puis vue à l'ouverture", () => {
    expect(statutCabinet({ status: "lue", suivi: suivi() })).toBe("recue");
    const vue = suivi({ vueLe: "2026-10-29T09:00:00.000Z" });
    expect(statutCabinet({ status: "lue", suivi: vue })).toBe("vue");
  });

  it("corrigée par le client après l'envoi, puis revue", () => {
    const corrigee = suivi({
      vueLe: "2026-10-29T09:00:00.000Z",
      corrigeeLe: "2026-10-29T09:30:00.000Z",
    });
    expect(statutCabinet({ status: "lue", suivi: corrigee })).toBe("corrigee");
    const revue = { ...corrigee, vueLe: "2026-10-29T10:00:00.000Z" };
    expect(statutCabinet({ status: "lue", suivi: revue })).toBe("vue");
    expect(statutCabinet({ status: "lue", suivi: suivi({ corrigeeLe: envoi }) })).toBe(
      "corrigee",
    );
  });

  it("renvoyée sans rien changer : reçue, pas corrigée", () => {
    const s = suivi({
      corrigeeLe: "2026-10-29T08:30:00.000Z",
      vueLe: "2026-10-29T09:00:00.000Z",
      envoyeeLe: "2026-10-29T11:00:00.000Z",
    });
    expect(statutCabinet({ status: "lue", suivi: s })).toBe("recue");
  });

  it("retournée, validée, forcée", () => {
    expect(statutCabinet({ status: "retournee", suivi: suivi() })).toBe("retournee");
    expect(statutCabinet({ status: "supervisee", suivi: suivi({ prise: "validee" }) })).toBe(
      "validee",
    );
    expect(statutCabinet({ status: "supervisee", suivi: suivi({ prise: "forcee" }) })).toBe(
      "forcee",
    );
  });
});

describe("une couleur par statut", () => {
  it("ambre à vous, bleu chez l'autre, vert pris en charge, gris rien à faire", () => {
    expect(TON_PME.retour).toBe("am");
    expect(TON_PME.envoyee).toBe("az");
    expect(TON_PME.vue).toBe("az");
    expect(TON_PME.prise_en_charge).toBe("ok");
    expect(TON_PME.gardee).toBe("neutre");
    expect(TON_CABINET.recue).toBe("am");
    expect(TON_CABINET.retournee).toBe("az");
    expect(TON_CABINET.forcee).toBe("ok");
  });

  it("à traiter : ce qui est ambre chez le cabinet, et seulement cela", () => {
    for (const [statut, ton] of Object.entries(TON_CABINET))
      expect(A_TRAITER.has(statut as keyof typeof TON_CABINET)).toBe(ton === "am");
  });
});
