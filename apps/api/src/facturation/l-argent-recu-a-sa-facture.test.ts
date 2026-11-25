/**
 * L'argent reçu a sa facture, ou reste un solde créditeur — jamais perdu, jamais demandé deux
 * fois (revue du 25 novembre 2026 : R-04, 8.3 ; D7 ; « payer d'avance, toujours »).
 *
 * Une recharge payée a sa facture, au paiement.
 *
 * Avant : l'argent d'une recharge attendait la prochaine facture de base du titulaire. Quand
 * une comptabilité paie toute la licence, cette facture n'existe pas : de l'argent encaissé
 * sans facture. Désormais la facture naît du paiement, réglée, au millime du paiement, quel
 * que soit le payeur de l'abonnement ; une recharge déjà portée par une base ne se paie plus
 * à part ; et un second lien payé pour un même paiement se trace en trop-perçu (8.3).
 *
 *   cd apps/api && node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/l-argent-recu-a-sa-facture.test.ts
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
  changer,
  jourDe,
  passer,
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

describe("l'argent reçu a sa facture, ou un solde créditeur", { skip: !ADMIN }, () => {
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

  it("payer d'avance : achetée, elle ne sert qu'une fois payée, et jamais sur l'échéance", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      const p = await unePme(db, await jourDe(db));
      const { recharge, paiement } = await acheter(db, p.titulaire, p.tenant);
      const etat = async () =>
        (
          await db.query<{ utilisable: boolean; payee: boolean }>(
            "select utilisable, payee from facturation.recharges_v where recharge_id = $1",
            [recharge],
          )
        ).rows[0]!;
      assert.deepEqual(await etat(), { utilisable: false, payee: false }, "pas avant le paiement");

      // L'échéance payée ne la porte pas : elle a son propre paiement.
      await db.query("set constraints all immediate");
      await payerLesDus(db);
      const [base] = await facturesDuTitulaire(db, p.licence);
      const { rows: lignes } = await db.query<{ libelle: string }>(
        "select libelle from facturation.facture_lignes where facture_id = $1",
        [base!.id],
      );
      assert.ok(!lignes.some((l) => l.libelle.startsWith("Recharge ")), "pas sur la base");
      assert.equal(await resteDu(db, base!.id), 0, "la facture vaut son paiement");

      await payerEnLigne(db, p.titulaire, paiement.paiement_id);
      assert.deepEqual(await etat(), { utilisable: true, payee: true }, "payée, elle sert");
      assert.equal((await facturesDeRecharge(db, p.licence)).length, 1);
    });
  });

  it("solde créditeur : il se déduit de l'échéance, on ne paie que le reste, la facture garde son plein TTC", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      const p = await unePme(db, await jourDe(db, -3));
      await db.query("set constraints all immediate");
      await payerLesDus(db);
      const [base] = await facturesDuTitulaire(db, p.licence);

      // Un lien de recharge payé deux fois : le second paiement devient un solde créditeur.
      const { paiement } = await acheter(db, p.titulaire, p.tenant);
      await payerEnLigne(db, p.titulaire, paiement.paiement_id, "T1");
      await payerEnLigne(db, p.titulaire, paiement.paiement_id, "T2");
      const solde = async () =>
        Number(
          (
            await db.query<{ s: string }>("select facturation.solde_crediteur($1)::text as s", [
              p.licence,
            ])
          ).rows[0]!.s,
        );
      assert.equal(await solde(), Number(paiement.montant_ttc));
      await enPersonne(db, s.operateur);
      const { rows: tour } = await db.query<{ licence_id: string; solde: string }>(
        "select licence_id, solde::text from plateforme.soldes_crediteurs()",
      );
      await db.query("reset role");
      assert.ok(
        tour.some((t) => t.licence_id === p.licence),
        "la tour le voit",
      );

      // L'échéance suivante : on ne demande que le reste.
      await passer(db, base!.couvre_au);
      const { rows: d } = await db.query<{ paiement_id: string; montant_ttc: string }>(
        "select paiement_id, montant_ttc::text from facturation.demande_due_ouverte($1)",
        [p.licence],
      );
      const { rows: pl } = await db.query<{
        credit: string;
        ht: string;
        tva: string;
        timbre: string;
      }>(
        `select credit_deduit::text as credit, montant_ht::text as ht, montant_tva::text as tva,
                timbre::text from facturation.paiements_en_ligne where id = $1`,
        [d[0]!.paiement_id],
      );
      const plein = Number(pl[0]!.ht) + Number(pl[0]!.tva) + Number(pl[0]!.timbre);
      assert.equal(Number(pl[0]!.credit), Number(paiement.montant_ttc), "le solde déduit");
      assert.equal(
        Math.round((plein - Number(pl[0]!.credit)) * 1000),
        Math.round(Number(d[0]!.montant_ttc) * 1000),
        "on ne paie que le reste",
      );
      await enPersonne(db, p.titulaire);
      const { rows: e } = await db.query<{ r: { credit_deduit: string; montant_ttc: string } }>(
        "select public.mon_echeance($1) as r",
        [p.tenant],
      );
      await db.query("reset role");
      assert.equal(Number(e[0]!.r.credit_deduit), Number(paiement.montant_ttc), "la PME le voit");

      await payerLesDus(db);
      const suivante = (await facturesDuTitulaire(db, p.licence)).find(
        (f) => f.couvre_du === base!.couvre_au,
      );
      assert.ok(suivante, "la facture naît au paiement");
      const { rows: ttc } = await db.query<{ t: string }>(
        "select montant_ttc::text as t from facturation.factures where id = $1",
        [suivante.id],
      );
      assert.equal(Number(ttc[0]!.t), plein, "plein TTC sur la facture");
      assert.equal(await resteDu(db, suivante.id), 0, "réglée : solde, puis paiement");
      assert.equal(await solde(), 0, "le solde est consommé");
    });
  });

  it("un solde qui couvre l'échéance la règle seul : la facture naît, rien n'est demandé", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      const p = await unePme(db, await jourDe(db, -3));
      await db.query("set constraints all immediate");
      // Le lien de l'échéance payé deux fois : un solde du montant d'une échéance.
      const { rows: d } = await db.query<{ paiement_id: string }>(
        "select paiement_id from facturation.demande_due_ouverte($1)",
        [p.licence],
      );
      await payerEnLigne(db, p.titulaire, d[0]!.paiement_id, "T1");
      await payerEnLigne(db, p.titulaire, d[0]!.paiement_id, "T2");
      await db.query("set constraints all immediate");
      const [base] = await facturesDuTitulaire(db, p.licence);

      const bilan = await passer(db, base!.couvre_au);
      assert.equal(bilan.pme?.emises, 1, "réglée par le solde");
      assert.equal(bilan.pme?.demandes, 0);
      const { rows: due } = await db.query("select 1 from facturation.demande_due_ouverte($1)", [
        p.licence,
      ]);
      assert.equal(due.length, 0, "rien à payer");
      const suivante = (await facturesDuTitulaire(db, p.licence)).find(
        (f) => f.couvre_du === base!.couvre_au,
      );
      assert.ok(suivante);
      assert.equal(await resteDu(db, suivante.id), 0);
    });
  });

  it("l'ancien lien d'une échéance rechiffrée, payé quand même : un solde, déduit de la nouvelle", async () => {
    await aBlanc(async (db) => {
      const s = await socle(db);
      await regler(db, s, "pme", true);
      const jour = await jourDe(db);
      const p = await unePme(db, jour);
      await db.query("set constraints all immediate");
      const due = async () =>
        (
          await db.query<{ paiement_id: string; montant_ttc: string }>(
            "select paiement_id, montant_ttc::text from facturation.demande_due_ouverte($1)",
            [p.licence],
          )
        ).rows[0];
      const ancienne = (await due())!;

      // Ce qui est dû change (une offre plus chère) : l'échéance se rechiffre.
      await changer(db, p, "team", jour);
      await db.query("select facturation.du_a_payer($1, $2::date, null)", [p.licence, jour]);
      const nouvelle = (await due())!;
      assert.notEqual(nouvelle.paiement_id, ancienne.paiement_id);

      // La page de l'ancienne demande, restée ouverte, est payée quand même.
      await payerEnLigne(db, p.titulaire, ancienne.paiement_id, "ANCIEN");
      await db.query("set constraints all immediate");
      assert.deepEqual(await facturesDuTitulaire(db, p.licence), [], "rien à un montant périmé");
      const reste = (await due())!;
      const { rows: pl } = await db.query<{ credit: string }>(
        "select credit_deduit::text as credit from facturation.paiements_en_ligne where id = $1",
        [reste.paiement_id],
      );
      assert.equal(Number(pl[0]!.credit), Number(ancienne.montant_ttc), "l'argent reçu est déduit");
      const { rows: trace } = await db.query<{ motif: string }>(
        `select payload ->> 'motif' as motif from audit.event_log
          where action = 'paiement.trop_percu' and object_id = $1`,
        [ancienne.paiement_id],
      );
      assert.deepEqual(
        trace.map((t) => t.motif),
        ["demande_remplacee"],
      );

      await payerLesDus(db);
      const [f] = await facturesDuTitulaire(db, p.licence);
      assert.equal(await resteDu(db, f!.id), 0, "réglée : l'ancien paiement, puis le reste");
      assert.equal(await due(), undefined, "plus rien de dû");
    });
  });

  it("un second lien payé pour le même paiement devient un solde créditeur, tracé (8.3)", async () => {
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
      const { rows: doubles } = await db.query<{ reference: string; montant: string }>(
        "select reference, montant::text from facturation.paiements_en_double where paiement_id = $1",
        [paiement.paiement_id],
      );
      assert.deepEqual(
        doubles.map((x) => [x.reference, Number(x.montant)]),
        [["T2", Number(paiement.montant_ttc)]],
        "l'argent reçu deux fois est gardé, au montant encaissé : un solde créditeur",
      );
    });
  });
});
