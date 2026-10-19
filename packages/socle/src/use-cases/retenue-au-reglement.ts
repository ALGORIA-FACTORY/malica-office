/**
 * La retenue à la source d'un règlement : déduite des faits, jamais supposée.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 19 octobre 2026. Le dirigeant : « la comptabilité lit les documents envoyés
 * et propose les écritures correctement ». L'épreuve du règlement prenait pour
 * exemple un achat de 1 969,610 DT payé par chèque, et proposait
 * 401 / 532 pour le montant entier. Au-dessus du seuil de l'article 52-I-g
 * du CIRPPIS, l'acheteur RETIENT une part du prix et la reverse à l'État : le
 * chèque ne porte que le net, et la dette s'éteint pour le TTC. L'écriture à
 * deux lignes laissait au 401 un reliquat que personne ne devait, et la
 * retenue n'apparaissait nulle part — ni au 432, ni dans la déclaration du
 * mois suivant.
 *
 * ======================================================== CE QUE CE MODULE FAIT
 *
 * Il ne SUPPOSE pas qu'une retenue a été opérée : il le CONSTATE. Le
 * référentiel donne les taux possibles (1,5 %, et les taux réduits) ; le
 * montant réglé dit lequel a servi. Si le payé égale le TTC moins la retenue
 * à l'un de ces taux, la retenue a eu lieu, à ce taux. Si le payé égale le
 * TTC, elle n'a pas eu lieu — et on le DIT, parce que le payeur en reste
 * redevable. Sinon (acompte, paiement partiel), on ne conclut rien.
 *
 * R4 : aucun taux, aucun seuil n'est écrit ici. Ils arrivent du référentiel
 * fiscal daté, avec leur code, et un appel sans eux ne conclut rien.
 * R1 : ni base, ni réseau. Des valeurs entrent, des valeurs sortent.
 */
import { D, toFixedStr } from "../domain/decimal.ts";

/** Un taux de retenue possible, tel que le référentiel le rend. */
export interface TauxDeRetenue {
  /** Le code du paramètre fiscal : `RAS_MARCHES_ACQUISITIONS`… */
  code: string;
  /** Une fraction : 0.015, jamais 1,5. */
  taux: string;
  libelle: string;
}

export interface EntreeRetenue {
  /** Le TTC de la pièce réglée, lu sur la pièce. */
  ttc: string;
  /** Le montant effectivement réglé, déclaré. */
  paye: string;
  /** Le seuil TTC à partir duquel la retenue est due (égal ou supérieur). */
  seuil: string | null;
  taux: readonly TauxDeRetenue[];
  decimales: number;
}

export type ConstatDeRetenue =
  /** Le payé est le net : la retenue a été opérée, à ce taux. */
  | { cas: "operee"; code: string; taux: string; libelle: string; montant: string; ttc: string }
  /** Au-dessus du seuil, payé pour le TTC entier : rien n'a été retenu. */
  | { cas: "non_operee"; ttc: string }
  /** Sous le seuil, sans référentiel, ou paiement partiel : rien à constater. */
  | { cas: "sans_objet" };

export function constaterLaRetenue(e: EntreeRetenue): ConstatDeRetenue {
  if (e.seuil === null || e.taux.length === 0) return { cas: "sans_objet" };
  const ttc = D(e.ttc);
  const paye = D(e.paye);
  if (ttc.lte(0) || paye.lte(0) || ttc.lt(D(e.seuil))) return { cas: "sans_objet" };

  // Une unité de la dernière décimale : l'arrondi d'une retenue se joue au
  // millime, et deux arrondis honnêtes peuvent différer d'autant.
  const tolerance = D(1).div(D(10).pow(e.decimales));

  for (const t of e.taux) {
    const montant = D(toFixedStr(ttc.times(D(t.taux)), e.decimales));
    if (montant.lte(0)) continue;
    if (ttc.minus(montant).minus(paye).abs().lte(tolerance)) {
      return {
        cas: "operee",
        code: t.code,
        taux: t.taux,
        libelle: t.libelle,
        // La retenue est ce qui sépare le payé du TTC : elle se lit ainsi, et
        // l'écriture s'équilibre au millime près par construction.
        montant: toFixedStr(ttc.minus(paye), e.decimales),
        ttc: toFixedStr(ttc, e.decimales),
      };
    }
  }
  if (ttc.minus(paye).abs().lte(tolerance))
    return { cas: "non_operee", ttc: toFixedStr(ttc, e.decimales) };
  return { cas: "sans_objet" };
}
