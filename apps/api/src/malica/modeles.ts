/**
 * Quel modèle pour quel rôle — une seule déclaration.
 *
 * ====================================================== POURQUOI DES NOMS ICI
 *
 * R8 veut que le modèle vienne de la table qui le tarife. Deux raisons tiennent
 * en échec la version naïve de cette règle, et il vaut mieux les écrire que de
 * les redécouvrir :
 *
 * 1. LE MILLÉSIME EST UN VERROU DE REPRODUCTIBILITÉ. `qwen-vl-ocr-2025-11-20`,
 *    jamais `-latest` : une mise à jour silencieuse du modèle changerait le
 *    relevé sans qu'une ligne de code bouge, et une pièce relue ne donnerait
 *    plus ce qu'elle donnait à sa comptabilisation. Le nom DOIT être figé par
 *    le code, qui se relit et se date, pas par une ligne qu'on peut modifier
 *    sans laisser de trace.
 * 2. LE RÔLE EST UN CHOIX D'ARCHITECTURE. « Le raisonneur désigne, l'œil
 *    relève » n'est pas un paramètre d'exploitation : c'est la frontière R2,
 *    celle qui empêche le raisonneur de voir la pièce.
 *
 * ====================================================== CE QUE R8 EXIGE ALORS
 *
 * Non pas que le nom vive dans la table, mais que les deux soient D'ACCORD.
 * Un modèle que le code peut appeler sans ligne de tarif en vigueur s'exécute
 * sans coût ni latence journalisés : `agents_run_log` refuse d'écrire un coût
 * sans origine, et le plafond de `agents.budgets` ne peut pas mordre sur ce qui
 * n'est pas mesuré. C'est exactement ce qui arrive aujourd'hui à l'œil (D31).
 *
 * `modeles.test.ts` tient cet accord, et nomme l'écart quand il y en a un.
 *
 * ====================================================== UNE SEULE DÉCLARATION
 *
 * Ces noms vivaient en trois endroits : la table des rôles DeepSeek, une
 * constante `MODELE_DESIGNATION` qui répétait le même « deepseek-reasoner »,
 * et le repli de la configuration Qwen. Trois copies d'une même décision.
 */

/** Les modèles de la voix et du raisonnement, par rôle tarifé. */
export const DEEPSEEK_MODELS = {
  reasoner: "deepseek-reasoner",
  chat: "deepseek-chat",
} as const;

export type DeepSeekRole = keyof typeof DEEPSEEK_MODELS;

/**
 * L'œil. Le millésime est figé ; `QWEN_OCR_MODEL` le remplace pour éprouver un
 * autre relevé, jamais pour suivre une version mouvante.
 */
const MODELE_OCR_PAR_DEFAUT = "qwen-vl-ocr-2025-11-20";
export function modeleOcr(): string {
  return process.env["QWEN_OCR_MODEL"] ?? MODELE_OCR_PAR_DEFAUT;
}

/** Celui qui désigne les champs : il ne voit jamais la pièce, seulement les tokens. */
export const MODELE_DESIGNATION = DEEPSEEK_MODELS.reasoner;
