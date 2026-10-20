/**
 * Une lecture s'impute à la licence de SON organisation, et personne ne
 * l'inscrit à la main.
 *
 * Trois rondes se lisent dans ce fichier, et il faut les lire dans cet ordre
 * pour comprendre pourquoi la table finit sans écrivain.
 *
 * RONDE 4 — `facturation_lectures_ins` ne vérifiait que
 * `tenant_id in app.member_orgs()` : `licence_id` et `piece_id` étaient libres,
 * et un collaborateur au plafond s'inscrivait une lecture portant LA LICENCE
 * D'UN TIERS. `lecture_autorisee` prend l'existence d'une ligne pour une preuve
 * de comptage (`relecture_gratuite`) : le plafond tombait, et le quota du tiers
 * avec. La politique lie désormais licence et pièce au tenant.
 *
 * RONDE 5 — la même politique a été élargie à tout membre d'un cabinet engagé,
 * sur une pièce `partage`, parce que le verdict, lui, autorisait déjà.
 *
 * RONDE 6 — le désaccord INVERSE, trouvé par la relecture : la politique ne
 * connaît pas le plafond. À 65/65, le verdict dit `plafond_atteint` et
 * l'insertion directe passait quand même — licence à 66, puis
 * `relecture_gratuite`. Une lecture comptée que personne n'avait autorisée.
 *
 * Encoder le plafond dans le `with check` aurait écrit la règle à DEUX
 * endroits, et deux copies d'une règle divergent toujours. `authenticated`
 * perd donc le droit d'écrire : `public.lecture_consommer` est la seule porte,
 * et c'est elle qui porte la règle.
 *
 * Le `with check` reste, et ce fichier continue de l'éprouver : les trois
 * dernières épreuves rendent le droit d'insérer DANS LA TRANSACTION ANNULÉE,
 * pour que la politique réponde encore à ce qu'elle garde. Sans cela, le
 * travail des rondes 4 et 5 ne serait plus prouvé par aucune exécution.
 *
 * Tout se passe dans une transaction annulée : rien n'est écrit, donc rien à
 * archiver (R7).
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Cabinet {
  dirigeant: string;
  collaborateur: string;
  tenant: string;
  licence: string;
  /** Une pièce `entite` de ce tenant, non encore comptée. */
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
    [tenant, `${cle}-${randomUUID()}`, auteur, vis],
  );
  return rows[0]!.id;
}

/** Une organisation `basic` (65 lectures), son dirigeant, un collaborateur. */
async function monter(db: pg.PoolClient, consommees: number): Promise<Cabinet> {
  const dirigeant = randomUUID();
  const collaborateur = randomUUID();
  const org = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', 'Imputation d''essai', 'TN', 'TND') returning id`,
  );
  const tenant = org.rows[0]!.id;
  await db.query(
    `insert into identity.memberships (tenant_id, user_id, role)
     values ($1, $2, 'dirigeant'), ($1, $3, 'collaborateur')`,
    [tenant, dirigeant, collaborateur],
  );

  const licence = randomUUID();
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis, statut)
     values ($1, $2, 'basic', current_date, 'active')`,
    [licence, dirigeant],
  );
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, tenant],
  );

  for (let i = 0; i < consommees; i++) {
    const piece = await nouvellePiece(db, tenant, dirigeant, `deja-${i}`);
    await db.query(
      `insert into facturation.lectures
         (tenant_id, licence_id, piece_id, periode, consommee_par)
       values ($1, $2, $3, date_trunc('month', current_date)::date, $4)`,
      [tenant, licence, piece, dirigeant],
    );
  }

  const piece = await nouvellePiece(db, tenant, dirigeant, "a-lire");
  return { dirigeant, collaborateur, tenant, licence, piece };
}

/**
 * Un cabinet, son membre, et son mandat ACTIF sur la PME.
 *
 * Le rôle est `expert` : depuis le 20 octobre 2026, `app.engaged_orgs()`
 * distingue les rôles du cabinet — l'expert voit tous les dossiers engagés,
 * un collaborateur seulement ceux qu'on lui attribue.
 */
async function cabinetEngageSur(db: pg.PoolClient, pme: string): Promise<string> {
  const org = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('cabinet', 'Cabinet d''essai', 'TN', 'TND') returning id`,
  );
  const membre = randomUUID();
  // L'expert du cabinet : il voit tous les dossiers engagés. Un collaborateur
  // ne voit que ceux qu'on lui attribue (20 octobre 2026).
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'expert')",
    [org.rows[0]!.id, membre],
  );
  await db.query(
    `insert into identity.engagements (cabinet_org_id, pme_org_id, status, starts_on)
     values ($1, $2, 'actif', current_date - 1)`,
    [org.rows[0]!.id, pme],
  );
  return membre;
}

/**
 * Endosse `authenticated` sous l'identité donnée, le temps du corps.
 *
 * Le point de reprise n'est pas un ornement : une écriture refusée annule la
 * transaction, et le `reset role` qui suit échoue alors sur « la transaction est
 * annulée » — ce serait CE message que montrerait le rouge, à la place de
 * l'erreur qui a tout déclenché.
 */
async function sous<T>(db: pg.PoolClient, identite: string, corps: () => Promise<T>): Promise<T> {
  await db.query("savepoint sous_role");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [identite]);
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

const INSERER_LECTURE = `insert into facturation.lectures
    (tenant_id, licence_id, piece_id, periode)
  values ($1, $2, $3, date_trunc('month', current_date)::date)`;

/** Le nombre de lectures comptées sur une licence, pour le mois en cours. */
async function comptees(db: pg.PoolClient, licence: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from facturation.lectures
      where licence_id = $1 and periode = date_trunc('month', current_date)::date`,
    [licence],
  );
  return Number(rows[0]!.n);
}

/** Refuse, et dit pourquoi : droit absent (42501) ou politique (42501 aussi). */
function refuse(attendu: RegExp) {
  return (erreur: { code?: string; message?: string }): boolean => {
    assert.equal(erreur.code, "42501", `code attendu 42501, reçu ${erreur.code}`);
    assert.match(erreur.message ?? "", attendu);
    return true;
  };
}

/**
 * Attend le refus d'une insertion, et rend la transaction utilisable ensuite.
 *
 * Une écriture refusée annule la transaction : sans point de reprise, la
 * vérification qui SUIT — « la licence n'est pas montée à 66 » — échoue sur
 * « transaction annulée » et l'épreuve ne prouve plus rien. Le retour au point
 * de reprise rend aussi le rôle de la connexion : on n'enchaîne donc rien sous
 * l'identité éprouvée après cet appel.
 */
async function insertionRefusee(
  db: pg.PoolClient,
  lignes: [string, string, string],
  attendu: RegExp,
  message: string,
): Promise<void> {
  await db.query("savepoint avant_insertion");
  await assert.rejects(db.query(INSERER_LECTURE, lignes), refuse(attendu), message);
  await db.query("rollback to savepoint avant_insertion");
}

describe("une lecture s'impute à la bonne licence", { skip: !ADMIN }, () => {
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

  // ------------------------------------------------- RONDE 6 : un seul écrivain

  it("plus personne n'inscrit une lecture à la main, même sous le plafond", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 0);

      await sous(db, a.collaborateur, async () => {
        await insertionRefusee(
          db,
          [a.tenant, a.licence, a.piece],
          /lectures/,
          "le droit d'insérer n'existe plus pour authenticated",
        );
      });

      assert.equal(await comptees(db, a.licence), 0, "rien ne s'est inscrit");
    });
  });

  it("l'insertion directe au plafond est refusée : la licence reste à 65", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 65);

      await sous(db, a.collaborateur, async () => {
        const avant = await db.query<{ v: Record<string, unknown> }>(
          "select public.lecture_autorisee($1) as v",
          [a.piece],
        );
        assert.equal(avant.rows[0]!.v["motif"], "plafond_atteint");

        await insertionRefusee(
          db,
          [a.tenant, a.licence, a.piece],
          /lectures/,
          "au plafond, la ligne ne s'écrit pas à la main",
        );
      });

      assert.equal(await comptees(db, a.licence), 65, "la licence ne monte pas à 66");

      // Et le verdict n'a pas basculé en relecture gratuite.
      const apres = await sous(db, a.collaborateur, async () => {
        const { rows } = await db.query<{ v: Record<string, unknown> }>(
          "select public.lecture_autorisee($1) as v",
          [a.piece],
        );
        return rows[0]!.v;
      });
      assert.equal(apres["motif"], "plafond_atteint");
    });
  });

  it("un membre de cabinet engagé ne franchit pas le plafond à la main non plus", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 65);
      const partagee = await nouvellePiece(db, a.tenant, a.dirigeant, "partagee", "partage");
      const duCabinet = await cabinetEngageSur(db, a.tenant);

      await sous(db, duCabinet, async () => {
        await insertionRefusee(
          db,
          [a.tenant, a.licence, partagee],
          /lectures/,
          "le mandat n'ouvre pas une écriture directe",
        );
      });

      assert.equal(await comptees(db, a.licence), 65);
    });
  });

  it("le chemin légitime passe toujours : lecture_consommer compte une ligne", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 0);
      const partagee = await nouvellePiece(db, a.tenant, a.dirigeant, "partagee", "partage");
      const duCabinet = await cabinetEngageSur(db, a.tenant);

      for (const [qui, identite, piece] of [
        ["un membre du client", a.collaborateur, a.piece],
        ["un membre du cabinet engagé", duCabinet, partagee],
      ] as const) {
        const v = await sous(db, identite, async () => {
          const { rows } = await db.query<{ v: Record<string, unknown> }>(
            "select public.lecture_consommer($1) as v",
            [piece],
          );
          return rows[0]!.v;
        });
        assert.equal(v["autorisee"], true, `${qui} doit pouvoir faire compter`);

        const { rows } = await db.query<{ tenant_id: string; licence_id: string }>(
          "select tenant_id, licence_id from facturation.lectures where piece_id = $1",
          [piece],
        );
        assert.equal(rows.length, 1, `${qui} : une ligne, et une seule`);
        assert.equal(rows[0]!.tenant_id, a.tenant, `${qui} : imputée au dossier du client`);
        assert.equal(rows[0]!.licence_id, a.licence, `${qui} : et à sa licence`);
      }

      assert.equal(await comptees(db, a.licence), 2);
    });
  });

  // ------------------------------------- RONDES 4 ET 5 : ce que la politique garde
  //
  // Le droit d'insérer est rendu DANS la transaction annulée. Sans cela, ces
  // trois épreuves ne diraient plus rien de la politique — elles buteraient
  // avant elle, sur le droit absent — et le travail des deux rondes
  // précédentes ne serait plus prouvé par aucune exécution.

  const RLS = /politique de sécurité au niveau ligne|row-level security policy/;

  async function commeSiLeDroitRevenait(db: pg.PoolClient): Promise<void> {
    await db.query("grant insert on facturation.lectures to authenticated");
  }

  it("la politique refuse encore une ligne portant la licence d'un tiers", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 0);
      const b = await monter(db, 0);
      await commeSiLeDroitRevenait(db);

      await sous(db, a.collaborateur, async () => {
        await insertionRefusee(
          db,
          [a.tenant, b.licence, a.piece],
          RLS,
          "la licence d'un tiers ne s'impute pas",
        );
      });
      assert.equal(await comptees(db, b.licence), 0, "le quota du tiers reste intact");
    });
  });

  it("la politique refuse encore une ligne portant la pièce d'un autre tenant", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 0);
      const b = await monter(db, 0);
      await commeSiLeDroitRevenait(db);

      await sous(db, a.collaborateur, async () => {
        await insertionRefusee(
          db,
          [a.tenant, a.licence, b.piece],
          RLS,
          "la pièce d'un autre dossier ne s'impute pas ici",
        );
      });
    });
  });

  it("la politique accepte toujours le triplet légitime : son tenant, sa licence, sa pièce", async () => {
    await dansUneTransaction(async (db) => {
      const a = await monter(db, 0);
      await commeSiLeDroitRevenait(db);

      const inserees = await sous(db, a.collaborateur, async () => {
        const { rowCount } = await db.query(INSERER_LECTURE, [a.tenant, a.licence, a.piece]);
        return rowCount;
      });
      assert.equal(
        inserees,
        1,
        "une politique qui refuse tout est aussi fausse qu'une politique qui accepte tout",
      );

      const { rows } = await db.query<{ licence_id: string; tenant_id: string }>(
        "select licence_id, tenant_id from facturation.lectures where piece_id = $1",
        [a.piece],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.licence_id, a.licence);
      assert.equal(rows[0]!.tenant_id, a.tenant);
    });
  });
});
