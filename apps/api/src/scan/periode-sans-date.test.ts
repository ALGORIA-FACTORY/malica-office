/**
 * Une date non lue ne devient pas la date du jour.
 *
 * ================================================================= POURQUOI
 *
 * Trouvé le 5 octobre 2026, en diagnostiquant pourquoi « Vos charges » et
 * « Votre TVA » se contredisaient. La projection des articles rangeait la pièce
 * ainsi (migration `…55a3973b…`) :
 *
 *     v_period := to_char(coalesce(p_document_date, current_date), 'YYYY-MM');
 *
 * Quand la date de la pièce n'a pas été lue — exactement le cas de la facture
 * de loyer, dont la date était écrite en toutes lettres — la pièce était rangée
 * au mois du SCAN. Silencieusement.
 *
 * C'est la forme d'erreur que R4 nomme comme la pire : invisible, non
 * surchargeable, et elle produit un résultat PLAUSIBLE. Une facture de
 * septembre comptée en octobre ne choque personne, et fausse une déclaration
 * de TVA.
 *
 * ============================================================= CE QU'ON EXIGE
 *
 * Pas de rangement plutôt qu'un rangement faux. La période reste vide, la
 * pièce attend sa date, et les écrans la montrent comme telle. Ce n'est pas
 * une régression de confort : un mois vide se voit et se corrige, un mois faux
 * ne se voit pas.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { lecture } from "./lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("la période d'une pièce sans date", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `periode-${Date.now()}`;
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

  /** Une pièce lue, avec un article, et la date qu'on veut bien lui donner. */
  async function pieceAvecArticle(cle: string, documentDate: string | null) {
    const l = lecture(documentDate === null ? { sansDate: true } : {});
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "pdf",
      vis: "personnel",
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
      articles: [
        {
          designation: "Loyer mensuel local à usage de bureaux",
          quantity: "1.000",
          unit_price_ht: "2800.000",
          unit_price_ttc: null,
          total_ht: "2800.000",
        },
      ],
      documentKind: "facture_achat",
      documentDate,
      mode: "pdf-text",
      confianceParChamp: { "totals.ttc": 0.95 },
    });
    return p.id;
  }

  const periodeDe = (piece: string) =>
    admin(async (p) => {
      const { rows } = await p.query<{ period: string | null; document_date: string | null }>(
        `select period, document_date::text from capture.piece_articles where piece_id = $1`,
        [piece],
      );
      return rows[0]!;
    });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '1876543W/A/M/000', 'TN', 'TND') as id`,
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

  it("une date lue range la pièce à son mois", () => {
    // Le cas normal, posé d'abord : la correction ne doit pas l'abîmer.
    return pieceAvecArticle("avec-date", "2026-09-10").then(async (piece) => {
      const r = await periodeDe(piece);
      assert.equal(r.period, "2026-09");
      assert.equal(r.document_date, "2026-09-10");
    });
  });

  it("une date non lue laisse la période VIDE, jamais le mois du scan", async () => {
    const piece = await pieceAvecArticle("sans-date", null);
    const r = await periodeDe(piece);
    assert.equal(r.document_date, null, "la pièce n'a pas de date : c'est le point de départ");
    assert.equal(
      r.period,
      null,
      "la période doit rester vide — pas le mois où la photo a été prise",
    );
  });

  it("et surtout : la période n'est jamais le mois courant par défaut", async () => {
    /*
     * L'assertion qui aurait attrapé le défaut. Elle est écrite en négatif
     * parce que c'est ainsi qu'il se présentait : une valeur plausible, du bon
     * format, au bon endroit, et fausse. Comparer à `null` ne suffit pas —
     * un futur repli sur une autre date passerait.
     */
    const piece = await pieceAvecArticle("ni-courant", null);
    const r = await periodeDe(piece);
    const moisCourant = new Date().toISOString().slice(0, 7);
    assert.notEqual(
      r.period,
      moisCourant,
      "le mois du scan n'est pas le mois de la pièce : le ranger ainsi fausse une déclaration de TVA",
    );
  });
});
