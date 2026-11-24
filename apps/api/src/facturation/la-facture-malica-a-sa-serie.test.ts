/**
 * La facture de Malica Office : sa série, son impression, son courriel (décision du
 * 23 novembre 2026, migrations 20261231200000 et 20261231210000).
 *
 *   - le numéro suit la série réglée à la tour (`MO-TN-I11-AAAA-000000`), continu dans
 *     l'année, repart à 1 l'année suivante, sans trou ni doublon sous concurrence ;
 *   - les numéros déjà émis ne bougent pas ;
 *   - la facture se lit sous la RLS : son titulaire, l'opérateur — personne d'autre ;
 *   - chaque facture de PME avertit son titulaire (application + courriel) avec tous les
 *     jetons de ses gabarits ; la facture du mois du cabinet part à ses experts, application et
 *     courriel (décision du 24 novembre 2026, 20261231280000) ;
 *   - la tour renvoie le courriel d'une facture : opérateur seul, une fois dans la fenêtre.
 *
 * Sur une vraie base migrée, dans des transactions ANNULÉES, sous les vrais rôles
 * (`authenticated` + claims). Les coordonnées bancaires sont manifestement fausses.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-facture-malica-a-sa-serie.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { facturation } from "../depots/facturation.ts";
import { tour } from "../depots/tour.ts";
import { personnesDEssai } from "../personne-d-essai.ts";
import { courrielDeNotification, type LigneDeCarte } from "../relances/courriel-de-notification.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 3 }) : null;

/** Le jour que le robot facture : un littéral, comme les autres épreuves de la facturation. */
const JOUR = "2026-11-20";
const ANNEE = JOUR.slice(0, 4);

/** Une banque manifestement fausse : jamais une vraie coordonnée dans le dépôt. */
const BANQUE_D_ESSAI = {
  serie: "MO-TN-I11",
  chiffres: 6,
  adresse: "1 rue de l'Essai\n1000 Ville d'essai",
  rne: "RNE-ESSAI-0000",
  site_web: "essai.example",
  conditions_paiement: "Paiement à réception, par virement (essai).",
  banque_titulaire: "TITULAIRE D'ESSAI",
  banque_nom: "BANQUE D'ESSAI",
  banque_agence: "AGENCE D'ESSAI",
  banque_rib: "00 000 0000000000000 00",
  banque_iban: "XX00 0000 0000 0000 0000 0000",
  banque_bic: "ESSAIXXX",
  banque_devise: null,
};

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

async function enAdmin(db: pg.PoolClient): Promise<void> {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
}

/** Un refus attendu, sans perdre la transaction. */
async function refuse(db: pg.PoolClient, promesse: () => Promise<unknown>, motif: RegExp) {
  await db.query("savepoint refus");
  await assert.rejects(promesse(), motif);
  await db.query("rollback to savepoint refus");
}

interface Socle {
  operateur: string;
  intrus: string;
}

async function socle(db: pg.PoolClient): Promise<Socle> {
  const [operateur, intrus] = [randomUUID(), randomUUID()];
  await personnesDEssai(db, operateur, intrus);
  await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
  const { rows } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, legal_id, jurisdiction, currency, adresse)
     values ('pme', 'Emetteur d''essai', null, 'TN', 'TND', 'Adresse de l''organisation')
     returning id`,
  );
  await db.query(
    `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
     values ($1, date '2026-01-01', $2) on conflict (valide_des) do nothing`,
    [rows[0]!.id, operateur],
  );
  return { operateur, intrus };
}

interface Pme {
  titulaire: string;
  tenant: string;
  licence: string;
}

async function unePme(db: pg.PoolClient, nom = "PME facturée"): Promise<Pme> {
  const titulaire = randomUUID();
  await personnesDEssai(db, titulaire);
  await db.query("insert into identity.profiles (user_id, display_name) values ($1, $2)", [
    titulaire,
    "Dirigeante d'essai",
  ]);
  const { rows: o } = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency, adresse)
     values ('pme', $1, 'TN', 'TND', 'Adresse de la PME') returning id`,
    [nom],
  );
  const tenant = o[0]!.id;
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, titulaire],
  );
  const licence = randomUUID();
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
     values ($1, $2, 'solo', $3::date)`,
    [licence, titulaire, JOUR],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, tenant],
  );
  return { titulaire, tenant, licence };
}

/** Le robot facture la PME le `JOUR` ; rend sa facture de base. */
async function facturer(db: pg.PoolClient, s: Socle, p: Pme) {
  await enAdmin(db);
  await db.query("select facturation.facturation_du_titulaire($1, $2::date, 1, $3)", [
    p.licence,
    JOUR,
    s.operateur,
  ]);
  const { rows } = await db.query<{ id: string; numero: string }>(
    `select id, numero from facturation.factures
      where licence_id = $1 and payeur_type = 'titulaire' order by created_at, numero`,
    [p.licence],
  );
  assert.ok(rows[0], "une facture est émise");
  return rows[0];
}

const rang = (numero: string) => Number(numero.slice(numero.lastIndexOf("-") + 1));

describe("la facture de Malica Office", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("le numéro suit la série MO-TN-I11, continu dans l'année", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const a = await facturer(db, s, await unePme(db, "PME A"));
      const b = await facturer(db, s, await unePme(db, "PME B"));
      assert.match(a.numero, new RegExp(`^MO-TN-I11-${ANNEE}-\\d{6}$`));
      assert.match(b.numero, new RegExp(`^MO-TN-I11-${ANNEE}-\\d{6}$`));
      assert.equal(rang(b.numero), rang(a.numero) + 1, "sans trou");
    });
  });

  it("le compteur repart à 1 chaque année et ne se réutilise jamais", async () => {
    await aBlanc(async (db) => {
      const tirer = async (jour: string) =>
        (
          await db.query<{ n: string }>("select facturation.numero_de_facture($1::date) as n", [
            jour,
          ])
        ).rows[0]!.n;
      assert.equal(await tirer("2097-03-01"), "MO-TN-I11-2097-000001");
      assert.equal(await tirer("2097-12-31"), "MO-TN-I11-2097-000002");
      assert.equal(await tirer("2098-01-01"), "MO-TN-I11-2098-000001");
      assert.equal(await tirer("2097-06-30"), "MO-TN-I11-2097-000003");
    });
  });

  it("aucun trou ni doublon quand deux émissions tirent en même temps", async () => {
    const annee = "2096-06-01";
    const [a, b] = [await pool!.connect(), await pool!.connect()];
    const tirer = (db: pg.PoolClient) =>
      db
        .query<{ n: string }>("select facturation.numero_de_facture($1::date) as n", [annee])
        .then((r) => r.rows[0]!.n);
    try {
      // A tire et s'annule : B, qui attendait, prend le MÊME numéro — aucun trou.
      await a.query("begin");
      await b.query("begin");
      const premier = await tirer(a);
      let fini = false;
      const enAttente = tirer(b).then((n) => ((fini = true), n));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(fini, false, "B attend le verrou de A");
      await a.query("rollback");
      assert.equal(await enAttente, premier, "le numéro d'une émission annulée est repris");
      await b.query("rollback");

      // A tire et valide : B, qui attendait, prend le suivant — aucun doublon.
      await a.query("begin");
      await b.query("begin");
      const valide = await tirer(a);
      const suivant = tirer(b);
      await new Promise((r) => setTimeout(r, 100));
      await a.query("commit");
      assert.equal(rang(await suivant), rang(valide) + 1);
      await b.query("rollback");
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      // Le compteur de l'année d'épreuve, validé par A, ne reste pas dans la base.
      await a.query("delete from facturation.compteurs_factures where annee = 2096");
      a.release();
      b.release();
    }
  });

  it("les numéros déjà émis ne bougent pas", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancienne = await facturer(db, s, await unePme(db, "PME d'avant"));
      // Une facture de l'ancienne série, telle que le pilote en porte.
      await db.query("update facturation.factures set numero = $2 where id = $1", [
        ancienne.id,
        "ALG-202611-90001",
      ]);
      const neuve = await facturer(db, s, await unePme(db, "PME d'après"));
      assert.match(neuve.numero, /^MO-TN-I11-/);
      const { rows } = await db.query<{ numero: string }>(
        "select numero from facturation.factures where id = $1",
        [ancienne.id],
      );
      assert.equal(rows[0]!.numero, "ALG-202611-90001");
    });
  });

  it("la tour règle la série et l'impression : opérateur seul, daté, motivé", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db);
      const aujourdhui = (await db.query<{ d: string }>("select current_date::text as d")).rows[0]!
        .d;
      for (const qui of [s.intrus, p.titulaire]) {
        await enPersonne(db, qui);
        await refuse(
          db,
          () => tour.reglerFactures(db, BANQUE_D_ESSAI, aujourdhui, "je règle"),
          /refus\.reserve\.plateforme/,
        );
        assert.equal((await tour.reglageFactures(db)).en_vigueur, null, "rien ne se lit");
      }
      await enPersonne(db, s.operateur);
      await refuse(
        db,
        () => tour.reglerFactures(db, { ...BANQUE_D_ESSAI, serie: "mo tn" }, aujourdhui, "x"),
        /refus\.facturation\.serie_invalide/,
      );
      await refuse(
        db,
        () => tour.reglerFactures(db, { ...BANQUE_D_ESSAI, chiffres: 3 }, aujourdhui, "x"),
        /refus\.facturation\.serie_invalide/,
      );
      await refuse(
        db,
        () => tour.reglerFactures(db, BANQUE_D_ESSAI, "2020-01-01", "x"),
        /refus\.facturation\.reglage_date/,
      );
      await refuse(
        db,
        () => tour.reglerFactures(db, BANQUE_D_ESSAI, aujourdhui, "  "),
        /refus\.motif\.a_dire/,
      );
      await tour.reglerFactures(db, { ...BANQUE_D_ESSAI, serie: "mo-tn-i12" }, aujourdhui, "essai");
      const r = await tour.reglageFactures(db);
      assert.equal((r.en_vigueur as { serie: string } | null)?.serie, "MO-TN-I12");
      assert.equal((r.en_vigueur as { livre: boolean } | null)?.livre, false);

      // Les réglages ne se réécrivent pas (R7).
      await enAdmin(db);
      await refuse(db, () => db.query("update plateforme.reglages_factures set serie = 'X'"), /R7/);
      // La série nouvelle numérote la facture suivante.
      const f = await facturer(db, s, p);
      assert.match(f.numero, new RegExp(`^MO-TN-I12-${ANNEE}-\\d{6}$`));
    });
  });

  it("la facture se lit sous la RLS : son titulaire et l'opérateur, personne d'autre", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db);
      const f = await facturer(db, s, p);
      const aujourdhui = (await db.query<{ d: string }>("select current_date::text as d")).rows[0]!
        .d;
      await enPersonne(db, s.operateur);
      await tour.reglerFactures(db, BANQUE_D_ESSAI, aujourdhui, "Coordonnées d'essai");

      await enAdmin(db);
      const { rows: em } = await db.query<{ nom: string }>(
        `select o.name as nom from facturation.emetteurs e
           join identity.organizations o on o.id = e.organisation_id
          where e.valide_des <= $1::date order by e.valide_des desc limit 1`,
        [JOUR],
      );

      for (const qui of [p.titulaire, s.operateur]) {
        await enPersonne(db, qui);
        const d = await facturation.factureDetail(db, f.id);
        assert.equal(d.numero, f.numero);
        assert.equal(d.client.nom, "PME facturée");
        assert.equal(d.client.adresse, "Adresse de la PME");
        assert.ok(d.lignes.length >= 1, "les lignes");
        assert.equal(d.offre_libelle !== null, true);
        const e = d.entete as {
          emetteur: { nom: string; adresse: string; rne: string } | null;
          banque: { rib: string; iban: string } | null;
          conditions_paiement: string | null;
          exposant: number;
          lettres: Record<string, { majeure: { pluriel: string } }>;
        };
        assert.equal(e.emetteur?.nom, em[0]!.nom);
        assert.equal(e.emetteur?.adresse, BANQUE_D_ESSAI.adresse);
        assert.equal(e.emetteur?.rne, BANQUE_D_ESSAI.rne);
        assert.equal(e.banque?.rib, BANQUE_D_ESSAI.banque_rib);
        assert.equal(e.conditions_paiement, BANQUE_D_ESSAI.conditions_paiement);
        assert.ok(e.exposant >= 0);
        assert.ok(e.lettres["fr"] && e.lettres["en"] && e.lettres["ar"], "fr, en, ar");
      }

      await enAdmin(db);
      const autre = await unePme(db, "Autre PME");
      for (const qui of [s.intrus, autre.titulaire]) {
        await enPersonne(db, qui);
        await refuse(db, () => facturation.factureDetail(db, f.id), /refus\.introuvable\.facture/);
        await refuse(
          db,
          () => db.query("select facturation.entete_de_facture($1)", [f.id]),
          /refus\.introuvable\.facture/,
        );
      }
      await refuse(
        db,
        () => facturation.factureDetail(db, "pas-un-identifiant"),
        /refus\.introuvable\.facture/,
      );
    });
  });

  it("chaque facture de PME avertit son titulaire, avec tous les jetons de ses gabarits", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db);
      const f = await facturer(db, s, p);
      await enAdmin(db);
      const { rows } = await db.query<{
        canal: string;
        decision: string;
        donnees: Record<string, string>;
        titre_rendu: string | null;
        corps_rendu: string | null;
        sujet_cle: string;
      }>(
        `select canal, decision, donnees, titre_rendu, corps_rendu, sujet_cle from notif.envois
          where destinataire = $1 and code = 'facture.emise.pme' order by canal`,
        [p.titulaire],
      );
      assert.deepEqual(
        rows.map((r) => [r.canal, r.decision]),
        [
          ["app", "a_remettre"],
          ["email", "a_remettre"],
        ],
      );
      const email = rows.find((r) => r.canal === "email")!;
      assert.equal(email.sujet_cle, `facture:${f.id}`);
      for (const k of ["numero", "offre", "periode", "ttc", "devise", "echeance"]) {
        assert.ok(email.donnees[k], `jeton ${k}`);
      }
      assert.equal(email.donnees["numero"], f.numero);
      assert.ok(!`${email.titre_rendu} ${email.corps_rendu}`.includes("{{"), "jetons rendus");
      const app = rows.find((r) => r.canal === "app")!;
      assert.ok(!JSON.stringify(app.donnees).includes("{{"), "ligne de l'application rendue");

      // La file la rend au travailleur, avec son bouton vers l'abonnement et sa carte.
      const { rows: file } = await db.query<{
        email: string;
        locale: string;
        titre: string;
        corps: string;
        action_libelle: string;
        action_route: string;
        ton: string;
        code: string;
        organisation: string | null;
        donnees: Record<string, unknown>;
        sujet: string | null;
        libelles: Record<string, string>;
        carte: LigneDeCarte[] | null;
      }>("select * from notif.reserver_courriels(1000000, interval '10 minutes')");
      const c = file.find((x) => x.code === "facture.emise.pme" && x.email.includes(p.titulaire));
      assert.ok(c, "la file rend le courriel de la facture");
      assert.equal(c.action_route, "/pme/reglages?page=abonnement");
      const message = courrielDeNotification({
        locale: c.locale,
        code: c.code,
        titre: c.titre,
        corps: c.corps,
        action: { libelle: c.action_libelle, url: `https://essai.example${c.action_route}` },
        ton: c.ton,
        organisation: c.organisation,
        urlPublique: "https://essai.example",
        libelles: c.libelles,
        donnees: c.donnees,
        sujet: c.sujet,
        carte: c.carte,
      });
      assert.ok(message.sujet.includes(f.numero), message.sujet);
      assert.ok(message.html.includes(f.numero));
      assert.ok(!message.html.includes("{{") && !message.texte.includes("{{"));
      assert.ok(message.html.includes("/pme/reglages?page=abonnement"));
    });
  });

  it("la facture du mois du cabinet part à ses experts, application et courriel", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db);
      const expert = randomUUID();
      await personnesDEssai(db, expert);
      const { rows: c } = await db.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency)
         values ('cabinet', 'Cabinet du mois', 'TN', 'TND') returning id`,
      );
      const cabinet = c[0]!.id;
      await db.query(
        "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')",
        [cabinet, expert],
      );
      await db.query(
        `insert into identity.engagements (pme_org_id, cabinet_org_id, status, starts_on)
         values ($1, $2, 'actif', date '2026-11-01')`,
        [p.tenant, cabinet],
      );
      await db.query(
        `insert into facturation.acces
           (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
            propose_le, propose_par, repondu_le, repondu_par, effet_du)
         values ($1, $2, 'cabinet', $3, 'team', date '2026-11-01', 'actif', date '2026-11-01',
                 $4, date '2026-11-01', $5, date '2026-11-01')`,
        [p.tenant, p.licence, cabinet, expert, p.titulaire],
      );
      const { rows: e } = await db.query<{ r: { facture_id: string; numero: string } }>(
        "select facturation.emission_du_cabinet($1, date '2026-11-01', $2) as r",
        [cabinet, s.operateur],
      );
      const facture = e[0]!.r;
      assert.match(facture.numero, /^MO-TN-I11-\d{4}-\d{6}$/, "la même série");
      const { rows: envois } = await db.query<{ code: string; canal: string }>(
        `select code, canal from notif.envois
          where destinataire = $1 and code like 'facture.%' order by code, canal`,
        [expert],
      );
      assert.deepEqual(
        envois.map((x) => [x.code, x.canal]),
        [
          ["facture.emise.cabinet", "app"],
          ["facture.emise.cabinet", "email"],
        ],
        "l'application et le courriel, sous le genre du cabinet",
      );

      // Le courriel se rend sans jeton orphelin, son bouton mène à la facturation du cabinet.
      const { rows: file } = await db.query<{
        email: string;
        locale: string;
        titre: string;
        corps: string;
        action_libelle: string;
        action_route: string;
        ton: string;
        code: string;
        organisation: string | null;
        donnees: Record<string, unknown>;
        sujet: string | null;
        libelles: Record<string, string>;
        carte: LigneDeCarte[] | null;
      }>("select * from notif.reserver_courriels(1000000, interval '10 minutes')");
      const courriel = file.find(
        (x) => x.code === "facture.emise.cabinet" && x.email.includes(expert),
      );
      assert.ok(courriel, "la file rend le courriel de la facture du mois");
      assert.equal(courriel.action_route, "/cabinet/clients?vue=facturation");
      const message = courrielDeNotification({
        locale: courriel.locale,
        code: courriel.code,
        titre: courriel.titre,
        corps: courriel.corps,
        action: {
          libelle: courriel.action_libelle,
          url: `https://essai.example${courriel.action_route}`,
        },
        ton: courriel.ton,
        organisation: courriel.organisation,
        urlPublique: "https://essai.example",
        libelles: courriel.libelles,
        donnees: courriel.donnees,
        sujet: courriel.sujet,
        carte: courriel.carte,
      });
      assert.ok(message.sujet.includes(facture.numero), message.sujet);
      assert.ok(!message.html.includes("{{") && !message.texte.includes("{{"), message.texte);
      assert.ok(message.texte.includes("virement"), message.texte);

      // Le renvoi n'est pas pour elle.
      await enPersonne(db, s.operateur);
      await refuse(
        db,
        () => tour.renvoyerFacture(db, facture.facture_id, "essai"),
        /refus\.facturation\.renvoi_pme_seulement/,
      );
    });
  });

  it("la tour renvoie le courriel d'une facture : opérateur seul, une fois dans la fenêtre", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const p = await unePme(db);
      // Le courriel est fermé à l'émission, comme les factures émises avant ce courriel.
      await db.query(
        `insert into notif.preferences (user_id, email_actif) values ($1, false)
         on conflict (user_id) do update set email_actif = false`,
        [p.titulaire],
      );
      const f = await facturer(db, s, p);
      await db.query("update notif.preferences set email_actif = true where user_id = $1", [
        p.titulaire,
      ]);
      const courriels = async () =>
        (
          await db.query<{ decision: string }>(
            `select decision from notif.envois where destinataire = $1
                and code = 'facture.emise.pme' and canal = 'email' order by cree_le`,
            [p.titulaire],
          )
        ).rows.map((r) => r.decision);
      const lignesApp = async () =>
        (
          await db.query(
            `select 1 from notif.envois where destinataire = $1
                and code = 'facture.emise.pme' and canal = 'app'`,
            [p.titulaire],
          )
        ).rows.length;
      assert.deepEqual(await courriels(), ["abandonne"]);

      for (const qui of [s.intrus, p.titulaire]) {
        await enPersonne(db, qui);
        await refuse(
          db,
          () => tour.renvoyerFacture(db, f.id, "je me renvoie"),
          /refus\.reserve\.plateforme/,
        );
      }
      await enPersonne(db, s.operateur);
      await refuse(db, () => tour.renvoyerFacture(db, f.id, " "), /refus\.saisie\.mal_formee/);
      const premier = (await tour.renvoyerFacture(db, f.id, "Courriel manqué")) as {
        deja: boolean;
        poste: boolean;
        numero: string;
      };
      assert.deepEqual(
        [premier.deja, premier.poste, premier.numero],
        [false, true, f.numero],
        JSON.stringify(premier),
      );
      const second = (await tour.renvoyerFacture(db, f.id, "Second clic")) as { deja: boolean };
      assert.equal(second.deja, true, "une fois dans la fenêtre");

      await enAdmin(db);
      assert.deepEqual(await courriels(), ["abandonne", "a_remettre"]);
      assert.equal(await lignesApp(), 2, "l'émission, puis le seul renvoi effectif");
      const { rows: j } = await db.query<{ n: number }>(
        `select count(*)::int as n from audit.event_log
          where action = 'facture.renvoyee' and object_id = $1`,
        [f.id],
      );
      assert.equal(j[0]!.n, 1, "le renvoi se trace au journal");
    });
  });
});
