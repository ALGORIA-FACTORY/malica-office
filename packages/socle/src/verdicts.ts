/**
 * Le verdict d'une pièce : un CODE, et la phrase qui a été inscrite.
 *
 * ================================================================= POURQUOI
 *
 * 11 octobre 2026 : « corrige le hardcoding ».
 *
 * Le verdict voyage depuis le 24 août sous la forme d'une phrase française —
 * « à rejeter », « anomalie à signaler » — et l'écran de la PME la compare
 * ainsi :
 *
 *     verdictBloquant === "à rejeter" ? t("pme.bloque.rejet") : …
 *
 * Trois défauts dans cette ligne, et aucun ne se voit :
 *
 *   — un code écrit en français est un code quand même, et celui-là est
 *     comparé caractère par caractère, accent compris, dans un autre paquet
 *     que celui qui le produit ;
 *   — le jour où quelqu'un reformule « à rejeter » en « rejetée », l'écran
 *     tombe silencieusement sur sa phrase générique. Aucune épreuve ne le
 *     verrait : la comparaison compile, et le repli est légitime ;
 *   — la même phrase sert de donnée stockée et de valeur de branchement, donc
 *     on ne peut ni la traduire ni la reformuler sans casser l'écran.
 *
 * ======================================== POURQUOI LA PHRASE RESTE
 *
 * `capture.analyses` est en ajout seul (R7) : les verdicts déjà inscrits
 * portent ces phrases, et on ne réécrit pas l'histoire. La phrase reste donc
 * ce qui est STOCKÉ, et le code ce avec quoi on BRANCHE. La conversion vit
 * ici, dans un seul endroit, avec son épreuve — et non dans chaque écran qui
 * aurait besoin de reconnaître un verdict.
 *
 * Ce module est pur : des chaînes vers des chaînes. Il appartient au Socle
 * parce que les deux rives en ont besoin — l'API qui inscrit, l'écran qui lit.
 */

/** Ce qu'un verdict veut dire, pour un écran ou pour une règle. */
export type CodeVerdict = "comptabilisable" | "reserve" | "rapprocher" | "anomalie" | "rejet";

/**
 * Les phrases inscrites en base, et leur code.
 *
 * Cette table est la SEULE place où la forme française d'un verdict est
 * comparée. Une reformulation ajoute une entrée ; elle n'en retire aucune,
 * sous peine de rendre illisibles les analyses déjà inscrites.
 */
const CODE_DU_LIBELLE: Readonly<Record<string, CodeVerdict>> = {
  "à comptabiliser": "comptabilisable",
  "à comptabiliser avec réserve": "reserve",
  "à rapprocher": "rapprocher",
  "anomalie à signaler": "anomalie",
  "à rejeter": "rejet",
};

/**
 * Le code d'un verdict inscrit. `null` si la phrase est inconnue.
 *
 * `null` n'est pas un échec à masquer : il dit qu'une analyse porte un verdict
 * que ce code ne connaît pas, et l'appelant doit alors se comporter comme
 * devant un verdict bloquant — on ne comptabilise pas sur une phrase qu'on ne
 * comprend pas.
 */
export function codeDuVerdict(libelle: string | null | undefined): CodeVerdict | null {
  if (!libelle) return null;
  return CODE_DU_LIBELLE[libelle.trim().toLowerCase()] ?? null;
}

/**
 * Les deux verdicts qui laissent passer une écriture.
 *
 * « Avec réserve » comptabilise : la réserve se signale, elle ne bloque pas —
 * sinon une mention manquante sur une facture juste arrêterait la
 * comptabilité d'un dossier entier.
 */
export const VERDICTS_COMPTABILISABLES: ReadonlySet<CodeVerdict> = new Set([
  "comptabilisable",
  "reserve",
]);

/** Vrai si ce verdict autorise une écriture. Un verdict inconnu ne l'autorise pas. */
export function autoriseUneEcriture(libelle: string | null | undefined): boolean {
  const code = codeDuVerdict(libelle);
  return code !== null && VERDICTS_COMPTABILISABLES.has(code);
}
