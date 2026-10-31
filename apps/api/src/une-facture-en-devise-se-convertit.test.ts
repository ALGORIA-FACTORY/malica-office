/**
 * Une facture en devise se convertit, de bout en bout (31 octobre 2026).
 *
 * Avant #142, une facture en euros d'un dossier tenu en dinars partait au
 * journal à sa valeur faciale ; depuis, elle n'était plus proposée du tout,
 * faute de cours. Cette épreuve joue le parcours entier, en base, sous de
 * vrais comptes :
 *
 *   — sans cours : rien ne se propose, la raison nomme le cours à saisir ;
 *   — le cabinet le saisit en un geste depuis la pièce, le Socle rejuge, et
 *     propose l'écriture convertie, « avec réserve : taux de change » ;
 *   — validée, elle s'inscrit en dinars, chaque ligne avec sa devise, son
 *     montant d'origine et son taux ; le journal du jour et son export les
 *     portent ; un retour les recopie à la contre-passation ;
 *   — la TVA du mois et « Vos charges » comptent les montants convertis ;
 *     sans cours, ils ne comptent pas — et le disent ;
 *   — un cours importé par l'exploitation (`outils/importer-les-cours.mjs`)
 *     périme le jugement, et l'ouverture rejuge ; le cours du cabinet
 *     l'emporte à date égale ; celui d'un autre cabinet n'entre jamais ;
 *   — une correction est une ligne nouvelle (R7) ; la table refuse toute
 *     modification ;
 *   — une écriture ne s'inscrit que dans la devise du dossier, forcée
 *     comprise.
 *
 * Les cours sont FICTIFS : un cours est une donnée, aucun n'est livré.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-facture-en-devise-se-convertit.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { PropositionDePiece } from "@malica/socle/ports/repositories";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { parametrage } from "./depots/parametrage.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);
const IMPORTEUR = fileURLToPath(new URL("../../../outils/importer-les-cours.mjs", import.meta.url));

type Ok = Extract<PropositionDePiece, { ok: true }>;
type Refus = Extract<PropositionDePiece, { ok: false }>;

describe("une facture en devise se convertit", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `devise-${Date.now()}`;
  const mfDossier = matriculeDEssai("A", "M");
  const mfAutre = matriculeDEssai("A", "M");
  const mdp = "MotDePasseTresLong2026!";
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let autreExpert: Utilisateur;
  let pme = "";
  let cabinet = "";
  let autreCabinet = "";
  let autrePme = "";
  let packId = "";
  let jour = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };
  const pmeFait = (methode: string, ...args: unknown[]) => rpc(dirigeant, methode, ...args);
  const cabinetFait = (methode: string, ...args: unknown[]) => rpc(expert, methode, ...args);

  let n = 0;
  /**
   * Une facture d'achat en devise, lue, jugée, transmise : HT, TVA à 19 % et
   * TTC imprimés tels quels, sans timbre, à la date donnée. Un article
   * chiffré au HT, pour « Vos charges ».
   */
  const transmise = async (
    o: {
      devise?: string;
      /** Ce que la pièce imprime : HT et TTC en deux jetons, TVA en un. */
      ht?: [string, string];
      tva?: string;
      ttc?: [string, string];
      /** Ce que le solveur de la lecture a posé : HT, TVA, TTC décimaux. */
      lus?: [string, string, string];
      date?: string;
    } = {},
  ) => {
    n += 1;
    const ht = o.ht ?? ["1", "000,00"];
    const tva = o.tva ?? "190,00";
    const ttc = o.ttc ?? ["1", "190,00"];
    const [htLu, tvaLu, ttcLu] = o.lus ?? ["1000.00", "190.00", "1190.00"];
    const l = lectureDEssai({ ht, tva, ttc, clientMf: mfDossier, numero: `DEV-${marque}-${n}` });
    const date = o.date ?? "2026-09-10";
    const extract = {
      ...l.extract,
      currency: o.devise ?? "EUR",
      document_date: date,
      lines: [
        {
          label: "Licence",
          tax_code: "TVA19",
          base_ht: htLu,
          vat_amount: tvaLu,
          ttc: ttcLu,
        },
      ],
      other_charges: [],
      totals: { base_ht: htLu, vat: tvaLu, ttc: ttcLu },
    };
    const p = (await pmeFait("capture.enregistrer", {
      tenantId: pme,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-${n}`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: p.id,
              packId,
              tokens: l.tokens,
              contract: "extract.v1",
              extract,
              citations: l.citations,
              flags: [],
              articles: [
                {
                  designation: "Licence logicielle",
                  quantity: "1",
                  unit_price_ht: htLu,
                  unit_price_ttc: null,
                  total_ht: htLu,
                  tax_code: "TVA19",
                },
              ],
              documentKind: "facture_achat",
              documentDate: date,
              mode: "pdf-text",
              confianceParChamp: { "totals.ttc": 0.95 },
            },
          ],
        },
        "serveur",
      ),
    );
    await pmeFait("capture.analyser", p.id);
    await pmeFait("collab.setPieceVis", p.id, "partage");
    return p.id;
  };

  const proposition = (id: string) =>
    cabinetFait("office.propositionDePiece", id) as Promise<PropositionDePiece>;
  const lignesInscrites = async (ecritureId: string) =>
    (
      await admin.query<{
        account_code: string;
        debit: string;
        credit: string;
        tax_code: string | null;
        devise_origine: string | null;
        montant_origine: string | null;
        taux_de_change: string | null;
        cours_id: string | null;
      }>(
        `select account_code, debit::text, credit::text, tax_code, devise_origine,
                montant_origine::text, taux_de_change::text, cours_id::text
           from socle.ecriture_lignes where ecriture_id = $1 order by ordinal`,
        [ecritureId],
      )
    ).rows;
  const coursImporte = (lignes: string[]) => {
    const dossier = mkdtempSync(join(tmpdir(), "cours-"));
    const fichier = join(dossier, `cours-${marque}.csv`);
    writeFileSync(fichier, ["date,devise,vers_devise,taux,unite,source", ...lignes].join("\n"));
    const r = spawnSync(process.execPath, [IMPORTEUR, fichier], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const mois = (j: string) => {
    const m = j.slice(0, 7);
    const fin = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0));
    return [`${m}-01`, fin.toISOString().slice(0, 10)] as const;
  };

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, mdp);
    const e = await creerCompte(`expert-${marque}@essai.local`, mdp);
    const a = await creerCompte(`autre-${marque}@essai.local`, mdp);
    assert.ok(d && e && a);
    dirigeant = d;
    expert = e;
    autreExpert = a;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'mandate', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME D'ESSAI ${marque}`, mfDossier);
    cabinet = await creer(expert, "cabinet", `CABINET D'ESSAI ${marque}`, null);
    autrePme = await creer(autreExpert, "pme", `AUTRE PME ${marque}`, mfAutre);
    autreCabinet = await creer(autreExpert, "cabinet", `AUTRE CABINET ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mfDossier));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    // L'autre cabinet supervise un autre dossier : il peut saisir des cours,
    // qui ne valent que pour les siens.
    await sousIdentite(autreExpert.id, (db) => identite.proposerMandat(db, autreCabinet, mfAutre));
    const [autre] = await sousIdentite(autreExpert.id, (db) =>
      identite.mandatsProposes(db, autrePme),
    );
    await sousIdentite(autreExpert.id, (db) => identite.repondreAuMandat(db, autre!.id, true));
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    jour = (await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet)))
      .aujourdhui!;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet, autrePme, autreCabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("sans cours, rien ne se propose : la raison nomme le cours à saisir", async () => {
    const id = await transmise();
    const r = (await proposition(id)) as Refus;
    assert.equal(r.ok, false);
    assert.equal(r.raisonCode, "taux_de_change");
    assert.match(r.raison, /taux EUR\/TND du 2026-09-10 à saisir/);
    assert.deepEqual(r.coursASaisir, {
      devise: "EUR",
      versDevise: "TND",
      jour: "2026-09-10",
      source: "BCT",
    });
    // La PME n'a rien à corriger : ce n'est pas une faute de sa pièce.
    assert.notEqual(r.verdictCode, "anomalie");
  });

  it("le cabinet saisit le cours en un geste ; le Socle rejuge et propose, converti, avec réserve", async () => {
    const id = await transmise();
    const r = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3456", 1)) as Ok;
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.verdictCode, "reserve");
    const { rows: motifs } = await admin.query<{ motifs: Array<{ code: string; motif: string }> }>(
      `select motifs from capture.analyses where piece_id = $1 order by created_at desc limit 1`,
      [id],
    );
    assert.ok(
      motifs[0]!.motifs.some(
        (m) => m.code === "cours_de_change" && m.motif === "taux de change 2026-09-10 BCT",
      ),
    );
    const p = r.proposition;
    assert.equal(p.pivot.currency, "TND");
    // Le compte de charge est celui de la nature de l'article (`compteDeLaNature`) :
    // ce qui s'éprouve ici, ce sont les montants convertis et leur origine.
    assert.deepEqual(
      p.lignes.map((l) => [l.debit, l.credit, l.tax_code, l.devise_origine, l.montant_origine]),
      [
        ["3345.600", "0", null, "EUR", "1000.00"],
        ["635.664", "0", "TVA19", "EUR", "190.00"],
        ["0", "3981.264", null, "EUR", "1190.00"],
      ],
    );
    assert.ok(p.lignes.every((l) => l.taux_de_change === "3.3456"));
    // Rejouer le geste (un double clic) n'ajoute aucun cours.
    await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3456", 1);
    const { rows: cours } = await admin.query(
      `select 1 from parametrage.cours_de_change where tenant_id = $1`,
      [cabinet],
    );
    assert.equal(cours.length, 1);
  });

  it("validée, elle s'inscrit en dinars, chaque ligne avec son origine ; le journal et l'export la disent", async () => {
    const id = await transmise({
      devise: "USD",
      ht: ["333.33", "US$"],
      tva: "63.33",
      ttc: ["396.66", "US$"],
      lus: ["333.33", "63.33", "396.66"],
    });
    const r = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.0125", 1)) as Ok;
    assert.equal(r.ok, true, JSON.stringify(r));
    const ecritureId = (await cabinetFait("office.valider", id, r.empreinte)) as string;
    const { rows: ecr } = await admin.query<{ devise: string }>(
      `select devise from socle.ecritures where id = $1`,
      [ecritureId],
    );
    assert.equal(ecr[0]!.devise, "TND");
    const lignes = await lignesInscrites(ecritureId);
    // 333,33 × 3,0125 = 1 004,157, un millime retiré par l'écart (1 194,938 au total).
    assert.deepEqual(
      lignes.map((l) => [l.debit, l.credit, l.devise_origine, l.montant_origine]),
      [
        ["1004.156", "0.000", "USD", "333.3300"],
        ["190.782", "0.000", "USD", "63.3300"],
        ["0.000", "1194.938", "USD", "396.6600"],
      ],
    );
    assert.ok(lignes.every((l) => Number(l.taux_de_change) === 3.0125 && l.cours_id));

    const journal = (await cabinetFait("journalDuJour.lire", cabinet, pme, null, "fr")) as {
      journaux: Array<{
        ecritures: Array<{
          id: string;
          lignes: Array<{ compte: string; origine: { devise: string; montant: string } | null }>;
        }>;
      }>;
    };
    const auJournal = journal.journaux
      .flatMap((j) => j.ecritures)
      .find((e) => e.id === ecritureId);
    assert.ok(auJournal, "l'écriture validée est au journal du jour");
    assert.deepEqual(
      auJournal.lignes.map((l) => [l.origine?.devise, l.origine?.montant]),
      [
        ["USD", "333.33"],
        ["USD", "63.33"],
        ["USD", "396.66"],
      ],
    );
  });

  it("retournée, la contre-passation recopie la devise, le montant et le cours d'origine", async () => {
    const id = await transmise();
    const r = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3456", 1)) as Ok;
    const ecritureId = (await cabinetFait("office.valider", id, r.empreinte)) as string;
    const { rows: motifs } = await admin.query<{ id: string }>(
      `select id from ref.rejet_motifs order by code limit 1`,
    );
    await cabinetFait("supervision.retourner", {
      pieceId: id,
      motifId: motifs[0]!.id,
      note: "Cours à revoir.",
    });
    const { rows: rev } = await admin.query<{ id: string }>(
      `select id from socle.ecritures where reverses_id = $1`,
      [ecritureId],
    );
    assert.equal(rev.length, 1);
    const origine = await lignesInscrites(ecritureId);
    const contre = await lignesInscrites(rev[0]!.id);
    assert.deepEqual(
      contre.map((l) => [l.debit, l.credit, l.devise_origine, l.montant_origine, l.cours_id]),
      origine.map((l) => [l.credit, l.debit, l.devise_origine, l.montant_origine, l.cours_id]),
    );
    // Une pièce dont l'écriture vit ne change plus de cours ; retournée, si.
    await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.4", 1);
  });

  it("la TVA du mois et « Vos charges » comptent les montants convertis ; sans cours, ils le disent", async () => {
    // À une date où aucun cours n'est publié, ni dans le recul de la règle.
    const sansCours = await transmise({
      date: "2026-09-25",
      ht: ["2", "000,00"],
      tva: "380,00",
      ttc: ["2", "380,00"],
      lus: ["2000.00", "380.00", "2380.00"],
    });
    const avecCours = await transmise({
      ht: ["500,00", "€"],
      tva: "95,00",
      ttc: ["595,00", "€"],
      lus: ["500.00", "95.00", "595.00"],
    });
    await cabinetFait("office.saisirLeCoursDeLaPiece", avecCours, "3.3456", 1);
    // Proposée : elle compte dans les chiffres du mois (`pieces_qui_comptent_v`).
    await cabinetFait("office.proposerDepuisPiece", avecCours);
    // Une pièce en devise d'avant #142, proposée à sa valeur faciale : elle
    // compte, mais aucun cours ne la convertit.
    await admin.query(`update capture.pieces set status = 'proposee' where id = $1`, [sansCours]);
    const [du, au] = mois("2026-09-10");

    const transmis = (await pmeFait("office.extraitsTransmis", pme, du, au)) as Array<{
      pieceId: string;
      extract: { currency: string; totals: { vat: string; ttc: string } };
    }>;
    const de = (id: string) => transmis.find((x) => x.pieceId === id)?.extract;
    // Transmise ce mois-ci : imputée au mois de sa transmission si celui de
    // sa date est déclaré ; sinon à sa date. Les deux cas portent ses montants.
    const [duJour, auJour] = mois(jour);
    const duMois = (await pmeFait("office.extraitsTransmis", pme, duJour, auJour)) as typeof transmis;
    const lu = (id: string) => de(id) ?? duMois.find((x) => x.pieceId === id)?.extract;
    assert.deepEqual(
      [lu(avecCours)?.currency, lu(avecCours)?.totals.vat, lu(avecCours)?.totals.ttc],
      ["TND", "317.832", "1990.632"],
    );
    // Sans cours, l'extrait reste en euros : le calcul de la TVA le refuse en le nommant.
    assert.equal(lu(sansCours)?.currency, "EUR");

    const articles = (await pmeFait("charges.articles", pme, "2026-09", "2026-09")) as Array<{
      pieceId: string;
      totalHt: string | null;
    }>;
    assert.deepEqual(
      articles.filter((a) => a.pieceId === avecCours).map((a) => a.totalHt),
      ["1672.800"],
    );
    assert.equal(articles.filter((a) => a.pieceId === sansCours).length, 0);
    const attente = (await pmeFait("charges.enAttenteDeCours", pme)) as {
      pieces: number;
      devises: string[];
    };
    assert.ok(attente.pieces >= 1);
    assert.deepEqual(attente.devises, ["EUR"]);
  });

  it("un cours importé périme le jugement : l'ouverture rejuge et propose ; rejouer l'import n'ajoute rien", async () => {
    // Un jour sans aucun cours importé dans le recul de la règle : l'import
    // vaut pour toute la base, et un passage précédent a importé le sien.
    const { rows: jours } = await admin.query<{ veille: string; jour: string }>(
      `select to_char(d - 1, 'YYYY-MM-DD') as veille, to_char(d, 'YYYY-MM-DD') as jour
         from generate_series(date '2026-01-08', date '2026-08-31', interval '7 days') g(d0)
         cross join lateral (select g.d0::date as d) x
        where not exists (select 1 from parametrage.cours_de_change c
                           where c.tenant_id is null and c.devise = 'EUR'
                             and c.date_du_cours between x.d - 6 and x.d)
        order by d limit 1`,
    );
    const { veille, jour: jourDeLaPiece } = jours[0]!;
    // Le cours publié la veille : dans le recul de la règle.
    const id = await transmise({ date: jourDeLaPiece });
    const avant = (await proposition(id)) as Refus;
    assert.equal(avant.raisonCode, "taux_de_change");

    const taux = "3.2001";
    const ligne = `${veille},EUR,TND,${taux},1,BCT`;
    assert.match(coursImporte([ligne]), /1 nouveau/);
    assert.match(coursImporte([ligne]), /0 nouveau/);

    const apres = (await proposition(id)) as Ok;
    assert.equal(apres.ok, true, JSON.stringify(apres));
    assert.ok(apres.proposition.lignes.every((l) => l.taux_de_change === taux));
    assert.equal(apres.proposition.conversion?.cours.date, veille);

    // À date égale, le cours du cabinet qui supervise l'emporte sur l'import ;
    // celui d'un AUTRE cabinet n'entre jamais.
    await rpc(autreExpert, "office.saisirUnCours", {
      orgId: autreCabinet,
      devise: "EUR",
      versDevise: "TND",
      date: jourDeLaPiece,
      taux: "9.9999",
      unite: 1,
      source: "BCT",
    });
    const toujours = (await proposition(id)) as Ok;
    assert.ok(toujours.proposition.lignes.every((l) => l.taux_de_change === taux));
    await cabinetFait("office.saisirUnCours", {
      orgId: cabinet,
      devise: "EUR",
      versDevise: "TND",
      date: veille,
      taux: "3.2002",
      unite: 1,
      source: "BCT",
    });
    const duCabinet = (await proposition(id)) as Ok;
    assert.ok(duCabinet.proposition.lignes.every((l) => l.taux_de_change === "3.2002"));
  });

  it("une correction est une ligne nouvelle ; la table refuse toute modification", async () => {
    const id = await transmise({ date: "2026-09-11" });
    await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.30", 1);
    const corrigee = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.31", 1)) as Ok;
    assert.ok(corrigee.proposition.lignes.every((l) => l.taux_de_change === "3.31"));
    const { rows } = await admin.query<{ taux: string }>(
      `select taux::text from parametrage.cours_de_change
        where tenant_id = $1 and date_du_cours = '2026-09-11' order by saisi_le`,
      [cabinet],
    );
    assert.deepEqual(
      rows.map((r) => r.taux),
      ["3.30", "3.31"],
    );
    await assert.rejects(
      admin.query(`update parametrage.cours_de_change set taux = 1 where tenant_id = $1`, [
        cabinet,
      ]),
    );
  });

  it("seul qui supervise saisit un cours, et seulement un cours", async () => {
    const saisie = {
      orgId: pme,
      devise: "EUR",
      versDevise: "TND",
      date: "2026-09-12",
      taux: "3.3",
      unite: 1,
      source: "BCT",
    };
    // La société d'un dossier tenu par un cabinet ne supervise pas ses livres.
    await assert.rejects(pmeFait("office.saisirUnCours", saisie), /refus\.cours\.supervision/);
    await assert.rejects(
      cabinetFait("office.saisirUnCours", { ...saisie, orgId: cabinet, unite: 12 }),
      /refus\.cours\.invalide/,
    );
    await assert.rejects(
      cabinetFait("office.saisirUnCours", { ...saisie, orgId: cabinet, source: "INCONNUE" }),
      /refus\.cours\.invalide/,
    );
  });

  it("une écriture ne s'inscrit que dans la devise du dossier, forcée comprise", async () => {
    const id = await transmise({ date: "2026-09-12" });
    await assert.rejects(
      cabinetFait("office.propose", {
        pieceId: id,
        journal: "ACH",
        date: "2026-09-12",
        libelle: "En euros",
        packVersionId: packId,
        devise: "EUR",
        lignes: [
          { account_code: "601", libelle: "601", debit: "1000.00", credit: "0" },
          { account_code: "401", libelle: "401", debit: "0", credit: "1000.00" },
        ],
      }),
      /refus\.ecriture\.devise_du_dossier/,
    );
    // Forcée : le comptable saisit en dinars, l'écriture est en dinars.
    const ecritureId = (await cabinetFait("office.forcer", {
      pieceId: id,
      journal: "ACH",
      date: "2026-09-12",
      libelle: "Saisie du cabinet",
      lignes: [
        { account_code: "601", libelle: "601", debit: "3300.000", credit: "0", tax_code: "TVA19" },
        { account_code: "4366", libelle: "4366", debit: "627.000", credit: "0", tax_code: "TVA19" },
        { account_code: "401", libelle: "401", debit: "0", credit: "3927.000" },
      ],
    })) as string;
    const { rows } = await admin.query<{ devise: string }>(
      `select devise from socle.ecritures where id = $1`,
      [ecritureId],
    );
    assert.equal(rows[0]!.devise, "TND");
  });
});
