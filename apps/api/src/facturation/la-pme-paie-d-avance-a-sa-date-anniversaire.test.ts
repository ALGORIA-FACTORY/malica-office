/**
 * La PME paie d'avance, à sa date anniversaire ; le cabinet reste au mois
 * (décisions du dirigeant, 4 novembre 2026, migration 20261128090000).
 *
 * Le robot passe sous le VRAI rôle de l'API (`malica_api`), le titulaire,
 * l'opérateur et l'intrus sous `authenticated` avec leurs claims, sur une
 * vraie base migrée, dans une transaction ANNULÉE. Les jours sont des
 * littéraux (20 novembre 2026, 31 janvier 2027…) : le robot reçoit le jour
 * qu'il passe, et la base ne lit l'horloge que pour le « jour même » d'un
 * geste, éprouvé à part avec la date du jour. Les prix se lisent dans la
 * grille (`ref.offre_a`) : aucun montant n'est écrit ici.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-pme-paie-d-avance-a-sa-date-anniversaire.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "../personne-d-essai.ts";

import type { BilanDuJour } from "./demarrer-la-facturation.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

/** Exécute `corps` dans une transaction qu'on annule toujours. */
async function aBlanc<T>(corps: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    return await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

async function enPersonne(db: pg.PoolClient, id: string): Promise<void> {
  await db.query("reset role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
}

/** Le robot de l'API, le jour `jour`. */
async function passer(db: pg.PoolClient, jour: string): Promise<BilanDuJour> {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
  await db.query("set local role malica_api");
  const { rows } = await db.query<{ r: BilanDuJour }>(
    "select fabrique.facturation_du_jour($1::date) as r",
    [jour],
  );
  await db.query("reset role");
  return rows[0]!.r;
}

interface Socle {
  operateur: string;
  intrus: string;
}

async function socle(db: pg.PoolClient): Promise<Socle> {
  const [operateur, intrus] = [randomUUID(), randomUUID()];
  await personnesDEssai(db, operateur, intrus);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const { rows: em } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Emetteur d''essai', 'TN', 'TND') returning id`,
  );
  await db.query(
    `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
     values ($1, date '2026-01-01', $2) on conflict (valide_des) do nothing`,
    [em[0]!.id, operateur],
  );
  return { operateur, intrus };
}

/** La tour ouvre (ou coupe) un périmètre, sous l'opérateur. */
async function regler(
  db: pg.PoolClient,
  s: Socle,
  perimetre: "cabinets" | "pme",
  actif: boolean,
  rattrapage = 1,
) {
  await enPersonne(db, s.operateur);
  await db.query("select plateforme.facturation_auto_regler($1, $2, $3, $4)", [
    perimetre,
    actif,
    rattrapage,
    "Staging : essai de la facturation anniversaire",
  ]);
  await db.query("reset role");
}

interface Pme {
  titulaire: string;
  tenant: string;
  licence: string;
}

/** Une PME, son dirigeant titulaire, sa licence née le `depuis`, et `places` collaborateurs. */
async function unePme(db: pg.PoolClient, depuis: string, offre = "solo", places = 0): Promise<Pme> {
  const titulaire = randomUUID();
  await personnesDEssai(db, titulaire);
  await db.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
    titulaire,
    "Selim Ben Amor",
  ]);
  const { rows: o } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'PME anniversaire', 'TN', 'TND') returning id`,
  );
  const tenant = o[0]!.id;
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, titulaire],
  );
  const licence = randomUUID();
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
     values ($1, $2, $3, $4::date)`,
    [licence, titulaire, offre, depuis],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, tenant],
  );
  for (let i = 0; i < places; i++) await unePlace(db, tenant);
  return { titulaire, tenant, licence };
}

/** Une place de plus : un collaborateur entre dans la PME. */
async function unePlace(db: pg.PoolClient, tenant: string) {
  const qui = randomUUID();
  await personnesDEssai(db, qui);
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'collaborateur')",
    [tenant, qui],
  );
}

/** Un cabinet paie la base de la licence (`offre`) depuis le `depuis` (D9). */
async function unCabinetPaie(db: pg.PoolClient, p: Pme, depuis: string, offre = "solo") {
  const expert = randomUUID();
  await personnesDEssai(db, expert);
  const { rows: c } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('cabinet', 'Cabinet du mois', 'TN', 'TND') returning id`,
  );
  const cabinet = c[0]!.id;
  await db.query(
    `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on)
     values ($1, $2, 'actif', $3::date)`,
    [p.tenant, cabinet, depuis],
  );
  await db.query(
    `insert into facturation.acces
       (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
        propose_le, propose_par, repondu_le, repondu_par, effet_du)
     values ($1, $2, 'cabinet', $3, $4, $5::date, 'actif', $5::date, $6, $5::date, $7, $5::date)`,
    [p.tenant, p.licence, cabinet, offre, depuis, expert, p.titulaire],
  );
  return cabinet;
}

/** Le titulaire change d'offre, à la date `le`. */
async function changer(db: pg.PoolClient, p: Pme, offre: string, le: string) {
  await enPersonne(db, p.titulaire);
  await db.query("select public.forfait_changer($1, $2, $3::date)", [offre, p.tenant, le]);
  await db.query("reset role");
}

interface Facture {
  id: string;
  numero: string;
  nature: string;
  periode: string;
  emise_le: string;
  couvre_du: string;
  couvre_au: string;
  montant_ht: string;
  timbre: string;
  inclut_la_base: boolean;
  libelle: string;
}

/** Les factures du titulaire d'une licence, lues en administrateur. */
async function facturesDuTitulaire(db: pg.PoolClient, licence: string): Promise<Facture[]> {
  await db.query("reset role");
  const { rows } = await db.query<Facture>(
    `select f.id, f.numero, f.nature, f.periode::text, f.emise_le::text, f.couvre_du::text,
            f.couvre_au::text, f.montant_ht::text, f.timbre::text, f.inclut_la_base,
            (select string_agg(l.libelle, ' | ' order by l.ordinal)
               from facturation.facture_lignes l where l.facture_id = f.id) as libelle
       from facturation.factures f
      where f.licence_id = $1 and f.payeur_type = 'titulaire' and f.avoir_de is null
      order by f.couvre_du, f.nature`,
    [licence],
  );
  return rows;
}

/** Le prix mensuel HT d'une offre, lu dans la grille (avec `places` en plus). */
async function prix(db: pg.PoolClient, offre: string, le: string, places = 0): Promise<number> {
  const { rows } = await db.query<{ p: string }>(
    `select (o.prix_mensuel_ht + o.prix_siege_sup * greatest(0, $3::int - o.sieges_inclus))::text as p
       from ref.offre_a($1, $2::date) o`,
    [offre, le, places],
  );
  return Number(rows[0]!.p);
}

/** Au millime, comme la base. */
const millimes = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);

const fenetre = (f: Facture) => [f.nature, f.couvre_du, f.couvre_au, f.emise_le];

describe("la PME paie d'avance, à sa date anniversaire", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("née le 20 novembre : facturée le 20 pour [20 nov., 20 déc.), rien le 1er, puis le 20 décembre", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db, "2026-11-20");
      await regler(db, s, "pme", true);

      const bilan = await passer(db, "2026-11-20");
      assert.equal(bilan.pme?.etat, "passee");
      const [f, ...autres] = await facturesDuTitulaire(db, p.licence);
      assert.equal(autres.length, 0);
      assert.deepEqual(fenetre(f!), ["base", "2026-11-20", "2026-12-20", "2026-11-20"]);
      assert.equal(f!.periode, "2026-11-01", "la période dit le mois de la facture");
      assert.equal(f!.montant_ht, millimes(await prix(db, "solo", "2026-11-20")), "sans prorata");
      assert.ok(Number(f!.timbre) > 0, "le timbre vient du pack de l'émetteur");
      assert.ok(f!.inclut_la_base, "la PME paie aussi la base : aucun cabinet ne la paie");
      assert.ok(f!.libelle.includes("du 20/11/2026 au 19/12/2026"), f!.libelle);
      assert.ok(!f!.libelle.includes("jours)"), "une période entière ne se dit pas au prorata");

      await passer(db, "2026-12-01");
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 1, "rien le 1er décembre");

      await passer(db, "2026-12-20");
      const toutes = await facturesDuTitulaire(db, p.licence);
      assert.deepEqual(toutes.map(fenetre), [
        ["base", "2026-11-20", "2026-12-20", "2026-11-20"],
        ["base", "2026-12-20", "2027-01-20", "2026-12-20"],
      ]);
    });
  });

  it("née un 31 : le dernier jour des mois courts, puis le 31 revient", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db, "2027-01-31");
      await regler(db, s, "pme", true);
      for (const jour of ["2027-01-31", "2027-02-27", "2027-02-28", "2027-03-30", "2027-03-31"]) {
        await passer(db, jour);
      }
      assert.deepEqual((await facturesDuTitulaire(db, p.licence)).map(fenetre), [
        ["base", "2027-01-31", "2027-02-28", "2027-01-31"],
        ["base", "2027-02-28", "2027-03-31", "2027-02-28"],
        ["base", "2027-03-31", "2027-04-30", "2027-03-31"],
      ]);
      // Une année bissextile : le 29 février.
      const { rows } = await db.query<{ debut: string; fin: string }>(
        `select debut::text, fin::text from facturation.echeance_de('2028-01-31', '2028-02-29')`,
      );
      assert.deepEqual(rows[0], { debut: "2028-02-29", fin: "2028-03-31" });
    });
  });

  it("une montée le 5 décembre : complément le jour même pour 15 jours d'écart, puis le 20 au nouveau prix", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db, "2026-11-20");
      await regler(db, s, "pme", true);
      await passer(db, "2026-11-20");
      await changer(db, p, "team", "2026-12-05");
      await passer(db, "2026-12-05");

      const [base, complement, ...autres] = await facturesDuTitulaire(db, p.licence);
      assert.equal(autres.length, 0);
      assert.deepEqual(fenetre(complement!), [
        "complement",
        "2026-12-05",
        "2026-12-20",
        "2026-12-05",
      ]);
      const ecart = (await prix(db, "team", "2026-12-05")) - (await prix(db, "solo", "2026-11-20"));
      assert.equal(complement!.montant_ht, millimes((ecart * 15) / 30), "l'écart, 15 jours sur 30");
      assert.ok(complement!.libelle.includes("(15/30 jours)"), complement!.libelle);
      assert.equal(complement!.timbre, base!.timbre, "son propre timbre");
      assert.notEqual(complement!.numero, base!.numero);

      await passer(db, "2026-12-20");
      const toutes = await facturesDuTitulaire(db, p.licence);
      assert.equal(toutes.length, 3);
      assert.deepEqual(fenetre(toutes[2]!), ["base", "2026-12-20", "2027-01-20", "2026-12-20"]);
      assert.equal(toutes[2]!.montant_ht, millimes(await prix(db, "team", "2026-12-05")));
    });
  });

  it("une place de plus en cours de période : un complément, puis l'échéance au nouveau prix", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const { rows: inclus } = await db.query<{ n: number }>(
        "select (ref.offre_a('team', date '2026-11-20')).sieges_inclus::int as n",
      );
      const places = inclus[0]!.n;
      const p = await unePme(db, "2026-11-20", "team", places);
      await regler(db, s, "pme", true);
      await passer(db, "2026-11-20");
      await unePlace(db, p.tenant);
      await passer(db, "2026-12-05");

      const [base, complement] = await facturesDuTitulaire(db, p.licence);
      assert.equal(base!.montant_ht, millimes(await prix(db, "team", "2026-11-20", places)));
      const ecart =
        (await prix(db, "team", "2026-11-20", places + 1)) -
        (await prix(db, "team", "2026-11-20", places));
      assert.ok(ecart > 0, "la grille fait payer la place de plus");
      assert.deepEqual(fenetre(complement!), [
        "complement",
        "2026-12-05",
        "2026-12-20",
        "2026-12-05",
      ]);
      assert.equal(complement!.montant_ht, millimes((ecart * 15) / 30));

      await passer(db, "2026-12-20");
      const toutes = await facturesDuTitulaire(db, p.licence);
      assert.equal(
        toutes[2]!.montant_ht,
        millimes(await prix(db, "team", "2026-11-20", places + 1)),
      );
    });
  });

  it("une descente le 5 décembre : rien de rendu, l'échéance du 20 au prix plus bas", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db, "2026-11-20", "team");
      await regler(db, s, "pme", true);
      await passer(db, "2026-11-20");
      await changer(db, p, "solo", "2026-12-05");
      await passer(db, "2026-12-05");

      const apres = await facturesDuTitulaire(db, p.licence);
      assert.equal(apres.length, 1, "ni complément ni avoir : la période facturée reste due");
      const { rows: avoirs } = await db.query(
        "select 1 from facturation.factures where licence_id = $1 and avoir_de is not null",
        [p.licence],
      );
      assert.equal(avoirs.length, 0);

      // Remonter dans la même période ne refacture rien : elle est déjà payée au prix haut.
      await changer(db, p, "team", "2026-12-10");
      await passer(db, "2026-12-10");
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 1);
      await changer(db, p, "solo", "2026-12-12");

      await passer(db, "2026-12-20");
      const toutes = await facturesDuTitulaire(db, p.licence);
      assert.equal(toutes.length, 2);
      assert.equal(toutes[1]!.montant_ht, millimes(await prix(db, "solo", "2026-12-12")));
    });
  });

  it("deux payeurs : le cabinet a la base au mois, la PME son complément le 10 décembre, puis le 10 janvier", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db, "2026-11-20");
      const cabinet = await unCabinetPaie(db, p, "2026-11-20");
      await regler(db, s, "cabinets", true);
      await regler(db, s, "pme", true);

      await passer(db, "2026-11-20");
      assert.deepEqual(await facturesDuTitulaire(db, p.licence), [], "le cabinet paie tout");

      await changer(db, p, "team", "2026-12-10");
      await passer(db, "2026-12-10");
      const base = await prix(db, "solo", "2026-11-20");
      const ecart = (await prix(db, "team", "2026-12-10")) - base;
      const [c, ...autres] = await facturesDuTitulaire(db, p.licence);
      assert.equal(autres.length, 0);
      assert.deepEqual(fenetre(c!), ["complement", "2026-12-10", "2027-01-10", "2026-12-10"]);
      assert.equal(c!.montant_ht, millimes(ecart), "l'écart d'une période entière");
      assert.equal(c!.inclut_la_base, false, "la base reste au cabinet");

      // Le cabinet : décembre, à terme échu, la base seule, au prix public.
      const jan = await passer(db, "2027-01-01");
      assert.equal(jan.cabinets?.etat, "passee");
      const { rows: duCabinet } = await db.query<{
        periode: string;
        montant_ht: string;
        n: number;
      }>(
        `select f.periode::text, f.montant_ht::text,
                (select count(*)::int from facturation.facture_lignes l where l.facture_id = f.id) as n
           from facturation.factures f
          where f.payeur_tenant_id = $1 and f.licence_id is null order by f.periode`,
        [cabinet],
      );
      assert.deepEqual(
        duCabinet.map((f) => [f.periode, f.montant_ht, f.n]),
        [
          ["2026-11-01", millimes((base * 11) / 30), 1],
          ["2026-12-01", millimes(base), 1],
        ],
        "novembre au prorata (passé le 10 décembre), décembre entier : la base seule, rien de la montée",
      );
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 1, "rien pour la PME le 1er");

      await passer(db, "2027-01-10");
      const toutes = await facturesDuTitulaire(db, p.licence);
      assert.deepEqual(fenetre(toutes[1]!), ["base", "2027-01-10", "2027-02-10", "2027-01-10"]);
      assert.equal(toutes[1]!.montant_ht, millimes(ecart));
    });
  });

  it("une PME qui passe au cabinet en cours de période : le cabinet ne reprend qu'après ce qu'elle a payé d'avance", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db, "2026-11-20", "team");
      await regler(db, s, "cabinets", true);
      await regler(db, s, "pme", true);
      await passer(db, "2026-11-20");
      const cabinet = await unCabinetPaie(db, p, "2026-12-05");
      await passer(db, "2026-12-05");
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 1, "aucun complément");

      await passer(db, "2026-12-20");
      await passer(db, "2027-01-01");
      const base = await prix(db, "solo", "2026-12-05");
      const team = await prix(db, "team", "2026-11-20");
      const { rows } = await db.query<{ montant_ht: string; libelle: string }>(
        `select f.montant_ht::text, l.libelle
           from facturation.factures f join facturation.facture_lignes l on l.facture_id = f.id
          where f.payeur_tenant_id = $1 and f.periode = date '2026-12-01'`,
        [cabinet],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.montant_ht, millimes((base * 12) / 31), "du 20 au 31 décembre");
      assert.ok(rows[0]!.libelle.includes("(12/31 jours)"), rows[0]!.libelle);

      const toutes = await facturesDuTitulaire(db, p.licence);
      assert.deepEqual(fenetre(toutes[1]!), ["base", "2026-12-20", "2027-01-20", "2026-12-20"]);
      assert.equal(toutes[1]!.montant_ht, millimes(team - base), "la PME ne paie plus que l'écart");
      assert.equal(toutes[1]!.inclut_la_base, false);
    });
  });

  it("trois passages le même jour : aucun doublon, aucun numéro tiré", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db, "2026-11-20");
      await regler(db, s, "pme", true);
      assert.equal((await passer(db, "2026-11-20")).pme?.etat, "passee");
      assert.equal((await passer(db, "2026-11-20")).pme?.etat, "deja_passee");

      await regler(db, s, "pme", true);
      const { rows: avant } = await db.query<{ n: string }>(
        "select last_value::text as n from facturation.numero_facture_seq",
      );
      const troisieme = await passer(db, "2026-11-20");
      assert.equal(troisieme.pme?.etat, "passee");
      assert.equal(troisieme.pme?.emises, 0);
      assert.ok((troisieme.pme?.deja_emises ?? 0) >= 1);
      const { rows: apres } = await db.query<{ n: string }>(
        "select last_value::text as n from facturation.numero_facture_seq",
      );
      assert.equal(apres[0]!.n, avant[0]!.n);
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 1);
    });
  });

  it("les périmètres sont indépendants : PME coupée, le cabinet facture seul ; et l'inverse", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const seule = await unePme(db, "2026-12-01");
      const p = await unePme(db, "2026-11-20");
      const cabinet = await unCabinetPaie(db, p, "2026-11-20");
      await regler(db, s, "cabinets", true);

      const j1 = await passer(db, "2027-01-01");
      assert.equal(j1.pme?.etat, "coupee");
      assert.equal(j1.cabinets?.etat, "passee");
      assert.deepEqual(await facturesDuTitulaire(db, seule.licence), []);
      const { rows: c1 } = await db.query(
        "select 1 from facturation.factures where payeur_tenant_id = $1",
        [cabinet],
      );
      assert.equal(c1.length, 1);

      await regler(db, s, "cabinets", false);
      await regler(db, s, "pme", true);
      const j2 = await passer(db, "2027-01-02");
      assert.equal(j2.cabinets?.etat, "coupee");
      assert.equal(j2.pme?.etat, "passee");
      assert.deepEqual((await facturesDuTitulaire(db, seule.licence)).map(fenetre), [
        ["base", "2027-01-01", "2027-02-01", "2027-01-02"],
      ]);

      // La tour voit les deux périmètres, chacun sa décision et son passage.
      await enPersonne(db, s.operateur);
      const { rows: etat } = await db.query<{
        r: Record<"cabinets" | "pme", { reglage: { actif: boolean }; dernier: { jour: string } }>;
      }>("select plateforme.facturation_auto_etat() as r");
      assert.equal(etat[0]!.r.cabinets.reglage.actif, false);
      assert.equal(etat[0]!.r.cabinets.dernier.jour, "2027-01-01");
      assert.equal(etat[0]!.r.pme.reglage.actif, true);
      assert.equal(etat[0]!.r.pme.dernier.jour, "2027-01-02");
    });
  });

  it("le jour même, sans le robot : la souscription a sa facture, la montée paie son complément", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await db.query("select set_config('TimeZone', plateforme.fuseau_de_la_plateforme(), true)");
      const { rows: j } = await db.query<{ jour: string }>("select current_date::text as jour");
      const jour = j[0]!.jour;
      await regler(db, s, "pme", true);
      const p = await unePme(db, jour);
      // La validation de la transaction : les déclencheurs différés passent.
      await db.query("set constraints all immediate");
      const [f, ...autres] = await facturesDuTitulaire(db, p.licence);
      assert.equal(autres.length, 0);
      assert.equal(f!.nature, "base");
      assert.equal(f!.couvre_du, jour);
      assert.equal(f!.emise_le, jour);
      await db.query("set constraints all deferred");

      await enPersonne(db, p.titulaire);
      await db.query("select public.forfait_changer('team', $1)", [p.tenant]);
      const { rows: paye } = await db.query<{
        p: { paiement_id: string; montant_ttc: string; etat: string } | null;
      }>("select public.paiement_montee_preparer($1) as p", [p.tenant]);
      const { rows: mes } = await db.query<{ numero: string; montant_ttc: string }>(
        "select numero, montant_ttc::text from public.mes_factures()",
      );
      await db.query("reset role");

      const toutes = await facturesDuTitulaire(db, p.licence);
      assert.deepEqual(
        toutes.map((x) => x.nature),
        ["base", "complement"],
      );
      const { rows: objet } = await db.query<{ objet: string; facture_id: string; ttc: string }>(
        `select objet, facture_id, montant_ttc::text as ttc from facturation.paiements_en_ligne
          where id = $1`,
        [paye[0]!.p!.paiement_id],
      );
      assert.equal(
        objet[0]!.objet,
        "facture",
        "le paiement en ligne paie la facture complémentaire",
      );
      assert.equal(objet[0]!.facture_id, toutes[1]!.id);
      const { rows: acomptes } = await db.query(
        "select 1 from facturation.paiements_en_ligne where licence_id = $1 and objet = 'montee'",
        [p.licence],
      );
      assert.equal(acomptes.length, 0, "aucun acompte de montée, périmètre ouvert");
      assert.equal(mes.length, 2, "la page de paiement voit les deux factures");
      assert.ok(mes.some((m) => m.numero === toutes[1]!.numero && m.montant_ttc === objet[0]!.ttc));
    });
  });

  it("l'année commence à l'échéance suivante, et s'y facture une fois, d'avance", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await db.query("select set_config('TimeZone', plateforme.fuseau_de_la_plateforme(), true)");
      const { rows: j } = await db.query<{ jour: string }>("select current_date::text as jour");
      await regler(db, s, "pme", true);
      const p = await unePme(db, j[0]!.jour);
      await db.query("set constraints all immediate");
      const [premiere] = await facturesDuTitulaire(db, p.licence);
      assert.ok(premiere, "la souscription a sa facture le jour même");

      await enPersonne(db, p.titulaire);
      const { rows: m } = await db.query<{
        r: { ferme: string | null; proposition: { du: string; montant_ht: string } };
      }>("select public.mon_annuel($1) as r", [p.tenant]);
      assert.equal(m[0]!.r.ferme, null);
      assert.equal(m[0]!.r.proposition.du, premiere!.couvre_au, "l'année suit la période payée");
      await db.query("select public.annuel_souscrire($1)", [p.tenant]);
      await db.query("reset role");

      const du = premiere!.couvre_au;
      await passer(db, du);
      const [, annee, ...autres] = await facturesDuTitulaire(db, p.licence);
      assert.equal(autres.length, 0);
      assert.equal(annee!.emise_le, du);
      assert.equal(annee!.couvre_du, du);
      assert.match(annee!.libelle, /^Abonnement annuel solo — du /);
      assert.ok(!annee!.libelle.includes("|"), "une ligne : l'offre du mois est dans l'année");
      assert.equal(annee!.montant_ht, millimes(Number(m[0]!.r.proposition.montant_ht)));

      // L'anniversaire suivant : l'année paie l'offre, rien d'autre n'est dû.
      await passer(db, annee!.couvre_au);
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 2);
    });
  });

  it("seule la plateforme règle les périmètres ; seuls le robot et la base émettent", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db, "2026-11-20");
      const refuse = async (sql: string, args: unknown[], motif: RegExp) => {
        await db.query("savepoint essai");
        await assert.rejects(db.query(sql, args), motif);
        await db.query("rollback to savepoint essai");
      };
      for (const qui of [s.intrus, p.titulaire]) {
        await enPersonne(db, qui);
        await refuse(
          "select plateforme.facturation_auto_regler('pme', true, 1, 'je me facture')",
          [],
          /refus\.reserve\.plateforme$/,
        );
        await refuse(
          "select plateforme.facturation_auto_etat()",
          [],
          /refus\.reserve\.plateforme$/,
        );
        await refuse(
          "select fabrique.facturation_du_jour(date '2026-11-20')",
          [],
          /permission denied/,
        );
        await refuse(
          "select facturation.facturation_du_titulaire($1, date '2026-11-20', 1, $2)",
          [p.licence, qui],
          /permission denied/,
        );
        await refuse(
          "select facturation.facturer_sur_le_champ($1, null)",
          [p.licence],
          /permission denied/,
        );
        await refuse(
          `select facturation.emission_du_titulaire($1, 'base', date '2026-11-20', date '2026-12-20',
                  date '2026-11-20', date '2026-11-20', 1, true, 'solo', null, date '2026-11-20', $2)`,
          [p.licence, qui],
          /permission denied/,
        );
        await refuse(
          "update facturation.factures set nature = 'complement'",
          [],
          /permission denied/,
        );
      }

      await enPersonne(db, s.operateur);
      await refuse(
        "select plateforme.facturation_auto_regler('tout', true, 1, 'un troisième')",
        [],
        /refus\.facturation_auto\.perimetre_inconnu$/,
      );
      await refuse(
        "select fabrique.facturation_des_pme(date '2026-11-20')",
        [],
        /permission denied/,
      );

      await db.query("reset role");
      await db.query("set local role malica_api");
      await refuse(
        "select plateforme.facturation_auto_regler('pme', true, 1, 'le robot s''ouvre')",
        [],
        /permission denied/,
      );
      await db.query("reset role");
      const { rows } = await db.query<{ r: BilanDuJour }>(
        "select fabrique.facturation_du_jour(date '2026-11-20') as r",
      );
      assert.equal(rows[0]!.r.etat, "coupee", "les deux périmètres sont restés coupés");
    });
  });
});
