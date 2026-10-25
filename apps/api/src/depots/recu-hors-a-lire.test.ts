/**
 * Un reçu généré n'est jamais « à lire » : la liste le sait, comme la lecture.
 *
 * 25 octobre 2026, Wissem : deux « Reçus de dépense » attendaient dans
 * « À lire », et la lecture les refusait. La règle est désormais une
 * fonction (`app.piece_accompagne`) que le verdict et la liste partagent.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/depots/recu-hors-a-lire.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("un reçu n'est jamais à lire", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `recu-${Date.now()}`;
  let patron: Utilisateur;
  let facture = "";
  let recu = "";
  let pme = "";

  before(async () => {
    const u = await creerCompte(`pme-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(u);
    patron = u;
    await sousIdentiteDuServeur(patron.id, async (db) => {
      const { rows } = await db.query<{ org: string }>(
        `select public.create_organization($1, $2, $3, $4, $5, $6) as org`,
        [
          "pme",
          `ESSAI ${marque}`,
          "mandate",
          `${String(Date.now()).slice(-7)}R/A/M/000`,
          "TN",
          "TND",
        ],
      );
      pme = rows[0]!.org;
      const piece = async (cle: string, source: string | null) =>
        (
          await db.query<{ id: string }>(
            `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, source_piece_id)
             values ($1, 'pdf', 'entite', $2, $3, $4) returning id`,
            [pme, `essai/${cle}.pdf`, cle, source],
          )
        ).rows[0]!.id;
      facture = await piece(`${marque}-f`, null);
      recu = await piece(`${marque}-r`, facture);
    });
  });

  after(async () => {
    await fermerLePool();
  });

  it("la liste marque le reçu, pas la facture (le refus de lecture : une-piece-qui-accompagne-ne-se-lit-pas.test.ts)", async () => {
    await sousIdentiteDuServeur(patron.id, async (db) => {
      const liste = (await executerRpc(db, {
        depot: "capture",
        methode: "listAvecLecture",
        args: [pme],
      })) as Array<{ id: string; accompagne: boolean }>;
      assert.equal(liste.find((p) => p.id === recu)?.accompagne, true);
      assert.equal(liste.find((p) => p.id === facture)?.accompagne, false);
    });
  });
});
