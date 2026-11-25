/**
 * La comptabilité paie son relevé ; sa facture naît au paiement (décisions du CEO du
 * 25 novembre 2026 : D7, D8 option A, D10, D11).
 *
 * Le mois écoulé se dit par un relevé, figé. Il se règle en ligne (son expert ou son
 * dirigeant) ou par virement du montant exact, inscrit dans la tour. La facture naît alors,
 * réglée, aux montants du relevé. Impayé passé les délais de la tour : plus d'attribution,
 * puis les abonnements de ses clients suspendus ; le paiement rouvre tout.
 *
 *   cd apps/api && node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/la-comptabilite-paie-son-releve.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentite } from "../db.ts";
import { identite } from "../depots/identite.ts";
import { ADRESSE_D_ESSAI, matriculeDEssai } from "../matricule-d-essai.ts";
import { inviteeParLaComptabilite, personnesDEssai } from "../personne-d-essai.ts";

import {
  payerEnLigne,
  releveDuCabinet,
  type ReleveEtabli,
  virementDuReleve,
} from "./decor-de-facture.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("la comptabilité paie son relevé", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `fac-cab-${Date.now()}`;
  const legalId = matriculeDEssai();
  let dirigeant: Utilisateur;
  let expert: Utilisateur;
  let pme = "";
  let cabinet = "";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });

  before(async () => {
    const d = await creerCompte(`dirigeant-${marque}@essai.local`, "MotDePasseTresLong2026!");
    const e = await creerCompte(`expert-${marque}@essai.local`, "MotDePasseTresLong2026!");
    assert.ok(d && e);
    dirigeant = d;
    expert = e;
    const creer = (u: Utilisateur, kind: string, nom: string, mf: string | null) =>
      sousIdentite(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization($1, $2, 'autonome', $3, 'TN', 'TND') as id`,
          [kind, nom, mf],
        );
        return rows[0]!.id;
      });
    pme = await creer(dirigeant, "pme", `PME ${marque}`, legalId);
    cabinet = await creer(expert, "cabinet", `COMPTA ${marque}`, null);
    // La facture porte le matricule et l'adresse du payeur : la base refuse de payer sans eux.
    await admin.query(
      `update identity.organizations
          set legal_id = coalesce(legal_id, $2), adresse = $3
        where id = $1`,
      [cabinet, matriculeDEssai(), ADRESSE_D_ESSAI],
    );
    await sousIdentite(expert.id, (db) => identite.proposerMandat(db, cabinet, legalId));
    const [propose] = await sousIdentite(dirigeant.id, (db) => identite.mandatsProposes(db, pme));
    await sousIdentite(dirigeant.id, (db) => identite.repondreAuMandat(db, propose!.id, true));
    // La comptabilité a invité son client dans Malica : elle peut lui attribuer un abonnement.
    await inviteeParLaComptabilite(admin, pme, expert.id);
    // Le cabinet attribue Team ; la PME accepte : le cabinet devient payeur.
    const acces = await sousIdentite(expert.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select public.acces_proposer($1, $2, 'team') as id",
        [cabinet, pme],
      );
      return rows[0]!.id;
    });
    await sousIdentite(dirigeant.id, (db) =>
      db.query("select public.acces_repondre($1, true)", [acces]),
    );
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [[pme, cabinet].filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  /** Une transaction annulée : l'émetteur, la tour et le relevé n'existent que le temps de l'épreuve. */
  async function aBlanc(
    corps: (db: pg.PoolClient, releve: ReleveEtabli, op: string, licence: string) => Promise<void>,
  ) {
    const db = await admin.connect();
    try {
      await db.query("begin");
      const op = randomUUID();
      await personnesDEssai(db, op);
      await db.query("insert into app.platform_operators (user_id) values ($1)", [op]);
      await db.query(
        `insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
         values ($1, date '2026-01-01', $2)`,
        [cabinet, op],
      );
      // Les délais de la tour : 14 jours, puis 30 (les défauts de la table).
      await sous(db, op, () =>
        db.query(
          `select plateforme.abonnement_regler(1::smallint, true, 2::smallint, 0::smallint,
                    14::smallint, 14::smallint, 30::smallint, 'épreuve')`,
        ),
      );
      const { rows: m } = await db.query<{ mois: string }>(
        "select date_trunc('month', current_date)::date::text as mois",
      );
      const releve = await releveDuCabinet(db, cabinet, m[0]!.mois, op);
      const { rows: l } = await db.query<{ licence_id: string }>(
        "select licence_id from facturation.licence_organisations where tenant_id = $1",
        [pme],
      );
      await corps(db, releve, op, l[0]!.licence_id);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }

  async function sous<T>(db: pg.PoolClient, qui: string, corps: () => Promise<T>): Promise<T> {
    await db.query("savepoint sous_role");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [qui]);
    try {
      const r = await corps();
      await db.query("reset role");
      await db.query("release savepoint sous_role");
      return r;
    } catch (erreur) {
      await db.query("rollback to savepoint sous_role");
      await db.query("reset role");
      throw erreur;
    }
  }

  /** Le relevé a `jours` jours : l'épreuve recule sa date, que la table ne laisse pas réécrire. */
  async function vieillir(db: pg.PoolClient, releve: string, jours: number) {
    await db.query(
      "alter table facturation.releves_cabinet disable trigger releves_ne_se_reecrivent_pas",
    );
    await db.query(
      "update facturation.releves_cabinet set etabli_le = current_date - $2::integer where id = $1",
      [releve, jours],
    );
    await db.query(
      "alter table facturation.releves_cabinet enable trigger releves_ne_se_reecrivent_pas",
    );
  }

  const facturesDuReleve = async (db: pg.PoolClient, releve: string) =>
    (
      await db.query<{
        id: string;
        numero: string;
        ttc: string;
        emise_le: string;
        etat: string;
        lignes: string;
        moyen: string;
        reference: string;
      }>(
        `select f.id, f.numero, f.montant_ttc::text as ttc, f.emise_le::text, e.etat,
                (select count(*)::text from facturation.facture_lignes l where l.facture_id = f.id) as lignes,
                (select en.moyen from facturation.encaissements en where en.facture_id = f.id) as moyen,
                (select en.reference from facturation.encaissements en where en.facture_id = f.id) as reference
           from facturation.releve_factures rf
           join facturation.factures f on f.id = rf.facture_id
           join facturation.encours_v e on e.facture_id = f.id
          where rf.releve_id = $1`,
        [releve],
      )
    ).rows;

  const envoisDe = async (db: pg.PoolClient, qui: string) =>
    (
      await db.query<{ code: string; canal: string; corps_rendu: string | null }>(
        `select code, canal, corps_rendu from notif.envois
          where destinataire = $1 and (code like 'releve.%' or code like 'facture.%'
                                       or code like 'paiement.%')
          order by code, canal`,
        [qui],
      )
    ).rows;

  it("aucune facture avant le paiement : un relevé, son avis, son paiement prêt", async () => {
    await aBlanc(async (db, releve) => {
      assert.equal(releve.abonnements, 1);
      assert.deepEqual(await facturesDuReleve(db, releve.releve_id), [], "rien de fiscal");
      const { rows: f } = await db.query(
        "select 1 from facturation.factures where payeur_tenant_id = $1",
        [cabinet],
      );
      assert.equal(f.length, 0);
      const e = await envoisDe(db, expert.id);
      assert.deepEqual(
        e.map((x) => [x.code, x.canal]),
        [
          ["releve.cabinet", "app"],
          ["releve.cabinet", "email"],
        ],
      );
      assert.ok(
        e.every((x) => !(x.corps_rendu ?? "").includes("{{")),
        "jetons rendus",
      );
      // Le même mois ne s'établit pas deux fois.
      await db.query("savepoint deux");
      await assert.rejects(
        db.query(
          "select facturation.releve_etablir($1, date_trunc('month', current_date)::date, null)",
          [cabinet],
        ),
        /refus\.facturation\.deja_emise\?periode=/,
      );
      await db.query("rollback to savepoint deux");
    });
  });

  it("l'expert paie en ligne : la facture naît, réglée, aux montants du relevé ; un seul courriel", async () => {
    await aBlanc(async (db, releve) => {
      const lu = await sous(db, expert.id, async () => {
        const { rows } = await db.query<{
          r: {
            banque: unknown;
            releves: Array<{ releve_id: string; paiement_id: string; lignes: unknown[] }>;
          };
        }>("select public.releves_du_cabinet($1) as r", [cabinet]);
        return rows[0]!.r.releves;
      });
      assert.equal(lu.length, 1);
      assert.equal(lu[0]!.paiement_id, releve.paiement_id);
      assert.equal(lu[0]!.lignes.length, releve.lignes);

      await payerEnLigne(db, expert.id, releve.paiement_id, "CAB-1");
      const [f, ...autres] = await facturesDuReleve(db, releve.releve_id);
      assert.equal(autres.length, 0);
      assert.equal(Number(f!.ttc), Number(releve.ttc), "facture = relevé = paiement");
      assert.equal(f!.etat, "payee");
      assert.equal(Number(f!.lignes), releve.lignes);
      assert.match(f!.numero, /^MO-TN-I11-\d{4}-\d{6}$/);
      assert.equal(f!.reference, "clictopay CAB-1");

      const e = (await envoisDe(db, expert.id)).filter((x) => !x.code.startsWith("releve."));
      assert.deepEqual(
        e.map((x) => [x.code, x.canal]),
        [
          ["facture.reglee.cabinet", "app"],
          ["facture.reglee.cabinet", "email"],
        ],
        "la facture réglée est le reçu : pas de reçu à part",
      );
      assert.ok(
        e.every((x) => !(x.corps_rendu ?? "").includes("{{")),
        "jetons rendus",
      );
    });
  });

  it("le dirigeant de la PME cliente ne paie pas le relevé de la comptabilité", async () => {
    await aBlanc(async (db, releve) => {
      await assert.rejects(
        payerEnLigne(db, dirigeant.id, releve.paiement_id, "CAB-2"),
        (e: { code?: string }) => e.code === "42501",
      );
    });
  });

  it("le virement, inscrit en tour au montant exact, fait naître la facture réglée (D10)", async () => {
    await aBlanc(async (db, releve, op) => {
      const virer = (montant: number, le: string, reference: string) =>
        sous(db, op, () =>
          db.query(`select plateforme.virement_encaisser($1, $2, ${le}, $3)`, [
            releve.releve_id,
            montant,
            reference,
          ]),
        );
      await assert.rejects(
        virer(Number(releve.ttc) - 1, "current_date", "VIR-1"),
        /refus\.virement\.montant_inexact\?attendu=/,
      );
      await assert.rejects(
        virer(Number(releve.ttc), "current_date + 1", "VIR-1"),
        /refus\.virement\.date$/,
      );
      await assert.rejects(
        virer(Number(releve.ttc), "current_date", "  "),
        /refus\.virement\.reference$/,
      );
      await assert.rejects(
        sous(db, expert.id, () =>
          db.query("select plateforme.virement_encaisser($1, $2, current_date, 'VIR-1')", [
            releve.releve_id,
            releve.ttc,
          ]),
        ),
        /refus\.reserve\.plateforme$/,
      );

      await virer(Number(releve.ttc), "current_date", "VIR-1");
      const [f] = await facturesDuReleve(db, releve.releve_id);
      assert.deepEqual([f!.etat, f!.moyen, f!.reference], ["payee", "virement", "VIR-1"]);
      await assert.rejects(
        virer(Number(releve.ttc), "current_date", "VIR-2"),
        /refus\.releve\.deja_regle$/,
      );

      // Le lien du courriel ne s'ouvre plus : son paiement est remplacé.
      const { rows: v } = await db.query<{ etat: string }>(
        "select etat from facturation.paiements_en_ligne_v where paiement_id = $1",
        [releve.paiement_id],
      );
      assert.equal(v[0]!.etat, "remplace");
    });
  });

  it("payé en ligne alors qu'un virement l'a déjà réglé : l'argent est gardé, pas de seconde facture", async () => {
    await aBlanc(async (db, releve, op) => {
      // La page de carte est ouverte ; le virement est inscrit pendant ce temps.
      await sous(db, expert.id, async () => {
        await db.query(
          `with cgv as (select public.paiement_cgv_accepter($1::uuid, (plateforme.cgv_en_vigueur()).id))
           select public.paiement_inscrire($1::uuid, 'lien_cree', 'clictopay', 'CAB-3',
                    'https://test.clictopay.com/pay/CAB-3', '{}', 'visa') from cgv`,
          [releve.paiement_id],
        );
      });
      await virementDuReleve(db, op, releve.releve_id);
      await payerEnLigne(db, expert.id, releve.paiement_id, "CAB-3");
      assert.equal((await facturesDuReleve(db, releve.releve_id)).length, 1);
      const { rows: d } = await db.query<{ montant: string; payeur_tenant_id: string }>(
        "select montant::text, payeur_tenant_id from facturation.paiements_en_double where paiement_id = $1",
        [releve.paiement_id],
      );
      assert.deepEqual(
        d.map((x) => [Number(x.montant), x.payeur_tenant_id]),
        [[Number(releve.ttc), cabinet]],
      );

      // La tour voit ce solde, l'inscrit remboursé (référence, motif), et il cesse de compter.
      const soldes = () =>
        sous(db, op, async () => {
          const { rows } = await db.query<{ cabinet_id: string | null; solde: string }>(
            "select cabinet_id, solde::text from plateforme.soldes_crediteurs()",
          );
          return rows.filter((x) => x.cabinet_id === cabinet).map((x) => Number(x.solde));
        });
      assert.deepEqual(await soldes(), [Number(releve.ttc)]);
      const rembourser = (reference: string, motif: string) =>
        sous(db, op, () =>
          db.query("select plateforme.solde_rembourser(null, $1, $2, $3)", [
            cabinet,
            reference,
            motif,
          ]),
        );
      await assert.rejects(rembourser("RBT-1", " "), /refus\.saisie\.incomplete$/);
      await rembourser("RBT-1", "Relevé payé deux fois");
      assert.deepEqual(await soldes(), [], "remboursé, il ne compte plus");
      await assert.rejects(rembourser("RBT-2", "encore"), /refus\.solde\.aucun$/);
    });
  });

  it("impayé : attributions fermées à 14 jours, abonnements suspendus à 30, le paiement rouvre tout (D11)", async () => {
    await aBlanc(async (db, releve, op) => {
      const proposer = () =>
        sous(db, expert.id, () =>
          db.query("select public.acces_proposer($1, $2, 'team')", [cabinet, pme]),
        );
      const active = async () =>
        (await db.query<{ a: boolean }>("select app.licence_active($1) as a", [pme])).rows[0]!.a;
      const prevenir = async () =>
        Number(
          (await db.query<{ n: number }>("select notif.prevenir_les_abonnements() as n")).rows[0]!
            .n,
        );
      const avis = async () =>
        (await envoisDe(db, expert.id))
          .filter((x) => x.canal === "email" && x.code !== "releve.cabinet")
          .map((x) => x.code);

      await assert.rejects(proposer(), /refus\.abonnement\.deja_propose$/, "pas encore bloquée");
      assert.equal(await active(), true);

      await vieillir(db, releve.releve_id, 14);
      await assert.rejects(proposer(), /refus\.abonnement\.releve_impaye$/);
      assert.equal(await active(), true, "bloquée, pas suspendue");
      assert.ok((await prevenir()) >= 1);
      assert.equal(await prevenir(), 0, "un avis, une fois");
      assert.deepEqual(await avis(), ["releve.bloque"]);

      await vieillir(db, releve.releve_id, 28);
      await prevenir();
      assert.deepEqual(await avis(), ["releve.bloque", "releve.suspension_proche"]);

      await vieillir(db, releve.releve_id, 30);
      assert.equal(await active(), false, "les abonnements qu'elle paie sont suspendus");
      await prevenir();
      assert.deepEqual(await avis(), [
        "releve.bloque",
        "releve.suspendu",
        "releve.suspension_proche",
      ]);
      const tour = await sous(db, op, async () => {
        const { rows } = await db.query<{ releve_id: string; suspendu_le: string }>(
          "select releve_id, suspendu_le::text from plateforme.releves_a_encaisser()",
        );
        return rows;
      });
      assert.ok(
        tour.some((t) => t.releve_id === releve.releve_id),
        "la tour le voit",
      );

      await payerEnLigne(db, expert.id, releve.paiement_id, "CAB-4");
      assert.equal(await active(), true, "le paiement rouvre");
      await assert.rejects(proposer(), /refus\.abonnement\.deja_propose$/, "et les attributions");
      assert.equal(await prevenir(), 0);
    });
  });
});
