/**
 * L'accès à la base — et la seule chose qui empêche une fuite entre cabinets.
 *
 * Le principe tient en une phrase : **l'API ne filtre pas les tenants.** Elle
 * ouvre une transaction, endosse le rôle `authenticated`, y pose l'identité de
 * l'appelant, et laisse les 190 politiques RLS décider de ce qu'il voit.
 *
 * Pourquoi ce n'est pas négociable. Si l'API se connectait en rôle privilégié
 * et écrivait `where tenant_id = $1` dans chaque requête, un oubli **ouvrirait**
 * l'accès aux données d'un autre cabinet. Avec la RLS, un oubli le **refuse**.
 * C'est le fail-closed exigé au chapitre 08 du Guide de Stack : la sécurité ne
 * dépend pas de la vigilance de celui qui écrira la prochaine requête.
 *
 * C'est aussi, exactement, ce que faisait PostgREST — `set_config` du claim
 * `sub` dans la transaction, sous le rôle `authenticated`. Les politiques n'ont
 * donc pas une ligne à changer, et `auth.uid()` reste le contrat.
 */

// `pg` est un paquet CommonJS : son interop ESM n'expose pas `Pool` en export
// nommé. On passe par l'export par défaut, les types restant importés à part.
import pg from "pg";
import type { PoolClient } from "pg";

/*
 * ============================================ UNE DATE EST UNE DATE
 *
 * Sans cela, `pg` convertit une colonne `date` en `Date` JavaScript à minuit
 * LOCAL, que la sérialisation rend en instant UTC : « 2026-09-30 » devenait
 * « 2026-09-29T23:00:00.000Z » sur un poste en UTC+1, et les écrans lisaient
 * la veille. Une date comptable n'a pas d'heure ni de fuseau : elle
 * traverse l'API telle que la base l'écrit, « YYYY-MM-DD ».
 */
const OID_DATE = 1082;
pg.types.setTypeParser(OID_DATE, (valeur: string) => valeur);

const { Pool } = pg;

export type Requete = PoolClient;

/**
 * Le rôle de connexion doit être MEMBRE de `authenticated`, jamais
 * superutilisateur ni propriétaire des tables : ces deux-là contourneraient la
 * RLS et rendraient les politiques décoratives.
 */
const pool = new Pool({
  connectionString: url(),
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 10_000,
  /*
   * Pas de compilation à la volée (JIT). Les politiques RLS appellent des
   * fonctions, dont le coût estimé (100 par appel et par ligne) fait passer
   * des requêtes de quelques millisecondes au-dessus de `jit_above_cost` :
   * PostgreSQL les compilait avec LLVM à chaque appel. Mesuré le 31 octobre
   * 2026 sur la liste du propriétaire : 2 s, dont 1,9 s de compilation ; 80 ms
   * sans. `une-requete-de-l-api-ne-se-compile-pas.test.ts` y veille.
   */
  options: "-c jit=off",
});

function url(): string {
  const valeur = process.env["DATABASE_URL"];
  if (!valeur) throw new Error("DATABASE_URL absente");
  return valeur;
}

/**
 * Exécute un travail sous l'identité d'un utilisateur.
 *
 * Tout passe par une transaction, et `SET LOCAL` garantit que le rôle et
 * l'identité meurent avec elle : une connexion rendue au pool ne peut pas
 * transporter l'identité du précédent appelant vers le suivant.
 */
export async function sousIdentite<T>(
  utilisateur: string,
  travail: (db: Requete) => Promise<T>,
): Promise<T> {
  return sousClaims({ sub: utilisateur }, travail);
}

/**
 * Le même travail, mais conduit PAR LE SERVEUR pour cet utilisateur : la file
 * de lectures, la fabrique de recettes, le journal des agents. La RLS reste
 * celle de l'utilisateur ; seule change la marque `malica.origine`, que les
 * déclencheurs `app.exiger_origine_serveur()` exigent pour écrire les
 * lectures, extractions, journaux et exécutions. Un appel venu du navigateur
 * ne passe jamais par ici : `app.ts` et `cles-api.ts` appellent `sousIdentite`.
 */
export async function sousIdentiteDuServeur<T>(
  utilisateur: string,
  travail: (db: Requete) => Promise<T>,
): Promise<T> {
  return sousClaims({ sub: utilisateur }, async (db) => {
    await db.query("select set_config('malica.origine', 'serveur', true)");
    return travail(db);
  });
}

/**
 * Exécute un travail sous une clé d'API du cabinet.
 *
 * Deux claims au lieu d'un. `sub` reste la personne qui a créé la clé : c'est
 * elle que l'audit nomme comme acteur. `api_tenant` est le cabinet de la clé,
 * et sa présence change UNE chose en base : `app.member_orgs()` rend ce
 * cabinet et rien d'autre — pas les autres organisations de cette personne,
 * pas la plateforme. La frontière est donc posée par la base, pas par la clé.
 *
 * Ce que la clé peut FAIRE (ses portées) se décide avant d'arriver ici, dans
 * `cles-api.ts` ; ce qu'elle peut VOIR se décide ici, par les politiques.
 */
export async function sousCleDuCabinet<T>(
  cle: { tenantId: string; auNomDe: string },
  travail: (db: Requete) => Promise<T>,
): Promise<T> {
  return sousClaims({ sub: cle.auNomDe, api_tenant: cle.tenantId }, travail);
}

/**
 * Exécute un travail sous le RELECTEUR DE NUIT, pour un seul dossier.
 *
 * Ce n'est ni une personne, ni un rôle privilégié : la transaction endosse
 * `authenticated` comme toutes les autres, et la base décide de ce que ce
 * compte voit (20261118100000_le_relecteur_de_nuit) — son dossier tant qu'une
 * relecture y est due ou en cours, les pièces qu'elle vise, rien d'autre.
 *
 * C'est la SEULE fonction qui pose ses claims. L'identifiant du compte est lu
 * en base par son code, sous le rôle de connexion de l'API (la fonction n'est
 * ouverte qu'à lui) : aucun identifiant de compte n'est écrit en TypeScript.
 * Sans la marque du serveur, ou si la tour a révoqué le compte, la base ne
 * reconnaît plus le service, et il ne voit plus rien.
 */
export async function sousLeRelecteurDeNuit<T>(
  tenantId: string,
  travail: (db: Requete) => Promise<T>,
): Promise<T> {
  return sousClaims(
    async (db) => {
      const { rows } = await db.query<{ id: string | null }>(
        "select app.compte_de_service_id($1) as id",
        [COMPTE_DU_RELECTEUR],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`compte de service absent : ${COMPTE_DU_RELECTEUR}`);
      return { sub: id, service: COMPTE_DU_RELECTEUR, service_tenant: tenantId };
    },
    async (db) => {
      await db.query("select set_config('malica.origine', 'serveur', true)");
      return travail(db);
    },
  );
}

/** Le code du compte, tel que `identity.comptes_de_service` le déclare. */
const COMPTE_DU_RELECTEUR = "relecteur_de_nuit";

/**
 * Ouvre la transaction, endosse `authenticated` et pose les claims.
 *
 * Les claims peuvent se LIRE en base avant d'endosser le rôle : c'est le cas
 * d'un compte de service, dont l'identifiant n'est ouvert qu'au rôle de
 * connexion de l'API.
 */
async function sousClaims<T>(
  claimsOuLecture: Record<string, string> | ((db: Requete) => Promise<Record<string, string>>),
  travail: (db: Requete) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const claims =
      typeof claimsOuLecture === "function" ? await claimsOuLecture(client) : claimsOuLecture;
    await client.query("set local role authenticated");
    for (const [nom, valeur] of Object.entries(claims)) {
      // Le troisième argument à `true` limite la valeur à la transaction.
      await client.query("select set_config($1, $2, true)", [`request.jwt.claim.${nom}`, valeur]);
    }
    const resultat = await travail(client);
    await client.query("commit");
    return resultat;
  } catch (erreur) {
    // Le rollback échoue si la connexion est déjà tombée ; l'erreur d'origine
    // est celle qui intéresse l'appelant, on ne la masque pas.
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}

/**
 * Les rares gestes qui précèdent toute identité : créer un compte, vérifier un
 * mot de passe. Le nom est délibérément désagréable — on doit hésiter avant de
 * l'appeler, et tout nouvel usage doit sauter aux yeux en revue.
 */
export async function horsRlsAuthentificationSeule<T>(
  travail: (db: Requete) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const resultat = await travail(client);
    await client.query("commit");
    return resultat;
  } catch (erreur) {
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}

/**
 * Tient un verrou consultatif de SESSION (sa clé, un `bigint` dit par la base)
 * le temps d'un travail, ou rend `null`
 * s'il est déjà tenu ailleurs — par ce processus ou par une autre API.
 *
 * Une connexion est réservée pour toute la durée : un verrou de session meurt
 * avec elle, et un processus tué le relâche donc de lui-même. Le travail ouvre
 * ses propres transactions courtes ; cette connexion ne fait que tenir le
 * verrou, hors de toute transaction.
 */
export async function sousVerrouDeSession<T>(
  cle: string,
  travail: () => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(
      "select pg_try_advisory_lock($1::bigint) as ok",
      [cle],
    );
    if (!rows[0]?.ok) return null;
    return await travail();
  } finally {
    // La connexion est DÉTRUITE, pas rendue : le verrou meurt avec elle, même
    // si le déverrouillage aurait échoué — une connexion rendue au pool en le
    // tenant encore bloquerait toutes les passes suivantes.
    client.release(true);
  }
}

/*
 * ============================================ LA CONNEXION DU JOURNAL
 *
 * Le journal d'observabilité a SA connexion, jamais celle d'une transaction
 * métier : la trace d'un appel refusé ou annulé (rollback) est justement celle
 * qu'on cherche, et elle mourrait avec la transaction qui l'aurait portée.
 *
 * Deux connexions au plus, des délais courts : le journal ne doit jamais
 * prendre à l'application les connexions dont elle a besoin, ni la faire
 * attendre. Une connexion oisive ne retient pas le processus
 * (`allowExitOnIdle`), et une connexion qui tombe ne le fait pas tomber.
 */
const poolDuJournal = new Pool({
  connectionString: url(),
  max: 2,
  statement_timeout: 5_000,
  connectionTimeoutMillis: 3_000,
  allowExitOnIdle: true,
  options: "-c jit=off",
});
poolDuJournal.on("error", (erreur) => {
  console.error("[journal] connexion perdue :", erreur.message);
});

/** Ce que `observabilite.consigner` rend d'un lot. */
export interface BilanDuJournal {
  inscrits: number;
  repetes: number;
  rejetes: number;
  dossiers_ecartes: number;
}

/** Inscrit un lot d'événements par la seule porte du journal, hors de toute transaction métier. */
export async function consignerEnBase(evenements: readonly unknown[]): Promise<BilanDuJournal> {
  const { rows } = await poolDuJournal.query<{ bilan: BilanDuJournal }>(
    "select observabilite.consigner($1::jsonb) as bilan",
    [JSON.stringify(evenements)],
  );
  return rows[0]!.bilan;
}

/** Le référentiel du journal (gestes, étapes de l'appareil), tel que la base le rend. */
export async function lireLeReferentielDuJournal(): Promise<unknown> {
  const { rows } = await poolDuJournal.query<{ r: unknown }>(
    "select observabilite.referentiel_du_journal() as r",
  );
  return rows[0]!.r;
}

/** Purge un paquet de traces au-delà de la rétention réglée en base ; rend leur nombre. */
export async function purgerLeJournal(): Promise<number> {
  const { rows } = await poolDuJournal.query<{ n: number }>("select observabilite.purger() as n");
  return rows[0]!.n;
}

/**
 * La trace d'origine d'une pièce (sa capture, son dépôt), ou rien : la parente
 * d'un travail différé. Par la connexion du journal, qui n'en lit rien d'autre.
 */
export async function traceDOrigineDeLaPiece(pieceId: string): Promise<string | null> {
  const { rows } = await poolDuJournal.query<{ id: string | null }>(
    "select observabilite.trace_d_origine($1) as id",
    [pieceId],
  );
  return rows[0]?.id ?? null;
}

export async function fermerLePoolDuJournal(): Promise<void> {
  await poolDuJournal.end();
}

/** La sonde de `/sante/profonde` : la base répond-elle, sous le rôle de l'API ? */
export async function sonderLaBase(): Promise<void> {
  await pool.query("select 1");
}

export async function fermerLePool(): Promise<void> {
  await pool.end();
}
