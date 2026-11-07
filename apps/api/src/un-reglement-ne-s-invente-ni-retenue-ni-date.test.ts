/**
 * Un règlement ne s'invente ni une retenue ni une date (vérification
 * indépendante du lot S5b).
 *
 * Le contrôle `app.un_reglement_est_ce_que_son_paiement_dit()` lie le journal,
 * la trésorerie (compte, côté, montant, devise) et le compte du tiers au
 * paiement. Il ne lie pas :
 *   - le montant des retenues : toute ligne au compte d'une retenue, du côté de
 *     la trésorerie, passe, quel qu'en soit le montant, et le tiers absorbe
 *     l'écart. La PME d'un dossier confié inscrit, pour un paiement de 10 en
 *     espèces sans aucune retenue qualifiée, une dette fiscale de 90 et éteint
 *     100 de sa dette fournisseur ;
 *   - la date : une écriture de règlement se date où l'on veut. La PME propose
 *     par le dépôt du navigateur (`office.propose`) les lignes exactes du moteur,
 *     datées de 2020, et `socle_ecriture_book` les inscrit sous son identité : le
 *     paiement d'octobre 2026 est inscrit en janvier 2020.
 *
 *   node --experimental-strip-types --test src/un-reglement-ne-s-invente-ni-retenue-ni-date.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";
import { propositionDeReglement } from "./scan/reglement.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

type Ligne = {
  account_code: string;
  libelle: string;
  debit: string;
  credit: string;
  tax_code: string | null;
};

describe("un règlement ne s'invente ni retenue ni date", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `reglement-invente-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let cabinet = "";
  let dossier = "";
  let packId = "";
  const mf = matriculeDEssai("A", "M");
  const rpc = (u: Utilisateur, depot: string, methode: string, ...args: unknown[]) =>
    sousIdentite(u.id, (db) => executerRpc(db, { depot, methode, args }));

  let n = 0;
  /** Une facture d'achat lue, transmise, que le cabinet inscrit. */
  const priseEnCharge = async () => {
    n += 1;
    const l = lectureDEssai({ clientMf: mf, numero: `INV-${n}` });
    const p = (await rpc(dirigeant, "capture", "enregistrer", {
      tenantId: dossier,
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
              extract: l.extract,
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
    await rpc(dirigeant, "capture", "analyser", p.id);
    await rpc(dirigeant, "collab", "setPieceVis", p.id, "partage");
    const prop = (await rpc(expert, "office", "propositionDePiece", p.id)) as {
      empreinte?: string;
    };
    await rpc(expert, "office", "valider", p.id, prop.empreinte ?? null);
    return p.id;
  };
  const payer = (pieceId: string, mineur: number, payeLe: string) =>
    rpc(dirigeant, "capture", "enregistrerPaiement", {
      pieceId,
      packId,
      moyenCode: "especes",
      montantMineur: mineur,
      devise: "TND",
      payeLe,
    }) as Promise<string>;
  /** Les lignes que le moteur rend pour ce paiement, sans retenue. */
  const lignesDuMoteur = async (paiement: string, base: string) => {
    const r = await sousIdentiteDuServeur(dirigeant.id, (db) =>
      propositionDeReglement(db, paiement, {
        codes: [],
        baseReglee: base,
        justification: "Fournisseur dispensé : attestation d'essai.",
      }),
    );
    assert.ok(r.ok, "le moteur propose le règlement");
    return { journal: r.ecriture.journal, lignes: r.ecriture.lignes as unknown as Ligne[] };
  };

  before(async () => {
    dirigeant = (await creerCompte(`dirigeant-${marque}@essai.local`, mdp))!;
    expert = (await creerCompte(`expert-${marque}@essai.local`, mdp))!;
    const creer = (u: Utilisateur, kind: string, nom: string, mode: string, m: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, $3, $4, 'TN', 'TND') as id`,
          [kind, nom, mode, m],
        );
        return rows[0]!.id;
      });
    cabinet = await creer(expert, "cabinet", `CABINET ${marque}`, "mandate", null);
    dossier = await creer(dirigeant, "pme", `PME ${marque}`, "mandate", mf);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mf));
    const [propose] = await sousIdentite(dirigeant.id, (db) =>
      identite.mandatsProposes(db, dossier),
    );
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[cabinet, dossier].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("une retenue que le paiement ne dit pas n'entre pas aux livres du cabinet", async () => {
    const piece = await priseEnCharge();
    const paiement = await payer(piece, 10000, "2026-10-03");
    const { journal, lignes } = await lignesDuMoteur(paiement, "10.000");
    const tiers = lignes.find((l) => Number(l.debit) > 0)!;
    const tresorerie = lignes.find((l) => Number(l.credit) > 0)!;
    const retenue = (
      await admin.query<{ a: string[] }>(
        `select array(select app.comptes_du_role($1, 'RETENUE_SOURCE_OPEREE', $2, null)) as a`,
        [dossier, packId],
      )
    ).rows[0]!.a[0]!;
    // 10 payés en espèces, aucune retenue qualifiée : le tiers est éteint de 100
    // et une dette fiscale de 90 apparaît.
    const inventees: Ligne[] = [
      { ...tiers, debit: "100.000", credit: "0" },
      { ...tresorerie, debit: "0", credit: "10.000" },
      { account_code: retenue, libelle: "Retenue", debit: "0", credit: "90.000", tax_code: null },
    ];
    await sousIdentiteDuServeur(dirigeant.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `select public.socle_ecriture_propose($1, $2, '2026-10-03', 'Règlement', $3, $4::jsonb,
                                              'TND', $5) as id`,
        [piece, journal, packId, JSON.stringify(inventees), paiement],
      );
      await db.query(`select public.socle_ecriture_book($1)`, [rows[0]!.id]);
    }).catch(() => undefined);

    const { rows } = await admin.query(
      `select e.status from socle.ecritures e
        where e.paiement_id = $1
          and exists (select 1 from socle.ecriture_lignes l
                       where l.ecriture_id = e.id and l.account_code = $2)`,
      [paiement, retenue],
    );
    assert.deepEqual(rows, [], "une retenue de 90 inventée sur un paiement de 10 est inscrite");
  });

  it("un règlement porte le jour de son paiement", async () => {
    const piece = await priseEnCharge();
    const paiement = await payer(piece, 10000, "2026-10-04");
    const { journal, lignes } = await lignesDuMoteur(paiement, "10.000");
    try {
      const id = (await rpc(dirigeant, "office", "propose", {
        pieceId: piece,
        journal,
        date: "2020-01-01",
        libelle: "Règlement",
        packVersionId: packId,
        lignes,
        devise: "TND",
        paiementId: paiement,
      })) as string;
      // La porte de la base, sous l'identité de la société (R6 : la base décide).
      await sousIdentiteDuServeur(dirigeant.id, (db) =>
        db.query(`select public.socle_ecriture_book($1)`, [id]),
      );
    } catch {
      // Refusé : c'est ce qu'on attend.
    }
    const { rows } = await admin.query<{ date_ecriture: string }>(
      `select e.date_ecriture::text as date_ecriture from socle.ecritures e
        where e.paiement_id = $1 and e.status = 'booked' and e.date_ecriture <> '2026-10-04'`,
      [paiement],
    );
    assert.deepEqual(rows, [], "le règlement du 4 octobre 2026 est daté d'un autre jour");
  });
});
