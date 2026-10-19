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
  return process.env["QWEN_OCR_MODEL"] ?? MODELE_OCR_PAR_DEFAUT;
}

/**
 * Celui qui désigne les champs : il ne voit jamais la pièce, seulement les tokens.
 *
 * ========================================== POURQUOI LE CHAT, ET PLUS LE RAISONNEUR
 *
 * Mesuré le 5 octobre 2026 sur le journal de production, puis au banc
 * (`tests/real/designation-cout.ts`, trois passages par modèle) :
 *
 *                      champs justes  valeurs fausses  sortie   coût/appel
 *   deepseek-reasoner      27/28            0          3 792      0,0097 $
 *   deepseek-chat        23 à 25/28         1          414        0,0020 $
 *
 * En production, le raisonneur rendait 9 022 jetons de raisonnement et prenait
 * 36 472 ms — pour produire une vingtaine de `page/ordinal`. Trente-six
 * secondes d'attente pour quelqu'un qui tient son téléphone, et quatre fois le
 * budget visé.
 *
 * Le chat est 4,7 fois moins cher et rend neuf fois moins de jetons. Il est
 * aussi moins précis, et sa seule VALEUR fausse était un `document_kind` lu
 * « vente » sur un achat — l'erreur la plus grave possible, qu'aucune
 * arithmétique ne rattrape.
 *
 * On ne bascule donc PAS pour économiser : on bascule parce que cette erreur
 * est désormais attrapée. Le contrôle `sens_de_la_piece` (`scan/controles.ts`)
 * confronte le sens lu au NOM de l'émetteur, et refuse la contradiction. Il a
 * été écrit avant cette bascule, exprès.
 *
 * Reste à mesurer sur les onze factures du prototype, puis à comparer à
 * `qwen3.8-flash`, qui voit l'image — il entrera quand son tarif sera en base
 * (R8) et que le client saura l'appeler.
 */
export const ROLE_DESIGNATION: DeepSeekRole = "chat";

/*
 * Le modèle est DÉRIVÉ du rôle, et non écrit à côté de lui.
 *
 * L'appel de `vision.ts` forçait `role: "reasoner"` en dur pendant que cette
 * constante nommait le modèle. Changer l'un sans l'autre désaccordait le couple,
 * et `agents_run_log` ne trouve alors AUCUN tarif pour (modèle, rôle) : l'appel
 * s'exécute, et son coût n'est pas journalisé. C'est exactement par là que le
 * coût de l'œil a disparu du journal (D47).
 *
 * Dériver rend la désynchronisation impossible, plutôt qu'interdite.
 */
export const MODELE_DESIGNATION = DEEPSEEK_MODELS[ROLE_DESIGNATION];

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
