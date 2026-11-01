/**
 * Le compte d'une vente, par la NATURE de ce qu'elle vend (réglage
 * `ventes.compte`, décidé par le CEO le 31 octobre 2026 ; plan NC 01).
 *
 * ================================================================= LA RÈGLE
 *
 * Chaque article vendu se range par sa désignation : le premier motif qui la
 * reconnaît, au plus petit rang (`ref.motifs_de_nature_de_vente`, sur le modèle
 * de `ref.biens_immobilisables`). Le compte d'une nature est celui de son rôle,
 * résolu comme tout rôle : le dossier, son cabinet, puis le pack (R10).
 *
 * Une ligne de taux prend la nature de ses articles. Une facture mêlée se
 * ventile, ligne par ligne, quand les montants des articles le PROUVENT : leur
 * somme, par nature, est exactement la base de la ligne. Sinon rien ne se
 * devine : TOUTE la vente va au compte de repli (la nature `repli` du pack), et
 * la proposition porte la réserve nommée « nature de la vente à préciser ».
 * Tout ou rien : une moitié de facture rangée et l'autre au repli serait une
 * ventilation que personne n'a prouvée.
 *
 * L'option `unique_cabinet` range toute vente au compte du repli, que le
 * cabinet choisit dans son plan comptable : aucune réserve, c'est son choix.
 *
 * Aucun compte, aucun mot n'est écrit ici (R4) : les natures, leurs rôles et
 * leurs motifs sont au référentiel, datés.
 */
import { depuisUniteMineure, enUnitesExactes } from "@malica/socle/somme-decimale";

import type { Requete } from "../db.ts";

import { AMBIGU, compteDuRole } from "./reglement.ts";
import type { ReglagesResolus } from "./reglages-comptables.ts";

/** Le réglage que ce module applique, et ses deux options. */
const REGLAGE = "ventes.compte";
const OPTIONS = ["par_nature_article", "unique_cabinet"] as const;
type OptionDesVentes = (typeof OPTIONS)[number];

/** Une nature d'article vendu, son compte résolu et ses motifs. */
export interface NatureDeVente {
  code: string;
  compte: string;
  rang: number;
  repli: boolean;
  /**
   * Quand la TVA de ce qui est vendu devient exigible (`livraison` ou
   * `encaissement`) : `app.jour_d_imputation_tva` en décide le jour.
   */
  exigibilite: string;
  /** Les motifs (expressions régulières de JavaScript, lues sans casse et en Unicode). */
  motifs: readonly string[];
}

/** Ce que la proposition d'une vente sait des comptes de vente du dossier. */
export interface VentesDuDossier {
  option: OptionDesVentes;
  natures: readonly NatureDeVente[];
}

/** La réserve que porte une vente rangée au repli faute de preuve. */
export interface NatureAPreciser {
  code: "nature_de_vente";
  /**
   * Pourquoi : un article qu'aucun motif ne reconnaît (`inconnue`), une vente
   * sans article lu (`sans_article`), ou une facture mêlée que les montants
   * des articles ne ventilent pas (`non_ventilable`).
   */
  raison: "inconnue" | "sans_article" | "non_ventilable";
  /** Les désignations dont la nature ne se reconnaît pas. */
  articles: string[];
}

export type Ventilation = Array<Array<{ account_code: string; montant: string | null }>>;

/** L'option du dossier ; nulle quand le pack ne porte pas le réglage. */
export function optionDesVentes(r: ReglagesResolus): OptionDesVentes | null {
  const v = r.get(REGLAGE);
  if (v === undefined) return null;
  const option = OPTIONS.find((o) => o === v);
  if (!option) throw new Error("reglage.ventes.illisible");
  return option;
}

/**
 * Les natures en vigueur au jour dit, leurs motifs, et le compte de chacune :
 * pour un dossier, son paramétrage, celui de son cabinet, puis le pack ; sans
 * dossier (le relevé d'essai), le pack seul.
 */
export async function lireLesNaturesDeVente(
  db: Requete,
  pack: string,
  jour: string,
  dossier: string | null,
): Promise<NatureDeVente[]> {
  const { rows } = await db.query<{
    code: string;
    role_code: string;
    rang: number;
    repli: boolean;
    exigibilite: string;
    compte_du_pack: string | null;
    motifs: string[];
  }>(
    `select n.code, n.role_code, n.rang, n.repli, n.exigibilite, b.account_code as compte_du_pack,
            coalesce(array(select m.motif from ref.motifs_de_nature_de_vente m
                            where m.pack_version_id = n.pack_version_id and m.nature = n.code
                              and m.valid_from <= $2::date
                              and (m.valid_to is null or m.valid_to >= $2::date)
                            order by m.motif collate "C"), '{}') as motifs
       from ref.natures_de_vente n
       left join ref.role_bindings b
              on b.pack_version_id = n.pack_version_id and b.role_code = n.role_code
      where n.pack_version_id = $1 and n.valid_from <= $2::date
        and (n.valid_to is null or n.valid_to >= $2::date)
      order by n.rang`,
    [pack, jour],
  );
  const natures: NatureDeVente[] = [];
  for (const n of rows) {
    const compte = dossier
      ? await compteDuRole(db, dossier, n.role_code, pack, null)
      : n.compte_du_pack;
    if (compte === AMBIGU) throw new Error("reglage.ventes.compte_ambigu");
    if (!compte) throw new Error("reglage.ventes.compte_absent");
    natures.push({
      code: n.code,
      compte,
      rang: n.rang,
      repli: n.repli,
      exigibilite: n.exigibilite,
      motifs: n.motifs,
    });
  }
  if (natures.length > 0 && natures.filter((n) => n.repli).length !== 1)
    throw new Error("reglage.ventes.repli");
  return natures;
}

/** La nature d'une désignation : la première reconnue, au plus petit rang ; nulle sinon. */
function natureDe(designation: string, natures: readonly NatureDeVente[]): NatureDeVente | null {
  return natures.find((n) => n.motifs.some((m) => new RegExp(m, "iu").test(designation))) ?? null;
}

/**
 * L'exigibilité de ce qu'une pièce vend — ou achète : c'est la vente du
 * fournisseur. Celle de ses natures quand tous ses articles en ont une seule ;
 * nulle (indécidable) sans article, avec un article qu'aucun motif ne
 * reconnaît (nommé dans `inconnus`), ou avec deux exigibilités. Pure.
 */
export function exigibiliteDesArticles(
  articles: ReadonlyArray<{ designation?: string | null }>,
  natures: readonly NatureDeVente[],
): { exigibilite: string | null; inconnus: string[] } {
  const designations = articles.flatMap((a) =>
    a.designation?.trim() ? [a.designation.trim()] : [],
  );
  const reconnues = designations.map((d) => ({ d, nature: natureDe(d, natures) }));
  const inconnus = reconnues.filter((x) => x.nature === null).map((x) => x.d);
  const exigibilites = new Set(reconnues.flatMap((x) => (x.nature ? [x.nature.exigibilite] : [])));
  return {
    exigibilite:
      designations.length > 0 && inconnus.length === 0 && exigibilites.size === 1
        ? [...exigibilites][0]!
        : null,
    inconnus,
  };
}

/**
 * La ventilation d'une vente : pour chaque ligne de taux, ses comptes (et la
 * part de chacun quand elle se ventile), et la réserve s'il y a lieu. Pure.
 *
 * `lignes` porte le code et la base de chaque ligne en unités mineures de la
 * devise de la pièce (la normalisation du jugement) ; `enDevise` dit que la
 * pièce se convertit : une ventilation chiffrée y demanderait un arrondi que le
 * Socle ne tranche pas, elle va donc au repli.
 */
export function ventilerLesVentes(p: {
  lignes: ReadonlyArray<{ code: string; ht: number }>;
  articles: ReadonlyArray<{
    designation?: string | null;
    total_ht?: string | null;
    tax_code?: string | null;
  }>;
  exposant: number;
  enDevise: boolean;
  ventes: VentesDuDossier;
}): { ventilation: Ventilation; reserve: NatureAPreciser | null } {
  const natures = [...p.ventes.natures].sort((a, b) => a.rang - b.rang);
  const repli = natures.find((n) => n.repli);
  if (!repli) throw new Error("reglage.ventes.repli");
  const toutAuRepli = (reserve: NatureAPreciser | null) => ({
    ventilation: p.lignes.map(() => [{ account_code: repli.compte, montant: null }]),
    reserve,
  });
  if (p.ventes.option === "unique_cabinet") return toutAuRepli(null);

  const articles = p.articles.flatMap((a) =>
    a.designation?.trim()
      ? [{ ...a, designation: a.designation.trim(), nature: natureDe(a.designation, natures) }]
      : [],
  );
  if (articles.length === 0)
    return toutAuRepli({ code: "nature_de_vente", raison: "sans_article", articles: [] });
  const inconnus = articles.filter((a) => a.nature === null).map((a) => a.designation);
  if (inconnus.length > 0)
    return toutAuRepli({ code: "nature_de_vente", raison: "inconnue", articles: inconnus });

  const comptes = new Set(articles.map((a) => a.nature!.compte));
  if (comptes.size === 1)
    return {
      ventilation: p.lignes.map(() => [{ account_code: [...comptes][0]!, montant: null }]),
      reserve: null,
    };

  // Une facture mêlée : chaque ligne par ses articles, prouvée au millime.
  const nonVentilable = toutAuRepli({
    code: "nature_de_vente",
    raison: "non_ventilable",
    articles: [],
  });
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
        // Un total illisible ne prouve rien : la vente ne se ventile pas.
        return nonVentilable;
      }
      parCompte.set(a.nature!.compte, (parCompte.get(a.nature!.compte) ?? 0n) + total);
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
