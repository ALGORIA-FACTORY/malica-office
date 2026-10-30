/**
 * Le cabinet tranche les montants — l'aller-retour du 29-30 octobre 2026 sur
 * staging (cabinet retourne, PME renvoie, cabinet force, journal du jour, PME
 * lit « Prise en charge »), et ce qu'il a montré :
 *
 *   1. la fiche de la PME gardait la LECTURE (« TVA 5,460 · Droit de timbre
 *      2,000 ») après que le cabinet avait forcé HT 1 663,000 / TVA 306,610 /
 *      TTC 1 969,610 — et les chiffres du mois la comptaient aussi ;
 *   2. l'en-tête de la pièce, au cabinet, disait « Forcée par · 30/10 00:22 »,
 *      sans nom, pour un compte membre des deux côtés ;
 *   3. la piste de la pièce ajoutait « Le Socle a proposé une écriture. » à la
 *      minute du forçage ;
 *   7. deux pièces jumelles (même émetteur, date, numéro, montant) passaient
 *      toutes deux dans la file du cabinet, sans un mot.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/le-cabinet-tranche-les-montants.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

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

interface MontantsDuCabinet {
  baseHt: string;
  tva: string;
  ttc: string;
  droits: Array<{ code: string; amount: string }>;
}

describe("le cabinet tranche les montants", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `montants-${Date.now()}`;
  const mfDossier = matriculeDEssai("A", "M");
  const mdp = "MotDePasseTresLong2026!";
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
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
  /** Une facture lue (TVA19, timbre 1,000 — la lecture d'essai), transmise au cabinet. */
  const transmise = async (extrait?: (e: Record<string, unknown>) => Record<string, unknown>) => {
    n += 1;
    const l = lectureDEssai({ clientMf: mfDossier, numero: `MNT-${marque}-${n}` });
    const extract = extrait ? extrait(l.extract) : l.extract;
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
              articles: [],
              documentKind: "facture_achat",
              documentDate: l.extract.document_date,
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

  /** Le forçage du staging : HT 1 663,000, TVA 306,610, TTC 1 969,610, sans timbre. */
  const forcer = (pieceId: string) =>
    cabinetFait("office.forcer", {
      pieceId,
      journal: "ACH",
      date: jour,
      libelle: "Facture saisie par le cabinet",
      lignes: [
        { account_code: "601", libelle: "Achat", debit: "1663.000", credit: "0", tax_code: null },
        { account_code: "4366", libelle: "TVA", debit: "306.610", credit: "0", tax_code: null },
        {
          account_code: "401",
          libelle: "Fournisseur",
          debit: "0",
          credit: "1969.610",
          tax_code: null,
        },
      ],
    }) as Promise<string>;

  const montantsVusParLaPme = async (id: string) =>
    (
      (await pmeFait("capture.dossier", id)) as {
        montantsDuCabinet: MontantsDuCabinet | null;
      }
    ).montantsDuCabinet;

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, mdp);
    const e = await creerCompte(`expert-${marque}@essai.local`, mdp);
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
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
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mfDossier));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
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
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("prise en charge, la PME lit les montants du cabinet ; avant, ceux de la lecture", async () => {
    const id = await transmise();
    assert.equal(await montantsVusParLaPme(id), null, "avant la prise en charge, la lecture");

    await forcer(id);
    const m = await montantsVusParLaPme(id);
    assert.ok(m, "prise en charge, les montants du cabinet");
    assert.equal(Number(m.baseHt), 1663);
    assert.equal(Number(m.tva), 306.61);
    assert.equal(Number(m.ttc), 1969.61);
    assert.deepEqual(m.droits, [], "le timbre lu n'est pas dans l'écriture du cabinet");

    // La liste dit le même total que la fiche.
    const liste = (await pmeFait("capture.listAvecLecture", pme)) as Array<{
      id: string;
      total: string | null;
    }>;
    assert.equal(Number(liste.find((p) => p.id === id)?.total), 1969.61);

    // La PME ne reçoit que des montants : ni compte, ni ligne d'écriture.
    assert.doesNotMatch(JSON.stringify(m), /601|4366|401|account/);
  });

  it("la TVA et les charges du mois comptent l'écriture du cabinet, pas la lecture", async () => {
    const id = await transmise();
    await forcer(id);
    const mois = jour.slice(0, 7);
    const fin = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);

    const extraits = (await pmeFait("office.extraitsTransmis", pme, `${mois}-01`, fin)) as Array<{
      pieceId: string;
      extract: {
        document_date: string;
        totals: { base_ht: string; vat: string; ttc: string };
        lines: Array<{ tax_code: string; base_ht: string; vat_amount: string }>;
        other_charges: unknown[];
      };
    }>;
    const x = extraits.find((e) => e.pieceId === id)?.extract;
    assert.ok(x, "la pièce prise en charge pèse au mois de son écriture");
    assert.equal(x.document_date, jour);
    assert.equal(Number(x.totals.vat), 306.61);
    assert.deepEqual(
      x.lines.map((l) => [l.tax_code, Number(l.base_ht), Number(l.vat_amount)]),
      [["TVA19", 1663, 306.61]],
      "le code de taxe de la lecture, les montants du cabinet",
    );
    assert.deepEqual(x.other_charges, []);

    const articles = (await pmeFait("charges.articles", pme, mois, mois)) as Array<{
      pieceId: string;
      totalHt: string | null;
      source: string;
      designation: string;
    }>;
    const charges = articles.filter((a) => a.pieceId === id);
    assert.deepEqual(
      charges.map((a) => [a.source, Number(a.totalHt), a.designation]),
      [["cabinet", 1663, "FOURNISSEUR SA"]],
    );
  });

  it("au cabinet, le nom de qui a forcé se lit — même pour un compte membre des deux côtés", async () => {
    const id = await transmise();
    // Un client seulement ne lit pas le nom du comptable.
    await forcer(id);
    const aLaPme = (await pmeFait("capture.dossier", id)) as {
      suivi: { prisePar: string | null };
    };
    assert.equal(aLaPme.suivi.prisePar, null, "le nom du comptable reste au cabinet");

    // Le propriétaire est AUSSI expert du cabinet (le cas du staging) : il
    // force, et l'en-tête du cabinet dit son nom.
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')`,
      [cabinet, dirigeant.id],
    );
    try {
      const autre = await transmise();
      await rpc(dirigeant, "office.forcer", {
        pieceId: autre,
        journal: "ACH",
        date: jour,
        libelle: "Facture saisie par le cabinet",
        lignes: [
          { account_code: "601", libelle: "Achat", debit: "10.000", credit: "0", tax_code: null },
          {
            account_code: "401",
            libelle: "Fournisseur",
            debit: "0",
            credit: "10.000",
            tax_code: null,
          },
        ],
      });
      const auCabinet = (await rpc(dirigeant, "capture.dossier", autre)) as {
        suivi: { prise: string | null; prisePar: string | null };
      };
      assert.equal(auCabinet.suivi.prise, "forcee");
      assert.equal(auCabinet.suivi.prisePar, `dirigeant-${marque}@essai.local`);
    } finally {
      await admin.query(`delete from identity.memberships where tenant_id = $1 and user_id = $2`, [
        cabinet,
        dirigeant.id,
      ]);
    }
  });

  it("forcer n'écrit pas « Le Socle a proposé » dans la piste de la pièce", async () => {
    const id = await transmise();
    const ecriture = await forcer(id);
    const piste = (await cabinetFait("supervision.auditForPiece", id)) as Array<{
      action: string;
      payload: { piece_id?: string } | null;
    }>;
    const actions = piste.map((e) => e.action);
    assert.ok(actions.includes("ecriture.forcee"));
    assert.ok(!actions.includes("ecriture.proposed"), actions.join(", "));
    // Le fait reste au journal d'audit (R7) : seule la piste ne le redit pas.
    const { rows } = await admin.query(
      `select 1 from audit.event_log where action = 'ecriture.proposed' and object_id = $1`,
      [ecriture],
    );
    assert.equal(rows.length, 1);
  });

  it("la seconde de deux pièces jumelles est un « Doublon probable » ; la première, non", async () => {
    // Le staging : un émetteur sans matricule lisible, même date, même
    // numéro, même total — deux photos de la même facture.
    const sansMatricule = (e: Record<string, unknown>) => ({
      ...e,
      references: { numero: `JUMELLE-${marque}` },
    });
    const premiere = await transmise(sansMatricule);
    const seconde = await transmise(sansMatricule);
    const file = (await cabinetFait("supervision.queue", cabinet)) as Array<{
      pieceId: string;
      doublonDe: string | null;
    }>;
    assert.equal(file.find((r) => r.pieceId === premiere)?.doublonDe, null);
    assert.equal(file.find((r) => r.pieceId === seconde)?.doublonDe, premiere);

    // Le jugement de la lecture le dit aussi : à rapprocher, l'autre nommée.
    const { rows } = await admin.query<{ c: Array<{ code: string; statut: string }> }>(
      `select controles as c from capture.analyses where piece_id = $1
        order by created_at desc limit 1`,
      [seconde],
    );
    assert.equal(rows[0]!.c.find((c) => c.code === "doublon")?.statut, "rapprocher");

    // Rien n'est supprimé : la PME décide.
    const { rows: restent } = await admin.query(
      `select id from capture.pieces where id = any($1::uuid[]) and archivee_le is null`,
      [[premiere, seconde]],
    );
    assert.equal(restent.length, 2);
  });
});
