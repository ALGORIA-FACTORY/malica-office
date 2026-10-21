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

import { lecture as lectureDEssai } from "./lecture-d-essai.ts";

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
    assert.equal(r.proposition.pivot.entry_date, "2026-09-10");
    assert.equal(r.verdict, "à comptabiliser");
    // Une date LUE n'est jamais remplacée par une saisie.
    const saisie = (await rpc("office", "propositionDePiece", piece, "2026-01-01")) as Proposition;
    assert.ok(saisie.ok);
    assert.equal(saisie.proposition.pivot.entry_date, "2026-09-10");
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

  it("une pièce mêlée ne se devine pas : elle garde le compte du paramétrage", async () => {
    const piece = await pieceLue("melee", lecture({ numero: "P-MELEE" }), [
      { designation: "Honoraires de conseil", total_ht: "600.000" },
      { designation: "Loyer du bureau", total_ht: "634.560" },
    ]);
    assert.equal(
      compteDeCharge((await rpc("office", "propositionDePiece", piece)) as Proposition),
      "601",
    );
  });

  it("proposerDepuisPiece refuse ce que propositionDePiece refuse", async () => {
    const piece = await pieceLue("refus", lecture({ titre: "PROFORMA", numero: "P-REFUS" }));
    await assert.rejects(rpc("office", "proposerDepuisPiece", piece), /à rejeter/);
  });
});
