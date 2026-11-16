/**
 * Sous « Toutes les sociétés », le chiffre de chaque société se lit société par société, par les
 * portes que lit l'écran d'une société (0.2.112, planche B du 13 novembre 2026). Cette épreuve
 * dit ce que ces portes rendent — sous le vrai rôle, jamais en superutilisateur — à qui n'a pas
 * le droit de lire la société : rien. Ni fiche, ni pièce, ni article, ni organisation : aucun
 * chiffre ne sort d'une société qui n'est pas la sienne (R6), et le moteur du Socle, nourri de ce
 * rien, ne rend pas un solde mais un état.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/la-tva-par-societe-ne-lit-que-ses-societes.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur } from "./db.ts";
import { identite } from "./depots/identite.ts";
import { office } from "./depots/office.ts";
import { matriculeDEssai } from "./matricule-d-essai.ts";
import { executerRpc } from "./rpc.ts";
import { lecture as lectureDEssai } from "./scan/lecture-d-essai.ts";
import { organisationDEssai } from "./organisation-d-essai.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("la TVA par société ne lit que ses sociétés", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `tva-soc-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const mfReel = matriculeDEssai("A", "M");
  const mfForfait = matriculeDEssai("A", "M");
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const organisations: string[] = [];

  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let collaborateur: Utilisateur;
  let intrus: Utilisateur;
  let reel = "";
  let forfait = "";
  let cabinet = "";
  let sienne = "";
  let packId = "";
  let jour = "";

  const rpc = (u: Utilisateur, methode: string, ...args: unknown[]) => {
    const [depot, nom] = methode.split(".") as [string, string];
    return sousIdentite(u.id, (db) => executerRpc(db, { depot, methode: nom, args }));
  };

  /**
   * Une lecture refusée est un refus nommé (`refus.…`) ; une lecture permise mais sans droit sur la
   * société rend rien. Dans les deux cas, aucune donnée ne sort : c'est ce que l'épreuve exige.
   */
  const sansRien = async <T>(lecture: Promise<T>, vide: (v: T) => boolean) => {
    try {
      assert.ok(vide(await lecture), "la lecture ne doit rien rendre");
    } catch (e) {
      // Une porte qui ne trouve pas la société la dit (ex. « dossier introuvable ») : la lecture
      // est rejetée, et le chiffre de la ligne devient « indisponible », sans rien montrer.
      assert.ok(e instanceof Error && e.message.length > 0, "un refus, pas un silence");
    }
  };

  /** Une fenêtre large : ce que la société détient, quel que soit le mois de rattachement. */
  const mois = () => ({ debut: "2000-01-01", fin: "2100-12-31", periode: jour.slice(0, 7) });

  /** Les lectures que fait le chiffre d'une société, dans l'ordre de `chiffreTva`. */
  const lectures = async (u: Utilisateur, societe: string) => {
    const { debut, fin, periode } = mois();
    return {
      fiche: await rpc(u, "identite.ficheCourante", societe),
      cabinet: await rpc(u, "identite.monCabinet", societe),
      transmis: (await rpc(u, "office.extraitsTransmis", societe, debut, fin)) as unknown[],
      comptabilises: (await rpc(u, "office.bookedExtracts", societe, debut, fin)) as unknown[],
      charges: (await rpc(u, "charges.articles", societe, periode, periode)) as unknown[],
    };
  };
  /** Les mêmes lectures, une à une : chacune rend rien ou se refuse. */
  const rienPour = async (u: Utilisateur, societe: string) => {
    const { debut, fin, periode } = mois();
    await sansRien(rpc(u, "identite.ficheCourante", societe), (v) => v === null);
    await sansRien(rpc(u, "identite.monCabinet", societe), (v) => v === null);
    await sansRien(
      rpc(u, "office.extraitsTransmis", societe, debut, fin),
      (v) => (v as unknown[]).length === 0,
    );
    await sansRien(
      rpc(u, "office.bookedExtracts", societe, debut, fin),
      (v) => (v as unknown[]).length === 0,
    );
    await sansRien(
      rpc(u, "charges.articles", societe, periode, periode),
      (v) => (v as unknown[]).length === 0,
    );
  };

  before(async () => {
    const comptes = await Promise.all(
      ["dirigeant", "expert", "collaborateur", "intrus"].map((r) =>
        creerCompte(`${r}-${marque}@essai.local`, mdp),
      ),
    );
    assert.ok(comptes.every(Boolean));
    [dirigeant, expert, collaborateur, intrus] = comptes as [
      Utilisateur,
      Utilisateur,
      Utilisateur,
      Utilisateur,
    ];
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await organisationDEssai(db, `$1, $2, 'mandate', $3, 'TN', 'TND'`, [
          kind,
          nom,
          mf,
        ]);
        organisations.push(rows[0]!.id);
        return rows[0]!.id;
      });
    reel = await creer(dirigeant, "pme", `REEL ${marque}`, mfReel);
    forfait = await creer(dirigeant, "pme", `FORFAIT ${marque}`, mfForfait);
    cabinet = await creer(expert, "cabinet", `CABINET ${marque}`, null);
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, mfReel));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, reel));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    // Le collaborateur est membre d'une AUTRE société (un atelier sans licence, donc sans borne de
    // places) : il lit la sienne, et rien de celles du dirigeant.
    const { rows: atelier } = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`ATELIER ${marque}`],
    );
    sienne = atelier[0]!.id;
    organisations.push(sienne);
    await admin.query(
      `insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')`,
      [sienne, collaborateur.id],
    );
    packId = (
      await admin.query<{ id: string }>(
        `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
          order by effective_from desc limit 1`,
      )
    ).rows[0]!.id;
    jour = (await sousIdentite(expert.id, (db) =>
      executerRpc(db, { depot: "parametrage", methode: "fuseauDuCabinet", args: [cabinet] }),
    )) as unknown as string;
    jour = (jour as unknown as { aujourdhui: string }).aujourdhui;

    // Deux fiches de régimes différents : l'une réelle, l'autre au forfait (non assujettie).
    for (const [tenantId, regimeTva] of [
      [reel, "assujetti"],
      [forfait, "non_assujetti"],
    ] as const) {
      await sousIdentite(dirigeant.id, (db) =>
        identite.etablirFiche(db, {
          tenantId,
          regimeTva,
          source: "saisie",
          validFrom: "2026-01-01",
        }),
      );
    }

    // Une pièce lue, jugée et transmise : elle compte dans le mois de la société « réel ».
    const { id } = (await rpc(dirigeant, "capture.enregistrer", {
      tenantId: reel,
      source: "pdf",
      vis: "entite",
      idempotencyKey: `${marque}-1`,
      contentType: "application/pdf",
      pageCount: 1,
    })) as { id: string };
    const l = lectureDEssai({ clientMf: mfReel, numero: `TS-${marque}-1` });
    await sousIdentiteDuServeur(dirigeant.id, (db) =>
      executerRpc(
        db,
        {
          depot: "capture",
          methode: "persisterLecture",
          args: [
            {
              pieceId: id,
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
    await rpc(dirigeant, "capture.analyser", id);
    await rpc(dirigeant, "collab.setPieceVis", id, "partage");
    // Le cabinet lui propose une écriture : la pièce « compte » alors dans la TVA du mois.
    const L = (compte: string, debit: string, credit: string, taxe: string | null = null) => ({
      account_code: compte,
      libelle: compte,
      debit,
      credit,
      tax_code: taxe,
    });
    await sousIdentite(expert.id, (db) =>
      office.propose(db, {
        pieceId: id,
        journal: "ACH",
        date: jour,
        libelle: "Facture d'essai",
        packVersionId: packId,
        devise: "TND",
        lignes: [
          L("601", "1234.560", "0"),
          L("4366", "234.566", "0", "TVA19"),
          L("401", "0", "1469.126"),
        ],
      }),
    );
  });

  after(async () => {
    try {
      // Les organisations de test s'archivent, elles ne se suppriment pas (R7).
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1) and archived_at is null`,
        [organisations],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("le dirigeant lit les deux sociétés, chacune sous son régime", async () => {
    const orgs = (await rpc(dirigeant, "identite.listMyOrganizations")) as Array<{ id: string }>;
    assert.ok(orgs.some((o) => o.id === reel) && orgs.some((o) => o.id === forfait));
    const r = await lectures(dirigeant, reel);
    assert.equal((r.fiche as { regimeTva: string }).regimeTva, "assujetti");
    assert.ok(r.cabinet, "la société réelle a un mandat");
    assert.equal(r.transmis.length, 1, "sa pièce transmise compte dans son mois");
    const f = await lectures(dirigeant, forfait);
    assert.equal((f.fiche as { regimeTva: string }).regimeTva, "non_assujetti");
    assert.equal(f.cabinet, null);
    assert.equal(f.transmis.length, 0, "la société au forfait n'hérite de rien de l'autre");
  });

  it("un tiers sans accès ne reçoit rien : ni société, ni fiche, ni pièce, ni article", async () => {
    const orgs = (await rpc(intrus, "identite.listMyOrganizations")) as Array<{ id: string }>;
    assert.equal(
      orgs.filter((o) => organisations.includes(o.id)).length,
      0,
      "aucune ligne ne lui serait proposée",
    );
    for (const societe of [reel, forfait]) await rienPour(intrus, societe);
  });

  it("un collaborateur d'une autre société ne lit ni l'une ni l'autre", async () => {
    const orgs = (await rpc(collaborateur, "identite.listMyOrganizations")) as Array<{
      id: string;
    }>;
    const siennes = orgs.filter((o) => organisations.includes(o.id)).map((o) => o.id);
    assert.deepEqual(siennes, [sienne], "sa seule société est celle dont il est membre");
    for (const autre of [reel, forfait]) await rienPour(collaborateur, autre);
  });

  it("le cabinet mandaté ne lit pas la société qu'il ne suit pas", async () => {
    await rienPour(expert, forfait);
  });
});
