/**
 * Sous la porte, pour l'épreuve.
 *
 * Aucun client n'écrit plus une table de faits ou d'état : il passe par une
 * porte, une fonction `security definer` du rôle `portier`
 * (`20261105100000_toute_ecriture_passe_par_une_porte.sql`). Les épreuves qui
 * éprouvent le socle que ces portes écrivent — politiques, déclencheurs,
 * contraintes d'une table — jouent donc leurs écritures sous ce rôle-là, avec
 * l'identité de la personne : exactement ce que vit le corps d'une porte.
 *
 * Le portier n'est ni superutilisateur ni propriétaire d'aucune table : la RLS
 * l'arrête comme elle arrête le client. Ce n'est pas la preuve en
 * superutilisateur que la règle du dépôt refuse. Aucune session cliente ne
 * peut l'endosser (`les-clients-n-ecrivent-que-par-les-portes.test.ts`) ;
 * l'épreuve y entre par la connexion d'administration, et seulement elle.
 */
import pg from "pg";

let pool: pg.Pool | null = null;

/** Une transaction sous le rôle des portes, au nom de `utilisateur`, venue du serveur. */
export async function sousLaPorte<T>(
  utilisateur: string,
  travail: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  pool ??= new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role portier");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [utilisateur]);
    await client.query("select set_config('malica.origine', 'serveur', true)");
    const resultat = await travail(client);
    await client.query("commit");
    return resultat;
  } catch (erreur) {
    // L'erreur d'origine est celle qui intéresse l'épreuve.
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}

export async function fermerLaPorte(): Promise<void> {
  await pool?.end();
  pool = null;
}
