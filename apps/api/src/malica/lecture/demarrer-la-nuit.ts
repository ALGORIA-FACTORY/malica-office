/**
 * Le démarrage de la passe de nuit, lancé par `server.ts` seul : les épreuves
 * appellent `tourDeNuit` directement, avec leur horloge.
 *
 * Un tic toutes les dix minutes. La base dit à chaque tic s'il y a quelque
 * chose à faire : la passe coupée par la tour, rien ne s'ouvre ; hors de la
 * fenêtre de chaque dossier, rien ne se relit. Un seul passage à la fois,
 * même si deux API tournent : le verrou consultatif de la base, tenu le
 * temps du passage (`sousVerrouDeSession`), et relâché avec sa connexion si
 * le processus meurt.
 */
import {
  horsRlsAuthentificationSeule,
  sousLeRelecteurDeNuit,
  sousVerrouDeSession,
} from "../../db.ts";

import { tourDeNuit } from "./passe-de-nuit.ts";

/** Toutes les dix minutes, et une première fois deux minutes après le démarrage. */
const CADENCE_MS = 10 * 60 * 1000;
const PREMIER_TOUR_MS = 2 * 60 * 1000;

/** Lancé par `server.ts` : jamais par les épreuves, qui appellent `tourDeNuit`. */
export function demarrerLaNuit() {
  const tic = async () => {
    try {
      const cle = await horsRlsAuthentificationSeule(async (db) => {
        const { rows } = await db.query<{ cle: string }>(
          "select fabrique.passe_de_nuit_verrou()::text as cle",
        );
        return rows[0]!.cle;
      });
      const bilan = await sousVerrouDeSession(cle, () =>
        tourDeNuit({
          executer: horsRlsAuthentificationSeule,
          avecService: (tenantId) => (travail) => sousLeRelecteurDeNuit(tenantId, travail),
          maintenant: () => new Date(),
        }),
      );
      if (bilan?.passage) {
        console.log(
          `[nuit] ${bilan.raison ?? "?"} — ${bilan.retenues} retenue(s), ${bilan.ecartees} ` +
            `écartée(s), ${bilan.abstentions} abstention(s), ${bilan.pannes} panne(s)`,
        );
      }
    } catch (e) {
      console.error("[nuit] passage interrompu :", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(() => void tic(), PREMIER_TOUR_MS).unref();
  setInterval(() => void tic(), CADENCE_MS).unref();
}
