/**
 * Les clients de la tour, lus comme la tour les lit : un état par client, les
 * cabinets avec leurs PME, et les filtres de la liste.
 *
 * Rien n'est calculé ici qui ne soit déjà en base : l'état d'une facture vient
 * de `facturation.encours_v`, la consommation de `plateforme.licences_v`. Ce
 * module ne fait que REGROUPER (les PME d'un cabinet) et NOMMER (la pastille
 * qui dit l'état). Il ne décide d'aucun montant.
 */
import { comparable } from "@malica/socle/mot-comparable";
import type { CabinetDeLaTour, PmeDeLaTour } from "@malica/socle/ports/repositories";

/** Ce qu'une pastille dit d'un client : payé, à échoir, impayé, suspendu… */
export type EtatDuClient =
  "paye" | "a_echoir" | "partiel" | "impaye" | "suspendu" | "sans_facture" | "sans_licence";

/** L'état d'une PME : la suspension d'abord, puis la pire de ses factures. */
export function etatDeLaPme(p: PmeDeLaTour): EtatDuClient {
  if (p.statut === "suspendue") return "suspendu";
  if (!p.licence_id) return "sans_licence";
  return etatDesFactures(p.etat);
}

/** L'état d'un cabinet : celui de ses factures consolidées. */
export function etatDuCabinet(c: CabinetDeLaTour): EtatDuClient {
  return etatDesFactures(c.etat);
}

function etatDesFactures(etat: CabinetDeLaTour["etat"]): EtatDuClient {
  switch (etat) {
    case "en_retard":
      return "impaye";
    case "partielle":
      return "partiel";
    case "a_echoir":
      return "a_echoir";
    case "payee":
      return "paye";
    default:
      return "sans_facture";
  }
}

/** La PME a-t-elle lu tout ce que son forfait lui donne ce mois-ci ? */
export function auQuota(p: PmeDeLaTour): boolean {
  return (
    p.lectures_droit !== null &&
    p.lectures_consommees !== null &&
    p.lectures_droit > 0 &&
    p.lectures_consommees >= p.lectures_droit
  );
}

/** Une offre portée par les PME d'un cabinet, et combien la portent. */
export interface OffreComptee {
  code: string;
  libelle: string;
  n: number;
}

/** Un cabinet, et ce que ses PME en disent. */
export interface CabinetEtSesPme {
  cabinet: CabinetDeLaTour;
  pme: PmeDeLaTour[];
  /** Les offres de ses PME, la plus portée d'abord (« Team ×3 · Solo ×1 »). */
  offres: OffreComptee[];
  /** Ses PME dont la licence est active. */
  actifs: number;
  /** Les pièces transmises par ses PME depuis le premier du mois. */
  transmisMois: number;
}

/** Les cabinets, chacun avec ses PME, dans l'ordre où la base les rend. */
export function cabinetsEtLeursPme(
  cabinets: readonly CabinetDeLaTour[],
  pme: readonly PmeDeLaTour[],
): CabinetEtSesPme[] {
  const parCabinet = new Map<string, PmeDeLaTour[]>();
  for (const p of pme) {
    if (!p.cabinet_id) continue;
    const liste = parCabinet.get(p.cabinet_id) ?? [];
    liste.push(p);
    parCabinet.set(p.cabinet_id, liste);
  }
  return cabinets.map((cabinet) => {
    const siennes = parCabinet.get(cabinet.id) ?? [];
    const offres = new Map<string, OffreComptee>();
    for (const p of siennes) {
      if (!p.offre_code || p.statut === "resiliee") continue;
      const o = offres.get(p.offre_code) ?? {
        code: p.offre_code,
        libelle: p.offre_libelle ?? p.offre_code,
        n: 0,
      };
      o.n += 1;
      offres.set(p.offre_code, o);
    }
    return {
      cabinet,
      pme: siennes,
      offres: [...offres.values()].sort((a, b) => b.n - a.n || a.libelle.localeCompare(b.libelle)),
      actifs: siennes.filter((p) => p.statut === "active").length,
      transmisMois: siennes.reduce((n, p) => n + p.transmis_mois, 0),
    };
  });
}

/** « Team ×3 · Solo ×1 » : les offres d'un cabinet en une ligne. */
export function offresEnUneLigne(offres: readonly OffreComptee[]): string {
  return offres.map((o) => `${o.libelle} ×${o.n}`).join(" · ");
}

/** Les filtres de la liste des PME — un à la fois, en plus du cabinet et de la recherche. */
export const FILTRES_PME = ["tous", "sans_cabinet", "impayes", "au_quota", "suspendus"] as const;
export type FiltrePme = (typeof FILTRES_PME)[number];

/** Le filtre lu dans l'adresse : inconnu, il vaut « tous ». */
export function filtreDeLAdresse(valeur: unknown): FiltrePme {
  return FILTRES_PME.find((f) => f === valeur) ?? "tous";
}

function retenue(p: PmeDeLaTour, filtre: FiltrePme): boolean {
  switch (filtre) {
    case "sans_cabinet":
      return p.cabinet_id === null;
    case "impayes":
      return p.etat === "en_retard";
    case "au_quota":
      return auQuota(p);
    case "suspendus":
      return p.statut === "suspendue";
    default:
      return true;
  }
}

/** Combien de PME chaque filtre retient : les chiffres de tête, et ceux des puces. */
export function compterParFiltre(pme: readonly PmeDeLaTour[]): Record<FiltrePme, number> {
  const comptes = Object.fromEntries(FILTRES_PME.map((f) => [f, 0])) as Record<FiltrePme, number>;
  for (const p of pme) for (const f of FILTRES_PME) if (retenue(p, f)) comptes[f] += 1;
  return comptes;
}

/** Une recherche qui ignore la casse et les accents, sur le nom, le matricule et le cabinet. */
export function correspond(recherche: string, ...champs: Array<string | null>): boolean {
  const q = comparable(recherche.trim());
  if (!q) return true;
  return champs.some((c) => c !== null && comparable(c).includes(q));
}

/** Les PME que la liste montre. */
export function pmeRetenues(
  pme: readonly PmeDeLaTour[],
  choix: { filtre: FiltrePme; cabinet: string | null; recherche: string },
): PmeDeLaTour[] {
  return pme.filter(
    (p) =>
      retenue(p, choix.filtre) &&
      (choix.cabinet === null || p.cabinet_id === choix.cabinet) &&
      correspond(choix.recherche, p.nom, p.matricule, p.cabinet_nom),
  );
}
