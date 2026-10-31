import type { Droit, EtatDeDemande } from "../ports/repositories.ts";
import { statutDuCircuit, type CircuitInterne } from "../statut-d-envoi.ts";
import { describe, expect, it } from "vitest";

import {
  carteDuRecu,
  demandeDuSiegeATrancher,
  etatDeMaDemande,
  gestesDuCircuit,
  type PieceDuCircuit,
} from "../circuit.ts";

/** Les droits du référentiel, tels que `acces.monAcces` les rend (lot 4). */
const SIEGE: Droit[] = ["envoi.proprietaire"];
const PROPRIETAIRE: Droit[] = [
  "societe.tout_voir",
  "envoi.cabinet",
  "piece.garder",
  "circuit.recevoir",
  "piece.supprimer_toutes",
];

const circuit = (c: Partial<CircuitInterne>): CircuitInterne => ({
  recoit: false,
  dernier: null,
  envoyeeLe: null,
  vueLe: null,
  vuePar: null,
  retourneeLe: null,
  retourPar: null,
  corrigeeLe: null,
  auteur: "Sami",
  mienne: true,
  ...c,
});

const piece = (
  p: Partial<Omit<PieceDuCircuit, "statut">> & { status?: string } = {},
): PieceDuCircuit => {
  const base = {
    vis: p.vis ?? "entite",
    status: p.status ?? "lue",
    gardeeLe: p.gardeeLe ?? null,
    circuit: p.circuit ?? null,
  } as const;
  return { ...base, statut: statutDuCircuit({ ...base, suivi: null }) };
};

/** L'état d'une demande à une étape, tel que `collab.etatDesDemandes` le rend. */
const fait = (f: Partial<EtatDeDemande>): EtatDeDemande => ({
  objet: "rappel",
  fait: "demandee",
  note: null,
  createdAt: "2026-10-30T10:00:00.000Z",
  etape: "proprietaire",
  transmise: false,
  ...f,
});

describe("le geste « Envoyer », un seul, deux passages", () => {
  it("le siège envoie au propriétaire ; jamais au comptable, jamais « Garder »", () => {
    const g = gestesDuCircuit(piece({ circuit: circuit({}) }), SIEGE, true);
    expect(g.envoyer).toBe("proprietaire");
    expect(g.garder).toBe(false);
  });

  it("partie chez le propriétaire, le siège ne la renvoie pas : il peut la demander", () => {
    const g = gestesDuCircuit(
      piece({ circuit: circuit({ dernier: "envoyee", envoyeeLe: "2026-10-30T09:00:00Z" }) }),
      SIEGE,
      true,
    );
    expect(g.envoyer).toBeNull();
    expect(g.demanderA).toBe("proprietaire");
    expect(g.mettreAuPrive).toBe(false);
    expect(g.supprimer).toBe(false);
  });

  it("le propriétaire envoie au comptable, et garde ; sans cabinet, ni l'un ni l'autre", () => {
    const sienne = piece({ circuit: circuit({ recoit: true }) });
    expect(gestesDuCircuit(sienne, PROPRIETAIRE, true)).toMatchObject({
      envoyer: "cabinet",
      garder: true,
      mettreAuPrive: true,
    });
    expect(gestesDuCircuit(sienne, PROPRIETAIRE, false)).toMatchObject({
      envoyer: null,
      garder: false,
    });
  });
});

describe("le propriétaire reçoit", () => {
  const recue = piece({
    circuit: circuit({
      recoit: true,
      mienne: false,
      dernier: "envoyee",
      envoyeeLe: "2026-10-30T09:00:00Z",
    }),
  });

  it("la pièce d'un siège : Reçue, vue à l'ouverture, à retourner ou envoyer", () => {
    expect(recue.statut.statut).toBe("recue");
    expect(gestesDuCircuit(recue, PROPRIETAIRE, true)).toMatchObject({
      voirALOuverture: true,
      retournerAuSiege: true,
      envoyer: "cabinet",
      // La pièce d'un siège ne part jamais dans l'espace privé d'un autre.
      mettreAuPrive: false,
      supprimer: true,
    });
  });

  /*
   * Revue Codex de #146 : sans cabinet engagé, ou après « Garder », le seul
   * bouton qui ouvrait le retour était caché avec l'envoi au comptable.
   */
  it("sans cabinet engagé, le propriétaire peut toujours la retourner au siège", () => {
    expect(carteDuRecu(gestesDuCircuit(recue, PROPRIETAIRE, false), recue.gardeeLe)).toEqual({
      envoyerAuComptable: false,
      retourner: true,
    });
  });

  it("gardée par le propriétaire, elle se retourne encore au siège", () => {
    const gardee = piece({
      gardeeLe: "2026-10-30T10:00:00Z",
      circuit: circuit({ recoit: true, mienne: false, dernier: "envoyee" }),
    });
    expect(carteDuRecu(gestesDuCircuit(gardee, PROPRIETAIRE, true), gardee.gardeeLe)).toEqual({
      envoyerAuComptable: false,
      retourner: true,
    });
  });

  it("avec un cabinet, la carte porte l'envoi et le retour ; rien pour qui ne reçoit pas", () => {
    expect(carteDuRecu(gestesDuCircuit(recue, PROPRIETAIRE, true), null)).toEqual({
      envoyerAuComptable: true,
      retourner: true,
    });
    expect(carteDuRecu(gestesDuCircuit(recue, SIEGE, true), null)).toBeNull();
  });

  it("la demande d'un siège attend le propriétaire, et lui seul", () => {
    const faits = [fait({ objet: "suppression" })];
    expect(demandeDuSiegeATrancher(faits, PROPRIETAIRE)).toBe("suppression");
    expect(demandeDuSiegeATrancher(faits, SIEGE)).toBeNull();
    expect(
      demandeDuSiegeATrancher([fait({ fait: "refusee", note: "Non" })], PROPRIETAIRE),
    ).toBeNull();
  });
});

describe("la carte de retour : qui renvoie", () => {
  it("retour du propriétaire : le siège renvoie", () => {
    const p = piece({
      circuit: circuit({ dernier: "retournee", retourPar: "Amel" }),
    });
    expect(p.statut).toEqual({ statut: "retour", chez: "proprietaire", qui: "Amel" });
    expect(gestesDuCircuit(p, SIEGE, true)).toMatchObject({
      renvoyer: true,
      garderLeRetour: false,
    });
  });

  it("retour du comptable sur la pièce d'un siège : le propriétaire renvoie, le siège fait le geste", () => {
    const p = piece({ vis: "partage", status: "retournee", circuit: circuit({}) });
    expect(gestesDuCircuit(p, SIEGE, true)).toMatchObject({
      renvoyer: false,
      garderLeRetour: false,
      demanderA: null,
    });
    expect(gestesDuCircuit(p, PROPRIETAIRE, true)).toMatchObject({
      renvoyer: true,
      garderLeRetour: true,
    });
  });
});

describe("ma demande, et sa transmission au comptable", () => {
  it("accordée par le propriétaire sur une pièce chez le comptable : « Demande transmise »", () => {
    const etats = [
      fait({ etape: "cabinet", createdAt: "2026-10-30T11:00:00.000Z", fait: "demandee" }),
      fait({ fait: "accordee", createdAt: "2026-10-30T11:00:00.000Z", transmise: true }),
    ];
    expect(etatDeMaDemande(etats, "rappel", "proprietaire")).toMatchObject({
      fait: "demandee",
      transmise: true,
    });
  });

  /*
   * Revue Codex de #146 : la demande du propriétaire au comptable, déjà en
   * attente, est réutilisée par l'accord ; elle est PLUS ANCIENNE que lui.
   * La base dit « transmise » : l'écran ne compare pas les heures.
   */
  it("la demande du comptable déjà en attente, plus ancienne que l'accord, est bien celle qu'on attend", () => {
    const etats = [
      fait({ etape: "cabinet", createdAt: "2026-10-29T09:00:00.000Z", fait: "demandee" }),
      fait({ fait: "accordee", createdAt: "2026-10-30T11:00:00.000Z", transmise: true }),
    ];
    expect(etatDeMaDemande(etats, "rappel", "proprietaire")).toEqual({
      fait: "demandee",
      note: null,
      createdAt: "2026-10-29T09:00:00.000Z",
      transmise: true,
    });
  });

  it("le comptable a répondu : le siège lit sa réponse", () => {
    const etats = [
      fait({
        etape: "cabinet",
        fait: "refusee",
        note: "Non",
        createdAt: "2026-10-31T09:00:00.000Z",
      }),
      fait({ fait: "accordee", transmise: true }),
    ];
    expect(etatDeMaDemande(etats, "rappel", "proprietaire")).toMatchObject({
      fait: "refusee",
      note: "Non",
      transmise: true,
    });
  });

  it("accordée sur une pièce chez lui : c'est fini, rien n'est transmis — même s'il reste une vieille réponse du comptable", () => {
    const etats = [
      fait({ etape: "cabinet", fait: "refusee", createdAt: "2026-10-31T12:00:00.000Z" }),
      fait({ fait: "accordee", createdAt: "2026-10-30T11:00:00.000Z" }),
    ];
    expect(etatDeMaDemande(etats, "rappel", "proprietaire")).toMatchObject({
      fait: "accordee",
      transmise: false,
    });
  });

  it("le propriétaire lit SA demande au comptable, pas celle du siège", () => {
    const etats = [
      fait({ fait: "demandee" }),
      fait({ etape: "cabinet", fait: "refusee", note: "Non" }),
    ];
    expect(etatDeMaDemande(etats, "rappel", "cabinet")).toMatchObject({
      fait: "refusee",
      note: "Non",
    });
    expect(etatDeMaDemande(etats, "rappel", null)).toBeNull();
  });

  it("la demande d'un siège attend le propriétaire tant que SON étape est en attente", () => {
    const etats = [
      fait({ etape: "cabinet", fait: "demandee" }),
      fait({ fait: "refusee", note: "Non" }),
    ];
    expect(demandeDuSiegeATrancher(etats, PROPRIETAIRE)).toBeNull();
    expect(demandeDuSiegeATrancher([fait({})], PROPRIETAIRE)).toBe("rappel");
  });
});
