/**
 * La facture part chaque jour (décisions du dirigeant, 4 novembre 2026).
 *
 * Depuis 20261128090000, deux périmètres : les cabinets au mois, à terme
 * échu (ce que ce fichier éprouvait d'abord, inchangé), et les PME d'avance,
 * à leur date anniversaire (éprouvées en détail dans
 * `la-pme-paie-d-avance-a-sa-date-anniversaire.test.ts`). Le titulaire monté
 * ici n'est plus facturé au mois clos : il l'est pour sa période en cours.
 *
 * Le robot de l'API (`tourDeFacturation`) passe sous le VRAI rôle de l'API
 * (`malica_api`), l'opérateur et l'intrus sous `authenticated` avec leurs
 * claims, sur une vraie base migrée. Tout se passe dans une transaction
 * ANNULÉE : le passage examine toutes les licences de la base, et les
 * factures qu'il émettrait pour les fixtures des autres épreuves ne doivent
 * pas leur survivre. Les assertions ne portent donc que sur les payeurs
 * montés ici.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-facture-part-chaque-jour.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { personnesDEssai } from "../personne-d-essai.ts";

import { tourDeFacturation, type BilanDuJour } from "./demarrer-la-facturation.ts";

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

/** Une personne connectée : `authenticated`, son `sub`. */
async function enPersonne(db: pg.PoolClient, id: string): Promise<void> {
  await db.query("reset role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
}

/** Le travailleur de l'API : son rôle de connexion, sans claims. */
async function enApi(db: pg.PoolClient): Promise<void> {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
  await db.query("set local role malica_api");
}

/** Le tour du travailleur, dans cette transaction. */
async function tour(db: pg.PoolClient): Promise<BilanDuJour | null> {
  await enApi(db);
  return tourDeFacturation((travail) => travail(db));
}

interface Monde {
  operateur: string;
  intrus: string;
  /** Le jour de la plateforme, et le premier du mois qui vient de se clore. */
  jour: string;
  mois: string;
  /** Une licence née le 20 du mois clos : son titulaire paie au prorata. */
  licence: string;
  depuis: string;
  /** Un cabinet qui paie, depuis le 22 du mois clos, l'abonnement d'une PME. */
  cabinet: string;
  licenceDuCabinet: string;
  depuisCabinet: string;
}

async function monter(db: pg.PoolClient): Promise<Monde> {
  const [operateur, intrus, titulaire, titulaire2, expert] = [1, 2, 3, 4, 5].map(() =>
    randomUUID(),
  ) as [string, string, string, string, string];
  await personnesDEssai(db, operateur, intrus, titulaire, titulaire2, expert);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  await db.query(
    `insert into identity.profiles (user_id, display_name) values ($1, 'Selim Ben Amor'),
            ($2, 'Amira Trabelsi')`,
    [titulaire, titulaire2],
  );
  // L'émetteur : sans lui, ni jour de la plateforme ni facture. Son fuseau est
  // celui de sa juridiction (TN).
  const { rows: em } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Emetteur d''essai', 'TN', 'TND') returning id`,
  );
  await db.query(
    `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
     values ($1, date '2026-01-01', $2) on conflict (valide_des) do nothing`,
    [em[0]!.id, operateur],
  );
  const { rows: j } = await db.query<{ jour: string; mois: string; depuis: string; cab: string }>(
    `with j as (select (now() at time zone plateforme.fuseau_de_la_plateforme())::date as jour)
     select j.jour::text,
            (date_trunc('month', j.jour) - interval '1 month')::date::text as mois,
            (date_trunc('month', j.jour) - interval '1 month' + interval '19 days')::date::text as depuis,
            (date_trunc('month', j.jour) - interval '1 month' + interval '21 days')::date::text as cab
       from j`,
  );
  const { jour, mois, depuis, cab: depuisCabinet } = j[0]!;

  const org = async (kind: string, nom: string) =>
    (
      await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency)
         values ($1, $2, 'TN', 'TND') returning id`,
        [kind, nom],
      )
    ).rows[0]!.id;

  // La licence d'un titulaire, née le 20 du mois clos (la grille date du 19 octobre 2026).
  const licence = randomUUID();
  const pme = await org("pme", "PME facturée chaque jour");
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [pme, titulaire],
  );
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
     values ($1, $2, 'solo', $3::date)`,
    [licence, titulaire, depuis],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, pme],
  );

  // Le cabinet paie l'abonnement d'une PME depuis le 22 du mois clos.
  const cabinet = await org("cabinet", "Cabinet facturé chaque mois");
  const pme2 = await org("pme", "PME du cabinet");
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [pme2, titulaire2],
  );
  await db.query(
    `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on)
     values ($1, $2, 'actif', $3::date)`,
    [pme2, cabinet, depuisCabinet],
  );
  const licenceDuCabinet = randomUUID();
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
     values ($1, $2, 'solo', $3::date)`,
    [licenceDuCabinet, titulaire2, depuisCabinet],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licenceDuCabinet, pme2],
  );
  await db.query(
    `insert into facturation.acces
       (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
        propose_le, propose_par, repondu_le, repondu_par, effet_du)
     values ($1, $2, 'cabinet', $3, 'solo', $4::date, 'actif', $4::date, $5, $4::date, $6, $4::date)`,
    [pme2, licenceDuCabinet, cabinet, depuisCabinet, expert, titulaire2],
  );
  return {
    operateur,
    intrus,
    jour,
    mois,
    licence,
    depuis,
    cabinet,
    licenceDuCabinet,
    depuisCabinet,
  };
}

/** La tour ouvre (ou coupe) un périmètre — les deux par défaut —, sous l'opérateur. */
async function regler(
  db: pg.PoolClient,
  m: Monde,
  actif: boolean,
  rattrapage = 1,
  perimetres: Array<"cabinets" | "pme"> = ["cabinets", "pme"],
) {
  await enPersonne(db, m.operateur);
  for (const perimetre of perimetres) {
    await db.query("select plateforme.facturation_auto_regler($1, $2, $3, $4)", [
      perimetre,
      actif,
      rattrapage,
      "Staging : essai de l'émission automatique",
    ]);
  }
}

/** Les compteurs des deux périmètres, additionnés. */
const somme = (b: BilanDuJour | null, cle: "emises" | "deja_emises") =>
  (b?.cabinets?.[cle] ?? 0) + (b?.pme?.[cle] ?? 0);

/** Les factures d'un payeur, lues en administrateur. */
async function facturesDe(db: pg.PoolClient, where: string, arg: string) {
  await db.query("reset role");
  const { rows } = await db.query<{
    id: string;
    periode: string;
    emise_le: string;
    montant_ht: string;
    payeur_type: string;
    libelle: string;
    lignes: number;
  }>(
    `select f.id, f.periode::text, f.emise_le::text, f.montant_ht::text, f.payeur_type,
            (select string_agg(l.libelle, ' | ' order by l.ordinal)
               from facturation.facture_lignes l where l.facture_id = f.id) as libelle,
            (select count(*)::int from facturation.facture_lignes l where l.facture_id = f.id) as lignes
       from facturation.factures f where ${where} = $1 and f.avoir_de is null
      order by f.periode`,
    [arg],
  );
  return rows;
}

/** Le prorata attendu, recalculé ici : le prix de l'offre × jours / jours du mois. */
async function prorata(db: pg.PoolClient, offre: string, depuis: string, mois: string) {
  await db.query("reset role");
  const { rows } = await db.query<{ ht: string; jours: number; jdm: number }>(
    `select round((ref.offre_a($1, $2::date)).prix_mensuel_ht
                  * (($3::date + interval '1 month')::date - $2::date)
                  / (($3::date + interval '1 month')::date - $3::date), 3)::text as ht,
            (($3::date + interval '1 month')::date - $2::date) as jours,
            (($3::date + interval '1 month')::date - $3::date) as jdm`,
    [offre, depuis, mois],
  );
  return rows[0]!;
}

describe("la facture part chaque jour", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("coupée par la tour : rien ne part, rien ne s'inscrit", async () => {
    await aBlanc(async (db) => {
      const m = await monter(db);
      assert.equal(await tour(db), null, "le travailleur ne lit même pas le jour");
      const { rows } = await db.query<{ r: { etat: string } }>(
        "select fabrique.facturation_du_jour($1::date) as r",
        [m.jour],
      );
      assert.equal(rows[0]!.r.etat, "coupee", "appelée quand même, la base refuse de travailler");
      assert.deepEqual(await facturesDe(db, "f.licence_id", m.licence), []);
      assert.deepEqual(await facturesDe(db, "f.payeur_tenant_id", m.cabinet), []);
      const { rows: passages } = await db.query(
        "select 1 from fabrique.facturations_du_jour where jour = $1::date",
        [m.jour],
      );
      assert.equal(passages.length, 0, "une émission coupée ne fait pas de bruit");
    });
  });

  it("ouverte : le cabinet a son mois clos au prorata, le titulaire sa période en cours d'avance", async () => {
    await aBlanc(async (db) => {
      const m = await monter(db);
      await regler(db, m, true);
      const bilan = await tour(db);
      assert.equal(bilan?.etat, "passee");
      assert.equal(bilan?.jour, m.jour, "le jour passé est celui de la plateforme");
      assert.equal(bilan?.cabinets?.etat, "passee");
      assert.equal(bilan?.pme?.etat, "passee");

      // Le titulaire (décision B) : une facture, d'avance, pour la période
      // anniversaire qui contient le jour — né le 20, facturé du 20 au 20 —, au
      // prix plein, sans prorata.
      await db.query("reset role");
      const { rows: e } = await db.query<{ debut: string; ht: string }>(
        `select to_char(e.debut, 'DD/MM/YYYY') as debut,
                (ref.offre_a('solo', $1::date)).prix_mensuel_ht::text as ht
           from facturation.echeance_de($1::date, $2::date) e`,
        [m.depuis, m.jour],
      );
      const [f, ...autres] = await facturesDe(db, "f.licence_id", m.licence);
      assert.equal(autres.length, 0, "une facture pour la période en cours");
      assert.equal(f!.payeur_type, "titulaire");
      assert.equal(f!.montant_ht, e[0]!.ht);
      assert.ok(f!.libelle.includes(`du ${e[0]!.debut} au `), f!.libelle);
      assert.equal(f!.emise_le, m.jour, "datée du jour de la plateforme, pas de l'UTC");

      // Le cabinet : sa facture mensuelle unique, une ligne au prorata depuis le 22 ;
      // la licence qu'il paie entièrement n'a pas de facture de titulaire.
      const duCabinet = await prorata(db, "solo", m.depuisCabinet, m.mois);
      const [c, ...autresC] = await facturesDe(db, "f.payeur_tenant_id", m.cabinet);
      assert.equal(autresC.length, 0);
      assert.equal(c!.periode, m.mois);
      assert.equal(c!.lignes, 1);
      assert.equal(c!.montant_ht, duCabinet.ht);
      assert.deepEqual(await facturesDe(db, "f.licence_id", m.licenceDuCabinet), []);

      // Chaque facture au journal, l'opérateur qui a ouvert pour acteur.
      const { rows: journal } = await db.query<{ actor: string; object_id: string }>(
        `select actor, object_id from audit.event_log
          where action = 'facture.emise' and object_id = any($1::uuid[])`,
        [[f!.id, c!.id]],
      );
      assert.equal(journal.length, 2);
      assert.ok(journal.every((e) => e.actor === m.operateur));

      // La tour lit, pour chaque périmètre, la décision, qui l'a prise, et le dernier passage.
      await enPersonne(db, m.operateur);
      type Etat = {
        reglage: { actif: boolean; decide_par_email: string };
        dernier: { jour: string; emises: number };
      };
      const { rows: etat } = await db.query<{ r: { cabinets: Etat; pme: Etat } }>(
        "select plateforme.facturation_auto_etat() as r",
      );
      for (const p of [etat[0]!.r.cabinets, etat[0]!.r.pme]) {
        assert.equal(p.reglage.actif, true);
        assert.equal(p.reglage.decide_par_email, `essai-${m.operateur}@essai.local`);
        assert.equal(p.dernier.jour, m.jour);
        assert.ok(p.dernier.emises >= 1);
      }
    });
  });

  it("trois passages le même jour n'émettent rien de neuf, et ne tirent aucun numéro", async () => {
    await aBlanc(async (db) => {
      const m = await monter(db);
      await regler(db, m, true);
      const premier = await tour(db);
      assert.equal(premier?.etat, "passee");

      // Le même jour, sous la même décision : la base ne refait rien.
      const deuxieme = await tour(db);
      assert.equal(deuxieme?.etat, "deja_passee");

      // Redire « ouverte » relance le jour : tout est déjà facturé.
      await regler(db, m, true);
      await db.query("reset role");
      const { rows: avant } = await db.query<{ n: string }>(
        "select last_value::text as n from facturation.numero_facture_seq",
      );
      const troisieme = await tour(db);
      assert.equal(troisieme?.etat, "passee");
      assert.equal(somme(troisieme, "emises"), 0, "rien de neuf");
      assert.ok(somme(troisieme, "deja_emises") >= 2, "le titulaire et le cabinet sont comptés");
      await db.query("reset role");
      const { rows: apres } = await db.query<{ n: string }>(
        "select last_value::text as n from facturation.numero_facture_seq",
      );
      assert.equal(apres[0]!.n, avant[0]!.n, "un mois déjà facturé est sauté avant tout numéro");
      assert.equal((await facturesDe(db, "f.licence_id", m.licence)).length, 1);
      assert.equal((await facturesDe(db, "f.payeur_tenant_id", m.cabinet)).length, 1);
    });
  });

  it("le rattrapage facture au cabinet les mois clos jamais facturés, dans la fenêtre réglée", async () => {
    await aBlanc(async (db) => {
      // La grille ne commence qu'en octobre 2026 : plutôt qu'un cabinet qui
      // paie avant elle, la base passe un jour DEUX MOIS plus tard. Le cabinet
      // qui paie depuis le 22 du mois clos a alors trois mois clos : le sien
      // et les deux suivants. (Le rattrapage des PME compte des échéances :
      // `la-pme-paie-d-avance-a-sa-date-anniversaire.test.ts`.)
      const m = await monter(db);
      await db.query("reset role");
      const { rows: d } = await db.query<{ jour: string; avant: string; dernier: string }>(
        `select ($1::date + interval '2 months')::date::text as jour,
                ($2::date + interval '1 month')::date::text as avant,
                ($2::date + interval '2 months')::date::text as dernier`,
        [m.jour, m.mois],
      );
      const { jour, avant, dernier } = d[0]!;
      const passer = async () => {
        await enApi(db);
        const { rows } = await db.query<{ r: BilanDuJour }>(
          "select fabrique.facturation_du_jour($1::date) as r",
          [jour],
        );
        return rows[0]!.r;
      };

      // Un mois de rattrapage : le dernier mois clos seulement, au plein mois.
      await regler(db, m, true, 1, ["cabinets"]);
      assert.equal((await passer()).etat, "passee");
      assert.deepEqual(
        (await facturesDe(db, "f.payeur_tenant_id", m.cabinet)).map((f) => f.periode),
        [dernier],
      );

      // Trois : les deux mois plus anciens partent, le premier au prorata ; le
      // dernier, déjà facturé, ne repart pas.
      await regler(db, m, true, 3, ["cabinets"]);
      assert.equal((await passer()).etat, "passee");
      const factures = await facturesDe(db, "f.payeur_tenant_id", m.cabinet);
      assert.deepEqual(
        factures.map((f) => f.periode),
        [m.mois, avant, dernier],
      );
      assert.equal(
        factures[0]!.montant_ht,
        (await prorata(db, "solo", m.depuisCabinet, m.mois)).ht,
      );
      assert.equal(
        factures[1]!.montant_ht,
        (await prorata(db, "solo", avant, avant)).ht,
        "un mois entier, au prix plein",
      );
      assert.deepEqual(
        await facturesDe(db, "f.licence_id", m.licence),
        [],
        "le périmètre PME est resté coupé : le titulaire n'a rien",
      );
    });
  });

  it("seule la plateforme règle l'émission, et seule l'API la fait passer", async () => {
    await aBlanc(async (db) => {
      const m = await monter(db);
      const refuse = async (sql: string, args: unknown[], motif: RegExp) => {
        await db.query("savepoint essai");
        await assert.rejects(db.query(sql, args), motif);
        await db.query("rollback to savepoint essai");
      };
      await enPersonne(db, m.intrus);
      await refuse(
        "select plateforme.facturation_auto_regler('cabinets', true, 1, 'je me facture')",
        [],
        /refus\.reserve\.plateforme$/,
      );
      await refuse("select plateforme.facturation_auto_etat()", [], /refus\.reserve\.plateforme$/);
      await refuse("select fabrique.facturation_du_jour($1::date)", [m.jour], /permission denied/);
      await refuse(
        "select facturation.emission_de_la_licence($1, $2::date)",
        [m.licence, m.mois],
        /permission denied/,
      );
      await refuse(
        "select facturation.emettre($1, $2::date)",
        [m.licence, m.mois],
        /refus\.reserve\.plateforme$/,
      );

      // L'opérateur règle, mais ne fait pas passer le robot à sa place.
      await enPersonne(db, m.operateur);
      await refuse(
        "select plateforme.facturation_auto_regler('cabinets', true, 0, 'aucun mois')",
        [],
        /refus\.facturation_auto\.rattrapage_hors_bornes$/,
      );
      await refuse(
        "select plateforme.facturation_auto_regler('pme', true, 1, '  ')",
        [],
        /refus\.saisie\.incomplete$/,
      );
      await refuse("select fabrique.facturation_du_jour($1::date)", [m.jour], /permission denied/);
      await refuse(
        "select facturation.emission_du_cabinet($1, $2::date, $3)",
        [m.cabinet, m.mois, m.operateur],
        /permission denied/,
      );

      // L'API fait passer le robot, mais ne règle pas l'interrupteur.
      await enApi(db);
      await refuse(
        "select plateforme.facturation_auto_regler('cabinets', true, 1, 'le robot s''ouvre')",
        [],
        /permission denied/,
      );
      await refuse(
        "update plateforme.reglages_facturation_auto set actif = true",
        [],
        /permission denied/,
      );

      // Rien n'a été émis, et l'interrupteur est resté coupé.
      await db.query("reset role");
      const { rows } = await db.query<{ r: { etat: string } }>(
        "select fabrique.facturation_du_jour($1::date) as r",
        [m.jour],
      );
      assert.equal(rows[0]!.r.etat, "coupee");
    });
  });
});
