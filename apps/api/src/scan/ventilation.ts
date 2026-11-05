/**
 * Ventiler une facture mêlée par compte — la règle de la vente et de l'achat.
 *
 * Chaque article porte un compte (celui de sa nature) ou rien (une nature que
 * rien ne reconnaît). Une ligne de taux prend le compte de ses articles. Une
 * facture mêlée se ventile, ligne par ligne, quand les montants des articles
 * le PROUVENT : leur somme, par compte, est exactement la base de la ligne.
 * Sinon rien ne se devine : TOUTE la pièce va au compte de repli, et la
 * proposition porte la réserve nommée. Tout ou rien : une moitié de facture
 * rangée et l'autre au repli serait une ventilation que personne n'a prouvée.
 *
 * La règle vivait dans `nature-de-vente.ts`, pour la seule vente. L'achat en a
 * eu besoin le 5 novembre 2026 (staging, SOFT-INTEGRA) : une facture de
 * licence, de paramétrage, de formation et de maintenance partait en entier
 * au 601 — achats stockés de matières premières —, sans un mot. Une règle,
 * pour les deux sens. Pure.
 */
import { depuisUniteMineure, enUnitesExactes } from "@malica/socle/somme-decimale";

/** La réserve que porte une pièce rangée au repli faute de preuve. */
export interface NatureAPreciser {
  code: "nature_de_vente" | "nature_de_charge";
  /**
   * Pourquoi : un article qu'aucune nature ne reconnaît (`inconnue`), une pièce
   * sans article lu (`sans_article`), ou une facture mêlée que les montants
   * des articles ne ventilent pas (`non_ventilable`).
   */
  raison: "inconnue" | "sans_article" | "non_ventilable";
  /** Les désignations dont la nature ne se reconnaît pas. */
  articles: string[];
}

export type Ventilation = Array<Array<{ account_code: string; montant: string | null }>>;

/**
 * `lignes` porte le code et la base de chaque ligne en unités mineures de la
 * devise de la pièce (la normalisation du jugement) ; `enDevise` dit que la
 * pièce se convertit : une ventilation chiffrée y demanderait un arrondi que le
 * Socle ne tranche pas, elle va donc au repli.
 */
export function ventilerParCompte(p: {
  code: NatureAPreciser["code"];
  lignes: ReadonlyArray<{ code: string; ht: number }>;
  articles: ReadonlyArray<{
    designation?: string | null;
    total_ht?: string | null;
    tax_code?: string | null;
    compte: string | null;
  }>;
  exposant: number;
  enDevise: boolean;
  repli: string;
  /**
   * Une pièce sans article lu porte-t-elle la réserve ? Oui pour une vente
   * (1er novembre 2026). Non pour un achat : sans article, il garde le
   * compte du paramétrage comme avant, et le cabinet le voit à la revue —
   * une réserve sur chaque ticket lu sans détail serait du bruit.
   */
  reserverSansArticle: boolean;
}): { ventilation: Ventilation; reserve: NatureAPreciser | null } {
  const toutAuRepli = (reserve: NatureAPreciser | null) => ({
    ventilation: p.lignes.map(() => [{ account_code: p.repli, montant: null }]),
    reserve,
  });

  const articles = p.articles.flatMap((a) =>
    a.designation?.trim() ? [{ ...a, designation: a.designation.trim() }] : [],
  );
  if (articles.length === 0)
    return toutAuRepli(
      p.reserverSansArticle ? { code: p.code, raison: "sans_article", articles: [] } : null,
    );
  const inconnus = articles.filter((a) => a.compte === null).map((a) => a.designation);
  if (inconnus.length > 0)
    return toutAuRepli({ code: p.code, raison: "inconnue", articles: inconnus });

  const comptes = new Set(articles.map((a) => a.compte!));
  if (comptes.size === 1)
    return {
      ventilation: p.lignes.map(() => [{ account_code: [...comptes][0]!, montant: null }]),
      reserve: null,
    };

  // Une facture mêlée : chaque ligne par ses articles, prouvée à l'unité mineure.
  const nonVentilable = toutAuRepli({ code: p.code, raison: "non_ventilable", articles: [] });
  const codeUnique = new Set(p.lignes.map((l) => l.code)).size === 1 ? p.lignes[0]!.code : null;
  const ventilation: Ventilation = [];
  for (const ligne of p.lignes) {
    const siens = articles.filter((a) => (a.tax_code ?? codeUnique) === ligne.code);
    if (articles.some((a) => !(a.tax_code ?? codeUnique)) || siens.length === 0)
      return nonVentilable;
    const parCompte = new Map<string, bigint>();
    for (const a of siens) {
      let total: bigint;
      try {
        total = enUnitesExactes(a.total_ht ?? "", p.exposant);
      } catch {
        // Un total illisible ne prouve rien : la pièce ne se ventile pas.
        return nonVentilable;
      }
      parCompte.set(a.compte!, (parCompte.get(a.compte!) ?? 0n) + total);
    }
    if (parCompte.size === 1) {
      ventilation.push([{ account_code: [...parCompte.keys()][0]!, montant: null }]);
      continue;
    }
    const somme = [...parCompte.values()].reduce((s, x) => s + x, 0n);
    if (p.enDevise || somme !== BigInt(ligne.ht)) return nonVentilable;
    ventilation.push(
      [...parCompte].map(([account_code, m]) => ({
        account_code,
        montant: depuisUniteMineure(Number(m), p.exposant),
      })),
    );
  }
  return { ventilation, reserve: null };
}
