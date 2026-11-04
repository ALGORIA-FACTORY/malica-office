/**
 * La bibliothèque du cabinet, rangée : client › mois › type › pièces.
 *
 * Maquette validée par Wissem le 4 novembre 2026 (« Bibliothèque du cabinet —
 * maquette ») : des cartes par mois, et dans un mois des cartes par type de
 * document. Ce fichier ne fait que RANGER et COMPTER ce que la base a rendu :
 * le mois de classement de chaque pièce, les mois sans pièce entre la
 * première et la dernière, le total affiché d'un groupe, son état. Aucune
 * règle comptable ni fiscale n'y vit — l'état vient du statut que le Socle a
 * dérivé (`statut-d-envoi.ts`), le total est une addition exacte.
 */
import { sommeDecimale } from "@malica/socle/somme-decimale";
import { A_TRAITER, TON_CABINET } from "@malica/socle/statut-d-envoi";
import type { DocumentComptable } from "@malica/socle/ports/repositories";

/** Le mois de classement d'une pièce, « AAAA-MM ». */
export const moisDe = (d: Pick<DocumentComptable, "dateDeClassement">) =>
  d.dateDeClassement.slice(0, 7);

/** La clé du groupe « autres » : un type absent du référentiel, ou non établi. */
export const AUTRES = "_autres";

/** Le type d'une pièce tel que la bibliothèque le range : un code du référentiel, ou `AUTRES`. */
export function typeRange(type: string | null, codesConnus: ReadonlySet<string>): string {
  return type !== null && codesConnus.has(type) ? type : AUTRES;
}

/** « 2026-06 » → « 2026-05 » ; « 2026-01 » → « 2025-12 ». */
export function moisPrecedent(mois: string): string {
  const [a, m] = mois.split("-").map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export type Rangee<T> =
  | { genre: "mois"; mois: string; pieces: T[] }
  /** Des mois consécutifs sans pièce, du plus récent (`du`) au plus ancien (`au`). */
  | { genre: "trou"; du: string; au: string; n: number };

/**
 * Les pièces par mois, du plus récent au plus ancien, et entre deux mois
 * présents les mois sans pièce regroupés en un seul « trou ». Avant la
 * première pièce et après la dernière, rien : un dossier ne manque pas de
 * mois qu'il n'a pas encore vécus.
 */
export function rangerParMois<T extends Pick<DocumentComptable, "dateDeClassement">>(
  pieces: readonly T[],
): Rangee<T>[] {
  const parMois = new Map<string, T[]>();
  for (const p of pieces) {
    const m = moisDe(p);
    const groupe = parMois.get(m);
    if (groupe) groupe.push(p);
    else parMois.set(m, [p]);
  }
  return rangerLesMois([...parMois.keys()]).map((r) =>
    r.genre === "trou" ? r : { genre: "mois", mois: r.mois, pieces: parMois.get(r.mois)! },
  );
}

/**
 * Les mois présents, du plus récent au plus ancien, et entre deux d'entre eux
 * les mois absents regroupés en un « trou ». Sert aussi au sommaire d'un
 * dossier trop grand pour se restituer d'un coup.
 */
export function rangerLesMois(
  presents: readonly string[],
): Array<{ genre: "mois"; mois: string } | Extract<Rangee<never>, { genre: "trou" }>> {
  const mois = [...new Set(presents)].sort().reverse();
  const rangees: Array<
    { genre: "mois"; mois: string } | Extract<Rangee<never>, { genre: "trou" }>
  > = [];
  mois.forEach((m, i) => {
    rangees.push({ genre: "mois", mois: m });
    const suivant = mois[i + 1];
    if (!suivant) return;
    const du = moisPrecedent(m);
    if (du === suivant) return;
    let au = du;
    let n = 1;
    while (moisPrecedent(au) !== suivant) {
      au = moisPrecedent(au);
      n += 1;
    }
    rangees.push({ genre: "trou", du, au, n });
  });
  return rangees;
}

/** Le TTC d'un groupe, s'il se dit : chaque montant lu, une seule devise. */
export type Total =
  | { genre: "montant"; montant: string; devise: string }
  /** Au moins une pièce sans montant lu : le total serait faux. */
  | { genre: "a_saisir"; manquants: number }
  /** Plusieurs devises : un total les mélangerait. */
  | { genre: "devises"; devises: string[] };

export function totalDu(pieces: readonly Pick<DocumentComptable, "montant" | "devise">[]): Total {
  const manquants = pieces.filter((p) => p.montant === null).length;
  if (manquants > 0) return { genre: "a_saisir", manquants };
  const devises = [...new Set(pieces.map((p) => p.devise))];
  if (devises.length > 1) return { genre: "devises", devises };
  const valeurs = pieces.map((p) => p.montant!);
  const decimales = Math.max(0, ...valeurs.map((v) => v.split(/[.,]/)[1]?.length ?? 0));
  return { genre: "montant", montant: sommeDecimale(valeurs, decimales), devise: devises[0]! };
}

/**
 * L'état d'un groupe, du plus pressant au plus calme : une pièce attend le
 * cabinet (`a_valider`), une est chez le client (`chez_le_client`), tout est
 * pris en charge (`pret`). Une pièce sans statut ne rend pas un groupe prêt.
 */
export type EtatDuGroupe = "a_valider" | "chez_le_client" | "pret" | "neutre";

export function etatDu(pieces: readonly Pick<DocumentComptable, "statut">[]): EtatDuGroupe {
  if (pieces.some((p) => p.statut && A_TRAITER.has(p.statut))) return "a_valider";
  if (pieces.some((p) => p.statut && TON_CABINET[p.statut] === "az")) return "chez_le_client";
  if (pieces.length > 0 && pieces.every((p) => p.statut && TON_CABINET[p.statut] === "ok"))
    return "pret";
  return "neutre";
}

/** Ce que la ligne de contrôle compte, sur le dossier entier. */
export function compter<T extends Pick<DocumentComptable, "dateDeClassement" | "statut">>(
  rangees: readonly Rangee<T>[],
) {
  let aValider = 0;
  let moisSansPiece = 0;
  let moisPrets = 0;
  for (const r of rangees) {
    if (r.genre === "trou") {
      moisSansPiece += r.n;
      continue;
    }
    aValider += r.pieces.filter((p) => p.statut && A_TRAITER.has(p.statut)).length;
    if (etatDu(r.pieces) === "pret") moisPrets += 1;
  }
  return { aValider, moisSansPiece, moisPrets };
}
