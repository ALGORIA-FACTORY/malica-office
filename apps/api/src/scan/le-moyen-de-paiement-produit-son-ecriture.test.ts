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
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
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
    sousIdentiteDuServeur(u.id, (db) => executerRpc(db, { depot, methode, args }, "serveur"));

  const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
    const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    try {
      return await f(p);
    } finally {
      await p.end();
    }
  };

  /** Une pièce dont le sens est déclaré — comme à la capture. */
  const piece = async (cle: string, kind: string) => {
    const id = (
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
    if (["facture_achat", "facture_vente"].includes(kind))
      await rpc("capture", "preciser", id, "document_kind", kind);
    return id;
  };

  const payer = async (
    pieceId: string,
    moyenCode: string,
    montantMineur: number,
    reference?: string,
  ) => {
    const { rows } = await admin((db) =>
      db.query(`select id from capture.extractions where piece_id = $1`, [pieceId]),
    );
    if (!rows.length) await lue(pieceId, montantMineur);
    return rpc("capture", "enregistrerPaiement", {
      pieceId,
      packId: pack,
      moyenCode,
      montantMineur,
      devise: "TND",
      payeLe: "2026-10-13",
      justificatifPieceId: null,
      reference: reference ?? null,
    }) as Promise<string>;
  };
  const sansRetenue = (baseReglee = "100.000") => ({
    codes: [],
    baseReglee,
    justification: "Opération du jeu de test qualifiée sans retenue",
  });

  before(async () => {
    const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(c);
    u = c;
    org = await sousIdentiteDuServeur(u.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
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
    const r = (await rpc("office", "propositionDeReglement", p, {
      codes: ["RAS_MARCHES_ACQUISITIONS"],
      baseReglee: "1969.610",
      justification: "Certificat RS-1, acquisition qualifiée",
    })) as Proposition & {
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
    assert.equal(r.retenue?.cas, "a_confirmer");
    assert.equal(r.ecriture.lignes.length, 2);
  });

  it("des honoraires payés au net de 10 % : la retenue d'honoraires, sans seuil", async () => {
    const f = await piece("honoraires", "facture_achat");
    await lue(f, 595_000, 95_000);
    const p = await payer(f, "virement", 535_500, "VIR-HON-1");
    const r = (await rpc("office", "propositionDeReglement", p, {
      codes: ["RAS_HONORAIRES_COMMISSIONS_COURTAGES_LOYERS"],
      baseReglee: "595.000",
      justification: "Certificat honoraires, bénéficiaire qualifié",
    })) as Proposition & {
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
    const r = (await rpc("office", "propositionDeReglement", p, {
      codes: ["RAS_MARCHES_ACQUISITIONS", "rs_tva_publique"],
      baseReglee: "2380.000",
      tvaReglee: "380.000",
      justification: "Certificat payeur public RS-TVA-1",
    })) as Proposition;
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
    await rpc("office", "inscrireLeReglement", p, {
      codes: ["RAS_MARCHES_ACQUISITIONS"],
      baseReglee: "1969.610",
      justification: "Certificat RS-2",
    });
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
    const id = (await rpc("office", "proposerLeReglement", p, sansRetenue("750.000"))) as string;
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
  it("un paiement partiel de 1970 sur 2000 n'invente pas 30 de retenue", async () => {
    const f = await piece("partiel-pas-ras", "facture_achat");
    await lue(f, 2_000_000);
    const p = await payer(f, "virement", 1_970_000, "PARTIEL-1");
    const avant = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(avant.ok);
    assert.equal(avant.ecriture.lignes.length, 2);
    assert.equal(avant.ecriture.lignes[0]!.debit, "1970.000");
    await assert.rejects(rpc("office", "inscrireLeReglement", p), /Confirmez/);
    const id = await rpc("office", "inscrireLeReglement", p, {
      codes: [],
      baseReglee: "1970.000",
      justification: "Paiement partiel, opération hors champ de retenue",
    });
    assert.ok(id);
    const { rows } = await admin((db) =>
      db.query(
        `select count(*)::int as n from audit.event_log where object_id = $1 and action = 'reglement.qualifie'`,
        [id],
      ),
    );
    assert.equal(rows[0]!.n, 1);
  });

  it("une traite client passe en effets à recevoir, jamais en effets à payer", async () => {
    const f = await piece("traite-client", "facture_vente");
    const p = await payer(f, "traite", 100_000, "EFFET-1");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(r.ok);
    assert.equal(r.ecriture.journal, "OD");
    assert.equal(r.ecriture.lignes[0]!.account_code, "413");
    assert.equal(r.ecriture.lignes[1]!.account_code, "411");
    assert.doesNotMatch(r.ecriture.libelle, /COMPTOIR/);
  });

  it("annuler un paiement inscrit contre-passe exactement ses lignes, puis refuse sa réinscription", async () => {
    const f = await piece("annule-inscrit", "facture_achat");
    const p = await payer(f, "virement", 100_000, "VIR-ANNULATION");
    const id = await rpc("office", "inscrireLeReglement", p, sansRetenue());
    await rpc("capture", "annulerPaiement", p, motif);
    const { rows } = await admin((db) =>
      db.query(
        `select e.status, e.reverses_id, e.paiement_id,
      (select sum(debit) from socle.ecriture_lignes where ecriture_id = e.id)::text as debit,
      (select sum(credit) from socle.ecriture_lignes where ecriture_id = e.id)::text as credit
      from socle.ecritures e where e.reverses_id = $1`,
        [id],
      ),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "booked");
    assert.equal(rows[0]!.paiement_id, p);
    assert.equal(Number(rows[0]!.debit), 100);
    assert.equal(rows[0]!.credit, rows[0]!.debit);
    await assert.rejects(rpc("office", "inscrireLeReglement", p), /annulé/);
    await assert.rejects(
      rpc("capture", "annulerPaiement", p, motif),
      /refus\.paiement\.deja_annule$/,
    );
  });

  it("une proposition ancienne ne peut pas comptabiliser un paiement annulé", async () => {
    const f = await piece("annule-propose", "facture_achat");
    const p = await payer(f, "virement", 100_000, "VIR-PROPOSITION");
    const id = await rpc("office", "proposerLeReglement", p, sansRetenue());
    await rpc("capture", "annulerPaiement", p, motif);
    await assert.rejects(rpc("office", "book", id), /annulé/);
  });
  it("sous le seuil légal, un règlement s'inscrit sans aucune qualification", async () => {
    // Décision du 24 octobre 2026 : 100 DT est sous le seuil de 1 000 DT TTC,
    // aucune retenue n'est à constater et rien n'est demandé au comptable.
    const f = await piece("sous-le-seuil", "facture_achat");
    const p = await payer(f, "especes", 100_000, "CAISSE-1");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition & {
      retenue?: { cas: string };
    };
    assert.ok(r.ok, r.ok ? "" : r.raison);
    assert.equal(r.retenue?.cas, "sans_objet");
    const id = await rpc("office", "inscrireLeReglement", p);
    const { rows } = await admin((db) =>
      db.query(`select status from socle.ecritures where id = $1`, [id]),
    );
    assert.equal(rows[0]!.status, "booked");
  });

  it("une proposition d'hier qui ne correspond plus aux faits ne s'inscrit pas", async () => {
    // L'ancien moteur devinait 30 de retenue sur 1 970 payés pour 2 000. Une
    // telle proposition, restée dans la file, ne passe plus par « valider ».
    const f = await piece("proposition-perimee", "facture_achat");
    await lue(f, 2_000_000);
    const p = await payer(f, "virement", 1_970_000, "PERIME-1");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(r.ok, r.ok ? "" : r.raison);
    const devinee = [
      { account_code: "401", libelle: "Fournisseur", debit: "2000.000", credit: "0.000" },
      { account_code: "532", libelle: "Banque", debit: "0.000", credit: "1970.000" },
      { account_code: "432", libelle: "Retenue devinée", debit: "0.000", credit: "30.000" },
    ];
    const id = (await rpc("office", "propose", {
      pieceId: f,
      journal: r.ecriture.journal,
      date: r.ecriture.dateEcriture,
      libelle: r.ecriture.libelle,
      packVersionId: pack,
      devise: "TND",
      lignes: devinee,
      paiementId: p,
    })) as string;
    await assert.rejects(rpc("office", "book", id), /Confirmez|ne correspond plus/);
    const { rows } = await admin((db) =>
      db.query(`select status from socle.ecritures where id = $1`, [id]),
    );
    assert.equal(rows[0]!.status, "proposee");
  });

  it("redemander la proposition rend la même, sans en empiler une seconde", async () => {
    const f = await piece("idempotence", "facture_achat");
    const p = await payer(f, "virement", 100_000, "VIR-IDEM");
    const a = await rpc("office", "proposerLeReglement", p);
    const b = await rpc("office", "proposerLeReglement", p);
    assert.equal(a, b);
  });

  it("une qualification qui porte un champ étranger est refusée avant l'audit", async () => {
    const f = await piece("qualification-etrangere", "facture_achat");
    const p = await payer(f, "virement", 100_000, "VIR-ETRANGER");
    await assert.rejects(
      rpc("office", "inscrireLeReglement", p, { ...sansRetenue(), commentaire: "hors schéma" }),
      /illisible/,
    );
  });

  it("une retenue qualifiée solde la dette, conserve le net et bloque un second solde erroné", async () => {
    const f = await piece("solde-avec-ras", "facture_achat");
    await lue(f, 2_000_000);
    const p = await payer(f, "virement", 1_970_000, "NET-IR");
    await rpc("office", "inscrireLeReglement", p, {
      codes: ["RAS_MARCHES_ACQUISITIONS"],
      baseReglee: "2000.000",
      justification: "Certificat IR-SOLDE",
    });
    const historique = (await rpc("capture", "paiementsDUnePiece", f)) as Array<{
      id: string;
      montantMineur: number;
      detteEteinteMineur: number;
    }>;
    assert.equal(historique.find((x) => x.id === p)!.montantMineur, 1_970_000);
    assert.equal(historique.find((x) => x.id === p)!.detteEteinteMineur, 2_000_000);
    // Depuis le 25 octobre 2026, le second solde n'entre même plus : la base
    // juge le règlement sur la dette DÉJÀ éteinte, retenue comprise
    // (`un_reglement_dit_vrai`). Le refus de l'écriture reste derrière lui.
    await assert.rejects(payer(f, "virement", 30_000, "FAUX-SOLDE"), /paiement\.depasse_le_total/);
  });
  it("reprend le compte du tiers effectivement inscrit sur la facture", async () => {
    const f = await piece("tiers-inscrit", "facture_achat");
    await lue(f, 100_000);
    const id = await rpc("office", "propose", {
      pieceId: f,
      packVersionId: pack,
      devise: "TND",
      journal: "ACH",
      date: "2026-10-13",
      libelle: "Acquisition avec fournisseur immobilisation",
      lignes: [
        { account_code: "2282", libelle: "Immobilisation", debit: "100.000", credit: "0.000" },
        {
          account_code: "404",
          libelle: "Fournisseur immobilisation",
          debit: "0.000",
          credit: "100.000",
        },
      ],
    });
    await rpc("office", "book", id);
    const p = await payer(f, "virement", 100_000, "TIERS-INSCRIT");
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.ok(r.ok);
    assert.equal(r.ecriture.lignes[0]!.account_code, "404");
  });
  it("une écriture équilibrée avec un compte absent du plan reste refusée", async () => {
    const f = await piece("compte-invente", "facture_achat");
    await lue(f, 100_000);
    const id = await rpc("office", "propose", {
      pieceId: f,
      packVersionId: pack,
      devise: "TND",
      journal: "ACH",
      date: "2026-10-13",
      libelle: "Compte inexistant",
      lignes: [
        {
          account_code: "COMPTE_ABSENT",
          libelle: "Compte absent",
          debit: "100.000",
          credit: "0.000",
        },
        { account_code: "401", libelle: "Fournisseur", debit: "0.000", credit: "100.000" },
      ],
    });
    await assert.rejects(
      rpc("office", "book", id),
      /refus\.ecriture\.compte_hors_plan\?compte=COMPTE_ABSENT$/,
    );
  });

  it("ne réutilise pas l'analyse d'une extraction précédente", async () => {
    const f = await piece("analyse-perimee", "facture_achat");
    await lue(f, 100_000);
    const p = await payer(f, "virement", 100_000, "ANALYSE-PERIMEE");
    await admin((db) =>
      db.query(
        `insert into capture.extractions (tenant_id, piece_id, contract, payload) values ($1, $2, 'extract.v1', '{"issuer":"Nouvelle lecture"}')`,
        [org, f],
      ),
    );
    const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.raison, /lecture courante/);
  });
  it("respecte le compte bancaire choisi pour le dossier", async () => {
    const f = await piece("banque-du-dossier", "facture_achat");
    await lue(f, 100_000);
    const p = await payer(f, "virement", 100_000, "BANQUE-CONFIGUREE");
    await admin((db) =>
      db.query(
        `insert into parametrage.role_bindings (tenant_id, portee, portee_id, role_code, account_code, decide_par) values ($1, 'dossier', $1, 'BANQUE', '5321', $2)`,
        [org, u.id],
      ),
    );
    try {
      const r = (await rpc("office", "propositionDeReglement", p)) as Proposition;
      assert.ok(r.ok);
      assert.equal(r.ecriture.lignes[1]!.account_code, "5321");
    } finally {
      await admin((db) =>
        db.query(
          `delete from parametrage.role_bindings where portee = 'dossier' and portee_id = $1 and role_code = 'BANQUE'`,
          [org],
        ),
      );
    }
  });
});
