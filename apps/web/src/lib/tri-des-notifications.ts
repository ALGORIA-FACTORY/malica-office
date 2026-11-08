/**
 * Le tri de l'écran des notifications — planche 2, approuvée le 7 novembre 2026.
 *
 * Recette du même jour : 108 cartes une par une, « Pièce supprimée » répété
 * autant de fois qu'il y avait de pièces, sans savoir de quelle société. Le
 * dessin approuvé trie :
 *
 *   par ONGLET      À traiter (ce qui attend un geste) · Comptabilité ·
 *                   Malica · Tout
 *   par SOCIÉTÉ     toutes, ou une seule
 *   par PÉRIODE     cette semaine, puis plus tôt
 *   par GENRE       les alertes du même genre, dans la même période, se
 *                   regroupent en une ligne (« 9 pièces retournées »)
 *
 * Fonctions pures : l'écran les appelle, le test les juge.
 */
import { attendUnGeste } from "./libelle-de-notification";

export type Onglet = "aTraiter" | "comptabilite" | "malica" | "tout";

export interface NotificationTriee {
  id: string;
  tenantId: string;
  kind: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

/**
 * D'où vient l'alerte. La comptabilité : ce que le cabinet fait ou demande
 * (retours, validations, demandes, mandats, livrables). Malica : ses avis et
 * ce qu'elle soumet à arbitrage. Le reste — le siège, le propriétaire, les
 * pièces de l'équipe — ne se lit que dans « Tout ».
 */
const DE_LA_COMPTABILITE: ReadonlySet<string> = new Set([
  "piece.retournee",
  "piece.validee",
  "piece.demande",
  "piece.demande_tranchee",
  "piece.a_valider",
  "piece.a_revalider",
  "pv.envoye",
  "mandat.propose",
  "mandat.accepte",
  "mandat.refuse",
  "mandat.revoque",
  "acces.propose",
  "acces.accepte",
  "acces.repris",
]);

export function sourceDe(kind: string): "comptabilite" | "malica" | "autre" {
  if (kind.startsWith("conseil.")) return "malica";
  return DE_LA_COMPTABILITE.has(kind) ? "comptabilite" : "autre";
}

function dansLOnglet(n: NotificationTriee, onglet: Onglet): boolean {
  switch (onglet) {
    case "aTraiter":
      return attendUnGeste(n);
    case "comptabilite":
      return sourceDe(n.kind) === "comptabilite";
    case "malica":
      return sourceDe(n.kind) === "malica";
    case "tout":
      return true;
  }
}

interface Groupe<N extends NotificationTriee> {
  /** Stable d'un rendu à l'autre : la période, le genre, la première alerte. */
  cle: string;
  kind: string;
  /** Du plus récent au plus ancien. */
  elements: N[];
  nonLues: number;
}

export interface Section<N extends NotificationTriee> {
  periode: "semaine" | "avant";
  groupes: Groupe<N>[];
}

const SEPT_JOURS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Les sections de l'écran, dans l'ordre : cette semaine, puis plus tôt. Dans
 * chacune, un groupe par genre, rangé à la date de son alerte la plus récente.
 */
export function trier<N extends NotificationTriee>(
  notifications: readonly N[],
  filtre: { onglet: Onglet; societe: string | null; nonLuesSeulement: boolean },
  maintenant = Date.now(),
): Section<N>[] {
  const retenues = notifications
    .filter((n) => dansLOnglet(n, filtre.onglet))
    .filter((n) => filtre.societe === null || n.tenantId === filtre.societe)
    .filter((n) => !filtre.nonLuesSeulement || n.readAt === null)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const sections: Section<N>[] = [];
  for (const periode of ["semaine", "avant"] as const) {
    const dela = retenues.filter((n) => {
      const recente = maintenant - new Date(n.createdAt).getTime() < SEPT_JOURS_MS;
      return periode === "semaine" ? recente : !recente;
    });
    const parGenre = new Map<string, N[]>();
    for (const n of dela) {
      const liste = parGenre.get(n.kind);
      if (liste) liste.push(n);
      else parGenre.set(n.kind, [n]);
    }
    const groupes = [...parGenre.entries()].map(([kind, elements]) => ({
      cle: `${periode}:${kind}:${elements[0]!.id}`,
      kind,
      elements,
      nonLues: elements.filter((e) => e.readAt === null).length,
    }));
    if (groupes.length > 0) sections.push({ periode, groupes });
  }
  return sections;
}

/** Les compteurs des onglets : ce qui n'est pas lu, sur la société choisie. */
export function compteurs(
  notifications: readonly NotificationTriee[],
  societe: string | null,
): Record<Onglet, number> {
  const ici = notifications.filter(
    (n) => n.readAt === null && (societe === null || n.tenantId === societe),
  );
  return {
    aTraiter: ici.filter((n) => dansLOnglet(n, "aTraiter")).length,
    comptabilite: ici.filter((n) => dansLOnglet(n, "comptabilite")).length,
    malica: ici.filter((n) => dansLOnglet(n, "malica")).length,
    tout: ici.length,
  };
}
