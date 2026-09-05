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
