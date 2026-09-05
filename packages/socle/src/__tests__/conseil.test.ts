/**
 * Ce que le client lit quand le cabinet a décidé — dans SA langue.
 */
import { describe, expect, it } from "vitest";

import { MESSAGES } from "../messages.ts";
import type { Arbitrage } from "../ports/repositories.ts";

import { certitudeEnPourcent, messagePourLeClient, texte } from "../conseil.ts";

const arbitrage = (surcharge: Partial<Arbitrage> = {}): Arbitrage => ({
  id: "a",
  tenantId: "t",
  client: "SOTUMAG",
  cabinetTenantId: "c",
  conversationId: "v",
  messageId: null,
  demandeur: null,
  question: "On récupère la TVA ?",
  reponseProposee: "Non, rien à déduire.",
  sources: [{ corpus: "CTVA", numero: "9", validFrom: "2024-01-01", validTo: null, langue: "fr" }],
  certitude: 0.62,
  doute: null,
  canal: "conversation",
  theme: null,
  langue: "fr",
  statut: "en_attente",
  reponseCabinet: null,
  articleCabinet: null,
  decideLe: null,
  createdAt: "2026-09-04T10:00:00Z",
  ...surcharge,
});

describe("messagePourLeClient", () => {
  it("un pouce levé envoie la réponse, ses sources nommées, et la mention de relecture", () => {
    const m = messagePourLeClient(arbitrage(), "approuvee", null, null, {
      CTVA: "code de la TVA",
    });
    expect(m).toContain("Non, rien à déduire.");
    expect(m).toContain("code de la TVA art. 9");
    expect(m).toContain(MESSAGES.fr["pme.conseil.relu"]);
  });

  it("une réponse déjà envoyée qu'on approuve après coup ne repart pas", () => {
    expect(
      messagePourLeClient(arbitrage({ statut: "repondue" }), "approuvee", null, null, {}),
    ).toBe(null);
  });

  it("une correction parle dans la langue du client, pas dans celle du cabinet", () => {
    const m = messagePourLeClient(
      arbitrage({ langue: "en" }),
      "corrigee",
      "Yes, provided the seller is registered.",
      "VAT code art. 9",
      {},
    );
    expect(m).toContain(MESSAGES.en["pme.conseil.duCabinet"]);
    expect(m).toContain("Yes, provided the seller is registered.");
    expect(m).toContain(texte("en", "pme.conseil.articleInvoque", { article: "VAT code art. 9" }));
  });

  it("corriger une réponse déjà envoyée le dit au client", () => {
    const m = messagePourLeClient(arbitrage({ statut: "repondue" }), "corrigee", "Si.", null, {});
    expect(m).toContain(MESSAGES.fr["pme.conseil.correction"]);
  });

  it("une correction vide ne part pas", () => {
    expect(messagePourLeClient(arbitrage(), "corrigee", "  ", null, {})).toBeNull();
  });

  it("écarter dit au client de voir son comptable, en arabe s'il a écrit en arabe", () => {
    expect(messagePourLeClient(arbitrage({ langue: "ar" }), "ecartee", null, null, {})).toBe(
      MESSAGES.ar["pme.conseil.ecartee"],
    );
  });
});

describe("texte", () => {
  it("choisit la forme plurielle comme t()", () => {
    expect(texte("fr", "cab.conseil.stats.questions", { count: 1 })).toBe("1 question");
    expect(texte("fr", "cab.conseil.stats.questions", { count: 3 })).toBe("3 questions");
  });

  it("retombe sur le français pour une langue inconnue", () => {
    expect(texte("xx", "pme.conseil.relu")).toBe(MESSAGES.fr["pme.conseil.relu"]);
  });
});

describe("certitudeEnPourcent", () => {
  it("arrondit et borne", () => {
    expect(certitudeEnPourcent(0.625)).toBe(63);
    expect(certitudeEnPourcent(1.4)).toBe(100);
    expect(certitudeEnPourcent(-1)).toBe(0);
  });
});
