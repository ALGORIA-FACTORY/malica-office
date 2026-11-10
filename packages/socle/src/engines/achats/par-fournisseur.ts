/**
 * Les achats d'un dossier, par fournisseur.
 *
 * Pur : il reçoit les pièces lues (émetteur, sens, total TTC relevé, devise) et
 * rend un classement. Il ne lit rien, n'appelle rien (R1).
 *
 * ============================================================ CE QU'IL COMPTE
 *
 * Seulement ce qui se compte honnêtement : les factures d'ACHAT dont le total
 * a été relevé (R2), dans la devise du dossier. Tout le reste est DIT, jamais
 * deviné : les achats sans total lisible, ceux d'une autre devise (aucun cours
 * n'est appliqué ici), ceux dont l'émetteur n'a pas été lu. Un classement qui
 * tairait ces pièces donnerait un total plausible et faux.
 *
 * ============================================================ LES NOMS
 *
 * « Kordane Digital » et « KORDANE DIGITAL » sont le même fournisseur : la
 * casse, les accents et la ponctuation ne séparent pas. « Kordane Digital
 * SUARL » en est un autre, tant que le dossier ne dit pas le contraire : le
 * moteur ne retire pas une forme juridique qu'il devinerait. L'écriture
 * affichée est la plus fréquente, la première à égalité.
 *
 * Les sommes sont exactes (`sommeDecimale`, en entiers) : pas un millime perdu.
 */
import { sommeDecimale } from "../../somme-decimale.ts";

export interface PieceLuePourLesAchats {
  emetteur: string | null;
  /** Le sens du document : seules les `facture_achat` entrent. */
  kind: string | null;
  /** Le total TTC relevé, en chaîne décimale ; `null` s'il n'a pas été lu. */
  total: string | null;
  devise: string | null;
}

export interface AchatsDUnFournisseur {
  fournisseur: string;
  /** La somme TTC, à la précision de la devise. */
  total: string;
  pieces: number;
}

export interface AchatsParFournisseur {
  devise: string;
  /** Du plus gros au plus petit ; à total égal, par nom. */
  lignes: AchatsDUnFournisseur[];
  total: string;
  /** Les pièces entrées dans les sommes. */
  pieces: number;
  /** Les achats écartés, et pourquoi. */
  ecartees: { sansTotal: number; autreDevise: number; sansEmetteur: number };
}

const SENS_ACHAT = "facture_achat";

/** La clé d'un nom : sans casse, sans accent, sans ponctuation. */
function cleDuNom(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function lisible(total: string): boolean {
  return /^-?\d+(?:[.,]\d+)?$/.test(total.trim());
}

function comparerDesMontants(a: string, b: string, decimales: number): number {
  // a − b, en entiers : le signe de la différence classe sans flottant.
  const diff = sommeDecimale(
    [a, b.trim().startsWith("-") ? b.trim().slice(1) : `-${b.trim()}`],
    decimales,
  );
  return diff.startsWith("-") ? -1 : /^0(?:\.0+)?$/.test(diff) ? 0 : 1;
}

export function achatsParFournisseur(
  pieces: readonly PieceLuePourLesAchats[],
  devise: string,
  decimales: number,
): AchatsParFournisseur {
  const ecartees = { sansTotal: 0, autreDevise: 0, sansEmetteur: 0 };
  const groupes = new Map<string, { ecritures: Map<string, number>; totaux: string[] }>();
  const tous: string[] = [];

  for (const p of pieces) {
    if (p.kind !== SENS_ACHAT) continue;
    if (!p.total || !lisible(p.total)) {
      ecartees.sansTotal += 1;
      continue;
    }
    if ((p.devise ?? devise) !== devise) {
      ecartees.autreDevise += 1;
      continue;
    }
    const nom = p.emetteur?.trim();
    const cle = nom ? cleDuNom(nom) : "";
    if (!nom || !cle) {
      ecartees.sansEmetteur += 1;
      continue;
    }
    const g = groupes.get(cle) ?? { ecritures: new Map<string, number>(), totaux: [] };
    g.ecritures.set(nom, (g.ecritures.get(nom) ?? 0) + 1);
    g.totaux.push(p.total);
    groupes.set(cle, g);
    tous.push(p.total);
  }

  const lignes = [...groupes.values()]
    .map((g) => {
      // L'écriture la plus fréquente ; la première rencontrée à égalité.
      let fournisseur = "";
      let max = 0;
      for (const [ecriture, n] of g.ecritures) {
        if (n > max) {
          max = n;
          fournisseur = ecriture;
        }
      }
      return { fournisseur, total: sommeDecimale(g.totaux, decimales), pieces: g.totaux.length };
    })
    .sort(
      (a, b) =>
        comparerDesMontants(b.total, a.total, decimales) ||
        a.fournisseur.localeCompare(b.fournisseur, "fr"),
    );

  return {
    devise,
    lignes,
    total: sommeDecimale(tous, decimales),
    pieces: tous.length,
    ecartees,
  };
}
