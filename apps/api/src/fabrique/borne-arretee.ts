/**
 * Arrêter une borne de la fabrique pour une organisation (R10) — pour les
 * épreuves.
 *
 * `parametrage.fabrique_seuils` ne s'écrit plus par un client (lot 6,
 * « verrous en base ») : aucune route de l'application ne l'écrit, et un
 * membre quelconque pouvait y régler les bornes de son cabinet. Une borne
 * s'arrête donc par l'opérateur, sans migration ni déploiement — c'est ce que
 * R10 demande, et ce que les épreuves de la fabrique éprouvent.
 */
import pg from "pg";

export async function arreterUneBorne(
  tenantId: string,
  code: string,
  valeur: number,
  motif: string,
  /** Qui l'a décidée, au cabinet : « qui a décidé ce seuil » se lit (R10). */
  arretePar: string,
): Promise<void> {
  const url = process.env["DATABASE_URL_ADMIN"];
  if (!url) throw new Error("DATABASE_URL_ADMIN absente : une borne s'arrête par l'opérateur");
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(
      `insert into parametrage.fabrique_seuils (tenant_id, code, value_num, motif, arrete_par)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, code) do update
         set value_num = excluded.value_num, motif = excluded.motif,
             arrete_par = excluded.arrete_par`,
      [tenantId, code, valeur, motif, arretePar],
    );
  } finally {
    await pool.end();
  }
}
