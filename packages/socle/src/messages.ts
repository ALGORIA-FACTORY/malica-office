/**
 * Libellés d'interface FR / EN / AR.
 * Doctrine : aucune chaîne figée dans un composant. Les libellés métier
 * gouvernés (motifs, mentions, taux) viennent de `ref.labels` en base ;
 * ce fichier ne porte que le châssis d'interface.
 *
 * Un fichier par langue (messages-fr, messages-en, messages-ar) : l'écran ne
 * télécharge que celle de la personne. Ce module les réunit pour le serveur
 * et les essais.
 */

import { ar } from "./messages-ar.ts";
import { en } from "./messages-en.ts";
import { fr, type Dict } from "./messages-fr.ts";
import type { Locale } from "./messages-langues.ts";

export { LOCALES, LOCALE_NAMES, RTL_LOCALES, type Locale } from "./messages-langues.ts";
export type { Dict, MessageKey } from "./messages-fr.ts";

export const MESSAGES: Record<Locale, Dict> = { fr, en, ar };
