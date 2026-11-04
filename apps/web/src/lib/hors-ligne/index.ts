/**
 * La file hors ligne de l'application — une seule, montée au premier appel.
 *
 * C'est ici que la file rencontre les ports : les deux pas de la capture, la
 * lecture demandée à Malica. Et c'est ici que le dépôt est choisi — IndexedDB
 * dans un navigateur, la mémoire là où il n'y en a pas. Le stockage de
 * l'appareil pour la coque, que rien n'évacue.
 */
import { estNatif } from "@/capabilities/coque";
import { signaleur } from "@/lib/parcours";
import { retenirLaTrace } from "@/lib/parcours/traces";
import { office } from "@/verticals/malica-office/composition";

import { depotMemoire } from "./depot";
import { creerDepotFichiers } from "./depot-fichiers";
import { creerDepotIdb } from "./depot-idb";
import { creerVidage, suiviDuPas, type Vidage } from "./vidage";

let instance: Vidage | null = null;

export function vidage(): Vidage {
  if (!instance) {
    instance = creerVidage({
      depot: estNatif()
        ? creerDepotFichiers()
        : typeof indexedDB === "undefined"
          ? depotMemoire()
          : creerDepotIdb(),
      ports: {
        enregistrer: (e) =>
          office().capture.enregistrer(
            {
              tenantId: e.tenantId,
              entityId: e.entityId,
              source: e.source,
              vis: e.vis,
              idempotencyKey: e.cle,
              contentType: e.contentType,
              documentKind: e.documentKind ?? null,
              sourcePieceId: e.sourcePieceId ?? null,
              paiementsAttestes: e.paiementsAttestes ?? null,
              remplace: e.remplace ?? null,
            },
            suiviDuPas(e, "enregistrer"),
          ),
        deposerOctets: (pieceId, octets, contentType, suivi) =>
          office().capture.deposerOctets(pieceId, octets, contentType, suivi),
        // Le numéro du travail durable n'est pas repris ici : la file hors
        // ligne lance et s'en va, et c'est l'écran qui suit la lecture.
        demanderLaLecture: async (pieceId, suivi) => {
          await office().malica.demanderLaLecture(pieceId, suivi);
        },
      },
      enLigne: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      parcours: {
        signaler: (etape) => signaleur().signaler(etape),
        retenir: retenirLaTrace,
      },
    });
  }
  return instance;
}
