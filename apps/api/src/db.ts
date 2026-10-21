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

async function sousClaims<T>(
  claims: Record<string, string>,
  travail: (db: Requete) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
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

/** La sonde de `/sante/profonde` : la base répond-elle, sous le rôle de l'API ? */
export async function sonderLaBase(): Promise<void> {
  await pool.query("select 1");
}

export async function fermerLePool(): Promise<void> {
  await pool.end();
}
