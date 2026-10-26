import type { Requete } from "../db.ts";
import type { ConfigurationFiscale } from "@malica/socle/ports/fiscalite";

/** Instantané du CLIENT à la date du fait, sous la RLS de l'appelant. */
export async function fiscaliteDuDossier(db: Requete, clientId: string, date: string) {
  const { rows } = await db.query<{
    id: string;
    date_effet: string;
    configuration: ConfigurationFiscale;
  }>(
    `select id, date_effet::text, configuration from parametrage.fiscalite_dossiers
      where tenant_id = $1 and date_effet <= $2::date
      order by date_effet desc, created_at desc limit 1`,
    [clientId, date],
  );
  return rows[0] ?? null;
}
