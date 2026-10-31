/**
 * Convertir l'extrait d'une pièce en devise dans la devise du dossier.
 *
 * ================================================================= POURQUOI
 *
 * Une facture de 1 000,00 € d'un dossier tenu en dinars partait au journal à
 * sa valeur faciale (avant #142), puis n'était plus proposée du tout, faute de
 * cours. Ce module la convertit, au cours que la règle de change désigne
 * (`app.regle_de_change`), et ne devine rien. Chaque montant passe par le
 * moteur de change du Socle (`convertFx`) : montant × taux ÷ unité, en décimal
 * exact, arrondi à l'exposant de la devise du dossier par l'arrondi du Socle
 * (au plus proche, à égalité au pair).
 *
 * ================================================== CE QUI EST CONVERTI TEL QUEL
 *
 *   — le TOTAL de la facture (la dette envers le tiers) ;
 *   — la TVA de CHAQUE TAUX, sur son total : la TVA déductible ou collectée
 *     est la TVA de la facture au cours, et non la somme de ses lignes
 *     arrondies une à une (revue de #148 : 10 lignes de 1,90 € de TVA à
 *     655,957 donnaient 12 460 F CFA de TVA quand la facture en porte 12 463) ;
 *   — chaque droit hors TVA.
 *
 * ================================================== CE QUI EST RÉPARTI
 *
 * Les lignes d'un même taux se partagent la TVA de ce taux, et les bases
 * l'ensemble des bases, par SOMMES CUMULÉES : on convertit la somme des k
 * premières lignes, et chaque ligne reçoit la différence de deux sommes
 * successives. Chaque ligne s'écarte de sa conversion exacte de moins d'une
 * unité, et la somme est exactement la conversion du total.
 *
 * Reste l'écart entre le total converti et la somme des parties converties
 * (chaque arrondi est juste, leur somme peut différer de quelques unités).
 * Il se porte selon la règle d'écart du référentiel (`change.ecart`), et :
 *   — il est BORNÉ : au plus une demi-unité par montant arrondi (le total,
 *     chaque taux, chaque droit, la somme des bases) — au-delà, c'est un
 *     défaut, et la conversion le refuse ;
 *   — il ne change JAMAIS le signe d'une base : sinon, refus (revue de #148 :
 *     60 lignes de 0,01 € portaient −53 F CFA sur une base, devenue −46).
 *
 * Une facture qui ne tient pas dans SA devise (total ≠ bases + TVA + droits)
 * ne se convertit pas : l'écart de la facture irait se cacher dans une base.
 * Une règle d'écart inconnue lève : un écart ne se place pas au hasard.
 *
 * L'extrait converti est équilibré par construction : bases + TVA + droits =
 * total, au dernier chiffre. L'écriture se compose sur lui (`buildProposal`),
 * et la déclaration de TVA le lit tel quel : les deux disent les mêmes
 * chiffres.
 */
import type { ExtractV1 } from "../../contracts/extract.v1.ts";
import { D, sum, toFixedStr, type Decimal } from "../../domain/decimal.ts";
import type { CurrencyDef } from "../../domain/types.ts";

import { convertFx } from "./convert.ts";

/** Les règles d'écart que le Socle sait appliquer (`change.ecart`, `ref.change_regles_d_ecart`). */
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

/** Pourquoi une conversion se refuse, en un code stable. */
export type RaisonDuRefusDeConversion = "regle_inconnue" | "desequilibre" | "signe" | "ecart";

/**
 * La conversion est refusée : une règle d'écart inconnue, une facture qui ne
 * tient pas dans sa devise, un écart qui changerait le signe d'une base ou
 * dépasserait sa borne. Le code se dit ; rien n'est converti à moitié.
 */
export class ConversionRefusee extends Error {
  readonly raison: RaisonDuRefusDeConversion;
  constructor(raison: RaisonDuRefusDeConversion, detail: string) {
    super(detail);
    this.name = "ConversionRefusee";
    this.raison = raison;
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
 * Répartit la conversion d'une somme sur ses parties, par sommes cumulées :
 * la partie k reçoit conv(Σ₀..k) − conv(Σ₀..k−1). Chaque partie s'écarte de
 * sa propre conversion de moins d'une unité ; la somme vaut conv(Σ).
 */
function repartir(parties: readonly string[], c: ConversionDemandee): Decimal[] {
  let cumul = D(0);
  let avant = D(0);
  return parties.map((p) => {
    cumul = cumul.plus(p);
    const converti = D(convertirUnMontant(cumul.toString(), c));
    const part = converti.minus(avant);
    avant = converti;
    return part;
  });
}

/** Une unité de la devise à cet exposant, en décimal exact (« 0.001 » à 3). */
export function uniteALExposant(decimals: number): string {
  return D(1).div(D(10).pow(decimals)).toFixed(decimals);
}

/**
 * La facture à sa DETTE envers le tiers (bases + TVA + droits), quand son
 * total imprimé ne s'en écarte que de l'arrondi d'impression toléré — une
 * unité de sa devise, la tolérance du pivot (`rounding_tolerance`). C'est la
 * dette qui se convertit : un écart imprimé ne glisse pas dans une base
 * convertie. Au-delà, l'extrait est rendu tel quel, et `convertirLExtrait`
 * le refuse en le nommant (`desequilibre`).
 *
 * Une seule règle pour l'écriture (`propose-ecriture.ts`) et pour la TVA du
 * mois (`en-devise-du-dossier.ts`) : revue de #148, une facture au total
 * imprimé décalé d'un millime s'inscrivait au journal et sortait de la TVA.
 */
export function aSaDette(extrait: ExtractV1, decimals: number): ExtractV1 {
  const dette = sum([
    ...extrait.lines.flatMap((l) => [l.base_ht, l.vat_amount]),
    ...extrait.other_charges.map((x) => x.amount),
  ]);
  if (dette.minus(extrait.totals.ttc).abs().greaterThan(uniteALExposant(decimals))) return extrait;
  return { ...extrait, totals: { ...extrait.totals, ttc: toFixedStr(dette, decimals) } };
}

const signe = (x: Decimal) => (x.isZero() ? 0 : x.isNegative() ? -1 : 1);

/**
 * L'extrait, converti dans la devise du dossier, et ce que la conversion a
 * fait. L'extrait d'entrée est celui de la pièce, déjà validé (`ExtractV1`).
 * Lève `ConversionRefusee` plutôt que de convertir faux.
 */
export function convertirLExtrait(
  extrait: ExtractV1,
  c: ConversionDemandee,
): { extrait: ExtractV1; conversion: ConversionFaite } {
  if (!estUneRegle(c.ecart))
    throw new ConversionRefusee(
      "regle_inconnue",
      `Règle d'écart de conversion inconnue : « ${c.ecart} ».`,
    );
  const n = c.vers.decimals;
  const unite = D(1).div(D(10).pow(n));
  const parties = sum([
    ...extrait.lines.flatMap((l) => [l.base_ht, l.vat_amount]),
    ...extrait.other_charges.map((x) => x.amount),
  ]);
  if (!parties.eq(extrait.totals.ttc))
    throw new ConversionRefusee(
      "desequilibre",
      `La facture ne tient pas dans sa devise : bases, TVA et droits font ${parties.toString()}, le total ${extrait.totals.ttc}.`,
    );

  const conv = (m: string) => convertirUnMontant(m, c);
  const convNul = (m: string | null) => (m === null ? null : conv(m));

  // La TVA de chaque taux, convertie sur son total, puis répartie sur ses lignes.
  const tvas: Decimal[] = extrait.lines.map(() => D(0));
  const codes = [...new Set(extrait.lines.map((l) => l.tax_code))];
  for (const code of codes) {
    const rangs = extrait.lines.flatMap((l, i) => (l.tax_code === code ? [i] : []));
    repartir(
      rangs.map((i) => extrait.lines[i]!.vat_amount),
      c,
    ).forEach((v, k) => (tvas[rangs[k]!] = v));
  }
  const droits = extrait.other_charges.map((x) => D(conv(x.amount)));
  const ttc = D(conv(extrait.totals.ttc));
  const bases = repartir(
    extrait.lines.map((l) => l.base_ht),
    c,
  );

  /*
   * L'écart : total converti − parties converties. Sa borne : une demi-unité
   * par montant arrondi — le total, la TVA de chaque taux, chaque droit, la
   * somme des bases.
   */
  const ecart = ttc.minus(sum(bases)).minus(sum(tvas)).minus(sum(droits));
  const borne = unite.times(codes.length + droits.length + 2).div(2);
  if (ecart.abs().greaterThan(borne))
    throw new ConversionRefusee(
      "ecart",
      `Écart de conversion ${ecart.toString()} au-delà de sa borne ${borne.toString()}.`,
    );

  // « base_la_plus_grande » : l'écart va à la plus grande base convertie, la
  // première à égalité ; il ne change jamais son signe.
  let ajustee: number | null = null;
  if (!ecart.isZero()) {
    ajustee = bases.reduce((iMax, b, i) => (b.greaterThan(bases[iMax]!) ? i : iMax), 0);
    const avant = bases[ajustee]!;
    const apres = avant.plus(ecart);
    if (signe(apres) !== signe(D(extrait.lines[ajustee]!.base_ht)))
      throw new ConversionRefusee(
        "signe",
        `L'écart de conversion ${ecart.toString()} changerait le signe de la base ${avant.toString()}.`,
      );
    bases[ajustee] = apres;
  }
  // Aucune base ne change de signe par la répartition elle-même.
  if (bases.some((b, i) => signe(b) !== signe(D(extrait.lines[i]!.base_ht)) && !b.isZero()))
    throw new ConversionRefusee("signe", "Une base convertie change de signe.");

  const fixe = (x: Decimal) => toFixedStr(x, n);
  return {
    extrait: {
      ...extrait,
      currency: c.vers.code,
      lines: extrait.lines.map((l, i) => ({
        ...l,
        base_ht: fixe(bases[i]!),
        vat_amount: fixe(tvas[i]!),
        ttc: fixe(bases[i]!.plus(tvas[i]!)),
      })),
      articles: extrait.articles.map((a) => ({
        ...a,
        unit_price_ht: convNul(a.unit_price_ht),
        unit_price_ttc: convNul(a.unit_price_ttc),
        total_ht: convNul(a.total_ht),
      })),
      other_charges: extrait.other_charges.map((x, i) => ({ ...x, amount: fixe(droits[i]!) })),
      totals: { base_ht: fixe(sum(bases)), vat: fixe(sum(tvas)), ttc: fixe(ttc) },
    },
    conversion: {
      devise_origine: c.de.code,
      devise: c.vers.code,
      taux_unitaire: tauxUnitaire(c.cours),
      cours: c.cours,
      regle_d_ecart: c.ecart,
      ecart: fixe(ecart),
      ligne_ajustee: ajustee,
    },
  };
}
