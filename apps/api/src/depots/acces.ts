/**
 * L'accès — qui je suis dans ce cabinet, et ce que je vois.
 *
 * Le rôle vient de l'adhésion (identity.memberships), la plateforme de
 * app.platform_operators. Aucun des deux n'est décidé ici : la base répond,
 * l'écran l'affiche, et les lectures du cabinet filtrent sur la même règle
 * (`app.mandats_visibles`).
 */
import type { Requete } from "../db.ts";

export interface MonAcces {
  /** dirigeant | collaborateur | expert | assistant, ou rien si je ne suis pas membre. */
  role: string | null;
  /** Opérateur de plateforme : voit tout, et l'écran le dit. */
  plateforme: boolean;
}

export const acces = {
  async monAcces(db: Requete, tenantId: string): Promise<MonAcces> {
    const { rows } = await db.query<{ r: { role: string | null; plateforme: boolean } }>(
      `select public.mon_acces($1) as r`,
      [tenantId],
    );
    const r = rows[0]?.r;
    return { role: r?.role ?? null, plateforme: Boolean(r?.plateforme) };
  },
};
