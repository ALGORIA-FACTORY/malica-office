/**
 * La chaîne de désignation : un principal, un repli, puis l'arrêt.
 *
 * ================================================================== LA DÉCISION
 *
 * 8 novembre 2026, décision du dirigeant :
 *
 *   - Claude désigne (rang 1) ;
 *   - DeepSeek prend la main « pour ne pas s'arrêter » (rang 2), quand Claude
 *     est en DÉFAUT TECHNIQUE (erreur, délai, indisponibilité, clé absente)
 *     ou quand son BUDGET de la période est épuisé ;
 *   - les deux budgets épuisés, ON S'ARRÊTE : aucun modèle n'est appelé, la
 *     pièce est lue par le moteur Sudoku seul, et le motif est journalisé.
 *     Il n'existe pas de troisième maillon, et ce module n'en invente aucun.
 *
 * ================================================================== CE QU'IL NE DÉCIDE PAS
 *
 * Ni les modèles, ni les plafonds, ni la dépense : la chaîne arrive de la base
 * (`public.designation_chaine`), maillon par maillon, avec son verdict
 * `epuise` déjà calculé sur la facture réelle du fournisseur. La tour la règle
 * (`plateforme.designation_regler`), datée et motivée (R4, R8, R10).
 *
 * L'appel lui-même est INJECTÉ : la chaîne se juge sans réseau, et une épreuve
 * peut faire tomber Claude, épuiser un budget ou les deux sans un centime.
 *
 * ================================================================== DEUX ISSUES, PLUS UNE
 *
 *   designee  un maillon a répondu ; les maillons sautés avant lui sont dits
 *             (`bascules`), avec leur motif ;
 *   arretee   TOUS les maillons étaient épuisés (ou la chaîne est vide) : pas
 *             d'appel, pas de dépense, la pièce passe au Sudoku seul ;
 *   (lève)    au moins un maillon a échoué techniquement et aucun n'a répondu :
 *             la dernière panne remonte telle quelle. La file durable la
 *             rejouera — c'est le comportement d'avant pour une panne, et une
 *             panne n'est pas un budget épuisé.
 */

export type Fournisseur = "anthropic" | "deepseek";

/** Un maillon de la chaîne, tel que la base le rend. */
export interface MaillonDeDesignation {
  rang: number;
  fournisseur: Fournisseur;
  modele: string;
  /** Le rôle sous lequel le modèle est tarifé : le journal cherche le tarif par le couple. */
  role: string;
  periode: "jour" | "mois";
  plafond: number | string;
  depense: number | string;
  epuise: boolean;
}

type MotifDeBascule = "technique" | "budget";

export interface Bascule {
  fournisseur: Fournisseur;
  modele: string;
  role: string;
  motif: MotifDeBascule;
  /** Pour une panne : ce que le fournisseur a dit, borné. Jamais une clé. */
  detail: string | null;
}

/** Ce qu'un maillon rend quand il a désigné. */
export interface ReponseDeDesignation {
  answer: string;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}

export type IssueDeLaChaine =
  | {
      issue: "designee";
      maillon: MaillonDeDesignation;
      reponse: ReponseDeDesignation;
      bascules: readonly Bascule[];
    }
  | { issue: "arretee"; motif: MotifDArret; bascules: readonly Bascule[] };

/** Pourquoi la désignation par modèle ne s'est pas faite. */
export type MotifDArret = "arret.budgets_epuises" | "arret.chaine_vide";

const FOURNISSEURS: readonly Fournisseur[] = ["anthropic", "deepseek"];

/**
 * Relire ce que la base rend, sans rien deviner : un maillon dont le
 * fournisseur n'est pas l'un des deux que le serveur sait appeler est une
 * erreur nommée, pas un maillon qu'on saute en silence.
 */
export function lireLaChaine(brute: unknown): MaillonDeDesignation[] {
  if (!Array.isArray(brute)) throw new Error("designation.chaine_illisible");
  return brute
    .map((m: unknown) => {
      const x = (m ?? {}) as Record<string, unknown>;
      const fournisseur = FOURNISSEURS.find((f) => f === x["fournisseur"]);
      if (
        !fournisseur ||
        typeof x["modele"] !== "string" ||
        typeof x["role"] !== "string" ||
        typeof x["epuise"] !== "boolean" ||
        typeof x["rang"] !== "number"
      )
        throw new Error("designation.chaine_illisible");
      return {
        rang: x["rang"],
        fournisseur,
        modele: x["modele"],
        role: x["role"],
        periode: x["periode"] === "jour" ? "jour" : "mois",
        plafond: x["plafond"] as number | string,
        depense: x["depense"] as number | string,
        epuise: x["epuise"],
      } satisfies MaillonDeDesignation;
    })
    .sort((a, b) => a.rang - b.rang);
}

function detailDe(e: unknown): string {
  const brut = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return brut.replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Parcourir la chaîne, dans l'ordre des rangs.
 *
 * Un maillon épuisé est sauté sans être appelé (motif `budget`) ; un maillon
 * qui lève est sauté après coup (motif `technique`). Le premier qui répond
 * désigne.
 */
export async function designerEnChaine(input: {
  chaine: readonly MaillonDeDesignation[];
  appeler: (maillon: MaillonDeDesignation) => Promise<ReponseDeDesignation>;
}): Promise<IssueDeLaChaine> {
  const bascules: Bascule[] = [];
  let panne: { erreur: unknown } | null = null;

  for (const maillon of [...input.chaine].sort((a, b) => a.rang - b.rang)) {
    const qui = { fournisseur: maillon.fournisseur, modele: maillon.modele, role: maillon.role };
    if (maillon.epuise) {
      bascules.push({ ...qui, motif: "budget", detail: null });
      continue;
    }
    try {
      const reponse = await input.appeler(maillon);
      return { issue: "designee", maillon, reponse, bascules };
    } catch (e: unknown) {
      panne = { erreur: e };
      bascules.push({ ...qui, motif: "technique", detail: detailDe(e) });
    }
  }

  if (panne) throw panne.erreur;
  return {
    issue: "arretee",
    motif: input.chaine.length === 0 ? "arret.chaine_vide" : "arret.budgets_epuises",
    bascules,
  };
}

/**
 * Ce que le journal inscrit pour une bascule ou un arrêt : un code d'abord,
 * lisible par la tour (`split_part(error, ':', 1)`), puis le détail.
 */
export function erreurAuJournal(b: Bascule, arret: MotifDArret | null): string {
  const code = arret ?? `bascule.${b.motif}`;
  return b.detail ? `${code}: ${b.detail}` : code;
}

/**
 * Une chaîne d'un seul maillon, sans plafond, pour les bancs payants lancés à
 * la main (`tests/real/`) : ils ne passent pas par la base, et nomment
 * eux-mêmes le modèle qu'ils mesurent. Jamais en production.
 */
export function chaineDeBanc(
  fournisseur: Fournisseur,
  modele: string,
  role = "chat",
): MaillonDeDesignation[] {
  return [
    { rang: 1, fournisseur, modele, role, periode: "mois", plafond: 0, depense: 0, epuise: false },
  ];
}
