/**
 * Le paiement reçu se dit ; la facture payée d'abord se dit réglée ; l'offre a son nom
 * (CGV publiées, art. 5 ; recette Flouci du 24 novembre 2026 — 20261231270000).
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/le-paiement-recu-se-dit.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type pg from "pg";

import {
  ADMIN,
  pool,
  aBlanc,
  enPersonne,
  passer,
  socle,
  regler,
  unePme,
  facturesDuTitulaire,
  jourDe,
  demander,
  payer,
  payerLesDus,
} from "./decor-d-avance.ts";

interface Envoi {
  code: string;
  canal: string;
  donnees: Record<string, string>;
  corps_rendu: string | null;
}

async function envois(db: pg.PoolClient, qui: string): Promise<Envoi[]> {
  await db.query("reset role");
  const { rows } = await db.query<Envoi>(
    `select code, canal, donnees, corps_rendu from notif.envois
      where destinataire = $1 and canal = 'email' order by cree_le, code`,
    [qui],
  );
  return rows;
}

describe("le paiement reçu se dit", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("une montée payée : un reçu de paiement, et sa facture dite réglée, au nom de l'offre", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancre = await jourDe(db, -5);
      await regler(db, s, "pme", true);
      const p = await unePme(db, ancre, "basic");
      await passer(db, ancre);
      const r = await demander(db, p, "solo");
      await payer(db, p, r.paiement!.paiement_id);

      const e = await envois(db, p.titulaire);
      const recu = e.find((x) => x.code === "paiement.recu");
      assert.ok(recu, "le reçu de paiement part");
      assert.equal(recu.donnees["reference"], "REF-1");
      assert.ok(recu.donnees["objet"]?.includes("Solo"), "l'objet nomme l'offre");
      assert.ok(!recu.corps_rendu?.includes("{{"), "jetons rendus");

      const complement = (await facturesDuTitulaire(db, p.licence)).find(
        (x) => x.nature === "complement",
      )!;
      const avis = e.filter((x) => x.donnees["numero"] === complement.numero);
      assert.deepEqual(
        avis.map((x) => x.code),
        ["facture.reglee.pme"],
        "la facture née du paiement se dit réglée, pas « à régler »",
      );
      assert.equal(avis[0]!.donnees["offre"], "Solo");
      assert.match(complement.libelle, /Complément d'abonnement Solo/);
    });
  });

  it("une période ordinaire se demande au nom de l'offre ; payée, sa facture naît réglée", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancre = await jourDe(db, -5);
      await regler(db, s, "pme", true);
      const p = await unePme(db, ancre, "premium");
      await passer(db, ancre);
      assert.deepEqual(await facturesDuTitulaire(db, p.licence), [], "aucune facture impayée");
      const demande = (await envois(db, p.titulaire)).filter(
        (x) => x.code === "abonnement.a_payer",
      );
      assert.equal(demande.length, 1, "un avis : à payer");
      assert.equal(demande[0]!.donnees["offre"], "Premium");
      assert.ok(!(demande[0]!.corps_rendu ?? "").includes("{{"), "jetons rendus");

      await payerLesDus(db);
      const [base] = await facturesDuTitulaire(db, p.licence);
      assert.match(base!.libelle, /^Abonnement Premium — /);
      const avis = (await envois(db, p.titulaire)).filter(
        (x) => x.donnees["numero"] === base!.numero,
      );
      assert.deepEqual(
        avis.map((x) => x.code),
        ["facture.reglee.pme"],
        "jamais « à régler » : la facture naît du paiement",
      );
      assert.equal(avis[0]!.donnees["offre"], "Premium");
    });
  });

  it("le simulateur, qui ne fait entrer aucun argent, n'envoie aucun reçu", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      const ancre = await jourDe(db, -5);
      await regler(db, s, "pme", true);
      const p = await unePme(db, ancre, "basic");
      await passer(db, ancre);
      const r = await demander(db, p, "solo");
      const id = r.paiement!.paiement_id;
      await enPersonne(db, p.titulaire);
      await db.query("select set_config('malica.paiement_simulateur', 'oui', true)");
      await db.query(
        "with cgv as (select public.paiement_cgv_accepter($1, (plateforme.cgv_en_vigueur()).id)) select public.paiement_inscrire($1, 'lien_cree', 'simulateur', 'sim-9', 'https://staging.exemple.tn/?simulateur=1', '{}', 'visa') from cgv",
        [id],
      );
      await db.query("select public.paiement_inscrire($1, 'paye', 'simulateur', 'sim-9')", [id]);
      const e = await envois(db, p.titulaire);
      assert.equal(e.filter((x) => x.code === "paiement.recu").length, 0);
    });
  });
});
