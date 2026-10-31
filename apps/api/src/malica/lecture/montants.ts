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

import {
  lireUnMontantImprime,
  type DeviseLue,
  type FormeDeLecture,
} from "@malica/socle/montant-imprime";

import type { Lecteur } from "./vision.ts";

/** Une lecture admissible d'un texte, en unités mineures entières. */
export interface Hypothese {
  /** La valeur en unités mineures (millimes pour le dinar), toujours entière. */
  millimes: number;
  /** Comment le texte a été lu — ce qui rend l'ambiguïté explicable à l'écran. */
  lecture: FormeDeLecture;
}

/** Une puissance de dix entière : l'échelle de la devise. */
function echelle(decimales: number): number {
  return 10 ** decimales;
}

/**
 * Le treillis d'un texte : toutes ses lectures admissibles.
 *
 * Le texte se lit par le lecteur unique du dépôt (`@malica/socle/montant-imprime`,
 * qui en écrit les règles, et que la normalisation du scan appelle aussi) ;
 * rien ne se relit ici. Rendu vide quand le texte n'est pas un montant, ou
 * quand la devise ne sait pas le représenter (« 12,3456 » en dinars) : une
 * lecture absente vaut mieux qu'une lecture arrondie.
 *
 * ======================================================= LA POLITIQUE DU PLAN
 *
 * Toutes les lectures deviennent des hypothèses, que l'arithmétique de la
 * facture départage (`resoudreFacture`). Une seule exception, et elle tient à
 * la source des jetons, pas au texte : un montant en chiffres arabes ou
 * persans n'est lu que d'un lecteur qui les rend fidèlement
 * (`litLesChiffresOrientaux`). Le modèle de vision les rend INVERSÉS — mesuré
 * le 18 octobre 2026 sur « ١٢ » rendu « ٢١ » — et une lecture inversée d'un
 * montant est pire que pas de lecture (`factures.banc-amputation.test.ts`).
 * Sans lecteur nommé, rien ne les lit.
 */
export function treillisMontant(texte: string, devise: DeviseLue, lecteur?: Lecteur): Hypothese[] {
  const lu = lireUnMontantImprime(texte, devise);
  if (lu.chiffresArabes && !litLesChiffresOrientaux(lecteur)) return [];
  return lu.lectures.map((l) => ({ millimes: l.mineur, lecture: l.forme }));
}

/**
 * Le lecteur rend-il les chiffres arabes orientaux tels qu'imprimés ?
 *
 * La couche de texte d'un PDF, oui : elle porte les codes des chiffres
 * eux-mêmes, dans l'ordre où ils s'écrivent, sans rien reconnaître (jeu
 * synthétique, 31 octobre 2026 : cas 044, 048, 052, refusés alors que la
 * couche les portait exacts). Le modèle de vision, non (mesuré, plus haut).
 * PaddleOCR n'a pas été mesuré sur ces chiffres : il n'est pas cru. Ni un plan
 * fourni, dont on ne sait pas qui l'a relevé.
 *
 * Les séparateurs « ٫ » et « ٬ » ne sont pas en cause : le lecteur unique
 * (`montant-imprime`) en rend toutes les lectures, et l'arithmétique de la
 * facture tranche, comme pour « , » et « . ».
 */
function litLesChiffresOrientaux(lecteur: Lecteur | undefined): boolean {
  return lecteur === "pdf-text";
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

/**
 * Une équation que les valeurs RETENUES ne vérifient pas.
 *
 * ================================================================= POURQUOI
 *
 * Le 4 octobre 2026, une facture est sortie avec HT 3,000, TVA 573,800 et TTC
 * 3,000 — trois montants coupés par l'espace des milliers, donc trois lectures
 * UNIQUES, donc aucun doute, donc le solveur sortait avant même de regarder
 * ses équations. Elles étaient posées ; personne ne les lisait.
 *
 * Un montant tronqué n'est pas un montant ambigu : c'est pour cela qu'aucun
 * drapeau ne le voyait. Celui-ci ne juge pas un champ, il juge la facture.
 */
interface Violation {
  /** Le champ qui porte le total de l'équation. */
  champ: string;
  /**
   * Somme ou produit. Sans elle, le drapeau disait « quantité + prix unitaire
   * donne 48.994 » sur une MULTIPLICATION — relevé le 7 octobre 2026 sur une
   * vraie facture. Un message faux sur l'opération fait douter du reste.
   */
  operation: "somme" | "produit";
  /** Les champs dont il devrait être la somme, ou le produit. */
  parties: readonly string[];
  /** Ce que l'équation donne, en unités mineures. */
  calcule: number;
  /** Ce que la pièce imprime, en unités mineures. */
  lu: number;
}

export interface Resolution {
  valeurs: Map<string, ValeurResolue>;
  /** Les champs qu'aucune équation ne départage : l'écran les demande. */
  ambigus: string[];
  /**
   * Les équations que les valeurs retenues violent. Vide : la facture boucle.
   *
   * Jugées sur ce qui est RETENU, jamais sur les hypothèses écartées — sans
   * quoi tout champ ambigu produirait une violation, puisque l'une au moins de
   * ses lectures est fausse. Un champ resté ambigu n'en produit donc aucune :
   * rien n'a été retenu pour lui, rien ne lui est reproché.
   */
  violations: Violation[];
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
   * Tolérance d'arrondi sur un produit, en unités mineures.
   *
   * Ce n'est pas un réglage, c'est la borne de l'arrondi : 2,5 × 7,549 fait
   * 18,8725, et le papier porte 18,873 ou 18,872 selon le sens choisi par celui
   * qui l'a imprimé. Une unité, jamais deux — d'où le défaut, qui ne dépend
   * d'aucune juridiction.
   *
   * Elle reste un paramètre pour le jour où le banc montrera qu'une somme de n
   * lignes déjà arrondies en demande n : cette valeur-là dépendra de la forme
   * de la facture, donc de l'appelant, jamais de ce module.
   */
  tolerance?: number;
  /**
   * Plafond d'affectations énumérées. Au-delà, le solveur rend la main : tout
   * reste ambigu et l'écran demande. Une pièce illisible doit coûter une
   * question, jamais une valeur devinée ni une minute de calcul.
   */
  combinaisonsMax?: number;
}

/**
 * Évalue une équation, et dit du même coup ce qu'elle donne.
 *
 * Une seule fonction rend le verdict ET la mesure, délibérément : quand le
 * solveur jugeait d'un côté et qu'on rapportait de l'autre, les deux pouvaient
 * se contredire. Ici le drapeau montré à la personne porte exactement les
 * nombres sur lesquels la décision a été prise.
 *
 * Rend `null` quand un terme manque : une facture incomplète n'est pas une
 * facture incohérente, et la distinction est tout l'intérêt du drapeau.
 */
function evaluer(
  c: Contrainte,
  lu: (champ: string) => number | undefined,
  decimales: number,
  tolerance: number,
): { ok: boolean; violation: Violation } | null {
  if (c.type === "somme") {
    const total = lu(c.total);
    const parties = c.parties.map(lu);
    if (total === undefined || parties.some((p) => p === undefined)) return null;
    const calcule = parties.reduce((s, p) => s! + p!, 0)!;
    return {
      ok: calcule === total,
      violation: { champ: c.total, operation: "somme", parties: c.parties, calcule, lu: total },
    };
  }
  const total = lu(c.total);
  const quantite = lu(c.quantite);
  const unitaire = lu(c.unitaire);
  if (total === undefined || quantite === undefined || unitaire === undefined) return null;
  // Tout reste entier : quantité × unitaire se compare au total remis à
  // l'échelle, jamais à un flottant. Un produit de montants n'a pas de virgule
  // tant qu'on ne le divise pas — alors on ne le divise pas.
  const facteur = echelle(decimales);
  return {
    ok: Math.abs(quantite * unitaire - total * facteur) <= tolerance * facteur,
    violation: {
      champ: c.total,
      operation: "produit",
      parties: [c.quantite, c.unitaire],
      // Le quotient n'est arrondi QUE pour être montré : la comparaison
      // ci-dessus, elle, reste entière.
      calcule: Math.round((quantite * unitaire) / facteur),
      lu: total,
    },
  };
}

function verifie(
  c: Contrainte,
  lu: (champ: string) => number | undefined,
  decimales: number,
  tolerance: number,
): boolean | null {
  return evaluer(c, lu, decimales, tolerance)?.ok ?? null;
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

  /**
   * Les équations, mesurées sur ce qui est retenu.
   *
   * Appelée à CHAQUE sortie de cette fonction, et c'est le point : la version
   * d'avant le 5 octobre avait trois sorties, dont deux ne regardaient aucune
   * contrainte. Une seule suffisait pour qu'une facture fausse passe en
   * silence — et c'est par celle-là que la facture du 4 octobre est passée.
   */
  const violations = (): Violation[] => {
    const retenu = (champ: string): number | undefined => valeurs.get(champ)?.millimes;
    return contraintes
      .map((c) => evaluer(c, retenu, decimales, tolerance))
      .filter((e): e is NonNullable<typeof e> => e !== null && !e.ok)
      .map((e) => e.violation);
  };

  const lisibles = champs.filter((c) => c.hypotheses.length > 0);
  const certains = lisibles.filter((c) => c.hypotheses.length === 1);
  const doutes = lisibles.filter((c) => c.hypotheses.length > 1);

  const fixes = new Map<string, number>();
  for (const c of certains) {
    fixes.set(c.champ, c.hypotheses[0]!.millimes);
    valeurs.set(c.champ, { millimes: c.hypotheses[0]!.millimes, decidePar: "lecture" });
  }

  if (doutes.length === 0) return { valeurs, ambigus, violations: violations(), marge: 0 };

  const combinaisons = doutes.reduce((n, c) => n * c.hypotheses.length, 1);
  if (combinaisons > combinaisonsMax) {
    return { valeurs, ambigus: doutes.map((c) => c.champ), violations: violations(), marge: 0 };
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

  return { valeurs, ambigus, violations: violations(), marge };
}
