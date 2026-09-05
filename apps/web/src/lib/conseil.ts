/**
 * Le conseil, côté texte : ce que le client lit quand le cabinet a décidé.
 *
 * ============================================================== POURQUOI ICI
 *
 * Le cabinet décide dans SA langue ; le client lit dans LA SIENNE. Le message
 * qui part dans le fil du client se compose donc à partir de la langue rangée
 * sur l'arbitrage, pas de celle de l'écran qui décide. Ce module est pur —
 * pas de React, pas d'appel — pour que l'écran du cabinet et le serveur qui
 * répond aux clients composent exactement les mêmes phrases.
 */
import { MESSAGES, type Locale, type MessageKey } from "@/i18n/messages";
import type {
  Arbitrage,
  DecisionArbitrage,
  SourceCitee,
} from "@/verticals/regalica-office/ports/repositories";

const LANGUE_PAR_DEFAUT: Locale = "fr";

function localeDe(langue: string | null | undefined): Locale {
  return langue === "en" || langue === "ar" ? langue : LANGUE_PAR_DEFAUT;
}

/**
 * Le même rendu que `t()`, hors React : la variante plurielle si `count` est
 * un nombre, puis les variables. Sert là où aucun composant ne tourne — un
 * serveur qui range un message, un écran qui écrit pour quelqu'un d'autre.
 */
export function texte(
  langue: string | null | undefined,
  cle: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const locale = localeDe(langue);
  const dict = MESSAGES[locale];
  let brut: string = dict[cle] ?? MESSAGES[LANGUE_PAR_DEFAUT][cle] ?? cle;
  const n = vars?.["count"];
  if (typeof n === "number") {
    for (const forme of [new Intl.PluralRules(locale).select(n), "other"]) {
      const variante = `${cle}#${forme}` as MessageKey;
      const trouvee = dict[variante] ?? MESSAGES[LANGUE_PAR_DEFAUT][variante];
      if (trouvee !== undefined) {
        brut = trouvee;
        break;
      }
    }
  }
  if (!vars) return brut;
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), brut);
}

/** « code de la TVA art. 9 » — le nom du corpus quand on le connaît, son code sinon. */
export function nomDeLaSource(
  source: SourceCitee,
  noms: Record<string, string>,
  langue: string | null | undefined,
): string {
  const corpus = noms[source.corpus] ?? source.corpus;
  return `${corpus} ${texte(langue, "cab.conseil.corpus.article", { numero: source.numero })}`;
}

/**
 * Ce que le client lira dans son fil après la décision du cabinet.
 *
 *   approuvee — la réponse de Regalica, ses sources, et la mention que le
 *               comptable l'a relue. Rien ne part si elle était déjà envoyée.
 *   corrigee  — la réponse du cabinet, précédée de qui parle, suivie de
 *               l'article invoqué s'il y en a un.
 *   ecartee   — une phrase : le comptable préfère en parler de vive voix.
 *
 * `null` dit qu'aucun message n'a à partir.
 */
export function messagePourLeClient(
  arbitrage: Arbitrage,
  decision: DecisionArbitrage,
  reponse: string | null,
  article: string | null,
  noms: Record<string, string>,
): string | null {
  const langue = arbitrage.langue;
  const dejaEnvoyee = arbitrage.statut === "repondue";

  if (decision === "approuvee") {
    if (dejaEnvoyee) return null;
    const lignes = [arbitrage.reponseProposee.trim()];
    if (arbitrage.sources.length > 0) {
      lignes.push(
        texte(langue, "pme.conseil.sources", {
          liste: arbitrage.sources.map((s) => nomDeLaSource(s, noms, langue)).join(" · "),
        }),
      );
    }
    lignes.push(texte(langue, "pme.conseil.relu"));
    return lignes.join("\n\n");
  }

  if (decision === "corrigee") {
    const propre = (reponse ?? "").trim();
    if (!propre) return null;
    const lignes = [
      texte(langue, dejaEnvoyee ? "pme.conseil.correction" : "pme.conseil.duCabinet"),
      propre,
    ];
    const fondement = (article ?? "").trim();
    if (fondement) lignes.push(texte(langue, "pme.conseil.articleInvoque", { article: fondement }));
    return lignes.join("\n\n");
  }

  return texte(langue, "pme.conseil.ecartee");
}

/** Une certitude 0..1, en entier de pourcentage — jamais une décimale à l'écran. */
export function certitudeEnPourcent(certitude: number): number {
  return Math.round(Math.min(Math.max(certitude, 0), 1) * 100);
}
