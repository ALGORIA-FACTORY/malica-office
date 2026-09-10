/**
 * Le solveur des montants — millimes entiers, treillis, arithmétique.
 *
 * ============================================================== POURQUOI
 *
 * « 2.800 » sur un ticket tunisien vaut 2,800 dinars. « 2.800 » sur une
 * facture qui totalise des milliers vaut 2 800 dinars. Le texte seul ne
 * tranche pas — et la version précédente tranchait quand même, par une règle
 * fixe (point + trois chiffres = milliers). Elle avait donc tort une fois sur
 * deux, sans jamais le dire : un montant faux qui a l'air d'un montant.
 *
 * Ici, un texte ne produit plus UNE valeur mais un TREILLIS : toutes les
 * lectures admissibles, chacune en unités mineures entières (le millime pour
 * le dinar). L'arithmétique de la facture tranche ensuite — quantité × prix
 * unitaire, somme des lignes, HT + TVA = TTC. Ce qu'elle ne tranche pas reste
 * ambigu, et l'écran le demande.
 *
 * R2 tient : aucune valeur n'est inventée. Chaque hypothèse est une lecture
 * du token, et le solveur ne fait que choisir entre des lectures existantes.
 *
 * Module pur : aucun réseau, aucune base, aucun framework.
 */

/** Une lecture admissible d'un texte, en unités mineures entières. */
export interface Hypothese {
  /** La valeur en unités mineures (millimes pour le dinar), toujours entière. */
  millimes: number;
  /** Comment le texte a été lu — ce qui rend l'ambiguïté explicable à l'écran. */
  lecture: "decimale" | "milliers" | "entier";
}

/** Une puissance de dix entière : l'échelle de la devise. */
function echelle(decimales: number): number {
  return 10 ** decimales;
}

/** Assemble une valeur en unités mineures, ou null si elle sort de l'entier sûr. */
function composer(
  entier: string,
  fraction: string,
  decimales: number,
  negatif: boolean,
): number | null {
  const complet = `${entier || "0"}${fraction.padEnd(decimales, "0")}`;
  const n = Number(complet);
  if (!Number.isSafeInteger(n)) return null;
  return negatif ? -n : n;
}

/**
 * Rend une valeur en unités mineures sous la forme décimale du contrat
 * (« 1428000 » millimes → « 1428.000 »). Le passage se fait sur les chiffres,
 * jamais par une division flottante : 0,1 + 0,2 n'est pas 0,3, et une facture
 * n'a pas à en souffrir.
 */
export function enDecimal(millimes: number, decimales: number): string {
  const negatif = millimes < 0;
  const chiffres = String(Math.abs(millimes)).padStart(decimales + 1, "0");
  const entier = chiffres.slice(0, chiffres.length - decimales);
  const fraction = decimales > 0 ? `.${chiffres.slice(chiffres.length - decimales)}` : "";
  return `${negatif ? "-" : ""}${entier}${fraction}`;
}

/**
 * Le treillis d'un texte : toutes ses lectures admissibles.
 *
 * Rendu vide quand le texte ne porte pas de nombre, ou quand il en porte un
 * que la devise ne sait pas représenter (« 12,3456 » en dinars). Une lecture
 * absente vaut mieux qu'une lecture arrondie : l'arrondi est une décision, et
 * ce n'est pas à la lecture de la prendre.
 */
export function treillisMontant(texte: string, decimales: number): Hypothese[] {
  let s = texte
    .replace(/\u00a0|\u202f|\s/g, "")
    .replace(/[A-Za-z؀-ۿ%]/g, "")
    .replace(/[^\d.,()\-+]/g, "");
  if (!s) return [];

  let negatif = false;
  if (/^\(.*\)$/.test(s)) {
    negatif = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negatif = true;
    s = s.slice(1);
  }
  s = s.replace(/^\+/, "");
  if (!/^\d[\d.,]*$/.test(s)) return [];

  const chiffres = s.replace(/[.,]/g, "");
  const dernierPoint = s.lastIndexOf(".");
  const derniereVirgule = s.lastIndexOf(",");
  const hypotheses: Hypothese[] = [];

  const ajouter = (entier: string, fraction: string, lecture: Hypothese["lecture"]): void => {
    if (fraction.length > decimales) return;
    const millimes = composer(entier, fraction, decimales, negatif);
    if (millimes === null) return;
    if (hypotheses.some((h) => h.millimes === millimes)) return;
    hypotheses.push({ millimes, lecture });
  };

  // Deux séparateurs différents : le DERNIER porte les décimales, l'autre les
  // milliers. « 1.234,56 » et « 1,234.56 » se lisent tous les deux sans doute.
  if (dernierPoint > -1 && derniereVirgule > -1) {
    const idx = Math.max(dernierPoint, derniereVirgule);
    ajouter(s.slice(0, idx).replace(/[.,]/g, ""), s.slice(idx + 1), "decimale");
    return hypotheses;
  }

  // La virgule ne sépare jamais les milliers en Tunisie : elle est décimale.
  if (derniereVirgule > -1) {
    ajouter(
      s.slice(0, derniereVirgule).replace(/,/g, ""),
      s.slice(derniereVirgule + 1),
      "decimale",
    );
    return hypotheses;
  }

  if (dernierPoint > -1) {
    // Plusieurs points : ce sont des groupes de milliers, l'affaire est close.
    if (s.indexOf(".") !== dernierPoint) {
      ajouter(chiffres, "", "milliers");
      return hypotheses;
    }
    const entier = s.slice(0, dernierPoint);
    const fraction = s.slice(dernierPoint + 1);
    // L'ORDRE COMPTE : la lecture décimale est rendue en premier parce que
    // c'est la plus fréquente sur les pièces de détail. Aucune n'est
    // privilégiée par le solveur — seule l'arithmétique départage.
    ajouter(entier, fraction, "decimale");
    // Un groupe de milliers fait exactement trois chiffres, et ce qui le
    // précède en fait au plus trois : au-delà, le point ne peut plus être un
    // séparateur de milliers, et l'ambiguïté disparaît d'elle-même.
    if (fraction.length === 3 && entier.length >= 1 && entier.length <= 3) {
      ajouter(`${entier}${fraction}`, "", "milliers");
    }
    return hypotheses;
  }

  // Aucun séparateur. Court, c'est un nombre de dinars. Long, c'est le cas que
  // personne ne voit venir : « 16000 » vaut 16 dinars sur un ticket dont les
  // décimales ont été saisies sans virgule, et 16 000 dinars sur une facture.
  if (chiffres.length < decimales + 1) {
    ajouter(chiffres, "", "entier");
    return hypotheses;
  }
  ajouter(chiffres.slice(0, -decimales), chiffres.slice(-decimales), "decimale");
  ajouter(chiffres, "", "entier");
  return hypotheses;
}

/* --------------------------------------------------------------- le solveur */

/** Un champ de la pièce et les lectures admissibles de son token. */
export interface ChampMontant {
  champ: string;
  hypotheses: readonly Hypothese[];
}

/**
 * Une équation de la facture. Les deux seules qui ne dépendent d'aucun
 * référentiel : une somme et un produit. Les taux, le timbre et la retenue
 * viennent du paramétrage daté (R4) et entrent ici sous forme de sommes déjà
 * posées par l'appelant — le solveur n'en connaît aucun.
 */
export type Contrainte =
  | { type: "somme"; total: string; parties: readonly string[] }
  | { type: "produit"; total: string; quantite: string; unitaire: string };

interface ValeurResolue {
  millimes: number;
  /** « lecture » : le texte ne portait qu'une lecture. « arithmetique » : la facture a tranché. */
  decidePar: "lecture" | "arithmetique";
}

export interface Resolution {
  valeurs: Map<string, ValeurResolue>;
  /** Les champs qu'aucune équation ne départage : l'écran les demande. */
  ambigus: string[];
  /**
   * L'écart entre la meilleure affectation et la suivante, en nombre
   * d'équations vérifiées.
   *
   * C'est la seule confiance qui vaille. Celle que rend un modèle mesure ce
   * qu'il a cru voir ; celle-ci mesure si la facture BOUCLE — autre chose, et
   * vérifiable.
   */
  marge: number;
}

export interface OptionsSolveur {
  /**
   * Décimales de la devise, pour ramener un produit à l'échelle. Sans défaut :
   * une devise supposée est une devise fausse, et un montant faux avec elle.
   */
  decimales: number;
  /**
   * Tolérance d'arrondi sur un produit, en unités mineures. L'arrondi au
   * millime interdit l'égalité stricte : 2,5 × 7,549 fait 18,8725. Trop serrée,
   * la tolérance rejette des factures justes ; trop lâche, elle valide des
   * lectures fausses. Elle se calibre sur le banc, pas à l'intuition.
   */
  tolerance?: number;
  /**
   * Plafond d'affectations énumérées. Au-delà, le solveur rend la main : tout
   * reste ambigu et l'écran demande. Une pièce illisible doit coûter une
   * question, jamais une valeur devinée ni une minute de calcul.
   */
  combinaisonsMax?: number;
}

function verifie(
  c: Contrainte,
  lu: (champ: string) => number | undefined,
  decimales: number,
  tolerance: number,
): boolean | null {
  if (c.type === "somme") {
    const total = lu(c.total);
    const parties = c.parties.map(lu);
    if (total === undefined || parties.some((p) => p === undefined)) return null;
    return parties.reduce((s, p) => s! + p!, 0) === total;
  }
  const total = lu(c.total);
  const quantite = lu(c.quantite);
  const unitaire = lu(c.unitaire);
  if (total === undefined || quantite === undefined || unitaire === undefined) return null;
  // Tout reste entier : quantité × unitaire se compare au total remis à
  // l'échelle, jamais à un flottant. Un produit de montants n'a pas de virgule
  // tant qu'on ne le divise pas — alors on ne le divise pas.
  const facteur = echelle(decimales);
  return Math.abs(quantite * unitaire - total * facteur) <= tolerance * facteur;
}

/**
 * Choisit, parmi les lectures admissibles, celles qui font boucler la facture.
 *
 * Ne rend une valeur que lorsqu'une seule affectation l'emporte. À égalité, le
 * champ est déclaré ambigu : c'est le point du dispositif. Une machine qui
 * n'hésite jamais est une machine qui devine.
 */
export function resoudreFacture(
  champs: readonly ChampMontant[],
  contraintes: readonly Contrainte[],
  options: OptionsSolveur,
): Resolution {
  const decimales = options.decimales;
  const tolerance = options.tolerance ?? 1;
  const combinaisonsMax = options.combinaisonsMax ?? 4096;

  const valeurs = new Map<string, ValeurResolue>();
  const ambigus: string[] = [];

  const lisibles = champs.filter((c) => c.hypotheses.length > 0);
  const certains = lisibles.filter((c) => c.hypotheses.length === 1);
  const doutes = lisibles.filter((c) => c.hypotheses.length > 1);

  const fixes = new Map<string, number>();
  for (const c of certains) {
    fixes.set(c.champ, c.hypotheses[0]!.millimes);
    valeurs.set(c.champ, { millimes: c.hypotheses[0]!.millimes, decidePar: "lecture" });
  }

  if (doutes.length === 0) return { valeurs, ambigus, marge: 0 };

  const combinaisons = doutes.reduce((n, c) => n * c.hypotheses.length, 1);
  if (combinaisons > combinaisonsMax) {
    return { valeurs, ambigus: doutes.map((c) => c.champ), marge: 0 };
  }

  // Énumération des affectations, du produit cartésien des treillis.
  const affectations: number[][] = [[]];
  for (const c of doutes) {
    const suivant: number[][] = [];
    for (const debut of affectations) {
      for (const h of c.hypotheses) suivant.push([...debut, h.millimes]);
    }
    affectations.length = 0;
    affectations.push(...suivant);
  }

  const scores = affectations.map((a) => {
    const lu = (champ: string): number | undefined => {
      const i = doutes.findIndex((c) => c.champ === champ);
      return i >= 0 ? a[i] : fixes.get(champ);
    };
    return contraintes.reduce(
      (n, c) => (verifie(c, lu, decimales, tolerance) === true ? n + 1 : n),
      0,
    );
  });

  // La marge se mesure sur la DEUXIÈME AFFECTATION, pas sur le deuxième score.
  // Deux affectations à égalité en tête donnent une marge nulle, même si toutes
  // les autres sont loin derrière : la facture boucle de deux façons, et rien
  // n'a été départagé. Compter les niveaux de score, ici, surestimerait la
  // confiance — exactement ce que le dispositif est censé rendre impossible.
  const classes = [...scores].sort((a, b) => b - a);
  const meilleur = classes[0]!;
  const marge = classes.length > 1 ? meilleur - classes[1]! : 0;
  const tetes = affectations.filter((_, i) => scores[i] === meilleur);

  doutes.forEach((c, i) => {
    const premier = tetes[0]![i]!;
    const unanime = tetes.every((t) => t[i] === premier);
    if (marge > 0 && unanime) {
      valeurs.set(c.champ, { millimes: premier, decidePar: "arithmetique" });
    } else {
      ambigus.push(c.champ);
    }
  });

  return { valeurs, ambigus, marge };
}
