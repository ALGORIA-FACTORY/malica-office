/**
 * Une société de plus rejoint la licence de son propriétaire (recette du
 * 13 novembre 2026, A3).
 *
 * « Ajouter une société » faisait naître une licence Basic neuve : le
 * propriétaire de Premium (« 2 sociétés incluses ») payait deux licences.
 * Désormais la seconde société rejoint SA licence ; la troisième aussi, au
 * prix de la société en plus que lit la facturation dans `ref.offres` ; une
 * offre à une société (plafond atteint) fait naître une licence, comme
 * avant ; et l'invitation d'une comptabilité ne dépasse jamais l'inclus.
 * Les prix et les plafonds se lisent dans la base ; rien n'est écrit ici.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/facturation/une-societe-de-plus-rejoint-la-licence.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

import { matriculeDEssai } from "../matricule-d-essai.ts";
import { personnesDEssai } from "../personne-d-essai.ts";
import { enPersonne } from "./decor-de-facture.ts";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

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

/** Le propriétaire crée une société par la porte qu'ouvre l'écran, et rend son identifiant. */
const creerSociete = (db: pg.PoolClient, qui: string, nom: string) =>
  enPersonne(db, qui, async () => {
    const { rows } = await db.query<{ id: string }>(
      `select public.create_organization('pme', $1, 'autonome', $2, j.jurisdiction, j.currency) as id
         from (select distinct on (jurisdiction) jurisdiction, currency
                 from ref.jurisdiction_packs order by jurisdiction, effective_from desc limit 1) j`,
      [nom, matriculeDEssai("A", "M")],
    );
    return rows[0]!.id;
  });

const licencesDe = async (db: pg.PoolClient, qui: string) =>
  (
    await db.query<{ id: string; organisations: number; offre: string; prix: string }>(
      `select licence_id as id, organisations, offre_code as offre, prix_offre_ht::text as prix
         from facturation.droits_v where titulaire = $1 order by licence_id`,
      [qui],
    )
  ).rows;

const grille = async (db: pg.PoolClient, offre: string) =>
  (
    await db.query<{ incluses: number; max: number | null; sup: string }>(
      `select organisations_incluses as incluses, organisations_max as max,
              prix_organisation_sup::text as sup
         from ref.offre_a($1, current_date)`,
      [offre],
    )
  ).rows[0]!;

/** Une licence Premium au nom du propriétaire, par la porte (la naissance est Basic). */
async function enPremium(db: pg.PoolClient, qui: string, tenant: string) {
  await enPersonne(db, qui, () =>
    db.query("select public.forfait_changer('premium', $1)", [tenant]),
  );
}

describe("une société de plus rejoint la licence de son propriétaire", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("Premium : la seconde société rejoint la licence, sans licence neuve, sans rien de plus à payer", async () => {
    await aBlanc(async (db) => {
      const qui = randomUUID();
      await personnesDEssai(db, qui);
      const premiere = await creerSociete(db, qui, "Première société");
      await enPremium(db, qui, premiere);
      const g = await grille(db, "premium");
      assert.ok(g.incluses >= 2, "Premium inclut au moins deux sociétés (la grille le dit)");

      const seconde = await creerSociete(db, qui, "Seconde société");
      const l = await licencesDe(db, qui);
      assert.equal(l.length, 1, "une seule licence : celle du propriétaire");
      assert.equal(l[0]!.organisations, 2);
      assert.equal(l[0]!.offre, "premium");
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from facturation.licence_organisations where tenant_id = $1 and licence_id = $2",
        [seconde, l[0]!.id],
      );
      assert.equal(rows[0]!.n, 1, "la seconde société est sur la licence de la première");
    });
  });

  it("au-delà de l'inclus, la société rejoint encore la licence, au prix de la société en plus de la grille", async () => {
    await aBlanc(async (db) => {
      const qui = randomUUID();
      await personnesDEssai(db, qui);
      const premiere = await creerSociete(db, qui, "Première société");
      await enPremium(db, qui, premiere);
      const g = await grille(db, "premium");
      assert.ok(g.max === null || g.max > g.incluses, "la grille laisse une société de plus");
      for (let i = 2; i <= g.incluses + 1; i++) await creerSociete(db, qui, `Société ${i}`);
      const l = await licencesDe(db, qui);
      assert.equal(l.length, 1, "toujours une seule licence");
      assert.equal(l[0]!.organisations, g.incluses + 1);
      const { rows } = await db.query<{ offre: string; total: string }>(
        `select prix_offre_ht::text as offre, prix_total_ht::text as total
           from facturation.periodes_v
          where licence_id = $1 and du <= current_date and (au_exclu is null or au_exclu > current_date)`,
        [l[0]!.id],
      );
      assert.equal(
        Math.round(Number(rows[0]!.total) * 1000),
        Math.round((Number(rows[0]!.offre) + Number(g.sup)) * 1000),
        "le prix du jour : l'offre + une société en plus, lus dans la grille",
      );
      assert.ok(Number(g.sup) > 0, "la société en plus a un prix en base");
    });
  });

  // Revue de #388 : la licence qui accueille n'est pas forcément celle de la société ouverte. Le devis
  // de l'écran lit la MÊME règle que la porte qui rattache.
  it("le devis dit la licence qui accueille vraiment la société, celle que la porte choisit", async () => {
    await aBlanc(async (db) => {
      const qui = randomUUID();
      await personnesDEssai(db, qui);
      await creerSociete(db, qui, "Première société"); // Basic, pleine (une société)
      const seconde = await creerSociete(db, qui, "Seconde société"); // sa propre licence Basic
      await enPremium(db, qui, seconde);
      const g = await grille(db, "premium");

      const devis = await enPersonne(db, qui, async () => {
        const { rows } = await db.query<{
          r: {
            offre: string;
            organisations: number;
            organisations_incluses: number;
            prix_organisation_sup: string;
          } | null;
        }>("select public.societe_en_plus_devis() as r");
        return rows[0]!.r;
      });
      assert.ok(devis, "une licence accueille");
      assert.equal(
        devis.offre,
        "premium",
        "le Premium, pas la licence Basic de la première société",
      );
      assert.equal(devis.organisations, 1);
      assert.equal(devis.organisations_incluses, g.incluses);
      assert.equal(Number(devis.prix_organisation_sup), Number(g.sup));

      const troisieme = await creerSociete(db, qui, "Troisième société");
      const { rows } = await db.query<{ offre: string }>(
        `select d.offre_code as offre
           from facturation.licence_organisations lo
           join facturation.droits_v d on d.licence_id = lo.licence_id
          where lo.tenant_id = $1`,
        [troisieme],
      );
      assert.equal(
        rows[0]!.offre,
        devis.offre,
        "la porte rattache à la licence que le devis a dite",
      );
    });
  });

  it("aucune licence n'accueille : le devis est vide, la société aura sa propre licence", async () => {
    await aBlanc(async (db) => {
      const qui = randomUUID();
      await personnesDEssai(db, qui);
      await creerSociete(db, qui, "Première société"); // Basic : une société, plafond atteint
      const devis = await enPersonne(db, qui, async () => {
        const { rows } = await db.query<{ r: unknown }>(
          "select public.societe_en_plus_devis() as r",
        );
        return rows[0]!.r;
      });
      assert.equal(devis, null);
    });
  });

  it("une offre à une société (Basic) : la seconde naît sur sa propre licence, comme avant", async () => {
    await aBlanc(async (db) => {
      const qui = randomUUID();
      await personnesDEssai(db, qui);
      await creerSociete(db, qui, "Première société");
      const g = await grille(db, (await licencesDe(db, qui))[0]!.offre);
      assert.equal(g.max, 1, "la grille de départ ne porte qu'une société");
      await creerSociete(db, qui, "Seconde société");
      const l = await licencesDe(db, qui);
      assert.equal(l.length, 2, "deux licences : l'offre ne porte pas une société de plus");
    });
  });

  it("recréer la même société (même matricule) ne la rattache pas une seconde fois", async () => {
    await aBlanc(async (db) => {
      const qui = randomUUID();
      await personnesDEssai(db, qui);
      const mf = matriculeDEssai("A", "M");
      const creer = () =>
        enPersonne(
          db,
          qui,
          async () =>
            (
              await db.query<{ id: string }>(
                `select public.create_organization('pme', 'Même société', 'autonome', $1, j.jurisdiction, j.currency) as id
                 from (select jurisdiction, currency from ref.jurisdiction_packs
                        order by effective_from desc limit 1) j`,
                [mf],
              )
            ).rows[0]!.id,
        );
      const [a, b] = [await creer(), await creer()];
      assert.equal(a, b);
      assert.equal((await licencesDe(db, qui)).length, 1);
    });
  });
});
