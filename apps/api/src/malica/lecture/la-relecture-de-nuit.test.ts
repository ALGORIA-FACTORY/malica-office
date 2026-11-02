/**
 * La relecture de nuit, éprouvée sur la vraie base — et pas relue.
 *
 * Mesure du 1er novembre 2026 : 13 à 15 s des 19,4 s d'une lecture partaient
 * dans un rattrapage synchrone, le plus souvent écarté. Le dirigeant a décidé
 * que la lecture lourde passe en différé : « la nuit, si ni le client ni le
 * cabinet n'a corrigé ». Ce que ces épreuves tiennent :
 *
 *   coupée     le réglage par défaut : rien ne change, le second lecteur part
 *              dans la requête, et aucun travail ne s'inscrit ;
 *   active     la requête ne lance PAS le second lecteur, rend la première
 *              lecture, et inscrit un travail « pas avant » la lecture + le
 *              délai du dossier ;
 *   humain     une correction de la personne après la lecture : le travail
 *              s'abstient, sans appel payant, et le dit ;
 *   mieux      la relecture n'est retenue que STRICTEMENT meilleure, et elle
 *              l'est comme une lecture NOUVELLE (R7), avec son propre plan de
 *              jetons, sans seconde lecture décomptée ;
 *   isolation  un autre dossier ne prend pas le travail, ne le lit pas, et ne
 *              persiste rien par sa porte (R6) ;
 *   ordre      une relecture due passe après la lecture d'une pièce déposée.
 *
 * Les organes payants sont des faux qui comptent leurs appels ; tout le reste
 * (réglages, file, portes, analyse, compteur) est la vraie base, sous
 * l'identité des personnes. R7 : les organisations d'essai s'archivent.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../../auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "../../db.ts";
import { identite } from "../../depots/identite.ts";
import { parametrage } from "../../depots/parametrage.ts";
import { executerUnTravail } from "../../fabrique/travaux-execution.ts";
import { enregistrerTravail, prendreUnTravail } from "../../fabrique/travaux.ts";
import { matriculeDEssai } from "../../matricule-d-essai.ts";
import { executerRpc } from "../../rpc.ts";
import { creerAppelLocal, type AppelApi } from "../appel-local.ts";

import { readPieceFlow, relirePiece } from "./read-flow.ts";
import type { PageToken } from "./token-plan.ts";
import type { VisionRead, VisionSelection } from "./vision.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

type Lecteurs = NonNullable<Parameters<typeof readPieceFlow>[2]>;

const jeton = (ordinal: number, text: string): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0: 0.1,
  y0: 0.1 + ordinal / 100,
  x1: 0.3,
  y1: 0.12 + ordinal / 100,
});
const ref = (ordinal: number) => ({ page: 1, ordinal });

const TOKENS: PageToken[] = [
  jeton(0, "ATLAS DISTRIBUTION"),
  jeton(1, "02/09/2026"),
  jeton(2, "1000.000"),
  jeton(3, "190.000"),
  jeton(4, "1190.000"),
];
/** Le plan d'un autre lecteur : un jeton de plus, pour reconnaître le sien. */
const TOKENS_DE_L_AUTRE: PageToken[] = [...TOKENS, jeton(5, "MERCI")];

function lecture(readModel: string, selection: VisionSelection, tokens = TOKENS): VisionRead {
  const passe = { latencyMs: 1, tokensIn: null, tokensOut: null };
  return {
    tokens,
    selection,
    lecteur: readModel.includes("PP-OCR") ? "paddle" : "vision",
    paddleTente: false,
    model: readModel,
    readModel,
    selectModel: readModel,
    selectRole: "chat",
    latencyMs: 2,
    tokensIn: null,
    tokensOut: null,
    releve: passe,
    designation: passe,
  };
}

/** Une facture que le contrat accepte en entier : extract.v1. */
function complete(readModel: string, tokens = TOKENS): VisionRead {
  return lecture(
    readModel,
    {
      issuer: ref(0),
      document_date: ref(1),
      currency: "TND",
      document_kind: "facture_achat",
      lines: [
        {
          label: "Marchandises",
          tax_code: "TVA_19",
          base_ht: ref(2),
          vat_amount: ref(3),
          ttc: ref(4),
        },
      ],
      articles: [],
      other_charges: [],
      totals: { base_ht: ref(2), vat: ref(3), ttc: ref(4) },
      references: {},
      overall_confidence: 0.9,
    } as unknown as VisionSelection,
    tokens,
  );
}

/** L'émetteur et la date non désignés : le contrat sort partiel. */
function partielle(readModel: string, tokens = TOKENS): VisionRead {
  const c = complete(readModel, tokens);
  return lecture(readModel, { ...c.selection, issuer: null, document_date: null }, tokens);
}

/** Des lecteurs qui comptent leurs appels, et rendent ce qu'on leur donne. */
function lecteurs(reponses: Array<() => VisionRead>): Lecteurs & { appels: number } {
  const l = {
    appels: 0,
    lire: async () => {
      const suivante = reponses[l.appels];
      l.appels += 1;
      if (!suivante) throw new Error("appel de modèle imprévu");
      return suivante();
    },
    secondLecteurDisponible: () => true,
  };
  return l;
}

describe("la relecture de nuit", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `relecture-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"], max: 2 });
  const archiver: string[] = [];
  let expert: Utilisateur;
  let cabinet = "";
  let jour = "";
  let packId = "";
  let n = 0;

  /**
   * Les coûts que la chaîne a demandé de journaliser. Les modèles des faux
   * lecteurs n'ont pas de tarif : la base refuse de les écrire, et c'est
   * juste — on compte donc la DEMANDE, qui est ce que la chaîne décide.
   */
  const journalises: string[] = [];

  /** L'API réelle sous l'identité de la personne, sauf le contenu : la pièce n'a pas d'octets. */
  const apiDe = (u: Utilisateur): AppelApi => {
    const reelle = creerAppelLocal(u.id);
    return {
      rpc: (depot, methode, args) => {
        if (methode === "journaliserAgent") {
          journalises.push((args?.[0] as { pieceId: string }).pieceId);
        }
        return reelle.rpc(depot, methode, args);
      },
      contenu: async () => ({ octets: new Uint8Array([1, 2, 3]), type: "image/jpeg" }),
    };
  };
  const journalisesPour = (pieceId: string) => journalises.filter((p) => p === pieceId).length;

  /** Un dossier que le cabinet tient, son dirigeant, et — s'il est dit — son réglage. */
  async function dossier(
    reglage: { nuit: "active" | "coupee"; delai: string } | null,
  ): Promise<{ u: Utilisateur; pme: string }> {
    n += 1;
    const u = await creerCompte(`dirigeant-${marque}-${n}@essai.local`, mdp);
    assert.ok(u);
    const mf = matriculeDEssai("A", "M");
    const pme = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'mandate', $2, 'TN', 'TND') as id`,
        [`PME RELECTURE ${marque} ${n}`, mf],
      );
      return rows[0]!.id;
    });
    archiver.push(pme);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [propose] = await sousIdentite(u.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(u.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    if (reglage) {
      await sousIdentite(expert.id, (db) =>
        parametrage.arreterReglagesComptables(db, {
          cabinetId: cabinet,
          portee: "dossier",
          porteeId: pme,
          packId,
          depuis: jour,
          valeurs: [
            { code: "lecture.relecture_nuit", valeur: reglage.nuit },
            { code: "lecture.relecture_delai_heures", valeur: reglage.delai },
          ],
        }),
      );
    }
    return { u, pme };
  }

  async function deposer(u: Utilisateur, pme: string, cle: string): Promise<string> {
    const p = (await sousIdentiteDuServeur(u.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "enregistrer",
          args: [
            {
              tenantId: pme,
              source: "photo",
              vis: "partage",
              idempotencyKey: `${marque}-${cle}`,
              contentType: "image/jpeg",
              pageCount: 1,
            },
          ],
        },
        "serveur",
      ),
    )) as { id: string };
    return p.id;
  }

  /** Les relectures inscrites pour la pièce, telles que la base les tient. */
  async function relectures(pieceId: string) {
    const { rows } = await admin.query<{
      id: string;
      etat: string;
      prenable: boolean;
      dernier_motif: string | null;
      ecart_s: number;
    }>(
      `select t.id, e.etat, e.prenable, e.dernier_motif,
              extract(epoch from (t.pas_avant - x.created_at))::float8 as ecart_s
         from fabrique.travaux t
         join fabrique.etat_des_travaux_v e on e.travail_id = t.id
         join capture.extractions x on x.id = t.extraction_id
        where t.piece_id = $1 and t.nature = 'relecture_piece'`,
      [pieceId],
    );
    return rows;
  }

  async function compter(table: string, pieceId: string): Promise<number> {
    const { rows } = await admin.query<{ n: string }>(
      `select count(*) as n from ${table} where piece_id = $1`,
      [pieceId],
    );
    return Number(rows[0]!.n);
  }

  /** Ce que fait le coureur : prendre la relecture due du dossier, l'exécuter, inscrire son issue. */
  function executer(u: Utilisateur, pme: string, modele: Lecteurs) {
    return executerUnTravail(
      (travail) => sousIdentiteDuServeur(u.id, travail),
      pme,
      ["relecture_piece"],
      (t) => relirePiece(apiDe(u), { travailId: t.travailId, pieceId: t.pieceId }, modele),
    );
  }

  before(async () => {
    const e = await creerCompte(`expert-${marque}@essai.local`, mdp);
    assert.ok(e);
    expert = e;
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'mandate', null, 'TN', 'TND') as id`,
        [`CABINET RELECTURE ${marque}`],
      );
      return rows[0]!.id;
    });
    archiver.push(cabinet);
    jour = (await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet)))
      .aujourdhui!;
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    await admin.query(
      `update identity.organizations set archived_at = now(),
              archived_reason = 'fixture de test automatisé' where id = any($1)`,
      [archiver],
    );
    await admin.end();
    await fermerLePool();
  });

  it("coupée (le défaut) : le rattrapage part dans la requête, comme avant, et rien ne s'inscrit", async () => {
    const { u, pme } = await dossier(null);
    const piece = await deposer(u, pme, "coupee");
    const modele = lecteurs([() => partielle("qwen-vl-ocr"), () => complete("PP-OCR")]);

    const rendu = await readPieceFlow(apiDe(u), piece, modele);

    assert.equal(modele.appels, 2, "le second lecteur est parti dans la requête");
    assert.equal(rendu.contract, "extract.v1", "et sa lecture, meilleure, a été retenue");
    assert.deepEqual(await relectures(piece), [], "aucune relecture n'est inscrite");
    assert.equal(await compter("facturation.lectures", piece), 1);
  });

  it("active : la requête ne lance pas le second lecteur, et inscrit un travail « pas avant »", async () => {
    const { u, pme } = await dossier({ nuit: "active", delai: "12" });
    const piece = await deposer(u, pme, "active");
    const modele = lecteurs([() => partielle("qwen-vl-ocr"), () => complete("PP-OCR")]);

    const rendu = await readPieceFlow(apiDe(u), piece, modele);

    assert.equal(modele.appels, 1, "un seul appel payant dans la requête");
    assert.equal(rendu.contract, "extract.v1.partiel", "la première lecture est rendue");
    assert.equal(await compter("facturation.lectures", piece), 1, "et comptée une fois");
    const [r, ...autres] = await relectures(piece);
    assert.ok(r, "la relecture est inscrite");
    assert.equal(autres.length, 0, "une seule");
    assert.equal(r.ecart_s, 12 * 3600, "pas avant la lecture + 12 heures, le délai du dossier");
    assert.equal(r.etat, "a_faire");
    assert.equal(r.prenable, false, "son heure n'est pas venue");
    // Le coureur passe : il ne la prend pas avant son heure.
    const pris = await sousIdentiteDuServeur(u.id, (db) =>
      prendreUnTravail(db, pme, ["relecture_piece"]),
    );
    assert.equal(pris, null);
  });

  it("une lecture parfaite n'inscrit rien, même active", async () => {
    const { u, pme } = await dossier({ nuit: "active", delai: "12" });
    const piece = await deposer(u, pme, "parfaite");
    const modele = lecteurs([() => complete("qwen-vl-ocr")]);

    await readPieceFlow(apiDe(u), piece, modele);

    assert.equal(modele.appels, 1);
    assert.deepEqual(await relectures(piece), []);
  });

  describe("quand son heure est venue", () => {
    let u: Utilisateur;
    let pme = "";

    before(async () => {
      // Un délai minuscule : la relecture est due tout de suite.
      ({ u, pme } = await dossier({ nuit: "active", delai: "0.000001" }));
    });

    async function luePartielle(cle: string): Promise<string> {
      const piece = await deposer(u, pme, cle);
      await readPieceFlow(apiDe(u), piece, lecteurs([() => partielle("qwen-vl-ocr")]));
      const [r] = await relectures(piece);
      assert.ok(r?.prenable, "la relecture est due");
      return piece;
    }

    it("une correction humaine après la lecture : le travail s'abstient, sans appel payant, et le dit", async () => {
      const piece = await luePartielle("corrigee");
      // Le client donne la date que la lecture n'a pas su désigner.
      await sousIdentite(u.id, (db) =>
        executerRpc(db, {
          depot: "capture",
          methode: "preciser",
          args: [piece, "document_date", "2026-09-02"],
        }),
      );
      const modele = lecteurs([() => complete("PP-OCR", TOKENS_DE_L_AUTRE)]);

      const fait = await executer(u, pme, modele);

      assert.equal(fait?.pieceId, piece);
      assert.equal(fait?.issue, "termine", "s'abstenir n'est pas échouer");
      assert.equal(fait?.motif, "relecture.abstention.correction_humaine");
      assert.equal(modele.appels, 0, "aucun modèle payé");
      assert.equal(await compter("capture.extractions", piece), 1, "la lecture d'avant reste");
      const [r] = await relectures(piece);
      assert.equal(r?.etat, "termine");
      assert.equal(r?.dernier_motif, "relecture.abstention.correction_humaine");
      const { rows } = await admin.query<{ detail: { trace: string } }>(
        `select f.detail from fabrique.travail_faits f
          where f.travail_id = $1 and f.nature = 'termine'`,
        [r!.id],
      );
      assert.equal(rows[0]?.detail.trace, "precision", "et elle nomme la correction");
    });

    it("strictement meilleure : retenue comme une lecture NOUVELLE, avec son plan, sans lecture de plus", async () => {
      const piece = await luePartielle("meilleure");
      const avant = journalisesPour(piece);
      const modele = lecteurs([() => complete("PP-OCR", TOKENS_DE_L_AUTRE)]);

      const fait = await executer(u, pme, modele);

      assert.equal(fait?.issue, "termine");
      assert.equal(fait?.motif, "relecture.retenue");
      assert.equal(modele.appels, 1, "l'autre lecteur a relu");
      // R7 : la première lecture est toujours là ; la nouvelle fait foi.
      const { rows: x } = await admin.query<{ contract: string; jetons: string }>(
        `select x.contract,
                (select count(*) from capture.token_plan t where t.extraction_id = x.id) as jetons
           from capture.extractions x where x.piece_id = $1 order by x.created_at`,
        [piece],
      );
      assert.deepEqual(
        x.map((l) => [l.contract, Number(l.jetons)]),
        [
          ["extract.v1.partiel", TOKENS.length],
          ["extract.v1", TOKENS_DE_L_AUTRE.length],
        ],
      );
      // Ce que l'écran lit : le plan et les citations de la lecture qui fait foi, seuls.
      const vu = await sousIdentite(u.id, async (db) => {
        const t = await db.query<{ n: string }>(
          `select count(*) as n from token_plan_v where piece_id = $1`,
          [piece],
        );
        const c = await db.query<{ n: string }>(
          `select count(*) as n from citations_v c
             join capture.extractions x on x.id = c.extraction_id
            where c.piece_id = $1 and x.contract = 'extract.v1'`,
          [piece],
        );
        const tout = await db.query<{ n: string }>(
          `select count(*) as n from citations_v where piece_id = $1`,
          [piece],
        );
        return [Number(t.rows[0]!.n), Number(c.rows[0]!.n), Number(tout.rows[0]!.n)];
      });
      assert.equal(vu[0], TOKENS_DE_L_AUTRE.length, "un seul plan, celui de la relecture");
      assert.ok(vu[1]! > 0 && vu[1] === vu[2], "les citations sont toutes celles de la relecture");
      // L'analyse a rejugé la pièce sur la nouvelle lecture.
      const { rows: a } = await admin.query<{ a_jour: boolean }>(
        `select a.extraction_id = (select id from capture.extractions where piece_id = $1
                                    order by created_at desc limit 1) as a_jour
           from capture.analyses a where a.piece_id = $1 order by a.created_at desc limit 1`,
        [piece],
      );
      assert.equal(a[0]?.a_jour, true);
      assert.equal(
        await compter("facturation.lectures", piece),
        1,
        "la relecture ne se décompte pas",
      );
      assert.equal(
        journalisesPour(piece),
        avant + 2,
        "son coût se journalise : relevé et désignation",
      );
      // La porte de la première lecture refuse toujours une seconde lecture.
      const verdict = await sousIdentiteDuServeur(u.id, async (db) => {
        const { rows } = await db.query<{ v: { motif: string } }>(
          `select public.lecture_autorisee($1) as v`,
          [piece],
        );
        return rows[0]!.v;
      });
      assert.equal(verdict.motif, "piece_deja_lue");
    });

    it("retenue sans article : les articles de la lecture d'avant ne restent pas à l'écran", async () => {
      // Codex, PR #193 : la projection des articles n'était pas reconstruite
      // quand la relecture retenue n'en lisait aucun.
      const piece = await deposer(u, pme, "articles-perimes");
      const avecUnArticle = (): VisionRead => {
        const p = partielle("qwen-vl-ocr");
        const article = {
          designation: ref(0),
          quantity: null,
          unit_price_ht: null,
          unit_price_ttc: null,
          total_ht: ref(2),
          tax_code: null,
        };
        return lecture(
          "qwen-vl-ocr",
          { ...p.selection, articles: [article] } as unknown as VisionSelection,
          TOKENS,
        );
      };
      await readPieceFlow(apiDe(u), piece, lecteurs([avecUnArticle]));
      const articles = async () =>
        Number(
          (
            await admin.query<{ n: string }>(
              `select count(*) as n from capture.piece_articles where piece_id = $1`,
              [piece],
            )
          ).rows[0]!.n,
        );
      assert.equal(await articles(), 1, "la première lecture projette son article");

      const fait = await executer(u, pme, lecteurs([() => complete("PP-OCR", TOKENS_DE_L_AUTRE)]));

      assert.equal(fait?.motif, "relecture.retenue");
      assert.equal(await articles(), 0, "la lecture qui fait foi n'en a lu aucun");
    });

    it("pas strictement meilleure : la lecture d'avant reste, et le coût se journalise quand même", async () => {
      const piece = await luePartielle("egale");
      const avant = journalisesPour(piece);
      const modele = lecteurs([() => partielle("PP-OCR", TOKENS_DE_L_AUTRE)]);

      const fait = await executer(u, pme, modele);

      assert.equal(fait?.motif, "relecture.ecartee");
      assert.equal(modele.appels, 1);
      assert.equal(await compter("capture.extractions", piece), 1, "rien n'est réécrit ni ajouté");
      assert.equal(journalisesPour(piece), avant + 2);
    });

    it("isolation : un autre dossier ne prend pas le travail, ne le lit pas, n'écrit rien par sa porte", async () => {
      const piece = await luePartielle("isolee");
      const [r] = await relectures(piece);
      const autre = await dossier({ nuit: "active", delai: "12" });

      const pris = await sousIdentiteDuServeur(autre.u.id, (db) =>
        prendreUnTravail(db, pme, ["relecture_piece"]),
      );
      assert.equal(pris, null, "la file d'un autre dossier lui est invisible");
      await assert.rejects(
        sousIdentiteDuServeur(autre.u.id, (db) =>
          db.query(`select fabrique.relecture_a_faire($1)`, [r!.id]),
        ),
        /refus\.introuvable\.travail/,
      );
      await assert.rejects(
        sousIdentiteDuServeur(autre.u.id, (db) =>
          db.query(
            `select public.capture_relecture_persist($1, $2, '[]', 'extract.v1', '{}', '[]',
                                                     '[]', null, '{}')`,
            [r!.id, piece],
          ),
        ),
        /refus\.introuvable\.piece/,
      );
      // Et le dossier lui-même ne persiste pas une relecture qu'il n'a pas prise.
      await assert.rejects(
        sousIdentiteDuServeur(u.id, (db) =>
          db.query(
            `select public.capture_relecture_persist($1, $2, '[]', 'extract.v1', '{}', '[]',
                                                     '[]', null, '{}')`,
            [r!.id, piece],
          ),
        ),
        /refus\.relecture\.travail/,
      );
      // Ni depuis un écran : la porte est au serveur.
      await assert.rejects(
        sousIdentite(u.id, (db) =>
          db.query(
            `select fabrique.relecture_inscrire($1, '{"lecteur":"vision","paddleTente":false}')`,
            [piece],
          ),
        ),
        /refus\.reserve\.serveur/,
      );
      // Le dossier, lui, la prend et l'exécute.
      const fait = await executer(u, pme, lecteurs([() => complete("PP-OCR", TOKENS_DE_L_AUTRE)]));
      assert.equal(fait?.pieceId, piece);
      assert.equal(fait?.motif, "relecture.retenue");
    });

    it("une pièce que le client vient de déposer passe AVANT une relecture due", async () => {
      const relue = await luePartielle("en-attente");
      const nouvelle = await deposer(u, pme, "nouvelle");
      await sousIdentiteDuServeur(u.id, (db) =>
        enregistrerTravail(db, {
          tenantId: pme,
          pieceId: nouvelle,
          nature: "lecture_piece",
          cleIdempotence: `lecture_piece:${nouvelle}`,
        }),
      );

      const pris = await sousIdentiteDuServeur(u.id, (db) =>
        prendreUnTravail(db, pme, ["lecture_piece", "relecture_piece"]),
      );

      assert.equal(pris?.nature, "lecture_piece", "la lecture attendue d'abord");
      assert.equal(pris?.pieceId, nouvelle);
      const [r] = await relectures(relue);
      assert.equal(r?.prenable, true, "la relecture, due, attend son tour");
    });
  });
});
