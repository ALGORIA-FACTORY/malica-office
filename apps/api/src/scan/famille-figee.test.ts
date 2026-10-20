/**
 * Une pièce déjà lue suit le référentiel du jour, pas celui de sa lecture.
 *
 * ================================================================= POURQUOI
 *
 * 8 octobre 2026. Le référentiel des natures de charge a été corrigé la veille :
 * vingt et une familles, vingt-six règles de libellé, et `nature-des-charges`
 * atteste que « Cable souple 3*2.5 extra cable » donne FOURNITURES. Déployé,
 * vérifié sur le staging.
 *
 * Et le commanditaire signale : « toujours la facture de casa elect sans
 * catégorie ».
 *
 * Il a raison, et la cause n'est pas le référentiel. `capture_articles_persist`
 * résout la famille UNE FOIS, au moment de la projection, et l'écrit dans la
 * ligne. La vue `piece_articles_v` — par laquelle passent tous les écrans —
 * relit cette colonne. Une pièce projetée avant la correction garde donc
 * NON_CLASSE pour toujours : aucune migration ne la rattrape, et aucun écran
 * ne propose de la relire.
 *
 * ============================================================= CE QU'ON EXIGE
 *
 * R10, point 3, est explicite : « Un défaut se change sans migration. Si
 * l'expert doit attendre un déploiement pour corriger une imputation, ce n'est
 * pas un paramétrage : c'est une constante avec un délai. » Ici c'est pire
 * qu'un délai : même APRÈS le déploiement, les pièces déjà lues ne bougent
 * jamais.
 *
 * La famille d'une charge n'est pas une valeur liante — ce n'est ni un montant,
 * ni une écriture. C'est un rangement proposé par le pack, surchargeable. Elle
 * se résout donc à la LECTURE, contre le référentiel en vigueur, et non à
 * l'écriture.
 *
 * R7 n'est pas affaibli : rien n'est réécrit. Ce que la projection avait
 * proposé reste inscrit et consultable — on doit pouvoir expliquer un
 * classement ancien (c'est la raison pour laquelle la règle « syndic → LOYER »
 * a été close et non effacée).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { lecture } from "./lecture-d-essai.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Les libellés EXACTS de la facture SUARL CASA-ELECT du 6 octobre 2026. */
const LIGNES_CASA_ELECT = [
  "Prise 2P+T somef 45",
  "Boite app 2 module",
  "Cable souple 3*2.5 extra cable",
];

describe("la famille d'une pièce déjà lue", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `famille-figee-${Date.now()}`;
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

  /** Une facture d'achat lue, avec les trois lignes de CASA-ELECT. */
  async function pieceCasaElect(cle: string) {
    const l = lecture();
    const p = (await rpc("capture", "enregistrer", {
      tenantId: org,
      source: "photo",
      vis: "personnel",
      idempotencyKey: `${marque}-${cle}`,
      contentType: "image/jpeg",
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
      articles: LIGNES_CASA_ELECT.map((designation, i) => ({
        designation,
        quantity: "1.000",
        unit_price_ht: `${10 + i}.000`,
        unit_price_ttc: null,
        total_ht: `${10 + i}.000`,
      })),
      documentKind: "facture_achat",
      documentDate: "2026-10-06",
      mode: "qwen-vl-ocr",
      confianceParChamp: { "totals.ttc": 0.95 },
    });
    return p.id;
  }

  /** Ce que les ÉCRANS lisent : la vue, et elle seule. */
  const parLaVue = (piece: string) =>
    sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{
        designation: string;
        famille_code: string;
        famille_source: string;
      }>(
        `select designation, famille_code, famille_source
           from piece_articles_v where piece_id = $1 order by ordinal`,
        [piece],
      );
      return rows;
    });

  /**
   * Fige la famille des lignes comme si la pièce avait été projetée AVANT la
   * correction du 7 octobre. Ce n'est pas une mise en scène : c'est l'état
   * exact des lignes de la facture CASA-ELECT sur le staging, et la raison
   * pour laquelle l'écran dit encore « non classée ».
   */
  const figerAvantLaCorrection = (piece: string) =>
    admin((p) =>
      p.query(
        `update capture.piece_articles
            set famille_code = 'NON_CLASSE', famille_source = 'fallback'
          where piece_id = $1`,
        [piece],
      ),
    );

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
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

  it("une pièce lue aujourd'hui est classée — le cas normal, posé d'abord", async () => {
    const piece = await pieceCasaElect("lue-aujourdhui");
    for (const ligne of await parLaVue(piece)) {
      assert.equal(ligne.famille_code, "FOURNITURES", ligne.designation);
      assert.equal(ligne.famille_source, "designation_pattern", ligne.designation);
    }
  });

  it("une pièce lue AVANT la correction est classée elle aussi, sans relecture", async () => {
    const piece = await pieceCasaElect("lue-avant");
    await figerAvantLaCorrection(piece);

    const lignes = await parLaVue(piece);
    assert.equal(lignes.length, 3, "les trois lignes de la facture");
    for (const ligne of lignes) {
      assert.equal(
        ligne.famille_code,
        "FOURNITURES",
        `« ${ligne.designation} » : le référentiel du JOUR la reconnaît, l'écran doit la montrer classée`,
      );
      assert.equal(ligne.famille_source, "designation_pattern", ligne.designation);
    }
  });

  it("et ce que la projection avait proposé reste consultable, pour expliquer l'ancien classement", async () => {
    const piece = await pieceCasaElect("memoire");
    await figerAvantLaCorrection(piece);

    const { rows } = await sousIdentite(u.id, (db) =>
      db.query<{ famille_code_projete: string; famille_source_projete: string }>(
        `select famille_code_projete, famille_source_projete
           from piece_articles_v where piece_id = $1 order by ordinal limit 1`,
        [piece],
      ),
    );
    assert.equal(
      rows[0]?.famille_code_projete,
      "NON_CLASSE",
      "R7 : rien n'est réécrit — ce qui a été proposé le jour de la lecture reste inscrit",
    );
    assert.equal(rows[0]?.famille_source_projete, "fallback");
  });
});
