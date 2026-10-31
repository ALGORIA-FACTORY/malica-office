/**
 * Convertir l'extrait d'une pièce en devise dans la devise du dossier.
 *
 * ================================================================= POURQUOI
 *
 * Une facture de 1 000,00 € d'un dossier tenu en dinars partait au journal à
 * sa valeur faciale (avant #142), puis n'était plus proposée du tout, faute de
 * cours. Ce module la convertit, au cours que la règle de change désigne
 * (`ref.socle_params`, `change.*`), et ne devine rien :
 *
 *   — chaque montant est converti par le moteur de change du Socle
 *     (`convertFx`) : montant × taux ÷ unité, en décimal exact, arrondi à
 *     l'exposant de la devise du dossier par l'arrondi du Socle (au plus
 *     proche, à égalité au pair — `toFixedStr`) ;
 *   — la TVA et le total se convertissent TELS QUELS : la TVA déclarée et la
 *     dette envers le tiers sont les montants de la facture au cours, sans
 *     retouche ;
 *   — la somme des parties converties ne refait pas toujours le total
 *     converti (chaque arrondi est juste, leur somme peut s'écarter de
 *     quelques unités). L'écart se porte selon la règle `change.ecart` du
 *     référentiel, et nulle part ailleurs. Une règle inconnue lève : un écart
 *     qu'on ne sait pas placer ne se place pas au hasard.
 *
 * L'extrait converti est équilibré par construction : bases + TVA + droits =
 * total, au dernier chiffre. L'écriture se compose ensuite sur lui
 * (`buildProposal`), et la déclaration de TVA le lit tel quel : les deux
 * disent les mêmes chiffres.
 */
import type { ExtractV1 } from "../../contracts/extract.v1.ts";
import { D, sum, toFixedStr } from "../../domain/decimal.ts";
import type { CurrencyDef } from "../../domain/types.ts";

import { convertFx } from "./convert.ts";

/** Les règles d'écart que le Socle sait appliquer (`change.ecart`). */
export const REGLES_D_ECART = ["base_la_plus_grande"] as const;
export type RegleDEcart = (typeof REGLES_D_ECART)[number];

/** Le cours appliqué : `unite` unités de la devise d'origine valent `taux`. */
export interface CoursAApplique {
  id: string;
  date: string;
  source: string;
  taux: string;
  unite: number;
}

export interface ConversionDemandee {
  /** La devise de la pièce, et son exposant. */
  de: CurrencyDef;
  /** La devise du dossier, et son exposant. */
  vers: CurrencyDef;
  cours: CoursAApplique;
  ecart: string;
}

/** Ce que la conversion a fait, pour le dire. */
export interface ConversionFaite {
  devise_origine: string;
  devise: string;
  /** Le taux pour UNE unité de la devise d'origine (taux ÷ unité, exact). */
  taux_unitaire: string;
  cours: CoursAApplique;
  regle_d_ecart: RegleDEcart;
  /** L'écart d'arrondi porté, signé, dans la devise du dossier. */
  ecart: string;
  /** La ligne de l'extrait qui l'a reçu ; null s'il est nul. */
  ligne_ajustee: number | null;
}

/** Une règle d'écart du référentiel que ce moteur ne connaît pas. */
export class RegleDEcartInconnue extends Error {
  readonly regle: string;
  constructor(regle: string) {
    super(`Règle d'écart de conversion inconnue : « ${regle} ».`);
    this.name = "RegleDEcartInconnue";
    this.regle = regle;
  }
}

const estUneRegle = (r: string): r is RegleDEcart =>
  (REGLES_D_ECART as readonly string[]).includes(r);

/** Le taux pour une unité : exact, l'unité étant une puissance de dix. */
export function tauxUnitaire(cours: Pick<CoursAApplique, "taux" | "unite">): string {
  return D(cours.taux).div(cours.unite).toString();
}

/**
 * Convertit un montant, par le moteur de change du Socle. Pure.
 */
export function convertirUnMontant(montant: string, c: ConversionDemandee): string {
  return convertFx({
    amount: montant,
    from: c.de,
    to: c.vers,
    date: c.cours.date,
    rates: [
      {
        base: c.de.code,
        quote: c.vers.code,
        rate: tauxUnitaire(c.cours),
        valid_from: c.cours.date,
        valid_to: c.cours.date,
        source: c.cours.source,
      },
    ],
  }).amount_out;
}

/**
 * L'extrait, converti dans la devise du dossier, et ce que la conversion a
 * fait. L'extrait d'entrée est celui de la pièce, déjà validé (`ExtractV1`).
 */
export function convertirLExtrait(
  extrait: ExtractV1,
  c: ConversionDemandee,
): { extrait: ExtractV1; conversion: ConversionFaite } {
  if (!estUneRegle(c.ecart)) throw new RegleDEcartInconnue(c.ecart);
  const n = c.vers.decimals;
  const conv = (m: string) => convertirUnMontant(m, c);
  const convNul = (m: string | null) => (m === null ? null : conv(m));

  const bases = extrait.lines.map((l) => conv(l.base_ht));
  const tvas = extrait.lines.map((l) => conv(l.vat_amount));
  const droits = extrait.other_charges.map((x) => conv(x.amount));
  const ttc = conv(extrait.totals.ttc);
  const ecart = D(ttc).minus(sum(bases)).minus(sum(tvas)).minus(sum(droits));

  /*
   * « base_la_plus_grande » : l'écart va à la plus grande base convertie, la
   * première à égalité. La TVA et le total restent la conversion exacte de
   * ce que la facture imprime.
   */
  let ajustee: number | null = null;
  if (!ecart.isZero()) {
    ajustee = bases.reduce((iMax, b, i) => (D(b).greaterThan(bases[iMax]!) ? i : iMax), 0);
    bases[ajustee] = toFixedStr(D(bases[ajustee]!).plus(ecart), n);
  }

  return {
    extrait: {
      ...extrait,
      currency: c.vers.code,
      lines: extrait.lines.map((l, i) => ({
        ...l,
        base_ht: bases[i]!,
        vat_amount: tvas[i]!,
        ttc: toFixedStr(D(bases[i]!).plus(tvas[i]!), n),
      })),
      articles: extrait.articles.map((a) => ({
        ...a,
        unit_price_ht: convNul(a.unit_price_ht),
        unit_price_ttc: convNul(a.unit_price_ttc),
        total_ht: convNul(a.total_ht),
      })),
      other_charges: extrait.other_charges.map((x, i) => ({ ...x, amount: droits[i]! })),
      totals: {
        base_ht: toFixedStr(sum(bases), n),
        vat: toFixedStr(sum(tvas), n),
        ttc,
      },
    },
    conversion: {
      devise_origine: c.de.code,
      devise: c.vers.code,
      taux_unitaire: tauxUnitaire(c.cours),
      cours: c.cours,
      regle_d_ecart: c.ecart,
      ecart: toFixedStr(ecart, n),
      ligne_ajustee: ajustee,
    },
  };
}
