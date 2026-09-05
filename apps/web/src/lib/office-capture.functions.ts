import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { registre } from "@/lib/capture/lectures-en-cours.server";
import { readPieceFlow, type ReadPieceResult } from "@/lib/capture/read-flow.server";
import { exigerSession } from "@/lib/session-middleware";

const UnePiece = z.object({ pieceId: z.string().uuid() });

/**
 * Lire une pièce — ou rejoindre la lecture qui tourne déjà pour elle.
 *
 * La requête du téléphone peut mourir en route ; la lecture, non. Un second
 * appel pour la même pièce ne relance rien : il attend le même résultat.
 * Voir `lectures-en-cours.server.ts`.
 */
export const readPiece = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => UnePiece.parse(data))
  .handler(async ({ data, context }) => {
    const depart = Date.now();
    const resultat = await registre<ReadPieceResult>().lireOuRejoindre(data.pieceId, () =>
      readPieceFlow(context.api, data.pieceId),
    );
    // La durée réelle d'une lecture, mesurée côté serveur : c'est elle qui
    // dit si la personne attend dix secondes ou quatre minutes. Atelier
    // seulement — en service, cette mesure appartient à la télémétrie.
    if (import.meta.env.DEV) {
      console.info(
        `[lecture] ${data.pieceId} terminée en ${Math.round((Date.now() - depart) / 1000)} s (${resultat.model})`,
      );
    }
    return resultat;
  });

/**
 * Une lecture est-elle en cours pour cette pièce ?
 *
 * L'écran le demande quand il revient — après un verrouillage, un
 * rechargement, une coupure — pour attendre le résultat au lieu d'annoncer
 * une panne ou de relancer une lecture.
 */
export const etatLecture = createServerFn({ method: "POST" })
  .middleware([exigerSession])
  .inputValidator((data: unknown) => UnePiece.parse(data))
  .handler(async ({ data }) => {
    const l = registre().etat(data.pieceId);
    return { enCours: l !== null, depuisMs: l ? Date.now() - l.depuis : null };
  });
