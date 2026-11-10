/**
 * 3B-6 — La proposition d'écriture, calculée côté serveur.
 *
 * Elle part des montants NORMALISÉS (le texte imprimé, tranché par la facture),
 * pas de ceux que le solveur de la lecture a posés dans l'extraction ; elle ne
 * se propose que pour une pièce que le verdict déclare comptabilisable ; et le
 * serveur l'enregistre lui-même — le navigateur n'envoie plus aucune ligne.
 *
 *   node --experimental-strip-types --test src/scan/proposition.test.ts
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { JOUR_D_ESSAI, jourDEssai, lecture as lectureDEssai } from "./lecture-d-essai.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";

/**
 * Le dossier porte un matricule à lui (un matricule, une société — 20 octobre
 * 2026), et les lectures d'essai lui sont adressées : le contrôle du
 * destinataire compare les deux.
 */
const MF_DOSSIER = matriculeDEssai();
const lecture = (opts: Parameters<typeof lectureDEssai>[0] = {}) =>
  lectureDEssai({ clientMf: MF_DOSSIER, ...opts });
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

type Proposition =
  | {
      ok: true;
      verdict: string;
      proposition: {
        journal: string;
        libelle: string;
        lignes: Array<{
          account_code: string;
          debit: string;
          credit: string;
          tax_code: string | null;
        }>;
        pivot: { entry_date: string; approvable: boolean };
      };
      reserves?: Array<{ code: string; raison?: string; articles?: string[] }>;
    }
  | { ok: false; raison: string; verdict?: string };

describe("3B-6 — la proposition d'écriture, côté serveur", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `proposition-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let packId = "";

  const rpc = (depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }, "serveur"));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  async function pieceLue(
    cle: string,
    l: ReturnType<typeof lecture>,
    articles: Array<{ designation: string; total_ht: string }> = [],
  ) {
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
      articles,
      documentKind: "facture_achat",
      documentDate: l.extract.document_date,
      mode: "pdf-text",
      confianceParChamp: { "totals.ttc": 0.95 },
    });
    await rpc("capture", "analyser", p.id);
    return p.id;
  }

  const somme = (lignes: Array<{ debit: string; credit: string }>, cote: "debit" | "credit") =>
    lignes.reduce((s, l) => s + Math.round(Number(l[cote]) * 1000), 0);

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SARL', 'autonome',
                                           '${MF_DOSSIER}', 'TN', 'TND') as id`,
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

  it("les montants de l'écriture sont ceux IMPRIMÉS et normalisés, pas ceux du solveur", async () => {
    // L'extraction porte HT 8 888,888 et TTC 9 999,999 ; la pièce imprime
    // 1 234,560 et 1 470,126. L'écriture suit la pièce.
    const piece = await pieceLue("solveur", lecture({ numero: "P-SOLVEUR", solveurFaux: true }));
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    const lignes = r.proposition.lignes;
    assert.equal(somme(lignes, "debit"), somme(lignes, "credit"), "l'écriture est équilibrée");
    assert.equal(somme(lignes, "credit"), 1_470_126, "le TTC imprimé, pas 9 999,999");
    const montants = lignes.map((l) => l.debit).sort();
    assert.ok(montants.includes("1234.560"), `HT imprimé : ${montants.join(", ")}`);
    assert.ok(montants.includes("234.566"), "TVA imprimée");
    assert.ok(montants.includes("1.000"), "timbre");
    assert.equal(r.proposition.pivot.entry_date, JOUR_D_ESSAI);
    assert.equal(r.verdict, "à comptabiliser");
    // Une date LUE n'est jamais remplacée par une saisie.
    const saisie = (await rpc("office", "propositionDePiece", piece, "2026-01-01")) as Proposition;
    assert.ok(saisie.ok);
    assert.equal(saisie.proposition.pivot.entry_date, JOUR_D_ESSAI);
  });

  it("une proforma n'a pas d'écriture : refus motivé par le verdict", async () => {
    const piece = await pieceLue("proforma", lecture({ titre: "PROFORMA", numero: "P-PROFORMA" }));
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.verdict, "à rejeter");
    assert.match(r.raison, /proforma/i);
  });

  it("une facture qui ne tient pas n'a pas d'écriture : aucun chiffre inventé", async () => {
    const piece = await pieceLue("faux", lecture({ ttc: ["1", "500,000"], numero: "P-FAUX" }));
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(!r.ok);
    assert.equal(r.verdict, "anomalie à signaler");
  });

  it("sans date lue : refus qui le dit — et la date saisie par la personne complète", async () => {
    const piece = await pieceLue("sansdate", lecture({ numero: "P-SANSDATE", sansDate: true }));
    const sans = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(!sans.ok);
    assert.match(sans.raison, /date/i);
    const avec = (await rpc("office", "propositionDePiece", piece, "2026-09-12")) as Proposition;
    assert.ok(avec.ok, avec.ok ? "" : avec.raison);
    assert.equal(avec.proposition.pivot.entry_date, "2026-09-12");
  });

  it("une date donnée à la main se relit partout : fiche, jugement et proposition", async () => {
    /*
     * Audit du 25 octobre 2026 : la précision s'inscrivait, mais la fiche ne la
     * rendait pas — « Indiquer la date » revenait pour toujours, et l'écriture
     * se datait du jour proposé par l'écran plutôt que du jour enregistré.
     */
    const piece = await pieceLue("datee", lecture({ numero: "P-DATEE", sansDate: true }));
    await rpc("capture", "daterLaPiece", piece, "2026-09-03");

    const dossier = (await rpc("capture", "dossier", piece)) as {
      extraction: { payload: { document_date?: string | null } };
      precisions: Record<string, string>;
    };
    assert.equal(dossier.extraction.payload.document_date, "2026-09-03");
    assert.equal(dossier.precisions["document_date"], "2026-09-03");

    const jugement = (await rpc("capture", "analyser", piece)) as {
      controles: Array<{ code: string; preuves?: { date?: string } }>;
    };
    const dates = jugement.controles.find((c) => c.code === "coherence_dates");
    assert.equal(dates?.preuves?.date, "2026-09-03", "le jugement voit la date donnée");

    // L'écran propose un autre jour sans l'avoir écrit : c'est l'enregistré qui compte.
    const r = (await rpc("office", "propositionDePiece", piece, "2026-09-20")) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.proposition.pivot.entry_date, "2026-09-03");
  });

  it("une précision de date ne remplace jamais une date lue", async () => {
    const piece = await pieceLue("lue-et-precisee", lecture({ numero: "P-LUE-PRECISEE" }));
    await rpc("capture", "daterLaPiece", piece, "2026-08-01");
    const dossier = (await rpc("capture", "dossier", piece)) as {
      extraction: { payload: { document_date?: string | null } };
    };
    assert.equal(dossier.extraction.payload.document_date, JOUR_D_ESSAI);
  });

  it("le jour de réception est celui du dossier, pas celui d'UTC", async () => {
    /*
     * Main rouge du 1er novembre 2026, 23:02 UTC : une pièce datée du jour
     * (dans le fuseau du dossier) recevait « datée après sa réception », car
     * la réception se lisait en UTC — la veille, entre minuit et une heure à
     * Tunis. La pièce est reçue à 00:30 au fuseau du dossier, le jour même de
     * sa date imprimée.
     */
    const jour = JOUR_D_ESSAI;
    const piece = await pieceLue("minuit", lecture({ numero: "P-MINUIT" }));
    const recevoirA = (heure: string) =>
      admin(async (p) => {
        const { rows } = await p.query<{ utc: string }>(
          `update capture.pieces x
              set created_at = ($2::date + $3::time) at time zone coalesce(o.fuseau, c.fuseau)
             from identity.organizations o
             left join ref.calendrier_juridiction c on c.jurisdiction = o.jurisdiction
            where x.id = $1 and o.id = x.tenant_id
           returning to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD') as utc`,
          [piece, jour, heure],
        );
        return rows[0]!.utc;
      });
    assert.notEqual(await recevoirA("00:30"), jour, "en UTC, c'est encore la veille");
    const dates = async () =>
      (
        (await rpc("capture", "analyser", piece)) as {
          controles: Array<{ code: string; statut: string; preuves?: { recueLe?: string } }>;
        }
      ).controles.find((c) => c.code === "coherence_dates");

    const jugee = await dates();
    assert.deepEqual([jugee?.statut, jugee?.preuves?.recueLe], ["conforme", jour]);
    const contexte = (await rpc("capture", "contexteLecture", piece)) as {
      piece: { recueLe: string };
    };
    assert.equal(contexte.piece.recueLe, jour, "la lecture lit ses règles au même jour");
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);

    // Le réglage du DOSSIER l'emporte sur celui de sa juridiction : à l'ouest
    // d'UTC, le même instant est encore la veille, et la réserve est juste.
    await admin((p) =>
      p.query(`update identity.organizations set fuseau = 'America/Sao_Paulo' where id = $1`, [
        org,
      ]),
    );
    try {
      const veille = await dates();
      assert.deepEqual(
        [veille?.statut, veille?.preuves?.recueLe],
        ["reserve", jourDEssai(-1)],
        "reçue la veille, au fuseau du dossier",
      );
    } finally {
      await admin((p) =>
        p.query(`update identity.organizations set fuseau = null where id = $1`, [org]),
      );
    }
  });

  it("sans fuseau ni pour le dossier ni pour sa juridiction, la réception ne se lit pas en UTC", async () => {
    const piece = await pieceLue("sans-fuseau", lecture({ numero: "P-SANS-FUSEAU" }));
    await admin(async (p) => {
      const c = await p.connect();
      try {
        await c.query("begin");
        await c.query(
          `update ref.calendrier_juridiction set fuseau = null
            where jurisdiction = (select jurisdiction from identity.organizations where id = $1)`,
          [org],
        );
        await assert.rejects(
          c.query(`select recue_le from pieces_v where id = $1`, [piece]),
          /refus\.fuseau\.dossier_non_defini/,
        );
      } finally {
        await c.query("rollback");
        c.release();
      }
    });
  });

  it("comptabilisable au verdict, mais le moteur ne l'approuve pas : pas d'écriture, et pourquoi", async () => {
    // Les contrôles lisent la confiance PAR CHAMP (haute ici) ; le moteur, la
    // confiance GLOBALE de la désignation (0,3, sous le seuil bloquant).
    const piece = await pieceLue(
      "globale",
      lecture({ numero: "P-GLOBALE", confianceGlobale: 0.3 }),
    );
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(!r.ok);
    assert.equal(r.verdict, "à comptabiliser");
    assert.match(r.raison, /Confiance/);
  });

  it("le serveur enregistre lui-même l'écriture : le navigateur n'envoie aucune ligne", async () => {
    const piece = await pieceLue("enregistre", lecture({ numero: "P-ENREGISTRE" }));
    const id = (await rpc("office", "proposerDepuisPiece", piece)) as string;
    assert.match(id, /^[0-9a-f-]{36}$/);
    const ecritures = (await rpc("office", "ecrituresForPiece", piece)) as Array<{ id: string }>;
    assert.ok(ecritures.some((e) => e.id === id));
  });

  /*
   * Recette du 20 octobre 2026 : honoraires et loyers partaient au 601. La
   * nature lue sur le libellé propose désormais son compte — mais seulement
   * quand toute la pièce est de la même nature.
   */
  const compteDeCharge = (r: Proposition) => {
    assert.ok(r.ok, r.ok ? "" : r.raison);
    return r.proposition.lignes.find((l) => l.account_code.startsWith("6"))?.account_code;
  };

  it("une facture d'honoraires s'impute aux honoraires (622), pas au 601", async () => {
    const piece = await pieceLue("honoraires", lecture({ numero: "P-HONORAIRES" }), [
      { designation: "Honoraires de tenue de comptabilité", total_ht: "1234.560" },
    ]);
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.equal(compteDeCharge(r), "622");
    // Et le compte existe au plan : l'écriture s'enregistre.
    assert.match((await rpc("office", "proposerDepuisPiece", piece)) as string, /^[0-9a-f-]{36}$/);
  });

  it("un loyer s'impute aux locations (613)", async () => {
    const piece = await pieceLue("loyer", lecture({ numero: "P-LOYER" }), [
      { designation: "Loyer du local commercial — octobre 2026", total_ht: "1234.560" },
    ]);
    assert.equal(
      compteDeCharge((await rpc("office", "propositionDePiece", piece)) as Proposition),
      "613",
    );
  });

  /*
   * 5 novembre 2026 (staging, SOFT-INTEGRA) : une facture mêlée partait en
   * entier au 601, sans un mot. Elle se ventile quand ses articles le
   * prouvent ; sinon elle garde le compte du paramétrage, avec sa réserve.
   */
  it("une pièce mêlée se ventile quand ses articles le prouvent", async () => {
    const piece = await pieceLue("melee", lecture({ numero: "P-MELEE" }), [
      { designation: "Honoraires de conseil", total_ht: "600.000" },
      { designation: "Loyer du bureau", total_ht: "634.560" },
    ]);
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.deepEqual(
      // Les bases ; le timbre (6654) garde sa ligne à part.
      r.proposition.lignes
        .filter((l) => l.account_code.startsWith("6") && l.account_code !== "6654")
        .map((l) => [l.account_code, l.debit]),
      [
        ["622", "600.000"],
        ["613", "634.560"],
      ],
    );
    assert.equal(r.reserves, undefined);
  });

  it("une pièce dont un article ne se reconnaît pas garde le paramétrage, avec sa réserve", async () => {
    const piece = await pieceLue("inconnue", lecture({ numero: "P-INCONNUE" }), [
      { designation: "Honoraires de conseil", total_ht: "600.000" },
      { designation: "Article sans nature connue", total_ht: "634.560" },
    ]);
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.equal(compteDeCharge(r), "601");
    assert.ok(r.ok);
    assert.deepEqual(r.reserves, [
      { code: "nature_de_charge", raison: "inconnue", articles: ["Article sans nature connue"] },
    ]);
  });

  /*
   * 29 octobre 2026, écran du cabinet : « montant illisible : « 3 020,000
   * 3 020,000) » », pièce « anomalie à signaler », aucune écriture. La
   * citation de la ligne couvrait deux colonnes — HT et total de la ligne —
   * plus une parenthèse parasite. 3 020,000 + 573,800 (19 %) + 1,000 (timbre)
   * = 3 594,800 : le total de l'en-tête.
   *
   * La parenthèse n'est du bruit que parce que le plan montre ce qu'elle
   * ferme : « (base », un mot que la citation a laissé dehors. Sans lui, elle
   * peut fermer un avoir « (3 020,000) », et rien ne se lit (revue de la
   * PR 144) — l'épreuve suivante.
   */
  const FACTURE_DU_29 = {
    ht: ["3", "020,000"] as [string, string],
    tva: "573,800",
    ttc: ["3", "594,800"] as [string, string],
  };

  it("29 octobre : un HT répété sur deux colonnes se lit, et l'écriture se propose, équilibrée", async () => {
    const piece = await pieceLue(
      "deux-colonnes",
      lecture({
        numero: "P-DEUX-COLONNES",
        ...FACTURE_DU_29,
        avantLaLigne: ["(base"],
        ligne: ["3", "020,000", "3", "020,000)"],
      }),
    );
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.verdict, "à comptabiliser");
    const lignes = r.proposition.lignes;
    assert.equal(somme(lignes, "debit"), somme(lignes, "credit"), "l'écriture est équilibrée");
    assert.equal(somme(lignes, "credit"), 3_594_800);
    const debits = lignes.map((l) => l.debit);
    assert.ok(debits.includes("3020.000"), `HT : ${debits.join(", ")}`);
    assert.ok(debits.includes("573.800"), "TVA");
    assert.ok(debits.includes("1.000"), "timbre");
  });

  it("la même ligne, sans le mot que ferme la parenthèse : la ligne ne se lit pas, le pied la remplace avec réserve", async () => {
    // Revue de la PR 144 : « 3 020,000) » sans « (base » devant peut être un
    // avoir coupé par la citation. La ligne ne se lit plus ; le HT du pied,
    // que la facture entière vérifie, la remplace — et la réserve le dit.
    const piece = await pieceLue(
      "deux-colonnes-sans-mot",
      lecture({
        numero: "P-DEUX-COLONNES-SANS-MOT",
        ...FACTURE_DU_29,
        ligne: ["3", "020,000", "3", "020,000)"],
      }),
    );
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.verdict, "à comptabiliser avec réserve");
  });

  it("la ligne illisible, le pied lisible et vérifié : l'écriture se propose depuis le pied, avec réserve", async () => {
    const piece = await pieceLue(
      "pied",
      lecture({
        numero: "P-PIED",
        ...FACTURE_DU_29,
        // Deux montants DIFFÉRENTS sur la ligne : on ne choisit pas entre eux.
        ligne: ["3", "020,000", "3", "200,000"],
      }),
    );
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.verdict, "à comptabiliser avec réserve", "signalé, jamais en silence");
    assert.equal(somme(r.proposition.lignes, "credit"), 3_594_800);
    const jugement = (await rpc("capture", "analyser", piece)) as {
      motifs: Array<{ code: string; motif: string }>;
    };
    const motif = jugement.motifs.find((m) => m.code === "coherence_arithmetique")?.motif ?? "";
    assert.match(motif, /3 020,000 3 200,000/);
    assert.match(motif, /pied de facture/);
  });

  it("rien ne se lit, ni la ligne ni le pied : la raison est courte, et dit quoi faire", async () => {
    const piece = await pieceLue(
      "rien",
      lecture({
        numero: "P-RIEN",
        ...FACTURE_DU_29,
        ht: ["3 020,000", "3 200,000"],
        ligne: ["3", "020,000", "3", "200,000"],
      }),
    );
    const r = (await rpc("office", "propositionDePiece", piece)) as Proposition;
    assert.ok(!r.ok);
    assert.equal(r.verdict, "anomalie à signaler");
    assert.match(r.raison, /À saisir : montant illisible « 3 020,000 3 200,000 »\.$/);
    assert.ok(r.raison.length <= 140, `trop long (${r.raison.length}) : ${r.raison}`);
  });

  it("proposerDepuisPiece refuse ce que propositionDePiece refuse", async () => {
    const piece = await pieceLue("refus", lecture({ titre: "PROFORMA", numero: "P-REFUS" }));
    await assert.rejects(rpc("office", "proposerDepuisPiece", piece), /à rejeter/);
  });
});
