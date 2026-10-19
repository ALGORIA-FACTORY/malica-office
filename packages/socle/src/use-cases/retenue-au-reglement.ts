/**
 * Les retenues à la source d'un règlement : déduites des faits, jamais supposées.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 19 octobre 2026. Le dirigeant : « la comptabilité lit les documents envoyés
 * et propose les écritures correctement ». L'épreuve du règlement prenait pour
 * exemple un achat de 1 969,610 DT payé par chèque, et proposait 401 / 532
 * pour le montant entier. Au-dessus du seuil de l'article 52-I-g du CIRPPIS,
 * l'acheteur RETIENT une part du prix et la reverse à l'État : le chèque ne
 * porte que le net, et la dette s'éteint pour le TTC.
 *
 * 20 octobre 2026 : « termine toutes les retenues à la source ». Le moteur ne
 * connaissait que les trois taux de l'article 52-I-g. Il connaît désormais
 * tout ce qu'un règlement de facture peut porter :
 *
 *   — l'impôt sur le revenu retenu (art. 52 CIRPPIS) : marchés 1,5 · 1 · 0,5 %
 *     au-dessus de 1 000 DT TTC ; honoraires, commissions, courtages, loyers
 *     10 % ou 3 % ; loyers d'hôtels, artistes 5 % ; non-résidents 15 % ;
 *   — la TVA retenue par l'État et les établissements publics (art. 19 bis
 *     CTVA) : 25 % de la TVA, au-dessus de 1 000 DT TTC — et elle se CUMULE
 *     avec la retenue d'impôt : un ministère qui paie une facture de 2 380 DT
 *     retient 1,5 % du TTC ET 25 % de la TVA.
 *
 * ======================================================== CE QUE CE MODULE FAIT
 *
 * Il ne SUPPOSE pas qu'une retenue a été opérée : il le CONSTATE. Le
 * référentiel donne les taux possibles, leur base (TTC ou TVA), leur seuil et
 * le sens où ils jouent ; le montant réglé dit lesquels ont servi. On essaie
 * chaque taux seul, puis chaque couple « impôt + TVA » : le premier qui
 * explique le payé au millime l'emporte. Si le payé égale le TTC alors qu'une
 * retenue à seuil était due, on le DIT. Sinon (acompte, paiement partiel), on
 * ne conclut rien.
 *
 * Deux taux de même valeur (5 % : loyers d'hôtels ou artistes) ne se
 * distinguent pas sur un chèque : le constat nomme le taux et laisse la
 * qualification à l'expert — c'est la seule chose que le payé ne dit pas.
 *
 * R4 : aucun taux, aucun seuil n'est écrit ici. R1 : ni base, ni réseau.
 */
import { D, toFixedStr } from "../domain/decimal.ts";

/** Un taux de retenue possible, tel que le référentiel le rend. */
export interface TauxDeRetenue {
  /** Le code du paramètre fiscal : `RAS_MARCHES_ACQUISITIONS`… */
  code: string;
  /** Une fraction : 0.015, jamais 1,5. */
  taux: string;
  libelle: string;
  /** Ce sur quoi le taux s'applique. Absent : le TTC. */
  base?: "ttc" | "tva";
  /** `ir` : impôt sur le revenu ; `tva` : TVA retenue. Absent : `ir`. */
  famille?: "ir" | "tva";
  /** Le seuil TTC propre à ce taux (égal ou supérieur), ou `null` sans seuil. */
  seuil?: string | null;
}

export interface EntreeRetenue {
  /** Le TTC de la pièce réglée, lu sur la pièce. */
  ttc: string;
  /** La TVA de la pièce, lue sur la pièce ; nécessaire aux retenues de TVA. */
  tva?: string | null;
  /** Le montant effectivement réglé, déclaré. */
  paye: string;
  /**
   * Le seuil commun, pour les taux qui n'en portent pas : la forme du
   * 19 octobre, qui ne connaissait que l'article 52-I-g.
   */
  seuil: string | null;
  taux: readonly TauxDeRetenue[];
  decimales: number;
}

/** Une retenue constatée, une ligne de l'écriture. */
export interface RetenueConstatee {
  code: string;
  taux: string;
  libelle: string;
  famille: "ir" | "tva";
  montant: string;
}

export type ConstatDeRetenue =
  /** Le payé est le net : la ou les retenues ont été opérées. */
  | {
      cas: "operee";
      /** La première retenue — la forme du 19 octobre, gardée pour les lecteurs. */
      code: string;
      taux: string;
      libelle: string;
      montant: string;
      ttc: string;
      /** Toutes les retenues constatées, une ou deux. */
      retenues: RetenueConstatee[];
    }
  /** Au-dessus d'un seuil, payé pour le TTC entier : rien n'a été retenu. */
  | { cas: "non_operee"; ttc: string }
  /** Sous les seuils, sans référentiel, ou paiement partiel : rien à constater. */
  | { cas: "sans_objet" };

export function constaterLaRetenue(e: EntreeRetenue): ConstatDeRetenue {
  if (e.taux.length === 0) return { cas: "sans_objet" };
  const ttc = D(e.ttc);
  const paye = D(e.paye);
  if (ttc.lte(0) || paye.lte(0)) return { cas: "sans_objet" };
  const tva = e.tva !== null && e.tva !== undefined && e.tva.trim() !== "" ? D(e.tva) : null;

  // Une unité de la dernière décimale par retenue : l'arrondi se joue au
  // millime, et deux arrondis honnêtes peuvent différer d'autant.
  const unite = D(1).div(D(10).pow(e.decimales));

  const seuilDe = (t: TauxDeRetenue) => (t.seuil !== undefined ? t.seuil : e.seuil);
  const applicable = (t: TauxDeRetenue) => {
    const s = seuilDe(t);
    if (s !== null && ttc.lt(D(s))) return false;
    if ((t.base ?? "ttc") === "tva" && (tva === null || tva.lte(0))) return false;
    return true;
  };
  const montantDe = (t: TauxDeRetenue) => {
    const base = (t.base ?? "ttc") === "tva" ? tva! : ttc;
    return D(toFixedStr(base.times(D(t.taux)), e.decimales));
  };
  const candidats = e.taux.filter(applicable);

  // Une retenue seule, puis un couple impôt + TVA.
  const essais: TauxDeRetenue[][] = [
    ...candidats.map((t) => [t]),
    ...candidats
      .filter((t) => (t.famille ?? "ir") === "ir")
      .flatMap((ir) => candidats.filter((t) => t.famille === "tva").map((v) => [ir, v])),
  ];

  for (const essai of essais) {
    const montants = essai.map(montantDe);
    if (montants.some((m) => m.lte(0))) continue;
    const total = montants.reduce((a, m) => a.plus(m), D(0));
    if (ttc.minus(total).minus(paye).abs().lte(unite.times(essai.length))) {
      // La dernière retenue absorbe l'écart d'arrondi : l'écriture s'équilibre
      // au millime par construction, sur ce qui sépare le payé du TTC.
      const ecart = ttc.minus(paye).minus(total);
      const retenues: RetenueConstatee[] = essai.map((t, i) => ({
        code: t.code,
        taux: t.taux,
        libelle: t.libelle,
        famille: t.famille ?? "ir",
        montant: toFixedStr(
          i === essai.length - 1 ? montants[i]!.plus(ecart) : montants[i]!,
          e.decimales,
        ),
      }));
      const premiere = retenues[0]!;
      return {
        cas: "operee",
        code: premiere.code,
        taux: premiere.taux,
        libelle: premiere.libelle,
        montant: toFixedStr(ttc.minus(paye), e.decimales),
        ttc: toFixedStr(ttc, e.decimales),
        retenues,
      };
    }
  }

  // Payé pour le TTC entier alors qu'une retenue À SEUIL était due : on le
  // dit. Un taux sans seuil (honoraires, loyers) dépend de la nature de la
  // prestation, que le payé ne dit pas : on ne conclut rien.
  const dueParSeuil = candidats.some((t) => seuilDe(t) !== null && (t.famille ?? "ir") === "ir");
  if (dueParSeuil && ttc.minus(paye).abs().lte(unite)) {
    return { cas: "non_operee", ttc: toFixedStr(ttc, e.decimales) };
  }
  return { cas: "sans_objet" };
}
