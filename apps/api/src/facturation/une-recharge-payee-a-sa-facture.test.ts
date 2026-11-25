/**
 * Une recharge payée a sa facture, au paiement (revue du 25 novembre 2026, R-04 ; D7).
 *
 * Avant : l'argent d'une recharge attendait la prochaine facture de base du titulaire. Quand
 * une comptabilité paie toute la licence, cette facture n'existe pas : de l'argent encaissé
 * sans facture. Désormais la facture naît du paiement, réglée, au millime du paiement, quel
 * que soit le payeur de l'abonnement ; une recharge déjà portée par une base ne se paie plus
 * à part ; et un second lien payé pour un même paiement se trace en trop-perçu (8.3).
 *
 *   cd apps/api && node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/une-recharge-payee-a-sa-facture.test.ts
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import {
  ADMIN,
  pool,
  aBlanc,
  enPersonne,
  socle,
  regler,
  unePme,
  facturesDuTitulaire,
  jourDe,
  payerLesDus,
  resteDu,
} from "./decor-d-avance.ts";
import {
  couvreDepuisLeDebutDuMois,
  decor,
  ouvrirLePerimetrePme,
  payerEnLigne,
  uneComptabilite,
} from "./decor-de-facture.ts";

interface PaiementLu {
  paiement_id: string;
  etat: string;
  montant_ht: string;
  montant_tva: string;
  montant_ttc: string;
}

/** Le plus petit palier de la grille : aucune quantité n'est écrite ici. */
async function palier(db: pg.PoolClient): Promise<{ code: string; lectures: number }> {
  const { rows } = await db.query<{ code: string; lectures: number }>(
    `select code, lectures from ref.recharges
      where effective_from <= current_date order by rang, effective_from desc limit 1`,
  );
  return rows[0]!;
}

/** Le titulaire achète une recharge et en prépare le paiement. */
async function acheter(
  db: pg.PoolClient,
  titulaire: string,
  tenant: string,
): Promise<{ recharge: string; paiement: PaiementLu }> {
  const { code } = await palier(db);
  await enPersonne(db, titulaire);
  const { rows: r } = await db.query<{ r: { recharge_id: string } }>(
    "select public.recharge_acheter($1, $2) as r",
    [code, tenant],
  );
  const recharge = r[0]!.r.recharge_id;
  const { rows: p } = await db.query<{ p: PaiementLu }>(
    "select public.paiement_recharge_preparer($1) as p",
    [recharge],
  );
  await db.query("reset role");
  return { recharge, paiement: p[0]!.p };
}

async function facturesDeRecharge(db: pg.PoolClient, licence: string) {
  const { rows } = await db.query<{
    id: string;
    numero: string;
    payeur_type: string;
    montant_ht: string;
    montant_tva: string;
    timbre: string;
    montant_ttc: string;
    libelle: string;
  }>(
    `select f.id, f.numero, f.payeur_type, f.montant_ht::text, f.montant_tva::text,
            f.timbre::text, f.montant_ttc::text, l.libelle
       from facturation.factures f
       join facturation.facture_lignes l on l.facture_id = f.id
      where f.licence_id = $1 and f.nature = 'recharge'
      order by f.created_at`,
    [licence],
  );
  return rows;
}

describe("une recharge payée a sa facture", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("payée en ligne : sa facture naît réglée, au millime du paiement, timbre compris, et le dit", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      const p = await unePme(db, await jourDe(db, -3));
      await db.query("set constraints all immediate");
      await payerLesDus(db);

      const { recharge, paiement } = await acheter(db, p.titulaire, p.tenant);
      const { rows: f } = await db.query<{ ttc: { timbre: string; ttc: string } }>(
        "select public.prix_ttc($1::numeric) as ttc",
        [paiement.montant_ht],
      );
      assert.ok(Number(f[0]!.ttc.timbre) > 0, "le timbre de la fiscalité en vigueur");
      assert.equal(
        Number(paiement.montant_ttc),
        Number(f[0]!.ttc.ttc),
        "le paiement porte le timbre",
      );
      assert.deepEqual(await facturesDeRecharge(db, p.licence), [], "rien avant le paiement");

      await payerEnLigne(db, p.titulaire, paiement.paiement_id);
      const [facture, ...autres] = await facturesDeRecharge(db, p.licence);
      assert.equal(autres.length, 0);
      assert.equal(facture!.payeur_type, "titulaire");
      assert.equal(
        Number(facture!.montant_ttc),
        Number(paiement.montant_ttc),
        "facture = paiement",
      );
      assert.equal(Number(facture!.montant_ht), Number(paiement.montant_ht));
      assert.equal(Number(facture!.montant_tva), Number(paiement.montant_tva));
      assert.match(facture!.numero, /^MO-TN-I11-\d{4}-\d{6}$/, "sous la série Malica");
      assert.match(facture!.libelle, /^Recharge \d+ lectures — \d{2}\/\d{2}\/\d{4}$/);
      assert.equal(await resteDu(db, facture!.id), 0, "née réglée");
      const { rows: lien } = await db.query(
        "select 1 from facturation.facture_recharges where facture_id = $1 and recharge_id = $2",
        [facture!.id, recharge],
      );
      assert.equal(lien.length, 1);

      // Son avis : la recharge, réglée, en application et par courriel, jetons rendus.
      const { rows: avis } = await db.query<{
        canal: string;
        donnees: Record<string, string>;
        titre_rendu: string | null;
        corps_rendu: string | null;
      }>(
        `select canal, donnees, titre_rendu, corps_rendu from notif.envois
          where destinataire = $1 and code = 'facture.recharge.pme' order by canal`,
        [p.titulaire],
      );
      assert.deepEqual(
        avis.map((a) => a.canal),
        ["app", "email"],
      );
      const { lectures } = await palier(db);
      for (const a of avis) {
        assert.equal(a.donnees["numero"], facture!.numero);
        assert.equal(a.donnees["lectures"], String(lectures));
      }
      const email = avis.find((a) => a.canal === "email")!;
      assert.ok(!`${email.titre_rendu} ${email.corps_rendu}`.includes("{{"), "jetons rendus");
      const { rows: autresAvis } = await db.query(
        `select 1 from notif.envois where destinataire = $1
            and code in ('facture.emise.pme', 'facture.reglee.pme')
            and sujet_cle = 'facture:' || $2`,
        [p.titulaire, facture!.id],
      );
      assert.equal(autresAvis.length, 0, "une facture, un avis");
    });
  });

  it("la comptabilité paie toute la licence : la recharge payée par la PME a quand même sa facture (R-04)", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo");
      const c = await uneComptabilite(db, d);
      await couvreDepuisLeDebutDuMois(db, d, c, "solo");
      await ouvrirLePerimetrePme(db, d);
      await db.query("set constraints all immediate");
      await db.query("set constraints all deferred");

      const { paiement } = await acheter(db, d.titulaire, d.tenant);
      await payerEnLigne(db, d.titulaire, paiement.paiement_id);
      await db.query("set constraints all immediate");
      const [facture, ...autres] = await facturesDeRecharge(db, d.licence);
      assert.equal(autres.length, 0, "une facture, celle de la recharge");
      assert.equal(facture!.payeur_type, "titulaire", "la PME paie sa consommation");
      assert.equal(Number(facture!.montant_ttc), Number(paiement.montant_ttc));
      assert.equal(await resteDu(db, facture!.id), 0);
    });
  });

  it("une recharge déjà portée par la facture de base ne se paie plus à part", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      const p = await unePme(db, await jourDe(db));
      // Achetée avant que l'échéance ne soit payée : la demande due la compte.
      const { paiement } = await acheter(db, p.titulaire, p.tenant);
      await db.query("set constraints all immediate");
      await payerLesDus(db);
      const [base] = await facturesDuTitulaire(db, p.licence);
      assert.ok(base, "l'échéance payée a sa facture");
      const { rows: lignes } = await db.query<{ libelle: string }>(
        "select libelle from facturation.facture_lignes where facture_id = $1 order by ordinal",
        [base!.id],
      );
      assert.ok(
        lignes.some((l) => l.libelle.startsWith("Recharge ")),
        "la recharge est sur la base",
      );
      assert.equal(
        await resteDu(db, base!.id),
        0,
        "la facture vaut le paiement, recharge comprise",
      );

      const { rows: v } = await db.query<{ etat: string }>(
        "select etat from facturation.paiements_en_ligne_v where paiement_id = $1",
        [paiement.paiement_id],
      );
      assert.equal(v[0]!.etat, "remplace", "son paiement à part est remplacé : jamais deux fois");
      assert.deepEqual(await facturesDeRecharge(db, p.licence), []);
    });
  });

  it("une recharge rechiffre l'échéance due ; payée à part, elle en sort : jamais deux fois", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      const p = await unePme(db, await jourDe(db));
      await db.query("set constraints all immediate");
      await db.query("set constraints all deferred");
      const due = async () =>
        (
          await db.query<{ paiement_id: string; montant_ttc: string }>(
            "select paiement_id, montant_ttc::text from facturation.demande_due_ouverte($1)",
            [p.licence],
          )
        ).rows[0]!;
      const sans = await due();
      assert.ok(sans.paiement_id, "l'échéance est due");
      // Achetée pendant que l'échéance est due : la demande se rechiffre, recharge comprise.
      const { paiement } = await acheter(db, p.titulaire, p.tenant);
      const avant = await due();
      assert.notEqual(avant.paiement_id, sans.paiement_id);
      assert.ok(Number(avant.montant_ttc) > Number(sans.montant_ttc), "recharge comprise");

      await payerEnLigne(db, p.titulaire, paiement.paiement_id);
      const apres = await due();
      assert.notEqual(apres.paiement_id, avant.paiement_id, "une demande neuve");
      assert.ok(
        Number(apres.montant_ttc) === Number(sans.montant_ttc),
        "sans la recharge déjà payée",
      );
      await db.query("set constraints all immediate");
      await payerLesDus(db);
      const [base] = await facturesDuTitulaire(db, p.licence);
      assert.equal(await resteDu(db, base!.id), 0);
      const { rows: trop } = await db.query(
        "select 1 from audit.event_log where action = 'paiement.trop_percu' and tenant_id = $1",
        [p.tenant],
      );
      assert.equal(trop.length, 0, "rien de payé deux fois");
    });
  });

  it("un second lien payé pour le même paiement se trace en trop-perçu à rembourser (8.3)", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      const p = await unePme(db, await jourDe(db, -3));
      await db.query("set constraints all immediate");
      await payerLesDus(db);
      const { paiement } = await acheter(db, p.titulaire, p.tenant);
      await payerEnLigne(db, p.titulaire, paiement.paiement_id, "T1");
      await payerEnLigne(db, p.titulaire, paiement.paiement_id, "T2");
      // Le même avis rejoué (T2 encore) ne se trace pas deux fois.
      await payerEnLigne(db, p.titulaire, paiement.paiement_id, "T2");
      const { rows } = await db.query<{ payload: Record<string, string> }>(
        `select payload from audit.event_log
          where action = 'paiement.trop_percu' and object_id = $1`,
        [paiement.paiement_id],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.payload["motif"], "double_paiement");
      assert.equal(rows[0]!.payload["reference"], "T2");
      assert.equal((await facturesDeRecharge(db, p.licence)).length, 1, "une facture, pas deux");
    });
  });
});
