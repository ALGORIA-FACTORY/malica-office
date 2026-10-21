/**
 * Les échéances suivent le calendrier réel (20 octobre 2026).
 *
 * Décision : la date légale reste au pack ; une échéance qui tombe un jour
 * férié ou de repos se reporte au premier jour ouvrable ; un report
 * exceptionnel se saisit — par ALGORIA pour toute la juridiction, par le
 * cabinet pour ses dossiers — et celui du cabinet l'emporte. La date légale
 * reste lisible à côté de la date retenue.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { collab } from "./depots/collab.ts";
import { identite } from "./depots/identite.ts";
import { parametrage } from "./depots/parametrage.ts";
import { tour } from "./depots/tour.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("les échéances suivent le calendrier", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `calendrier-${Date.now()}`;
  const legalId = matriculeDEssai();
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let operateur: Utilisateur;
  let pme = "";
  let cabinet = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const ouvrable = async (jour: string) =>
    (
      await admin.query<{ d: string }>(`select app.jour_ouvrable('TN', $1::date)::text as d`, [
        jour,
      ])
    ).rows[0]!.d;

  const echeances = () =>
    sousIdentite(expert.id, async (db) => {
      await collab.deriverEcheances(db, [pme]);
      return collab.echeances(db, [pme]);
    });

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const o = await creerCompte(`operateur-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e && o);
    dirigeant = d;
    expert = e;
    operateur = o;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'autonome', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    // Une personne morale, au dépôt papier : RS_PM, le 28 de chaque mois.
    await admin.query(
      `insert into identity.fiches_fiscales (tenant_id, forme_juridique, mode_depot, source, valid_from, created_by)
       values ($1, 'morale', 'papier', 'saisie', current_date - 1, $2)`,
      [pme, expert.id],
    );
    await admin.query(
      `insert into app.platform_operators (user_id, note)
       values ($1, 'fixture de test automatisé') on conflict do nothing`,
      [operateur.id],
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update ref.reports_echeance
            set retire_le = now(), motif_retrait = 'fixture de test automatisé'
          where created_by = $1 and retire_le is null`,
        [operateur.id],
      );
      await admin.query(`delete from app.platform_operators where user_id = $1`, [operateur.id]);
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("un samedi, un dimanche ou un jour férié passent au premier jour ouvrable", async () => {
    assert.equal(await ouvrable("2026-10-28"), "2026-10-28"); // un mercredi
    assert.equal(await ouvrable("2026-11-28"), "2026-11-30"); // samedi → lundi
    assert.equal(await ouvrable("2026-12-17"), "2026-12-18"); // fête de la Révolution
    assert.equal(await ouvrable("2027-01-01"), "2027-01-04"); // jour de l'An, un vendredi
  });

  it("chaque échéance garde sa date légale, et la date retenue est un jour ouvrable", async () => {
    const lignes = (await echeances()).filter((e) => e.kind === "RS_PM");
    assert.ok(lignes.length > 0, "RS_PM doit être dérivée pour une personne morale au papier");
    for (const e of lignes) {
      assert.equal(e.dueDate, await ouvrable(e.dateLegale));
      assert.equal(e.dateOrigine, e.dueDate === e.dateLegale ? "loi" : "jour_ouvrable");
    }
  });

  it("un report publié par ALGORIA vaut pour tous, celui du cabinet l'emporte", async () => {
    const [premiere] = (await echeances()).filter((e) => e.kind === "RS_PM");
    assert.ok(premiere?.period);

    // Le cabinet ne publie pas pour toute la juridiction.
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        tour.publierReport(db, {
          juridiction: "TN",
          code: "RS_PM",
          periode: premiere.period!,
          nouvelleDate: "2030-01-15",
          motif: "essai",
          source: "essai",
        }),
      ),
      /plateforme/,
    );

    const publie = await sousIdentite(operateur.id, (db) =>
      tour.publierReport(db, {
        juridiction: "TN",
        code: "RS_PM",
        periode: premiere.period!,
        nouvelleDate: "2030-01-15",
        motif: "Prorogation exceptionnelle",
        source: "Communiqué du ministère des Finances",
      }),
    );
    let vue = (await echeances()).find((e) => e.id === premiere.id)!;
    assert.equal(vue.dueDate, "2030-01-15");
    assert.equal(vue.dateOrigine, "report_algoria");
    assert.equal(vue.dateLegale, premiere.dateLegale);
    assert.equal(vue.reportSource, "Communiqué du ministère des Finances");

    // Le report se motive.
    await assert.rejects(
      sousIdentite(expert.id, (db) =>
        parametrage.poserReport(db, {
          tenantId: cabinet,
          code: "RS_PM",
          periode: premiere.period!,
          nouvelleDate: "2030-02-10",
          motif: "  ",
          source: null,
        }),
      ),
      /motive/,
    );
    const pose = await sousIdentite(expert.id, (db) =>
      parametrage.poserReport(db, {
        tenantId: cabinet,
        code: "RS_PM",
        periode: premiere.period!,
        nouvelleDate: "2030-02-10",
        motif: "Accord de la recette des finances",
        source: null,
      }),
    );
    vue = (await echeances()).find((e) => e.id === premiere.id)!;
    assert.equal(vue.dueDate, "2030-02-10");
    assert.equal(vue.dateOrigine, "report_cabinet");
    assert.equal(vue.reportMotif, "Accord de la recette des finances");

    const lus = await sousIdentite(expert.id, (db) => parametrage.reportsDuCabinet(db, cabinet));
    assert.deepEqual(
      lus
        .filter((r) => r.id === pose.id || r.id === publie.id)
        .map((r) => r.origine)
        .sort(),
      ["report_algoria", "report_cabinet"],
    );

    // Retirés, les deux : la date revient au calendrier.
    await sousIdentite(expert.id, (db) => parametrage.retirerReport(db, cabinet, pose.id));
    await sousIdentite(operateur.id, (db) =>
      tour.retirerReportPublie(db, publie.id, "fin de l'essai"),
    );
    vue = (await echeances()).find((e) => e.id === premiere.id)!;
    assert.equal(vue.dueDate, await ouvrable(premiere.dateLegale));
  });

  it("la tour pose un jour férié daté, et le retire sans l'effacer", async () => {
    const lu = await sousIdentite(operateur.id, (db) => tour.calendrier(db, "TN"));
    assert.equal(lu.regle?.reportJourOuvrable, true);
    assert.ok(lu.joursFeries.some((f) => f.mois === 12 && f.jour === 17));

    const jour = "2031-06-11"; // un mercredi
    assert.equal(await ouvrable(jour), jour);
    const { id } = await sousIdentite(operateur.id, (db) =>
      tour.poserJourFerie(db, {
        juridiction: "TN",
        mois: null,
        jour: null,
        le: jour,
        libelle: "Fête d'essai",
        source: "fixture de test automatisé",
      }),
    );
    assert.equal(await ouvrable(jour), "2031-06-12");
    await sousIdentite(operateur.id, (db) => tour.retirerJourFerie(db, id, "fin de l'essai"));
    assert.equal(await ouvrable(jour), jour);
    const reste = await admin.query(`select valid_to from ref.jours_feries where id = $1`, [id]);
    assert.equal(reste.rowCount, 1);
  });

  it("ANO-LIVE-007 : un dossier non assujetti n'a pas d'échéance de TVA", async () => {
    const tva = (liste: Array<{ kind: string }>) => liste.filter((e) => e.kind.startsWith("TVA_"));
    assert.ok(tva(await echeances()).length > 0, "l'assujetti par défaut reçoit sa TVA");
    // Une fiche ne se réécrit pas (R7) : on en ouvre une nouvelle, dès aujourd'hui.
    await sousIdentite(dirigeant.id, (db) =>
      identite.etablirFiche(db, {
        tenantId: pme,
        regimeImposition: "forfaitaire",
        regimeTva: "non_assujetti",
        formeJuridique: "morale",
        modeDepot: "papier",
        source: "saisie",
        validFrom: new Date().toISOString().slice(0, 10),
      }),
    );
    const apres = await echeances();
    assert.deepEqual(tva(apres), [], "plus aucune échéance de TVA à faire");
    assert.ok(
      apres.some((e) => e.kind === "RS_PM"),
      "les autres obligations restent",
    );
  });
});
