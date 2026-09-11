/**
 * Le modèle de la capture, éprouvé contre la vraie base (malica_test).
 *
 * Ce que ces tests tiennent, et pourquoi dès le modèle plutôt qu'après coup :
 *
 *   - L'EMPREINTE du fichier est unique par tenant. C'est ce qui rendra la
 *     détection du doublon possible : deux photos du même ticket, déposées à
 *     une semaine d'écart, ne doivent pas devenir deux charges. Une empreinte
 *     ajoutée plus tard ne verrait pas les doublons déjà en base.
 *
 *   - La CONFIANCE est portée PAR CHAMP. Un numéro lu proprement et une date
 *     illisible ne valent pas la même chose ; un indice global les moyenne, et
 *     l'écran ne sait plus lequel demander.
 *
 *   - Le CONTRÔLE garde un verdict et son motif, jamais un booléen : « non »
 *     sans « pourquoi » ne se corrige pas.
 *
 * Chaque test tourne dans une transaction annulée : rien ne reste en base.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { after, before, describe, it } from "node:test";

const ADMIN = process.env["DATABASE_URL_ADMIN"];

describe("le modèle de la capture", { skip: !ADMIN }, () => {
  let pool: pg.Pool;

  before(() => {
    pool = new pg.Pool({ connectionString: ADMIN });
  });
  after(async () => {
    await pool.end();
  });

  /** Exécute `corps` dans une transaction toujours annulée, et rend son erreur SQL éventuelle. */
  async function essayer(corps: (c: pg.PoolClient) => Promise<void>): Promise<string | null> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await corps(c);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  async function organisation(c: pg.PoolClient, nom: string): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [nom],
    );
    return rows[0]!.id;
  }

  async function piece(c: pg.PoolClient, tenant: string, sha256: string | null): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into capture.pieces (tenant_id, source, storage_path, idempotency_key, sha256, created_by)
       values ($1, 'photo', 'essai', $2, $3, $4) returning id`,
      [tenant, randomUUID(), sha256, randomUUID()],
    );
    return rows[0]!.id;
  }

  const EMPREINTE = "a".repeat(64);

  describe("l'empreinte du fichier", () => {
    it("refuse le même fichier deux fois dans un même dossier", async () => {
      const code = await essayer(async (c) => {
        const t = await organisation(c, "DOSSIER A");
        await piece(c, t, EMPREINTE);
        await piece(c, t, EMPREINTE);
      });
      assert.equal(code, "23505", "violation d'unicité attendue");
    });

    it("admet le même fichier dans deux dossiers différents", async () => {
      const code = await essayer(async (c) => {
        await piece(c, await organisation(c, "DOSSIER A"), EMPREINTE);
        await piece(c, await organisation(c, "DOSSIER B"), EMPREINTE);
      });
      assert.equal(code, null);
    });

    it("admet plusieurs pièces dont les octets ne sont pas encore arrivés", async () => {
      const code = await essayer(async (c) => {
        const t = await organisation(c, "DOSSIER A");
        await piece(c, t, null);
        await piece(c, t, null);
      });
      assert.equal(code, null);
    });

    it("refuse une empreinte qui n'est pas un SHA-256 hexadécimal", async () => {
      for (const faux of ["abc", "A".repeat(64), `${"a".repeat(63)}g`]) {
        const code = await essayer(async (c) => {
          await piece(c, await organisation(c, "DOSSIER A"), faux);
        });
        assert.equal(code, "23514", `empreinte refusée attendue pour « ${faux.slice(0, 10)}… »`);
      }
    });
  });

  describe("la confiance par champ", () => {
    async function extraction(c: pg.PoolClient, confiances: unknown): Promise<void> {
      const t = await organisation(c, "DOSSIER A");
      const p = await piece(c, t, null);
      await c.query(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload, confiance_par_champ)
         values ($1, $2, 'extract.v1', '{}'::jsonb, $3::jsonb)`,
        [t, p, JSON.stringify(confiances)],
      );
    }

    it("porte un indice par champ, entre 0 et 1", async () => {
      assert.equal(
        await essayer((c) => extraction(c, { "totals.ttc": 0.4, document_date: 1, issuer: 0 })),
        null,
      );
    });

    it("refuse un indice hors de [0, 1], ou qui n'est pas un nombre", async () => {
      for (const faux of [{ "totals.ttc": 1.5 }, { "totals.ttc": -0.1 }, { issuer: "haute" }]) {
        assert.equal(await essayer((c) => extraction(c, faux)), "23514", JSON.stringify(faux));
      }
    });

    it("refuse autre chose qu'un objet champ → indice", async () => {
      assert.equal(await essayer((c) => extraction(c, [0.5])), "23514");
    });

    it("vaut un objet vide quand la lecture n'en donne pas", async () => {
      const code = await essayer(async (c) => {
        const t = await organisation(c, "DOSSIER A");
        const p = await piece(c, t, null);
        const { rows } = await c.query<{ confiance_par_champ: unknown }>(
          `insert into capture.extractions (tenant_id, piece_id, contract, payload)
           values ($1, $2, 'extract.v1', '{}'::jsonb) returning confiance_par_champ`,
          [t, p],
        );
        assert.deepEqual(rows[0]!.confiance_par_champ, {});
      });
      assert.equal(code, null);
    });
  });

  describe("le contrôle de la pièce", () => {
    it("ne se réduit pas à un booléen : un verdict négatif exige son motif", async () => {
      const code = await essayer(async (c) => {
        const t = await organisation(c, "DOSSIER A");
        const p = await piece(c, t, null);
        const { rows } = await c.query<{ id: string }>(
          `select id from ref.jurisdiction_packs order by effective_from desc limit 1`,
        );
        await c.query(
          `insert into capture.conformite (tenant_id, piece_id, verdict, pack_version_id, decided_by)
           values ($1, $2, 'non_conforme', $3, $4)`,
          [t, p, rows[0]!.id, randomUUID()],
        );
      });
      assert.equal(code, "23514", "un « non » sans motif doit être refusé");
    });
  });
});
