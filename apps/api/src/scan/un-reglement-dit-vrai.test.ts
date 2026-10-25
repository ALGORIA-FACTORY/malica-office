/**
 * Un règlement dit vrai — la base refuse le faux, quel que soit l'écran.
 *
 * Relevé sur le staging le 25 octobre 2026 : une facture payée deux fois,
 * un règlement à zéro, « pas encore payé » inscrit deux fois à côté d'un
 * chèque. Maquette validée par Wissem ; règles dans
 * `20261025160000_un_reglement_dit_vrai.sql`.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/scan/un-reglement-dit-vrai.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { matriculeDEssai } from "../matricule-d-essai.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

interface Ligne {
  id: string;
  moyenCode: string;
  montantMineur: number | null;
  payeLe: string | null;
  eteint: boolean;
}

describe("un règlement dit vrai", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `reglement-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let packId = "";
  const motifs: Record<string, string> = {};

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  /** Une pièce, lue avec ce TTC (ou sans total lu). */
  async function piece(cle: string, ttc: string | null) {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
      pageCount: 1,
    })) as { id: string };
    await admin((a) =>
      a.query(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload)
         values ($1, $2, 'extract.v1', $3::jsonb)`,
        [org, p.id, JSON.stringify({ totals: ttc === null ? {} : { ttc }, lines: [] })],
      ),
    );
    return p.id;
  }

  const regler = (
    pieceId: string,
    moyenCode: string,
    montantMineur: number | null,
    payeLe: string | null = "2026-10-20",
  ) =>
    rpc("capture", "enregistrerPaiement", {
      pieceId,
      packId,
      moyenCode,
      montantMineur,
      devise: "TND",
      payeLe,
    });

  const lignes = async (pieceId: string) =>
    (await rpc("capture", "paiementsDUnePiece", pieceId)) as Ligne[];
  const vivants = async (pieceId: string) => (await lignes(pieceId)).filter((l) => !l.eteint);

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ESSAI REGLEMENT SARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    packId = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      return rows[0]!.id;
    });
    for (const m of (await rpc("capture", "motifsDAnnulation", "fr")) as Array<{
      id: string;
      code: string;
    }>) {
      motifs[m.code] = m.id;
    }
  });

  after(async () => {
    await admin((p) =>
      p.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [org],
      ),
    );
    await fermerLePool();
  });

  it("payer deux fois la même facture est refusé", async () => {
    const id = await piece("deux-fois", "1969.610");
    await regler(id, "especes", 1_969_610);
    await assert.rejects(() => regler(id, "cheque", 1_969_610), /paiement\.depasse_le_total/);
    assert.equal((await vivants(id)).length, 1);
  });

  it("un acompte puis le solde passent, au millime", async () => {
    const id = await piece("acompte", "613.493");
    await regler(id, "especes", 100_000);
    await regler(id, "cheque", 513_493);
    await assert.rejects(() => regler(id, "especes", 1), /paiement\.depasse_le_total/);
  });

  it("un règlement à zéro est refusé", async () => {
    const id = await piece("zero", "100.000");
    await assert.rejects(() => regler(id, "carte_bancaire", 0), /paiement\.montant_positif/);
  });

  it("un règlement daté dans l'avenir est refusé", async () => {
    const id = await piece("avenir", "100.000");
    await assert.rejects(() => regler(id, "especes", 1000, "2099-01-01"), /paiement\.date_future/);
  });

  it("sans montant, le règlement prend ce qui reste dû ; sans TTC lu, il est refusé", async () => {
    const id = await piece("reste", "613.493");
    await regler(id, "especes", 100_000);
    await regler(id, "cheque", null);
    const v = await vivants(id);
    assert.deepEqual(
      v.map((l) => l.montantMineur),
      [100_000, 513_493],
    );
    const sansTotal = await piece("sans-total", null);
    await assert.rejects(() => regler(sansTotal, "especes", null), /paiement\.montant_requis/);
  });

  it("deux appuis donnent un seul règlement, même sans TTC lu", async () => {
    const id = await piece("double-appui", null);
    await regler(id, "especes", 50_000);
    await assert.rejects(() => regler(id, "especes", 50_000), /paiement\.en_double/);
  });

  it("« pas encore payé » : une fois, jamais à côté d'un règlement, éteint par le règlement", async () => {
    const id = await piece("non-paye", "1180.000");
    await regler(id, "non_paye", null, null);
    await assert.rejects(() => regler(id, "non_paye", null, null), /paiement\.deja_non_paye/);
    await regler(id, "virement", 1_180_000);
    const v = await vivants(id);
    assert.deepEqual(
      v.map((l) => l.moyenCode),
      ["virement"],
      "le règlement éteint « pas encore payé », par une annulation motivée",
    );
    await assert.rejects(() => regler(id, "non_paye", null, null), /paiement\.deja_regle/);
  });

  it("corriger d'un geste : l'ancien s'annule, le nouveau s'inscrit, jugé sans l'ancien", async () => {
    const id = await piece("corriger", "1969.610");
    await regler(id, "especes", 1_969_610);
    const [ancien] = await vivants(id);
    await rpc("capture", "corrigerPaiement", {
      paiementId: ancien!.id,
      motifId: motifs["moyen_errone"],
      moyenCode: "cheque",
      montantMineur: 1_969_610,
      payeLe: "2026-10-13",
      reference: "0012345",
    });
    const v = await vivants(id);
    assert.deepEqual(
      v.map((l) => [l.moyenCode, l.montantMineur]),
      [["cheque", 1_969_610]],
    );
  });

  it("une correction refusée ne laisse pas la pièce sans règlement", async () => {
    const id = await piece("corriger-refuse", "100.000");
    await regler(id, "especes", 100_000);
    const [ancien] = await vivants(id);
    await assert.rejects(
      () =>
        rpc("capture", "corrigerPaiement", {
          paiementId: ancien!.id,
          motifId: motifs["montant_errone"],
          moyenCode: "especes",
          montantMineur: 200_000,
          payeLe: "2026-10-13",
        }),
      /paiement\.depasse_le_total/,
    );
    assert.deepEqual(
      (await vivants(id)).map((l) => l.montantMineur),
      [100_000],
      "la transaction entière est défaite : l'ancien règlement vit toujours",
    );
  });

  it("les motifs proposés : ceux de la personne, jamais celui de la base", async () => {
    assert.ok(motifs["inscrit_en_double"] && motifs["date_erronee"] && motifs["pas_exact"]);
    assert.equal(motifs["regle_depuis"], undefined);
    assert.equal(motifs["autre"], undefined, "« Autre raison » n'enregistrait pas sa note");
  });
});
