/**
 * Le calcul de Malica — une opération arithmétique, évaluée exactement.
 *
 * R3 : la couche agentique ne calcule pas. Quand la personne demande « combien
 * font 17 % de 2 450 », le modèle écrit l'opération et c'est ce moteur qui
 * rend le résultat, en décimal exact (jamais en flottant : 0,1 + 0,2 vaut 0,3).
 *
 * Ce qu'il lit : des nombres (virgule ou point décimal, espaces de milliers),
 * `+ - * / ( )`, les signes « × » et « ÷ », et « % » après un nombre ou une
 * parenthèse (« 17 % » vaut 0,17). Rien d'autre : ni variable, ni fonction.
 *
 * Pur : aucune dépendance au monde.
 */
import { Decimal } from "decimal.js";

/** Le résultat, et les nombres que l'opération employait (pour dire d'où ils viennent). */
export interface CalculRendu {
  /** Le résultat, point décimal, au plus `decimales` décimales, sans zéro final. */
  valeur: string;
  /** Les nombres écrits dans l'opération, point décimal, sans zéro inutile. */
  operandes: string[];
}

const LONGUEUR_MAX = 300;

/** Refus : `calcul.invalide`, `calcul.division_par_zero`, `calcul.trop_long`. */
export function evaluerLeCalcul(expression: string, decimales = 6): CalculRendu {
  if (expression.length > LONGUEUR_MAX) throw new Error("calcul.trop_long");
  const texte = expression
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/(\d) (?=\d{3}(?!\d))/g, "$1")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-");
  const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
  const operandes: string[] = [];
  let i = 0;
  const blancs = () => {
    while (i < texte.length && /\s/.test(texte[i]!)) i += 1;
  };
  const pourcent = (v: Decimal): Decimal => {
    blancs();
    if (texte[i] !== "%") return v;
    i += 1;
    return pourcent(v.div(100));
  };
  const facteur = (): Decimal => {
    blancs();
    const c = texte[i];
    if (c === "-" || c === "+") {
      i += 1;
      const v = facteur();
      return c === "-" ? v.neg() : v;
    }
    if (c === "(") {
      i += 1;
      const v = somme();
      blancs();
      if (texte[i] !== ")") throw new Error("calcul.invalide");
      i += 1;
      return pourcent(v);
    }
    const m = /^\d+(?:[.,]\d+)?/.exec(texte.slice(i));
    if (!m) throw new Error("calcul.invalide");
    i += m[0].length;
    const v = new D(m[0].replace(",", "."));
    operandes.push(v.toString());
    return pourcent(v);
  };
  const produit = (): Decimal => {
    let v = facteur();
    for (;;) {
      blancs();
      const c = texte[i];
      if (c !== "*" && c !== "/") return v;
      i += 1;
      const d = facteur();
      if (c === "/" && d.isZero()) throw new Error("calcul.division_par_zero");
      v = c === "*" ? v.mul(d) : v.div(d);
    }
  };
  const somme = (): Decimal => {
    let v = produit();
    for (;;) {
      blancs();
      const c = texte[i];
      if (c !== "+" && c !== "-") return v;
      i += 1;
      const d = produit();
      v = c === "+" ? v.add(d) : v.sub(d);
    }
  };
  const resultat = somme();
  blancs();
  if (i !== texte.length || operandes.length === 0) throw new Error("calcul.invalide");
  return {
    valeur: resultat.toDecimalPlaces(decimales).toString(),
    operandes: [...new Set(operandes)],
  };
}
