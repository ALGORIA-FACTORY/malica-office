/**
 * La passe de nuit, éprouvée sur la vraie base (B.5 de la conception validée
 * le 2 novembre 2026) — sous le relecteur de nuit, jamais en superutilisateur.
 *
 *   fenêtre     Tunis et Dakar à leur heure locale ; une fenêtre qui passe
 *               minuit ; un dossier sans fuseau est écarté, et le dit ;
 *   bout à bout une relecture retenue, une écartée, une abstention : l'acteur
 *               est le relecteur partout, `facturation.lectures` ne bouge pas ;
 *   plafonds    dossier (le travail reste à faire, zéro tentative), plateforme
 *               (le passage se ferme « plafond »), nombre, part du mensuel ; la
 *               dépense de journée d'un membre ne compte qu'au mensuel ;
 *   priorité    une lecture fraîche attend : la passe cède, sans rien prendre ;
 *   un passage  deux tics, un passage ; un processus tué, une reprise ; les
 *               tentatives épuisées se voient à la tour ;
 *   coupée      livrée coupée : rien ne s'ouvre.
 *
 * Les dossiers de l'épreuve sont à DAKAR (UTC+0), et la passe tourne à 05:30
 * UTC : dans leur nuit, hors de celle de Tunis (06:30). Les dossiers tunisiens
 * des autres épreuves, qui partagent la base, sont donc écartés « hors
 * fenêtre » et jamais relus ici.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../../auth.ts";
import { monterUneSociete } from "../../circuit-d-essai.ts";
import {
  fermerLePool,
  horsRlsAuthentificationSeule,
  sousIdentite,
  sousIdentiteDuServeur,
  sousLeRelecteurDeNuit,
  sousVerrouDeSession,
} from "../../db.ts";
import { identite } from "../../depots/identite.ts";
import { parametrage } from "../../depots/parametrage.ts";
import { enregistrerTravail } from "../../fabrique/travaux.ts";
import { matriculeDEssai } from "../../matricule-d-essai.ts";
import { executerRpc } from "../../rpc.ts";
import { rejugerLaPiece } from "../../scan/analyse.ts";
import { racine } from "../../stockage.ts";
import { creerAppelLocal } from "../appel-local.ts";

import {
  complete,
  lecteurs,
  partielle,
  ref,
  TOKENS_DE_L_AUTRE,
  type Lecteurs,
} from "./lectures-d-essai.ts";
import { tourDeNuit, type DependancesDeLaNuit } from "./passe-de-nuit.ts";
import { readPieceFlow } from "./read-flow.ts";
import type { VisionRead, VisionSelection } from "./vision.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/** La même facture, son numéro imprimé et désigné : de quoi reconnaître un doublon. */
function numerotee(l: VisionRead): VisionRead {
  const numero = {
    page: 1,
    ordinal: 7,
    text: "FAC-2026-0042",
    x0: 0.6,
    y0: 0.05,
    x1: 0.8,
    y1: 0.07,
  };
  return {
    ...l,
    tokens: [...l.tokens, numero],
    selection: {
      ...l.selection,
      references: { numero: ref(7) },
    } as unknown as VisionSelection,
  };
}

/** Le prochain instant à `heure` UTC (« HH:MM »), à partir de maintenant. */
function prochain(heure: string): Date {
  const [h, m] = heure.split(":").map(Number) as [number, number];
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Les valeurs livrées (décision du 2 novembre 2026), que chaque épreuve ajuste. */
const LIVRE = {
  actif: true,
  debut: "01:00",
  fin: "06:00",
  plateforme: "20",
  dossier: "1",
  max: 200,
  part: "0.5",
  alerte: 3,
};

describe("la passe de nuit", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `nuit-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"], max: 3 });
  const archiver: string[] = [];
  let expert: Utilisateur;
  let operateur: Utilisateur;
  let cabinet = "";
  let jour = "";
  let packId = "";
  let service = "";
  let n = 0;
  /** 05:30 UTC : la nuit de Dakar, le matin de Tunis. */
  const NUIT = prochain("05:30");

  const regler = (r: Partial<typeof LIVRE> = {}, motif = "épreuve de la passe de nuit") => {
    const v = { ...LIVRE, ...r };
    return sousIdentite(operateur.id, (db) =>
      db.query(
        `select plateforme.relecture_nuit_regler($1, $2::time, $3::time, $4::numeric, $5::numeric,
                                                  $6, $7::numeric, $8, $9)`,
        [v.actif, v.debut, v.fin, v.plateforme, v.dossier, v.max, v.part, v.alerte, motif],
      ),
    );
  };

  /** La passe telle que le serveur la monte, à l'heure de l'épreuve. */
  const passe = (
    modele: Lecteurs,
    autre: Partial<DependancesDeLaNuit> = {},
  ): DependancesDeLaNuit => ({
    executer: horsRlsAuthentificationSeule,
    avecService: (tenantId) => (travail) => sousLeRelecteurDeNuit(tenantId, travail),
    maintenant: () => NUIT,
    lecteurs: modele,
    lectureFraiche: async () => false,
    ...autre,
  });

  /** Un dossier à Dakar, relecture de nuit active et due tout de suite. */
  async function dossier(): Promise<{ u: Utilisateur; pme: string }> {
    n += 1;
    const u = await creerCompte(`dirigeant-${marque}-${n}@essai.local`, mdp);
    assert.ok(u);
    const mf = matriculeDEssai("A", "M");
    const pme = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'mandate', $2, 'TN', 'TND') as id`,
        [`PME NUIT ${marque} ${n}`, mf],
      );
      return rows[0]!.id;
    });
    archiver.push(pme);
    await admin.query(`update identity.organizations set fuseau = 'Africa/Dakar' where id = $1`, [
      pme,
    ]);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [propose] = await sousIdentite(u.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(u.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    await sousIdentite(expert.id, (db) =>
      parametrage.arreterReglagesComptables(db, {
        cabinetId: cabinet,
        portee: "dossier",
        porteeId: pme,
        packId,
        depuis: jour,
        valeurs: [
          { code: "lecture.sudoku", valeur: "observe" },
          { code: "lecture.relecture_nuit", valeur: "active" },
          { code: "lecture.relecture_delai_heures", valeur: "0.000001" },
        ],
      }),
    );
    return { u, pme };
  }

  async function deposer(u: Utilisateur, pme: string): Promise<string> {
    n += 1;
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
              vis: "entite",
              idempotencyKey: `${marque}-${n}`,
              contentType: "image/jpeg",
              pageCount: 1,
            },
          ],
        },
        "serveur",
      ),
    )) as { id: string };
    // Ses octets, là où le stockage les cherche : le relecteur les relit.
    await mkdir(path.join(racine(), pme), { recursive: true });
    await writeFile(path.join(racine(), pme, p.id), new Uint8Array([0xff, 0xd8, 0xff]));
    return p.id;
  }

  /** Une pièce de la société, lue partielle : sa relecture est inscrite et due. */
  async function luePartielle(u: Utilisateur, pme: string): Promise<string> {
    const piece = await deposer(u, pme);
    await readPieceFlow(
      creerAppelLocal((t) => sousIdentite(u.id, t)),
      piece,
      lecteurs([() => partielle("qwen-vl-ocr")]),
    );
    return piece;
  }

  /** La relecture de la pièce, telle que la base la tient. */
  async function relecture(pieceId: string) {
    const { rows } = await admin.query<{
      id: string;
      etat: string;
      tentatives: number;
      dernier_motif: string | null;
    }>(
      `select e.travail_id as id, e.etat, e.tentatives, e.dernier_motif
         from fabrique.etat_des_travaux_v e
        where e.piece_id = $1 and e.nature = 'relecture_piece'`,
      [pieceId],
    );
    assert.equal(rows.length, 1, "une relecture inscrite");
    return rows[0]!;
  }

  const compter = async (sql: string, params: unknown[]) =>
    Number((await admin.query<{ n: string }>(sql, params)).rows[0]!.n);

  /** Une fonction de l'ordonnanceur, sous le rôle de l'API — comme le serveur l'appelle. */
  const ordonnanceur = <T>(sql: string, params: unknown[] = []) =>
    horsRlsAuthentificationSeule(async (db) => (await db.query<{ r: T }>(sql, params)).rows[0]!.r);

  before(async () => {
    process.env["STOCKAGE_RACINE"] = await mkdtemp(path.join(tmpdir(), "malica-nuit-"));
    const e = await creerCompte(`expert-${marque}@essai.local`, mdp);
    const o = await creerCompte(`operateur-${marque}@essai.local`, mdp);
    assert.ok(e && o);
    expert = e;
    operateur = o;
    await admin.query(`insert into app.platform_operators (user_id, note) values ($1, $2)`, [
      operateur.id,
      "épreuve de la passe de nuit",
    ]);
    cabinet = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('cabinet', $1, 'mandate', null, 'TN', 'TND') as id`,
        [`CABINET NUIT ${marque}`],
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
    service = (
      await admin.query<{ id: string }>(
        `select id from identity.comptes_de_service where code = 'relecteur_de_nuit'`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    try {
      // La passe repart coupée, aux valeurs livrées : la base d'essai est partagée.
      await regler({ actif: false }, "fin de l'épreuve de la passe de nuit");
      await admin.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = any($1)`,
        [archiver],
      );
      await admin.query(`delete from app.platform_operators where user_id = $1`, [operateur.id]);
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("livrée coupée : la ligne initiale est inactive, et rien ne s'ouvre tant qu'elle vaut", async () => {
    const { rows } = await admin.query<{ actif: boolean; decide_le: Date }>(
      `select actif, decide_le from plateforme.reglages_relecture_nuit
        order by decide_le, id limit 1`,
    );
    assert.equal(rows[0]?.actif, false);
    assert.equal(rows[0]?.decide_le.toISOString(), "2026-11-02T00:00:00.000Z");
    await regler({ actif: false });
    const bilan = await tourDeNuit(passe(lecteurs([])));
    assert.equal(bilan.passage, null, "aucun passage ouvert");
  });

  describe("la fenêtre, à l'heure locale du dossier", () => {
    let tunis = "";
    let dakar = "";

    before(async () => {
      await regler();
      ({ pme: dakar } = await dossier());
      ({ pme: tunis } = await dossier());
      // Le fuseau de sa juridiction : Tunis.
      await admin.query(`update identity.organizations set fuseau = null where id = $1`, [tunis]);
    });

    const dans = (tenant: string, a: string) =>
      ordonnanceur<boolean>("select app.dans_la_fenetre_de_nuit($1, $2::timestamptz) as r", [
        tenant,
        a,
      ]);

    for (const [a, aTunis, aDakar] of [
      ["2026-11-10T00:30:00Z", true, false],
      ["2026-11-10T04:59:00Z", true, true],
      ["2026-11-10T05:00:00Z", false, true],
      ["2026-11-10T05:30:00Z", false, true],
      ["2026-11-10T06:00:00Z", false, false],
    ] as const) {
      it(`${a} : Tunis ${aTunis ? "dedans" : "dehors"}, Dakar ${aDakar ? "dedans" : "dehors"}`, async () => {
        assert.equal(await dans(tunis, a), aTunis);
        assert.equal(await dans(dakar, a), aDakar);
      });
    }

    it("une fenêtre qui passe minuit", async () => {
      const f = async (h: string) =>
        (
          await admin.query<{ r: boolean }>(
            `select app.heure_dans_la_fenetre($1::time, time '22:00', time '02:00') as r`,
            [h],
          )
        ).rows[0]!.r;
      assert.deepEqual(
        [await f("21:59"), await f("22:00"), await f("23:30"), await f("01:59"), await f("02:00")],
        [false, true, true, true, false],
      );
    });

    it("sans fuseau, le dossier est écarté et le motif le dit — jamais une heure UTC", async () => {
      const client = await admin.connect();
      try {
        await client.query("begin");
        await client.query(
          `update identity.organizations set fuseau = null, jurisdiction = 'ZZ' where id = $1`,
          [tunis],
        );
        await assert.rejects(
          client.query("select app.dans_la_fenetre_de_nuit($1, now())", [tunis]),
          /refus\.fuseau\.dossier_non_defini/,
        );
      } finally {
        await client.query("rollback");
        client.release();
      }
    });
  });

  describe("de bout en bout, sous le relecteur", () => {
    let u: Utilisateur;
    let pme = "";

    before(async () => {
      await regler();
      ({ u, pme } = await dossier());
    });

    it("retenue : une lecture nouvelle, le relecteur pour acteur partout, aucune lecture décomptée", async () => {
      // Une jumelle déjà lue en entier : le jugement de la relecture la cherche
      // parmi les AUTRES pièces du dossier (doublon probable).
      const jumelle = await deposer(u, pme);
      await readPieceFlow(
        creerAppelLocal((t) => sousIdentite(u.id, t)),
        jumelle,
        lecteurs([() => numerotee(complete("qwen-vl-ocr", TOKENS_DE_L_AUTRE))]),
      );
      const piece = await luePartielle(u, pme);
      const decomptees = await compter(
        `select count(*) as n from facturation.lectures where piece_id = $1`,
        [piece],
      );
      const modele = lecteurs([() => numerotee(complete("PP-OCR", TOKENS_DE_L_AUTRE))]);

      const bilan = await tourDeNuit(passe(modele));

      assert.ok(bilan.passage);
      assert.equal(bilan.raison, "termine");
      assert.equal(modele.appels, 1, "l'autre lecteur a relu");
      const r = await relecture(piece);
      assert.equal(r.etat, "termine");
      assert.equal(r.dernier_motif, "relecture.retenue");
      assert.equal(
        await compter(`select count(*) as n from capture.extractions where piece_id = $1`, [piece]),
        2,
        "une lecture NOUVELLE (R7)",
      );
      assert.equal(
        await compter(`select count(*) as n from facturation.lectures where piece_id = $1`, [
          piece,
        ]),
        decomptees,
        "ALGORIA paie : rien ne se décompte",
      );
      // Le jugement posé sous le relecteur est celui qu'un membre qui voit tout
      // rendrait : rejugée par le dirigeant, la pièce ne change pas.
      const rejuge = await sousIdentiteDuServeur(u.id, (db) => rejugerLaPiece(db, piece));
      assert.equal(rejuge.change, false, "même verdict, mêmes motifs, même doublon");
      const { rows: jugement } = await admin.query<{ numero: string | null; motifs: string }>(
        `select a.doublon_numero as numero, a.motifs::text as motifs from capture.analyses a
          where a.piece_id = $1 order by a.created_at desc limit 1`,
        [piece],
      );
      assert.ok(jugement[0]?.numero, "la relecture a une clé de doublon");
      assert.match(jugement[0]!.motifs, /"code": "doublon"/, "et le relecteur a vu sa jumelle");
      // L'acteur : le relecteur, dans la file et dans l'audit.
      const { rows: faits } = await admin.query<{ inscrit_par: string }>(
        `select distinct inscrit_par from fabrique.travail_faits where travail_id = $1`,
        [r.id],
      );
      assert.deepEqual(
        faits.map((f) => f.inscrit_par),
        [service],
      );
      const { rows: audit } = await admin.query<{ actor: string }>(
        `select e.actor from audit.event_log e
          where e.action = 'piece.read' and e.payload ->> 'relecture' = $1`,
        [r.id],
      );
      assert.deepEqual(
        audit.map((a) => a.actor),
        [service],
      );
      // Le passage est fermé, ses compteurs inscrits.
      const { rows: p } = await admin.query<{ nature: string; detail: { retenues: number } }>(
        `select nature, detail from fabrique.passage_faits where passage_id = $1 and nature <> 'ouvert'`,
        [bilan.passage],
      );
      assert.equal(p[0]?.nature, "termine");
      assert.equal(p[0]?.detail.retenues, bilan.retenues);
    });

    it("écartée : la lecture d'avant reste", async () => {
      const piece = await luePartielle(u, pme);
      const bilan = await tourDeNuit(
        passe(lecteurs([() => partielle("PP-OCR", TOKENS_DE_L_AUTRE)])),
      );
      assert.equal(bilan.ecartees, 1);
      assert.equal((await relecture(piece)).dernier_motif, "relecture.ecartee");
      assert.equal(
        await compter(`select count(*) as n from capture.extractions where piece_id = $1`, [piece]),
        1,
      );
    });

    it("une correction humaine : abstention, sans appel payant", async () => {
      const piece = await luePartielle(u, pme);
      await sousIdentite(u.id, (db) =>
        executerRpc(db, {
          depot: "capture",
          methode: "preciser",
          args: [piece, "document_date", "2026-09-02"],
        }),
      );
      const modele = lecteurs([]);
      const bilan = await tourDeNuit(passe(modele));
      assert.equal(modele.appels, 0);
      assert.equal(bilan.abstentions, 1);
      assert.equal(
        (await relecture(piece)).dernier_motif,
        "relecture.abstention.correction_humaine",
      );
    });

    it("hors de la fenêtre du dossier, rien ne démarre : le travail reste à faire", async () => {
      const piece = await luePartielle(u, pme);
      const bilan = await tourDeNuit(passe(lecteurs([]), { maintenant: () => prochain("07:30") }));
      assert.ok((bilan.ecarts["hors_fenetre"] ?? 0) >= 1);
      assert.deepEqual((({ etat, tentatives }) => ({ etat, tentatives }))(await relecture(piece)), {
        etat: "a_faire",
        tentatives: 0,
      });
      // Elle part la nuit suivante.
      const ensuite = await tourDeNuit(
        passe(lecteurs([() => complete("PP-OCR", TOKENS_DE_L_AUTRE)])),
      );
      assert.equal(ensuite.retenues, 1);
    });
  });

  describe("les plafonds", () => {
    let u: Utilisateur;
    let pme = "";

    before(async () => {
      ({ u, pme } = await dossier());
    });
    after(async () => {
      await regler();
      // Ses relectures restées à faire ne se mêlent pas aux passages suivants :
      // un dossier archivé ne se relit plus.
      await admin.query(
        `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
        [pme],
      );
    });

    it("le plafond du dossier : le travail n'est pas pris, aucune tentative consommée", async () => {
      await regler({ dossier: "0" });
      const piece = await luePartielle(u, pme);
      const bilan = await tourDeNuit(passe(lecteurs([])));
      assert.ok((bilan.ecarts["plafond.dossier"] ?? 0) >= 1);
      assert.equal(bilan.raison, "termine");
      assert.deepEqual((({ etat, tentatives }) => ({ etat, tentatives }))(await relecture(piece)), {
        etat: "a_faire",
        tentatives: 0,
      });
    });

    it("le plafond de la plateforme ferme le passage « plafond »", async () => {
      await regler({ plateforme: "0" });
      const piece = await luePartielle(u, pme);
      const bilan = await tourDeNuit(passe(lecteurs([])));
      assert.equal(bilan.raison, "plafond");
      assert.equal((await relecture(piece)).tentatives, 0);
    });

    it("le nombre de relectures sur 24 h", async () => {
      await regler({ max: 0 });
      assert.equal(
        await ordonnanceur<string | null>("select fabrique.relecture_nuit_budget($1, $2) as r", [
          pme,
          NUIT,
        ]),
        "plafond.relectures",
      );
    });

    it("ALGORIA paie : la nuit ne mange pas le budget du client, ni le client celui de la nuit", async () => {
      await regler({ part: "0.5", dossier: "100" });
      const autre = await dossier();
      const budget = () =>
        ordonnanceur<string | null>("select fabrique.relecture_nuit_budget($1, $2) as r", [
          autre.pme,
          NUIT,
        ]);
      const depenseDuClient = async () =>
        Number(
          (
            await admin.query<{ d: string }>(`select app.depense_ia_du_mois($1)::text as d`, [
              autre.pme,
            ])
          ).rows[0]!.d,
        );
      const depenser = (cout: number, par: string) =>
        admin.query(
          `insert into agents.agent_runs (tenant_id, agent, model, sovereign, cost, status, created_by)
           values ($1, 'lecture', 'essai', false, $2, 'ok', $3)`,
          [autre.pme, cout, par],
        );
      // Un plafond mensuel de 4 $ pour le dossier : la nuit s'arrête à 2 $.
      await admin.query(
        `insert into agents.budgets (tenant_id, monthly_cost_cap) values ($1, 4)
         on conflict (tenant_id) do update set monthly_cost_cap = 4`,
        [autre.pme],
      );
      // Trois dollars dépensés en journée par le dirigeant : son budget, pas celui de la nuit.
      await depenser(3, autre.u.id);
      assert.equal(await depenseDuClient(), 3);
      assert.equal(await budget(), null, "la dépense du client ne ferme pas la nuit");
      // Deux dollars dépensés par le relecteur : la moitié du plafond, la nuit s'arrête…
      await depenser(2, service);
      assert.equal(await budget(), "plafond.mensuel");
      // … et le budget de l'assistant du client n'a pas bougé.
      assert.equal(await depenseDuClient(), 3, "ALGORIA paie : rien ne s'impute au client");
      // Le plafond de nuit du dossier, sur 24 h, ne voit que le relecteur.
      await regler({ part: "1", dossier: "2" });
      assert.equal(await budget(), "plafond.dossier");
      await regler({ part: "1", dossier: "2.5" });
      assert.equal(await budget(), null, "les 3 $ du dirigeant n'y comptent pas");
    });
  });

  describe("priorité, concurrence, reprise", () => {
    let u: Utilisateur;
    let pme = "";

    before(async () => {
      await regler();
      ({ u, pme } = await dossier());
    });

    it("une lecture fraîche attend : la passe cède, sans prendre de relecture", async () => {
      const piece = await luePartielle(u, pme);
      const bilan = await tourDeNuit(passe(lecteurs([]), { lectureFraiche: async () => true }));
      assert.equal(bilan.raison, "cede");
      assert.equal((await relecture(piece)).tentatives, 0);
      // La base le voit d'elle-même : une lecture demandée à l'instant.
      const fraiche = await deposer(u, pme);
      await sousIdentiteDuServeur(u.id, (db) =>
        enregistrerTravail(db, {
          tenantId: pme,
          pieceId: fraiche,
          nature: "lecture_piece",
          cleIdempotence: `lecture_piece:${fraiche}`,
        }),
      );
      assert.equal(
        await ordonnanceur<boolean>("select fabrique.lectures_en_attente(now()) as r"),
        true,
      );
      // Et la relecture part une fois la voie libre.
      const ensuite = await tourDeNuit(
        passe(lecteurs([() => complete("PP-OCR", TOKENS_DE_L_AUTRE)])),
      );
      assert.equal(ensuite.retenues, 1);
    });

    it("la tour coupe la passe pendant un passage : la relecture suivante n'est pas prise", async () => {
      // Deux dossiers, une relecture due chacun : un passage les prendrait toutes
      // les deux dans le même tour. La tour coupe pendant la première.
      const premiere = await luePartielle(u, pme);
      const autre = await dossier();
      const seconde = await luePartielle(autre.u, autre.pme);
      let appels = 0;
      const coupeEnRoute: Lecteurs = {
        lire: async () => {
          appels += 1;
          await regler({ actif: false }, "coupée pendant le passage");
          return numerotee(complete("PP-OCR", TOKENS_DE_L_AUTRE));
        },
        secondLecteurDisponible: () => true,
      };
      try {
        const bilan = await tourDeNuit(passe(coupeEnRoute));

        assert.equal(appels, 1, "un seul modèle payé");
        assert.equal(bilan.raison, "coupe");
        assert.equal((await relecture(premiere)).dernier_motif, "relecture.retenue");
        assert.deepEqual(
          (({ etat, tentatives }) => ({ etat, tentatives }))(await relecture(seconde)),
          { etat: "a_faire", tentatives: 0 },
          "la seconde attend, sans tentative brûlée",
        );
        const { rows } = await admin.query<{ nature: string }>(
          `select nature from fabrique.passage_faits where passage_id = $1 and nature <> 'ouvert'`,
          [bilan.passage],
        );
        assert.deepEqual(
          rows.map((r) => r.nature),
          ["coupe"],
        );
      } finally {
        await regler();
      }
      // Rouverte, la passe reprend la seconde.
      const ensuite = await tourDeNuit(
        passe(lecteurs([() => numerotee(complete("PP-OCR", TOKENS_DE_L_AUTRE))])),
      );
      assert.equal(ensuite.retenues, 1);
    });

    it("deux tics en même temps : un seul passage", async () => {
      const cle = await ordonnanceur<string>("select fabrique.passe_de_nuit_verrou()::text as r");
      const un = () => sousVerrouDeSession(cle, () => tourDeNuit(passe(lecteurs([]))));
      const [a, b] = await Promise.all([un(), un()]);
      assert.equal([a, b].filter((x) => x === null).length, 1, "l'un des deux n'a rien ouvert");
    });

    it("un processus tué pendant une relecture : le passage est « interrompu », la relecture reprend", async () => {
      const piece = await luePartielle(u, pme);
      const r = await relecture(piece);
      // La prise d'un passage mort il y a une heure, jamais terminée.
      const mort = await ordonnanceur<string>("select fabrique.passe_de_nuit_ouvrir($1) as r", [
        new Date(Date.now() - 3_600_000),
      ]);
      await admin.query(
        `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature, inscrit_par,
                                             inscrit_le)
         values ($1, $2, 1, 'pris', $3, now() - interval '1 hour')`,
        [pme, r.id, service],
      );
      assert.equal((await relecture(piece)).etat, "abandonne");

      const bilan = await tourDeNuit(
        passe(lecteurs([() => complete("PP-OCR", TOKENS_DE_L_AUTRE)])),
      );

      assert.equal(bilan.retenues, 1);
      assert.deepEqual((({ etat, tentatives }) => ({ etat, tentatives }))(await relecture(piece)), {
        etat: "termine",
        tentatives: 2,
      });
      const raison = await sousIdentite(operateur.id, async (db) => {
        const { rows } = await db.query<{ raison: string }>(
          `select raison from plateforme.passages_de_nuit_v where id = $1`,
          [mort],
        );
        return rows[0]?.raison;
      });
      assert.equal(raison, "interrompu");
    });

    it("les tentatives épuisées se voient à la tour", async () => {
      const piece = await luePartielle(u, pme);
      const r = await relecture(piece);
      const max = Number(
        (
          await admin.query<{ valeur: string }>(
            `select valeur from fabrique.bornes_de_travail($1) where borne = 'tentatives_max'`,
            [pme],
          )
        ).rows[0]!.valeur,
      );
      for (let t = 1; t <= max; t += 1) {
        await admin.query(
          `insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature, motif,
                                               inscrit_par, inscrit_le)
           values ($1, $2, $3, 'pris', null, $4, now() - interval '1 day'),
                  ($1, $2, $3, 'panne_fournisseur', 'essai', $4, now() - interval '1 day')`,
          [pme, r.id, t, service],
        );
      }
      assert.equal((await relecture(piece)).etat, "epuise");
      const vu = await sousIdentite(operateur.id, async (db) => {
        const { rows } = await db.query<{ epuisees: number }>(
          `select coalesce(sum(epuisees), 0)::int as epuisees from plateforme.relectures_de_nuit_v
            where tenant_id = $1`,
          [pme],
        );
        return rows[0]!.epuisees;
      });
      assert.ok(vu >= 1, "la tour la voit");
      // Et un membre ne lit rien de cette vue.
      const membre = await sousIdentite(u.id, async (db) => {
        const { rows } = await db.query(`select 1 from plateforme.relectures_de_nuit_v`);
        return rows.length;
      });
      assert.equal(membre, 0);
    });
  });

  describe("le relecteur ne voit pas plus que l'auteur de la pièce relue", () => {
    it("la relecture de Sami ne se rapproche pas des factures de Sonia qu'il ne voit pas (PRIVÉE ou de la société)", async () => {
      await regler();
      const s = await monterUneSociete(`nuit-privee-${Date.now()}`);
      try {
        await admin.query(
          `update identity.organizations set fuseau = 'Africa/Dakar' where id = $1`,
          [s.pme],
        );
        const jourDuCabinet = (
          await sousIdentite(s.gens.expert.id, (db) => parametrage.fuseauDuCabinet(db, s.cabinet))
        ).aujourdhui!;
        await sousIdentite(s.gens.expert.id, (db) =>
          parametrage.arreterReglagesComptables(db, {
            cabinetId: s.cabinet,
            portee: "dossier",
            porteeId: s.pme,
            packId: s.pack,
            depuis: jourDuCabinet,
            valeurs: [
              { code: "lecture.sudoku", valeur: "observe" },
              { code: "lecture.relecture_nuit", valeur: "active" },
              { code: "lecture.relecture_delai_heures", valeur: "0.000001" },
            ],
          }),
        );
        const octets = async (id: string) => {
          await mkdir(path.join(racine(), s.pme), { recursive: true });
          await writeFile(path.join(racine(), s.pme, id), new Uint8Array([0xff, 0xd8, 0xff]));
        };
        // Sonia lit sa facture, puis la range dans son espace privé.
        const privee = await s.deposer("sonia", "entite");
        await octets(privee);
        await readPieceFlow(
          creerAppelLocal((t) => sousIdentite(s.gens.sonia.id, t)),
          privee,
          lecteurs([() => numerotee(complete("qwen-vl-ocr", TOKENS_DE_L_AUTRE))]),
        );
        await s.fait("sonia", "collab.setPieceVis", privee, "personnel");
        // Et une copie de la société, que Sami (sans `societe.tout_voir`) ne voit
        // pas davantage (Codex, PR #200).
        const deLaSociete = await s.deposer("sonia", "entite");
        await octets(deLaSociete);
        await readPieceFlow(
          creerAppelLocal((t) => sousIdentite(s.gens.sonia.id, t)),
          deLaSociete,
          lecteurs([() => numerotee(complete("qwen-vl-ocr", TOKENS_DE_L_AUTRE))]),
        );
        // Sami lit la même facture, imparfaitement : sa relecture est due.
        const piece = await s.deposer("sami", "entite");
        await octets(piece);
        await readPieceFlow(
          creerAppelLocal((t) => sousIdentite(s.gens.sami.id, t)),
          piece,
          lecteurs([() => partielle("qwen-vl-ocr")]),
        );

        await tourDeNuit(passe(lecteurs([() => numerotee(complete("PP-OCR", TOKENS_DE_L_AUTRE))])));

        assert.equal((await relecture(piece)).dernier_motif, "relecture.retenue");
        const { rows } = await admin.query<{ motifs: string; controles: string }>(
          `select a.motifs::text as motifs, a.controles::text as controles from capture.analyses a
            where a.piece_id = $1 order by a.created_at desc limit 1`,
          [piece],
        );
        assert.doesNotMatch(rows[0]!.motifs, /"code": "doublon"/, "Sami ne voit aucune des deux");
        for (const id of [privee, deLaSociete]) {
          assert.ok(
            !rows[0]!.motifs.includes(id) && !rows[0]!.controles.includes(id),
            "et leur identifiant ne fuit nulle part",
          );
        }
        // Sous le relecteur, la pièce privée de Sonia n'est pas lisible.
        const vues = await sousLeRelecteurDeNuit(
          s.pme,
          async (db) =>
            (await db.query(`select 1 from capture.pieces where id = $1`, [privee])).rows,
        );
        assert.equal(vues.length, 0);
      } finally {
        await s.fermer();
      }
    });
  });
});
