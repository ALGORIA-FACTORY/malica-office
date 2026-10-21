/**
 * Le plafond arrête la LECTURE, jamais la CAPTURE.
 *
 * ================================================= CE QUE LA RÈGLE PROMET
 *
 * Une licence Basic donne 65 lectures par mois. La 65ᵉ passe, la 66ᵉ ne passe
 * pas — mais la 66ᵉ pièce existe : elle est enregistrée, rangée, retrouvable.
 * Ce que le plafond refuse est l'appel payant au modèle, jamais la photo. On ne
 * refuse pas à quelqu'un de photographier sa facture, et c'est la ligne que
 * l'audit souligne : un plafond qui bloquerait la capture ferait perdre le
 * document, alors que seul son déchiffrement a un coût.
 *
 * Mesuré le 18 octobre 2026 sur 64 pièces déjà lues, licence Basic :
 *
 *     65ᵉ pièce  → autorisee=true   motif=dans_le_forfait   restantes=1
 *     66ᵉ pièce  → autorisee=false  motif=plafond_atteint   restantes=0
 *     relecture  → autorisee=true   motif=relecture_gratuite
 *     pièces en base = 66, dont comptées = 65
 *
 * ================================================= CE QUE L'ÉPREUVE NE REPREND PAS
 *
 * La licence suspendue, l'organisation sans licence, le collaborateur et le
 * supplément accordé sont tenus par `le-plafond-ne-se-contourne-pas.test.ts`,
 * née de la ronde de correction 3. Sa question est le CONTOURNEMENT ; celle-ci
 * est la RÈGLE COMMERCIALE. Deux épreuves jumelles sur la même fonction seraient
 * un doublon, et leurs fixtures divergeraient en silence.
 *
 * `authenticated` n'a plus le droit d'écrire dans `facturation.lectures` : seule
 * `public.lecture_consommer` y inscrit. Le décor des 64 lectures déjà comptées
 * est donc monté sous `postgres`, et la 65ᵉ passe par la vraie porte.
 *
 *   node --experimental-strip-types --test src/facturation/le-plafond-arrete-la-lecture-pas-la-capture.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "../auth.ts";
import { fermerLePool, sousIdentiteDuServeur } from "../db.ts";
import { executerRpc } from "../rpc.ts";

import { matriculeDEssai } from "../matricule-d-essai.ts";
const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

/** Le forfait Basic : 65 lectures par mois quand l'audit l'a mesuré. */
// Depuis la grille du 19 octobre, le droit n'est plus écrit ici : la base le
// donne (licence née avec la société, Basic d'office), l'épreuve le lit.
let FORFAIT = 0;

type Verdict = {
  autorisee: boolean;
  motif: string;
  restantes: number | null;
  droit: number | null;
};

describe(
  "le plafond de lectures arrête la lecture, pas la capture",
  { skip: !BASE_CONFIGUREE },
  () => {
    const marque = `plafond-${Date.now()}`;
    let u: Utilisateur;
    let org = "";
    let licence = "";

    /** La 65ᵉ : la dernière du forfait, celle qui passe. */
    let derniere = "";
    /** La 66ᵉ : la première au-delà. */
    let auDela = "";
    /** Le verdict de la 65ᵉ, pris AVANT qu'elle soit comptée : après, c'est une relecture. */
    let avantLaDerniere: Verdict;

    const admin = async <T>(f: (p: pg.Pool) => Promise<T>) => {
      const p = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
      try {
        return await f(p);
      } finally {
        await p.end();
      }
    };

    async function deposer(cle: string, vis: "personnel" | "partage"): Promise<string> {
      const p = (await sousIdentiteDuServeur(u.id, (db) =>
        executerRpc(
          db,
          {
            depot: "capture",
            methode: "enregistrer",
            args: [
              {
                tenantId: org,
                source: "photo",
                vis,
                idempotencyKey: `${marque}-${cle}`,
                contentType: "image/jpeg",
                pageCount: 1,
              },
            ],
          },
          "serveur",
        ),
      )) as { id: string };
      return p.id;
    }

    const verdict = (piece: string) =>
      sousIdentiteDuServeur(u.id, async (db) => {
        const { rows } = await db.query<{ v: Verdict }>(
          "select public.lecture_autorisee($1) as v",
          [piece],
        );
        return rows[0]!.v;
      });

    const compter = (sql: string, params: unknown[]) =>
      admin(async (p) => {
        const { rows } = await p.query<{ n: string }>(sql, params);
        return Number(rows[0]!.n);
      });

    before(async () => {
      const c = await creerCompte(`${marque}@essai.local`, "MotDePasseTresLong2026!");
      assert.ok(c);
      u = c;
      org = await sousIdentiteDuServeur(u.id, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `select public.create_organization('pme', 'ALGORIA FACTORY SUARL', 'autonome',
                                           '${matriculeDEssai("A", "M")}', 'TN', 'TND') as id`,
        );
        return rows[0]!.id;
      });

      // Toutes les pièces du forfait déjà comptées, moins une.
      licence = await admin(async (p) => {
        const { rows } = await p.query<{ id: string; droit: number }>(
          `select lo.licence_id as id, c.lectures_droit as droit
             from facturation.licence_organisations lo
             join facturation.consommation_v c on c.licence_id = lo.licence_id
            where lo.tenant_id = $1`,
          [org],
        );
        assert.ok(rows[0], "la société est née sans licence");
        const id = rows[0]!.id;
        FORFAIT = Number(rows[0]!.droit);
        assert.ok(FORFAIT > 1, "le forfait de naissance donne des lectures");
        await p.query(
          `with neuves as (
           insert into capture.pieces
             (tenant_id, vis, source, storage_path, status, idempotency_key, created_by)
           select $1, 'partage', 'photo', 'q/' || i, 'lue', $3 || '-deja-' || i, $2
             from generate_series(1, $4::int) as i
           returning id
         )
         insert into facturation.lectures (tenant_id, licence_id, piece_id, periode, consommee_par)
         select $1, $5, id, date_trunc('month', current_date)::date, $2 from neuves`,
          [org, u.id, marque, FORFAIT - 1, id],
        );
        return id;
      });

      derniere = await deposer("65e", "partage");
      auDela = await deposer("66e", "partage");

      // Le décor est monté une fois, au plafond : 65 comptées sur 65. La 65ᵉ
      // passe par la vraie porte, et son verdict « sous le plafond » est mesuré
      // juste avant — chaque épreuve peut alors se lancer seule.
      avantLaDerniere = await verdict(derniere);
      await sousIdentiteDuServeur(u.id, (db) =>
        db.query("select public.lecture_consommer($1)", [derniere]),
      );
    });

    after(async () => {
      await admin((p) =>
        p.query(
          `update identity.organizations set archived_at = now(),
                archived_reason = 'fixture de test automatisé' where id = $1`,
          [org],
        ),
      );
      await fermerLePool();
    });

    it("le décor est celui de l'audit : 65 lectures comptées sur 65", async () => {
      assert.equal(
        await compter("select count(*) as n from facturation.lectures where licence_id = $1", [
          licence,
        ]),
        FORFAIT,
      );
    });

    it("sous le plafond, la lecture est autorisée : la 65ᵉ passe, il en reste une", async () => {
      const v = avantLaDerniere;
      assert.equal(v.autorisee, true);
      assert.equal(v.motif, "dans_le_forfait");
      assert.equal(v.restantes, 1);
      assert.equal(v.droit, FORFAIT);
    });

    it("au plafond, la lecture est refusée avec son motif : la 66ᵉ ne passe pas", async () => {
      const v = await verdict(auDela);
      assert.equal(v.autorisee, false);
      assert.equal(v.motif, "plafond_atteint");
      assert.equal(v.restantes, 0);
      assert.equal(v.droit, FORFAIT);
    });

    it("un refus au plafond ne compte rien", async () => {
      // `lecture_consommer` porte la règle ; un refus qui inscrirait quand même
      // la lecture ferait payer ce qu'on vient de refuser.
      await assert.rejects(
        sousIdentiteDuServeur(u.id, (db) =>
          db.query("select public.lecture_consommer($1)", [auDela]),
        ),
        /lecture refusee : plafond_atteint/,
      );
      assert.equal(
        await compter("select count(*) as n from facturation.lectures where piece_id = $1", [
          auDela,
        ]),
        0,
      );
      assert.equal(
        await compter("select count(*) as n from facturation.lectures where licence_id = $1", [
          licence,
        ]),
        FORFAIT,
      );
    });

    it("relire une pièce déjà comptée est gratuit, même au plafond", async () => {
      // C'est la correction gratuite, et elle est voulue : le client qui relit
      // sa 65ᵉ pièce parce que la photo était floue ne paie pas deux fois.
      const v = await verdict(derniere);
      assert.equal(v.autorisee, true);
      assert.equal(v.motif, "relecture_gratuite");
      assert.equal(v.restantes, 0);
    });

    it("la capture n'est JAMAIS bloquée : au plafond, la pièce s'enregistre quand même", async () => {
      /*
       * La règle que l'audit souligne. Le plafond arrête l'œil, pas la caméra :
       * la 66ᵉ pièce a bien été enregistrée plus haut, et une 67ᵉ l'est aussi,
       * alors que le verdict est « plafond atteint ». On ne refuse jamais à
       * quelqu'un de photographier sa facture.
       */
      const suivante = await deposer("67e", "partage");
      assert.ok(suivante, "l'enregistrement rend une pièce");

      const v = await verdict(suivante);
      assert.equal(v.autorisee, false, "elle ne se lira pas…");
      assert.equal(v.motif, "plafond_atteint");

      assert.equal(
        await compter("select count(*) as n from capture.pieces where id = $1", [suivante]),
        1,
        "… mais elle existe",
      );
      // 64 déjà là + la 65ᵉ + la 66ᵉ + la 67ᵉ.
      assert.equal(
        await compter("select count(*) as n from capture.pieces where tenant_id = $1", [org]),
        FORFAIT + 2,
      );
      assert.equal(
        await compter("select count(*) as n from facturation.lectures where licence_id = $1", [
          licence,
        ]),
        FORFAIT,
        "et le compteur n'a pas bougé",
      );
    });

    it("une pièce personnelle rend son motif : elle ne se lit jamais", async () => {
      /*
       * Une pièce gardée pour soi n'est pas lue par Malica, plafond ou non : la
       * lire serait la sortir de l'espace privé. Le motif est donc celui de la
       * pièce, pas celui du compteur — même quand le compteur est plein.
       */
      const privee = await deposer("privee", "personnel");
      const v = await verdict(privee);
      assert.equal(v.autorisee, false);
      assert.equal(v.motif, "piece_personnelle");
      assert.equal(v.restantes, null);
      assert.equal(v.droit, null);
    });
  },
);
