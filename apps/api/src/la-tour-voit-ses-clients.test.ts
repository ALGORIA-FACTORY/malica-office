/**
 * L'espace commun de la tour (`/tour`, 2 novembre 2026) : la tour voit tous
 * les cabinets et toutes les PME, avec ou sans cabinet — et personne d'autre
 * ne voit rien.
 *
 * Sous les VRAIS rôles (`authenticated` et la personne posée en claim),
 * jamais en superutilisateur : la règle du dépôt (AGENTS.md) est qu'une
 * preuve en superutilisateur ne prouve rien. Tout se passe dans une
 * transaction annulée : rien ne reste en base.
 *
 * Ce qui est éprouvé :
 *   — l'opérateur lit les cabinets, les PME (avec et sans cabinet), leur
 *     offre, leur consommation, l'état de leurs factures et leur bibliothèque
 *     EN NOMBRES (l'espace privé n'entre pas dans le compte) ;
 *   — un expert de cabinet et un dirigeant de PME : la route RPC refuse
 *     (42501), et la base, appelée sans la route, ne rend RIEN non plus ;
 *   — les trois gestes de la fiche « Gérer » passent par les portes de la
 *     base, exigent un motif, et sont refusés à qui n'est pas opérateur.
 *
 *   DATABASE_URL_ADMIN=… node --experimental-strip-types --test src/la-tour-voit-ses-clients.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { tour } from "./depots/tour.ts";
import { personnesDEssai } from "./personne-d-essai.ts";
import { executerRpc } from "./rpc.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Monde {
  operateur: string;
  expert: string;
  dirigeant: string;
  direct: string;
  cabinet: string;
  pmeDuCabinet: string;
  pmeDirecte: string;
  licenceDuCabinet: string;
  licenceDirecte: string;
}

/** Exécute `corps` dans une transaction qu'on annule toujours. */
async function aBlanc<T>(corps: (db: pg.PoolClient, m: Monde) => Promise<T>): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    const m = await monter(db);
    return await corps(db, m);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

async function organisation(db: pg.PoolClient, kind: string, nom: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ($1, $2, 'TN', 'TND') returning id`,
    [kind, nom],
  );
  return rows[0]!.id;
}

async function licence(db: pg.PoolClient, titulaire: string, offre: string, tenant: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into facturation.licences (titulaire, offre_code, offre_depuis)
     values ($1, $2, current_date) returning id`,
    [titulaire, offre],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [rows[0]!.id, tenant],
  );
  return rows[0]!.id;
}

async function piece(db: pg.PoolClient, tenant: string, auteur: string, vis: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into capture.pieces
       (tenant_id, source, vis, storage_path, idempotency_key, created_by, transmise_le)
     values ($1, 'pdf', $2::app.vis_t, $3, $3, $4, case when $2::text = 'partage' then now() end) returning id`,
    [tenant, vis, `tour-${randomUUID()}`, auteur],
  );
  return rows[0]!.id;
}

/**
 * Un cabinet et sa PME sous mandat ; une PME en direct, avec une facture en
 * retard ; des pièces de société, transmises ou non, et une pièce privée.
 */
async function monter(db: pg.PoolClient): Promise<Monde> {
  const [operateur, expert, dirigeant, direct] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  await personnesDEssai(db, operateur, expert, dirigeant, direct);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  await db.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
    direct,
    "Selim Ben Amor",
  ]);

  const cabinet = await organisation(db, "cabinet", "Cabinet d'essai de la tour");
  const pmeDuCabinet = await organisation(db, "pme", "PME sous mandat");
  const pmeDirecte = await organisation(db, "pme", "PME en direct");
  await db.query(
    `insert into identity.memberships (tenant_id, user_id, role)
     values ($1, $2, 'expert'), ($3, $4, 'dirigeant'), ($5, $6, 'dirigeant')`,
    [cabinet, expert, pmeDuCabinet, dirigeant, pmeDirecte, direct],
  );
  await db.query(
    `insert into identity.engagements (pme_org_id, cabinet_org_id, status)
     values ($1, $2, 'actif')`,
    [pmeDuCabinet, cabinet],
  );
  const licenceDuCabinet = await licence(db, dirigeant, "team", pmeDuCabinet);
  const licenceDirecte = await licence(db, direct, "solo", pmeDirecte);

  await piece(db, pmeDuCabinet, dirigeant, "partage");
  await piece(db, pmeDuCabinet, dirigeant, "entite");
  await piece(db, pmeDuCabinet, dirigeant, "personnel");
  const lue = await piece(db, pmeDirecte, direct, "entite");
  await db.query(
    `insert into facturation.lectures (tenant_id, licence_id, piece_id, periode, consommee_par)
     values ($1, $2, $3, date_trunc('month', current_date)::date, $4)`,
    [pmeDirecte, licenceDirecte, lue, direct],
  );
  // Une facture du mois dernier, échue depuis cinq jours et non réglée.
  await db.query(
    `insert into facturation.factures
       (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations,
        sieges_payants, montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
        payeur_type, payeur_personne, destinataire_nom)
     values ($1, $2, (date_trunc('month', current_date) - interval '1 month')::date,
             current_date - 20, current_date - 5, 'solo', 1, 0, 100, 0.19, 19, 1, 120, 'TND',
             'titulaire', $3, 'Selim Ben Amor')`,
    [licenceDirecte, `TOUR-${randomUUID()}`, direct],
  );
  return {
    operateur,
    expert,
    dirigeant,
    direct,
    cabinet,
    pmeDuCabinet,
    pmeDirecte,
    licenceDuCabinet,
    licenceDirecte,
  };
}

async function sous(db: pg.PoolClient, personne: string): Promise<void> {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [personne]);
}

/** Rend le code SQLSTATE d'un refus, ou `null` si l'appel est passé ; le point de reprise survit. */
async function refus(db: pg.PoolClient, appel: () => Promise<unknown>): Promise<string | null> {
  await db.query("savepoint essai");
  try {
    await appel();
    await db.query("release savepoint essai");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint essai");
    return (e as { code?: string }).code ?? "inconnu";
  }
}

describe("la tour voit ses clients, et personne d'autre", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("l'opérateur lit les cabinets et les PME, avec et sans cabinet, en nombres", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.operateur);
      const { cabinets, pme } = await tour.clients(db);

      const cabinet = cabinets.find((c) => c.id === m.cabinet);
      assert.ok(cabinet, "le cabinet est listé");
      assert.equal(cabinet.etat, null, "aucune facture consolidée : aucun état");

      const sousMandat = pme.find((p) => p.id === m.pmeDuCabinet);
      assert.ok(sousMandat);
      assert.equal(sousMandat.cabinet_id, m.cabinet);
      assert.equal(sousMandat.offre_code, "team");
      assert.equal(sousMandat.statut, "active");
      assert.equal(sousMandat.documents, 2, "la pièce privée n'entre pas dans le compte");
      assert.equal(sousMandat.transmis_mois, 1);

      const directe = pme.find((p) => p.id === m.pmeDirecte);
      assert.ok(directe);
      assert.equal(directe.cabinet_id, null, "une PME sans cabinet est listée");
      assert.equal(directe.lectures_consommees, 1);
      assert.equal(directe.etat, "en_retard");
      assert.equal(Number(directe.reste_du), 120);
      assert.equal(directe.devise_du, "TND", "la devise est celle de la facture");
    });
  });

  it("une facture annulée n'est pas « payée », et la consolidée reste au cabinet", async () => {
    await aBlanc(async (db, m) => {
      // Une facture directe, annulée : aucun encaissement, aucune dette.
      await db.query(`update facturation.factures set statut = 'annulee' where licence_id = $1`, [
        m.licenceDirecte,
      ]);
      // Une consolidée du cabinet, en retard, qui couvre la PME sous mandat.
      const { rows } = await db.query<{ id: string }>(
        `insert into facturation.factures
           (licence_id, numero, periode, emise_le, echeance_le, organisations, sieges_payants,
            montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
            payeur_type, payeur_tenant_id, destinataire_nom)
         values (null, $1, (date_trunc('month', current_date) - interval '1 month')::date,
                 current_date - 20, current_date - 5, 2, 0, 300, 0.19, 57, 1, 358, 'TND',
                 'cabinet', $2, 'Cabinet d''essai de la tour') returning id`,
        [`TOUR-C-${randomUUID()}`, m.cabinet],
      );
      await db.query(
        `insert into facturation.facture_lignes
           (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht, licence_id, tenant_id)
         values ($1, 1, 'PME sous mandat', 1, 150, 150, $2, $3)`,
        [rows[0]!.id, m.licenceDuCabinet, m.pmeDuCabinet],
      );

      await sous(db, m.operateur);
      const { cabinets, pme } = await tour.clients(db);
      const directe = pme.find((p) => p.id === m.pmeDirecte)!;
      assert.equal(directe.etat, null, "toutes annulées : ni payée, ni due");
      assert.equal(Number(directe.reste_du), 0);

      const cabinet = cabinets.find((c) => c.id === m.cabinet)!;
      assert.equal(cabinet.etat, "en_retard");
      assert.equal(Number(cabinet.reste_du), 358);

      const couverte = pme.find((p) => p.id === m.pmeDuCabinet)!;
      assert.equal(couverte.etat, "en_retard", "l'état de la consolidée se lit chez la PME");
      assert.equal(Number(couverte.reste_du), 0, "sa dette n'est imputée à aucune PME");
      assert.equal(couverte.devise_du, null);
    });
  });

  it("ne rend aucun contenu de pièce : ni identifiant, ni tiers, ni montant de pièce", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.operateur);
      const { pme } = await tour.clients(db);
      const ligne = pme.find((p) => p.id === m.pmeDuCabinet)!;
      assert.deepEqual(Object.keys(ligne).sort(), [
        "cabinet_id",
        "cabinet_nom",
        "dernier_depot_le",
        "devise",
        "devise_du",
        "documents",
        "echeance_le",
        "etat",
        "id",
        "lectures_consommees",
        "lectures_droit",
        "licence_id",
        "matricule",
        "nom",
        "offre_code",
        "offre_libelle",
        "paye_par_cabinet",
        "reste_du",
        "statut",
        "transmis_mois",
      ]);
    });
  });

  for (const qui of ["expert", "dirigeant"] as const) {
    it(`un ${qui} ne lit rien : refusé par la route, et vide dans la base`, async () => {
      await aBlanc(async (db, m) => {
        await sous(db, m[qui]);
        assert.equal(
          await refus(db, () => executerRpc(db, { depot: "tour", methode: "clients", args: [] })),
          "42501",
        );
        assert.equal(
          await refus(db, () => db.query("select * from plateforme.bibliotheques_compter()")),
          "42501",
          "les nombres de la bibliothèque sont à la tour seule",
        );
        // Sans la route : la base elle-même refuse ou ne rend rien.
        const rendu: { lu?: Awaited<ReturnType<typeof tour.clients>> } = {};
        const code = await refus(db, async () => {
          rendu.lu = await tour.clients(db);
        });
        const lignes = rendu.lu ? rendu.lu.cabinets.length + rendu.lu.pme.length : 0;
        assert.ok(code === "42501" || lignes === 0, `la base a rendu des lignes à un ${qui}`);
        const { rows } = await db.query("select count(*)::int as n from plateforme.licences_v");
        assert.equal(rows[0]!.n, 0);
      });
    });
  }

  it("suspendre, reprendre, accorder : motivés, et à l'opérateur seul", async () => {
    await aBlanc(async (db, m) => {
      await sous(db, m.dirigeant);
      for (const geste of [
        () => tour.suspendre(db, m.licenceDuCabinet, "essai"),
        () => tour.reprendre(db, m.licenceDuCabinet, "essai"),
        () => tour.accorderLectures(db, m.licenceDuCabinet, 10, "2026-11", "essai"),
      ]) {
        assert.equal(await refus(db, geste), "42501");
      }

      await db.query("reset role");
      await sous(db, m.operateur);
      assert.equal(
        await refus(db, () => tour.suspendre(db, m.licenceDirecte, "   ")),
        "22023",
        "un motif vide ne part pas",
      );
      assert.equal(
        await refus(db, () => tour.accorderLectures(db, m.licenceDirecte, 0, "2026-11", "x")),
        "22023",
      );

      await tour.suspendre(db, m.licenceDirecte, "Impayé de deux mois");
      let { pme } = await tour.clients(db);
      assert.equal(pme.find((p) => p.id === m.pmeDirecte)!.statut, "suspendue");

      await tour.reprendre(db, m.licenceDirecte, "Règlement reçu");
      ({ pme } = await tour.clients(db));
      assert.equal(pme.find((p) => p.id === m.pmeDirecte)!.statut, "active");

      const mois = new Date().toISOString().slice(0, 7);
      const avant = pme.find((p) => p.id === m.pmeDirecte)!.lectures_droit!;
      await tour.accorderLectures(db, m.licenceDirecte, 25, mois, "Rattrapage de clôture");
      ({ pme } = await tour.clients(db));
      assert.equal(pme.find((p) => p.id === m.pmeDirecte)!.lectures_droit, avant + 25);

      // Une seule transaction : les trois gestes portent le même instant.
      const gestes = await tour.interventions(db, m.licenceDirecte);
      assert.deepEqual(gestes.map((g) => g.acte).sort(), [
        "reprise",
        "supplement_lectures",
        "suspension",
      ]);
      const supplement = gestes.find((g) => g.acte === "supplement_lectures")!;
      assert.equal(supplement.effet_du, `${mois}-01`);
      assert.ok(supplement.effet_au?.startsWith(mois), "la fenêtre se borne au mois choisi");
    });
  });
});
