/**
 * Les échéances de l'accueil, une ligne par jour.
 *
 * Le dirigeant, 22 novembre 2026 : « l'échéance doit être groupée par jour, je ne veux
 * pas la composition ». Le 20 novembre portait quatre lignes (TVA, timbre, TCL,
 * retenues) qui disaient la même chose : ce jour-là, il y a des déclarations à faire.
 * L'accueil dit le jour et le nombre ; l'écran des échéances garde le détail.
 *
 * Pur : ni réseau ni écran. Plusieurs sociétés : un jour par société, chacune ses
 * échéances.
 */
export interface EcheanceAPlat {
  id: string;
  dueDate: string;
  label: string;
  status: string;
  tenantId: string;
}

export interface JourDEcheances {
  /** Une clé stable pour la liste. */
  cle: string;
  dueDate: string;
  tenantId: string;
  /** Le nombre d'échéances non faites ce jour-là. */
  n: number;
  /** Le libellé quand il n'y en a qu'une ; sinon le nombre suffit. */
  seule: string | null;
  /** Jours restants : négatif en retard, 0 aujourd'hui. */
  jours: number;
}

/** Les jours d'échéances non faites, le plus proche d'abord, au plus `combien`. */
export function echeancesParJour(
  echeances: readonly EcheanceAPlat[],
  aujourdhui: string,
  combien: number,
): JourDEcheances[] {
  const origine = Date.parse(`${aujourdhui}T00:00:00Z`);
  const jours = new Map<string, JourDEcheances>();
  for (const e of echeances) {
    if (e.status === "fait") continue;
    const cle = `${e.dueDate}|${e.tenantId}`;
    const deja = jours.get(cle);
    if (deja) {
      deja.n += 1;
      deja.seule = null;
      continue;
    }
    jours.set(cle, {
      cle,
      dueDate: e.dueDate,
      tenantId: e.tenantId,
      n: 1,
      seule: e.label,
      jours: Math.round((Date.parse(`${e.dueDate}T00:00:00Z`) - origine) / 86_400_000),
    });
  }
  return [...jours.values()]
    .sort((x, y) => x.dueDate.localeCompare(y.dueDate) || x.tenantId.localeCompare(y.tenantId))
    .slice(0, combien);
}
