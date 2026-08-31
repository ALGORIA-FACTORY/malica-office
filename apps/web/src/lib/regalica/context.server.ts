/**
 * Le dossier que Regalica a le droit de lire — et rien de plus.
 *
 * Tout vient de la base à travers les vues `security_invoker` : le mur de
 * visibilité (R6) est celui de la RLS, jamais un filtre écrit ici. Aucune
 * valeur n'est recalculée : on transmet ce que le Socle a déjà produit.
 *
 * Le transport est passé de PostgREST à l'API. Les requêtes n'ont pas changé —
 * mêmes vues, mêmes tris, mêmes limites — et la forme du dossier non plus, à la
 * clé près : ce JSON part dans une invite, et un dossier qui changerait de forme
 * changerait la réponse.
 */

import type { AppelApi } from "@/lib/api.server";

export interface RegalicaContext {
  organisation: {
    name: string;
    kind: string;
    jurisdiction: string;
    currency: string;
    validationMode: string;
  };
  pack: { version: string; effectiveFrom: string } | null;
  pieces: Record<string, number>;
  ecritures: Array<{
    id: string;
    date: string;
    journal: string;
    libelle: string;
    status: string;
    lignes: Array<{
      compte: string;
      libelle: string;
      debit: string;
      credit: string;
      taxCode: string | null;
    }>;
  }>;
  echeances: Array<{ label: string; dueDate: string; status: string }>;
  motifs: Array<{ code: string; severity: string; requiresNote: boolean }>;
  /**
   * Le paramétrage tel qu'il s'applique à ce dossier.
   *
   * C'est ce qui empêche Regalica de répondre sur le plan livré quand le cabinet
   * a choisi autre chose. Sans ces trois listes, elle citerait un compte que
   * personne n'emploie et contredirait le produit lui-même.
   */
  roles: Array<{ code: string; libelle: string; compte: string | null; origine: string }>;
  sousComptes: Array<{ code: string; libelle: string; parent: string }>;
  tiers: Array<{ code: string; raisonSociale: string; nature: string; compteCollectif: string }>;
  piece: {
    id: string;
    status: string;
    source: string;
    contract: string | null;
    extract: unknown;
    flags: unknown;
    citations: Array<{ field: string; page: number; zone: string | null }>;
  } | null;
}

/** Ce que l'API rend : les mêmes lignes, à plat. */
interface ContexteBrut {
  organisation: RegalicaContext["organisation"];
  pack: RegalicaContext["pack"];
  pieces: Array<{ status: string }>;
  ecritures: Array<{
    id: string;
    date: string;
    journal: string;
    libelle: string;
    status: string;
  }>;
  lignes: Array<{
    ecritureId: string;
    compte: string;
    libelle: string;
    debit: number;
    credit: number;
    taxCode: string | null;
  }>;
  echeances: RegalicaContext["echeances"];
  motifs: RegalicaContext["motifs"];
  roles: RegalicaContext["roles"];
  sousComptes: RegalicaContext["sousComptes"];
  tiers: RegalicaContext["tiers"];
  piece: RegalicaContext["piece"];
}

export async function loadRegalicaContext(
  api: AppelApi,
  tenantId: string,
  pieceId?: string | null,
): Promise<RegalicaContext> {
  const brut = await api.rpc<ContexteBrut>("capture", "contexteAssistant", [
    tenantId,
    pieceId ?? null,
  ]);

  const counts: Record<string, number> = {};
  for (const p of brut.pieces) {
    const key = p.status ?? "inconnu";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const byEcriture = new Map<string, RegalicaContext["ecritures"][number]["lignes"]>();
  for (const l of brut.lignes) {
    const list = byEcriture.get(l.ecritureId) ?? [];
    list.push({
      compte: l.compte,
      libelle: l.libelle,
      // `String(nombre)`, comme sur la valeur JSON de PostgREST : « 100 » et
      // « 100.000 » ne sont pas la même invite.
      debit: String(l.debit),
      credit: String(l.credit),
      taxCode: l.taxCode,
    });
    byEcriture.set(l.ecritureId, list);
  }

  return {
    organisation: brut.organisation,
    pack: brut.pack,
    pieces: counts,
    ecritures: brut.ecritures.map((e) => ({
      id: e.id,
      date: e.date,
      journal: e.journal,
      libelle: e.libelle,
      status: e.status,
      lignes: byEcriture.get(e.id) ?? [],
    })),
    echeances: brut.echeances,
    motifs: brut.motifs,
    roles: brut.roles,
    sousComptes: brut.sousComptes,
    tiers: brut.tiers,
    piece: brut.piece,
  };
}
