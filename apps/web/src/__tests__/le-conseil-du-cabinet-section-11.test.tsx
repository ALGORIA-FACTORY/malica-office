// @vitest-environment jsdom
/**
 * L'écran du conseil du cabinet (`cabinet.conseil.tsx`), tel qu'il est le
 * 9 novembre 2026 — section 11 du dirigeant, figée avant la reconstruction.
 *
 *   2, 8. la file d'arbitrage se rend : le client, la question, la réponse
 *         proposée, la certitude, les sources nommées, le doute — et les
 *         statistiques en tête ; le pouce part par `conseil.decider`, avec le
 *         message composé pour le client.
 *
 * Rendu dans les trois langues : les libellés viennent des vrais
 * dictionnaires, les données de la file restent celles du client.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ar } from "@malica/socle/messages-ar";
import { en } from "@malica/socle/messages-en";
import { fr } from "@malica/socle/messages-fr";
import { messagePourLeClient, nomDeLaSource } from "@malica/socle/conseil";
import type { Arbitrage } from "@malica/socle/ports/repositories";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options }),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet-1", name: "COMPTA", jurisdiction: "TN" } }),
  useMalicaPanel: () => undefined,
}));

const ARBITRAGE: Arbitrage = {
  id: "arb-1",
  tenantId: "pme-1",
  client: "ATLAS DISTRIBUTION",
  cabinetTenantId: "cabinet-1",
  conversationId: "fil-1",
  messageId: "msg-1",
  demandeur: "dirigeant@atlas.tn",
  question: "Puis-je déduire la TVA de ma voiture ?",
  reponseProposee: "Dans votre cas, la TVA sur ce véhicule ne se déduit pas.",
  sources: [{ corpus: "CTVA", numero: "10", validFrom: "2026-01-01", validTo: null, langue: "fr" }],
  certitude: 0.87,
  doute: "Le véhicule est-il utilitaire ?",
  canal: "conversation",
  theme: "Déduction de TVA sur véhicule",
  langue: "fr",
  statut: "en_attente",
  reponseCabinet: null,
  articleCabinet: null,
  decideLe: null,
  createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
};
const NOMS = { CTVA: "Code de la TVA" };
const decider = vi.fn<(...a: unknown[]) => Promise<Arbitrage>>();

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    referential: { activePack: async () => ({ version: "TN-2026.1" }) },
    conseil: {
      file: async () => [ARBITRAGE],
      statistiques: async () => ({
        totaux: {
          enAttente: 1,
          repondues: 2,
          approuvees: 3,
          corrigees: 1,
          ecartees: 0,
          plusAncienneEnAttente: ARBITRAGE.createdAt,
        },
        parClient: [],
        sujets: [],
      }),
      nomsDesCorpus: async () => NOMS,
      decider: (...a: unknown[]) => decider(...a),
      veille: async () => [],
    },
    parametrage: { reglagesCabinet: async () => ({ seuilCertitudeConseil: 0.8 }) },
  }),
}));

import { chargerLesEspaces } from "@/i18n/dictionnaires";
import { I18nProvider } from "@/i18n";

import { Route } from "../routes/_authenticated/cabinet.conseil";

const Ecran = (Route as unknown as { options: { component: ComponentType } }).options.component;
const DICTIONNAIRES = { fr, en, ar } as const;
type Langue = keyof typeof DICTIONNAIRES;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  decider.mockReset();
});

async function ouvrir(langue: Langue) {
  window.localStorage.setItem("malica.locale", langue);
  await chargerLesEspaces(langue);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <Ecran />
      </I18nProvider>
    </QueryClientProvider>,
  );
  const d = DICTIONNAIRES[langue];
  await screen.findByText(d["cab.conseil.file.titre"]);
  return d;
}

describe("l'écran du conseil rend la file d'arbitrage", () => {
  for (const langue of ["fr", "en", "ar"] as const) {
    it(`${langue} — la file, ses statistiques et chaque élément de l'arbitrage`, async () => {
      const d = await ouvrir(langue);
      // Les statistiques, en tête : en attente, pouce, corrigées, justesse 3/(3+1).
      expect(screen.getByText(d["cab.conseil.kpi.attente"])).toBeTruthy();
      const valeurs = [...document.querySelectorAll("p.num")].map((p) => p.textContent);
      expect(valeurs.slice(0, 4)).toEqual(["1", "3", "1", "75 %"]);

      // L'arbitrage tel que la file le porte.
      expect(screen.getByText("ATLAS DISTRIBUTION")).toBeTruthy();
      expect(screen.getByText("dirigeant@atlas.tn")).toBeTruthy();
      expect(screen.getByText(`« ${ARBITRAGE.question} »`)).toBeTruthy();
      expect(screen.getByText(ARBITRAGE.reponseProposee)).toBeTruthy();
      expect(screen.getByText(d["cab.conseil.reponse.proposee"])).toBeTruthy();
      expect(screen.getByText(d["cab.conseil.certitude"].replace("{pct}", "87"))).toBeTruthy();
      await screen.findByText(nomDeLaSource(ARBITRAGE.sources[0]!, NOMS, langue));
      expect(screen.getByText(ARBITRAGE.doute!)).toBeTruthy();
      expect(screen.getByText(d["cab.conseil.canal.conversation"])).toBeTruthy();
    });
  }

  it("le pouce part par conseil.decider, avec le message composé pour le client", async () => {
    decider.mockResolvedValue({ ...ARBITRAGE, statut: "approuvee" });
    const d = await ouvrir("fr");
    await screen.findByText(nomDeLaSource(ARBITRAGE.sources[0]!, NOMS, "fr"));
    fireEvent.click(screen.getByText(d["cab.conseil.approuver"]));
    await waitFor(() => expect(decider).toHaveBeenCalledTimes(1));
    expect(decider.mock.calls[0]).toEqual([
      "arb-1",
      "approuvee",
      null,
      null,
      messagePourLeClient(ARBITRAGE, "approuvee", null, null, NOMS),
    ]);
  });
});
