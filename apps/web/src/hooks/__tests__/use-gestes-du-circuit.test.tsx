// @vitest-environment jsdom
/**
 * La porte des gestes du circuit (`use-gestes-du-circuit.ts`) ne rend un geste
 * que si le Socle l'offre, et ses lots ne font partir que ce qu'il permet.
 *
 * Le défaut qui l'a fait naître (revue Codex de #146) : l'onglet Suivi offrait
 * « Transmettre » au propriétaire sur la pièce qu'il venait de retourner au
 * siège — `vis` valait encore `entite` — et la base refusait
 * (`refus.envoi.chez_le_siege`). Le Suivi lit désormais `useEnvoyer`, qui rend
 * `null` ici.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CircuitInterne } from "@malica/socle/statut-d-envoi";

const base = vi.hoisted(() => ({ droits: [] as string[], cabinet: true }));
const api = vi.hoisted(() => ({
  envoyer: vi.fn(),
  transmettreLesPieces: vi.fn(),
  garderPiece: vi.fn(),
  demanderSurPiece: vi.fn(),
  supprimer: vi.fn(),
}));

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    collab: {
      envoyer: api.envoyer,
      transmettreLesPieces: api.transmettreLesPieces,
      garderPiece: api.garderPiece,
      demanderSurPiece: api.demanderSurPiece,
    },
    capture: { supprimer: api.supprimer },
    identity: {
      monCabinet: async () =>
        base.cabinet ? { id: "cab", name: "CABINET ESSAI", tientLesLivres: true } : null,
    },
    acces: { monAcces: async () => ({ role: "x", plateforme: false, droits: base.droits }) },
  }),
}));

import {
  useDemander,
  useEnvoyer,
  useEnvoyerEnLot,
  useGarder,
  useGestesDuCircuit,
  useMettreDeCote,
  useSupprimer,
  type PieceDuCircuitWeb,
} from "@/hooks/use-gestes-du-circuit";

const PROPRIETAIRE = [
  "societe.tout_voir",
  "envoi.cabinet",
  "piece.garder",
  "circuit.recevoir",
  "piece.supprimer_toutes",
];
const SIEGE = ["envoi.proprietaire"];

const circuit = (c: Partial<CircuitInterne>): CircuitInterne => ({
  recoit: true,
  dernier: null,
  envoyeeLe: null,
  vueLe: null,
  vuePar: null,
  retourneeLe: null,
  retourPar: null,
  corrigeeLe: null,
  auteur: "Sami",
  mienne: false,
  ...c,
});

const piece = (p: Partial<PieceDuCircuitWeb> = {}): PieceDuCircuitWeb => ({
  id: "p1",
  vis: "entite",
  status: "lue",
  gardeeLe: null,
  suivi: null,
  circuit: circuit({}),
  ...p,
});

/** Retournée au siège par le propriétaire : `entite`, la main est au siège. */
const retourneeAuSiege = piece({
  circuit: circuit({
    dernier: "retournee",
    retourneeLe: "2026-10-31T09:00:00Z",
    retourPar: "Amel",
  }),
});

function avec<T>(hook: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(hook, { wrapper });
}

/** Les droits sont lus : le circuit répond (`null` tant qu'ils ne le sont pas). */
async function pret<T>(hook: () => T) {
  const r = avec(() => ({ gestes: useGestesDuCircuit("dossier", piece()), valeur: hook() }));
  await waitFor(() => expect(r.result.current.gestes).not.toBeNull());
  return r;
}

beforeEach(() => {
  base.droits = PROPRIETAIRE;
  base.cabinet = true;
  for (const f of Object.values(api)) f.mockReset();
  api.envoyer.mockResolvedValue({ le: "2026-10-31T10:00:00Z", chez: "cabinet", deja: false });
  api.transmettreLesPieces.mockResolvedValue({ transmises: 1 });
  api.garderPiece.mockResolvedValue({ changed: true });
  api.supprimer.mockResolvedValue(true);
});
afterEach(cleanup);

describe("« Envoyer » ne se rend que si le circuit l'offre", () => {
  it("pas sur la pièce que le propriétaire vient de retourner au siège — ni « Garder »", async () => {
    const r = await pret(() => ({
      envoyer: useEnvoyer("dossier", retourneeAuSiege),
      garder: useGarder("dossier", retourneeAuSiege),
    }));
    expect(r.result.current.valeur.envoyer).toBeNull();
    expect(r.result.current.valeur.garder).toBeNull();
  });

  it("la pièce reçue d'un siège part au comptable, par la porte de l'envoi", async () => {
    const recue = piece({ circuit: circuit({ dernier: "envoyee" }) });
    const r = await pret(() => useEnvoyer("dossier", recue));
    expect(r.result.current.valeur?.vers).toBe("cabinet");
    r.result.current.valeur!.mutate();
    await waitFor(() => expect(api.envoyer).toHaveBeenCalledWith("p1"));
  });

  it("gardée : « Transmettre quand même » reste offert, mais le lot ne la fait pas partir", async () => {
    const gardee = piece({ gardeeLe: "2026-10-30T09:00:00Z", circuit: circuit({ mienne: true }) });
    const r = await pret(() => ({
      une: useEnvoyer("dossier", gardee),
      lot: useEnvoyerEnLot("dossier"),
    }));
    expect(r.result.current.valeur.une?.vers).toBe("cabinet");
    expect(r.result.current.valeur.lot.reste(gardee)).toBe(false);
    r.result.current.valeur.lot.mutate([gardee, retourneeAuSiege]);
    await waitFor(() => expect(r.result.current.valeur.lot.isSuccess).toBe(true));
    expect(api.transmettreLesPieces).not.toHaveBeenCalled();
  });
});

describe("les autres gestes", () => {
  it("le siège qui met un lot de côté à la capture n'écrit rien : « Garder » n'est pas à lui", async () => {
    base.droits = SIEGE;
    const neuve = piece({
      vis: "personnel",
      status: "capturee",
      circuit: circuit({ mienne: true, recoit: false }),
    });
    const r = await pret(() => useMettreDeCote("dossier"));
    r.result.current.valeur.mutate([neuve]);
    await waitFor(() => expect(r.result.current.valeur.isSuccess).toBe(true));
    expect(api.garderPiece).not.toHaveBeenCalled();
  });

  it("le propriétaire, lui, la met de côté, même sans cabinet", async () => {
    base.cabinet = false;
    const neuve = piece({
      vis: "personnel",
      status: "capturee",
      circuit: circuit({ mienne: true }),
    });
    const r = await pret(() => useMettreDeCote("dossier"));
    r.result.current.valeur.mutate([neuve]);
    await waitFor(() => expect(api.garderPiece).toHaveBeenCalledWith("p1"));
  });

  it("supprimer : pas une pièce partie ; oui une pièce rendue par le comptable", async () => {
    const partie = piece({ vis: "partage", status: "lue" });
    const rendue = piece({ vis: "partage", status: "retournee" });
    const r = await pret(() => ({
      partie: useSupprimer("dossier", partie),
      rendue: useSupprimer("dossier", rendue),
    }));
    expect(r.result.current.valeur.partie).toBeNull();
    expect(r.result.current.valeur.rendue).not.toBeNull();
  });

  it("rappeler : pas une pièce prise en charge ; la suppression, elle, se demande encore", async () => {
    const prise = piece({
      vis: "partage",
      status: "lue",
      suivi: {
        envoyeeLe: "2026-10-30T09:00:00Z",
        vueLe: null,
        vuePar: null,
        corrigeeLe: null,
        priseLe: "2026-10-30T10:00:00Z",
        prise: "validee",
        prisePar: null,
      },
    });
    const r = await pret(() => ({
      rappel: useDemander("dossier", prise, "rappel"),
      suppression: useDemander("dossier", prise, "suppression"),
    }));
    expect(r.result.current.valeur.rappel).toBeNull();
    expect(r.result.current.valeur.suppression?.a).toBe("cabinet");
  });
});
