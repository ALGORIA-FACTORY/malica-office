/**
 * Une lecture qui échoue ne se facture pas — et une lecture rendue se facture
 * une fois.
 *
 * C'est le seul endroit de la livraison où une erreur coûte de l'argent réel :
 * une lecture comptée qui n'a rien rendu est un prélèvement sans contrepartie,
 * une lecture rendue et non comptée est un service offert à l'insu de tous.
 *
 * Cette épreuve n'éprouve PAS le plafond (voir `facturation/le-plafond-*`) : elle
 * éprouve le BRANCHEMENT — que `readPieceFlow` interroge la base avant le
 * premier appel payant, et ne compte qu'une lecture arrivée à son terme.
 *
 * Les deux organes payants sont des faux qui comptent leurs appels ; tout le
 * reste (contexte, persistance, analyse, compteur) est la vraie base. Le
 * décor des 65 lectures déjà comptées est monté sous `postgres` : seule
 * `lecture_consommer` écrit pour un utilisateur.
 *
 * R7 : `facturation.lectures` est en ajout seul ; les organisations d'essai
 * s'archivent, elles ne se suppriment pas.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, emettreJeton, type Utilisateur } from "../../auth.ts";
import { fermerLePool, sousIdentite } from "../../db.ts";
import { executerRpc } from "../../rpc.ts";
import { creerAppelLocal, type AppelApi } from "../appel-local.ts";

import { LectureRefusee, readPieceFlow } from "./read-flow.ts";
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

/** Une facture que le contrat accepte en entier : extract.v1. */
function lectureComplete(readModel: string): VisionRead {
  const selection = {
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
  } as unknown as VisionSelection;
  return lecture(readModel, selection);
}

/** Une facture dont l'émetteur n'est pas désigné : le contrat sort partiel. */
function lecturePartielle(readModel: string): VisionRead {
  const complete = lectureComplete(readModel);
  return lecture(readModel, { ...complete.selection, issuer: null, document_date: null });
}

function lecture(readModel: string, selection: VisionSelection): VisionRead {
  const passe = { latencyMs: 1, tokensIn: null, tokensOut: null };
  return {
    tokens: TOKENS,
    selection,
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

/** Des lecteurs qui comptent leurs appels, et rendent ce qu'on leur donne. */
function lecteurs(
  reponses: Array<() => VisionRead>,
  secondDisponible = true,
): Lecteurs & { appels: number } {
  const l = {
    appels: 0,
    lire: async () => {
      const suivante = reponses[l.appels];
      l.appels += 1;
      if (!suivante) throw new Error("appel de modèle imprévu");
      return suivante();
    },
    secondLecteurDisponible: () => secondDisponible,
  };
  return l;
}

/** Des lecteurs qu'aucune lecture ne doit jamais atteindre. */
function lecteursInterdits(): Lecteurs & { appels: number } {
  const l = {
    appels: 0,
    lire: async (): Promise<VisionRead> => {
      l.appels += 1;
      throw new Error("un modèle payant a été appelé alors que la lecture était refusée");
    },
    secondLecteurDisponible: () => {
      l.appels += 1;
      return true;
    },
  };
  return l;
}

describe("une lecture qui échoue ne se facture pas", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `compteur-${Date.now()}`;
  let u: Utilisateur;
  let orgLibre = "";
  let orgPleine = "";
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  const admin = new pg.Pool({
    connectionString: process.env["DATABASE_URL_ADMIN"],
    max: 1,
  });

  /** L'API réelle, sauf le contenu : la pièce n'a pas d'octets sur disque. */
  function apiDEssai(surcharges: Partial<AppelApi> = {}): AppelApi {
    return {
      ...creerAppelLocal(u.id),
      contenu: async () => ({ octets: new Uint8Array([1, 2, 3]), type: "image/jpeg" }),
      ...surcharges,
    };
  }

  /** Une API dont l'appel `depot.methode` lève, le reste étant réel. */
  function apiQuiLeveSur(methode: string): AppelApi {
    const reelle = apiDEssai();
    return {
      ...reelle,
      rpc: (depot, m, args) =>
        m === methode ? Promise.reject(new Error(`${m} refusée`)) : reelle.rpc(depot, m, args),
    };
  }

  async function deposer(tenantId: string, cle: string, vis: "personnel" | "partage") {
    const p = (await sousIdentite(u.id, (db) =>
      executerRpc(db, {
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId,
            source: "photo",
            vis,
            idempotencyKey: `${marque}-${cle}`,
            contentType: "image/jpeg",
            pageCount: 1,
          },
        ],
      }),
    )) as { id: string };
    return p.id;
  }

  async function compter(pieceId: string): Promise<number> {
    const { rows } = await admin.query<{ n: string }>(
      "select count(*) as n from facturation.lectures where piece_id = $1",
      [pieceId],
    );
    return Number(rows[0]!.n);
  }

  async function verdictDeLaBase(pieceId: string) {
    return sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ v: { autorisee: boolean; motif: string } }>(
        "select public.lecture_autorisee($1) as v",
        [pieceId],
      );
      return rows[0]!.v;
    });
  }

  async function nouvelleOrganisation(nom: string): Promise<string> {
    return sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome',
                                           '1876543W/A/M/000', 'TN', 'TND') as id`,
        [nom],
      );
      return rows[0]!.id;
    });
  }

  async function licencier(tenantId: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `insert into facturation.licences (titulaire, offre_code, offre_depuis)
       values ($1, 'basic', date '2026-10-17') returning id`,
      [u.id],
    );
    const id = rows[0]!.id;
    await admin.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [id, tenantId],
    );
    return id;
  }

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;

    // La vraie application : un refus se juge sur ce que le réseau en voit.
    const { app } = await import("../../app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));

    orgLibre = await nouvelleOrganisation(`Compteur libre ${marque}`);
    await licencier(orgLibre);

    // Une organisation au plafond : 65 lectures déjà comptées sur 65. Le droit
    // n'est pas écrit ici — la base le connaît ; on remplit jusqu'à ce qu'elle
    // dise non, puis on le vérifie dans l'épreuve.
    orgPleine = await nouvelleOrganisation(`Compteur plein ${marque}`);
    const licencePleine = await licencier(orgPleine);
    await admin.query(
      `with neuves as (
         insert into capture.pieces
           (tenant_id, vis, source, storage_path, status, idempotency_key, created_by)
         select $1, 'partage', 'photo', 'q/' || i, 'lue', $3 || '-deja-' || i, $2
           from generate_series(1, 65) as i
         returning id
       )
       insert into facturation.lectures (tenant_id, licence_id, piece_id, periode, consommee_par)
       select $1, $4, id, date_trunc('month', current_date)::date, $2 from neuves`,
      [orgPleine, u.id, marque, licencePleine],
    );
  });

  after(async () => {
    await admin.query(
      `update identity.organizations set archived_at = now(),
              archived_reason = 'fixture de test automatisé' where id = any($1)`,
      [[orgLibre, orgPleine]],
    );
    if (arret) await arret();
    await admin.end();
    await fermerLePool();
  });

  it("une lecture qui lève (modèle indisponible) ne laisse aucune ligne", async () => {
    const piece = await deposer(orgLibre, "modele-en-panne", "partage");
    const modele = lecteurs([
      () => {
        throw new Error("modèle indisponible");
      },
    ]);

    await assert.rejects(readPieceFlow(apiDEssai(), piece, modele), /modèle indisponible/);

    assert.equal(modele.appels, 1, "le modèle a bien été tenté");
    assert.equal(await compter(piece), 0, "rien n'a été rendu, rien n'est compté");
  });

  it("une persistance refusée ne laisse aucune ligne : le compteur vient APRÈS", async () => {
    const piece = await deposer(orgLibre, "persistance-refusee", "partage");
    const modele = lecteurs([() => lectureComplete("pdf-text")]);

    await assert.rejects(
      readPieceFlow(apiQuiLeveSur("persisterLecture"), piece, modele),
      /persisterLecture refusée/,
    );

    assert.equal(modele.appels, 1, "le modèle a été payé, et c'est ce que l'ordre protège");
    assert.equal(await compter(piece), 0, "mais la personne n'a rien reçu");
  });

  it("une analyse qui lève après la persistance ne laisse aucune ligne non plus", async () => {
    const piece = await deposer(orgLibre, "analyse-refusee", "partage");
    const modele = lecteurs([() => lectureComplete("pdf-text")]);

    await assert.rejects(
      readPieceFlow(apiQuiLeveSur("analyser"), piece, modele),
      /analyser refusée/,
    );

    assert.equal(await compter(piece), 0, "le comptage est le dernier geste avant de rendre");
  });

  it("une lecture qui aboutit laisse exactement une ligne", async () => {
    const piece = await deposer(orgLibre, "aboutie", "partage");
    const modele = lecteurs([() => lectureComplete("pdf-text")]);

    const rendu = await readPieceFlow(apiDEssai(), piece, modele);

    assert.equal(rendu.contract, "extract.v1", "le décor est bien une lecture complète");
    assert.equal(modele.appels, 1);
    assert.equal(await compter(piece), 1);
  });

  it("le rattrapage lit deux fois mais ne compte qu'une lecture", async () => {
    const piece = await deposer(orgLibre, "rattrapee", "partage");
    const modele = lecteurs([
      () => lecturePartielle("qwen-vl-ocr"),
      () => lectureComplete("PP-OCR"),
    ]);

    const rendu = await readPieceFlow(apiDEssai(), piece, modele);

    assert.equal(modele.appels, 2, "la pièce a bien été relue par l'autre lecteur");
    assert.equal(rendu.contract, "extract.v1", "et c'est la seconde lecture qui a été retenue");
    assert.equal(await compter(piece), 1, "une pièce lue, une lecture comptée — jamais deux");
  });

  it("une pièce déjà lue est refusée AVANT tout modèle, et reste comptée une fois", async () => {
    const piece = await deposer(orgLibre, "relue", "partage");
    await readPieceFlow(apiDEssai(), piece, lecteurs([() => lectureComplete("pdf-text")]));
    assert.equal(await compter(piece), 1);

    /*
     * Avant la ronde de correction 1, la base répondait `relecture_gratuite`
     * (autorisée) ; le modèle était appelé et PAYÉ, puis la persistance
     * refusait la seconde lecture (R7) : « cette pièce a déjà été lue ».
     * Dépense sans résultat. La porte dit désormais non avant le modèle.
     */
    const attendu = await verdictDeLaBase(piece);
    assert.equal(attendu.autorisee, false);
    assert.equal(attendu.motif, "piece_deja_lue");
    const modele = lecteursInterdits();

    await assert.rejects(readPieceFlow(apiDEssai(), piece, modele), (e: unknown) => {
      assert.ok(e instanceof LectureRefusee);
      assert.equal(e.motif, attendu.motif, "le motif de la base, mot pour mot");
      return true;
    });

    assert.equal(modele.appels, 0, "aucun appel payant");
    assert.equal(await compter(piece), 1, "toujours une seule lecture comptée");
  });

  it("un refus d'arrière-plan s'inscrit : le motif de la base reste lisible, la capture intacte", async () => {
    const piece = await deposer(orgPleine, "arriere-plan", "partage");
    const attendu = await verdictDeLaBase(piece);
    assert.equal(attendu.autorisee, false);
    const jeton = emettreJeton(u);

    // Ce que fait la file hors ligne : la lecture part sans qu'on l'attende.
    const reponse = await fetch(`${base}/malica/lectures/${piece}?attendre=0`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jeton}` },
    });
    assert.equal(reponse.status, 200, "la route répond avant la lecture, comme avant");

    /*
     * ============================ CE QU'ON ATTEND A CHANGÉ, ET C'EST LE POINT
     *
     * On attendait que la pièce quitte le REGISTRE EN MÉMOIRE. C'était le
     * seul signal qui existait, et il valait ce que vaut une promesse dans un
     * processus : rien si le processus meurt, et rien non plus tant que la
     * promesse n'a pas commencé — ce qui rendait l'attente fausse dès que la
     * lecture ne démarrait plus dans le tour de boucle de la réponse.
     *
     * Depuis le 19 octobre, l'accusé porte un `travailId` INSCRIT en base
     * avant d'être rendu, et son état se demande. C'est ce que l'écran fera,
     * et c'est donc ce que cette épreuve attend : le dernier fait du travail,
     * pas une promesse.
     */
    const { travailId } = (await reponse.json()) as { travailId: string };
    assert.ok(travailId, "l'accusé porte le travail inscrit, pas une promesse");

    const TERMINAUX = ["termine", "refuse", "en_erreur", "en_panne", "epuise", "abandonne"];
    for (let i = 0; i < 200; i++) {
      const etat = (await sousIdentite(u.id, (db) =>
        executerRpc(db, { depot: "fabrique", methode: "etatDeLaLecture", args: [travailId] }),
      )) as { etat: string } | null;
      if (etat && TERMINAUX.includes(etat.etat)) break;
      await new Promise((resoudre) => setTimeout(resoudre, 50));
    }

    const dossier = (await sousIdentite(u.id, (db) =>
      executerRpc(db, { depot: "capture", methode: "dossier", args: [piece] }),
    )) as { lectureRefusee: { motif: string } | null; extraction: unknown };
    assert.ok(dossier.lectureRefusee, "le refus est lisible après coup, il n'est pas avalé");
    assert.equal(dossier.lectureRefusee.motif, attendu.motif, "le code de la base, mot pour mot");

    const liste = (await sousIdentite(u.id, (db) =>
      executerRpc(db, { depot: "capture", methode: "listAvecLecture", args: [orgPleine] }),
    )) as Array<{ id: string; status: string; lectureRefusee: { motif: string } | null }>;
    const ligne = liste.find((p) => p.id === piece);
    assert.ok(ligne, "la capture a réussi : la pièce existe");
    assert.equal(ligne.status, "capturee", "… et elle est seulement non lue");
    assert.equal(ligne.lectureRefusee?.motif, attendu.motif);
    assert.equal(dossier.extraction, null);
    assert.equal(await compter(piece), 0, "aucune lecture comptée");

    // Une pièce non refusée n'en porte pas.
    const autre = liste.find((p) => p.id !== piece && p.lectureRefusee === null);
    assert.ok(autre, "les pièces non refusées restent sans motif");
  });

  it("un refus de lecture est un 4xx qui porte le motif de la base", async () => {
    const lue = await deposer(orgLibre, "http-lue", "partage");
    await readPieceFlow(apiDEssai(), lue, lecteurs([() => lectureComplete("pdf-text")]));
    const privee = await deposer(orgLibre, "http-privee", "personnel");
    const auDela = await deposer(orgPleine, "http-au-dela", "partage");

    for (const piece of [lue, privee, auDela]) {
      const attendu = await verdictDeLaBase(piece);
      const reponse = await fetch(`${base}/malica/lectures/${piece}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${emettreJeton(u)}` },
      });
      const corps = (await reponse.json()) as { erreur?: string; motif?: string };

      assert.ok(
        reponse.status >= 400 && reponse.status < 500,
        `un refus n'est pas une panne : ${reponse.status}`,
      );
      assert.equal(corps.motif, attendu.motif);
      assert.equal(corps.erreur, attendu.motif, "lisible par l'écran comme par la file");
    }
  });

  it("au plafond, la chaîne s'arrête avant tout appel de modèle, avec le motif de la base", async () => {
    const piece = await deposer(orgPleine, "au-dela", "partage");
    const attendu = await verdictDeLaBase(piece);
    assert.equal(attendu.autorisee, false, "le décor est bien au plafond");
    const modele = lecteursInterdits();

    await assert.rejects(readPieceFlow(apiDEssai(), piece, modele), (e: unknown) => {
      assert.ok(e instanceof LectureRefusee);
      // Mot pour mot ce que la base a répondu : aucune retraduction ici (R4).
      assert.equal(e.motif, attendu.motif);
      assert.equal(e.message, attendu.motif);
      return true;
    });

    assert.equal(modele.appels, 0, "ni lecteur, ni second lecteur : aucun appel payant");
    assert.equal(await compter(piece), 0);
  });

  it("une pièce personnelle est refusée avec le motif de la base, sans appel de modèle", async () => {
    const piece = await deposer(orgLibre, "privee", "personnel");
    const attendu = await verdictDeLaBase(piece);
    assert.equal(attendu.autorisee, false);
    const modele = lecteursInterdits();

    await assert.rejects(readPieceFlow(apiDEssai(), piece, modele), (e: unknown) => {
      assert.ok(e instanceof LectureRefusee);
      assert.equal(e.motif, attendu.motif);
      return true;
    });

    assert.equal(modele.appels, 0);
    assert.equal(await compter(piece), 0);
  });
});
