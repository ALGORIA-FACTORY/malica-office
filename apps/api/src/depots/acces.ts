/**
 * L'accès — qui je suis dans cette organisation, et ce que j'y peux.
 *
 * Le rôle vient de l'adhésion (identity.memberships), la plateforme de
 * app.platform_operators. Aucun des deux n'est décidé ici : la base répond,
 * l'écran l'affiche, et les lectures du cabinet filtrent sur la même règle
 * (`app.mandats_visibles`).
 */
import type { Droit, MonAcces } from "@malica/socle/ports/repositories";

import type { Requete } from "../db.ts";

export const acces = {
  async monAcces(db: Requete, tenantId: string): Promise<MonAcces> {
    const { rows } = await db.query<{
      r: { role: string | null; plateforme: boolean };
      droits: Droit[];
    }>(
      // Les droits viennent du référentiel (`ref.droits_des_roles`), par rôle
      // et type d'organisation, datés : l'écran ne déduit rien du rôle.
      `select public.mon_acces($1) as r, app.droits_dans($1) as droits`,
      [tenantId],
    );
    const r = rows[0]?.r;
    return {
      role: r?.role ?? null,
      plateforme: Boolean(r?.plateforme),
      droits: rows[0]?.droits ?? [],
    };
  },
};
