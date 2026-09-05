/**
 * Les signalements — ce que la personne envoie volontairement depuis
 * l'application quand quelque chose n'a pas marché.
 *
 * Ni de la télémétrie, ni un journal de plantage : un geste, avec où, sur
 * quel appareil, quelle version. Le journal d'atelier reste l'affaire du
 * développement ; ceci est ce que le pilote lit chaque semaine.
 *
 * Aucune donnée de pièce ne passe ici : pas d'image, pas de montant, pas de
 * token relevé. Le message est celui de la personne, et il est borné.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { Requete } from "../db.ts";

const Saisie = z.object({
  tenantId: z.string().uuid().nullish(),
  versionClient: z.string().min(1).max(120),
  appareil: z.string().max(300).nullish(),
  ou: z.string().max(200).nullish(),
  message: z.string().trim().min(1).max(2000),
  pile: z.string().max(4000).nullish(),
  pieceId: z.string().uuid().nullish(),
});

export const signalements = {
  async deposer(db: Requete, saisie: unknown): Promise<{ id: string; creeLe: string }> {
    const s = Saisie.parse(saisie);
    /*
     * Pas de `returning` : PostgreSQL soumet les lignes rendues à la politique
     * de LECTURE, et seul l'opérateur lit ici. L'auteur recevrait un refus
     * pour un signalement pourtant écrit. L'identifiant et l'instant sont
     * donc décidés avant l'insertion, et rendus tels quels.
     */
    const id = randomUUID();
    const creeLe = new Date();
    await db.query(
      `insert into app.signalements
         (id, cree_le, tenant_id, version_client, appareil, ou, message, pile, piece_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        creeLe,
        s.tenantId ?? null,
        s.versionClient,
        s.appareil ?? null,
        s.ou ?? null,
        s.message,
        s.pile ?? null,
        s.pieceId ?? null,
      ],
    );
    return { id, creeLe: creeLe.toISOString() };
  },
};
