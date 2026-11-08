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

import { VERSION_DU_LANGAGE } from "../fabrique/recette.ts";

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
  /*
   * Une variable POSÉE MAIS VIDE vaut une variable absente. `compose.yml`
   * transmet `QWEN_OCR_MODEL: ${QWEN_OCR_MODEL}` : non renseignée sur le
   * serveur, elle arrivait en chaîne vide, et `??` la gardait — chaque relevé
   * partait avec un modèle vide, recevait un 400, et la lecture échouait sans
   * jamais être rejouée (audit du 24 octobre 2026).
   */
  return process.env["QWEN_OCR_MODEL"]?.trim() || MODELE_OCR_PAR_DEFAUT;
}

/*
 * ==================================== CELUI QUI DÉSIGNE N'EST PLUS NOMMÉ ICI
 *
 * Jusqu'au 8 novembre 2026, `ROLE_DESIGNATION` (« chat ») et
 * `MODELE_DESIGNATION` (« deepseek-chat ») vivaient ici. La bascule du
 * 5 octobre — du raisonneur au chat, mesurée sur le journal de production
 * (27/28 champs justes et 36 s pour le raisonneur, 23 à 25/28 et 4,7 fois
 * moins cher pour le chat) — reste valable pour DeepSeek.
 *
 * Décision du dirigeant du 8 novembre 2026 : Claude désigne, DeepSeek prend
 * la main en cas de panne ou de budget épuisé, et les deux budgets épuisés on
 * s'arrête. Le modèle de chaque rang se RÈGLE depuis la tour
 * (`plateforme.reglages_designation`), parmi les modèles tarifés de
 * `agents.model_pricing` : R8 devient littérale pour la désignation — choisir
 * le modèle et savoir ce qu'il coûte sont la même lecture, et le millésime est
 * figé chez le fournisseur (un identifiant Claude est un instantané). Voir
 * `lecture/designation.ts`.
 */

/* ------------------------------------------- L'ORGANE QUI NE COÛTE RIEN -- */

/**
 * La recette déterministe — un organe de désignation comme un autre.
 *
 * ====================================================== POURQUOI UN « MODÈLE »
 *
 * Parce que `agents.model_pricing` cherche un tarif par le COUPLE
 * (modèle, rôle), et qu'un organe sans ligne de tarif NE SE JOURNALISE PAS,
 * en silence. Ce défaut a déjà coûté dix jours de mesures sur l'œil, puis est
 * revenu sous la forme du suffixe « +pdf-scan », puis une troisième fois sur
 * le rôle écrit en dur. Une recette qui désigne sans ligne de tarif referait
 * exactement cela — et c'est précisément le RECOURS AU MODÈLE que le plan de
 * la fabrique demande de mesurer : sans ces lignes, on ne saurait pas combien
 * de pièces ont cessé d'appeler DeepSeek.
 *
 * Le nom est la VERSION DU LANGAGE, et pas « recette » tout court : le jour
 * où `recette/2` interprétera autrement, les deux se distingueront au journal
 * au lieu de se mélanger. C'est le même raisonnement que le millésime figé de
 * l'œil.
 *
 * Le rôle lui est propre : une recette ne raisonne pas, ne discute pas et ne
 * voit pas la pièce. Le réutiliser l'un des trois autres ferait un couple
 * (modèle, rôle) qui mentirait sur ce qui a désigné.
 *
 * Le tarif est à ZÉRO et SOUVERAIN, comme PaddleOCR et `pdf-text` : une
 * interprétation déterministe ne consomme aucun jeton de modèle et ne sort
 * d'aucune machine. Ce que la ligne rend mesurable est le NOMBRE d'appels,
 * et c'est le chiffre qui dira si la fabrique tient sa promesse.
 */
/*
 * DÉRIVÉ, jamais recopié : `VERSION_DU_LANGAGE` est la seule déclaration de
 * ce nom, et `modeles.ts` existe précisément parce que trois copies d'une même
 * décision avaient fini par diverger.
 */
export const MODELE_RECETTE: string = VERSION_DU_LANGAGE;
export const ROLE_RECETTE = "recette";

/* ------------------------------------------- CELUI QUI FABRIQUE LA RECETTE -- */

/**
 * Le générateur de recettes — celui qui PROPOSE une structure.
 *
 * ================================================ POURQUOI LE RAISONNEUR, ICI
 *
 * La bascule du 5 octobre a fait passer la DÉSIGNATION du raisonneur au chat,
 * et pour une bonne raison : trente-six secondes d'attente pour quelqu'un qui
 * tient son téléphone. La génération n'a pas cette contrainte — elle arrive
 * une fois par format, hors de toute attente, et ce qu'elle produit sera
 * ensuite rejoué sur des milliers de pièces. On paie le raisonneur une fois
 * pour ne plus payer le chat ensuite, et c'est le seul endroit du produit où
 * ce calcul penche de ce côté.
 *
 * =========================================== POURQUOI UN RÔLE DE PLUS, ENCORE
 *
 * `agents.model_pricing` cherche un tarif par le COUPLE (modèle, rôle). Le
 * raisonneur a déjà sa ligne sous le rôle `reasoner` ; s'en servir ferait
 * tenir la génération et la désignation dans la même case du journal, alors
 * que le plan de la fabrique demande de mesurer le COÛT TOTAL par document
 * « génération, observation, évaluation et secours compris ». Deux dépenses
 * qu'on ne peut pas séparer sont deux dépenses qu'on ne sait pas attribuer.
 *
 * Les deux noms sortent d'UNE déclaration : `ROLE_DEEPSEEK_DE_GENERATION` dit
 * quel modèle appeler, `MODELE_GENERATION` en est DÉRIVÉ. Il n'y a donc pas
 * deux endroits où le couple pourrait se désaccorder, et c'est précisément
 * par un désaccord de ce genre que le coût de l'œil a disparu du journal.
 */
export const ROLE_DEEPSEEK_DE_GENERATION: DeepSeekRole = "reasoner";
export const MODELE_GENERATION = DEEPSEEK_MODELS[ROLE_DEEPSEEK_DE_GENERATION];
export const ROLE_GENERATION = "generateur";

/* ------------------------------------------- LE SUDOKU QUI DÉSIGNE SEUL -- */

/**
 * Le moteur Sudoku, quand il a tout prouvé et qu'aucun modèle n'est appelé
 * (« le Sudoku d'abord », décision du dirigeant du 8 novembre 2026).
 *
 * Même raison que la recette : `agents.model_pricing` cherche un tarif par le
 * COUPLE (modèle, rôle), et une désignation sans ligne de tarif ne se
 * journalise pas. Sans elle, le compteur de la tour (« pièces lues sans IA ce
 * mois ») ne compterait rien. Tarif à zéro, souverain : le moteur tourne chez
 * nous et ne consomme aucun jeton.
 */
export const MODELE_SUDOKU = "sudoku";
export const ROLE_SUDOKU = "sudoku";
