/**
 * Une facture en devise se convertit, de bout en bout (31 octobre 2026 ;
 * revue de #148).
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
 *     montant d'origine, son taux et l'ORIGINE de son cours ; le journal du
 *     jour la porte ; un retour la recopie à la contre-passation ;
 *   — la TVA du mois et « Vos charges » comptent les montants convertis ;
 *     sans cours, ou sans conversion possible, ils ne comptent pas — et le
 *     disent, chacun avec sa raison ;
 *   — la préséance des cours : l'import officiel passe devant une saisie ;
 *     une dérogation MOTIVÉE du cabinet passe devant l'import, celle du
 *     dossier devant celle du cabinet ; celle d'un autre cabinet n'entre
 *     jamais ;
 *   — l'import est tracé, rejouable, et se corrige — y compris en revenant à
 *     une valeur officielle antérieure —, toujours avec un motif ;
 *   — un cours qui change périme le jugement : la conversion attend, VALIDER
 *     refuse la proposition périmée et la suivante s'inscrit au bon cours ;
 *   — la règle de change se résout dossier → cabinet → pack (R10) ;
 *   — une écriture ne s'inscrit que dans la devise du dossier, forcée
 *     comprise.
 *
 * ISOLEMENT : chaque passage crée sa propre SOURCE de cours (`ESSAI_…`) et la
 * règle de son dossier la nomme, sans recul : un cours importé par un passage
 * précédent — l'import vaut pour toute la base — n'entre jamais ici, et chaque
 * épreuve a son propre jour. L'ordre des épreuves ne compte pas.
 *
 * Les cours sont FICTIFS : un cours est une donnée, aucun n'est livré.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/une-facture-en-devise-se-convertit.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { REGLES_D_ECART } from "@malica/socle/engines/fx/convertir-l-extrait";
import { tvaDesExtraits } from "@malica/socle/engines/tva/des-extraits";
import type {
  DeclarationTva,
  JournalDuJour,
  PropositionDePiece,
  RegleDeChangeDuDossier,
  TaxRate,
} from "@malica/socle/ports/repositories";
import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { parametrage } from "./depots/parametrage.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { DATES_RETENUES } from "./scan/cours-de-change.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);
const IMPORTEUR = fileURLToPath(new URL("../../../outils/importer-les-cours.mjs", import.meta.url));

type Ok = Extract<PropositionDePiece, { ok: true }>;
type Refus = Extract<PropositionDePiece, { ok: false }>;
type Transmis = Array<{
  pieceId: string;
  extract: { currency: string; totals: { vat: string; ttc: string } };
  refus?: string;
}>;

describe("une facture en devise se convertit", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `devise-${Date.now()}`;
  /** La source de ce passage : aucun autre passage n'en importe. */
  const source = `ESSAI_${marque.slice("devise-".length)}`;
  const operateur = `operateur-${marque}`;
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
   * TTC imprimés tels quels, sans timbre, au jour donné. Un article chiffré au
   * HT, pour « Vos charges ».
   */
  const transmise = async (o: {
    date: string;
    devise?: string;
    /** Ce que la pièce imprime : HT et TTC en deux jetons, TVA en un. */
    ht?: [string, string];
    tva?: string;
    ttc?: [string, string];
    /** Ce que le solveur de la lecture a posé : HT, TVA, TTC décimaux. */
    lus?: [string, string, string];
  }) => {
    n += 1;
    const ht = o.ht ?? ["1", "000,00"];
    const tva = o.tva ?? "190,00";
    const ttc = o.ttc ?? ["1", "190,00"];
    const [htLu, tvaLu, ttcLu] = o.lus ?? ["1000.00", "190.00", "1190.00"];
    const l = lectureDEssai({ ht, tva, ttc, clientMf: mfDossier, numero: `DEV-${marque}-${n}` });
    const extract = {
      ...l.extract,
      currency: o.devise ?? "EUR",
      document_date: o.date,
      lines: [
        { label: "Licence", tax_code: "TVA19", base_ht: htLu, vat_amount: tvaLu, ttc: ttcLu },
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
              documentDate: o.date,
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
  const proposee = async (id: string) => {
    const r = (await proposition(id)) as Ok;
    assert.equal(r.ok, true, JSON.stringify(r));
    return r;
  };
  /** Le taux de chaque ligne proposée : un seul, celui du cours appliqué. */
  const tauxPropose = async (id: string) => [
    ...new Set((await proposee(id)).proposition.lignes.map((l) => l.taux_de_change)),
  ];
  const lignesInscrites = async (ecritureId: string) =>
    (
      await admin.query<{
        debit: string;
        credit: string;
        devise_origine: string | null;
        montant_origine: string | null;
        taux_de_change: string | null;
        cours_id: string | null;
      }>(
        `select debit::text, credit::text, devise_origine, montant_origine::text,
                taux_de_change::text, cours_id::text
           from socle.ecriture_lignes where ecriture_id = $1 order by ordinal`,
        [ecritureId],
      )
    ).rows;
  /** Un import de l'exploitation : un fichier, avec la colonne `motif`. */
  const importe = (lignes: string[]) => {
    const dossier = mkdtempSync(join(tmpdir(), "cours-"));
    const fichier = join(dossier, `cours-${marque}.csv`);
    writeFileSync(
      fichier,
      ["date,devise,vers_devise,taux,unite,source,motif", ...lignes].join("\n"),
    );
    return spawnSync(process.execPath, [IMPORTEUR, fichier], {
      encoding: "utf8",
      env: { ...process.env, MALICA_OPERATEUR: operateur },
    });
  };
  const importeOk = (lignes: string[]) => {
    const r = importe(lignes);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const saisirUnCours = (u: Utilisateur, c: Record<string, unknown>) =>
    rpc(u, "office.saisirUnCours", {
      versDevise: "TND",
      unite: 1,
      source,
      ...c,
    });
  const transmisDe = async (id: string, jourDeLaPiece: string) => {
    // Imputée au mois de sa date, ou au mois de sa transmission si celui de
    // sa date est déclaré : les deux fenêtres portent ses montants.
    const mois = (j: string) => {
      const m = j.slice(0, 7);
      const fin = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0));
      return [`${m}-01`, fin.toISOString().slice(0, 10)] as const;
    };
    const aujourdhui = (
      await sousIdentite(expert.id, (db) => parametrage.fuseauDuCabinet(db, cabinet))
    ).aujourdhui!;
    for (const j of [jourDeLaPiece, aujourdhui]) {
      const lus = (await pmeFait("office.extraitsTransmis", pme, ...mois(j))) as Transmis;
      const trouve = lus.find((x) => x.pieceId === id);
      if (trouve) return trouve;
    }
    return undefined;
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
    // La source de ce passage, au référentiel ; la règle du dossier la nomme,
    // sans recul : chaque cours ne vaut que pour son jour (R10, arrêté par le
    // cabinet qui tient le dossier).
    await admin.query(`insert into ref.sources_de_cours (code, nom) values ($1, $2)`, [
      source,
      `Source d'essai ${marque}`,
    ]);
    // Une source sert sa juridiction : celle-ci, la Tunisie du dossier.
    await admin.query(
      `insert into ref.sources_de_cours_juridictions (source, jurisdiction) values ($1, 'TN')`,
      [source],
    );
    await cabinetFait("parametrage.arreterReglagesComptables", {
      cabinetId: cabinet,
      portee: "dossier",
      porteeId: pme,
      packId,
      depuis: "2026-01-01",
      valeurs: [
        { code: "change.source", valeur: source },
        { code: "change.recul_jours", valeur: "0" },
      ],
      motif: "Épreuve isolée",
    });
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

  it("les dates retenues et les règles d'écart du référentiel sont celles que le Socle implémente", async () => {
    const lire = async (table: string) =>
      (
        await admin.query<{ code: string }>(
          `select code from ref.${table} order by code collate "C"`,
        )
      ).rows.map((r) => r.code);
    assert.deepEqual(await lire("change_dates_retenues"), [...DATES_RETENUES].sort());
    assert.deepEqual(await lire("change_regles_d_ecart"), [...REGLES_D_ECART].sort());
  });

  it("sans cours, rien ne se propose : la raison nomme le cours à saisir", async () => {
    const id = await transmise({ date: "2026-09-01" });
    const r = (await proposition(id)) as Refus;
    assert.equal(r.ok, false);
    assert.equal(r.raisonCode, "taux_de_change");
    assert.match(r.raison, /taux EUR\/TND du 2026-09-01 à saisir/);
    assert.deepEqual(r.coursASaisir, {
      devise: "EUR",
      versDevise: "TND",
      jour: "2026-09-01",
      source,
    });
    // La PME n'a rien à corriger : ce n'est pas une faute de sa pièce.
    assert.notEqual(r.verdictCode, "anomalie");
  });

  it("le cabinet saisit le cours en un geste ; le Socle rejuge et propose, converti, avec réserve", async () => {
    const id = await transmise({ date: "2026-09-02" });
    const r = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3456", 1)) as Ok;
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.verdictCode, "reserve");
    const { rows: motifs } = await admin.query<{ motifs: Array<{ code: string; motif: string }> }>(
      `select motifs from capture.analyses where piece_id = $1 order by created_at desc limit 1`,
      [id],
    );
    assert.ok(
      motifs[0]!.motifs.some(
        (m) => m.code === "cours_de_change" && m.motif === `taux de change 2026-09-02 ${source}`,
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
    const { rows: cours } = await admin.query<{ origine: string }>(
      `select origine from parametrage.cours_de_change
        where tenant_id = $1 and date_du_cours = '2026-09-02'`,
      [cabinet],
    );
    assert.deepEqual(
      cours.map((c) => c.origine),
      ["saisie"],
    );
    // La bibliothèque montre la pièce dans SA devise, à son exposant.
    const docs = (await cabinetFait("supervision.documents", cabinet, pme, "2026-09")) as Array<{
      id: string;
      montant: string | null;
      devise: string;
    }>;
    const doc = docs.find((x) => x.id === id);
    assert.deepEqual([doc?.montant, doc?.devise], ["1190.00", "EUR"]);
  });

  it("validée, elle s'inscrit en dinars, chaque ligne avec son origine ; le journal dit d'où vient le cours", async () => {
    const id = await transmise({
      date: "2026-09-03",
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

    const journal = (await cabinetFait(
      "journalDuJour.lire",
      cabinet,
      pme,
      null,
      "fr",
    )) as JournalDuJour;
    const auJournal = journal.journaux.flatMap((j) => j.ecritures).find((e) => e.id === ecritureId);
    assert.ok(auJournal, "l'écriture validée est au journal du jour");
    assert.deepEqual(
      auJournal.lignes.map((l) => [
        l.origine?.devise,
        l.origine?.montant,
        l.origine?.source,
        l.origine?.origineDuCours,
        l.origine?.libelleOrigineDuCours,
        l.origine?.motifDuCours,
      ]),
      [
        ["USD", "333.33", source, "saisie", "Saisi par la comptabilité", null],
        ["USD", "63.33", source, "saisie", "Saisi par la comptabilité", null],
        ["USD", "396.66", source, "saisie", "Saisi par la comptabilité", null],
      ],
    );
  });

  it("retournée, la contre-passation recopie la devise, le montant et le cours d'origine", async () => {
    const id = await transmise({ date: "2026-09-04" });
    const r = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3456", 1)) as Ok;
    const ecritureId = (await cabinetFait("office.valider", id, r.empreinte)) as string;
    const { rows: motifs } = await admin.query<{ id: string }>(
      `select id from ref.rejet_motifs where usage = 'retour' order by code limit 1`,
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
    // Une pièce dont l'écriture vit ne change plus de cours ; retournée, si
    // — une correction, donc motivée.
    const corrigee = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.4012", 1, {
      motif: "Cours revu après retour",
      portee: "dossier",
    })) as Ok;
    assert.deepEqual(
      [...new Set(corrigee.proposition.lignes.map((l) => l.taux_de_change))],
      ["3.4012"],
    );
  });

  it("la TVA du mois et « Vos charges » comptent les montants convertis ; sans cours ou sans conversion, ils le disent", async () => {
    const sansCours = await transmise({
      date: "2026-09-05",
      ht: ["2", "000,00"],
      tva: "380,00",
      ttc: ["2", "380,00"],
      lus: ["2000.00", "380.00", "2380.00"],
    });
    const avecCours = await transmise({
      date: "2026-09-06",
      ht: ["500,00", "€"],
      tva: "95,00",
      ttc: ["595,00", "€"],
      lus: ["500.00", "95.00", "595.00"],
    });
    // Une facture qui ne tient pas dans SA devise : 500 + 95 ≠ 595,05.
    const desequilibree = await transmise({
      date: "2026-09-07",
      ht: ["500,00", "€"],
      tva: "95,00",
      ttc: ["595,05", "€"],
      lus: ["500.00", "95.00", "595.05"],
    });
    await cabinetFait("office.saisirLeCoursDeLaPiece", avecCours, "3.3456", 1);
    await cabinetFait("office.saisirLeCoursDeLaPiece", desequilibree, "3.3456", 1);
    // Proposée : elle compte dans les chiffres du mois (`pieces_qui_comptent_v`).
    await cabinetFait("office.proposerDepuisPiece", avecCours);
    // Une pièce en devise d'avant #142, proposée à sa valeur faciale : elle
    // compte, mais aucun cours ne la convertit. La déséquilibrée de même.
    await admin.query(`update capture.pieces set status = 'proposee' where id = any($1::uuid[])`, [
      [sansCours, desequilibree],
    ]);

    const lus = {
      avecCours: await transmisDe(avecCours, "2026-09-06"),
      sansCours: await transmisDe(sansCours, "2026-09-05"),
      desequilibree: await transmisDe(desequilibree, "2026-09-07"),
    };
    assert.deepEqual(
      [lus.avecCours?.extract.currency, lus.avecCours?.extract.totals.vat, lus.avecCours?.refus],
      ["TND", "317.832", undefined],
    );
    assert.equal(lus.avecCours?.extract.totals.ttc, "1990.632");
    // Sans cours, l'extrait reste en euros, tel quel ; sans conversion
    // possible, il reste en euros ET porte sa raison.
    assert.deepEqual(
      [lus.sansCours?.extract.currency, lus.sansCours?.extract.totals.vat, lus.sansCours?.refus],
      ["EUR", "380.00", undefined],
    );
    assert.deepEqual(
      [lus.desequilibree?.extract.currency, lus.desequilibree?.refus],
      ["EUR", "CONVERSION_REFUSEE:desequilibre"],
    );

    // Le calcul de la TVA — le même que celui de l'écran — compte la
    // convertie, et écarte les deux autres en les nommant.
    const [taux, declaration] = (await Promise.all([
      cabinetFait("referentiel.taxRates", packId, "TN"),
      cabinetFait("referentiel.declarationTva", packId, pme, "2026-09-30"),
    ])) as [TaxRate[], DeclarationTva];
    const tva = tvaDesExtraits({
      period: "2026-09",
      currency: { code: "TND", decimals: 3 },
      taux,
      declaration,
      rows: [lus.avecCours!, lus.sansCours!, lus.desequilibree!],
    });
    assert.equal(tva.totals.deductible, "317.832");
    assert.deepEqual(
      tva.refused.map((r) => [r.item_id, r.reason]).sort(),
      [
        [desequilibree, "CONVERSION_REFUSEE:desequilibre"],
        [sansCours, "EXTRAIT_EN_DEVISE:EUR"],
      ].sort(),
    );

    const articles = (await pmeFait("charges.articles", pme, "2026-09", "2026-09")) as Array<{
      pieceId: string;
      totalHt: string | null;
    }>;
    assert.deepEqual(
      articles.filter((a) => a.pieceId === avecCours).map((a) => a.totalHt),
      ["1672.800"],
    );
    assert.deepEqual(
      articles.filter((a) => a.pieceId === sansCours),
      [],
    );
    const attente = (await pmeFait("charges.enAttenteDeCours", pme)) as {
      pieces: number;
      articles: number;
      devises: string[];
    };
    assert.ok(attente.pieces >= 1 && attente.articles >= attente.pieces);
    assert.deepEqual(attente.devises, ["EUR"]);
  });

  it("préséance : l'import officiel passe devant la saisie ; une dérogation motivée, devant l'import", async () => {
    const jour = "2026-09-08";
    const id = await transmise({ date: jour });
    // La saisie du cabinet, faute d'import.
    await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3011", 1);
    assert.deepEqual(await tauxPropose(id), ["3.3011"]);

    // L'import officiel passe devant, et périme le jugement : l'ouverture rejuge.
    const ligne = (taux: string, motif = "") => `${jour},EUR,TND,${taux},1,${source},${motif}`;
    assert.match(importeOk([ligne("3.3022")]), /1 nouveau\(x\), 0 correction\(s\), 0 déjà là/);
    assert.deepEqual(await tauxPropose(id), ["3.3022"]);
    // Rejouer l'import n'ajoute rien.
    assert.match(importeOk([ligne("3.3022")]), /0 nouveau\(x\), 0 correction\(s\), 1 déjà là/);

    // Une correction de l'import dit pourquoi : sans motif, rien n'est importé.
    const sansMotif = importe([ligne("3.3033")]);
    assert.equal(sansMotif.status, 1);
    assert.match(sansMotif.stderr, /refus\.cours\.correction_sans_motif/);
    assert.deepEqual(await tauxPropose(id), ["3.3022"]);
    assert.match(importeOk([ligne("3.3033", "Rectificatif de la source")]), /1 correction\(s\)/);
    assert.deepEqual(await tauxPropose(id), ["3.3033"]);
    // Revenir à une valeur officielle ANTÉRIEURE est une correction comme une autre.
    assert.match(
      importeOk([ligne("3.3022", "Retour à la valeur publiée, rectificatif annulé")]),
      /1 correction\(s\)/,
    );
    assert.deepEqual(await tauxPropose(id), ["3.3022"]);
    // Chaque import est tracé, avec qui l'a lancé ; l'import refusé n'a rien laissé.
    const { rows: imports } = await admin.query<{ bilan: number[] }>(
      `select array[lus, nouveaux, corrections] as bilan
         from parametrage.cours_de_change_imports where par = $1 order by importe_le`,
      [operateur],
    );
    assert.deepEqual(
      imports.map((i) => i.bilan),
      [
        [1, 1, 0],
        [1, 0, 0],
        [1, 0, 1],
        [1, 0, 1],
      ],
    );

    // La dérogation d'un AUTRE cabinet n'entre jamais.
    await saisirUnCours(autreExpert, {
      orgId: autreCabinet,
      devise: "EUR",
      date: jour,
      taux: "9.9999",
      motif: "Cours d'un autre cabinet",
    });
    assert.deepEqual(await tauxPropose(id), ["3.3022"]);
    // Une dérogation du cabinet sans motif n'en est pas une : pour un dossier, refusée.
    await assert.rejects(
      saisirUnCours(expert, {
        orgId: cabinet,
        devise: "EUR",
        date: jour,
        taux: "3.3044",
        dossierId: pme,
      }),
      /refus\.cours\.derogation_sans_motif/,
    );
    // Celle du cabinet, motivée, passe devant l'import…
    await saisirUnCours(expert, {
      orgId: cabinet,
      devise: "EUR",
      date: jour,
      taux: "3.3044",
      motif: "Cours de la banque du cabinet",
    });
    assert.deepEqual(await tauxPropose(id), ["3.3044"]);
    // … et celle du dossier, devant celle du cabinet.
    await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3055", 1, {
      motif: "Cours négocié par le client",
      portee: "dossier",
    });
    assert.deepEqual(await tauxPropose(id), ["3.3055"]);
  });

  it("une correction est une ligne nouvelle et motivée ; la table refuse toute modification", async () => {
    const jour = "2026-09-09";
    const id = await transmise({ date: jour });
    await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3001", 1);
    // Corriger sans dire pourquoi : refusé, et le cours ne change pas.
    await assert.rejects(
      cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3101", 1),
      /refus\.cours\.correction_sans_motif/,
    );
    assert.deepEqual(await tauxPropose(id), ["3.3001"]);
    const corrigee = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3101", 1, {
      motif: "Erreur de saisie",
      portee: "dossier",
    })) as Ok;
    assert.deepEqual(
      [...new Set(corrigee.proposition.lignes.map((l) => l.taux_de_change))],
      ["3.3101"],
    );
    const { rows } = await admin.query<{ origine: string; taux: string; motif: string | null }>(
      `select origine, taux::text, motif from parametrage.cours_de_change
        where tenant_id = $1 and date_du_cours = $2 order by saisi_le`,
      [cabinet, jour],
    );
    assert.deepEqual(
      rows.map((r) => [r.origine, r.taux, r.motif]),
      [
        ["saisie", "3.3001", null],
        ["derogation_dossier", "3.3101", "Erreur de saisie"],
      ],
    );
    await assert.rejects(
      admin.query(`update parametrage.cours_de_change set taux = 1 where tenant_id = $1`, [
        cabinet,
      ]),
    );
  });

  it("un cours qui change périme le jugement : la conversion attend, VALIDER refuse l'ancienne proposition", async () => {
    const jour = "2026-09-10";
    const id = await transmise({ date: jour });
    const avant = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.4001", 1)) as Ok;
    // Elle compte dans les chiffres du mois, sans écriture encore.
    await admin.query(`update capture.pieces set status = 'proposee' where id = $1`, [id]);
    assert.equal((await transmisDe(id, jour))?.extract.currency, "TND");

    // L'import officiel du jour passe devant la saisie : le jugement est périmé.
    importeOk([`${jour},EUR,TND,3.4101,1,${source},`]);
    // La TVA ne convertit plus au cours périmé : la pièce attend d'être rejugée.
    assert.equal((await transmisDe(id, jour))?.extract.currency, "EUR");
    // VALIDER rejuge d'abord : la proposition affichée n'est plus celle du jour.
    await assert.rejects(cabinetFait("office.valider", id, avant.empreinte));
    const apres = await proposee(id);
    assert.deepEqual(
      [...new Set(apres.proposition.lignes.map((l) => l.taux_de_change))],
      ["3.4101"],
    );
    const ecritureId = (await cabinetFait("office.valider", id, apres.empreinte)) as string;
    assert.ok((await lignesInscrites(ecritureId)).every((l) => l.taux_de_change === "3.4101"));
  });

  it("la règle de change se résout dossier → cabinet → pack, et le cabinet seul l'arrête (R10)", async () => {
    // À partir du 20 octobre, le cours du jour de RÉCEPTION, pour ce dossier.
    await cabinetFait("parametrage.arreterReglagesComptables", {
      cabinetId: cabinet,
      portee: "dossier",
      porteeId: pme,
      packId,
      depuis: "2026-10-20",
      valeurs: [{ code: "change.date_retenue", valeur: "date_reception" }],
    });
    await assert.rejects(
      pmeFait("parametrage.arreterReglagesComptables", {
        cabinetId: pme,
        portee: "dossier",
        porteeId: pme,
        packId,
        depuis: "2026-10-20",
        valeurs: [{ code: "change.date_retenue", valeur: "date_facture" }],
      }),
      /refus\.reglage_comptable\.droits/,
    );
    await assert.rejects(
      cabinetFait("parametrage.arreterReglagesComptables", {
        cabinetId: cabinet,
        portee: "dossier",
        porteeId: pme,
        packId,
        depuis: "2026-10-20",
        valeurs: [{ code: "change.recul_jours", valeur: "cinq" }],
      }),
      /refus\.reglage_comptable\.saisie/,
    );
    const regle = (await cabinetFait(
      "referentiel.regleDeChange",
      packId,
      pme,
      "2026-10-21",
      "fr",
    )) as RegleDeChangeDuDossier;
    assert.deepEqual(
      regle.valeurs.map((v) => [v.code, v.valeur, v.origine]),
      [
        ["change.date_retenue", "date_reception", "dossier"],
        ["change.ecart", "base_la_plus_grande", "pack"],
        ["change.recul_jours", "0", "dossier"],
        ["change.source", source, "dossier"],
      ],
    );
    assert.ok(
      regle.valeurs
        .find((v) => v.code === "change.date_retenue")
        ?.options?.some((o) => o.code === "date_reception" && o.label === "Date de réception"),
    );
    assert.equal(regle.valeurs.find((v) => v.code === "change.recul_jours")?.options, null);

    // Une pièce du 21 octobre attend le cours de son jour de RÉCEPTION.
    const id = await transmise({ date: "2026-10-21" });
    const { rows } = await admin.query<{ recue_le: string }>(
      `select to_char(recue_le, 'YYYY-MM-DD') as recue_le from pieces_v where id = $1`,
      [id],
    );
    const r = (await proposition(id)) as Refus;
    assert.equal(r.raisonCode, "taux_de_change");
    assert.equal(r.coursASaisir?.jour, rows[0]!.recue_le);
    assert.notEqual(r.coursASaisir?.jour, "2026-10-21");
  });

  it("seul qui supervise saisit un cours, et seulement un cours", async () => {
    const saisie = { orgId: pme, devise: "EUR", date: "2026-09-12", taux: "3.3" };
    // La société d'un dossier tenu par un cabinet ne supervise pas ses livres.
    await assert.rejects(saisirUnCours(dirigeant, saisie), /refus\.cours\.supervision/);
    await assert.rejects(
      saisirUnCours(expert, { ...saisie, orgId: cabinet, unite: 12 }),
      /refus\.cours\.invalide/,
    );
    await assert.rejects(
      saisirUnCours(expert, { ...saisie, orgId: cabinet, source: "INCONNUE" }),
      /refus\.cours\.invalide/,
    );
    // Une dérogation pour un dossier que le cabinet ne tient pas : refusée.
    await assert.rejects(
      saisirUnCours(expert, { ...saisie, orgId: cabinet, dossierId: autrePme, motif: "Essai" }),
      /refus\.cours\.supervision/,
    );
  });

  it("une écriture ne s'inscrit que dans la devise du dossier, forcée comprise", async () => {
    const id = await transmise({ date: "2026-09-13" });
    await assert.rejects(
      cabinetFait("office.propose", {
        pieceId: id,
        journal: "ACH",
        date: "2026-09-13",
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
      date: "2026-09-13",
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
  it("inscrite à un cours, elle le garde dans la TVA et « Vos charges » quand l'import du jour arrive (revue de #148)", async () => {
    const jour = "2026-09-14";
    const id = await transmise({ date: jour });
    const saisie = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.5001", 1)) as Ok;
    const ecritureId = (await cabinetFait("office.valider", id, saisie.empreinte)) as string;
    const avant = await transmisDe(id, jour);
    assert.deepEqual([avant?.extract.currency, avant?.refus], ["TND", undefined]);
    const chargesAvant = (await pmeFait("charges.articles", pme, "2026-09", "2026-09")) as Array<{
      pieceId: string;
      totalHt: string | null;
    }>;

    // L'import officiel du jour passe devant la saisie : le jugement est
    // périmé, mais le journal a parlé — la pièce ne se rejuge plus.
    importeOk([`${jour},EUR,TND,3.5101,1,${source},`]);
    assert.deepEqual(await transmisDe(id, jour), avant);
    const chargesApres = (await pmeFait("charges.articles", pme, "2026-09", "2026-09")) as Array<{
      pieceId: string;
      totalHt: string | null;
    }>;
    assert.deepEqual(
      chargesApres.filter((a) => a.pieceId === id),
      chargesAvant.filter((a) => a.pieceId === id),
    );
    assert.deepEqual(
      chargesApres.filter((a) => a.pieceId === id).map((a) => a.totalHt),
      ["3500.100"],
    );
    assert.ok((await lignesInscrites(ecritureId)).every((l) => l.taux_de_change === "3.5001"));
  });

  it("une facture au total imprimé décalé d'une unité compte dans la TVA comme au journal (revue de #148)", async () => {
    const jour = "2026-08-28";
    const id = await transmise({
      date: jour,
      ht: ["500,00", "€"],
      tva: "95,00",
      ttc: ["595,01", "€"],
      lus: ["500.00", "95.00", "595.01"],
    });
    await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.3456", 1);
    await admin.query(`update capture.pieces set status = 'proposee' where id = $1`, [id]);
    const lu = await transmisDe(id, jour);
    // Convertie à sa dette (500 + 95), comme son écriture ; jamais refusée.
    assert.deepEqual(
      [lu?.extract.currency, lu?.extract.totals.ttc, lu?.extract.totals.vat, lu?.refus],
      ["TND", "1990.632", "317.832", undefined],
    );
  });

  it("une ligne convertie ne porte que le cours que le jugement a lu, encore à jour (revue de #148)", async () => {
    const jour = "2026-09-15";
    const id = await transmise({ date: jour });
    const r = (await cabinetFait("office.saisirLeCoursDeLaPiece", id, "3.6001", 1)) as Ok;
    const lignes = r.proposition.lignes;
    assert.ok(lignes.every((l) => l.cours_id));
    const proposer = (ls: unknown[]) =>
      cabinetFait("office.propose", {
        pieceId: id,
        journal: "ACH",
        date: jour,
        libelle: "Forgée",
        packVersionId: packId,
        devise: "TND",
        lignes: ls,
      });
    // Un autre taux, un cours inventé, une autre devise : refusés.
    await assert.rejects(
      proposer(lignes.map((l) => ({ ...l, taux_de_change: "9.9" }))),
      /refus\.ecriture\.cours_de_la_ligne/,
    );
    await assert.rejects(
      proposer(lignes.map((l) => ({ ...l, cours_id: randomUUID() }))),
      /refus\.ecriture\.cours_de_la_ligne/,
    );
    await assert.rejects(
      proposer(lignes.map((l) => ({ ...l, devise_origine: "USD" }))),
      /refus\.ecriture\.cours_de_la_ligne/,
    );
    // Le cours change : la proposition d'hier ne s'inscrit plus.
    importeOk([`${jour},EUR,TND,3.6101,1,${source},`]);
    await assert.rejects(proposer(lignes), /refus\.ecriture\.cours_perime/);
  });

  it("dans le recul, l'import officiel d'avant passe devant une saisie du jour (revue de #148)", async () => {
    // Un recul de cinq jours, pour ce dossier, à partir du 16 septembre.
    await cabinetFait("parametrage.arreterReglagesComptables", {
      cabinetId: cabinet,
      portee: "dossier",
      porteeId: pme,
      packId,
      depuis: "2026-09-16",
      valeurs: [{ code: "change.recul_jours", valeur: "5" }],
      motif: "Recul du week-end",
    });
    // Vendredi 18 : l'import officiel. Dimanche 20 : une pièce, une saisie.
    importeOk([`2026-09-18,EUR,TND,3.7001,1,${source},`]);
    const id = await transmise({ date: "2026-09-20" });
    assert.deepEqual(await tauxPropose(id), ["3.7001"]);
    await saisirUnCours(expert, {
      orgId: cabinet,
      devise: "EUR",
      date: "2026-09-20",
      taux: "3.7999",
    });
    assert.deepEqual(await tauxPropose(id), ["3.7001"]);
    // Seule une dérogation motivée passe devant l'import.
    await saisirUnCours(expert, {
      orgId: cabinet,
      devise: "EUR",
      date: "2026-09-20",
      taux: "3.7555",
      motif: "Cours de la banque du cabinet",
    });
    assert.deepEqual(await tauxPropose(id), ["3.7555"]);
    // Une dérogation vaut pour SON jour : lundi 21, l'import du vendredi.
    const lundi = await transmise({ date: "2026-09-21" });
    assert.deepEqual(await tauxPropose(lundi), ["3.7001"]);
  });

  it("un cours saisi par la société quand elle tenait ses livres se valide chez son cabinet (revue de #148)", async () => {
    const jour = "2026-09-22";
    // Le cours de l'époque où la société tenait ses livres : son organisation,
    // que le cabinet ne lit pas en direct.
    await admin.query(
      `insert into parametrage.cours_de_change
         (tenant_id, origine, devise, vers_devise, date_du_cours, taux, unite, source, saisi_par)
       values ($1, 'saisie', 'USD', 'TND', $2::date, 2.9001, 1, $3, $4)`,
      [pme, jour, source, dirigeant.id],
    );
    const id = await transmise({ date: jour, devise: "USD" });
    const r = await proposee(id);
    assert.deepEqual([...new Set(r.proposition.lignes.map((l) => l.taux_de_change))], ["2.9001"]);
    const ecritureId = (await cabinetFait("office.valider", id, r.empreinte)) as string;
    assert.ok((await lignesInscrites(ecritureId)).every((l) => l.devise_origine === "USD"));
  });

  it("la règle du cabinet vaut pour ses dossiers ; une valeur nulle du dossier lui rend la main (revue de #148)", async () => {
    const lire = async (jour: string) =>
      (
        (await cabinetFait(
          "referentiel.regleDeChange",
          packId,
          pme,
          jour,
          "fr",
        )) as RegleDeChangeDuDossier
      ).valeurs
        .filter((v) => v.code === "change.recul_jours")
        .map((v) => [v.valeur, v.origine]);
    await cabinetFait("parametrage.arreterReglagesComptables", {
      cabinetId: cabinet,
      portee: "cabinet",
      porteeId: cabinet,
      packId,
      depuis: "2026-01-01",
      valeurs: [{ code: "change.recul_jours", valeur: "3" }],
    });
    // Le dossier a sa propre décision : elle l'emporte.
    assert.deepEqual(await lire("2026-11-30"), [["5", "dossier"]]);
    // Rendue (valeur nulle) à partir du 1er décembre : le cabinet décide.
    await cabinetFait("parametrage.arreterReglagesComptables", {
      cabinetId: cabinet,
      portee: "dossier",
      porteeId: pme,
      packId,
      depuis: "2026-12-01",
      valeurs: [{ code: "change.recul_jours", valeur: null }],
    });
    assert.deepEqual(await lire("2026-11-30"), [["5", "dossier"]]);
    assert.deepEqual(await lire("2026-12-02"), [["3", "cabinet"]]);
    // Un autre cabinet n'arrête rien pour celui-ci.
    await assert.rejects(
      rpc(autreExpert, "parametrage.arreterReglagesComptables", {
        cabinetId: autreCabinet,
        portee: "dossier",
        porteeId: pme,
        packId,
        depuis: "2026-12-01",
        valeurs: [{ code: "change.recul_jours", valeur: "9" }],
      }),
      /refus\.reglage_comptable\.droits/,
    );
  });
});
