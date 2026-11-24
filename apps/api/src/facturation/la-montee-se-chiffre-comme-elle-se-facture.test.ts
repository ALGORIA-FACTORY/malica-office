/**
 * La montée se chiffre comme elle se facture ; la descente attend l'échéance payée
 * (recette Flouci du pilote, 24 novembre 2026 — 20261231240000).
 *
 * Le devis d'une montée, sous la facturation d'avance, est la facture qu'elle émettra, jouée
 * puis défaite par la fonction même qui l'émettra. Plus aucun cas tu : la remontée sous une
 * offre déjà payée s'ouvre sans rien faire payer, la société sans facture d'avance paie la
 * facture de sa période, le paiement reçu s'impute sur la facture que la montée émet. Une
 * descente demandée pendant une période payée prend effet à son échéance (CGV, art. 8).
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-montee-se-chiffre-comme-elle-se-facture.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  ADMIN,
  pool,
  aBlanc,
  enPersonne,
  passer,
  socle,
  regler,
  unePme,
  changer,
  facturesDuTitulaire,
  prix,
  jourDe,
  devis,
  demander,
  offreEnCours,
  payer,
  resteDu,
} from "./decor-d-avance.ts";

describe("la montée se chiffre comme elle se facture", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("le cas du pilote : Premium payé, descendu en Basic, « Basic → Solo » s'ouvre sans rien faire payer", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancre = await jourDe(db, -8);
      await regler(db, s, "pme", true);
      const p = await unePme(db, ancre, "premium");
      await passer(db, ancre);
      const [base] = await facturesDuTitulaire(db, p.licence);
      assert.equal(base!.nature, "base");
      // L'ancien chemin : la descente appliquée le jour même (avant ce correctif).
      await changer(db, p, "basic", await jourDe(db));

      const d = await devis(db, p, "solo");
      assert.equal(d.rien_a_regler, true, "la période payée couvre déjà Solo");
      assert.equal(d.au, base!.couvre_au && (await jourDe(db, 0)) && d.au);
      const r = await demander(db, p, "solo");
      assert.equal(r.change, true, "Solo s'ouvre");
      assert.equal(r.paiement, null, "rien n'est demandé : Premium est payé jusqu'à l'échéance");
      assert.equal(await offreEnCours(db, p), "solo");
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 1, "aucune facture de plus");
    });
  });

  it("Basic payé → Solo : le devis est la facture complément ; payée, elle est soldée et l'offre s'ouvre", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancre = await jourDe(db, -5);
      await regler(db, s, "pme", true);
      const p = await unePme(db, ancre, "basic");
      await passer(db, ancre);

      const d = await devis(db, p, "solo");
      assert.equal(d.rien_a_regler, false);
      assert.ok(Number(d.a_regler_ttc) > 0);
      const r = await demander(db, p, "solo");
      assert.equal(r.change, false, "rien ne s'ouvre avant le paiement");
      assert.equal(Number(r.paiement!.montant_ttc), Number(d.a_regler_ttc), "on paie le devis");
      assert.equal(await offreEnCours(db, p), "basic");

      await payer(db, p, r.paiement!.paiement_id);
      assert.equal(await offreEnCours(db, p), "solo", "payée, la montée s'ouvre");
      const toutes = await facturesDuTitulaire(db, p.licence);
      const complement = toutes.find((x) => x.nature === "complement");
      assert.ok(complement, "le complément est émis");
      assert.match(complement.numero, /^MO-TN-I11-\d{4}-\d{6}$/, "sous la série Malica");
      assert.equal(await resteDu(db, complement.id), 0, "et soldé par le paiement");
    });
  });

  it("sans facture d'avance qui couvre le jour : le devis chiffre la facture de la période, payée elle est soldée", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const jour = await jourDe(db);
      const p = await unePme(db, await jourDe(db, -40), "basic");
      // La licence existait avant que la facturation d'avance ne s'ouvre : aucune facture.
      await db.query("set constraints all immediate");
      await db.query("set constraints all deferred");
      await regler(db, s, "pme", true);
      assert.equal((await facturesDuTitulaire(db, p.licence)).length, 0);

      const d = await devis(db, p, "team");
      assert.equal(d.rien_a_regler, false, "le devis ne se tait plus");
      assert.ok(Number(d.a_regler_ttc) > 0);
      const r = await demander(db, p, "team");
      assert.equal(Number(r.paiement!.montant_ttc), Number(d.a_regler_ttc));
      await payer(db, p, r.paiement!.paiement_id);
      const { rows: refus } = await db.query<{ refus: string | null }>(
        `select o.refus from facturation.montees_ouvertes o
           join facturation.paiements_en_ligne x on x.montee_demandee_id = o.montee_id
          where x.id = $1`,
        [r.paiement!.paiement_id],
      );
      assert.equal(refus[0]?.refus ?? null, null, "l'ouverture n'a rien refusé");
      assert.equal(await offreEnCours(db, p), "team");
      const couvre = (await facturesDuTitulaire(db, p.licence)).filter(
        (x) => x.couvre_du <= jour && x.couvre_au > jour,
      );
      assert.equal(couvre.length, 1, "une facture couvre le jour");
      assert.equal(await resteDu(db, couvre[0]!.id), 0, "soldée par le paiement");
    });
  });

  it("une descente pendant une période payée attend l'échéance ; le jour venu, la période suivante est au prix bas", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancre = await jourDe(db, -8);
      await regler(db, s, "pme", true);
      const p = await unePme(db, ancre, "premium");
      await passer(db, ancre);
      const [base] = await facturesDuTitulaire(db, p.licence);

      const r = await demander(db, p, "basic");
      assert.equal(r.change, false, "rien ne change aujourd'hui");
      assert.deepEqual(r.descente, { offre: "basic", le: base!.couvre_au });
      assert.equal(
        await offreEnCours(db, p),
        "premium",
        "les droits payés restent jusqu'à l'échéance",
      );
      await enPersonne(db, p.titulaire);
      const { rows: m } = await db.query<{ d: unknown }>("select public.ma_descente($1) as d", [
        p.tenant,
      ]);
      await db.query("reset role");
      assert.deepEqual(m[0]!.d, { offre: "basic", le: base!.couvre_au });

      await passer(db, base!.couvre_au);
      assert.equal(
        await offreEnCours(db, p),
        "basic",
        "le jour de l'échéance, la descente s'applique",
      );
      const suivante = (await facturesDuTitulaire(db, p.licence)).find(
        (x) => x.couvre_du === base!.couvre_au,
      );
      assert.ok(suivante, "la période suivante est facturée");
      assert.equal(Number(suivante.montant_ht), await prix(db, "basic", base!.couvre_au));
    });
  });

  it("une montée annule la descente programmée ; « annuler » aussi", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancre = await jourDe(db, -3);
      await regler(db, s, "pme", true);
      const p = await unePme(db, ancre, "team");
      await passer(db, ancre);

      assert.ok((await demander(db, p, "solo")).descente);
      const r = await demander(db, p, "premium");
      assert.ok(r.paiement, "la montée se paie");
      await enPersonne(db, p.titulaire);
      const { rows: a } = await db.query<{ d: unknown }>("select public.ma_descente($1) as d", [
        p.tenant,
      ]);
      assert.equal(a[0]!.d, null, "la montée a annulé la descente");
      await db.query("reset role");

      assert.ok((await demander(db, p, "basic")).descente);
      await enPersonne(db, p.titulaire);
      await db.query("select public.descente_annuler($1)", [p.tenant]);
      const { rows: b } = await db.query<{ d: unknown }>("select public.ma_descente($1) as d", [
        p.tenant,
      ]);
      await db.query("reset role");
      assert.equal(b[0]!.d, null, "annulée par le titulaire");
      assert.equal(await offreEnCours(db, p), "team");
    });
  });

  it("le devis ne tire aucun numéro et n'envoie aucun avis : le jeu est défait", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancre = await jourDe(db, -5);
      await regler(db, s, "pme", true);
      const p = await unePme(db, ancre, "basic");
      await passer(db, ancre);
      const avant = await db.query<{ n: string; c: string }>(
        `select (select count(*) from facturation.factures where licence_id = $1)::text as n,
                (select coalesce(sum(dernier), 0) from facturation.compteurs_factures)::text as c`,
        [p.licence],
      );
      await devis(db, p, "premium");
      await devis(db, p, "team");
      const apres = await db.query<{ n: string; c: string }>(
        `select (select count(*) from facturation.factures where licence_id = $1)::text as n,
                (select coalesce(sum(dernier), 0) from facturation.compteurs_factures)::text as c`,
        [p.licence],
      );
      assert.deepEqual(apres.rows[0], avant.rows[0]);
      assert.equal(await offreEnCours(db, p), "basic");
    });
  });
});
