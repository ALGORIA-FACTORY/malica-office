/**
 * La file hors ligne de l'application — une seule, montée au premier appel.
 *
 * C'est ici que la file rencontre les ports : les deux pas de la capture, la
 * lecture demandée à Malica. Et c'est ici que le dépôt est choisi — IndexedDB
 * dans un navigateur, la mémoire là où il n'y en a pas. Le stockage de
 * l'appareil pour la coque, que rien n'évacue.
 */
import { estNatif } from "@/capabilities/coque";
import { office } from "@/verticals/malica-office/composition";

import { depotMemoire } from "./depot";
import { creerDepotFichiers } from "./depot-fichiers";
import { creerDepotIdb } from "./depot-idb";
import { creerVidage, type Vidage } from "./vidage";

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
          office().capture.enregistrer({
            tenantId: e.tenantId,
            entityId: e.entityId,
            source: e.source,
            vis: e.vis,
            idempotencyKey: e.cle,
            contentType: e.contentType,
            documentKind: e.documentKind ?? null,
            sourcePieceId: e.sourcePieceId ?? null,
          }),
        deposerOctets: (pieceId, octets, contentType) =>
          office().capture.deposerOctets(pieceId, octets, contentType),
        // Le numéro du travail durable n'est pas repris ici : la file hors
        // ligne lance et s'en va, et c'est l'écran qui suit la lecture.
        demanderLaLecture: async (pieceId) => {
          await office().malica.demanderLaLecture(pieceId);
        },
      },
      enLigne: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    });
  }
  return instance;
}
