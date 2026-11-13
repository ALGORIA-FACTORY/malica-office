/**
 * Une montée se chiffre avant le geste (recette du 13 novembre 2026, B3).
 *
 * « Confirmer : passer à Team » doit dire ce qu'il fait régler aujourd'hui
 * (prorata, TVA du jour, sans timbre) et le prix plein des mois suivants. Le
 * devis (`public.montee_devis`) lit la même formule que la préparation du
 * paiement ; l'épreuve le prouve CHAQUE JOUR de quatre mois de 28, 29, 30 et
 * 31 jours, contre une arithmétique indépendante — des millimes entiers, ni la
 * formule SQL ni son arrondi recopiés — et contre le montant que la
 * préparation inscrit ensuite.
 *
 * Les prix et la TVA se lisent dans la base ; rien n'est écrit ici, sauf le cas
 * étalon de la recette : 25 × 18/30 × 1,19 = 17,850.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/une-montee-se-chiffre-avant-le-geste.test.ts
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import pg from "pg";

import { decor, enPersonne, ouvrirLePerimetrePme, type Decor } from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Devis {
  offre: string;
  ecart_mensuel_ht: number;
  jours_restants: number | null;
  jours_du_mois: number | null;
  a_regler_ht: number | null;
  a_regler_tva: number | null;
  timbre: number | null;
  a_regler_ttc: number | null;
  devise: string | null;
  prix_plein_ttc: number | null;
}

interface Acompte {
  libelle: string;
  montant_ht: string;
  montant_tva: string;
  montant_ttc: string;
}

async function aBlanc(corps: (db: pg.PoolClient) => Promise<void>) {
  const db = await pool!.connect();
  try {
    await db.query("begin");
    await corps(db);
  } finally {
    await db.query("rollback");
    db.release();
  }
}

const devisDu = (db: pg.PoolClient, d: Decor, offre: string, le: string) =>
  enPersonne(db, d.titulaire, async () => {
    const { rows } = await db.query<{ r: Devis | null }>(
      "select public.montee_devis($1, $2, $3::date) as r",
      [offre, d.tenant, le],
    );
    return rows[0]!.r;
  });

/** Le titulaire monte le `le`, par la porte ; ce que la préparation inscrit. */
const monterLe = (db: pg.PoolClient, d: Decor, offre: string, le: string) =>
  enPersonne(db, d.titulaire, async () => {
    await db.query("select public.forfait_changer($1, $2, $3::date)", [offre, d.tenant, le]);
    const { rows } = await db.query<{ p: Acompte | null }>(
      "select public.paiement_montee_preparer($1) as p",
      [d.tenant],
    );
    return rows[0]!.p;
  });

const prixMillimes = async (db: pg.PoolClient, offre: string, le: string) => {
  const { rows } = await db.query<{ p: string }>(
    "select ((ref.offre_a($1, $2::date)).prix_mensuel_ht * 1000)::bigint::text as p",
    [offre, le],
  );
  return Number(rows[0]!.p);
};

const tauxMillieme = async (db: pg.PoolClient, le: string) => {
  const { rows } = await db.query<{ t: string }>(
    "select (taux * 1000)::int::text as t from facturation.fiscalite_en_vigueur($1::date)",
    [le],
  );
  return Number(rows[0]!.t);
};

/** Un montant lu en nombre (JSON) ou en texte (numeric), en millimes entiers. */
const mm = (v: number | string | null) => Math.round(Number(v) * 1000);

/** Le même calcul, en entiers : écart × jours restants / jours du mois, puis la TVA du taux. */
function attendu(ecartMillimes: number, jour: number, jours: number, tauxMillieme: number) {
  const ht = Math.round((ecartMillimes * (jours - jour + 1)) / jours);
  const tva = Math.round((ht * tauxMillieme) / 1000);
  return { ht, tva };
}

const MOIS = [
  { debut: "2027-02-01", jours: 28 },
  { debut: "2028-02-01", jours: 29 },
  { debut: "2026-11-01", jours: 30 },
  { debut: "2026-12-01", jours: 31 },
];

const jourDuMois = (debut: string, n: number) =>
  `${debut.slice(0, 8)}${String(n).padStart(2, "0")}`;

describe("une montée se chiffre avant le geste", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("le cas de la recette : Basic → Team le 13 novembre, 25 × 18/30 × 1,19 = 17,850", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "basic", "2026-11-01");
      const devis = await devisDu(db, d, "team", "2026-11-13");
      assert.ok(devis);
      assert.equal(devis.jours_restants, 18);
      assert.equal(devis.jours_du_mois, 30);
      assert.equal(mm(devis.a_regler_ht), 15000);
      assert.equal(mm(devis.a_regler_ttc), 17850);
      const p = await monterLe(db, d, "team", "2026-11-13");
      assert.equal(
        mm(p?.montant_ttc ?? null),
        17850,
        "la préparation inscrit ce que le devis a dit",
      );
      // B9 : la flèche du libellé est une flèche (la base écrivait « -> »).
      assert.match(p!.libelle, /^Passage Basic → Team — 18\/30 jours$/);
    });
  });

  // Périmètre « PME » fermé (l'acompte, sans timbre — l'état du staging) : chaque jour.
  for (const m of MOIS) {
    it(`${m.jours} jours (${m.debut.slice(0, 7)}), périmètre fermé : chaque jour, le devis est celui de l'arithmétique et de la préparation`, async () => {
      await aBlanc(async (db) => {
        await decor(db, "solo", m.debut); // désigne l'émetteur, dont la fiscalité se lit ensuite
        const [ecart, taux] = [
          (await prixMillimes(db, "team", m.debut)) - (await prixMillimes(db, "solo", m.debut)),
          await tauxMillieme(db, m.debut),
        ];
        for (let jour = 1; jour <= m.jours; jour++) {
          const le = jourDuMois(m.debut, jour);
          await db.query("savepoint un_jour");
          const d = await decor(db, "solo", m.debut);
          const devis = await devisDu(db, d, "team", le);
          assert.ok(devis, `${le} : un devis`);
          const a = attendu(ecart, jour, m.jours, taux);
          assert.equal(devis.jours_du_mois, m.jours, `${le} : jours du mois`);
          assert.equal(devis.jours_restants, m.jours - jour + 1, `${le} : jours restants`);
          assert.equal(mm(devis.a_regler_ht), a.ht, `${le} : HT`);
          assert.equal(mm(devis.a_regler_tva), a.tva, `${le} : TVA`);
          assert.equal(mm(devis.timbre), 0, `${le} : un acompte ne porte pas de timbre`);
          assert.equal(mm(devis.a_regler_ttc), a.ht + a.tva, `${le} : TTC`);

          const p = await monterLe(db, d, "team", le);
          assert.ok(p, `${le} : la préparation inscrit un paiement`);
          assert.equal(mm(p.montant_ht), mm(devis.a_regler_ht), `${le} : même HT que le devis`);
          assert.equal(mm(p.montant_tva), mm(devis.a_regler_tva), `${le} : même TVA que le devis`);
          assert.equal(mm(p.montant_ttc), mm(devis.a_regler_ttc), `${le} : même TTC que le devis`);
          await db.query("rollback to savepoint un_jour");
        }
      });
    });
  }

  // Périmètre ouvert : la montée se règle par la facture du jour, sur sa période d'avance (l'échéance
  // de la société, pas la fin du mois civil). Le devis ne devine pas ce montant : il se tait, et ne
  // dit que le prix plein (relevé de #381).
  it("périmètre « PME » ouvert : le devis ne chiffre pas l'acompte, il dit le prix plein", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "basic", "2026-11-01");
      await ouvrirLePerimetrePme(db, d);
      const devis = await devisDu(db, d, "team", "2026-11-13");
      assert.ok(devis);
      assert.equal(devis.a_regler_ht, null);
      assert.equal(devis.a_regler_ttc, null);
      assert.ok(devis.prix_plein_ttc, "le prix plein reste dit");
    });
  });

  it("le prix plein des mois suivants est celui que la grille affiche pour l'offre", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "solo", "2026-11-01");
      const devis = await devisDu(db, d, "team", "2026-11-13");
      const { rows } = await enPersonne(db, d.titulaire, () =>
        db.query<{ ttc: string }>(
          "select prix_ttc::text as ttc from public.mes_offres($1, $2::date) where code = 'team'",
          [d.tenant, "2026-11-13"],
        ),
      );
      assert.ok(devis?.prix_plein_ttc);
      assert.equal(mm(devis.prix_plein_ttc), mm(rows[0]!.ttc));
    });
  });

  it("pas de devis pour une descente, pour l'offre en cours, ni pour qui n'est pas titulaire", async () => {
    await aBlanc(async (db) => {
      const d = await decor(db, "team", "2026-11-01");
      assert.equal(await devisDu(db, d, "solo", "2026-11-13"), null, "descente");
      assert.equal(await devisDu(db, d, "team", "2026-11-13"), null, "même offre");
      const autre = await decor(db, "solo", "2026-11-01");
      const { rows } = await enPersonne(db, d.titulaire, () =>
        db.query<{ r: Devis | null }>("select public.montee_devis('team', $1) as r", [
          autre.tenant,
        ]),
      );
      assert.equal(rows[0]!.r, null, "la société d'un autre n'est pas chiffrée");
    });
  });
});
