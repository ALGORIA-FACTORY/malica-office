/**
 * 3B-2 — La lecture se journalise ; 3B-4/5 — la pièce se juge, côté serveur.
 *
 * Une lecture est persistée par le vrai chemin (`capture.persisterLecture`,
 * sous l'identité de l'appelant), avec un plan de jetons et des citations
 * construits ici — AUCUN modèle n'est appelé. Puis `capture.analyser` relit ce
 * que la base porte, normalise les montants depuis le texte IMPRIMÉ des jetons
 * cités, contrôle, rend le verdict et le pose dans `capture.analyses`.
 *
 *   node --experimental-strip-types --test src/scan/lecture-jugee.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { lecture } from "./lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("3B — la lecture journalisée, la pièce jugée", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `jugee-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let packId = "";

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

  /** Une pièce enregistrée, puis lue — sans modèle. */
  async function pieceLue(cle: string, l = lecture()) {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await rpc("capture", "persisterLecture", {
      pieceId: p.id,
      packId,
      tokens: l.tokens,
      contract: "extract.v1",
      extract: l.extract,
      citations: l.citations,
      flags: [],
      articles: [],
      documentKind: "facture_achat",
      documentDate: "2026-09-10",
      mode: "pdf-text",
      confianceParChamp: { "totals.ttc": 0.95, "references.numero": 0.95 },
    });
    return p.id;
  }

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SARL', 'autonome',
                                           '1856324K/A/M/000', 'TN', 'TND') as id`,
      );
      return rows[0]!.id;
    });
    packId = await admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN' order by effective_from desc limit 1`,
      );
      return rows[0]!.id;
    });
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

  it("la lecture garde son mode et sa confiance par champ, et s'écrit dans l'audit", async () => {
    const piece = await pieceLue("journal", lecture({ numero: "F-JOURNAL" }));
    const lu = await admin(async (p) => {
      const { rows } = await p.query<{
        mode_lecture: string;
        confiance_par_champ: Record<string, number>;
        id: string;
      }>(
        `select id, mode_lecture, confiance_par_champ from capture.extractions where piece_id = $1`,
        [piece],
      );
      const { rows: audit } = await p.query<{ payload: { mode: string; piece: string } }>(
        `select payload from audit.event_log where action = 'piece.read' and object_id = $1`,
        [rows[0]!.id],
      );
      return { ext: rows[0]!, audit };
    });
    assert.equal(lu.ext.mode_lecture, "pdf-text");
    assert.equal(lu.ext.confiance_par_champ["totals.ttc"], 0.95);
    assert.equal(lu.audit.length, 1);
    assert.equal(lu.audit[0]!.payload.mode, "pdf-text");
    assert.equal(lu.audit[0]!.payload.piece, piece);
  });

  it("une facture juste : à comptabiliser — montants lus sur le texte IMPRIMÉ, jetons réassemblés", async () => {
    const piece = await pieceLue("juste", lecture({ numero: "F-JUSTE" }));
    const a = (await rpc("capture", "analyser", piece)) as {
      verdict: string;
      motifs: Array<{ code: string }>;
      normalisation: { etat: string; montants: { ttc: number; bases: Array<{ ht: number }> } };
    };
    assert.equal(a.normalisation.etat, "tranche");
    assert.equal(a.normalisation.montants.bases[0]!.ht, 1_234_560);
    assert.equal(a.normalisation.montants.ttc, 1_470_126);
    assert.equal(a.verdict, "à comptabiliser", JSON.stringify(a.motifs));
    assert.ok(a.motifs.length > 0);
    const posee = await admin(async (p) => {
      const { rows } = await p.query(`select verdict from capture.analyses where piece_id = $1`, [
        piece,
      ]);
      return rows;
    });
    assert.deepEqual(posee, [{ verdict: "à comptabiliser" }]);
  });

  it("une proforma parfaitement lue : à rejeter", async () => {
    const piece = await pieceLue("proforma", lecture({ titre: "PROFORMA", numero: "F-PROFORMA" }));
    const a = (await rpc("capture", "analyser", piece)) as {
      verdict: string;
      motifs: Array<{ code: string }>;
    };
    assert.equal(a.verdict, "à rejeter");
    assert.deepEqual(
      a.motifs.map((m) => m.code),
      ["nature_piece"],
    );
  });

  it("adressée à une autre entreprise : à rejeter, destinataire", async () => {
    const piece = await pieceLue(
      "autre",
      lecture({ clientMf: "9999999Z/Z/M/000", numero: "F-AUTRE" }),
    );
    const a = (await rpc("capture", "analyser", piece)) as {
      verdict: string;
      motifs: Array<{ code: string }>;
    };
    assert.equal(a.verdict, "à rejeter");
    assert.deepEqual(
      a.motifs.map((m) => m.code),
      ["destinataire"],
    );
  });

  it("un TTC qui ne tient pas : anomalie à signaler — et aucun montant retenu", async () => {
    const piece = await pieceLue("faux", lecture({ ttc: ["1", "500,000"], numero: "F-FAUX" }));
    const a = (await rpc("capture", "analyser", piece)) as {
      verdict: string;
      normalisation: { etat: string; montants: { ttc: number | null } };
    };
    assert.equal(a.verdict, "anomalie à signaler");
    assert.equal(a.normalisation.etat, "incoherent");
    assert.equal(a.normalisation.montants.ttc, null);
  });

  it("même émetteur, même numéro qu'une pièce déjà lue : à rapprocher", async () => {
    // Le même fournisseur, le numéro de la facture « juste », déjà lue.
    const piece = await pieceLue("semblable", lecture({ numero: "F-JUSTE" }));
    const a = (await rpc("capture", "analyser", piece)) as {
      verdict: string;
      motifs: Array<{ code: string }>;
    };
    assert.equal(a.verdict, "à rapprocher");
  });

  it("montants ronds, virgule ambiguë : le timbre du paramétrage ancre l'échelle — à comptabiliser", async () => {
    // « 100,000 / 19,000 / 1,000 / 120,000 » tient en millimes comme en dinars
    // (virgule des milliers) ; le droit de timbre vaut 1,000 DT au paramétrage.
    const piece = await pieceLue(
      "ronds",
      lecture({ ht: ["100,000", "DT"], tva: "19,000", ttc: ["120,000", "DT"], numero: "F-RONDS" }),
    );
    const a = (await rpc("capture", "analyser", piece)) as {
      verdict: string;
      normalisation: {
        etat: string;
        raison: string;
        montants: { ttc: number; bases: Array<{ ht: number }> };
      };
    };
    assert.equal(a.normalisation.etat, "tranche", a.normalisation.raison);
    assert.equal(a.normalisation.montants.bases[0]!.ht, 100_000);
    assert.equal(a.normalisation.montants.ttc, 120_000);
    assert.match(a.normalisation.raison, /paramétrage/);
    assert.equal(a.verdict, "à comptabiliser");
  });

  it("un doublon strict, marqué à la réception : à rejeter, doublon", async () => {
    const original = await pieceLue("original", lecture({ numero: "F-ORIGINAL" }));
    const copie = await pieceLue("copie", lecture({ numero: "F-COPIE" }));
    // Ce que pose la réception quand les octets ont la même empreinte (3B-1).
    await admin((p) =>
      p.query(`update capture.pieces set doublon_de = $1 where id = $2`, [original, copie]),
    );
    const a = (await rpc("capture", "analyser", copie)) as {
      verdict: string;
      motifs: Array<{ code: string }>;
    };
    assert.equal(a.verdict, "à rejeter");
    assert.deepEqual(
      a.motifs.map((m) => m.code),
      ["doublon"],
    );
  });

  it("une pièce jamais lue ne s'analyse pas", async () => {
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "partage",
      idempotencyKey: `${marque}-vierge`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await assert.rejects(rpc("capture", "analyser", p.id), /pas encore été lue/);
  });
});
