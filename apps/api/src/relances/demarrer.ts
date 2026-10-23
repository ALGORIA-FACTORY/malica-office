/**
 * Le démarrage des relances, lancé par `server.ts` seul : les épreuves
 * appellent `tourDeRelances` directement, sans horloge ni base réelle.
 */
import { horsRlsAuthentificationSeule } from "../db.ts";

import { tourDeRelances } from "./travailleur.ts";

/** Toutes les heures, et une première fois une minute après le démarrage. */
const CADENCE_MS = 60 * 60 * 1000;
const PREMIER_TOUR_MS = 60 * 1000;

/** Lancé par `server.ts` : jamais par les épreuves, qui appellent `tourDeRelances`. */
export function demarrerLesRelances(env: Record<string, string | undefined> = process.env) {
  let annonceSansCle = false;
  const tour = async () => {
    try {
      const r = await tourDeRelances({ executer: horsRlsAuthentificationSeule, env });
      if (r.sansCle && !annonceSansCle) {
        console.warn("[relances] BREVO_API_KEY absente : les courriels décidés restent à remettre");
        annonceSansCle = true;
      }
      if (r.remis || r.echecs) console.log(`[relances] ${r.remis} remis, ${r.echecs} en échec`);
    } catch (e) {
      console.error("[relances] tour interrompu :", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(() => void tour(), PREMIER_TOUR_MS).unref();
  setInterval(() => void tour(), CADENCE_MS).unref();
}
