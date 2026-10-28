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
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { journalDuJour } from "./depots/journal-du-jour.ts";
import { office } from "./depots/office.ts";
import { supervision } from "./depots/supervision.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

/** Le fuseau du lecteur : UTC, pour que « aujourd'hui » soit celui de la base. */
const FUSEAU = "UTC";

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

  /** Un montant qu'un flottant ne sait pas écrire : seize chiffres significatifs et plus. */
  const GRAND = "9007199254740.993";

  const lignes = (charge: string, montant: string) => [
    { account_code: charge, libelle: "Achat", debit: montant, credit: "0", tax_code: null },
    { account_code: "401", libelle: "Fournisseur", debit: "0", credit: montant, tax_code: null },
  ];

  const piece = (cle: string) =>
    sousIdentite(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into capture.pieces (tenant_id, source, vis, storage_path, idempotency_key, created_by,
                                     document_kind, document_kind_statut, transmise_le)
         values ($1, 'pdf', 'partage', $2, $3, $4, 'facture_achat', 'confirme', now()) returning id`,
        [pme, `essai/${marque}-${cle}.pdf`, `${marque}-${cle}`, dirigeant.id],
      );
      return rows[0]!.id;
    });

  /** Proposer puis inscrire, sous l'identité donnée. */
  const inscrire = (qui: Utilisateur, pieceId: string, libelle: string, l: unknown) =>
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

  const lire = (qui: Utilisateur, cab: string, client: string | null, j = jour) =>
    sousIdentite(qui.id, (db) => journalDuJour.lire(db, cab, client, j, FUSEAU, "fr"));

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
      `select id from ref.rejet_motifs order by requires_note, sort_order limit 1`,
    );
    motif = m[0]!.id;
    const { rows: j } = await admin.query<{ jour: string }>(
      `select (now() at time zone 'UTC')::date::text as jour`,
    );
    jour = j[0]!.jour;

    // Validée : l'expert inscrit la proposition du Socle, montant hors de portée d'un flottant.
    ids["validee"] = await inscrire(expert, await piece("a"), "Facture A", lignes("601", GRAND));

    // Validée en supervision : la société inscrit, l'expert valide.
    ids["supervisee"] = await inscrire(
      dirigeant,
      await piece("b"),
      "Facture B",
      lignes("601", "0.100"),
    );
    await sousIdentite(expert.id, (db) =>
      supervision.review(db, { ecritureId: ids["supervisee"]!, outcome: "valide" }),
    );

    // Forcée : l'expert réimpute — contre-passation de l'erreur, puis la correction.
    ids["remplacee"] = await inscrire(
      expert,
      await piece("c"),
      "Facture C",
      lignes("601", "0.200"),
    );
    ids["forcee"] = await sousIdentite(expert.id, (db) =>
      office.corrigerLImputation(db, {
        ecritureId: ids["remplacee"]!,
        motifId: motif,
        note: "Honoraires : 622",
        libelle: "Facture C réimputée",
        lignes: lignes("622", "0.200"),
      }),
    );

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
      journalDuJour.lire(db, cabinet, pme, jour, FUSEAU, "ar"),
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
    await assert.rejects(lire(dirigeant, cabinet, pme), /introuvable ou non/);
    await assert.rejects(lire(dirigeant, pme, pme));
    await assert.rejects(lire(autreExpert, autreCabinet, pme), /introuvable ou non/);
    await assert.rejects(lire(autreExpert, cabinet, pme), /introuvable ou non/);
    await assert.rejects(
      sousIdentite(dirigeant.id, (db) =>
        journalDuJour.exporter(db, cabinet, pme, jour, FUSEAU, "fr", "csv"),
      ),
    );
  });

  it("numérote chaque export, garde son empreinte, et dit ce qui a changé depuis", async () => {
    const premier = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, jour, FUSEAU, "fr", "csv"),
    );
    assert.equal(premier.numero, 1);
    assert.equal(premier.precedent, null);
    assert.equal(premier.encodage, "utf8");
    assert.ok(premier.contenu.startsWith("﻿dossier;journal;journal_libelle;ecriture;"));
    assert.ok(premier.contenu.includes(`;${GRAND};0.000;TND;validee;`));
    assert.equal(
      premier.empreinte,
      createHash("sha256").update(premier.contenu, "utf8").digest("hex"),
    );
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
    assert.deepEqual(apres.dernierExport?.ecart, { ajoutees: 2, contrePassees: 1, retirees: 0 });

    const second = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, jour, FUSEAU, "fr", "xlsx"),
    );
    assert.equal(second.numero, 2);
    assert.equal(second.precedent, 1);
    assert.deepEqual(second.ecart, { ajoutees: 2, contrePassees: 1, retirees: 0 });
    assert.equal(second.encodage, "base64");
    const octets = Buffer.from(second.contenu, "base64");
    assert.equal(second.empreinte, createHash("sha256").update(octets).digest("hex"));
    const feuille = strFromU8(unzipSync(new Uint8Array(octets))["xl/worksheets/sheet1.xml"]!);
    assert.ok(feuille.includes(`<v>${GRAND}</v>`), "le montant entre tel quel, sans flottant");
    assert.ok(feuille.includes(">contre_passee<"), "l'écriture contre-passée depuis le n° 1");
    assert.ok(feuille.includes(">ajoutee<"), "les écritures nouvelles depuis le n° 1");

    // Une autre journée recommence à 1.
    const veille = await sousIdentite(expert.id, (db) =>
      journalDuJour.exporter(db, cabinet, pme, "2020-01-01", FUSEAU, "fr", "csv"),
    );
    assert.equal(veille.numero, 1);
    assert.equal(veille.lignes, 0);
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
                    repeat('0', 64), $4, '{}'::uuid[], '{}'::uuid[], '{}'::jsonb)`,
          [cabinet, pme, jour, pack],
        ),
      ),
      /recommencez/,
    );
  });
});
