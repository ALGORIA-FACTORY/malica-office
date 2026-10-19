/**
 * Le moyen de paiement produit enfin son écriture.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 13 octobre 2026, le dirigeant : « l'écriture comptable et le rapprochement
 * dépendent énormément du moyen de paiement ».
 *
 * Le référentiel portait depuis le 11 octobre le compte de trésorerie de
 * chaque moyen — 54 Caisse, 532 Banques, 403 Effets à payer, avec leur
 * référence au Système Comptable des Entreprises. Vérifié le 13 octobre :
 * `tresorerie_account` n'était lu par AUCUN code de production. L'expert
 * lisait le moyen à l'écran et choisissait le compte à la main.
 *
 *   node --experimental-strip-types --test src/scan/le-moyen-de-paiement-produit-son-ecriture.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { executerRpc } from "../rpc.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

type Proposition =
  | {
      ok: true;
      ecriture: {
        journal: string;
        dateEcriture: string;
        libelle: string;
        lignes: Array<{ account_code: string; debit: string; credit: string }>;
      };
    }
  | { ok: false; raison: string };

describe("le moyen de paiement produit son écriture", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `reglement-${Date.now()}`;
  let u: Utilisateur;
  let org = "";
  let pack = "";
  let motif = "";

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

  /** Une pièce dont le sens est déclaré — comme à la capture. */
  const piece = async (cle: string, kind: string) =>
    (
      (await rpc("capture", "enregistrer", {
        tenantId: org,
        source: "pdf",
        vis: "personnel",
        idempotencyKey: `${marque}-${cle}`,
        contentType: "application/pdf",
        pageCount: 1,
        documentKind: kind,
      })) as { id: string }
    ).id;

  const payer = (pieceId: string, moyenCode: string, montantMineur: number, reference?: string) =>
    rpc("capture", "enregistrerPaiement", {
      pieceId,
      packId: pack,
      moyenCode,
      montantMineur,
      devise: "TND",
      payeLe: "2026-10-13",
      justificatifPieceId: null,
      reference: reference ?? null,
    }) as Promise<string>;

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
    ({ pack, motif } = await admin(async (p) => {
      const { rows: packs } = await p.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      );
      const { rows: motifs } = await p.query<{ id: string }>(
        `select id from ref.paiement_motifs_annulation where code = 'moyen_errone'`,
      );
      return { pack: packs[0]!.id, motif: motifs[0]!.id };
    }));
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

  it("un achat réglé par chèque : 401 au débit, 532 au crédit, journal de banque", async () => {
    const f = await piece("achat", "facture_achat");
    const p = await payer(f, "cheque", 1_969_610, "4512871");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.ecriture.journal, "BQ");
    assert.equal(r.ecriture.dateEcriture, "2026-10-13");
    assert.equal(r.ecriture.lignes[0]!.account_code, "401");
    assert.equal(r.ecriture.lignes[0]!.debit, "1969.610");
    assert.equal(r.ecriture.lignes[1]!.account_code, "532");
    assert.equal(r.ecriture.lignes[1]!.credit, "1969.610");
    // Le numéro du chèque est DANS le libellé : c'est lui que l'extrait
    // bancaire reprendra, et sans lui le rapprochement se fait à l'œil.
    assert.match(r.ecriture.libelle, /4512871/);
  });

  it("les espèces vont en caisse, pas en banque", async () => {
    // 54 Caisse, et le journal de caisse — qui n'existait pas avant le
    // 13 octobre : un paiement en espèces s'écrivait en banque.
    const f = await piece("vente", "facture_vente");
    const p = await payer(f, "especes", 500_000);
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.ecriture.journal, "CA");
    assert.equal(r.ecriture.lignes[0]!.account_code, "54");
    assert.equal(r.ecriture.lignes[0]!.debit, "500.000");
    assert.equal(r.ecriture.lignes[1]!.account_code, "411");
  });

  it("la traite reclasse la dette et ne décaisse rien : 403, journal OD", async () => {
    const f = await piece("traite", "facture_achat");
    const p = await payer(f, "traite", 300_000);
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.ecriture.journal, "OD");
    assert.equal(r.ecriture.lignes[1]!.account_code, "403");
  });

  it("« pas encore payé » n'écrit rien, et le dit", async () => {
    const f = await piece("impaye", "facture_achat");
    const p = (await rpc("capture", "enregistrerPaiement", {
      pieceId: f,
      packId: pack,
      moyenCode: "non_paye",
      montantMineur: null,
      devise: "TND",
      payeLe: null,
      justificatifPieceId: null,
    })) as string;
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.raison, /rien à écrire/);
  });

  it("un règlement annulé ne produit plus aucune écriture", async () => {
    /*
     * Sans ce refus, une correction laisserait derrière elle une écriture
     * que la personne a justement annulée — et le rapprochement bancaire
     * chercherait un mouvement qui n'a jamais eu lieu.
     */
    const f = await piece("annule", "facture_achat");
    const p = await payer(f, "cheque", 100_000);
    await rpc("capture", "annulerPaiement", p, motif);
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.raison, /annulé/);
  });

  /**
   * Une pièce LUE : l'émetteur, son numéro et le TTC tranché par l'analyse.
   * Posés par l'administrateur, comme la lecture les aurait posés.
   */
  const lue = async (pieceId: string, ttcMineur: number, tvaMineur: number | null = null) =>
    admin(async (p) => {
      const { rows } = await p.query<{ id: string }>(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload)
         values ($1, $2, 'extract.v1', $3::jsonb) returning id`,
        [
          org,
          pieceId,
          JSON.stringify({
            issuer: "COMPTOIR DU CENTRE SUARL",
            references: { invoice_no: "GS-2026-77120" },
          }),
        ],
      );
      await p.query(
        `insert into capture.analyses
           (tenant_id, piece_id, extraction_id, pack_version_id, normalisation, controles, verdict, motifs)
         values ($1, $2, $3, $4, $5::jsonb, '[{"controle":"essai","ok":true}]'::jsonb,
                 'à comptabiliser', '[{"motif":"essai"}]'::jsonb)`,
        [
          org,
          pieceId,
          rows[0]!.id,
          pack,
          JSON.stringify({ etat: "tranche", montants: { ttc: ttcMineur, tva: tvaMineur } }),
        ],
      );
    });

  it("le dossier : le règlement porte le fournisseur et le numéro de la facture", async () => {
    const f = await piece("dossier", "facture_achat");
    await lue(f, 500_000);
    const p = await payer(f, "cheque", 500_000, "4512872");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.match(r.ecriture.libelle, /COMPTOIR DU CENTRE SUARL/);
    assert.match(r.ecriture.libelle, /GS-2026-77120/);
  });

  it("au-dessus du seuil, le chèque au net : la retenue à la source a sa ligne", async () => {
    // 1 969,610 TTC × 1,5 % = 29,544 ; le chèque porte 1 940,066.
    const f = await piece("retenue", "facture_achat");
    await lue(f, 1_969_610);
    const p = await payer(f, "cheque", 1_940_066, "4512873");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition & {
      retenue?: { cas: string; montant?: string };
    };
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.retenue?.cas, "operee");
    const l = r.ecriture.lignes;
    assert.equal(l.length, 3);
    assert.deepEqual(
      l.map((x) => [x.account_code, x.debit, x.credit]),
      [
        ["401", "1969.610", "0.000"],
        ["532", "0.000", "1940.066"],
        [l[2]!.account_code, "0.000", "29.544"],
      ],
    );
    assert.ok(l[2]!.account_code.startsWith("43"), "la retenue va à l'État, classe 43");
  });

  it("au-dessus du seuil, payé pour le TTC entier : rien n'est retenu, et c'est dit", async () => {
    const f = await piece("sans-retenue", "facture_achat");
    await lue(f, 1_969_610);
    const p = await payer(f, "cheque", 1_969_610, "4512874");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition & {
      retenue?: { cas: string };
    };
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.retenue?.cas, "non_operee");
    assert.equal(r.ecriture.lignes.length, 2);
  });

  it("des honoraires payés au net de 10 % : la retenue d'honoraires, sans seuil", async () => {
    const f = await piece("honoraires", "facture_achat");
    await lue(f, 595_000, 95_000);
    const p = await payer(f, "virement", 535_500, "VIR-HON-1");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition & {
      retenue?: { cas: string; code?: string };
    };
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.retenue?.code, "RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS");
    assert.deepEqual(
      r.ecriture.lignes.map((x) => [x.debit, x.credit]),
      [
        ["595.000", "0.000"],
        ["0.000", "535.500"],
        ["0.000", "59.500"],
      ],
    );
  });

  it("un client public retient l'impôt ET 25 % de la TVA : quatre lignes, deux créances sur l'État", async () => {
    // 2 380 TTC dont 380 de TVA ; 1,5 % du TTC = 35,700 ; 25 % de la TVA = 95,000.
    const f = await piece("ministere", "facture_vente");
    await lue(f, 2_380_000, 380_000);
    const p = await payer(f, "virement", 2_249_300, "VIR-TRESOR-1");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    const l = r.ecriture.lignes;
    assert.equal(l.length, 4);
    assert.deepEqual(
      l.map((x) => [x.debit, x.credit]),
      [
        ["2249.300", "0.000"],
        ["35.700", "0.000"],
        ["95.000", "0.000"],
        ["0.000", "2380.000"],
      ],
    );
    assert.equal(l[3]!.account_code, "411");
    assert.notEqual(
      l[1]!.account_code,
      l[2]!.account_code,
      "l'impôt et la TVA ont chacun leur compte",
    );
  });

  it("inscrite, la retenue se retrouve dans les retenues du mois, à reverser", async () => {
    const f = await piece("retenue-inscrite", "facture_achat");
    await lue(f, 1_969_610);
    const p = await payer(f, "cheque", 1_940_066, "4512875");
    await rpc("office", "proposerLeReglement", p);
    const mois = (await rpc("office", "retenuesDuMois", org, "2026-10-01")) as Array<{
      sens: string;
      montant: string;
      ligne: string;
    }>;
    const operees = mois.filter((m) => m.sens === "operee");
    assert.ok(
      operees.some((m) => Number(m.montant) === 29.544),
      "la retenue de 29,544 est à reverser",
    );
    // Un autre mois n'en sait rien.
    const autre = (await rpc("office", "retenuesDuMois", org, "2026-11-01")) as unknown[];
    assert.equal(autre.length, 0);
  });

  it("l'écriture s'inscrit, équilibrée, et porte sa pièce", async () => {
    const f = await piece("inscrire", "facture_achat");
    const p = await payer(f, "virement", 750_000, "VIR-2026-991");
    const id = (await rpc("office", "proposerLeReglement", p)) as string;
    assert.ok(id);
    const ecritures = (await rpc("office", "ecrituresForPiece", f)) as Array<{
      id: string;
      journal: string;
      lines: Array<{ accountCode: string; debit: string; credit: string }>;
    }>;
    const ecr = ecritures.find((e) => e.id === id);
    assert.ok(ecr, "l'écriture du règlement est attachée à la pièce");
    assert.equal(ecr.journal, "BQ");
    const somme = (cle: "debit" | "credit") =>
      ecr.lines.reduce((s, l) => s + Number(l[cle]), 0).toFixed(3);
    assert.equal(somme("debit"), somme("credit"));
  });
});
