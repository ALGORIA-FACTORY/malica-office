/**
 * La liste des pièces, lue d'un trait, dit la même chose que pièce par pièce
 * (migration 20261208090200, 7 novembre 2026).
 *
 * La liste ne rappelle plus `app.circuit_de_la_piece` et
 * `app.suivi_de_la_piece` que pour les pièces qui ont une histoire ; pour les
 * autres, elle déduit circuit et suivi de la ligne. Cette épreuve est
 * l'ORACLE : pour chaque pièce, sous l'identité de chacun — propriétaire,
 * dirigeant, siège, comptable — elle relit les deux fonctions et compare,
 * champ par champ, à ce que rend la liste.
 *
 * Elle joue d'abord tous les chemins (privée, en société, lue, envoyée par le
 * siège, vue, retournée, précisée, prise en charge), puis balaie aussi toutes
 * les pièces que la base de test porte à ce moment.
 *
 *   node --experimental-strip-types --test src/la-liste-des-pieces-dit-la-meme-chose.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PieceLue } from "@malica/socle/ports/repositories";

import {
  BASE_CONFIGUREE,
  monterUneSociete,
  type Personne,
  type SocieteDEssai,
} from "./circuit-d-essai.ts";
import pg from "pg";

import { fermerLePool } from "./db.ts";
import { COLONNES_DU_CIRCUIT, COLONNES_DU_SUIVI, versCircuit, versSuivi } from "./depots/suivi.ts";

/** Ce que les fonctions d'origine disent de chaque pièce que `qui` voit. */
const ORACLE = `
  select p.id,
         app.piece_accompagne(p.id) as accompagne,
         app.piece_jointe(p.id) as jointe,
         app.emetteur_dit(p.id) as emetteur_dit,
         ${COLONNES_DU_SUIVI},
         ${COLONNES_DU_CIRCUIT}
    from pieces_v p
    left join lateral (
      select * from app.suivi_de_la_piece(p.id) where p.vis = 'partage'
    ) s on true
    left join lateral app.circuit_de_la_piece(p.id) c on true
   where p.tenant_id = any($1::uuid[]) and p.remplacee_par is null and p.archivee_le is null`;

/*
 * LES DEUX LECTURES DANS LE MÊME INSTANTANÉ.
 *
 * Sous la lecture par défaut (`read committed`), chaque requête voit la base
 * à son propre instant : une autre épreuve qui envoie une pièce ENTRE la
 * liste et l'oracle les faisait diverger (CI de #284, 8 novembre 2026 :
 * « envoyée » d'un côté, pas de l'autre — la même pièce, deux instants).
 * `repeatable read` les fige au même instant ; le reste est l'identité du
 * serveur, comme `sousIdentiteDuServeur`.
 */
const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"], max: 2 });

async function auMemeInstant<T>(utilisateur: string, travail: (db: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [utilisateur]);
    await client.query("select set_config('malica.origine', 'serveur', true)");
    const r = await travail(client);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function comparer(utilisateur: string, societes: string[], etiquette: string) {
  const { liste, oracle } = await auMemeInstant(utilisateur, async (db) => {
    const { executerRpc } = await import("./rpc.ts");
    const lots = (await executerRpc(db, {
      depot: "capture",
      methode: "listAvecLectureDesSocietes",
      args: [societes],
    })) as Array<{ tenantId: string; pieces: PieceLue[] }>;
    const { rows } = await db.query(ORACLE, [societes]);
    return { liste: lots.flatMap((l) => l.pieces), oracle: rows as Record<string, unknown>[] };
  });
  const parId = new Map(liste.map((p) => [p.id, p]));
  assert.equal(liste.length, oracle.length, `${etiquette} : le même nombre de pièces`);
  for (const r of oracle) {
    const p = parId.get(r["id"] as string);
    assert.ok(p, `${etiquette} : la pièce ${r["id"] as string} est dans la liste`);
    assert.deepEqual(p.circuit, versCircuit(r), `${etiquette} : circuit de ${p.id}`);
    assert.deepEqual(p.suivi, versSuivi(r), `${etiquette} : suivi de ${p.id}`);
    assert.equal(p.accompagne, Boolean(r["accompagne"]), `${etiquette} : accompagne ${p.id}`);
    assert.equal(p.jointe, Boolean(r["jointe"]), `${etiquette} : jointe ${p.id}`);
    if (r["emetteur_dit"] != null) assert.equal(p.emetteur, r["emetteur_dit"]);
  }
  return oracle.length;
}

describe("la liste des pièces dit la même chose, d'un trait", { skip: !BASE_CONFIGUREE }, () => {
  let s: SocieteDEssai;

  before(async () => {
    s = await monterUneSociete(`oracle-${Date.now()}`);

    // Privée, en société, lue.
    await s.deposer("amel", "personnel");
    await s.deposer("bilel", "entite");
    const lue = await s.deposer("amel", "entite");
    await s.lire("amel", lue);

    // Le siège envoie au propriétaire, qui voit puis retourne.
    const retournee = await s.deposer("sami", "entite");
    await s.lire("sami", retournee);
    await s.fait("sami", "collab.envoyer", retournee);
    await s.fait("amel", "supervision.voir", retournee);
    await s.fait("amel", "supervision.retourner", {
      pieceId: retournee,
      motifId: s.motifs["hors_exercice"],
      note: "La date ?",
    });
    // Le siège précise : « corrigée par l'auteur ».
    await s.fait("sami", "capture.preciser", retournee, "document_date", "2026-10-01");

    // Envoyée jusqu'au cabinet, vue, retournée, puis prise en charge.
    const auCabinet = await s.deposer("sami", "entite");
    await s.lire("sami", auCabinet);
    await s.fait("sami", "collab.envoyer", auCabinet);
    await s.fait("amel", "supervision.voir", auCabinet);
    await s.fait("amel", "collab.envoyer", auCabinet);
    await s.fait("expert", "supervision.voir", auCabinet);

    const priseEnCharge = await s.deposer("amel", "entite");
    await s.lire("amel", priseEnCharge);
    await s.fait("amel", "collab.envoyer", priseEnCharge);
    await s.priseEnCharge(priseEnCharge);
  });

  after(async () => {
    try {
      await s?.fermer();
    } finally {
      await pool.end();
      await fermerLePool();
    }
  });

  for (const qui of ["amel", "bilel", "sami", "sonia", "expert"] as Personne[]) {
    it(`sous l'identité de ${qui}, chaque pièce dit la même chose`, async () => {
      const n = await comparer(s.gens[qui].id, [s.pme], qui);
      if (qui !== "sonia") assert.ok(n > 0, `${qui} voit des pièces`);
    });
  }

  it("et sur toutes les pièces que la base porte, pour chaque membre", async () => {
    const { rows } = await s.admin.query<{ user_id: string; societes: string[] }>(
      `select m.user_id, array_agg(m.tenant_id::text) as societes
         from identity.memberships m
         join identity.organizations o on o.id = m.tenant_id
        where o.archived_at is null
        group by m.user_id
       -- L'oracle est l'ancienne lecture, pièce par pièce : lente par
       -- construction. Le banc des 10 000 pièces n'est pas pour elle.
       having (select count(*) from capture.pieces p
                where p.tenant_id = any(array_agg(m.tenant_id))) <= 1500
        order by max(m.created_at) desc
        limit 40`,
    );
    let total = 0;
    for (const r of rows) total += await comparer(r.user_id, r.societes, `membre ${r.user_id}`);
    assert.ok(total > 0);
  });
});
