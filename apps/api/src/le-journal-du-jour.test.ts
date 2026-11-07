/**
 * Le journal du jour du comptable, et ses exports numérotés (28 octobre 2026).
 *
 * Spec « Malica sans blocage », section 4 : toutes les écritures validées et
 * forcées du jour, et les contre-passations, par journal, débit = crédit ;
 * export Excel et CSV, numéroté et gardé, le suivant dit ce qui a changé.
 * Jamais la PME, jamais un autre cabinet.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --import ./src/garde-base-de-test.ts --test src/le-journal-du-jour.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { strFromU8, unzipSync } from "fflate";
import type { LigneSaisie } from "@malica/socle/ecriture-saisie";
import pg from "pg";

import type { AddressInfo } from "node:net";

import { creerCompte, emettreJeton, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { journalDuJour } from "./depots/journal-du-jour.ts";
import { office } from "./depots/office.ts";
import { parametrage } from "./depots/parametrage.ts";
import { supervision } from "./depots/supervision.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lireUnExport } from "./stockage.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("le journal du jour du comptable", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `journal-jour-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let autreExpert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let autreCabinet = "";
  let pack = "";
  let motif = "";
  let jour = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const ids: Record<string, string> = {};
  const pieces: Record<string, string> = {};

  /** Un montant qu'un flottant ne sait pas écrire : seize chiffres significatifs et plus. */
  const GRAND = "9007199254740.993";

  const lignes = (charge: string, montant: string): LigneSaisie[] => [
    { account_code: charge, libelle: "Achat", debit: montant, credit: "0", tax_code: "EXO" },
    { account_code: "401", libelle: "Fournisseur", debit: "0", credit: montant, tax_code: null },
  ];

  const piece = (cle: string) =>
    sousIdentite(dirigeant.id, async () => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, 'facture_achat', 'confirme', now()) returning id`,
        [pme, `essai/${marque}-${cle}.pdf`, `${marque}-${cle}`, dirigeant.id],
      );
      return rows[0]!.id;
    });

  /**
   * La société inscrivait elle-même AVANT le lot 5. Depuis le lot S5, aucun
   * membre de la PME n'inscrit pendant qu'un cabinet est engagé : pour rejouer
   * cette histoire, le mandat se suspend le temps de l'inscription.
   */
  const commeAvant = async <T>(f: () => Promise<T>): Promise<T> => {
    await admin.query(
      `update identity.engagements set status = 'suspendu' where pme_org_id = $1 and status = 'actif'`,
      [pme],
    );
    try {
      return await f();
    } finally {
      await admin.query(
        `update identity.engagements set status = 'actif' where pme_org_id = $1 and status = 'suspendu'`,
        [pme],
      );
    }
  };

  /** Proposer puis inscrire, sous l'identité donnée (la société : comme avant le lot 5). */
  const inscrire = (qui: Utilisateur, pieceId: string, libelle: string, l: unknown) =>
    qui === dirigeant
      ? commeAvant(() => inscrireSous(qui, pieceId, libelle, l))
      : inscrireSous(qui, pieceId, libelle, l);
  const inscrireSous = (qui: Utilisateur, pieceId: string, libelle: string, l: unknown) =>
    sousIdentite(qui.id, async (db) => {
      const id = await office.propose(db, {
        pieceId,
        journal: "ACH",
        date: "2026-10-20",
        libelle,
        packVersionId: pack,
        devise: "TND",
        lignes: l,
      });
      await office.book(db, id);
      return id;
    });

  /** Forcer : le comptable réimpute, la vivante est contre-passée (lot 5). */
  const forcer = (pieceId: string, libelle: string, l: LigneSaisie[]) =>
    sousIdentite(expert.id, (db) =>
      office.forcer(db, { pieceId, journal: "ACH", date: "2026-10-20", libelle, lignes: l }),
    );

  const lire = (qui: Utilisateur, cab: string, client: string | null, j = jour) =>
    sousIdentite(qui.id, (db) => journalDuJour.lire(db, cab, client, j, "fr"));

  /** Le fichier GARDÉ d'un export, relu sous l'identité donnée (la même RLS que la route). */
  const fichier = (qui: Utilisateur, exportId: string) =>
    sousIdentite(qui.id, (db) => lireUnExport(db, exportId));
  const texteGarde = async (exportId: string) =>
    Buffer.from((await fichier(expert, exportId))!.octets).toString("utf8");

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, mdp);
    const e = await creerCompte(`expert-${marque}@essai.local`, mdp);
    const a = await creerCompte(`autre-${marque}@essai.local`, mdp);
    assert.ok(d && e && a);
    dirigeant = d;
    expert = e;
    autreExpert = a;
    const legalId = matriculeDEssai();
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'autonome', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `CABINET ${marque}`, null);
    autreCabinet = await creer(autreExpert, "cabinet", `AUTRE ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));

    const { rows: p } = await admin.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    pack = p[0]!.id;
    const { rows: m } = await admin.query<{ id: string }>(
      `select id from ref.rejet_motifs where usage = 'retour' order by requires_note, sort_order limit 1`,
    );
    motif = m[0]!.id;
    // Le jour du cabinet : celui de son fuseau, au défaut de sa juridiction.
    const calendrier = await sousIdentite(expert.id, (db) =>
      parametrage.fuseauDuCabinet(db, cabinet),
    );
    assert.ok(calendrier.fuseau && calendrier.aujourdhui && !calendrier.regle);
    jour = calendrier.aujourdhui;

    // Validée : l'expert inscrit la proposition du Socle, montant hors de portée d'un flottant.
    ids["validee"] = await inscrire(expert, await piece("a"), "Facture A", lignes("601", GRAND));

    // Validée en supervision : la société inscrivait (avant le lot 5), l'expert valide.
    pieces["b"] = await piece("b");
    ids["supervisee"] = await inscrire(dirigeant, pieces["b"], "Facture B", lignes("601", "0.100"));
    await sousIdentite(expert.id, (db) =>
      supervision.review(db, { ecritureId: ids["supervisee"]!, outcome: "valide" }),
    );

    // Forcée : l'expert réimpute — contre-passation de l'erreur, puis la correction.
    pieces["c"] = await piece("c");
    ids["remplacee"] = await inscrire(expert, pieces["c"], "Facture C", lignes("601", "0.200"));
    ids["forcee"] = await forcer(pieces["c"], "Facture C réimputée", lignes("622", "0.200"));

    // Inscrite par la société, jamais prise en charge : pas au journal du cabinet.
    ids["horsJournal"] = await inscrire(
      dirigeant,
      await piece("d"),
      "Facture D",
      lignes("601", "7.000"),
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet, autreCabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("porte les validées, la forcée et la contre-passation du jour, avec leur origine", async () => {
    const j = await lire(expert, cabinet, pme);
    const ecritures = j.journaux.flatMap((x) => x.ecritures);
    const origine = (id: string) => ecritures.find((e) => e.id === id)?.origine;
    assert.equal(origine(ids["validee"]!), "validee");
    assert.equal(origine(ids["supervisee"]!), "validee");
    assert.equal(origine(ids["remplacee"]!), "validee");
    assert.equal(origine(ids["forcee"]!), "forcee");
    const cp = ecritures.find((e) => e.contrePasse === ids["remplacee"]);
    assert.equal(cp?.origine, "contre_passation");
    assert.equal(origine(ids["horsJournal"]!), undefined, "non prise en charge : hors journal");

    assert.equal(j.totaux.ecritures, 5);
    assert.equal(j.totaux.validees, 3);
    assert.equal(j.totaux.forcees, 1);
    assert.equal(j.totaux.contrePassations, 1);

    // Le comptable est nommé, l'heure est dite ; l'écriture remplacée sait qu'elle l'est.
    const forcee = ecritures.find((e) => e.id === ids["forcee"])!;
    assert.equal(forcee.par, `expert-${marque}@essai.local`);
    assert.match(forcee.heure, /^\d{2}:\d{2}$/);
    assert.ok(ecritures.find((e) => e.id === ids["remplacee"])!.contrePasseeLe);
    // Validée en supervision : c'est le superviseur qui l'a prise en charge.
    assert.equal(
      ecritures.find((e) => e.id === ids["supervisee"])!.par,
      `expert-${marque}@essai.local`,
    );
  });

  it("range par journal du référentiel, libellé dans la langue demandée", async () => {
    const fr = await lire(expert, cabinet, pme);
    assert.deepEqual(
      fr.journaux.map((x) => x.code),
      ["ACH"],
    );
    const { rows } = await admin.query<{ value: string }>(
      `select value from ref.labels where ns = 'journal' and key = 'ACH' and locale = 'ar'`,
    );
    const ar = await sousIdentite(expert.id, (db) =>
      journalDuJour.lire(db, cabinet, pme, jour, "ar"),
    );
    assert.equal(ar.journaux[0]?.libelle, rows[0]?.value);
  });

  it("contrôle débit = crédit, en montants exacts", async () => {
    const j = await lire(expert, cabinet, pme);
    // GRAND + 0.100 + 0.200 (remplacée) + 0.200 (contre-passation) + 0.200 (forcée).
    const attendu = "9007199254741.693";
    assert.deepEqual(j.totaux.soldes, [
      { devise: "TND", debit: attendu, credit: attendu, equilibre: true },
    ]);
    assert.equal(j.journaux[0]?.soldes[0]?.equilibre, true);
    const validee = j.journaux[0]!.ecritures.find((e) => e.id === ids["validee"])!;
    assert.equal(validee.debit, GRAND);
    assert.equal(validee.lignes[0]?.debit, GRAND);
  });

  it("la vue « tous mes clients » porte le dossier", async () => {
    const j = await lire(expert, cabinet, null);
    const ecritures = j.journaux.flatMap((x) => x.ecritures);
    assert.ok(ecritures.some((e) => e.id === ids["forcee"] && e.clientTenantId === pme));
  });

  it("refuse la PME, et un autre cabinet", async () => {
    await assert.rejects(lire(dirigeant, cabinet, pme), /refus\.introuvable\.(cabinet|dossier)$/);
    await assert.rejects(lire(dirigeant, pme, pme), /refus\.introuvable\.(cabinet|dossier)$/);
    await assert.rejects(
      lire(autreExpert, autreCabinet, pme),
      /refus\.introuvable\.(cabinet|dossier)$/,
    );
    await assert.rejects(lire(autreExpert, cabinet, pme), /refus\.introuvable\.(cabinet|dossier)$/);
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) =>
        journalDuJour.exporter(db, cabinet, pme, jour, "fr", "csv"),
      ),
      /refus\.introuvable\.(cabinet|dossier)$/,
    );
  });

  it("les lectures internes du journal ne s'appellent pas d'un autre dossier", async () => {
    // Revue de #129 : deux fonctions `security definer` sans garde rendaient la
    // prise en charge et le fuseau de n'importe quel cabinet.
    await assert.rejects(
      sousIdentite(autreExpert.id, (db) =>
        db.query(`select * from app.ecriture_prise_en_charge($1, $2)`, [cabinet, ids["validee"]]),
      ),
      /permission denied|permission refusée/,
    );
    await assert.rejects(
      sousIdentite(autreExpert.id, (db) => db.query(`select app.fuseau_du_cabinet($1)`, [cabinet])),
      /permission denied|permission refusée/,
    );
  });

  it("refuse d'exporter un jour à venir : un jour futur ne prend pas de numéro", async () => {
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        journalDuJour.exporter(db, cabinet, pme, "2099-01-01", "fr", "csv"),
      ),
      /refus\.export\.jour_a_venir$/,
    );
    const { rows } = await admin.query(
      `select 1 from collab.exports where tenant_id = $1 and du = '2099-01-01'`,
      [cabinet],
    );
    assert.equal(rows.length, 0);
  });

  it("numérote chaque export, garde son empreinte, et dit ce qui a changé depuis", async () => {
    const premier = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, jour, "fr", "csv"),
    );
    assert.equal(premier.numero, 1);
    assert.equal(premier.precedent, null);
    // Le fichier est GARDÉ (revue de #129) : il se relit, à l'octet près.
    const garde1 = await fichier(expert, premier.id);
    assert.ok(garde1, "le fichier numéroté se télécharge à nouveau");
    assert.equal(garde1.nomDeFichier, premier.nomDeFichier);
    const contenu = Buffer.from(garde1.octets).toString("utf8");
    assert.ok(contenu.startsWith("﻿dossier;journal;journal_libelle;ecriture;"));
    assert.ok(contenu.includes(`;${GRAND};0.000;TND;validee;`));
    // Le contrôle débit = crédit est DANS le fichier : le total du journal et le général.
    const totaux = contenu.split("\r\n").filter((l) => l.includes(";total;"));
    assert.equal(totaux.length, 2);
    // Puis les sept colonnes du cours d'origine (devise, montant, taux, date, source,
    // origine, motif), vides sur un total (31 octobre 2026 ; revue de #148).
    for (const t of totaux) assert.ok(t.endsWith(";TND;equilibre;;;;;;;;;"), t);
    assert.equal(premier.lignes, 10, "les lignes d'écriture, sans les totaux");
    assert.equal(premier.empreinte, createHash("sha256").update(garde1.octets).digest("hex"));
    // La PME et un autre cabinet ne le lisent pas.
    assert.equal(await fichier(dirigeant, premier.id), null);
    assert.equal(await fichier(autreExpert, premier.id), null);
    const { rows: garde } = await admin.query<{ numero: number; empreinte: string; n: number }>(
      `select numero, empreinte, cardinality(ecritures) as n from collab.exports where id = $1`,
      [premier.id],
    );
    assert.deepEqual(garde[0], { numero: 1, empreinte: premier.empreinte, n: 5 });

    // Le journal reste modifiable : on contre-passe une validée, on en ajoute une.
    await sousIdentite(expert.id, (db) =>
      supervision.review(db, {
        ecritureId: ids["validee"]!,
        outcome: "retourne",
        motifId: motif,
        note: "à reprendre",
      }),
    );
    await inscrire(expert, await piece("e"), "Facture E", lignes("601", "1.000"));

    const apres = await lire(expert, cabinet, pme);
    assert.equal(apres.dernierExport?.numero, 1);
    assert.equal(apres.dernierExport?.format, "csv");
    assert.deepEqual(apres.dernierExport?.ecart, {
      ajoutees: 2,
      contrePassees: 1,
      retirees: 0,
      fuseauChange: false,
    });
    assert.deepEqual(
      apres.exports.map((x) => [x.numero, x.id]),
      [[1, premier.id]],
      "les exports du jour, chacun retéléchargeable",
    );

    const second = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, jour, "fr", "xlsx"),
    );
    assert.equal(second.numero, 2);
    assert.equal(second.precedent, 1);
    assert.deepEqual(second.ecart, {
      ajoutees: 2,
      contrePassees: 1,
      retirees: 0,
      fuseauChange: false,
    });
    const octets = (await fichier(expert, second.id))!.octets;
    assert.equal(second.empreinte, createHash("sha256").update(octets).digest("hex"));
    const feuille = strFromU8(unzipSync(octets)["xl/worksheets/sheet1.xml"]!);
    assert.ok(feuille.includes(`<v>${GRAND}</v>`), "le montant entre tel quel, sans flottant");
    assert.ok(feuille.includes(">contre_passee<"), "l'écriture contre-passée depuis le n° 1");
    assert.ok(feuille.includes(">ajoutee<"), "les écritures nouvelles depuis le n° 1");

    // Une autre journée recommence à 1.
    const veille = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, "2020-01-01", "fr", "csv"),
    );
    assert.equal(veille.numero, 1);
    assert.equal(veille.lignes, 0);
  });

  it("sert un export gardé par sa route, au cabinet seul, sous son nom", async () => {
    const exporte = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, jour, "fr", "xlsx"),
    );
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    try {
      const telecharger = (qui: Utilisateur) =>
        fetch(`${base}/exports/${exporte.id}/contenu`, {
          headers: { Authorization: `Bearer ${emettreJeton(qui)}` },
        });
      const r = await telecharger(expert);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), exporte.typeMime);
      assert.ok(r.headers.get("content-disposition")?.includes(exporte.nomDeFichier));
      // Jamais une page active sur l'origine de l'application (audit S1).
      assert.match(r.headers.get("content-disposition") ?? "", /^attachment\b/);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.equal(r.headers.get("content-security-policy"), "sandbox; default-src 'none'");
      const octets = new Uint8Array(await r.arrayBuffer());
      assert.equal(createHash("sha256").update(octets).digest("hex"), exporte.empreinte);
      assert.equal((await telecharger(dirigeant)).status, 404);
      assert.equal((await telecharger(autreExpert)).status, 404);
    } finally {
      await new Promise<void>((resoudre) => serveur.close(() => resoudre()));
    }
  });

  it("garde les exports au seul cabinet : la PME n'en lit aucun", async () => {
    const lus = await sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query(`select id from exports_v where tenant_id = $1`, [cabinet]);
      return rows.length;
    });
    assert.equal(lus, 0);
  });

  it("refuse un numéro qui ne suit pas le dernier : deux exports ne portent pas le même", async () => {
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        db.query(
          `select public.journal_export_journaliser($1, $2, $3::date, 'journal_csv', 1, 0, 0,
                    repeat('0', 64), $4, '{}'::uuid[], '{}'::uuid[], '{}'::jsonb,
                    public.cabinet_fuseau_lire($1) ->> 'fuseau', 'essai.csv', 'text/csv')`,
          [cabinet, pme, jour, pack],
        ),
      ),
      /refus\.export\.concurrent$/,
    );
  });

  it("deux exports VRAIMENT simultanés : le second attend, et porte le numéro suivant", async () => {
    const exporter = () =>
      sousIdentite(expert.id, (db) => journalDuJour.exporter(db, cabinet, pme, jour, "fr", "csv"));
    const [a, b] = await Promise.all([exporter(), exporter()]);
    const numeros = [a.numero, b.numero].sort((x, y) => x - y);
    assert.equal(numeros[1], numeros[0]! + 1);
    assert.equal(Math.max(a.precedent ?? 0, b.precedent ?? 0), numeros[0]);
  });

  it("une validée en supervision puis forcée reste à son journal : un jour passé ne change pas", async () => {
    // Relecture du 29 octobre 2026 : le retour réécrit `reviewed_at` et
    // `review_outcome`, et la validée disparaissait.
    await forcer(pieces["b"]!, "Facture B réimputée", lignes("622", "0.100"));
    const j = await lire(expert, cabinet, pme);
    const ecritures = j.journaux.flatMap((x) => x.ecritures);
    const supervisee = ecritures.find((e) => e.id === ids["supervisee"]);
    assert.equal(supervisee?.origine, "validee");
    assert.ok(supervisee?.contrePasseeLe, "et elle se dit contre-passée");
    assert.ok(ecritures.some((e) => e.contrePasse === ids["supervisee"]));
    assert.ok(ecritures.some((e) => e.origine === "forcee" && e.libelle === "Facture B réimputée"));
    assert.ok(j.totaux.soldes.every((s) => s.equilibre));
  });

  it("la contre-passation d'une écriture jamais prise en charge n'entre pas au journal", async () => {
    await sousIdentite(expert.id, (db) =>
      supervision.review(db, {
        ecritureId: ids["horsJournal"]!,
        outcome: "retourne",
        motifId: motif,
        note: "à reprendre",
      }),
    );
    const j = await lire(expert, cabinet, pme);
    const ecritures = j.journaux.flatMap((x) => x.ecritures);
    assert.ok(!ecritures.some((e) => e.contrePasse === ids["horsJournal"]));
  });

  it("reconnaît un forçage d'avant la marque : retour et correction dans une transaction", async () => {
    const remplacee = await inscrire(expert, await piece("h"), "Facture H", lignes("601", "3.000"));
    // Ce que faisait `corrigerLImputation` avant le 28 octobre : sans `ecriture.forcee`.
    const correction = await sousIdentite(expert.id, async (db) => {
      await db.query(`select public.socle_ecriture_review($1, 'retourne', $2, 'ancien')`, [
        remplacee,
        motif,
      ]);
      const n = await office.propose(db, {
        pieceId: (
          await db.query<{ p: string }>(`select piece_id as p from ecritures_v where id = $1`, [
            remplacee,
          ])
        ).rows[0]!.p,
        journal: "ACH",
        date: "2026-10-20",
        libelle: "Facture H réimputée",
        packVersionId: pack,
        devise: "TND",
        lignes: lignes("622", "3.000"),
      });
      await office.book(db, n);
      return n;
    });
    const { rows } = await admin.query(
      `select 1 from audit.event_log where object_id = $1 and action = 'ecriture.forcee'`,
      [correction],
    );
    assert.equal(rows.length, 0, "aucune marque : le forçage se reconnaît à la transaction");
    const j = await lire(expert, cabinet, pme);
    const e = j.journaux.flatMap((x) => x.ecritures).find((x) => x.id === correction);
    assert.equal(e?.origine, "forcee");
  });

  it("lit le jour dans le fuseau du cabinet : près de minuit, Tunis et Dakar diffèrent", async () => {
    // 23 h 30 UTC le 14 mars : 00 h 30 le 15 à Tunis (UTC+1), 23 h 30 le 14 à Dakar (UTC+0).
    const id = await sousIdentite(expert.id, async (db) =>
      office.propose(db, {
        pieceId: await piece("minuit"),
        journal: "ACH",
        date: "2026-03-14",
        libelle: "Facture de minuit",
        packVersionId: pack,
        devise: "TND",
        lignes: lignes("601", "2.000"),
      }),
    );
    await admin.query(
      `update socle.ecritures
          set status = 'booked', booked_by = $2, booked_at = '2026-03-14T23:30:00Z'
        where id = $1`,
      [id, expert.id],
    );
    const present = async (j: string) =>
      (await lire(expert, cabinet, pme, j)).journaux
        .flatMap((x) => x.ecritures)
        .find((e) => e.id === id);

    // Le défaut de la juridiction du cabinet (TN) : Tunis.
    assert.equal((await present("2026-03-15"))?.heure, "00:30");
    assert.equal(await present("2026-03-14"), undefined);

    // L'expert arrête Dakar : l'écriture revient au 14, et le numéro suit ce jour-là.
    const regle = await sousIdentite(expert.id, (db) =>
      parametrage.definirFuseauDuCabinet(db, cabinet, "Africa/Dakar"),
    );
    assert.deepEqual([regle.fuseau, regle.regle], ["Africa/Dakar", true]);
    assert.equal((await present("2026-03-14"))?.heure, "23:30");
    assert.equal(await present("2026-03-15"), undefined);
    const exporte = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, "2026-03-14", "fr", "csv"),
    );
    assert.equal(exporte.numero, 1);
    assert.ok((await texteGarde(exporte.id)).includes(id));

    // Un fuseau inventé est refusé ; seul l'expert le règle ; nul, le défaut revient.
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        parametrage.definirFuseauDuCabinet(db, cabinet, "Mars/Olympe"),
      ),
      /refus\.fuseau\.inconnu\?fuseau=/,
    );
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) => parametrage.definirFuseauDuCabinet(db, cabinet, null)),
    );
    const defaut = await sousIdentite(expert.id, (db) =>
      parametrage.definirFuseauDuCabinet(db, cabinet, null),
    );
    assert.equal(defaut.regle, false);
    assert.equal(defaut.fuseau, defaut.defaut);
  });

  /* ============ avec les versions d'une pièce (lot 1, #127) */

  const rpc = (qui: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentiteDuServeur(qui.id, (db) => executerRpc(db, { depot, methode, args }));
  const entrees = async () =>
    (await lire(expert, cabinet, pme)).journaux.flatMap((x) => x.ecritures);

  it("un règlement saisi sur une version précédente paraît une fois, sous la pièce courante", async () => {
    const ancienne = await piece("version-a");
    const paiement = (await rpc(dirigeant, "capture", "enregistrerPaiement", {
      pieceId: ancienne,
      packId: pack,
      moyenCode: "especes",
      montantMineur: 30000,
      devise: "TND",
      payeLe: "2026-10-03",
    })) as string;
    const { id: courante } = (await rpc(dirigeant, "capture", "enregistrer", {
      tenantId: pme,
      source: "photo",
      vis: "partage",
      idempotencyKey: `${marque}-version-b`,
      contentType: "image/jpeg",
      remplace: ancienne,
    })) as { id: string };
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      db.query(
        `select public.capture_read_persist($1, $2::jsonb, 'extract.v1', $3::jsonb,
                                             '[]'::jsonb, '[]'::jsonb)`,
        [
          courante,
          JSON.stringify([{ page: 1, ordinal: 0, text: "TOTAL", x0: 0, y0: 0, x1: 1, y1: 1 }]),
          JSON.stringify({ document_kind: "facture_achat" }),
        ],
      ),
    );
    await admin.query(
      `insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                     normalisation, controles, verdict, motifs)
       select $1, $2, x.id, $3, jsonb_build_object('montants', jsonb_build_object('ttc', '30000')),
              '["essai"]', 'à comptabiliser', '["essai"]'
         from capture.extractions x where x.piece_id = $2
        order by x.created_at desc limit 1`,
      [pme, courante, pack],
    );
    await sousIdentite(expert.id, (db) =>
      db.query(`select public.piece_type_etabli_par_le_cabinet($1)`, [courante]),
    );
    const reglement = (await rpc(expert, "office", "inscrireLeReglement", paiement)) as string;

    const vues = (await entrees()).filter((e) => e.id === reglement);
    assert.equal(vues.length, 1, "une fois");
    assert.equal(vues[0]?.pieceId, courante, "sous la pièce courante, pas la version remplacée");
  });

  it("la contre-passation d'une pièce retournée puis supprimée reste au journal", async () => {
    const p = await piece("supprimee");
    const prise = await inscrire(expert, p, "Facture S", lignes("601", "4.000"));
    await sousIdentite(expert.id, (db) =>
      supervision.review(db, { ecritureId: prise, outcome: "retourne", motifId: motif, note: "x" }),
    );
    assert.equal(await rpc(dirigeant, "capture", "supprimer", p), true);
    const { rows } = await admin.query(`select archivee_le from capture.pieces where id = $1`, [p]);
    assert.ok(rows[0]?.archivee_le, "la pièce s'archive, elle ne part pas");
    const ecritures = await entrees();
    assert.ok(ecritures.some((e) => e.id === prise && e.contrePasseeLe));
    assert.ok(ecritures.some((e) => e.contrePasse === prise && e.origine === "contre_passation"));
  });

  it("une chaîne supprimée sans écriture inscrite ne laisse rien au journal", async () => {
    const ancienne = await piece("sans-ecriture");
    await sousIdentite(expert.id, (db) =>
      office.propose(db, {
        pieceId: ancienne,
        journal: "ACH",
        date: "2026-10-20",
        libelle: "Jamais inscrite",
        packVersionId: pack,
        devise: "TND",
        lignes: lignes("601", "5.000"),
      }),
    );
    await sousIdentite(expert.id, (db) =>
      supervision.retourner(db, { pieceId: ancienne, motifId: motif, note: "x" }),
    );
    const { id: courante } = (await rpc(dirigeant, "capture", "enregistrer", {
      tenantId: pme,
      source: "photo",
      vis: "partage",
      idempotencyKey: `${marque}-sans-ecriture-b`,
      contentType: "image/jpeg",
      remplace: ancienne,
    })) as { id: string };
    const avant = (await entrees()).length;
    assert.equal(await rpc(dirigeant, "capture", "supprimer", courante), true);
    const { rows } = await admin.query(`select 1 from capture.pieces where id = any($1::uuid[])`, [
      [ancienne, courante],
    ]);
    assert.equal(rows.length, 0, "la chaîne part tout entière");
    const apres = await entrees();
    assert.equal(apres.length, avant);
    assert.ok(!apres.some((e) => e.pieceId === ancienne || e.pieceId === courante));
  });

  /* ============ revue de #129 : un jour passé ne change jamais après coup */

  it("un collaborateur parti : ses écritures et leurs contre-passations restent, son nom aussi", async () => {
    const parti = await creerCompte(`parti-${marque}@essai.local`, mdp);
    assert.ok(parti);
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')`,
      [cabinet, parti.id],
    );
    const sienne = await inscrire(parti, await piece("parti"), "Facture P", lignes("601", "6.000"));
    await sousIdentite(parti.id, (db) =>
      supervision.review(db, {
        ecritureId: sienne,
        outcome: "retourne",
        motifId: motif,
        note: "x",
      }),
    );
    const avant = (await entrees()).filter((e) => e.id === sienne || e.contrePasse === sienne);
    assert.equal(avant.length, 2);
    assert.ok(avant.every((e) => e.par === `parti-${marque}@essai.local`));

    await admin.query(`delete from identity.memberships where tenant_id = $1 and user_id = $2`, [
      cabinet,
      parti.id,
    ]);
    const apres = (await entrees()).filter((e) => e.id === sienne || e.contrePasse === sienne);
    assert.deepEqual(apres, avant, "le jour passé est inchangé");
  });

  it("une contre-passation avant toute prise en charge reste hors du jour, même prise en charge le lendemain", async () => {
    // Repro de la revue de #129 : retour le jour D d'une écriture de la société,
    // validation le jour D+1 — la contre-passation entrait alors au jour D.
    const e = await inscrire(
      dirigeant,
      await piece("d-puis-d1"),
      "Facture D1",
      lignes("601", "8.000"),
    );
    await sousIdentite(expert.id, (db) =>
      supervision.review(db, { ecritureId: e, outcome: "retourne", motifId: motif, note: "x" }),
    );
    const rev = (
      await admin.query<{ id: string }>(`select id from socle.ecritures where reverses_id = $1`, [
        e,
      ])
    ).rows[0]!.id;
    // Le retour recule d'un jour (le jour D), faits gelés compris. Les gardes
    // R7 se lèvent pour CETTE session seulement (`session_replication_role`) :
    // un `alter table … disable trigger` verrouillerait la table de toutes les
    // épreuves qui tournent en parallèle.
    const session = await admin.connect();
    try {
      await session.query(`set session_replication_role = replica`);
      await session.query(
        `update socle.ecritures set booked_at = booked_at - interval '1 day',
                created_at = created_at - interval '1 day' where id = $1`,
        [rev],
      );
      await session.query(
        `update socle.prises_en_charge set prise_le = prise_le - interval '1 day'
          where ecriture_id = $1`,
        [rev],
      );
    } finally {
      await session.query(`reset session_replication_role`);
      session.release();
    }
    const veille = (
      await admin.query<{ d: string }>(
        `select (booked_at at time zone app.fuseau_du_cabinet($1))::date::text as d
           from socle.ecritures where id = $2`,
        [cabinet, rev],
      )
    ).rows[0]!.d;
    const idsDuJour = async () =>
      (await lire(expert, cabinet, pme, veille)).journaux
        .flatMap((x) => x.ecritures)
        .map((x) => x.id);
    const avant = await idsDuJour();
    // Le jour D+1, l'écriture annulée est prise en charge. Depuis le lot 1, la
    // supervision refuse une écriture déjà contre-passée : le fait est posé tel
    // qu'il serait gelé, pour éprouver la règle elle-même.
    await admin.query(
      `insert into socle.prises_en_charge (tenant_id, ecriture_id, client_tenant_id, par, par_nom, prise_le)
       values ($1, $2, $3, $4, 'essai', now())`,
      [cabinet, e, pme, expert.id],
    );
    assert.deepEqual(await idsDuJour(), avant, "le jour D ne change pas après coup");
    assert.ok(!avant.includes(rev));
  });

  it("un fuseau changé ne fabrique pas d'écart : l'export suivant le dit", async () => {
    const premier = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, jour, "fr", "csv"),
    );
    await sousIdentite(expert.id, (db) =>
      parametrage.definirFuseauDuCabinet(db, cabinet, "Pacific/Kiritimati"),
    );
    try {
      const lu = await lire(expert, cabinet, pme, jour);
      assert.equal(lu.dernierExport?.numero, premier.numero);
      assert.deepEqual(lu.dernierExport?.ecart, {
        ajoutees: 0,
        contrePassees: 0,
        retirees: 0,
        fuseauChange: true,
      });
      const suivant = await sousIdentite(expert.id, (db) =>
        journalDuJour.exporter(db, cabinet, pme, jour, "fr", "csv"),
      );
      assert.equal(suivant.ecart.fuseauChange, true);
      assert.ok(!(await texteGarde(suivant.id)).includes(";ajoutee"), "aucun faux « ajoutée »");
      const { rows } = await admin.query<{ fuseau: string }>(
        `select fuseau from collab.exports where id = $1`,
        [suivant.id],
      );
      assert.equal(rows[0]?.fuseau, "Pacific/Kiritimati", "chaque export garde son fuseau");
    } finally {
      await sousIdentite(expert.id, (db) => parametrage.definirFuseauDuCabinet(db, cabinet, null));
    }
  });
});
