/**
 * Le crayon d'une facture lue : le pied se corrige (10 novembre 2026).
 *
 * Demande du dirigeant : un crayon à côté de chaque composante de la facture.
 * Cette épreuve tient le pied — la base HT, la TVA, les droits, le total.
 *
 *   - la correction est une précision (R7) : la lecture d'origine est intacte,
 *     et la fiche porte la valeur lue, la valeur saisie, l'auteur ;
 *   - la pièce est rejugée, et le message vient du jugement (R3) : sur la
 *     pièce type (HT 15000,000 ; TVA 2850,000 ; total 17851,000 ; timbre
 *     1,000) il ferme, et tant qu'un montant reste faux il ne ferme pas ;
 *   - la saisie est bornée par la devise du référentiel (R4), jamais arrondie ;
 *   - une personne sans droit sur la pièce est refusée, une pièce engagée aussi.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-crayon-corrige-les-totaux.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

interface Jugement {
  ferme: boolean;
  etat: string;
  devise: string | null;
  montants: {
    baseHt: string | null;
    tva: string | null;
    droits: Array<string | null>;
    ttc: string | null;
  } | null;
  aVerifier: string[];
}
interface Corrige {
  id: string | null;
  champ: string;
  valeur: string;
  jugement: Jugement;
}

describe("le crayon corrige le pied de la facture", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `crayon-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mf = matriculeDEssai("A", "M");
  let dirigeant: Utilisateur;
  let etranger: Utilisateur;
  let societe = "";
  let packId = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const fait = (u: () => Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u().id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const pmeFait = (methode: string, ...args: unknown[]) => fait(() => dirigeant, methode, ...args);

  let n = 0;
  /**
   * La pièce type, lue de travers : la base et le timbre sont justes, la TVA est
   * lue 2350,000 (un « 8 » pris pour un « 3 ») et le total 17351,000.
   */
  const lue = async () => {
    n += 1;
    const l = lectureDEssai({
      clientMf: mf,
      numero: `CRAYON-${n}`,
      ht: ["15", "000,000"],
      tva: "2350,000",
      ttc: ["17", "351,000"],
    });
    const p = (await pmeFait("capture.enregistrer", {
      tenantId: societe,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: p.id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract: {
                ...l.extract,
                lines: [
                  {
                    label: "Achats",
                    tax_code: "TVA19",
                    base_ht: "15000.000",
                    vat_amount: "2350.000",
                    ttc: "17350.000",
                  },
                ],
                totals: { base_ht: "15000.000", vat: "2350.000", ttc: "17351.000" },
              },
              citations: l.citations,
              flags: [],
              articles: [],
              documentKind: "facture_achat",
              documentDate: l.extract.document_date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await pmeFait("capture.analyser", p.id);
    return p.id;
  };

  const corrige = (id: string, champ: string, valeur: string) =>
    pmeFait("capture.corrigerLeChamp", id, champ, valeur) as Promise<Corrige>;

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    etranger = (await creerCompte(`etranger-${marque}@essai.local`, mdp))!;
    assert.ok(dirigeant && etranger);
    societe = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME CRAYON ${marque}`, mf],
      );
      return rows[0]!.id;
    });
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [societe],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("la pièce lue de travers ne ferme pas", async () => {
    const id = await lue();
    const j = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `select normalisation ->> 'etat' as n from capture.analyses
          where piece_id = $1 order by created_at desc limit 1`,
        [id],
      );
      return rows[0]!.n;
    });
    assert.notEqual(j, "tranche");
  });

  it("sur la pièce type, la TVA puis le total saisis font fermer le jugement", async () => {
    const id = await lue();

    // La TVA corrigée ne suffit pas : le total lu 17351 ne tient pas avec 2850 + 1.
    const premiere = await corrige(id, "totals.vat", "2850.000");
    assert.ok(premiere.id, "une précision est écrite");
    assert.equal(premiere.jugement.ferme, false, JSON.stringify(premiere.jugement));
    assert.deepEqual(premiere.jugement.aVerifier, ["totals.vat"]);
    assert.equal(premiere.jugement.montants, null, "rien n'est retenu tant que ça ne ferme pas");

    const seconde = await corrige(id, "totals.ttc", "17851.000");
    assert.equal(seconde.jugement.ferme, true, JSON.stringify(seconde.jugement));
    assert.equal(seconde.jugement.etat, "tranche");
    assert.deepEqual(seconde.jugement.montants, {
      baseHt: "15000.000",
      tva: "2850.000",
      droits: ["1.000"],
      ttc: "17851.000",
    });
    assert.deepEqual(seconde.jugement.aVerifier, []);

    // Le message suit le jugement posé en base, pas un calcul de l'écran.
    const { rows } = await admin.query<{ etat: string; verdict: string }>(
      `select normalisation ->> 'etat' as etat, verdict from capture.analyses
        where piece_id = $1 order by created_at desc limit 1`,
      [id],
    );
    assert.equal(rows[0]?.etat, "tranche");
  });

  it("la lecture d'origine est intacte, et la fiche dit lu, saisi, qui et quand", async () => {
    const id = await lue();
    await corrige(id, "totals.vat", "2850.000");

    const { rows } = await admin.query<{ n: number; vat: string }>(
      `select count(*) over ()::int as n, payload #>> '{totals,vat}' as vat
         from capture.extractions where piece_id = $1`,
      [id],
    );
    assert.equal(rows.length, 1, "aucune lecture nouvelle");
    assert.equal(rows[0]!.vat, "2350.000", "la lecture n'est jamais modifiée (R7)");

    const fiche = (await pmeFait("capture.dossier", id)) as {
      extraction: { payload: { totals: { vat: string } } };
      corrections: Array<{
        champ: string;
        valeur: string;
        lue: string | null;
        par: string | null;
        le: string;
      }>;
    };
    assert.equal(
      fiche.extraction.payload.totals.vat,
      "2850.000",
      "le pied porte la valeur retenue",
    );
    const c = fiche.corrections.find((x) => x.champ === "totals.vat");
    assert.ok(c, JSON.stringify(fiche.corrections));
    assert.equal(c.valeur, "2850.000");
    assert.equal(c.lue, "2350.000", "la valeur lue reste, à côté");
    assert.ok(c.par && c.par.length > 0, "la personne qui a saisi est nommée");
    assert.ok(!Number.isNaN(Date.parse(c.le)));

    const { rows: journal } = await admin.query<{ payload: { avant: string; valeur: string } }>(
      `select payload from audit.event_log
        where action = 'piece.precisee' and payload ->> 'piece_id' = $1::text
          and payload ->> 'champ' = 'totals.vat'`,
      [id],
    );
    assert.deepEqual(
      journal.map((j) => [j.payload.avant, j.payload.valeur]),
      [["2350.000", "2850.000"]],
    );
  });

  it("une correction suivante remplace la précédente sans la défaire : la dernière fait foi", async () => {
    const id = await lue();
    await corrige(id, "totals.vat", "2850.000");
    await corrige(id, "totals.vat", "2851.000");
    const { rows } = await admin.query<{ valeur: string }>(
      `select valeur from capture.precisions where piece_id = $1 and champ = 'totals.vat'
        order by decided_at`,
      [id],
    );
    assert.deepEqual(
      rows.map((r) => r.valeur),
      ["2850.000", "2851.000"],
    );
  });

  it("redire la même valeur n'écrit rien", async () => {
    const id = await lue();
    await corrige(id, "totals.vat", "2850.000");
    const encore = await corrige(id, "totals.vat", "2850.000");
    assert.equal(encore.id, null);
    const { rows } = await admin.query(`select 1 from capture.precisions where piece_id = $1`, [
      id,
    ]);
    assert.equal(rows.length, 1);
  });

  it("le droit se corrige aussi, et s'écrit aux décimales de la devise", async () => {
    const id = await lue();
    // « 1 » s'inscrit 1.000 : la devise du référentiel porte trois décimales (R4).
    const r = await corrige(id, "other_charges[0].amount", "1");
    assert.equal(r.valeur, "1.000");
  });

  it("une saisie illisible, trop précise ou sur une ligne inconnue est refusée", async () => {
    const id = await lue();
    await assert.rejects(corrige(id, "totals.vat", "2 850,000"), /montant_illisible/);
    await assert.rejects(corrige(id, "totals.vat", "-5"), /montant_illisible/);
    await assert.rejects(corrige(id, "totals.vat", "2850.0001"), /montant_trop_precis/);
    await assert.rejects(corrige(id, "other_charges[7].amount", "1.000"), /ligne_inconnue/);
    await assert.rejects(corrige(id, "totals.nimporte", "1.000"), /champ/);
    const { rows } = await admin.query(`select 1 from capture.precisions where piece_id = $1`, [
      id,
    ]);
    assert.equal(rows.length, 0, "rien ne s'est écrit");
  });

  it("une personne sans droit sur la pièce est refusée", async () => {
    const id = await lue();
    await assert.rejects(
      fait(() => etranger, "capture.corrigerLeChamp", id, "totals.vat", "2850.000"),
      /introuvable|refus/,
    );
    const { rows } = await admin.query(`select 1 from capture.precisions where piece_id = $1`, [
      id,
    ]);
    assert.equal(rows.length, 0);
  });

  it("une pièce engagée ne se corrige plus : la correction passe par le cabinet", async () => {
    const id = await lue();
    await admin.query(`update capture.pieces set status = 'proposee' where id = $1`, [id]);
    await assert.rejects(corrige(id, "totals.vat", "2850.000"), /engagee/);
  });
});
