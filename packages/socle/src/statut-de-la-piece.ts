/**
 * Les états où une pièce se précise encore : son type, sa date.
 *
 * Au-delà — proposée, supervisée, comptabilisée — elle est engagée et se
 * corrige par écriture. La base porte la même liste dans
 * `public.capture_precision_persist` et refuse d'elle-même ; cette liste-ci
 * sert à l'écran pour ne pas offrir un geste que la base refuserait.
 * `le-type-se-corrige-apres-lecture.test.ts` vérifie que les deux disent la
 * même chose.
 */
export const STATUTS_PRECISABLES: ReadonlySet<string> = new Set(["capturee", "lue", "retournee"]);
