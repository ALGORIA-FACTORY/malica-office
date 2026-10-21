/**
 * Le plafond de lectures se décide sur les VRAIES valeurs.
 *
 * `consommation_v` et `droits_v` sont `security_invoker` (voir
 * `une-vue-ne-contourne-pas-l-isolation.test.ts`) : lues par un collaborateur,
 * elles ne rendent rien de `facturation.licences`, que seuls le titulaire et
 * la plateforme lisent. Une fonction qui DÉCIDE d'une lecture ne peut pas
 * dépendre de ce que voit celui qui la demande.
 *
 * Les quatre scénarios ci-dessous ont été mesurés en défaut par la relecture :
 * le collaborateur d'une organisation au plafond était AUTORISÉ (échec passé de
 * fermé à ouvert), et le titulaire qui avait payé un supplément restait BLOQUÉ.
 *
 * Tout se passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

/** Les lectures du Basic, lues dans la grille en vigueur. */
let FORFAIT = 0;

interface Cabinet {
  dirigeant: string;
  collaborateur: string;
  tenant: string;
  licence: string | null;
  /** La pièce dont on demande la lecture, hors forfait déjà compté. */
  piece: string;
}

async function nouvellePiece(
  db: pg.PoolClient,
  tenant: string,
  auteur: string,
  cle: string,
  vis: "entite" | "partage" = "entite",
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into capture.pieces
       (tenant_id, vis, source, storage_path, idempotency_key, created_by)
     values ($1, $4::app.vis_t, 'photo', $2, $2, $3) returning id`,
    [tenant, cle, auteur, vis],
  );
  return rows[0]!.id;
}

/**
 * Une organisation `basic` (FORFAIT lectures, lu dans la grille) avec son dirigeant et un collaborateur.
 * `consommees` lectures sont déjà comptées ; `avecLicence` false la laisse sans licence.
 */
async function monter(
  db: pg.PoolClient,
  options: { consommees: number; avecLicence?: boolean; suspendue?: boolean },
): Promise<Cabinet> {
  const dirigeant = randomUUID();
  const collaborateur = randomUUID();
  const org = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Plafond d''essai', 'TN', 'TND') returning id`,
  );
  const tenant = org.rows[0]!.id;
  await db.query(
    `insert into identity.memberships (tenant_id, user_id, role)
     values ($1, $2, 'dirigeant'), ($1, $3, 'collaborateur')`,
    [tenant, dirigeant, collaborateur],
  );

  let licence: string | null = null;
  if (options.avecLicence !== false) {
    licence = randomUUID();
    await db.query(
      `insert into facturation.licences
         (id, titulaire, offre_code, offre_depuis, statut, suspendue_le, motif_suspension)
       values ($1, $2, 'basic', current_date, $3, $4, $5)`,
      [
        licence,
        dirigeant,
        options.suspendue ? "suspendue" : "active",
        options.suspendue ? new Date().toISOString() : null,
        options.suspendue ? "impaye" : null,
      ],
    );
    await db.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [licence, tenant],
    );
    for (let i = 0; i < options.consommees; i++) {
      const piece = await nouvellePiece(db, tenant, dirigeant, `deja-${i}`);
      await db.query(
        `insert into facturation.lectures
           (tenant_id, licence_id, piece_id, periode, consommee_par)
         values ($1, $2, $3, date_trunc('month', current_date)::date, $4)`,
        [tenant, licence, piece, dirigeant],
      );
    }
  }
  const piece = await nouvellePiece(db, tenant, dirigeant, "a-lire");
  return { dirigeant, collaborateur, tenant, licence, piece };
}

/**
 * Un cabinet, son expert, et son mandat sur la PME.
 *
 * `actif` ouvre `app.engaged_orgs()` ; `propose` ne l'ouvre pas — c'est le
 * témoin, et il doit rester refusé en lecture comme en écriture.
 */
async function cabinetSur(
  db: pg.PoolClient,
  pme: string,
  statut: "actif" | "propose",
): Promise<string> {
  const org = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('cabinet', 'Cabinet d''essai', 'TN', 'TND') returning id`,
  );
  const expert = randomUUID();
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')",
    [org.rows[0]!.id, expert],
  );
  await db.query(
    `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on)
     values ($1, $2, $3, current_date - 1)`,
    [org.rows[0]!.id, pme, statut],
  );
  return expert;
}

/**
 * Endosse `authenticated` sous l'identité donnée, le temps du corps.
 *
 * Le point de reprise n'est pas un ornement : une écriture refusée annule la
 * transaction, et le `reset role` qui suit échoue alors sur « la transaction est
 * annulée ». C'est CE message-là que le rouge montrerait, à la place de l'erreur
 * qui a tout déclenché — un rouge illisible est un rouge qui ne sert à rien.
 */
async function sous<T>(db: pg.PoolClient, identite: string, corps: () => Promise<T>): Promise<T> {
  await db.query("savepoint sous_role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [identite]);
  // Ce test joue le serveur : la marque d'origine que les déclencheurs exigent.
  await db.query("select set_config('malica.origine', 'serveur', true)");
  try {
    return await corps();
  } catch (erreur) {
    try {
      await db.query("rollback to savepoint sous_role");
    } catch {
      /* la transaction est perdue : l'erreur d'origine reste la seule à dire */
    }
    throw erreur;
  } finally {
    try {
      await db.query("reset role");
    } catch {
      /* idem */
    }
  }
}

async function verdict(
  db: pg.PoolClient,
  identite: string,
  piece: string,
): Promise<Record<string, unknown>> {
  return sous(db, identite, async () => {
    const { rows } = await db.query<{ v: Record<string, unknown> }>(
      "select public.lecture_autorisee($1) as v",
      [piece],
    );
    return rows[0]!.v;
  });
}

describe("le plafond de lectures ne se contourne pas", { skip: !ADMIN }, () => {
  // Le droit du Basic n'est pas écrit ici : la grille en vigueur le donne.
  before(async () => {
    const { rows } = await pool!.query<{ n: number }>(
      "select lectures_par_organisation as n from ref.offre_a('basic', current_date)",
    );
    FORFAIT = Number(rows[0]!.n);
    assert.ok(FORFAIT > 1);
  });

  after(async () => {
    await pool?.end();
  });

  async function dansUneTransaction(corps: (db: pg.PoolClient) => Promise<void>): Promise<void> {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      await corps(db);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }

  it("un collaborateur d'une organisation au plafond est refusé comme son dirigeant", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: FORFAIT });
      const dirigeant = await verdict(db, c.dirigeant, c.piece);
      const collaborateur = await verdict(db, c.collaborateur, c.piece);

      assert.equal(dirigeant["autorisee"], false);
      assert.equal(dirigeant["motif"], "plafond_atteint");
      assert.equal(collaborateur["autorisee"], false, "le collaborateur ne doit pas être autorisé");
      assert.equal(collaborateur["motif"], dirigeant["motif"]);
      assert.equal(collaborateur["droit"], FORFAIT);
    });
  });

  it("le collaborateur d'une licence suspendue est refusé comme son dirigeant", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: 0, suspendue: true });
      const dirigeant = await verdict(db, c.dirigeant, c.piece);
      const collaborateur = await verdict(db, c.collaborateur, c.piece);

      assert.equal(dirigeant["autorisee"], false);
      assert.equal(dirigeant["motif"], "licence_suspendue");
      assert.equal(collaborateur["autorisee"], false, "le collaborateur ne doit pas être autorisé");
      assert.equal(collaborateur["motif"], "licence_suspendue");
    });
  });

  it("un supplément accordé est compté : 50 de plus, le droit réel monte de 50, le forfait consommé", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: FORFAIT });
      await db.query(
        `insert into plateforme.interventions (licence_id, acte, motif, valeur, operateur)
         values ($1, 'supplement_lectures', 'supplément payé', 50, $2)`,
        [c.licence, randomUUID()],
      );

      for (const [qui, identite] of [
        ["le titulaire", c.dirigeant],
        ["un collaborateur", c.collaborateur],
      ] as const) {
        const v = await verdict(db, identite, c.piece);
        assert.equal(v["autorisee"], true, `${qui} : le supplément payé doit débloquer`);
        assert.equal(
          v["droit"],
          FORFAIT + 50,
          `${qui} : le droit réel est le forfait plus le supplément`,
        );
        assert.equal(v["restantes"], 50);
      }
    });
  });

  it("une organisation sans licence est refusée explicitement, jamais autorisée par défaut", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: 0, avecLicence: false });
      for (const identite of [c.dirigeant, c.collaborateur]) {
        const v = await verdict(db, identite, c.piece);
        assert.equal(v["autorisee"], false);
        assert.equal(v["motif"], "organisation_sans_licence");
      }
    });
  });

  it("la fonction n'est pas une sonde : un étranger à l'organisation n'apprend rien", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: FORFAIT });
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [randomUUID()]);
      // Ce test joue le serveur : la marque d'origine que les déclencheurs exigent.
      await db.query("select set_config('malica.origine', 'serveur', true)");
      await db.query("savepoint avant");
      await assert.rejects(
        db.query("select public.lecture_autorisee($1)", [c.piece]),
        /piece introuvable ou non autorisee/,
      );
      await db.query("rollback to savepoint avant");
      await db.query("reset role");
    });
  });

  /**
   * Les deux lecteurs qui ne sont PAS membres de l'organisation.
   *
   * `app.piece_lisible` leur ouvre la pièce par deux chemins nommés : le mandat
   * actif pour une pièce `partage`, la réquisition approuvée pour la
   * plateforme. Aucune épreuve ne disait ce que le plafond leur répond — et un
   * plafond qui ne mord que les membres n'est pas un plafond.
   *
   * Le verdict mesuré est celui de la licence DU CLIENT, pour les deux. C'est
   * cohérent : la licence qui paie est celle du dossier lu, pas celle du
   * lecteur, et c'est aussi ce que dit la politique de lecture.
   *
   * Pour l'expert engagé, la politique d'ÉCRITURE doit dire la même chose que
   * le verdict. Elle ne le disait pas : il recevait `autorisee: true` et
   * `lecture_consommer` échouait en 42501, parce que le `with check` n'admettait
   * que `app.member_orgs()`. Feu vert, appel payant du modèle, inscription qui
   * casse — le pire des trois. La section 9 de `20261019150000` l'admet, pour
   * une pièce `partage` et sur la licence du client.
   */
  it("un expert de cabinet engagé compte sa lecture sur la licence du client", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: 0 });
      const partagee = await nouvellePiece(db, c.tenant, c.dirigeant, "partagee", "partage");
      const expert = await cabinetSur(db, c.tenant, "actif");

      await sous(db, expert, async () => {
        const { rows } = await db.query<{ v: Record<string, unknown> }>(
          "select public.lecture_consommer($1) as v",
          [partagee],
        );
        assert.equal(rows[0]!.v["autorisee"], true, "l'expert engagé doit pouvoir faire compter");
        assert.equal(rows[0]!.v["motif"], "relecture_gratuite", "la pièce vient d'être comptée");
      });

      const { rows } = await db.query<{ tenant_id: string; licence_id: string }>(
        "select tenant_id, licence_id from facturation.lectures where piece_id = $1",
        [partagee],
      );
      assert.equal(rows.length, 1, "une ligne, et une seule");
      assert.equal(rows[0]!.tenant_id, c.tenant, "imputée au dossier du client");
      assert.equal(rows[0]!.licence_id, c.licence, "et à la licence du client");
    });
  });

  it("un expert de cabinet engagé reste refusé au plafond, et rien ne s'inscrit", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: FORFAIT });
      const partagee = await nouvellePiece(db, c.tenant, c.dirigeant, "partagee", "partage");
      const expert = await cabinetSur(db, c.tenant, "actif");

      const v = await verdict(db, expert, partagee);
      assert.equal(v["autorisee"], false, "l'expert engagé ne passe pas le plafond du client");
      assert.equal(v["motif"], "plafond_atteint");
      assert.equal(v["droit"], FORFAIT, "le droit est celui de la licence du client");
      assert.equal(v["restantes"], 0);

      await sous(db, expert, async () => {
        await db.query("savepoint avant");
        await assert.rejects(
          db.query("select public.lecture_consommer($1)", [partagee]),
          /lecture refusee : plafond_atteint/,
        );
        await db.query("rollback to savepoint avant");
      });

      const { rows } = await db.query("select 1 from facturation.lectures where piece_id = $1", [
        partagee,
      ]);
      assert.equal(rows.length, 0, "aucune lecture ne doit être comptée");
    });
  });

  it("un expert de cabinet NON engagé est refusé en lecture comme en écriture", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: 0 });
      const partagee = await nouvellePiece(db, c.tenant, c.dirigeant, "partagee", "partage");
      // Mandat seulement PROPOSÉ : `app.engaged_orgs()` ne le rend pas.
      const expert = await cabinetSur(db, c.tenant, "propose");

      await sous(db, expert, async () => {
        await db.query("savepoint avant_lecture");
        await assert.rejects(
          db.query("select public.lecture_autorisee($1)", [partagee]),
          /piece introuvable ou non autorisee/,
        );
        await db.query("rollback to savepoint avant_lecture");

        await db.query("savepoint avant_ecriture");
        await assert.rejects(
          db.query(
            `insert into facturation.lectures (tenant_id, licence_id, piece_id, periode)
             values ($1, $2, $3, date_trunc('month', current_date)::date)`,
            [c.tenant, c.licence, partagee],
          ),
          (e: { code?: string }) => {
            assert.equal(e.code, "42501", "le refus doit venir de la politique d'écriture");
            return true;
          },
          "un cabinet sans mandat actif n'inscrit rien",
        );
        await db.query("rollback to savepoint avant_ecriture");
      });

      const { rows } = await db.query("select 1 from facturation.lectures where piece_id = $1", [
        partagee,
      ]);
      assert.equal(rows.length, 0);
    });
  });

  it("un opérateur de plateforme sous réquisition reçoit le verdict du client", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: FORFAIT });
      const operateur = randomUUID();
      await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
      await db.query(
        `insert into plateforme.requisitions
           (tenant_id, autorite, reference, portee, motif, close_le,
            depose_par, approuve_par, approuve_le)
         values ($1, 'justice', 'REQ-essai', 'pieces', 'instruction',
                 now() + interval '1 day', $2, $3, now())`,
        [c.tenant, randomUUID(), operateur],
      );

      const v = await verdict(db, operateur, c.piece);
      assert.equal(v["autorisee"], false, "la réquisition ne lève pas le plafond du client");
      assert.equal(v["motif"], "plafond_atteint");
      assert.equal(v["droit"], FORFAIT);
    });
  });

  it("lecture_consommer refuse le collaborateur au plafond et ne compte rien", async () => {
    await dansUneTransaction(async (db) => {
      const c = await monter(db, { consommees: FORFAIT });
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [c.collaborateur]);
      // Ce test joue le serveur : la marque d'origine que les déclencheurs exigent.
      await db.query("select set_config('malica.origine', 'serveur', true)");
      await db.query("savepoint avant");
      await assert.rejects(
        db.query("select public.lecture_consommer($1)", [c.piece]),
        /lecture refusee : plafond_atteint/,
      );
      await db.query("rollback to savepoint avant");
      await db.query("reset role");

      const { rows } = await db.query("select 1 from facturation.lectures where piece_id = $1", [
        c.piece,
      ]);
      assert.equal(rows.length, 0, "aucune lecture ne doit être comptée");
    });
  });
});
