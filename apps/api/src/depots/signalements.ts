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

import { z } from "zod";

import type { Requete } from "../db.ts";

const Saisie = z.object({
  /*
   * Qui parle : la personne, ou le programme.
   *
   * « plantage » vient de la frontière d'erreur, qui rapporte toute seule ce
   * qu'aucun humain n'aurait su dire — le fichier et la ligne. Son texte est
   * expurgé AVANT l'envoi (apps/web/src/lib/rapport-plantage.ts) ; le serveur
   * ne s'en remet pas à cela pour autant : il borne comme pour le reste.
   */
  origine: z.enum(["personne", "plantage"]).default("personne"),
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
     * La porte décide l'identifiant et l'instant, et les rend : seul
     * l'opérateur LIT un signalement, l'auteur ne le relirait pas.
     */
    const { rows } = await db.query<{ r: { id: string; cree_le: string } }>(
      `select public.signalement_deposer($1, $2, $3, $4, $5, $6, $7, $8) as r`,
      [
        s.tenantId ?? null,
        s.versionClient,
        s.appareil ?? null,
        s.ou ?? null,
        s.message,
        s.pile ?? null,
        s.pieceId ?? null,
        s.origine,
      ],
    );
    const r = rows[0]!.r;
    return { id: r.id, creeLe: new Date(r.cree_le).toISOString() };
  },
};
