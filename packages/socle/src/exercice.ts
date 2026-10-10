/**
 * L'exercice et le mois — des dates, sans horloge ni fuseau.
 */

/** Le dernier jour d'un mois « YYYY-MM ». */
export function finDuMois(periode: string): string {
  const [a, m] = periode.split("-").map(Number);
  const dernier = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return `${periode}-${String(dernier).padStart(2, "0")}`;
}

/**
 * Le premier jour de l'exercice qui contient `periode`, d'après la clôture
 * de la fiche fiscale (« MM-DD » ou « YYYY-MM-DD »). Sans clôture, l'année
 * civile : le 1er janvier de l'année de la période.
 *
 * L'exercice commence le lendemain de la clôture. Si ce lendemain, dans
 * l'année de la période, tombe APRÈS la période, l'exercice a commencé
 * l'année précédente.
 */
export function debutDExercice(cloture: string | null, periode: string): string {
  const annee = Number(periode.slice(0, 4));
  const md = cloture ? /(\d{2})-(\d{2})$/.exec(cloture) : null;
  if (!md) return `${annee}-01-01`;
  const lendemain = new Date(Date.UTC(annee, Number(md[1]) - 1, Number(md[2]) + 1));
  const debutCetteAnnee = lendemain.toISOString().slice(0, 10);
  if (debutCetteAnnee > `${periode}-01`) lendemain.setUTCFullYear(lendemain.getUTCFullYear() - 1);
  return lendemain.toISOString().slice(0, 10);
}

/*
 * ================================================== LES MOIS QU'UN ÉCRAN MONTRE
 *
 * 10 octobre 2026. Le commanditaire : « il faut que je voie tous les mois dans
 * mon UI », « tous les mois de l'année doivent tous apparaître dès janvier ».
 *
 * En le vérifiant, trois écrans proposaient de choisir un mois, et chacun
 * portait sa propre constante :
 *
 *     use-accueil.ts     FENETRE = 12         douze mois glissants
 *     pme.charges.tsx    HISTORY_MONTHS = 6
 *     pme.list.tsx       MOIS_VISIBLES = 4
 *
 * Douze, six, quatre. Trois nombres à trois endroits, qui ne se connaissent
 * pas, et dont aucun ne correspond à un objet du métier : un dossier se boucle
 * par EXERCICE. Le dirigeant qui cherchait mars le trouvait sur un écran et
 * pas sur les deux autres.
 *
 * La clôture vient de la fiche fiscale, pas d'ici (R4) : `debutDExercice` la
 * lit déjà, et un exercice décalé suit sans que ce code change (R5).
 */

/** Un mois, « AAAA-MM ». */
export type Mois = string;

export interface MoisDExercice {
  periode: Mois;
  /**
   * Vrai quand ce mois n'a pas encore eu lieu.
   *
   * Un mois à venir n'est pas un mois vide : en octobre, novembre fait partie
   * de l'exercice et n'a aucune donnée pour une raison qui n'est pas une
   * perte. Les afficher pareil ferait craindre un trou là où il n'y en a pas.
   */
  aVenir: boolean;
}

/** Le mois qui précède `periode` de `recul` mois. Un recul négatif avance. */
export function moisDecale(periode: Mois, recul: number): Mois {
  const [a, m] = periode.split("-").map(Number);
  return new Date(Date.UTC(a!, m! - 1 - recul, 1)).toISOString().slice(0, 7);
}

/**
 * Les douze mois de l'exercice qui CONTIENT `periode`, dans l'ordre.
 *
 * `aujourdHui` dit où s'arrête le passé. Il est explicite plutôt que lu de
 * l'horloge : une épreuve doit pouvoir se placer à n'importe quelle date, et
 * le Socle ne lit pas l'heure (R1).
 */
export function moisDeLExercice(
  cloture: string | null,
  periode: Mois,
  aujourdHui: Mois,
): MoisDExercice[] {
  const debut = debutDExercice(cloture, periode).slice(0, 7);
  return Array.from({ length: 12 }, (_, i) => {
    const p = moisDecale(debut, -i);
    return { periode: p, aVenir: p > aujourdHui };
  });
}

/**
 * Les `combien` derniers mois jusqu'à `periode` incluse, du plus ancien au
 * plus récent.
 *
 * C'est la fenêtre de CALCUL, et elle traverse le changement d'exercice —
 * EXPRÈS. L'accueil compare le mois courant au précédent et compte les mois de
 * progression consécutifs : couper la série au 1er janvier ferait perdre à
 * janvier son comparatif, son mois précédent étant décembre de l'exercice
 * d'avant, et remettrait la progression à zéro une fois par an, en silence.
 *
 * C'est la forme d'erreur que R4 nomme la pire : plausible, invisible, et
 * fausse. D'où deux fonctions et deux noms qui ne se confondent pas —
 * `moisDeLExercice` pour montrer, `moisGlissants` pour comparer.
 */
export function moisGlissants(periode: Mois, combien: number): Mois[] {
  return Array.from({ length: combien }, (_, i) => moisDecale(periode, combien - 1 - i));
}
