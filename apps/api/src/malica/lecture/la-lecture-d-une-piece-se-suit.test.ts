/**
 * La lecture d'une pièce se suit, étape par étape, et se relit en UNE requête.
 *
 * ================================================================ LE CAS MYTEK
 *
 * Novembre 2026 : une photo de facture MyTek. Base attendue 427,731, TTC
 * attendu 510,000, « Cinq Cent Dix Dinars » écrit sous les totaux ; l'OCR a
 * relevé le TTC « 810,000 ». La question du dirigeant : quelle valeur l'OCR
 * a-t-il proposée, le montant en lettres a-t-il été reconnu à 510, quel
 * verdict le sudoku a-t-il rendu, le rattrapage est-il parti et pourquoi,
 * quelle valeur a été persistée ? Tout se lit dans
 * `observabilite.diagnostic_piece`, par une seule requête (`DIAGNOSTIC`).
 *
 * La fixture est celle du dépôt (`packages/sudoku/tests/la_photo_mytek.rs`) :
 * les jetons du pied de la pièce, leurs textes et leur géométrie. La
 * DÉSIGNATION du lecteur est reconstituée (la réponse brute du modèle n'est
 * pas dans le dépôt) : le « TOTAL HT » timbre compris, la TVA, le timbre et le
 * TTC mal relevé — ce que l'écran a montré. Aucune donnée réelle d'autre.
 *
 * Tout le reste est la vraie chaîne : la vraie application (dépôt des octets
 * sous la trace du téléphone), la vraie base (contexte, sudoku branché par le
 * pack, persistance, jugement), le vrai journal. Seuls les organes payants sont
 * des faux, par le mécanisme des épreuves (`lectures-d-essai.ts`) : aucun appel
 * réseau. Le moteur du sudoku doit être construit
 * (`npm run build -w @malica/sudoku`) ; sans lui, l'épreuve MyTek se dit sautée.
 *
 * R7 : les organisations d'essai s'archivent.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { moteurDisponible } from "@malica/sudoku";

import { creerCompte, emettreJeton, type Utilisateur } from "../../auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "../../db.ts";
import { matriculeDEssai } from "../../matricule-d-essai.ts";
import { nouvelleTrace, sousLaTrace } from "../../observabilite/trace.ts";
import { rejugerLaPiece } from "../../scan/analyse.ts";
import { creerAppelLocal, type AppelApi } from "../appel-local.ts";

import { complete, lecteurs, lecture, partielle, ref } from "./lectures-d-essai.ts";
import { decouperEnMots } from "./mots.ts";
import { readPieceFlow } from "./read-flow.ts";
import type { PageToken } from "./token-plan.ts";
import type { VisionRead, VisionSelection } from "./vision.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/**
 * LA requête de diagnostic d'une pièce : chaque question du cas, une colonne.
 * C'est celle de `docs/journalisation.md`.
 */
const DIAGNOSTIC = `
select max(detail ->> 'ttc') filter (where etape = 'extraction' and detail ->> 'passe' = 'premiere')
         as ttc_propose,
       max(detail ->> 'base_ht') filter (where etape = 'extraction' and detail ->> 'passe' = 'premiere')
         as ht_propose,
       max(detail ->> 'incoherence') filter (where etape = 'extraction' and detail ->> 'passe' = 'premiere')
         as incoherence_proposee,
       max(detail ->> 'lettres') filter (where etape = 'sudoku' and detail ->> 'passe' = 'premiere')
         as lettres,
       max(detail ->> 'issue') filter (where etape = 'sudoku' and detail ->> 'passe' = 'premiere')
         as sudoku,
       max(detail ->> 'regle') filter (where etape = 'sudoku' and detail ->> 'passe' = 'premiere')
         as regle,
       max(detail ->> 'ecart_ttc') filter (where etape = 'sudoku' and detail ->> 'passe' = 'premiere')
         as ecart_ttc,
       bool_or((detail ->> 'declenche')::boolean) filter (where etape = 'rattrapage')
         as rattrapage,
       max(detail ->> 'raison') filter (where etape = 'rattrapage') as raison_rattrapage,
       max(detail ->> 'base_ht') filter (where etape = 'persistance' and issue = 'ok') as ht_persiste,
       max(detail ->> 'ttc') filter (where etape = 'persistance' and issue = 'ok') as ttc_persiste,
       max(detail ->> 'extraction_id') filter (where etape = 'persistance' and issue = 'ok')
         as extraction_id,
       max(detail ->> 'verdict') filter (where etape = 'jugement') as verdict,
       max(detail ->> 'base_ht') filter (where etape = 'jugement') as ht_juge,
       max(detail ->> 'ttc') filter (where etape = 'jugement') as ttc_juge,
       max(detail ->> 'statut') filter (where etape = 'upload') as upload
  from observabilite.diagnostic_piece($1)`;

interface Diagnostic {
  ttc_propose: string | null;
  ht_propose: string | null;
  incoherence_proposee: string | null;
  lettres: string | null;
  sudoku: string | null;
  regle: string | null;
  ecart_ttc: string | null;
  rattrapage: boolean | null;
  raison_rattrapage: string | null;
  ht_persiste: string | null;
  ttc_persiste: string | null;
  extraction_id: string | null;
  verdict: string | null;
  ht_juge: string | null;
  ttc_juge: string | null;
  upload: string | null;
}

/* ================================================== LA FIXTURE MYTEK ===== */

/**
 * Les fragments de `la_photo_mytek.rs` — même texte, même place (largeur 0,2,
 * hauteur 0,02) —, découpés en mots par le découpeur de production
 * (`decouperEnMots`), comme chaque lecteur le fait de ce qu'il relève : le plan
 * d'une vraie lecture est fait de MOTS, pas de lignes.
 */
const FRAGMENTS_MYTEK: Array<[string, number, number]> = [
  ["MYTEK", 0.05, 0.05],
  ["02/11/2026", 0.7, 0.05],
  ["TOTAL HT:", 0.05, 0.6],
  ["Base TVA", 0.3, 0.6],
  ["Montant TVA", 0.55, 0.6],
  ["428,731", 0.05, 0.63],
  ["427,731", 0.3, 0.63],
  ["81,269", 0.55, 0.63],
  ["Timbre fiscal: 1,000", 0.8, 0.66],
  ["Total avec Timbre:428,731", 0.8, 0.69],
  ["TTC:", 0.8, 0.75],
  ["810,000", 1.01, 0.75],
  ["Arrêtée la présente pièce à la somme de:", 0.05, 0.8],
  ["Cinq", 0.26, 0.8],
  ["Cent", 0.37, 0.8],
  ["Dix", 0.48, 0.8],
  ["Dinars.", 0.59, 0.8],
];

const PLAN_MYTEK: PageToken[] = FRAGMENTS_MYTEK.reduce<PageToken[]>(
  (plan, [texte, x0, y0]) => [
    ...plan,
    ...decouperEnMots(texte, { x0, y0, x1: x0 + 0.2, y1: y0 + 0.02 }, 1, plan.length),
  ],
  [],
);

/** Le jeton qui porte ce texte, sur la rangée `y0`. */
function mot(texte: string, y0: number) {
  const t = PLAN_MYTEK.find((x) => x.text === texte && x.y0 === y0);
  assert.ok(t, `le plan MyTek porte « ${texte} »`);
  return ref(t.ordinal);
}

/**
 * La désignation du lecteur, reconstituée : le « TOTAL HT » timbre compris, la
 * TVA, le timbre, et le TTC que l'OCR a mal relevé — celui que l'écran a montré.
 */
const DESIGNATION_MYTEK = {
  issuer: mot("MYTEK", 0.05),
  document_date: mot("02/11/2026", 0.05),
  currency: "TND",
  document_kind: "facture_achat",
  lines: [
    {
      label: "TVA 19%",
      tax_code: "TVA19",
      base_ht: mot("427,731", 0.63),
      vat_amount: mot("81,269", 0.63),
      ttc: null,
    },
  ],
  articles: [],
  other_charges: [{ code: "DROIT_TIMBRE", amount: mot("1,000", 0.66) }],
  totals: {
    base_ht: mot("428,731", 0.63),
    vat: mot("81,269", 0.63),
    ttc: mot("810,000", 0.75),
  },
  references: {},
  overall_confidence: 0.6,
} as unknown as VisionSelection;

const lectureMytek = (): VisionRead => lecture("qwen-vl-ocr", DESIGNATION_MYTEK, PLAN_MYTEK);

describe("la lecture d'une pièce se suit", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `suivi-${Date.now()}`;
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"], max: 2 });
  const archiver: string[] = [];
  let u: Utilisateur;
  let org = "";
  let base = "";
  let racine = "";
  let arret: (() => Promise<void>) | null = null;

  /** Le journal écrit par lots, après coup : on attend qu'il l'ait fait. */
  async function attendre<T>(lire: () => Promise<T | null>, quoi: string): Promise<T> {
    const limite = Date.now() + 10_000;
    for (;;) {
      const v = await lire();
      if (v) return v;
      if (Date.now() > limite) assert.fail(`le journal n'a pas écrit : ${quoi}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const etapes = (piece: string) =>
    admin
      .query<{
        trace_id: string;
        parente_id: string | null;
        origine: string;
        etape: string;
        issue: string;
        detail: Record<string, unknown>;
        repetitions: number;
      }>(
        `select trace_id, parente_id, origine::text, etape, issue::text, detail, repetitions
           from observabilite.diagnostic_piece($1)`,
        [piece],
      )
      .then((r) => r.rows);

  const attendreLEtape = (piece: string, etape: string, n = 1) =>
    attendre(async () => {
      const lignes = await etapes(piece);
      return lignes.filter((l) => l.etape === etape).length >= n ? lignes : null;
    }, `${etape} × ${n} pour ${piece}`);

  /** L'API réelle sous l'identité, avec ses surcharges d'épreuve. */
  function api(surcharges: Record<string, (args: unknown[]) => Promise<unknown>> = {}): AppelApi {
    const reelle = creerAppelLocal((t) => sousIdentite(u.id, t));
    return {
      ...reelle,
      rpc: <T>(depot: string, methode: string, args: unknown[] = []) => {
        const s = surcharges[methode];
        return (s ? s(args) : reelle.rpc<T>(depot, methode, args)) as Promise<T>;
      },
    };
  }

  /** Le sudoku remis en observation, comme un cabinet peut le faire (le pack le branche). */
  const enObservation = (): AppelApi => {
    const reelle = api();
    return {
      ...reelle,
      rpc: async <T>(depot: string, methode: string, args?: unknown[]): Promise<T> => {
        const r = await reelle.rpc<T>(depot, methode, args);
        return methode === "contexteSudoku" ? ({ ...(r as object), mode: "observe" } as T) : r;
      },
    };
  };

  /** Le téléphone : la pièce s'enregistre, puis ses octets partent, sous SA trace. */
  async function capturer(cle: string, trace: string): Promise<string> {
    const appeler = (chemin: string, init: RequestInit) =>
      fetch(`${base}${chemin}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${emettreJeton(u, new Date())}`,
          "X-Malica-Client": "coque-android/0.2.99",
          "x-malica-trace": trace,
        },
      });
    const enregistree = await appeler("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-malica-cle": `${cle}-enregistrer` },
      body: JSON.stringify({
        depot: "capture",
        methode: "enregistrer",
        args: [
          {
            tenantId: org,
            source: "photo",
            vis: "partage",
            idempotencyKey: `${marque}-${cle}`,
            contentType: "image/jpeg",
            pageCount: 1,
          },
        ],
      }),
    });
    assert.equal(enregistree.status, 200);
    const piece = ((await enregistree.json()) as { resultat: { id: string } }).resultat.id;
    // Des octets d'essai, propres à chaque pièce : aucune photo n'entre dans ce dépôt.
    const octets = await appeler(`/pieces/${piece}/contenu`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "x-malica-cle": `${cle}-octets` },
      body: new TextEncoder().encode(`essai ${marque} ${cle}`),
    });
    assert.equal(octets.status, 201);
    return piece;
  }

  /** La lecture, sous la trace du téléphone — comme `POST /malica/lectures/:pieceId`. */
  const lireSous = (
    trace: string,
    piece: string,
    l: Parameters<typeof readPieceFlow>[2],
    a = api(),
  ) =>
    sousLaTrace(nouvelleTrace("android", { id: trace, version: "coque-android/0.2.99" }), () =>
      readPieceFlow(a, piece, l),
    );

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentite(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', $1, 'autonome', $2, 'TN', 'TND') as id`,
        [`PME SUIVI ${marque}`, matriculeDEssai("A", "M")],
      );
      return rows[0]!.id;
    });
    archiver.push(org);

    racine = await mkdtemp(path.join(tmpdir(), "malica-suivi-"));
    process.env["STOCKAGE_RACINE"] = racine;
    const { app } = await import("../../app.ts");
    const serveur = app.listen(0);
    await new Promise((r) => serveur.once("listening", r));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((r) => serveur.close(() => r()));
  });

  after(async () => {
    await admin.query(
      `update identity.organizations set archived_at = now(),
              archived_reason = 'fixture de test automatisé' where id = any($1)`,
      [archiver],
    );
    await arret?.();
    await admin.end();
    await fermerLePool();
    if (racine) await rm(racine, { recursive: true, force: true });
  });

  it(
    "MyTek : la valeur de chaque étape se lit en une requête, de l'OCR à la persistance",
    { skip: !moteurDisponible() && "moteur du sudoku absent" },
    async () => {
      const trace = randomUUID();
      const piece = await capturer("mytek", trace);
      const modele = lecteurs([lectureMytek, lectureMytek]);

      await lireSous(trace, piece, modele);
      await attendreLEtape(piece, "jugement");

      const { rows } = await admin.query<Diagnostic>(DIAGNOSTIC, [piece]);
      const d = rows[0]!;
      console.info("[MyTek] diagnostic :", JSON.stringify(d));

      // 1. Ce que l'OCR a proposé : le TTC mal relevé, le HT timbre compris.
      assert.equal(d.upload, "scellee", "les octets sont arrivés, sous la même trace");
      assert.equal(d.ttc_propose, "810.000");
      assert.equal(d.ht_propose, "428.731");
      assert.match(d.incoherence_proposee ?? "", /donne 511\.000, la pièce porte 810\.000/);
      // 2. Le montant en lettres, reconnu à 510.
      assert.equal(d.lettres, "510.000");
      // 3. Le verdict du sudoku et la règle qui tranche : les lettres donnent le total.
      assert.equal(d.sudoku, "prouvee");
      assert.equal(d.regle, "lettres:total_ttc");
      assert.equal(d.ecart_ttc, "300.000", "810,000 proposé − 510,000 prouvé");
      // 4. Le rattrapage : pas déclenché — la lecture désignée par la preuve est parfaite.
      assert.equal(d.rattrapage, false);
      assert.equal(d.raison_rattrapage, "lecture_parfaite");
      assert.equal(modele.appels, 1, "aucun second lecteur payé");
      // 5. Ce qui est persisté : la base juste et le TTC des lettres.
      assert.equal(d.ht_persiste, "427.731");
      assert.equal(d.ttc_persiste, "510.000");
      // 6. Le jugement retient la base juste ; son TTC reste vide, avec réserve : le
      //    total imprimé est en lettres, que la normalisation ne lit pas (#203, voulu).
      assert.equal(d.ht_juge, "427.731");
      assert.equal(d.ttc_juge, null);
      assert.ok(d.verdict);

      // La trace dit la vérité de la base : la ligne qu'elle référence porte ces valeurs.
      const { rows: x } = await admin.query<{ ht: string; ttc: string }>(
        `select payload #>> '{totals,base_ht}' as ht, payload #>> '{totals,ttc}' as ttc
           from capture.extractions where id = $1 and piece_id = $2`,
        [d.extraction_id, piece],
      );
      assert.deepEqual(x[0], { ht: "427.731", ttc: "510.000" });

      // Une seule trace, celle du téléphone, de l'envoi des octets au jugement.
      const lignes = await etapes(piece);
      assert.deepEqual([...new Set(lignes.map((l) => l.trace_id))], [trace]);
      assert.deepEqual([...new Set(lignes.map((l) => l.origine))], ["android"]);
      for (const e of ["upload", "ocr", "extraction", "sudoku", "rattrapage", "persistance"]) {
        assert.ok(
          lignes.some((l) => l.etape === e),
          `l'étape ${e} est tracée`,
        );
      }
      // Rien de ce que la pièce imprime en clair n'entre au journal, hors montants cités.
      const texte = JSON.stringify(lignes.map((l) => l.detail));
      assert.doesNotMatch(texte, /MYTEK|Cinq|Arrêtée/u);
    },
  );

  it("refus de lecture : l'étape du lecteur le dit avant tout appel payant, et rien ne suit", async () => {
    const trace = randomUUID();
    const piece = await capturer("refus", trace);
    const interdits = lecteurs([]);
    const refusee = api({
      lectureAutorisee: async () => ({ autorisee: false, motif: "plafond_atteint" }),
      inscrireRefusDeLecture: async () => undefined,
    });

    await assert.rejects(lireSous(trace, piece, interdits, refusee), /plafond_atteint/);

    const lignes = await attendreLEtape(piece, "ocr");
    assert.equal(interdits.appels, 0);
    const ocr = lignes.find((l) => l.etape === "ocr")!;
    assert.equal(ocr.issue, "refus");
    assert.deepEqual(ocr.detail, { passe: "premiere", motif: "plafond_atteint" });
    assert.ok(!lignes.some((l) => ["extraction", "persistance"].includes(l.etape)));
  });

  it("lecteur en panne : l'OCR est en erreur, la trace reste, rien n'est persisté", async () => {
    const trace = randomUUID();
    const piece = await capturer("panne", trace);
    const enPanne = lecteurs([
      () => {
        throw new TypeError("modèle indisponible");
      },
    ]);

    await assert.rejects(lireSous(trace, piece, enPanne), /modèle indisponible/);

    const lignes = await attendreLEtape(piece, "ocr");
    const ocr = lignes.find((l) => l.etape === "ocr")!;
    assert.equal(ocr.issue, "erreur");
    assert.deepEqual(ocr.detail, { passe: "premiere", erreur: "TypeError" });
    assert.ok(!lignes.some((l) => l.etape === "persistance"));
  });

  it("rattrapage : déclenché, avec sa raison, et la seconde lecture retenue se trace à part", async () => {
    const trace = randomUUID();
    const piece = await capturer("rattrapage", trace);
    const modele = lecteurs([() => partielle("qwen-vl-ocr"), () => complete("PP-OCR")]);

    await lireSous(trace, piece, modele, enObservation());

    const lignes = await attendreLEtape(piece, "persistance");
    assert.equal(modele.appels, 2);
    const r = lignes.find((l) => l.etape === "rattrapage")!;
    assert.deepEqual(r.detail, {
      declenche: true,
      raison: "contrat_partiel",
      differe: false,
      qualite_avant: 1,
      qualite_apres: 3,
      retenue: true,
      lecteur: "paddle",
      erreur: null,
    });
    const passes = (etape: string) =>
      lignes.filter((l) => l.etape === etape).map((l) => l.detail["passe"]);
    assert.deepEqual(passes("ocr"), ["premiere", "rattrapage"]);
    assert.deepEqual(passes("extraction"), ["premiere", "rattrapage"]);
    const sudoku = lignes.find((l) => l.etape === "sudoku")!;
    assert.equal(sudoku.detail["mode"], "observe");
    assert.equal(sudoku.detail["designee"], false);
    const p = lignes.find((l) => l.etape === "persistance")!;
    assert.equal(p.detail["contrat"], "extract.v1", "la lecture retenue est celle du rattrapage");
  });

  it("échec de persistance : l'étape est en erreur avec la clé du refus, les étapes d'avant restent", async () => {
    const trace = randomUUID();
    const piece = await capturer("persistance", trace);
    const refusee = api({
      persisterLecture: async () => {
        throw new Error("refus.lecture.citation_orpheline");
      },
    });

    await assert.rejects(
      lireSous(trace, piece, lecteurs([() => complete("qwen-vl-ocr")]), refusee),
      /citation_orpheline/,
    );

    const lignes = await attendreLEtape(piece, "persistance");
    const p = lignes.find((l) => l.etape === "persistance")!;
    assert.equal(p.issue, "erreur");
    assert.equal(p.detail["code_refus"], "refus.lecture.citation_orpheline");
    assert.equal(p.detail["extraction_id"], undefined, "aucune ligne n'a été inscrite");
    for (const e of ["upload", "ocr", "extraction", "rattrapage"]) {
      assert.ok(
        lignes.some((l) => l.etape === e),
        `l'étape ${e} reste lisible`,
      );
    }
    assert.ok(!lignes.some((l) => l.etape === "jugement"), "rien n'a été jugé");
  });

  it("le jugement se trace à chaque passage : par /rpc, puis au rejeu qui ne change rien", async () => {
    const trace = randomUUID();
    const piece = await capturer("jugement", trace);
    await lireSous(trace, piece, lecteurs([() => complete("qwen-vl-ocr")]));

    const reponse = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${emettreJeton(u, new Date())}`,
        "X-Malica-Client": "web/0.2.99",
      },
      body: JSON.stringify({ depot: "capture", methode: "analyser", args: [piece] }),
    });
    assert.equal(reponse.status, 200);
    // Le rejeu à blanc (`office.rejuger`, `essai`), sous sa propre trace.
    const rejeu = await sousLaTrace(nouvelleTrace("web"), () =>
      sousIdentiteDuServeur(u.id, (db) => rejugerLaPiece(db, piece, { essai: true })),
    );
    assert.equal(rejeu.change, false);

    const lignes = await attendreLEtape(piece, "jugement", 3);
    const jugements = lignes.filter((l) => l.etape === "jugement");
    assert.deepEqual(
      jugements.map((j) => [j.trace_id === trace, j.detail["chemin"], j.detail["change"]]),
      [
        [true, "analyse", null],
        [false, "analyse", null],
        [false, "rejeu", false],
      ],
    );
    const [lu, parRpc, auRejeu] = jugements;
    assert.notEqual(lu!.detail["analyse_id"], parRpc!.detail["analyse_id"], "une analyse nouvelle");
    assert.equal(
      auRejeu!.detail["analyse_id"],
      parRpc!.detail["analyse_id"],
      "le rejeu la référence",
    );
    assert.equal(auRejeu!.detail["essai"], true);
  });

  it("un renvoi des octets sous la même trace compte une répétition, pas une ligne", async () => {
    const trace = randomUUID();
    const piece = await capturer("renvoi", trace);
    const renvoi = await fetch(`${base}/pieces/${piece}/contenu`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${emettreJeton(u, new Date())}`,
        "Content-Type": "image/jpeg",
        "X-Malica-Client": "coque-android/0.2.99",
        "x-malica-trace": trace,
        "x-malica-cle": "renvoi-octets",
      },
      body: new TextEncoder().encode(`essai ${marque} renvoi`),
    });
    assert.equal(renvoi.status, 201, "les mêmes octets : sans effet");

    const lignes = await attendre(async () => {
      const l = (await etapes(piece)).filter((e) => e.etape === "upload");
      return l.length === 1 && l[0]!.repetitions === 1 ? l : null;
    }, "la répétition de l'envoi");
    assert.equal(lignes[0]!.detail["statut"], "scellee");
  });
});
