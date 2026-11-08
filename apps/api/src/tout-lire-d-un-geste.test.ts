/**
 * « Tout lire » d'un geste (planche 2, approuvée le 7 novembre 2026).
 *
 * `collab.markAllRead` passe par la même porte que `collab.markRead` —
 * `public.notification_marquer_lue` — pour une liste, en un appel. Chacun sa
 * lecture : celle du dirigeant ne lit pas pour le propriétaire. Une liste
 * mal formée ou démesurée est refusée.
 *
 *   node --experimental-strip-types --test src/tout-lire-d-un-geste.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool } from "./db.ts";

type Lue = { id: string; readAt: string | null };

describe("tout lire d'un geste", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;
  const ids: string[] = [];

  before(async () => {
    s = await monterUneSociete(`tout-lire-${Date.now()}`);
    const { rows } = await s.admin.query<{ id: string }>(
      `insert into collab.notifications (tenant_id, kind, payload)
       select $1, 'piece.retournee', jsonb_build_object('note', 'n° ' || g)
         from generate_series(1, 12) g
       returning id`,
      [s.pme],
    );
    ids.push(...rows.map((r) => r.id));
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await fermerLePool();
    }
  });

  const lesMiennes = async (qui: "amel" | "bilel") =>
    ((await s.fait(qui, "collab.notifications", [s.pme])) as Lue[]).filter((n) =>
      ids.includes(n.id),
    );

  it("douze alertes lues en un appel, pour celle qui lit seulement", async () => {
    assert.equal((await lesMiennes("amel")).filter((n) => n.readAt === null).length, 12);
    await s.fait("amel", "collab.markAllRead", ids.slice(0, 10));
    const amel = await lesMiennes("amel");
    assert.equal(amel.filter((n) => n.readAt !== null).length, 10);
    assert.equal(amel.filter((n) => n.readAt === null).length, 2);
    // Chacun sa lecture : le dirigeant n'a rien lu.
    assert.equal((await lesMiennes("bilel")).filter((n) => n.readAt === null).length, 12);
  });

  it("une liste vide ne fait rien ; une liste mal formée ou démesurée est refusée", async () => {
    await s.fait("amel", "collab.markAllRead", []);
    await assert.rejects(s.fait("amel", "collab.markAllRead", "pas-une-liste"));
    await assert.rejects(s.fait("amel", "collab.markAllRead", ["pas-un-uuid"]));
    await assert.rejects(
      s.fait(
        "amel",
        "collab.markAllRead",
        Array.from({ length: 501 }, () => ids[0]),
      ),
    );
  });
});
